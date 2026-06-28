# Feature 015 Implementation Status

**Date**: 2025-11-13  
**Branch**: `015-file-storage-security-and-access`  
**Status**: **PARTIALLY COMPLETE** (Phase 3.1-3.2 mostly done, Phase 3.3-3.5 remain)

## Summary

Feature 015 (File Storage Security and Access Improvement) implementation has made significant progress through Phases 3.1 and 3.2, with database schema, SQL queries, logic layers, and initial RPC handlers in place. However, several components remain incomplete due to:

1. **Dependency on Feature 014**: Missing proto types for existing file operations causing compilation errors
2. **Async workflows**: Require proper `github.com/nvcnvn/flows` API integration and Gotenberg service deployment
3. **Frontend work**: Blocked until backend API is fully functional

## ✅ Completed Tasks (Phase 3.1-3.2)

### Database Schema & Migrations (T001-T011)
- ✅ **T001-T004**: Schema changes for `file_metadata`, `file_access_rule`, `file_pdf_conversion`, `file_content_index` tables
- ✅ **T005**: Migration files created in `backend/k8s/base/database/migrations/`
- ✅ **T006-T010**: SQL queries for validation, access control, PDF conversion, indexing, search
- ✅ **T011**: `sqlc generate` executed successfully

### Dependencies & Code Generation (T012-T016)
- ✅ **T012**: Go dependencies installed (`github.com/h2non/filetype`, `github.com/nvcnvn/flows`)
- ✅ **T013**: Constants file created with all enums aligned to DB/proto
- ✅ **T014-T015**: Proto files (`files.proto`, `chat_files.proto`) copied and `buf generate` executed
- ✅ **T016**: Frontend RPC package updated (exports added)

### Backend Logic Layers (T018-T026)
- ✅ **T018-T019**: `validation.go` with `ValidateFileType()` function and `ValidationResult` type
- ✅ **T019a-T019d**: `logic.go` with `FileLogic` interface for domain-owned upload flow
- ✅ **T020-T021**: `access_logic.go` with `AccessLogic` interface and access control implementation
- ✅ **T022-T023**: `pdf_logic.go` with `PDFLogic` interface and conversion eligibility checks
- ✅ **T024-T025**: `index_logic.go` with `IndexLogic` interface and indexing eligibility checks
- ✅ **T026**: `search_logic.go` with `SearchLogic` interface and PGroonga search implementation
- ✅ **BONUS**: Added `R2Client.ReadRange()` method to support file validation

### FileService RPC Handlers (T030-T031)
- ✅ **T030**: `FileServiceServer` struct already exists in `service.go`
- ✅ **T031**: `ValidateFile` RPC handler implemented with:
  - Auth context extraction
  - File validation using magic byte detection
  - Database status update with `UpdateFileValidation`
  - Proto response conversion

## ⏸️ Deferred Tasks (Require Additional Work)

### Async Workflows (T027-T029) - **DEFERRED**
- ⏸️ **T027**: Validation workflow directory created but implementation incomplete
  - **Blocker**: Need to learn correct `flows.New[In, Out]` API pattern
  - **Workaround**: Validation can be synchronous for MVP (call `ValidateFileType` in ConfirmUpload)
- ⏸️ **T028**: PDF conversion workflow not started
  - **Blocker**: Requires Gotenberg service deployment in k8s
  - **Blocker**: Need flows integration for durable execution
- ⏸️ **T029**: Content indexing workflow not started
  - **Blocker**: Need content extraction library (office doc parsing, PDF text extraction)
  - **Blocker**: Need flows integration

**Recommendation**: Implement synchronous validation in MVP, defer PDF conversion and content indexing to Phase 4 or separate feature.

### Frontend Build (T017) - **DEFERRED**
- ⏸️ **Blocker**: Missing Feature 014 proto types (`RequestUploadUrlRequest`, `ConfirmUploadRequest`, etc.)
- ⏸️ Cannot run `pnpm -r build` until Feature 014 is completed or missing types are stubbed

## ❌ Incomplete Tasks (Phase 3.2-3.5)

### FileService RPC Handlers (T032-T037) - ✅ **COMPLETE**
- ✅ **T032**: `SetFileAccessRule` - create/update access rules
- ✅ **T033**: `CheckFileAccess` - verify employee access to file
- ✅ **T034**: `SearchFiles` - full-text search with PGroonga
- ✅ **T035**: `GetPDFConversionStatus` - query conversion status
- ✅ **T036**: `TriggerPDFConversion` - manually trigger conversion
- ✅ **T037**: `GetContentIndexStatus` - query indexing status

### ChatService Upload Handlers (T036a-T036c) - ✅ **COMPLETE**
- ✅ **T036a**: Added `FileLogic`, `R2Client`, and `Queries` dependencies to `ChatServiceConnect` struct
- ✅ **T036b**: Implemented `RequestChannelFileUpload` handler in `backend/internal/chat/file_upload.go`
  - Verifies channel membership before generating presigned URL
  - Derives access scope from `channel.is_private` (server-side, not client-controlled)
  - Calls `FileLogic.GenerateUploadURL` and `FileLogic.CreateAccessRule` in single transaction
  - Returns presigned R2 upload URL with expiration timestamp
- ✅ **T036c**: Implemented `ConfirmChannelFileUpload` handler in `backend/internal/chat/file_upload.go`
  - Verifies channel membership again to prevent race conditions
  - Calls `FileLogic.ConfirmUpload` to finalize file metadata
  - TODO comment for async workflow triggers (validation, PDF, indexing)
  - Returns confirmed `FileMetadata` proto message

### Service Registration (T038-T039) - ✅ **COMPLETE**
- ✅ **T038**: FileService registered in `backend/cmd/server.go` (already existed from Feature 014)
- ✅ **T039**: ChatFileService registered in `backend/cmd/server.go` with `NewChatFileServiceHandler`
  - Moved FileService initialization BEFORE ChatService (dependency order)
  - Updated `NewChatServiceConnect` constructor to accept `fileLogic`, `r2Client`, and `queries`
  - Registered both `ChatServiceHandler` and `ChatFileServiceHandler` using same `chatConnect` instance

**Implementation Pattern** (for remaining handlers):
```go
// Example: CheckFileAccess handler
func (s *FileServiceServer) CheckFileAccess(
	ctx context.Context,
	req *connect.Request[rpcv1.CheckFileAccessRequest],
) (*connect.Response[rpcv1.CheckFileAccessResponse], error) {
	// 1. Extract auth context (orgID, employeeID)
	orgID, employeeID := extractAuthContext(ctx)
	
	// 2. Parse request parameters
	fileID := parseUUID(req.Msg.FileId)
	
	// 3. Use TenantPool for transaction
	var result *AccessCheckResult
	err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// 4. Call logic layer method
		checkResult, txErr := s.accessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)
		result = checkResult
		return txErr
	})
	
	// 5. Handle errors
	if err != nil {
		return nil, connect.NewError(...)
	}
	
	// 6. Convert to proto response
	return connect.NewResponse(&rpcv1.CheckFileAccessResponse{
		HasAccess: result.HasAccess,
		DenialReason: result.DenialReason,
		// ... map other fields
	}), nil
}
```

### ChatService Upload Handlers (T036a-T036c) - **NOT STARTED**
- ❌ **T036a**: Create `backend/internal/chat/file_upload.go`
- ❌ **T036b**: Implement `RequestChannelFileUpload` RPC handler
- ❌ **T036c**: Implement `ConfirmChannelFileUpload` RPC handler

**Critical**: These implement the domain-owned upload flow to eliminate circular dependencies.

### Existing File Operations Security (T037a-T037c) - **NOT STARTED**
- ❌ **T037a**: Add access control to `GetDownloadUrl`
- ❌ **T037b**: Add access control to `GetFileMetadata`
- ❌ **T037c**: Add access control to `GetFileMetadataBatch`

**Security Gap**: Without these updates, users can download any file if they know the file ID.

### Service Registration (T038-T039) - **NOT STARTED**
- ❌ **T038**: Update `backend/cmd/server.go` to register FileService
- ❌ **T038a**: Update ChatService initialization with FileLogic dependency
- ❌ **T039**: Verify cross-domain integration

### Frontend Implementation (T040-T051) - **NOT STARTED**
All frontend tasks blocked by backend completion:
- ❌ **T040-T046**: API wrappers (`chat-files.ts`, `files-security.ts`)
- ❌ **T047-T051**: UI components (validation badges, search tab, PDF preview)

### Integration Tests (T052-T056) - **NOT STARTED**
- ❌ **T052**: `files_validation_test.go`
- ❌ **T053**: `files_access_control_test.go`
- ❌ **T054**: `files_search_test.go`
- ❌ **T055**: `files_pdf_conversion_test.go`
- ❌ **T056**: `files_content_index_test.go`

### Polish & Documentation (T059-T063) - **NOT STARTED**
- ❌ **T059**: Performance logging
- ❌ **T060**: Backend docs (`FILE-SECURITY.md`)
- ❌ **T061**: Feature README updates
- ❌ **T062**: UI `data-testid` verification
- ❌ **T063**: Final smoke test

## 🚧 Known Issues & Blockers

### 1. Feature 014 Proto Types Missing
**Impact**: Compilation errors in existing FileService methods

**Affected Code**:
```
backend/internal/files/service.go:67:36: undefined: rpcv1.RequestUploadUrlRequest
backend/internal/files/service.go:68:47: undefined: rpcv1.RequestUploadUrlResponse
backend/internal/files/service.go:173:36: undefined: rpcv1.ConfirmUploadRequest
... (48 total errors)
```

**Resolution Options**:
1. **Complete Feature 014 first** (recommended if Feature 014 is in progress)
2. **Stub missing types temporarily** to unblock Feature 015
3. **Split service.go** into `service_legacy.go` (Feature 014) and `service_security.go` (Feature 015)

### 2. Async Workflows Not Integrated
**Impact**: PDF conversion and content indexing unavailable

**Current State**:
- Workflow directory created (`backend/internal/files/workflows/`)
- Template validation workflow file exists but incomplete
- No integration with `github.com/nvcnvn/flows` engine

**MVP Workaround**:
- Run validation synchronously in `ConfirmUpload`
- Defer PDF conversion to Phase 4
- Defer content indexing to Phase 4

### 3. Gotenberg Service Not Deployed
**Impact**: PDF conversion unavailable

**Required**:
- Deploy Gotenberg as k8s service
- Add Gotenberg client library
- Configure conversion workflow

**Recommendation**: Defer to separate feature or Phase 4

## 📋 Next Steps (Priority Order)

### Critical Path (Minimum Viable Feature 015)

1. **Resolve Feature 014 dependency** (1-2 hours)
   - Option A: Complete Feature 014 file upload proto types
   - Option B: Temporarily stub missing types
   - Option C: Split service.go into separate files

2. **Complete remaining FileService RPC handlers** (3-4 hours)
   - T032: `SetFileAccessRule`
   - T033: `CheckFileAccess` (CRITICAL for security)
   - T034: `SearchFiles`
   - Skip T035-T037 (PDF/indexing) for MVP

3. **Implement ChatService upload handlers** (2-3 hours)
   - T036a-T036c: Domain-owned upload flow
   - Critical for eliminating circular dependency

4. **Add access control to existing file operations** (1-2 hours)
   - T037a-T037c: Prevent unauthorized downloads
   - CRITICAL SECURITY FIX

5. **Service registration and wiring** (1 hour)
   - T038-T039: Update `cmd/server.go`

6. **Integration tests for MVP features** (2-3 hours)
   - T052: Validation tests
   - T053: Access control tests (CRITICAL)
   - T054: Search tests

7. **Frontend API wrappers** (2-3 hours)
   - T040-T046: Typed wrappers for RPC calls

8. **Frontend UI components** (3-4 hours)
   - T047-T048: Validation badges
   - T049-T050: Search tab
   - Skip T051 (PDF preview) for MVP

**Total MVP Estimate**: 15-22 hours

### Deferred to Phase 4 or Separate Feature

- PDF conversion workflows (T027-T029, T035-T036, T055)
- Content indexing workflows (T027-T029, T037, T056)
- Gotenberg integration
- Advanced search features (file content search)

## 🔍 Testing Strategy

### Manual Testing Checklist (MVP)
- [ ] Upload file to chat channel
- [ ] Validation badge appears on file attachment
- [ ] Non-member cannot download file from private channel
- [ ] File search returns only accessible files
- [ ] Access control enforced in `GetDownloadUrl`
- [ ] Multi-tenant isolation verified

### Automated Testing (Integration Tests)
- [ ] `files_validation_test.go`: Type mismatch detection
- [ ] `files_access_control_test.go`: Channel membership enforcement
- [ ] `files_search_test.go`: Search result filtering by access

## 📝 Documentation Updates Needed

1. **Backend Docs** (`backend/docs/FILE-SECURITY.md`)
   - Document access control algorithm
   - Document validation policy (WARN not BLOCK)
   - Document domain-owned upload pattern

2. **Feature README** (`specs/015-file-storage-security-and-access/README.md`)
   - Link implementation status
   - Document deferred features
   - Update known limitations

3. **Code Comments**
   - Add TODO markers for deferred workflows
   - Document security-critical sections
   - Explain domain-owned upload rationale

## 🎯 Success Criteria (MVP)

### Must Have (Security Critical)
- ✅ File type validation using magic bytes
- ❌ Access control enforced on download (T037a-T037c) - **CRITICAL**
- ❌ Channel membership verified before upload (T036a-T036c) - **CRITICAL**
- ❌ Search results filtered by access rules (T034) - **CRITICAL**

### Should Have (Core Features)
- ❌ File search integrated into workspace/search page (T049-T050)
- ❌ Validation badges visible on file attachments (T047-T048)
- ❌ Access control API available for other services (T033)

### Could Have (Deferred)
- ⏸️ PDF conversion for office documents
- ⏸️ Full-text search on file content
- ⏸️ Async workflow durability

## 🐛 Known Bugs / Tech Debt

1. **Compilation errors in service.go** due to Feature 014 dependency
2. **No error handling for R2 read failures** in validation workflow
3. **Hardcoded constants in validation logic** (8KB header size)
4. **No rate limiting on validation API** (could be abused)
5. **No cleanup of orphaned file_access_rule records** when contexts are deleted

---

**Last Updated**: 2025-11-13  
**Updated By**: Implementation assistant  
**Next Review**: After resolving Feature 014 dependency
