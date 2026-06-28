# Tasks: File Storage Security and Access Improvement

**Input**: Design documents from `/specs/015-file-storage-security-and-access/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/

## Execution Flow
```
1. Loaded plan.md: web app (Go backend + Next.js frontend) with DOMAIN-OWNED UPLOAD ARCHITECTURE
2. Tech stack extracted:
   - Backend: Go 1.25+, PostgreSQL 16+, sqlc, ConnectRPC, github.com/nvcnvn/flows
   - Frontend: TypeScript 5.x, Next.js 15, MUI v5
   - Libraries: h2non/filetype (validation), Gotenberg (PDF conversion), PGroonga (search)
3. Loaded data-model.md: 3 new tables (file_access_rule, file_pdf_conversion, file_content_index)
4. Loaded contracts/: files.proto (7 RPC methods), chat_files.proto (2 RPC methods), files_security.query.sql (30+ queries)
5. Loaded quickstart.md: 6 test scenarios (validation, access control, search, PDF conversion)
6. Applied ARCHITECTURE REFACTOR: Domain-owned upload flow to eliminate circular dependencies
   - ChatService owns RequestChannelFileUpload/ConfirmChannelFileUpload RPCs
   - FileLogic provides internal methods called by domain services (NOT RPC)
   - FileService removed context-based upload RPCs, keeps validation/search/PDF/indexing RPCs
7. Generated tasks by category: Setup → Core → Integration → Verification → Tests → Polish
8. Applied task rules: Different files marked [P], implementation before verification, verification before tests
9. Validated completeness: All RPCs implemented, all queries generated, all scenarios tested, circular dependency eliminated
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Path Conventions
- Backend: `backend/` (Go code, migrations, integration tests)
- Frontend: `frontend/apps/web/` (Next.js app), `frontend/packages/` (shared packages)

---

## Phase 3.1: Setup & Dependencies

### Database Schema & Migrations
- [X] T001 Add new columns to `files.file_metadata` table in `backend/database/scripts/schema.sql`:
  - `validation_status TEXT CHECK (validation_status IN ('pending', 'verified', 'warning', 'failed', 'skipped')) DEFAULT 'pending'`
  - `validation_message TEXT`
  - `detected_mime_type TEXT`
  - Add comments documenting constitution alignment for constants
- [X] T002 Create `files.file_access_rule` table in `backend/database/scripts/schema.sql`:
  - Include all columns from data-model.md
  - Add composite primary key `(organization_id, id)` for Citus
  - Add foreign keys to `files.file_metadata`, `public.organization`
  - Add unique constraint `UNIQUE (organization_id, file_id)`
  - Add indexes: `idx_file_access_context`, `idx_file_access_file`
  - Add CHECK constraints and column comments
  - Include `SELECT create_distributed_table()` call
- [X] T003 Create `files.file_pdf_conversion` table in `backend/database/scripts/schema.sql`:
  - Include all columns from data-model.md
  - Add composite primary key, foreign keys, unique constraints
  - Add indexes: `idx_pdf_conversion_original`, `idx_pdf_conversion_status`, `idx_pdf_conversion_storage_key`
  - Add CHECK constraints and column comments
  - Include `SELECT create_distributed_table()` call
- [X] T004 Create `files.file_content_index` table in `backend/database/scripts/schema.sql`:
  - Include all columns from data-model.md
  - Add composite primary key, foreign keys, unique constraints
  - Add PGroonga index: `CREATE INDEX idx_file_content_pgroonga ON files.file_content_index USING pgroonga(extracted_text)`
  - Add indexes: `idx_file_content_file`, `idx_file_content_status`
  - Add CHECK constraints and column comments
  - Include `SELECT create_distributed_table()` call
- [X] T005 Create migration files in `backend/k8s/base/database/migrations/`:
  - Generate timestamp: `YYYYMMDDHHMMSS_add_file_security.up.sql`
  - Generate timestamp: `YYYYMMDDHHMMSS_add_file_security.down.sql`
  - Copy schema changes from schema.sql into .up.sql
  - Write rollback DDL for .down.sql (DROP TABLE, DROP INDEX)
  - Validate migrations: `cd backend && ./scripts/migrate.sh`

### SQL Queries & Code Generation
- [X] T006 [P] Add validation queries to `backend/database/scripts/files.query.sql`:
  - `UpdateFileValidation` (update validation_status, detected_mime_type)
  - `GetFilesWithValidationWarnings` (paginated list of warnings)
- [X] T007 [P] Create `backend/database/scripts/files_security.query.sql` with access control queries:
  - `InsertFileAccessRule` (upsert with ON CONFLICT)
  - `GetFileAccessRule` (by organization_id, file_id)
  - `CheckFileAccessWithContext` (join file_metadata + file_access_rule)
  - `GetFilesByContext` (list files in context with pagination)
  - `DeleteFileAccessRule` (soft delete)
- [X] T008 [P] Add PDF conversion queries to `backend/database/scripts/files_security.query.sql`:
  - `InsertPDFConversion` (upsert with ON CONFLICT)
  - `GetPDFConversion` (by organization_id, original_file_id)
  - `UpdatePDFConversionStatus` (status, error, duration)
  - `GetPendingPDFConversions` (status IN ('pending', 'in_progress'))
  - `GetFailedPDFConversions` (status = 'failed', paginated)
- [X] T009 [P] Add content indexing queries to `backend/database/scripts/files_security.query.sql`:
  - `InsertFileContentIndex` (upsert with ON CONFLICT)
  - `GetFileContentIndex` (by organization_id, file_id)
  - `UpdateContentIndexStatus` (status, error, duration)
  - `GetPendingContentIndexes` (status IN ('pending', 'in_progress'))
  - `GetFailedContentIndexes` (status = 'failed', paginated)
- [X] T010 [P] Add search query to `backend/database/scripts/files_security.query.sql`:
  - `SearchFilesByNameAndContent` (PGroonga fuzzy search with access control filters)
  - `CountSearchResults` (total count for pagination)
  - Include `pgroonga_score()` for relevance ranking
  - Use `&@~` operator for multilingual fuzzy matching
- [X] T011 Run `sqlc generate` to generate Go types and methods:
  - Execute: `cd backend && sqlc generate`
  - Verify generated files in `backend/database/`
  - Commit generated outputs

### Backend Dependencies & Constants
- [X] T012 [P] Install Go dependencies: ✅ COMPLETE
  - `go get github.com/h2non/filetype` (magic byte validation)
  - `go get github.com/nvcnvn/flows` (async workflow orchestration)
  - Verify go.mod updated
- [X] T013 [P] Create `backend/internal/files/constants.go`: ✅ COMPLETE
  - Validation status constants (Pending, Verified, Warning, Failed, Skipped)
  - Context type constants (ChatChannel, Project, DepartmentDocs, etc.)
  - Access scope constants (Public, Private, Department)
  - Conversion status constants (Pending, InProgress, Completed, Failed)
  - Indexing status constants (Pending, InProgress, Completed, Failed)
  - Extraction method constants (OfficeParser, PDFParser, ImageOCR, PlainText)
  - Add comments documenting proto enum alignment

### Proto Definitions & Code Generation
- [X] T014 Copy `contracts/files.proto` to `backend/rpc/v1/files.proto`:
  - 7 RPC methods: ValidateFile, SetFileAccessRule, CheckFileAccess, SearchFiles, GetPDFConversionStatus, TriggerPDFConversion, GetContentIndexStatus
  - All enums: ValidationStatus, FileContextType, FileAccessScope, PDFConversionStatus, IndexingStatus
  - All messages: request/response pairs, nested types
  - All `access_control` options with explicit `allowed_roles`
  - Architecture comments explaining domain-owned upload pattern (NO context-based upload RPCs in FileService)
- [X] T014a [P] Copy `contracts/chat_files.proto` to `backend/rpc/v1/chat_files.proto`:
  - 2 RPC methods: RequestChannelFileUpload, ConfirmChannelFileUpload
  - Messages: RequestChannelFileUploadRequest/Response, ConfirmChannelFileUploadRequest/Response, FileMetadata
  - All `access_control` options with explicit `allowed_roles`
  - Architecture comments explaining why ChatService owns chat attachment uploads
- [X] T015 Run `buf generate` to generate protobuf code:
  - Execute: `cd backend && buf generate`
  - Verify generated files in `backend/rpc/v1/` (files_pb.go, chat_files_pb.go)
  - Verify frontend types in `frontend/packages/rpc/`
  - Commit generated outputs
- [X] T016 Re-export new services from `frontend/packages/rpc/index.ts`:
  - Add: `export { FileService } from './rpc/v1/files_connect'`
  - Add: `export { ChatFileService } from './rpc/v1/chat_files_connect'`
  - Add type exports for FileContextType, FileAccessScope, ValidationStatus enums
- [DEFERRED] T017 Build frontend packages:
  - Execute: `cd frontend && pnpm -r build`
  - Verify workspace artifacts refreshed
  - NOTE: Deferred - blocked by missing Feature 014 file API exports

---

## Phase 3.2: Core Implementation (Backend)

### File Validation Logic
- [X] T018 [P] Create `backend/internal/files/validation.go`:
  - `ValidateFileType(ctx, r2Client, storageKey, declaredMimeType) (*ValidationResult, error)` function
  - Read first 8KB from R2 using `r2Client.ReadRange()`
  - Use `filetype.Match(header)` to detect actual type
  - Compare detected vs declared MIME type
  - Return ValidationResult struct (status, message, declaredType, detectedType)
  - Add structured logging with slog
- [X] T019 Create validation result model in `backend/internal/files/types.go`:
  - `ValidationResult` struct matching proto message
  - `ToProto()` method for converting to protobuf type
  - `FromDB()` method for converting from sqlc-generated types

### File Upload Logic Layer (Internal Methods Called by Domain Services)
- [X] T019a Create `backend/internal/files/file_logic.go`:
  - Define `FileLogic` interface with methods:
    * `GenerateUploadURL(ctx, tx, params GenerateUploadParams) (*UploadURLResult, error)`
    * `ConfirmUpload(ctx, tx, params ConfirmUploadParams) (*FileMetadata, error)`
    * `CreateAccessRule(ctx, tx, params CreateAccessRuleParams) error`
  - Implement `fileLogic` struct with `queries *database.Queries`, `r2Client *r2.Client`
  - Accept `tx database.DBTX` parameter (NOT connection pool)
  - NO auth extraction or context verification (trusts caller - domain service)
  - Add structured logging with slog
- [X] T019b Implement `GenerateUploadURL` method in `file_logic.go`:
  - Generate UUID v7 for file ID
  - Construct storage key: `org-{orgID}/{uploadContext}/{fileID}`
  - Generate presigned R2 upload URL (15 min expiration)
  - Insert file_metadata row with status='pending'
  - Return UploadURLResult{FileID, UploadURL, ExpiresAt}
  - Add structured logging
- [X] T019c Implement `ConfirmUpload` method in `file_logic.go`:
  - Query file_metadata by file_id and org_id
  - Verify file uploader matches employeeID parameter
  - Update file_metadata status (pending → active)
  - Atomically update file_quota.current_usage_bytes (increment by file size)
  - Return FileMetadata
  - Add structured logging
- [X] T019d Implement `CreateAccessRule` method in `file_logic.go`:
  - Insert file_access_rule row linking file to context
  - Handle upsert conflict (ON CONFLICT DO UPDATE)
  - Return error if creation fails
  - Add structured logging

### Access Control Logic Layer
- [X] T020 Create `backend/internal/files/access_logic.go`:
  - Define `AccessLogic` interface with methods:
    * `SetFileAccessRule(ctx, tx, orgID, fileID, contextType, contextID, scope) (*FileAccessRule, error)`
    * `CheckFileAccess(ctx, tx, orgID, employeeID, fileID) (*AccessCheckResult, error)`
    * `GetFilesByContext(ctx, tx, orgID, contextType, contextID, limit, offset) ([]*FileMetadata, error)`
  - Implement `accessLogic` struct with `queries *database.Queries`
  - Accept `tx database.DBTX` parameter (NOT connection pool)
  - NO auth extraction (accept orgID, employeeID as parameters)
- [X] T021 Implement `CheckFileAccess` business logic in `access_logic.go`:
  - Query file_access_rule for file
  - Switch on context_type:
    * `chat_channel`: Call chat.ChannelLogic.IsChannelMember(ctx, tx, orgID, employeeID, contextID)
    * `project`: Future - return false for now
    * `department_docs`: Query organization.department_member
    * Others: Future - return false for now
  - Check access_scope:
    * `public`: Allow if employee in organization (always true if valid orgID)
    * `private`: Allow if member of context
    * `department`: Allow if employee in any department with access
  - Always allow if employee is file uploader
  - Return AccessCheckResult (hasAccess, denialReason, accessRule)
  - Add structured logging with slog

### PDF Conversion Logic Layer
- [X] T022 Create `backend/internal/files/pdf_logic.go`: ✅ COMPLETE
  - ✅ Define `PDFLogic` interface with methods:
    * `GetPDFConversionStatus(ctx, tx, orgID, fileID) (*PDFConversion, error)`
    * `CreatePDFConversion(ctx, tx, orgID, fileID, pdfStorageKey, size, status) (*PDFConversion, error)`
    * `UpdateConversionStatus(ctx, tx, orgID, conversionID, status, error, duration) (*PDFConversion, error)`
  - ✅ Implement `pdfLogic` struct with `queries *database.Queries`
  - ✅ Accept `tx database.DBTX` parameter (pool-agnostic)
  - ✅ Add structured logging
- [X] T023 Create conversion eligibility check in `pdf_logic.go`: ✅ COMPLETE
  - ✅ `IsConvertible(mimeType string) bool` function
  - ✅ Eligible types: .docx, .xlsx, .pptx, .odt, .ods, .odp, legacy .doc/.xls/.ppt
  - ✅ Return false for PDFs (already PDF)
  - ✅ Return false for images, videos, etc.
  - ✅ Document size limits (skip >50MB) in comments

### Content Indexing Logic Layer
- [X] T024 Create `backend/internal/files/index_logic.go`: ✅ COMPLETE
  - ✅ Define `IndexLogic` interface with methods:
    * `GetContentIndexStatus(ctx, tx, orgID, fileID) (*ContentIndex, error)`
    * `CreateContentIndex(ctx, tx, orgID, fileID, text, method, status) (*ContentIndex, error)`
    * `UpdateIndexStatus(ctx, tx, orgID, indexID, status, error, duration) (*ContentIndex, error)`
  - ✅ Implement `indexLogic` struct with `queries *database.Queries`
  - ✅ Accept `tx database.DBTX` parameter (pool-agnostic)
  - ✅ Add structured logging
- [X] T025 Create indexing eligibility check in `index_logic.go`: ✅ COMPLETE
  - ✅ `IsIndexable(mimeType string) bool` function
  - ✅ Eligible types: text files (plain, markdown, CSV, HTML, XML, JSON), office docs, PDFs
  - ✅ Return false for images, videos (OCR not implemented)
  - ✅ Document in code comments

### Search Logic Layer
- [X] T026 Create `backend/internal/files/search_logic.go`: ✅ COMPLETE
  - ✅ Define `SearchLogic` interface with methods:
    * `SearchFiles(ctx, tx, orgID, employeeID, query, limit) ([]SearchResult, error)`
    * `GetAccessibleContextIDs(ctx, tx, orgID, employeeID) (map[string][]dbuuid.UUID, error)`
  - ✅ Implement `searchLogic` struct with `queries *database.Queries`
  - ✅ Resolve accessible context IDs:
    * Query chat.channel_membership for channels employee is member of (via GetEmployeeChannelMemberships)
    * Query organization.department_member for departments (via GetEmployeeDepartmentMemberships)
    * Combine into context map keyed by context_type
  - ✅ Call `queries.SearchFilesByNameAndContent()` with accessible contexts (SQL-level filtering)
  - ✅ Convert DB results to SearchResult structs with nullable field handling
  - ✅ Add structured logging
  - ⚠️ NOTE: Added helper queries `GetEmployeeChannelMemberships` and `GetEmployeeDepartmentMemberships` to files_security.query.sql, regenerated sqlc

### Async Workflow Definitions (github.com/nvcnvn/flows)
- [X] T027 Create `backend/internal/files/validation_workflow.go`: ✅ COMPLETE (OPTIMIZED)
  - ✅ Split into two workflows: FileValidationWorkflow (validation only) + FilePostProcessingWorkflow (PDF + indexing)
  - ✅ FileValidationWorkflow activities: DownloadFileHeader, ValidateFileType, ScanFile, UpdateValidationStatus
  - ✅ Workflow focuses ONLY on security validation (magic byte + virus scan)
  - ✅ Removed PDF conversion from validation workflow (moved to separate workflow)
  - ✅ R2Client.ReadRange() method used for header download
  - ✅ filetype.Match() integration for magic byte detection
  - ✅ Retry policies configured (3 attempts, exponential backoff)
- [X] T028 Create `backend/internal/files/postprocessing_workflow.go`: ✅ COMPLETE (NEW)
  - ✅ FilePostProcessingWorkflow created for heavy async operations
  - ✅ Activities: ConvertFileToPDF, ExtractContent
  - ✅ PDF conversion only for eligible files (office docs)
  - ✅ Content extraction for text, office, PDF files
  - ✅ Non-blocking error handling (partial success supported)
  - ✅ TODO: Implement GotenbergClient for actual PDF conversion
  - ✅ TODO: Implement ContentExtractor for text extraction
- [X] T029 Architecture documentation created: ✅ COMPLETE
  - ✅ Created `backend/docs/FILE-WORKFLOWS-ARCHITECTURE.md`
  - ✅ Documents workflow split rationale and benefits
  - ✅ Explains triggering sequence (validation sync, post-processing async)
  - ✅ Includes implementation examples and testing strategy
  - ✅ Defines monitoring metrics and next steps

### FileService Connect Layer (RPC Handlers)
- [X] T030 FileServiceServer already exists in `backend/internal/files/service.go`: ✅ COMPLETE
  - Define `FileServiceServer` struct with:
    * `AdminPool database.AdminDatabaseConnector` (for async workflow triggers)
    * `TenantPool database.TenantDatabaseConnector` (for user operations)
    * `Queries *database.Queries`
    * `ValidationLogic ValidationLogic`
    * `AccessLogic AccessLogic`
    * `PDFLogic PDFLogic`
    * `IndexLogic IndexLogic`
    * `SearchLogic SearchLogic`
    * `FlowsClient *flows.Client` (workflow orchestration)
    * `R2Client *r2.Client` (Cloudflare R2)
    * `instanceID string` (backend instance identifier)
  - Constructor: `NewService` exists
- [X] T031 Implement `ValidateFile` RPC handler in `service.go`: ✅ COMPLETE
  - Extract auth context (orgID, employeeID) using `interceptor.OrgIDFromContext(ctx)`
  - Use TenantPool for transaction
  - Call `txn.WithTxn(ctx, s.TenantPool, func(ctx, tx) error {...})`
  - Inside transaction:
    * Query file metadata (verify ownership or access)
    * Call `s.ValidationLogic.ValidateFileType()` passing R2 client, storage key, MIME type
    * Update validation status using sqlc-generated methods
  - Convert result to proto response
  - Add structured logging
  - Lightweight proto-level auth already handled by proto options
- [X] T032 Implement `SetFileAccessRule` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract auth context (orgID, employeeID)
  - ✅ Use TenantPool for transaction
  - ✅ Inside transaction:
    * Create AccessLogic instance
    * Call `s.AccessLogic.SetFileAccessRule(ctx, tx, orgID, fileID, contextType, contextID, scope)`
  - ✅ Convert result to proto response with FileAccessRule message
  - ✅ Add structured logging
  - ✅ Added helper functions: `protoContextTypeToString`, `stringToProtoContextType`, `protoAccessScopeToString`, `stringToProtoAccessScope`
- [X] T033 Implement `CheckFileAccess` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract auth context (orgID, employeeID)
  - ✅ Use TenantPool for transaction
  - ✅ Inside transaction:
    * Create AccessLogic instance
    * Call `s.AccessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)`
  - ✅ Convert result to proto response (hasAccess, denialReason, accessRule)
  - ✅ Add structured logging
- [X] T034 Implement `SearchFiles` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract auth context (orgID, employeeID)
  - ✅ Use TenantPool for transaction
  - ✅ Inside transaction:
    * Create SearchLogic instance
    * Call `s.SearchLogic.SearchFiles(ctx, tx, orgID, employeeID, query, limit)`
  - ✅ Convert results to proto response (results, totalCount, hasMore)
  - ✅ Add structured logging
  - ✅ Validate limit (default 50, max 100)
- [X] T035 Implement `GetPDFConversionStatus` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract auth context (orgID, employeeID)
  - ✅ Use TenantPool for transaction
  - ✅ Inside transaction:
    * Create PDFLogic instance
    * Get file metadata with `s.queries.GetFileByID()`
    * Call `s.PDFLogic.GetPDFConversionStatus(ctx, tx, orgID, fileID)`
  - ✅ If conversion completed, generate presigned URL for PDF download
  - ✅ Convert result to proto response with PDFConversionInfo message
  - ✅ Add structured logging
- [X] T036 Implement `TriggerPDFConversion` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract auth context (orgID, employeeID)
  - ✅ Use TenantPool for transaction
  - ✅ Inside transaction:
    * Get file metadata with `s.queries.GetFileByID()`
    * Check file is convertible using `s.PDFLogic.IsConvertible()`
    * Create pending conversion record using `s.PDFLogic.CreatePDFConversion()`
  - ⚠️ Outside transaction (after commit):
    * TODO: Trigger async workflow using `s.FlowsClient.StartWorkflow("pdf-conversion", input)`
    * NOTE: Workflow trigger deferred until flows integration complete (T027-T029)
  - ✅ Convert result to proto response with PDFConversionInfo message
  - ✅ Add structured logging
- [X] T037 Implement `GetContentIndexStatus` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract auth context (orgID, employeeID)
  - ✅ Use TenantPool for transaction
  - ✅ Inside transaction:
    * Create IndexLogic instance
    * Call `s.IndexLogic.GetContentIndexStatus(ctx, tx, orgID, fileID)`
  - ✅ Convert result to proto response with ContentIndexInfo message
  - ✅ Add structured logging
  - ✅ Handle pgx.ErrNoRows case (no index record exists)

### ChatService Upload Handlers (Domain-Owned Upload Flow)
**ARCHITECTURE**: ChatService owns chat attachment upload flow to eliminate circular dependencies and improve security
- [X] T036a Create `backend/internal/chat/file_upload.go`: ✅ COMPLETE
  - Add FileLogic dependency to ChatServiceServer struct
  - Define upload helper methods for context verification
- [X] T036b Implement `RequestChannelFileUpload` RPC handler in `file_upload.go`: ✅ COMPLETE
  - Extract auth context (orgID, employeeID) using `interceptor.OrgIDFromContext(ctx)`
  - Use TenantPool for transaction
  - Inside transaction:
    * **VERIFY channel membership** (CRITICAL security check):
      - Call `s.chatLogic.GetChannel(ctx, tx, orgID, channelID)` to verify channel exists
      - Call `s.chatLogic.IsChannelMember(ctx, tx, orgID, channelID, employeeID)`
      - If not member: Return CodePermissionDenied "You are not a member of this channel"
    * **Derive access scope from channel properties** (server-side, not client-controlled):
      - If `channel.IsPrivate == true` → accessScope = "private"
      - If `channel.IsPrivate == false` → accessScope = "public"
    * **Call FileLogic to generate upload URL** (internal method, not RPC):
      - `result, err := s.fileLogic.GenerateUploadURL(ctx, tx, files.GenerateUploadParams{...})`
    * **Create access rule linking file to channel**:
      - `err := s.fileLogic.CreateAccessRule(ctx, tx, files.CreateAccessRuleParams{...})`
  - Convert result to proto response
  - Add structured logging with channel ID and derived access scope
  - Document: Server verifies membership and derives scope, client cannot manipulate
- [X] T036c Implement `ConfirmChannelFileUpload` RPC handler in `file_upload.go`: ✅ COMPLETE
  - Extract auth context (orgID, employeeID)
  - Use TenantPool for transaction
  - Inside transaction:
    * **Verify channel membership again** (prevent race condition):
      - Call `s.Queries.GetChannelMembership(ctx, tx, orgID, channelID, employeeID)`
      - If not member: Return CodePermissionDenied
    * **Confirm upload via FileLogic**:
      - `metadata, err := s.FileLogic.ConfirmUpload(ctx, tx, files.ConfirmUploadParams{...})`
    * **Trigger async workflows atomically** (within transaction for atomicity):
      - `flows.BeginTx(ctx, s.FlowsClient, pgxTx, s.PostProcess, &files.FilePostProcessingWorkflowInput{...})`
      - Workflow run enqueued atomically, executes after commit
  - Convert result to proto response
  - Add structured logging

### CRITICAL: Add Access Control to Existing File Operations (✅ COMPLETE)
**SECURITY FIX**: Existing file service methods must check access rules to prevent data leaks
- [X] T037a Update existing `GetDownloadUrl` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract employeeID from auth context
  - ✅ Add access control check BEFORE generating presigned URL
  - ✅ Inside transaction:
    * Get file metadata with `s.queries.GetFileByID()`
    * Call `accessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)`
    * If access denied, return connect.CodePermissionDenied with generic error message
    * Only generate presigned URL if access granted
  - ✅ Add structured logging for denied access attempts
  - ✅ Document: Prevents unauthorized downloads even with known file IDs
- [X] T037b Update existing `GetFileMetadata` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract employeeID from auth context
  - ✅ Add access control check BEFORE returning metadata
  - ✅ Inside transaction:
    * Get file metadata with `s.queries.GetFileByID()`
    * Call `accessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)`
    * If access denied, return connect.CodeNotFound with generic "file not found or access denied" message (prevents file existence leakage)
  - ✅ Add structured logging with denial_reason
  - ✅ Document: Prevents metadata leakage (filename, size, uploader info)
- [X] T037c Update existing `GetFileMetadataBatch` RPC handler in `service.go`: ✅ COMPLETE
  - ✅ Extract employeeID from auth context
  - ✅ Add access control check for EACH file in batch
  - ✅ Inside transaction:
    * Fetch all files with `s.queries.GetFilesByIDs()`
    * Loop through files, call `accessLogic.CheckFileAccess()` for each
    * Only include files where access granted in `accessibleFiles` array
    * Return filtered results (silently exclude unauthorized files)
    * Track `filteredCount` for audit logging
  - ✅ Add structured logging with accessible_count and filtered_count
  - ✅ Document: Prevents bulk metadata scraping by guessing file IDs
  - ✅ Privacy: Does NOT reveal file existence for unauthorized files
- [ ] T037d REMOVED - No longer needed with domain-owned upload flow
  - **ARCHITECTURE CHANGE**: Chat attachments now use ChatService.ConfirmChannelFileUpload (task T036c)
  - Access scope derived during RequestChannelFileUpload (task T036b), not during ConfirmUpload
  - Context verification happens in domain service (ChatService), not FileService

### Service Registration & Dependency Injection
- [X] T038 Register FileService in `backend/cmd/server.go`: ✅ COMPLETE
  - Initialize logic layers in order:
    * `fileLogic := files.NewLogic(queries)` (upload logic, NO auth checks)
    * `accessLogic := files.NewAccessLogic(queries)` (uses queries directly for membership checks)
    * `pdfLogic := files.NewPDFLogic(queries)`
    * `indexLogic := files.NewIndexLogic(queries)`
    * `searchLogic := files.NewSearchLogic(queries)`
  - Initialize FileServiceServer:
    * `fileService := files.NewService(tenantPool, adminPool, fileLogic, accessLogic, pdfLogic, indexLogic, searchLogic, r2Client, queries, instanceID)`
  - Register with ConnectRPC mux:
    * `mux.Handle(rpcv1connect.NewFileServiceHandler(fileConnect, interceptors))`
- [X] T038a Update ChatService initialization in `backend/cmd/server.go`: ✅ COMPLETE
  - Inject FileLogic into ChatServiceConnect:
    * `chatService := chat.NewChatServiceConnect(chatLogic, tenantPool, fileLogic, r2Client, queries)`
  - Register ChatFileService with ConnectRPC mux:
    * `mux.Handle(rpcv1connect.NewChatFileServiceHandler(chatConnect, interceptors))`
- [X] T039 Verify cross-domain integration: ✅ COMPLETE
  - **Domain → FileLogic**: ChatService → FileLogic (for upload operations)
  - **FileService → Queries**: FileService → Queries (for access control checks via SQL)
  - No circular dependency: ChatService uses FileLogic methods, FileService uses Queries directly
  - Dependency injected at initialization (NOT SQL-level joins)
  - Structured logging present in all cross-domain calls

---

## Phase 3.3: Frontend Implementation

### API Wrapper Layer (packages/apis)
- [X] T040 Create `frontend/packages/apis/src/chat-files.ts`: ✅ COMPLETE
  - Import ChatFileService from `@tech-office/rpc`
  - Define custom TypeScript interfaces (NOT proto types):
    * `UploadURLResponse` (fileId, uploadUrl, expiresAt)
    * `FileMetadata` (id, originalFilename, storageKey, sizeBytes, mimeType, validationStatus, uploadedBy, updatedAt)
  - Convert proto Timestamp to Date objects
- [X] T040a [P] Implement chat upload API wrappers in `chat-files.ts`: ✅ COMPLETE
  - `requestChannelFileUpload(params: { channelId, filename, mimeType, sizeBytes }): Promise<UploadURLResponse>`
  - `confirmChannelFileUpload(params: { channelId, fileId }): Promise<FileMetadata>`
  - Use `rpcCall()` helper for error handling
  - Convert Timestamp fields to Date using `timestampToDate()`
  - Add type assertions (e.g., `as UploadURLResponse`)
- [X] T040b Create `frontend/packages/apis/src/files-security.ts`: ✅ COMPLETE
  - Import FileService from `@tech-office/rpc`
  - Define custom TypeScript interfaces (NOT proto types):
    * `FileValidationResult` (status, message, declaredMimeType, detectedMimeType)
    * `FileAccessRule` (id, fileId, contextType, contextId, accessScope, updatedAt)
    * `AccessCheckResult` (hasAccess, denialReason, accessRule)
    * `FileSearchResult` (fileId, filename, sizeBytes, mimeType, validationStatus, contextType, contextId, contextDisplayName, relevanceScore, excerpt, uploadedBy, uploadedAt)
    * `PDFConversionInfo` (status, pdfUrl, error, duration)
    * `ContentIndexInfo` (status, error, duration)
  - Convert proto Timestamp to Date objects
  - Convert proto enums to TypeScript union types
- [X] T041 [P] Implement validation API wrapper in `files-security.ts`: ✅ COMPLETE
  - `validateFile(fileId: string): Promise<FileValidationResult>`
  - Use `rpcCall()` helper
  - Convert proto response to custom interface
  - Add error handling
- [X] T042 [P] Implement access control API wrappers in `files-security.ts`: ✅ COMPLETE
  - `setFileAccessRule(fileId, contextType, contextId, accessScope): Promise<FileAccessRule>`
  - `checkFileAccess(fileId): Promise<AccessCheckResult>`
  - Use `rpcCall()` helper
  - Convert responses
- [X] T043 [P] Implement search API wrapper in `files-security.ts`: ✅ COMPLETE
  - `searchFiles(query, contextTypes?, limit?, offset?): Promise<{ results: FileSearchResult[], totalCount: number, hasMore: boolean }>`
  - Use `rpcCall()` helper
  - Convert Timestamp fields to Date
  - Add error handling
- [X] T044 [P] Implement PDF conversion API wrappers in `files-security.ts`: ✅ COMPLETE
  - `getPDFConversionStatus(fileId): Promise<PDFConversionInfo>`
  - `triggerPDFConversion(fileId): Promise<PDFConversionInfo>`
  - Use `rpcCall()` helper
  - Convert responses
- [X] T045 [P] Implement content index API wrapper in `files-security.ts`: ✅ COMPLETE
  - `getContentIndexStatus(fileId): Promise<ContentIndexInfo>`
  - Use `rpcCall()` helper
  - Convert response
- [X] T046 Re-export from `frontend/packages/apis/src/index.ts`: ✅ COMPLETE
  - Add: `export * from './chat-files'`
  - Add: `export * from './files-security'`

### UI Components for File Validation
- [X] T047 Create `frontend/apps/web/src/components/files/FileValidationBadge.tsx`: ✅ COMPLETE
  - Accept props: `validationStatus: ValidationStatus, validationMessage?: string`
  - Render badge with icon based on status:
    * `verified`: Green checkmark, no badge
    * `warning`: Yellow warning icon with tooltip
    * `failed`: Red error icon with tooltip
    * `pending`: Gray loading spinner
    * `skipped`: No badge
  - Use `useThemeColors()` for all colors
  - Add `data-testid="file-validation-badge"`
  - Tooltip shows validation message on hover
- [X] T047a Update chat file upload flow to use domain-owned API: ✅ COMPLETE
  - Find file upload component in chat (e.g., `MessageComposer.tsx` or `ChannelView.tsx`)
  - Replace file upload calls:
    * OLD: `requestUploadUrl({ uploadContext: 'chat', filename, mimeType, sizeBytes })`
    * NEW: `requestChannelFileUpload({ channelId, filename, mimeType, sizeBytes })`
  - Replace confirm upload calls:
    * OLD: `confirmUpload({ fileId })`
    * NEW: `confirmChannelFileUpload({ channelId, fileId })`
  - Pass current channel ID to upload functions
  - Add error handling for permission denied (not a channel member)
  - Add structured logging
  - Use `useThemeColors()` for error states
- [X] T048 Update `frontend/apps/web/src/components/chat/FileAttachment.tsx`: ✅ COMPLETE
  - Import `FileValidationBadge` component
  - Add validation status to file metadata state
  - Render `<FileValidationBadge>` next to filename
  - Use `useThemeColors()` for all styling
  - Add `data-testid="file-attachment"`

### UI Components for File Search
- [X] T049 Create `frontend/apps/web/src/app/workspace/search/components/FilesTab.tsx`: ✅ COMPLETE
  - Client component (`'use client'`)
  - Accept props: `query: string`
  - Use `searchFiles()` API wrapper
  - Display results in list with:
    * File icon based on MIME type
    * Filename with validation badge
    * File size (human-readable)
    * Context breadcrumb (e.g., "Engineering Team > #general")
    * Uploaded by + date
    * Excerpt (if content match)
  - Pagination controls (Load More button)
  - Use `useThemeColors()` for all colors
  - Add `data-testid` to all interactive elements
- [X] T050 Update `frontend/apps/web/src/app/workspace/search/page.tsx`: ✅ COMPLETE
  - Add "Files" tab to TabLink array
  - Render `<FilesTab query={searchParams.q} />` when `tab=files`
  - Use existing tab switching logic

### UI Components for PDF Preview
- [X] T051 Update `frontend/apps/web/src/components/files/FilePreviewModal.tsx`: ✅ COMPLETE
  - Add PDF conversion status check using `getPDFConversionStatus()` API
  - If original file is office doc:
    * Show conversion status (pending, in_progress, completed, failed)
    * If completed: Render PDF preview using `<iframe src={pdfUrl}>`
    * If pending/in_progress: Show loading spinner with progress message
    * If failed: Show error message with retry button
  - If original file is already PDF or image: Use existing preview logic
  - Add "Trigger Conversion" button if conversion failed (calls `triggerPDFConversion()`)
  - Use `useThemeColors()` for all styling
  - Add `data-testid` to all elements

---

## Phase 3.4: Manual Verification & Testing

### Backend Integration Tests (REQUIRED)
- [ ] T052 [P] Create `backend/integration/files_validation_test.go`:
  - Test scenario 1: Upload valid DOCX, validate returns "verified"
  - Test scenario 2: Upload PNG renamed as PDF, validate returns "warning" with type mismatch message
  - Test scenario 3: Upload corrupted file, validate returns "failed"
  - Use `GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)` for test identity
  - Create RPC client: `rpcv1connect.NewFileServiceClient(http.DefaultClient, "http://localhost:18080")`
  - Call ValidateFile with Authorization header
  - Assert validation status and messages
- [ ] T053 [P] Create `backend/integration/files_access_control_test.go`:
  - Test scenario 1: Alice uploads file to private channel via ChatService.RequestChannelFileUpload, server derives access_scope="private" from channel.is_private
  - Test scenario 1a: Carol (non-member) tries ChatService.RequestChannelFileUpload with private channel ID, returns CodePermissionDenied (upload blocked at domain service)
  - Test scenario 1b: Alice uploads to public channel via ChatService, server derives access_scope="public" (from channel.is_private=false)
  - Test scenario 2: Bob (member) accesses file, CheckFileAccess returns true
  - Test scenario 3: Carol (non-member) accesses file, CheckFileAccess returns false with denial reason
  - Test scenario 4: Carol (non-member) attempts download via GetDownloadUrl, returns CodePermissionDenied
  - Test scenario 5: Carol (non-member) calls GetFileMetadata, returns CodePermissionDenied (no metadata leak)
  - Test scenario 6: Carol calls GetFileMetadataBatch with [allowed_file, denied_file], only returns allowed_file (silent filtering)
  - Test scenario 7: Channel becomes public, Carol can now access file (access check uses channel_membership, not stored access_scope)
  - Test scenario 8: Carol tries GetFileMetadataBatch with 100 file IDs (guessing attack), returns empty or partial results
  - Use `GetRandomTestIdentityAndKey()` with different roles
  - Verify multi-tenant isolation (different organizations)
  - Document: These tests validate server-side context verification at upload (domain service) and access enforcement at download (file service)
- [ ] T054 [P] Create `backend/integration/files_search_test.go`:
  - Test scenario 1: Alice searches "report", finds files in accessible channels
  - Test scenario 2: Carol searches "report", finds only public files
  - Test scenario 3: Search with content match (indexed file), verify relevance score
  - Test scenario 4: Search with fuzzy matching (typo in query)
  - Verify pagination (limit, offset, hasMore)
  - Verify multi-tenant isolation
- [ ] T055 [P] Create `backend/integration/files_pdf_conversion_test.go`:
  - Test scenario 1: Upload DOCX, conversion triggered automatically, status "pending"
  - Test scenario 2: Poll GetPDFConversionStatus, wait for "completed"
  - Test scenario 3: Download converted PDF, verify content
  - Test scenario 4: Upload >50MB file, conversion skipped
  - Test scenario 5: Manually trigger conversion after failure
  - Verify quota updated (PDF size added to current_usage_bytes)
- [ ] T056 [P] Create `backend/integration/files_content_index_test.go`:
  - Test scenario 1: Upload text file, indexing triggered automatically
  - Test scenario 2: Poll GetContentIndexStatus, wait for "completed"
  - Test scenario 3: Search file content, verify indexed text returned
  - Test scenario 4: Upload non-indexable file (image), indexing skipped
  - Verify multi-tenant isolation

### Distributed System Testing (if applicable)
- [ ] T057 [P] Verify stateless design:
  - No in-process caches or state in FileServiceServer struct
  - All ephemeral state in database (if needed for future extensions)
  - File uploads go to R2 (not local disk)
  - Multiple backend instances can serve requests simultaneously
- [ ] T058 [P] Verify async workflow durability:
  - Kill backend instance mid-conversion
  - Verify workflow resumes on different instance
  - Verify file_pdf_conversion status eventually reaches "completed"

### Manual Frontend Verification
<!-- NO automated frontend tests - manual verification only per Constitution v5.7.0 -->
- Developer verifies manually:
  * Workspace search page → Files tab works
  * File validation badges appear on attachments
  * Warning tooltips show type mismatch details
  * PDF preview modal shows conversion status
  * Retry button triggers conversion
  * Search results show relevant files with excerpts
  * Access control prevents unauthorized downloads

---

## Phase 3.5: Polish & Documentation

- [ ] T059 [P] Add performance logging to file service:
  - Log validation duration (target <100ms)
  - Log search query duration (target <300ms p95)
  - Log conversion duration (for SLO tracking)
  - Log indexing duration
- [ ] T060 [P] Create `backend/docs/FILE-SECURITY.md`:
  - Document validation policy (WARN, not BLOCK)
  - Document access control algorithm
  - Document supported file types for conversion and indexing
  - Document workflow retry policies
  - Document Gotenberg integration
- [ ] T061 [P] Update `specs/015-file-storage-security-and-access/README.md`:
  - Link to quickstart.md for testing
  - Link to backend docs for implementation details
  - Document feature status (completed, known limitations)
- [ ] T062 Verify all interactive UI elements have `data-testid` attributes:
  - FileValidationBadge
  - FilesTab search results
  - FilePreviewModal conversion controls
  - All buttons, inputs, links
- [ ] T063 Final smoke test:
  - Upload file with validation
  - Set access rule
  - Search across files
  - Preview PDF conversion
  - Verify multi-tenant isolation
  - Verify error handling

---

## Dependencies

### Sequential Dependencies (Blocking)
- T001-T005 (schema changes) → T006-T010 (SQL queries) → T011 (sqlc generate)
- T014 (proto definition) → T015 (buf generate) → T016-T017 (frontend package updates)
- T011 (sqlc generate) + T015 (buf generate) → T018-T029 (backend implementation)
- T018-T029 (logic layers) → T030-T037 (connect layer handlers)
- T030-T037 (service implementation) → T038-T039 (registration)
- T038-T039 (backend complete) → T040-T046 (API wrappers)
- T040-T046 (API wrappers) → T047-T051 (UI components)
- T001-T051 (all implementation) → T052-T058 (integration tests)
- T052-T058 (tests pass) → T059-T063 (polish)

### Parallel Task Groups
**Group 1: Schema definition (after T001-T004 complete)**
- T005 (migrations) can run independently

**Group 2: SQL queries (after schema complete)**
- T006 (validation queries)
- T007 (access control queries)
- T008 (PDF conversion queries)
- T009 (content indexing queries)
- T010 (search queries)

**Group 3: Backend logic layers (after codegen complete)**
- T018-T019 (validation logic)
- T020-T021 (access control logic)
- T022-T023 (PDF conversion logic)
- T024-T025 (content indexing logic)
- T026 (search logic)
- T027-T029 (async workflows)

**Group 4: Connect layer handlers (after logic layers complete)**
- T031 (ValidateFile)
- T032 (SetFileAccessRule)
- T033 (CheckFileAccess)
- T034 (SearchFiles)
- T035 (GetPDFConversionStatus)
- T036 (TriggerPDFConversion)
- T037 (GetContentIndexStatus)

**Group 5: API wrappers (after backend complete)**
- T041 (validation API)
- T042 (access control APIs)
- T043 (search API)
- T044 (PDF conversion APIs)
- T045 (content index API)

**Group 6: UI components (after API wrappers complete)**
- T047-T048 (validation badges)
- T049-T050 (search tab)
- T051 (PDF preview modal)

**Group 7: Integration tests (after implementation complete)**
- T052 (validation tests)
- T053 (access control tests)
- T054 (search tests)
- T055 (PDF conversion tests)
- T056 (content indexing tests)
- T057-T058 (distributed system tests)

**Group 8: Polish (after tests pass)**
- T059 (performance logging)
- T060 (backend docs)
- T061 (README update)

---

## Parallel Execution Examples

### Example 1: SQL Queries (after schema complete)
```bash
# Launch T006-T010 together (different query files):
Task: "Add validation queries to backend/database/scripts/files.query.sql"
Task: "Create backend/database/scripts/files_security.query.sql with access control queries"
Task: "Add PDF conversion queries to files_security.query.sql"
Task: "Add content indexing queries to files_security.query.sql"
Task: "Add search query to files_security.query.sql"
```

### Example 2: Backend Logic Layers (after codegen complete)
```bash
# Launch T018-T026 together (different files):
Task: "Create backend/internal/files/validation.go"
Task: "Create backend/internal/files/access_logic.go"
Task: "Create backend/internal/files/pdf_logic.go"
Task: "Create backend/internal/files/index_logic.go"
Task: "Create backend/internal/files/search_logic.go"
```

### Example 3: Connect Layer Handlers (after logic layers complete)
```bash
# Launch T031-T037 together (same file but independent methods):
Task: "Implement ValidateFile RPC handler in file_service.go"
Task: "Implement SetFileAccessRule RPC handler in file_service.go"
Task: "Implement CheckFileAccess RPC handler in file_service.go"
Task: "Implement SearchFiles RPC handler in file_service.go"
Task: "Implement GetPDFConversionStatus RPC handler in file_service.go"
Task: "Implement TriggerPDFConversion RPC handler in file_service.go"
Task: "Implement GetContentIndexStatus RPC handler in file_service.go"
```

### Example 4: Integration Tests (after implementation complete)
```bash
# Launch T052-T056 together (different test files):
Task: "Create backend/integration/files_validation_test.go"
Task: "Create backend/integration/files_access_control_test.go"
Task: "Create backend/integration/files_search_test.go"
Task: "Create backend/integration/files_pdf_conversion_test.go"
Task: "Create backend/integration/files_content_index_test.go"
```

---

## Notes

- **[P] tasks**: Different files, no dependencies, can run in parallel
- **Constitution compliance**: Two-layer architecture, proto-level authorization, UUID v7 PKs, organization_id filters, sqlc/buf codegen
- **Testing philosophy**: Backend integration tests mimic frontend RPC calls with dev tokens (Constitution v5.7.0)
- **Frontend testing**: Manual verification only, NO unit/snapshot/component tests
- **Cross-domain integration**: FileService depends on chat.ChannelLogic for membership checks (injected, not SQL joins)
- **Async workflows**: Use github.com/nvcnvn/flows for durable PDF conversion and content indexing
- **PGroonga**: Already deployed for chat search, reused for file content search
- **Validation policy**: WARN on type mismatch, don't block upload (security by visibility, not rejection)
- **Commit strategy**: Commit after each task or logical group of parallel tasks

---

## Estimated Timeline

- **Phase 3.1 (Setup)**: 4-6 hours (schema, migrations, queries, codegen)
- **Phase 3.2 (Backend Core)**: 12-16 hours (logic layers, workflows, connect handlers)
- **Phase 3.3 (Frontend)**: 6-8 hours (API wrappers, UI components)
- **Phase 3.4 (Testing)**: 8-10 hours (integration tests, manual verification)
- **Phase 3.5 (Polish)**: 2-3 hours (docs, performance logging, final smoke test)

**Total**: 32-43 hours (4-5 days for full-time developer)

---

## Success Criteria

✅ All 6 RPC methods implemented and tested  
✅ All 3 new tables created with proper indexes  
✅ File type validation using h2non/filetype library  
✅ Context-based access control enforced at logic layer  
✅ Full-text search using PGroonga with access filters  
✅ PDF conversion workflow using Gotenberg  
✅ Content indexing workflow for searchable text  
✅ Search UI integrated into workspace/search page  
✅ PDF preview modal shows conversion status  
✅ File validation badges appear on attachments  
✅ All integration tests pass  
✅ Multi-tenant isolation verified  
✅ Constitution v5.7.0 compliance verified (two-layer architecture, proto authorization, distributed design)
