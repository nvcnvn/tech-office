# Research: File Storage System with Quota Management

**Feature**: 014-file-storage-system-an-integration  
**Date**: 2025-11-09

## Research Questions & Findings

### 1. Object Storage Solution

**Decision**: Cloudflare R2 (S3-compatible object storage)

**Rationale**:
- **No egress fees**: Unlike AWS S3, R2 charges only for storage and operations, not data transfer
- **S3 API compatibility**: Drop-in replacement for S3 SDKs (use AWS SDK with R2 endpoints)
- **Presigned URL support**: Native support for time-limited presigned URLs for upload/download
- **Global CDN integration**: R2 can serve files via Cloudflare CDN with custom domains
- **Cost efficiency**: $0.015/GB/month storage, free egress (vs S3's $0.023/GB storage + $0.09/GB egress)
- **Tech Office existing infrastructure**: Already using Cloudflare for DNS and CDN

**Alternatives Considered**:
- AWS S3: More mature, but expensive egress fees for high-traffic downloads
- MinIO self-hosted: More operational overhead, no built-in CDN
- Supabase Storage: Too coupled with Supabase ecosystem

**Implementation Pattern**:
```go
// Use AWS SDK v2 for Go with R2 endpoint override
import (
    "github.com/aws/aws-sdk-go-v2/config"
    "github.com/aws/aws-sdk-go-v2/service/s3"
)

cfg, _ := config.LoadDefaultConfig(ctx,
    config.WithRegion("auto"),
    config.WithEndpointResolver(aws.EndpointResolverFunc(
        func(service, region string) (aws.Endpoint, error) {
            return aws.Endpoint{
                URL: "https://<account-id>.r2.cloudflarestorage.com",
            }, nil
        }),
    ),
)

client := s3.NewFromConfig(cfg)
```

### 2. Presigned URL Strategy

**Decision**: Generate presigned URLs for both upload and download operations

**Rationale**:
- **No backend proxying**: Client uploads/downloads directly to/from R2, reducing backend load
- **Security**: Time-limited URLs (15 minutes for upload, 1 hour for download) prevent link sharing abuse
- **Organization isolation**: Include organization-scoped key prefixes (`org-{uuid}/`) in R2 paths
- **Performance**: Eliminates backend bottleneck for large file transfers

**Upload Flow**:
1. Client requests presigned upload URL via RPC (includes filename, size, context)
2. Backend validates quota, generates presigned PUT URL with metadata headers
3. Client uploads directly to R2 using presigned URL
4. Client confirms upload completion via RPC (backend stores metadata)

**Download Flow**:
1. Client requests file download via file ID
2. Backend validates organization membership, generates presigned GET URL
3. Client downloads directly from R2 via presigned URL

**Existing Tech Office Pattern**: Similar to how avatar uploads work in existing systems

### 3. CDN Configuration

**Decision**: Use Cloudflare R2 public bucket with custom domain for CDN-accelerated downloads

**Rationale**:
- **Global distribution**: Cloudflare's 300+ edge locations cache files close to users
- **Low latency**: <200ms download latency globally (per performance goals)
- **Cache-Control headers**: Set appropriate TTLs for different file types (images: 1 week, documents: 1 day)
- **HTTPS by default**: Secure downloads via Cloudflare SSL
- **Bandwidth savings**: CDN edge caching reduces R2 operations costs

**Configuration**:
- R2 bucket: `tech-office-files` (private bucket for presigned uploads)
- R2 public bucket: `tech-office-files-cdn` (public bucket mapped to custom domain)
- Custom domain: `files.techoffice.example.com`
- Cache settings: Vary by file type (images aggressive, documents moderate)

**Alternative**: R2 Worker for on-the-fly transformations (deferred to future enhancement)

### 4. Image Optimization

**Decision**: Cloudflare Image Resizing for on-the-fly compression and format conversion

**Rationale**:
- **Automatic optimization**: Converts images to WebP for modern browsers, JPEG for legacy
- **Responsive images**: Generate multiple sizes via URL parameters (`?width=300&quality=80`)
- **Zero storage overhead**: No need to pre-generate thumbnails, done on-demand at edge
- **Cache efficiency**: Cloudflare caches resized variants at edge locations

**URL Pattern**:
```
https://files.techoffice.example.com/cdn-cgi/image/width=800,quality=80,format=auto/org-{uuid}/avatars/{file-id}.jpg
```

**Integration with Tech Office**:
- Avatar uploads: Generate 3 sizes (thumbnail 64px, profile 256px, full 512px)
- Chat image attachments: Generate preview thumbnails automatically
- Frontend lazy loading: Use srcset with multiple sizes

**Existing Pattern**: Review how avatars are currently handled (if any precedent exists)

### 5. Database Schema Design

**Decision**: Create new `files` schema for domain-specific tables

**Rationale**:
- **Domain separation**: Files are cross-cutting concern used by multiple domains (chat, organization, etc.)
- **Schema isolation**: Follows Tech Office schema-per-domain pattern
- **Citus sharding**: All tables include `organization_id` for distributed table support

**Schema Tables**:

**`files.file_metadata`**:
```sql
CREATE TABLE files.file_metadata (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    original_filename TEXT NOT NULL,
    storage_key TEXT NOT NULL, -- R2 object key: org-{uuid}/context/{file-id}
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    mime_type TEXT NOT NULL,
    upload_context TEXT NOT NULL CHECK (upload_context IN ('chat', 'avatar', 'docs', 'project')),
    uploaded_by_employee_id UUID NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_file_uploader FOREIGN KEY (organization_id, uploaded_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
);

SELECT create_distributed_table('files.file_metadata', 'organization_id');
```

**`files.file_quota`**:
```sql
CREATE TABLE files.file_quota (
    organization_id UUID PRIMARY KEY REFERENCES public.organization(id),
    quota_bytes BIGINT NULL, -- NULL = unlimited
    max_file_size_bytes BIGINT NOT NULL DEFAULT 104857600, -- 100MB default
    current_usage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (current_usage_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT create_distributed_table('files.file_quota', 'organization_id');
```

**`files.file_deletion_log`**:
```sql
CREATE TABLE files.file_deletion_log (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    file_id UUID NOT NULL,
    original_filename TEXT NOT NULL,
    deleted_by_employee_id UUID NOT NULL,
    deletion_reason TEXT,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_file_deletion_deleter FOREIGN KEY (organization_id, deleted_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
);

SELECT create_distributed_table('files.file_deletion_log', 'organization_id');
```

**Indexes**:
- `files.file_metadata`: (organization_id, upload_context, updated_at DESC) for listing
- `files.file_metadata`: (organization_id, uploaded_by_employee_id) for user uploads
- `files.file_metadata`: (organization_id, is_deleted) WHERE is_deleted = FALSE for active files
- `files.file_deletion_log`: (organization_id, file_id) for deletion lookups

**Existing Tech Office Pattern**: Follows organization.employee, chat.channel schema patterns

### 6. Multi-Tenant Isolation Strategy

**Decision**: Enforce isolation at connection pool layer (TenantPool) + organization-scoped R2 key prefixes

**Rationale**:
- **Defense in depth**: Multiple layers of isolation (pool, query filters, R2 keys)
- **Constitution compliance**: TenantPool automatically scopes queries to organization_id
- **Storage isolation**: R2 key prefix `org-{uuid}/` prevents cross-tenant access
- **Presigned URL validation**: Backend validates organization membership before generating URLs

**Implementation**:
```go
// Always use TenantPool for user operations
func (s *FileService) GetFile(ctx context.Context, req *connect.Request[v1.GetFileRequest]) (*connect.Response[v1.GetFileResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx) // Extracted by auth interceptor
    
    return txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        file, err := s.queries.GetFileByID(ctx, tx, orgID, fileID)
        // ...
    })
}
```

**Existing Tech Office Pattern**: Same as organization.employee, chat.channel enforcement

### 7. Quota Enforcement Mechanism

**Decision**: Atomic quota check with row-level locking in PostgreSQL transaction

**Rationale**:
- **Race condition prevention**: `SELECT FOR UPDATE` locks quota row during check-and-increment
- **Atomic operations**: Quota check + usage increment in single transaction
- **Consistency**: Prevents concurrent uploads from exceeding quota
- **Performance**: Quota table has one row per organization (fast lookup)

**Implementation Pattern**:
```go
func (l *FileLogic) ValidateAndReserveQuota(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, fileSize int64) error {
    // Lock quota row for update
    quota, err := l.queries.GetQuotaForUpdate(ctx, tx, orgID)
    if err != nil {
        return err
    }
    
    // Check limits
    if quota.MaxFileSizeBytes.Valid && fileSize > quota.MaxFileSizeBytes.Int64 {
        return ErrFileTooLarge
    }
    
    if quota.QuotaBytes.Valid && (quota.CurrentUsageBytes + fileSize) > quota.QuotaBytes.Int64 {
        return ErrQuotaExceeded
    }
    
    // Increment usage atomically
    return l.queries.IncrementQuotaUsage(ctx, tx, orgID, fileSize)
}
```

**Existing Tech Office Pattern**: Similar to notification.active_connection concurrent updates

### 8. Cross-Domain Integration: Chat & Avatar

**Decision**: Direct logic layer integration for chat message attachments and avatar uploads

**Chat Integration**:
- Chat service depends on FileLogic interface (not RPC)
- When user uploads file in chat: Call `FileLogic.CreateFileMetadata()` to record metadata
- Store file_id reference in `chat.message.mentions` JSONB field as file attachment
- Frontend embeds download link in chat message UI

**Avatar Integration**:
- User profile update depends on FileLogic interface
- When user uploads avatar: Call `FileLogic.CreateFileMetadata()` with context='avatar'
- Store file_id in `organization.employee.additional_info` JSONB field
- Frontend displays avatar using presigned download URL

**Rationale**:
- **Constitution compliance**: Cross-domain integration via logic layer methods (not SQL joins)
- **Transaction safety**: Chat/avatar operations can share transaction with file metadata creation
- **Loose coupling**: File service is reusable across domains

**Existing Tech Office Pattern**: Similar to how NotificationLogic is injected into other services

### 9. Frontend API Wrapper Pattern

**Decision**: Custom TypeScript interfaces in `packages/apis/src/files.ts` (no direct protobuf imports)

**Rationale**:
- **Constitution compliance**: Frontend API wrapper pattern (Principle VII)
- **Type safety**: Convert protobuf Timestamp to JavaScript Date
- **Developer experience**: Clean TypeScript interfaces instead of generated proto types

**Pattern**:
```typescript
// packages/apis/src/files.ts
export interface FileMetadata {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  uploadContext: 'chat' | 'avatar' | 'docs' | 'project';
  uploadedAt: Date; // Converted from proto Timestamp
  uploadedByEmployeeId: string;
}

export async function requestUploadUrl(params: {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  uploadContext: string;
}): Promise<{ uploadUrl: string; fileId: string }> {
  return await rpcCall(async () => {
    const resp = await fileClient.requestUploadUrl({
      filename: params.filename,
      sizeBytes: params.sizeBytes,
      mimeType: params.mimeType,
      uploadContext: params.uploadContext,
    });
    return {
      uploadUrl: resp.uploadUrl,
      fileId: resp.fileId,
    };
  });
}
```

**Existing Tech Office Pattern**: Same as packages/apis/src/chat.ts, organization.ts

### 10. Error Handling: Quota Exceeded with Structured Details

**Decision**: Use `google.rpc.QuotaFailure` error details for quota exceeded errors

**Rationale**:
- **Constitution Principle X**: Structured error details when generic codes insufficient
- **Client guidance**: Frontend can extract quota info and display actionable message
- **Owner notification**: Backend sends notification to owners/operators when quota exceeded

**Backend Implementation**:
```go
import (
    "connectrpc.com/connect"
    errdetails "google.golang.org/genproto/googleapis/rpc/errdetails"
)

func (s *FileServiceConnect) RequestUploadUrl(ctx context.Context, req *connect.Request[v1.RequestUploadUrlRequest]) (*connect.Response[v1.RequestUploadUrlResponse], error) {
    // ... quota validation fails ...
    
    if err == ErrQuotaExceeded {
        connectErr := connect.NewError(
            connect.CodeResourceExhausted,
            errors.New("organization storage quota exceeded"),
        )
        
        quotaFailure := &errdetails.QuotaFailure{
            Violations: []*errdetails.QuotaFailure_Violation{{
                Subject: fmt.Sprintf("organization/%s", orgID),
                Description: fmt.Sprintf("Storage quota: %d GB, Current usage: %d GB", 
                    quota.QuotaBytes/1e9, quota.CurrentUsageBytes/1e9),
            }},
        }
        
        if detail, detailErr := connect.NewErrorDetail(quotaFailure); detailErr == nil {
            connectErr.AddDetail(detail)
        }
        
        return nil, connectErr
    }
}
```

**Frontend Extraction**:
```typescript
import { QuotaFailureSchema } from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";

try {
  await requestUploadUrl(params);
} catch (error) {
  if (error instanceof ConnectError && error.code === Code.ResourceExhausted) {
    const quotaDetails = error.findDetails(QuotaFailureSchema);
    if (quotaDetails.length > 0) {
      const violation = quotaDetails[0].violations[0];
      // Display: "Storage quota exceeded: 10 GB / 10 GB used. Contact owner to increase quota."
    }
  }
}
```

**Existing Tech Office Pattern**: Similar to chat.ts RetryInfo error detail handling

## Technical Decisions Summary

| Decision Area | Choice | Key Rationale |
|--------------|--------|---------------|
| Object Storage | Cloudflare R2 | No egress fees, S3-compatible, CDN integration |
| Upload/Download | Presigned URLs | No backend proxying, direct client-to-R2 |
| CDN | Cloudflare R2 public bucket | Global distribution, <200ms latency |
| Image Optimization | Cloudflare Image Resizing | On-the-fly, no pre-generation needed |
| Database Schema | New `files` schema | Domain separation, Citus sharding |
| Multi-Tenancy | TenantPool + R2 key prefixes | Defense in depth isolation |
| Quota Enforcement | Row-level locking in transaction | Atomic, race-condition free |
| Chat Integration | Direct FileLogic dependency | Constitution-compliant, transactional |
| Avatar Integration | FileLogic + JSONB reference | Loose coupling, reusable |
| Frontend API | Custom TypeScript wrappers | Type safety, no proto leakage |
| Error Handling | QuotaFailure error details | Structured, actionable guidance |

## Existing Tech Office Patterns to Follow

1. **Database Schema**: `organization.employee`, `chat.channel` (Citus multi-tenant)
2. **Service Architecture**: `backend/internal/organization/` (two-layer pattern)
3. **Frontend API**: `packages/apis/src/chat.ts` (wrapper pattern)
4. **Error Details**: `packages/apis/src/chat.ts` RetryInfo handling
5. **Cross-Domain**: NotificationLogic injection pattern
6. **Transaction Management**: `backend/internal/organization/` txn.WithTxn usage
7. **Migration Workflow**: golang-migrate scripts + `./scripts/migrate.sh`

## Open Questions (None Remaining)

All technical questions resolved through research. Ready for Phase 1 design.
