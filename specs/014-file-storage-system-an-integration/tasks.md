# Tasks: File Storage System with Quota Management

**Input**: Design documents from `/specs/014-file-storage-system-an-integration/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/

## Execution Flow
```
1. Load plan.md from feature directory ✅
2. Load design documents ✅
   → data-model.md: 3 tables (file_metadata, file_quota, file_deletion_log)
   → contracts/: files.proto (9 RPC methods), files.query.sql (23 queries)
   → research.md: Cloudflare R2, presigned URLs, CDN, image optimization
3. Generate tasks by category ✅
4. Apply task rules ✅
5. Number tasks sequentially (T001-T078) ✅
6. Generate dependency graph ✅
7. Create parallel execution examples ✅
8. Validate task completeness ✅
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

---

## Phase 3.1: Setup & Environment

### Infrastructure Setup
- [X] T001 [P] Create Cloudflare R2 bucket `tech-office-files` with CORS policy for direct client uploads
- [X] T002 [P] Create Cloudflare R2 API token with Read & Write permissions
- [X] T003 [P] Configure custom domain `files.techoffice.example.com` for R2 public bucket (CDN)
- [X] T004 Add R2 configuration to `backend/.env`:
  ```
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME, R2_ENDPOINT, R2_PUBLIC_URL,
  DEFAULT_MAX_FILE_SIZE_BYTES, DEFAULT_QUOTA_BYTES
  ```

### Database Migration & Schema
- [X] T005 Update `backend/database/scripts/schema.sql` with `files` schema (3 tables: file_metadata, file_quota, file_deletion_log)
- [X] T006 Create migration `backend/k8s/base/database/migrations/<timestamp>_add_files_schema.up.sql`:
  - CREATE SCHEMA files
  - CREATE TABLE files.file_metadata with composite PK (organization_id, id)
  - CREATE TABLE files.file_quota with PK (organization_id)
  - CREATE TABLE files.file_deletion_log with composite PK (organization_id, id)
  - CREATE indexes for all tables
  - SELECT create_distributed_table for Citus sharding
- [X] T007 Create rollback migration `backend/k8s/base/database/migrations/<timestamp>_add_files_schema.down.sql`
- [X] T008 Run migration via `cd backend && ./scripts/migrate.sh` and verify schema creation

### Code Generation
- [X] T009 Add `files.query.sql` to `backend/database/scripts/files.query.sql` (23 sqlc queries from contracts/)
- [X] T010 Run `cd backend && sqlc generate` to generate `backend/database/files.query.sql.go` and update `models.go`
- [X] T011 Copy `contracts/files.proto` to `backend/rpc/v1/files.proto`
- [X] T012 Run `cd backend && buf generate` to generate Go protobuf code
- [X] T013 Re-export FileService from `frontend/packages/rpc/index.ts`
- [X] T014 Run `cd frontend && pnpm -r build` to refresh workspace artifacts

---

## Phase 3.2: Core Implementation

### Upload Context Constants (Cross-Stack Synchronization)
- [X] T015 Define backend constants in `backend/internal/files/constants.go`:
  ```go
  UploadContextChat, UploadContextAvatar, UploadContextDocs, UploadContextProject
  ```
- [X] T016 [P] Define frontend TypeScript types in `frontend/packages/apis/src/files.ts`:
  ```typescript
  export type UploadContext = 'chat' | 'avatar' | 'docs' | 'project';
  ```
- [X] T017 Add runtime validation in backend with warning logs for unknown upload_context values

### Backend Service: Two-Layer Architecture

#### Logic Layer (Pure Business Logic)
- [X] T018 Create `backend/internal/files/logic.go` with FileLogic interface:
  - Methods: ValidateUploadRequest, GenerateStorageKey, CheckQuota, RecordUpload, RecordDeletion
  - Accept `tx database.DBTX` parameter (pool-agnostic)
  - Accept parsed auth (organizationID, employeeID) as parameters
  - Return domain errors (not connect.Error)
- [X] T019 Implement `ValidateUploadRequest(filename, sizeBytes, mimeType, context, quotaInfo)`:
  - Validate file size against quota.max_file_size_bytes
  - Check if current_usage + sizeBytes <= quota_bytes (NULL = unlimited)
  - Validate mime_type format
  - Return domain error for quota exceeded
- [X] T020 Implement `GenerateStorageKey(orgID, uploadContext, fileID)`:
  - Format: `org-{orgID}/{uploadContext}/{fileID}`
  - Used for R2 object key construction
- [X] T021 Implement `CheckQuota(ctx, tx, orgID, fileSize)`:
  - GetQuotaForUpdate (row-level lock)
  - Validate available quota
  - Return QuotaExceededError if limit reached
- [X] T022 Implement `RecordUpload(ctx, tx, fileMetadata, incrementBytes)`:
  - CreateFileMetadata
  - IncrementQuotaUsage atomically
  - All in same transaction for consistency
- [X] T023 Implement `RecordDeletion(ctx, tx, orgID, fileID, employeeID, reason)`:
  - SoftDeleteFile
  - CreateDeletionLog
  - GetFileSizeByID and DecrementQuotaUsage
  - All in same transaction for consistency

#### R2 Client Layer
- [X] T024 Create `backend/internal/files/r2client.go` with R2Client struct:
  - Use AWS SDK v2 for Go with R2 endpoint override
  - Methods: GeneratePresignedUploadURL, GeneratePresignedDownloadURL, DeleteObject
  - Initialize from config (account ID, access keys, bucket name, endpoint)
- [X] T025 Implement `GeneratePresignedUploadURL(storageKey, contentType, expiresIn)`:
  - Generate presigned PUT URL valid for 15 minutes
  - Include Content-Type header
  - Return signed URL and expiration timestamp
- [X] T026 Implement `GeneratePresignedDownloadURL(storageKey, expiresIn)`:
  - Generate presigned GET URL valid for 1 hour
  - Return signed URL and expiration timestamp
- [X] T027 Implement `DeleteObject(storageKey)`:
  - Delete file from R2 bucket
  - Return error if deletion fails

#### Connect Layer (RPC Handlers)
- [X] T028 Create `backend/internal/files/connect.go` with FileServiceServer struct:
  - Fields: logic FileLogic, r2Client *R2Client, queries *database.Queries
  - Fields: adminPool database.AdminDatabaseConnector, tenantPool database.TenantDatabaseConnector
  - Implements rpcv1connect.FileServiceHandler interface
- [X] T029 Implement `RequestUploadUrl(ctx, req)`:
  - Extract organizationID, employeeID from context via interceptor
  - Use txn.WithTxn(ctx, tenantPool) for transaction
  - Call logic.CheckQuota(tx, orgID, req.SizeBytes)
  - Generate fileID (uuid.New())
  - Call logic.GenerateStorageKey(orgID, req.UploadContext, fileID)
  - Call r2Client.GeneratePresignedUploadURL(storageKey, req.MimeType, 15*time.Minute)
  - Store pending upload in memory cache (fileID -> metadata) for ConfirmUpload validation
  - Return RequestUploadUrlResponse with fileID and uploadURL
- [X] T030 Implement `ConfirmUpload(ctx, req)`:
  - Extract organizationID, employeeID from context
  - Validate fileID exists in pending upload cache
  - Use txn.WithTxn(ctx, tenantPool) for transaction
  - Call logic.RecordUpload(tx, fileMetadata, incrementBytes)
  - Remove from pending upload cache
  - Return ConfirmUploadResponse with file metadata
- [X] T031 Implement `GetDownloadUrl(ctx, req)`:
  - Extract organizationID from context
  - Query GetFileByID(orgID, fileID) via tenantPool
  - If is_deleted=TRUE, query GetDeletionLogByFileID for deletion info
  - If deleted, return response with is_deleted=true and deletion_info
  - If active, call r2Client.GeneratePresignedDownloadURL(storageKey, 1*time.Hour)
  - Return GetDownloadUrlResponse with downloadURL
- [X] T032 Implement `GetFileMetadata(ctx, req)`:
  - Extract organizationID from context
  - Query GetFileByID(orgID, fileID) via tenantPool
  - If is_deleted=TRUE, query GetDeletionLogWithDeleterName
  - Return GetFileMetadataResponse with file and optional deletion_info
- [X] T033 Implement `ListFiles(ctx, req)`:
  - Extract organizationID from context (owner/operator role required)
  - Parse sort_by (size/updated_at), sort_order (asc/desc), page_size (max 100)
  - Calculate offset: (page - 1) * page_size
  - Query ListFilesByContext(orgID, context, limit, offset) via tenantPool
  - Query CountFilesByContext(orgID, context) for total_count
  - Return ListFilesResponse with files array and pagination metadata
- [X] T034 Implement `DeleteFile(ctx, req)`:
  - Extract organizationID, employeeID from context (owner/operator role required)
  - Use txn.WithTxn(ctx, tenantPool) for transaction
  - Query GetFileSizeByID to get file size
  - Call logic.RecordDeletion(tx, orgID, fileID, employeeID, reason)
  - Call r2Client.DeleteObject(storageKey) asynchronously (don't block transaction)
  - Return DeleteFileResponse with success=true and reclaimed_bytes
- [X] T035 Implement `BatchDeleteFiles(ctx, req)`:
  - Extract organizationID, employeeID from context
  - Validate batch size <= 100 files
  - Use txn.WithTxn(ctx, tenantPool) for transaction
  - Query GetFileSizesByIDs(orgID, fileIDs)
  - For each fileID: call logic.RecordDeletion
  - Track failed_file_ids for partial failures
  - Call r2Client.DeleteObject for each file asynchronously
  - Return BatchDeleteFilesResponse with deleted_count, reclaimed_bytes, failed_file_ids
- [X] T036 Implement `GetQuota(ctx, req)`:
  - Extract organizationID from context (owner/operator role required)
  - Query GetOrCreateQuota(orgID) via tenantPool
  - Calculate usage_percentage (current/quota * 100, -1 if unlimited)
  - Set is_quota_exceeded flag
  - Return GetQuotaResponse with QuotaInfo
- [X] T037 Implement `UpdateQuota(ctx, req)`:
  - Extract organizationID from context (owner/operator role required)
  - Validate quota_bytes >= 0 or NULL, max_file_size_bytes > 0
  - Use txn.WithTxn(ctx, tenantPool) for transaction
  - Call UpdateQuotaLimits(tx, orgID, quotaBytes, maxFileSize)
  - Return UpdateQuotaResponse with updated QuotaInfo

#### Service Registration
- [X] T038 Update `backend/cmd/server.go`:
  - Initialize R2Client with config
  - Create FileLogic with queries
  - Create FileServiceServer with logic, r2Client, adminPool, tenantPool
  - Register FileService handler: `mux.Handle(rpcv1connect.NewFileServiceHandler(fileService, interceptors))`

---

## Phase 3.3: Frontend Implementation

### API Wrapper Layer
- [X] T039 Create `frontend/packages/apis/src/files.ts` with custom TypeScript interfaces:
  ```typescript
  interface FileMetadata { id, originalFilename, sizeBytes, mimeType, uploadContext, uploadedByEmployeeId, uploadedAt: Date, isDeleted }
  interface FileDeletionInfo { deletedAt: Date, deletedByEmployeeId, deletedByEmployeeName, deletionReason }
  interface QuotaInfo { quotaBytes?, maxFileSizeBytes, currentUsageBytes, usagePercentage, isQuotaExceeded }
  ```
- [X] T040 Implement `requestUploadUrl(filename, sizeBytes, mimeType, uploadContext)`:
  - Call fileClient.requestUploadUrl()
  - Convert Timestamp to Date
  - Return { fileId, uploadUrl, expiresAt: Date }
- [X] T041 Implement `confirmUpload(fileId)`:
  - Call fileClient.confirmUpload()
  - Convert response to FileMetadata with Date types
  - Return FileMetadata
- [X] T042 Implement `getDownloadUrl(fileId)`:
  - Call fileClient.getDownloadUrl()
  - Convert timestamps to Date
  - Handle is_deleted case with deletion_info
  - Return { downloadUrl, expiresAt: Date, isDeleted, deletionInfo? }
- [X] T043 Implement `getFileMetadata(fileId)`:
  - Call fileClient.getFileMetadata()
  - Convert to FileMetadata with Date types
  - Return { file: FileMetadata, isDeleted, deletionInfo? }
- [X] T044 Implement `listFiles(uploadContext?, sortBy?, sortOrder?, pageSize?, page?)`:
  - Call fileClient.listFiles()
  - Convert array of files with Date types
  - Return { files: FileMetadata[], totalCount, page, pageSize }
- [X] T045 Implement `deleteFile(fileId, deletionReason?)`:
  - Call fileClient.deleteFile()
  - Return { success, reclaimedBytes }
- [X] T046 Implement `batchDeleteFiles(fileIds, deletionReason?)`:
  - Call fileClient.batchDeleteFiles()
  - Return { deletedCount, reclaimedBytes, failedFileIds }
- [X] T047 Implement `getQuota()`:
  - Call fileClient.getQuota()
  - Convert to QuotaInfo
  - Return QuotaInfo
- [X] T048 Implement `updateQuota(quotaBytes?, maxFileSizeBytes?)`:
  - Call fileClient.updateQuota()
  - Return QuotaInfo

### File Upload Widget Component
- [X] T049 Create `frontend/packages/apis/src/components/FileUploadWidget.tsx`:
  - Props: uploadContext, onUploadComplete, maxSizeBytes, acceptedTypes
  - State: uploadProgress, errorMessage
  - UI: Drag-and-drop zone, file input, progress bar
  - Features: File validation, direct R2 upload via presigned URL, progress tracking
  - Call requestUploadUrl → upload to R2 via PUT → confirmUpload on success
  - Add data-testid attributes: file-upload-input, file-upload-progress, file-upload-error
  - Use useThemeColors() for all styling (no hardcoded colors)

### Workspace File Management Page
- [X] T050 Add "Files" tab to `frontend/apps/web/src/app/workspace/layout.tsx` tabs array:
  ```typescript
  { label: 'Files', value: 'files', href: '/workspace/files' }
  ```
- [X] T051 Create `frontend/apps/web/src/app/workspace/files/page.tsx`:
  - Client-side rendering ('use client')
  - Auth guard via useRequireAuth hook
  - Sub-navigation using TabLink: Overview, Management
  - Query param routing (?tab=overview or ?tab=management)
  - Use useThemeColors() for styling
  - Add data-testid="workspace-files-page"
- [X] T052 Create `frontend/apps/web/src/app/workspace/files/components/OverviewTab.tsx`:
  - Display quota usage (progress bar, percentage, bytes)
  - Show recent uploads (last 10 files)
  - Quick stats: total files by context (chat, avatar, docs, project)
  - Use listFiles API with pagination
  - Use useThemeColors() for all colors
  - Add data-testid attributes: quota-usage, recent-files-list
- [X] T053 Create `frontend/apps/web/src/app/workspace/files/components/ManagementTab.tsx`:
  - File list table: filename, size, context, uploaded_by, uploaded_at
  - Sorting: by size or date (asc/desc)
  - Filtering: by upload_context
  - Batch selection with checkboxes
  - Batch delete button with confirmation dialog
  - Delete reason input field
  - Pagination controls
  - Use listFiles, batchDeleteFiles APIs
  - Use useThemeColors() for table styling
  - Add data-testid attributes: file-table, batch-delete-btn, delete-reason-input
- [X] T054 Create `frontend/apps/web/src/app/workspace/files/components/QuotaSettingsDialog.tsx`:
  - Dialog for owner/operator to update quota limits
  - Inputs: quotaBytes (with unlimited checkbox), maxFileSizeBytes
  - Validation: quotaBytes >= currentUsage, maxFileSizeBytes > 0
  - Call updateQuota API
  - Use useThemeColors() for dialog styling
  - Add data-testid attributes: quota-dialog, quota-bytes-input, max-file-size-input

---

## Phase 3.4: Chat & Avatar Integration

### Chat Attachment Integration
- [X] T055 Update `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx`:
  - Add FileUploadWidget with uploadContext='chat'
  - On upload complete, append file reference to message
  - Embed file download link in message text (use getDownloadUrl)
  - Add data-testid="chat-file-upload"
  - Send file IDs with message via fileIds parameter in sendMessage/replyToMessage
  - COMPLETED: Added Dialog with FileUploadWidget, file link insertion on upload complete, file IDs sent with messages
- [X] T056 Update `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx`:
  - Detect file references in message text (parse for file_id patterns)
  - Render file attachment UI with filename, size, download button
  - Call getDownloadUrl on click (handle deleted files with warning)
  - Use useThemeColors() for attachment card styling
  - Add data-testid="message-file-attachment"
  - COMPLETED: Created FileAttachment component, integrated into MessageItem with HTML parsing

### Avatar Upload Integration
- [X] T057 Update `frontend/apps/web/src/app/workspace/profile/components/AvatarUpload.tsx`:
  - Add FileUploadWidget with uploadContext='avatar'
  - Restrict acceptedTypes to images only (image/*)
  - On upload complete, update organization.employee.additional_info JSONB with avatar_file_id
  - Call getDownloadUrl for avatar display
  - Use Cloudflare Image Resizing URL parameters (?width=256&quality=80)
  - Use useThemeColors() for avatar container styling
  - Add data-testid="avatar-upload-widget"
  - UI updates with uploaded avatar (client-side state update)
  - COMPLETED: Integrated FileUploadWidget, created profile page at /workspace/profile, fixed UserMenu navigation, avatar UI updates on upload
  - NOTE: Backend UpdateEmployee RPC method needed for persisting avatar_file_id to database

---

## Phase 3.5: Manual Verification & Testing

### Backend Integration Tests (REQUIRED)
- [ ] T058 [P] Create `backend/integration/file_upload_test.go`:
  - Load test organization ID and employee ID from database
  - Generate dev token with ROLE_EMPLOYEE using `devjwt.NewDevJWTSigner`
  - Create FileService RPC client
  - Test RequestUploadUrl → simulate R2 upload → ConfirmUpload
  - Validate file metadata stored correctly
  - Validate quota usage incremented
- [ ] T059 [P] Create `backend/integration/file_download_test.go`:
  - Upload test file via integration test helper
  - Call GetDownloadUrl with valid fileID
  - Validate presigned URL returned
  - Test with deleted file (verify deletion_info returned)
- [ ] T060 [P] Create `backend/integration/file_list_test.go`:
  - Upload multiple files with different contexts
  - Call ListFiles with context filter
  - Validate sorting (by size, by date)
  - Validate pagination (page_size, page)
- [ ] T061 [P] Create `backend/integration/file_delete_test.go`:
  - Upload test file
  - Call DeleteFile with deletion_reason
  - Validate file soft-deleted (is_deleted=TRUE)
  - Validate deletion_log entry created
  - Validate quota usage decremented
  - Call GetDownloadUrl and verify deletion_info returned
- [ ] T062 [P] Create `backend/integration/batch_delete_test.go`:
  - Upload 5 test files
  - Call BatchDeleteFiles with all fileIDs and shared reason
  - Validate deleted_count, reclaimed_bytes
  - Validate all files soft-deleted
  - Validate all deletion_log entries created
- [ ] T063 [P] Create `backend/integration/quota_enforcement_test.go`:
  - Set quota to 1MB for test organization
  - Upload files until quota reached
  - Attempt upload exceeding quota (validate error)
  - Verify error message indicates quota exceeded
- [ ] T064 [P] Create `backend/integration/quota_update_test.go`:
  - Generate dev token with ROLE_OWNER
  - Call GetQuota (validate current usage)
  - Call UpdateQuota with new limits
  - Call GetQuota again (validate updated)
- [ ] T065 [P] Create `backend/integration/multi_tenant_isolation_test.go`:
  - Upload file for organization A
  - Try to access with organization B credentials (should fail)
  - Validate organization_id filtering prevents cross-tenant access

### Frontend Manual Testing Checklist
- [ ] T066 Manual test: Upload file via FileUploadWidget (chat context)
  - Verify drag-and-drop works
  - Verify progress bar updates
  - Verify upload completes successfully
  - Verify file appears in chat message
- [ ] T067 Manual test: Download file from chat message
  - Click download button
  - Verify presigned URL redirects to R2
  - Verify file downloads correctly
- [ ] T068 Manual test: Upload avatar via AvatarUpload widget
  - Verify image preview shows
  - Verify Cloudflare Image Resizing applies (check network tab for ?width=256)
  - Verify avatar appears in profile
- [ ] T069 Manual test: File management page (owner/operator)
  - Navigate to /workspace/files?tab=overview
  - Verify quota usage display
  - Verify recent files list
  - Switch to ?tab=management
  - Verify file list table with sorting
  - Verify filtering by upload_context
- [ ] T070 Manual test: Batch delete files
  - Select multiple files via checkboxes
  - Click batch delete button
  - Enter deletion reason
  - Verify confirmation dialog
  - Verify files soft-deleted
  - Verify quota usage decremented
- [ ] T071 Manual test: Deleted file handling
  - Delete a file via management page
  - Try to download deleted file from chat message
  - Verify deletion warning shows with reason and deleter name
- [ ] T072 Manual test: Quota settings (owner/operator only)
  - Open quota settings dialog
  - Update quotaBytes and maxFileSizeBytes
  - Save changes
  - Verify quota usage display updates

---

## Phase 3.6: Polish & Documentation

- [ ] T073 Add structured logging to all FileService RPC methods:
  - Log uploadContext, fileSize, organizationID for uploads
  - Log fileID, downloadURL expiration for downloads
  - Log deletionReason, fileCount for deletions
- [ ] T074 [P] Add error detail handling for quota exceeded errors:
  - Backend: Attach QuotaFailure error detail when quota reached
  - Frontend: Extract error detail and display user-friendly message with current/limit values
- [ ] T075 [P] Update `specs/014-file-storage-system-an-integration/README.md` with:
  - Feature overview
  - Architecture diagram (R2 presigned URL flow)
  - API usage examples
  - Quota management guide
- [ ] T076 [P] Create `backend/docs/FILE-STORAGE.md`:
  - R2 configuration steps
  - Presigned URL security model
  - Quota enforcement patterns
  - Integration examples (chat, avatar)
- [ ] T077 Verify all interactive UI elements have data-testid attributes:
  - FileUploadWidget, MessageComposer file button, avatar upload, file table, delete buttons
- [ ] T078 Final smoke test:
  - Upload file in all contexts (chat, avatar, docs, project)
  - List files with filters and sorting
  - Delete files individually and in batch
  - Update quota settings
  - Verify quota enforcement prevents over-limit uploads
  - Verify deleted files show warning on download attempts

---

## Dependencies

### Setup Phase (T001-T017)
- T001-T004 (infrastructure) can run in parallel
- T005-T008 (migrations) must be sequential
- T009-T014 (codegen) must be sequential, blocks all implementation
- T015-T017 (constants) can run in parallel after T010, blocks backend service

### Backend Implementation (T018-T038)
- T018-T023 (logic layer) must be sequential
- T024-T027 (R2 client) can run in parallel with T018-T023
- T028 (connect layer setup) blocks T029-T037 (RPC handlers)
- T029-T037 (RPC handlers) can be partially parallel (different methods, but share connect.go file - sequential safer)
- T038 (service registration) requires all backend tasks complete

### Frontend Implementation (T039-T054)
- T039 (API wrapper interfaces) blocks T040-T048
- T040-T048 (API wrapper methods) can be mostly parallel (different methods in same file - sequential safer)
- T049 (FileUploadWidget) can run after T040-T041
- T050-T054 (workspace pages) can run after T044-T047

### Integration (T055-T057)
- T055-T056 (chat integration) require T049, T040-T042 complete
- T057 (avatar integration) requires T049, T040-T041 complete

### Testing & Polish (T058-T078)
- T058-T065 (backend integration tests) can run in parallel after T038 complete
- T066-T072 (manual testing) can run after frontend implementation complete
- T073-T078 (polish) can run after all testing complete

---

## Parallel Execution Examples

### Setup & Codegen (After Infrastructure Ready)
```bash
# T015-T017 (constants) - different files, can be parallel
Task: "Define backend constants in backend/internal/files/constants.go"
Task: "Define frontend TypeScript types in frontend/packages/apis/src/files.ts"
Task: "Add runtime validation in backend with warning logs"
```

### Backend Logic Layer (Sequential - Same File)
```bash
# T018-T023 must be sequential (same logic.go file)
Task: "Create backend/internal/files/logic.go with FileLogic interface"
Task: "Implement ValidateUploadRequest method"
Task: "Implement GenerateStorageKey method"
# ... (continue sequentially)
```

### Backend R2 Client & Logic Layer (Parallel - Different Files)
```bash
# T024-T027 (r2client.go) can run in parallel with T018-T023 (logic.go)
Task: "Create backend/internal/files/r2client.go with R2Client struct"
Task: "Implement GeneratePresignedUploadURL method"
Task: "Implement GeneratePresignedDownloadURL method"
Task: "Implement DeleteObject method"
```

### Backend Integration Tests (Parallel - Different Files)
```bash
# T058-T065 can run in parallel (different test files)
Task: "Create backend/integration/file_upload_test.go"
Task: "Create backend/integration/file_download_test.go"
Task: "Create backend/integration/file_list_test.go"
Task: "Create backend/integration/file_delete_test.go"
Task: "Create backend/integration/batch_delete_test.go"
Task: "Create backend/integration/quota_enforcement_test.go"
Task: "Create backend/integration/quota_update_test.go"
Task: "Create backend/integration/multi_tenant_isolation_test.go"
```

---

## Notes

- **Cloudflare R2 Setup**: T001-T004 require Cloudflare account access and wrangler CLI
- **Migration Strategy**: Use golang-migrate via `backend/scripts/migrate.sh` (not Atlas)
- **Transaction Management**: All Connect layer methods use `txn.WithTxn` helper (no manual Begin/Commit)
- **Pool Selection**: Use TenantPool for user operations, AdminPool for system operations (document justification)
- **Quota Enforcement**: Use `SELECT FOR UPDATE` for atomic quota check-and-increment
- **Presigned URLs**: 15 minutes for uploads (short-lived), 1 hour for downloads (longer-lived)
- **Soft Deletion**: Files are soft-deleted (is_deleted=TRUE) but metadata preserved for audit trail
- **Deletion Log**: Immutable audit trail for file deletions with reason tracking
- **CDN Integration**: Use custom domain for R2 public bucket to enable Cloudflare CDN and Image Resizing
- **Image Optimization**: Use Cloudflare Image Resizing URL parameters for avatars and chat image attachments
- **Frontend Testing**: NO unit/snapshot/component tests - manual testing only per Constitution v5.2.0
- **Backend Testing**: Integration tests REQUIRED using RPC client pattern with dev tokens
- **Theme System**: ALL colors via useThemeColors() hook - NO hardcoded hex/rgb/named colors
- **Constant Alignment**: upload_context values MUST align across database CHECK constraint, backend constants, frontend types

---

## Validation Checklist

- [x] All contracts have corresponding implementations (9 RPC methods → T029-T037)
- [x] All entities have model tasks (3 tables → T005-T008 migrations, T009-T010 sqlc)
- [x] Backend integration tests present (T058-T065 using RPC client pattern with dev tokens)
- [x] NO frontend unit/snapshot/component test tasks (Constitution v5.2.0 compliant)
- [x] All interactive UI elements have data-testid tasks (T049-T054, T077 verification)
- [x] Parallel tasks truly independent (different files or parallel-safe)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] String constant changes include synchronization tasks (T015-T017)
- [x] Codegen tasks present and properly ordered (T009-T014 before implementation)
- [x] Service architecture follows two-layer pattern (logic + connect layers)
- [x] Frontend uses workspace layout pattern (T050-T054)
- [x] API wrapper pattern enforced (T039-T048 custom interfaces, no direct protobuf imports)
- [x] Cross-domain integration documented (chat/avatar integration T055-T057)

---

**Total Tasks**: 78  
**Estimated Effort**: 3-4 sprints (assuming 2-week sprints)  
**Critical Path**: Setup → Codegen → Backend Service → Frontend UI → Integration → Testing → Polish

**Ready for Execution**: ✅
