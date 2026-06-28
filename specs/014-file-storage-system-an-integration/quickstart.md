# Quickstart: File Storage System

**Feature**: 014-file-storage-system-an-integration  
**Date**: 2025-11-09

## Prerequisites

- Go 1.25+
- PostgreSQL 18+ with Citus extension
- Cloudflare account with R2 enabled
- Backend development environment set up

## Setup Steps

### 1. Cloudflare R2 Configuration

**Create R2 Bucket**:
```bash
# Using Cloudflare dashboard or wrangler CLI
wrangler r2 bucket create tech-office-files

# Set CORS policy for direct client uploads
wrangler r2 bucket cors put tech-office-files --config r2-cors.json
```

**r2-cors.json**:
```json
{
  "rules": [
    {
      "allowed_origins": ["https://*.techoffice.example.com", "http://localhost:13000"],
      "allowed_methods": ["GET", "PUT", "POST"],
      "allowed_headers": ["*"],
      "max_age_seconds": 3600
    }
  ]
}
```

**Create API Token**:
1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Create API Token with Read & Write permissions for `tech-office-files` bucket
3. Save Access Key ID and Secret Access Key

**Custom Domain for CDN** (optional but recommended):
1. Go to R2 bucket settings → Custom Domains
2. Add custom domain: `files.techoffice.example.com`
3. Configure DNS records as instructed by Cloudflare

### 2. Environment Variables

Add to `backend/.env`:
```bash
# Cloudflare R2 Configuration
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET_NAME=tech-office-files
R2_ENDPOINT=https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://files.techoffice.example.com  # CDN URL

# File Storage Limits
DEFAULT_MAX_FILE_SIZE_BYTES=104857600  # 100MB
DEFAULT_QUOTA_BYTES=10737418240        # 10GB (or empty for unlimited)
```

### 3. Database Migration

**Apply Migration**:
```bash
cd backend
./scripts/migrate.sh
```

This creates:
- `files` schema
- `files.file_metadata` table
- `files.file_quota` table
- `files.file_deletion_log` table

**Verify Migration**:
```bash
docker compose exec postgres psql -U postgres -d tech_office_db -c "\dt files.*"
```

Expected output:
```
           List of relations
 Schema |      Name           | Type  |  Owner
--------+---------------------+-------+----------
 files  | file_metadata       | table | postgres
 files  | file_quota          | table | postgres
 files  | file_deletion_log   | table | postgres
```

### 4. Code Generation

**Generate sqlc Code**:
```bash
cd backend
sqlc generate
```

Generates:
- `backend/database/files.query.sql.go`
- Go types for `FileMetadata`, `FileQuota`, `FileDeletionLog`

**Generate Proto Code**:
```bash
cd backend
buf generate
```

Generates:
- `backend/rpc/v1/files.pb.go`
- `backend/rpc/v1/files_connect.pb.go`

**Frontend Proto Generation**:
```bash
cd frontend/packages
buf generate buf.build/googleapis/googleapis  # For error details
cd ../..
pnpm -r build  # Build all packages
```

### 5. Initialize Quotas for Existing Organizations

Create migration data script or run manually:
```sql
-- Insert default quotas for all existing organizations
INSERT INTO files.file_quota (organization_id, quota_bytes, max_file_size_bytes)
SELECT id, NULL, 104857600  -- NULL = unlimited, 100MB max file size
FROM public.organization
ON CONFLICT (organization_id) DO NOTHING;
```

### 6. Start Backend Server

```bash
cd backend
go run cmd/main.go cmd/server.go
```

Server starts on `http://localhost:18080`

### 7. Frontend Setup

**Update API Exports**:
```typescript
// frontend/packages/rpc/index.ts
export * as files from './rpc/v1/files_pb';
```

**Build Frontend Packages**:
```bash
cd frontend
pnpm -r build
```

**Start Dev Server**:
```bash
cd frontend/apps/web
pnpm dev
```

Frontend available at `http://localhost:13000`

---

## Testing Scenarios

### Scenario 1: Upload File in Chat

**Objective**: Upload PDF document in chat channel and embed download link in message

**Steps**:
1. Navigate to chat channel
2. Click attachment icon in message composer
3. Select `report.pdf` (5MB)
4. Frontend calls `requestUploadUrl({ filename, size_bytes, mime_type, upload_context: 'chat' })`
5. Backend validates quota, generates presigned PUT URL
6. Frontend uploads file directly to R2 using fetch with PUT method
7. On success, frontend calls `confirmUpload({ file_id })`
8. Backend records metadata, increments quota usage
9. Frontend embeds download link in chat message
10. Other users click link, download file via presigned GET URL

**Expected Result**: 
- File uploaded to R2 at `org-{uuid}/chat/{file_id}`
- Metadata stored in `files.file_metadata`
- Quota usage incremented by 5MB
- Chat message contains clickable download link
- Download link works for all organization members

**Verification**:
```sql
SELECT * FROM files.file_metadata WHERE organization_id = '...' AND upload_context = 'chat';
SELECT * FROM files.file_quota WHERE organization_id = '...';
```

### Scenario 2: Upload Avatar Image

**Objective**: User uploads profile picture with automatic image optimization

**Steps**:
1. Navigate to user profile settings
2. Click avatar upload button
3. Select `photo.jpg` (2MB PNG)
4. Frontend calls `requestUploadUrl({ filename, size_bytes, mime_type: 'image/png', upload_context: 'avatar' })`
5. Backend validates quota, generates presigned URL
6. Frontend uploads to R2
7. Frontend calls `confirmUpload({ file_id })`
8. Backend records metadata
9. Frontend displays avatar using CDN URL with Cloudflare Image Resizing:
   - Thumbnail: `https://files.techoffice.example.com/cdn-cgi/image/width=64/{storage_key}`
   - Profile: `https://files.techoffice.example.com/cdn-cgi/image/width=256/{storage_key}`

**Expected Result**:
- Avatar uploaded to R2 at `org-{uuid}/avatar/{file_id}`
- Metadata stored with `upload_context = 'avatar'`
- User profile displays optimized avatar images
- Different sizes loaded based on display context

### Scenario 3: Quota Exceeded

**Objective**: Enforce storage quota and notify owners/operators

**Setup**:
1. Set organization quota to 1GB via `updateQuota({ quota_bytes: 1073741824 })`
2. Upload files totaling 950MB

**Steps**:
1. Attempt to upload 100MB file
2. Frontend calls `requestUploadUrl({ size_bytes: 104857600, ... })`
3. Backend locks quota row with `SELECT FOR UPDATE`
4. Backend calculates: `950MB + 100MB > 1GB` → quota exceeded
5. Backend returns `connect.CodeResourceExhausted` error with `QuotaFailure` details
6. Backend sends notification to owners/operators
7. Frontend extracts `QuotaFailure` details and displays:
   ```
   Storage quota exceeded: 1.00 GB / 0.95 GB used
   Contact your organization owner to increase quota
   ```

**Expected Result**:
- Upload rejected before presigned URL generation
- Quota usage remains at 950MB (not incremented)
- Error message contains actionable guidance
- Owners/operators receive notification

**Verification**:
```sql
SELECT quota_bytes, current_usage_bytes FROM files.file_quota WHERE organization_id = '...';
-- Should show: quota_bytes=1073741824, current_usage_bytes=950000000 (approx)
```

### Scenario 4: File Management Interface

**Objective**: Owner sorts files by size and batch deletes large files

**Steps**:
1. Owner navigates to file management page (`/workspace/files`)
2. Frontend calls `listFiles({ sort_by: 'size', sort_order: 'desc', page_size: 50 })`
3. Backend returns files sorted by size descending
4. UI displays table with columns: Filename, Size, Context, Uploaded By, Upload Date
5. Owner selects 3 large files (e.g., videos totaling 300MB)
6. Owner clicks "Delete Selected" and enters reason: "Outdated training videos"
7. Frontend calls `batchDeleteFiles({ file_ids: [...], deletion_reason: '...' })`
8. Backend:
   - Soft-deletes files in database
   - Records deletion log entries
   - Deletes objects from R2
   - Decrements quota usage by 300MB
9. Frontend refreshes list, deleted files no longer visible
10. Quota usage updated to reflect reclaimed space

**Expected Result**:
- 3 files marked `is_deleted = TRUE` in database
- 3 deletion log entries created with reason
- R2 objects deleted
- Quota usage decremented by 300MB
- `reclaimed_bytes: 314572800` returned in response

**Verification**:
```sql
SELECT * FROM files.file_metadata WHERE organization_id = '...' AND is_deleted = TRUE;
SELECT * FROM files.file_deletion_log WHERE organization_id = '...' ORDER BY deleted_at DESC LIMIT 3;
SELECT current_usage_bytes FROM files.file_quota WHERE organization_id = '...';
```

### Scenario 5: Download Deleted File

**Objective**: User attempts to download deleted file, sees deletion warning

**Setup**:
1. File deleted with reason "Contains outdated information"

**Steps**:
1. User clicks download link from old chat message
2. Frontend calls `getDownloadUrl({ file_id: '...' })`
3. Backend queries `files.file_metadata` → `is_deleted = TRUE`
4. Backend queries `files.file_deletion_log` for deletion details
5. Backend returns response with `is_deleted: true` and `deletion_info`:
   ```json
   {
     "is_deleted": true,
     "deletion_info": {
       "deleted_at": "2025-11-09T10:30:00Z",
       "deleted_by_employee_name": "John Doe",
       "deletion_reason": "Contains outdated information"
     }
   }
   ```
6. Frontend displays warning modal:
   ```
   This file was deleted on Nov 9, 2025 by John Doe
   Reason: Contains outdated information
   ```

**Expected Result**:
- No presigned URL generated
- User sees deletion context
- Clear explanation why file unavailable

### Scenario 6: Quota Reduction Policy

**Objective**: Owner reduces quota below current usage, new uploads blocked

**Setup**:
1. Current usage: 8GB
2. Current quota: 10GB

**Steps**:
1. Owner navigates to quota settings
2. Owner updates quota to 5GB via `updateQuota({ quota_bytes: 5368709120 })`
3. Backend updates `files.file_quota.quota_bytes = 5GB`
4. Employee attempts to upload 100MB file
5. Backend checks: `8GB + 0.1GB > 5GB` → rejected
6. Error message: "Organization quota exceeded. Current usage (8 GB) exceeds quota (5 GB). Delete files to enable uploads."
7. Owner deletes 3GB of files via file management interface
8. Employee retries upload
9. Backend checks: `5GB + 0.1GB > 5GB` → still rejected
10. Owner deletes another 0.5GB
11. Employee retries upload
12. Backend checks: `4.5GB + 0.1GB <= 5GB` → accepted

**Expected Result**:
- Quota reduction succeeds immediately
- New uploads blocked until usage < quota
- Existing files remain accessible
- Clear error guidance to delete files

---

## Integration Testing

Run backend integration tests:
```bash
cd backend
go test ./integration/file_storage_test.go -v
```

Tests cover:
- Quota enforcement with concurrent uploads
- Presigned URL generation and validation
- Soft delete and metadata preservation
- Cross-domain integration (chat, avatar)
- Multi-tenant isolation

---

## Troubleshooting

### Issue: "Access Denied" when uploading to R2

**Cause**: CORS policy not configured or incorrect API token permissions

**Fix**:
```bash
wrangler r2 bucket cors put tech-office-files --config r2-cors.json
```

Verify API token has Read & Write permissions.

### Issue: Quota usage not updating

**Cause**: Missing transaction or quota row not initialized

**Fix**:
```sql
-- Check if quota row exists
SELECT * FROM files.file_quota WHERE organization_id = '...';

-- If missing, create it
INSERT INTO files.file_quota (organization_id) VALUES ('...');
```

### Issue: Image optimization not working

**Cause**: Cloudflare Image Resizing requires custom domain setup

**Fix**: Ensure R2 bucket has custom domain configured and DNS records propagated.

### Issue: "File too large" error

**Cause**: File exceeds `max_file_size_bytes` limit

**Fix**: Update quota limits:
```sql
UPDATE files.file_quota 
SET max_file_size_bytes = 209715200  -- 200MB
WHERE organization_id = '...';
```

---

## Next Steps

1. Implement file search by filename (uses existing trigram indexes)
2. Add file usage analytics (downloads per file, popular contexts)
3. Implement automatic file expiration policies (retention periods)
4. Add virus scanning integration (ClamAV or third-party service)
5. Support file versioning (upload same filename creates new version)
6. Add public sharing links with expiration (outside organization)

---

## References

- Constitution: `.specify/memory/constitution.md`
- Data Model: `specs/014-file-storage-system-an-integration/data-model.md`
- Research: `specs/014-file-storage-system-an-integration/research.md`
- Cloudflare R2 Docs: https://developers.cloudflare.com/r2/
- Cloudflare Image Resizing: https://developers.cloudflare.com/images/image-resizing/
