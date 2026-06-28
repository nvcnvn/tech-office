# Refactor Summary: Domain-Owned Upload Flow

**Date**: 2025-11-12  
**Refactor Type**: Full architectural refactor (Option A)  
**Status**: Design documents updated, ready for implementation

---

## Changes Made

### 1. Created New Documents

#### ARCHITECTURE-REFACTOR.md
- Comprehensive explanation of domain-owned upload pattern
- Detailed problem statement (circular dependency)
- Architecture diagrams showing flow
- Example implementation code for ChatService upload handlers
- Benefits analysis (security, architecture, maintainability)
- Migration impact assessment
- Timeline and future extensions roadmap

### 2. Updated Existing Documents

#### plan.md
- Added critical architectural decision section in Summary
- Referenced ARCHITECTURE-REFACTOR.md for full rationale
- Updated Cross-Domain Integration Checks to document:
  * ChatService depends on FileLogic (logic layer), NOT FileService (connect layer)
  * FileService depends on ChatLogic (logic layer) for access checks
  * No circular dependency because different service layers
  * Explicitly documented domain-owned upload flow

#### research.md
- Completely rewrote "Context-Based Access Control Architecture" section
- Replaced FileService-centric approach with domain-owned pattern
- Added architecture diagram showing flow:
  ```
  Client → ChatService.RequestChannelFileUpload
    → ChatService verifies membership & derives access_scope
    → Calls FileLogic.GenerateUploadURL() internally
    → Database + R2
  ```
- Updated cross-domain integration explanation
- Documented why FileService no longer provides context-based upload RPCs

#### data-model.md
- Added "ARCHITECTURE NOTE - Domain-Owned Upload Pattern" to Overview
- Updated table comments explaining server-side control:
  * `file_access_rule.context_type`: "Set by domain service, NOT client-controlled"
  * `file_access_rule.access_scope`: "Derived from context properties, NOT client-controlled"
- Referenced ARCHITECTURE-REFACTOR.md

### 3. Updated Proto Contracts

#### contracts/files.proto
- Added comprehensive architecture comment explaining:
  * FileService DOES NOT provide context-based upload RPCs
  * Domain services own their upload flows (ChatFileService, DocsService, etc.)
  * FileService ONLY provides avatar upload (simplified flow, no context)
- Existing RPCs unchanged: ValidateFile, SetFileAccessRule, CheckFileAccess, SearchFiles, PDF/indexing RPCs

#### contracts/chat_files.proto (NEW)
- Created new proto file for chat-specific file operations
- 2 RPC methods:
  * `RequestChannelFileUpload` - Server verifies membership, derives access_scope from channel.is_private
  * `ConfirmChannelFileUpload` - Finalizes upload and triggers async workflows
- Architecture comments explaining why ChatService owns upload flow
- All `access_control` options with explicit `allowed_roles`

### 4. Updated Tasks (tasks.md)

#### Execution Flow Section
- Updated to reflect domain-owned architecture decision
- Noted contracts include chat_files.proto (2 new RPCs)
- Added architectural refactor step to flow

#### Phase 3.1: Setup & Dependencies
- **T014a [NEW]**: Copy chat_files.proto to backend/rpc/v1/
- **T015**: Updated to generate code for both files.proto and chat_files.proto
- **T016**: Updated to re-export both FileService and ChatFileService
- **T017**: No changes

#### Phase 3.2: Core Implementation (Backend)
- **T019a-T019d [NEW]**: FileLogic interface and methods
  * `GenerateUploadURL()` - Internal method (NO auth checks, trusts caller)
  * `ConfirmUpload()` - Internal method
  * `CreateAccessRule()` - Internal method
  * Called by domain services (ChatService), NOT exposed as RPC
- **T036a [NEW]**: Create `backend/internal/chat/file_upload.go`
- **T036b [NEW]**: Implement `RequestChannelFileUpload` RPC handler
  * Verify channel membership
  * Derive access_scope from channel.is_private
  * Call FileLogic.GenerateUploadURL()
  * Call FileLogic.CreateAccessRule()
- **T036c [NEW]**: Implement `ConfirmChannelFileUpload` RPC handler
  * Verify membership again (race condition protection)
  * Call FileLogic.ConfirmUpload()
  * Trigger async workflows
- **T037d**: Marked as REMOVED
  * No longer needed with domain-owned upload flow
  * Access scope derived during RequestChannelFileUpload (T036b)

#### Service Registration & Dependency Injection
- **T038**: Updated to initialize FileLogic first
- **T038a [NEW]**: Update ChatService initialization
  * Inject FileLogic into ChatServiceServer
  * Register ChatFileService with ConnectRPC mux
- **T039**: Updated to document cross-domain integration
  * ChatService → FileLogic (upload operations)
  * FileService → ChatLogic (access checks)
  * No circular dependency (different layers)

#### Phase 3.3: Frontend Implementation
- **T040**: Renamed to create `chat-files.ts` (chat upload API wrappers)
- **T040a [NEW]**: Implement chat upload API wrappers
  * `requestChannelFileUpload()`
  * `confirmChannelFileUpload()`
- **T040b**: Renamed from T040, create `files-security.ts` (validation, search, PDF)
- **T046**: Updated to re-export both `chat-files` and `files-security`
- **T047a [NEW]**: Update chat file upload flow to use domain-owned API
  * Replace `requestUploadUrl()` with `requestChannelFileUpload()`
  * Pass channel ID to upload functions

#### Phase 3.4: Integration Tests
- **T053**: Updated test scenarios to reflect new upload flow
  * Test ChatService.RequestChannelFileUpload (not FileService.RequestUploadUrl)
  * Test server-side access_scope derivation from channel.is_private
  * Test upload blocked for non-members at domain service layer

---

## Architecture Benefits

### Security Improvements
✅ Server verifies context ownership (channel membership) BEFORE generating upload URL
✅ Access scope derived from context properties (channel.is_private), not client-controlled
✅ No way for client to upload files to unauthorized contexts
✅ Upload and access control logic separated cleanly

### Architectural Improvements
✅ Eliminates circular dependency (ChatService → FileLogic, FileService → ChatLogic - different layers)
✅ Clear ownership model: domain services own their upload flows
✅ FileLogic becomes shared utility, no business logic about contexts
✅ Constitutional compliance: Principle IV (cross-domain integration via logic layers)

### Maintainability Improvements
✅ Domain-specific upload logic lives in domain service (easier to find and maintain)
✅ File validation/conversion/indexing remains centralized in FileService
✅ Clear separation: upload = domain-owned, processing = file-owned
✅ Easier to add new contexts (DocsService, ProjectService) without changing FileService

---

## Migration Checklist

### Before Implementation
- [x] Update all design documents (plan, research, data-model)
- [x] Create ARCHITECTURE-REFACTOR.md
- [x] Update proto contracts (files.proto, create chat_files.proto)
- [x] Update tasks.md with new task breakdown

### During Implementation (Phase 3)
- [ ] Implement FileLogic methods (T019a-T019d)
- [ ] Implement ChatService upload handlers (T036a-T036c)
- [ ] Update frontend API wrappers (T040, T040a, T040b)
- [ ] Update frontend upload flow (T047a)
- [ ] Write integration tests (T053)

### Post-Implementation
- [ ] Remove old FileService upload RPCs (if any existed)
- [ ] Update documentation
- [ ] Deploy to dev environment
- [ ] Manual verification
- [ ] Deploy to production

---

## Files Modified

1. **Created**:
   - `/specs/015-file-storage-security-and-access/ARCHITECTURE-REFACTOR.md`
   - `/specs/015-file-storage-security-and-access/contracts/chat_files.proto`

2. **Updated**:
   - `/specs/015-file-storage-security-and-access/plan.md`
   - `/specs/015-file-storage-security-and-access/research.md`
   - `/specs/015-file-storage-security-and-access/data-model.md`
   - `/specs/015-file-storage-security-and-access/contracts/files.proto`
   - `/specs/015-file-storage-security-and-access/tasks.md`

---

## Next Steps

1. **Review** all updated documents with team
2. **Validate** architectural decision aligns with project goals
3. **Begin implementation** following tasks.md breakdown
4. **Monitor** for any unforeseen issues during implementation
5. **Update** ARCHITECTURE-REFACTOR.md if implementation reveals better approaches

---

## Success Criteria

- ✅ No circular dependencies between services
- ✅ All upload context verification happens server-side
- ✅ Access scope derived from context properties, never client-controlled
- ✅ Integration tests pass for all security scenarios
- ✅ Manual frontend verification confirms proper upload flow
- ✅ Constitutional compliance verified (Principle IV)
