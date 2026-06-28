# Tasks: Employee Import Feature

**Input**: Design documents from `/specs/003-feature-import-employees/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/
**Branch**: `003-feature-import-employees`

## Overview

This task list implements the Employee Import feature, enabling organization owners to bulk import employees (up to 100 per batch) via UI form or .xlsx file upload. The implementation follows a two-step process: (1) data entry/validation with comprehensive error reporting and duplicate detection, and (2) preview/confirmation before creating identity records and Zitadel user accounts.

**Key Technical Decisions**:
- **No schema changes**: Reuses existing `iam.identity` and `iam.identity_role` tables
- **Individual transactions**: Each employee processed in separate goroutine with individual Zitadel API call
- **Partial success**: Support partial import with detailed per-employee results
- **Excel parsing**: Backend uses `excelize`, frontend uses SheetJS `xlsx`
- **RBAC**: Owner role only (enforced via proto access_control)

## Phase 3.1: Setup & Dependencies

### Backend Setup
- [X] **T001** Add `github.com/xuri/excelize/v2` dependency to `backend/go.mod`
  - Run: `cd backend && go get github.com/xuri/excelize/v2@latest`
  - Purpose: .xlsx file parsing on server-side
  - Commit after successful installation

### Frontend Setup  
- [X] **T002** [P] Add `xlsx` (SheetJS) dependency to `frontend/apps/web/package.json`
  - Run: `cd frontend && pnpm add xlsx -w --filter web`
  - Purpose: Client-side .xlsx parsing for preview
  - Commit after successful installation

- [X] **T003** [P] Verify MUI components available in `frontend/apps/web`
  - Check: `@mui/material`, `@mui/icons-material` already in dependencies
  - No action needed if present (already installed per tech stack)

## Phase 3.2: Database & Generated Code

### SQL Queries
- [X] **T004** Add employee import queries to `backend/database/scripts/iam.query.sql`
  - Copy queries from `specs/003-feature-import-employees/contracts/iam.query.sql`
  - Queries to add:
    - `CheckDuplicateEmailsBatch` (duplicate detection)
    - `CheckSingleEmailExists` (inline validation)
    - `CreateIdentityBatch` (:copyfrom for batch insert)
    - `CreateIdentityRoleBatch` (:copyfrom for role assignment)
    - `GetIdentityByID` (verification)
    - `GetIdentitiesByIDs` (batch verification)
    - `GetIdentityRolesByIdentityIDs` (role verification)
    - `CountIdentitiesByOrganization` (stats)
    - `CountEmployeesByOrganization` (stats)
  - File: `backend/database/scripts/iam.query.sql`
  - Commit with message: "feat: Add employee import SQL queries"

- [X] **T005** Generate sqlc code from new queries
  - Run: `cd backend && sqlc generate`
  - Verify: New methods added to `backend/database/iam.query.sql.go`
  - Verify: Any new types added to `backend/database/models.go`
  - Commit generated files with message: "chore: Generate sqlc code for employee import"
  - **Blocks**: T010-T014 (service implementation needs generated code)

### Protocol Buffers
- [X] **T006** Add employee import methods to `backend/rpc/v1/iam.proto`
  - Copy message definitions and method signatures from `specs/003-feature-import-employees/contracts/iam_employee_import.proto`
  - Add to existing `IAMService`:
    - `ParseEmployeeFile` method
    - `PreviewEmployeeImport` method
    - `ExecuteEmployeeImport` method
  - Add message types:
    - `EmployeeData`
    - `ParseEmployeeFileRequest/Response`
    - `PreviewEmployeeImportRequest/Response`
    - `ExecuteEmployeeImportRequest/Response`
    - `EmployeePreviewItem`
    - `EmployeeImportResult`
    - `ImportStats`
    - `ErrorCode` enum
  - Include `access_control` options: `allowed_roles: [ROLE_OWNER, ROLE_OPERATOR]`
  - File: `backend/rpc/v1/iam.proto`
  - Commit with message: "feat: Add employee import RPC methods to IAM service"

- [X] **T007** Generate backend proto code
  - Run: `cd backend && buf generate`
  - Verify: New methods added to `backend/rpc/v1/iam.pb.go` and `backend/rpc/v1/rpcv1connect/`
  - Commit generated files with message: "chore: Generate proto code for employee import"
  - **Blocks**: T010-T014 (service implementation needs generated proto code)

### Frontend RPC Client Setup
- [X] **T008** Re-export employee import types from `frontend/packages/rpc/index.ts`
  - Add exports for:
    - `EmployeeData`
    - `ParseEmployeeFileRequest/Response`
    - `PreviewEmployeeImportRequest/Response`
    - `ExecuteEmployeeImportRequest/Response`
    - `EmployeePreviewItem`
    - `EmployeeImportResult`
    - `ImportStats`
    - `ErrorCode`
  - File: `frontend/packages/rpc/index.ts`
  - Commit with message: "feat: Export employee import RPC types"

- [X] **T009** Build frontend RPC package
  - Run: `cd frontend && pnpm -r build`
  - Verify: `frontend/packages/rpc/dst/` contains updated artifacts
  - Commit if any changes to generated outputs
  - **Blocks**: T015 (API wrapper needs built RPC package)

## Phase 3.3: Core Backend Implementation

### Backend Service Structure (Constitution v3.3.0 Requirements)
- [X] **T010** Create `backend/internal/iam/employee_import.go` with service struct
  - Create struct with required pools:
    ```go
    type EmployeeImportService struct {
        AdminPool    database.AdminDatabaseConnector  // For identity creation (system-scope)
        TenantPool   database.TenantDatabaseConnector // For duplicate checking (tenant-aware)
        Queries      *database.Queries
        ZitadelClient *zitadelcli.Client
    }
    ```
  - Document pool usage decisions in comments
  - File: `backend/internal/iam/employee_import.go`
  - Commit with message: "feat: Create EmployeeImportService struct"
  - **Depends on**: T005, T007

- [X] **T011** Implement `ParseEmployeeFile` RPC method in `backend/internal/iam/employee_import.go`
  - Parse .xlsx file using `excelize` library
  - Extract columns: email, given_name, family_name
  - Skip header row
  - Validate file format and required columns
  - Enforce max 100 employees limit
  - Return `ParseEmployeeFileResponse` with employees or parse_errors
  - Method signature: `func (s *EmployeeImportService) ParseEmployeeFile(ctx context.Context, req *connect.Request[rpcv1.ParseEmployeeFileRequest]) (*connect.Response[rpcv1.ParseEmployeeFileResponse], error)`
  - File: `backend/internal/iam/employee_import.go`
  - Commit with message: "feat: Implement ParseEmployeeFile method"
  - **Depends on**: T010

- [X] **T012** Implement `PreviewEmployeeImport` RPC method in `backend/internal/iam/employee_import.go`
  - Use **TenantPool** for duplicate checking (tenant-aware operation)
  - Call `CheckDuplicateEmailsBatch` query with organization_id filter
  - Validate each employee (email format, required fields)
  - Build `EmployeePreviewItem` for each employee with:
    - `is_duplicate` flag
    - `validation_errors` list
    - `will_be_imported` determination
  - Calculate `ImportStats` summary
  - Return `PreviewEmployeeImportResponse`
  - Method signature: `func (s *EmployeeImportService) PreviewEmployeeImport(ctx context.Context, req *connect.Request[rpcv1.PreviewEmployeeImportRequest]) (*connect.Response[rpcv1.PreviewEmployeeImportResponse], error)`
  - File: `backend/internal/iam/employee_import.go`
  - Commit with message: "feat: Implement PreviewEmployeeImport method"
  - **Depends on**: T010

- [X] **T013** Implement `ExecuteEmployeeImport` RPC method in `backend/internal/iam/employee_import.go`
  - Use **AdminPool** for identity creation (system-scope onboarding operation, similar to organization creation)
  - Process employees in goroutines (max 10 concurrent) with semaphore pattern
  - For each employee:
    1. Call Zitadel CreateUser API (no password, verification email flow)
    2. Create individual DB transaction with `txn.WithTxn`
    3. Insert into `iam.identity` using `CreateIdentityBatch`
    4. Insert into `iam.identity_role` with role='employee' using `CreateIdentityRoleBatch`
    5. Commit transaction
  - Compensation: If DB insert fails, delete Zitadel user
  - Build per-employee `EmployeeImportResult` with success/error details
  - Return `ExecuteEmployeeImportResponse` with aggregated results
  - Method signature: `func (s *EmployeeImportService) ExecuteEmployeeImport(ctx context.Context, req *connect.Request[rpcv1.ExecuteEmployeeImportRequest]) (*connect.Response[rpcv1.ExecuteEmployeeImportResponse], error)`
  - Document pool choice: AdminPool used because this is system-scope onboarding (like org creation)
  - File: `backend/internal/iam/employee_import.go`
  - Commit with message: "feat: Implement ExecuteEmployeeImport method"
  - **Depends on**: T010

- [X] **T014** Validate transaction usage and tenant isolation in `backend/internal/iam/employee_import.go`
  - Verify all transactions use `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
  - Verify TenantPool queries include `organization_id` filters
  - Verify AdminPool usage documented with justification
  - Add logging statements for import operations:
    - Import started (batch size, org_id)
    - Per-employee success/failure
    - Import completed (success count, failure count)
  - File: `backend/internal/iam/employee_import.go`
  - Commit with message: "feat: Add validation and logging for employee import"
  - **Depends on**: T013

### Backend RPC Handler Registration
- [X] **T015** Register employee import service in `backend/internal/iam/iam.go`
  - Wire up `EmployeeImportService` with AdminPool, TenantPool, Queries, ZitadelClient
  - Register RPC handlers for new methods
  - Follow existing pattern from `backend/internal/organization/organization.go`
  - File: `backend/internal/iam/iam.go`
  - Commit with message: "feat: Register employee import RPC handlers"
  - **Depends on**: T014

## Phase 3.4: Frontend Implementation

### Frontend API Wrapper
- [X] **T016** Create `frontend/packages/apis/src/iam-employee-import.ts` API wrapper
  - Create wrapper functions for:
    - `parseEmployeeFile(organizationId: string, fileContent: Uint8Array)`
    - `previewEmployeeImport(organizationId: string, employees: EmployeeData[])`
    - `executeEmployeeImport(organizationId: string, employees: EmployeeData[])`
  - Follow pattern from `frontend/packages/apis/src/organization.ts`
  - Include error handling and retry logic
  - Export from `frontend/packages/apis/index.ts`
  - File: `frontend/packages/apis/src/iam-employee-import.ts`
  - Commit with message: "feat: Create IAM employee import API wrapper"
  - **Depends on**: T009

### Frontend UI Components
- [X] **T017** [P] Create import page at `frontend/apps/web/src/app/employees/import/page.tsx`
  - Implement stepper UI with 3 steps:
    1. "Enter Data" (form entry or file upload)
    2. "Preview & Confirm" (validation results, duplicate detection)
    3. "Results" (success/failure per employee)
  - Use MUI `Stepper`, `Step`, `StepLabel` components
  - State management for current step, employee data, preview results
  - File: `frontend/apps/web/src/app/employees/import/page.tsx`
  - Commit with message: "feat: Create employee import page with stepper"
  - **Depends on**: T016

- [X] **T018** [P] Create manual entry form component at `frontend/apps/web/src/app/employees/import/_components/ManualEntryForm.tsx`
  - Form with dynamic rows for employee data (email, given_name, family_name)
  - "Add Row" and "Remove Row" buttons
  - Inline validation (email format, required fields)
  - Initial state: 3 empty rows
  - Max 100 rows enforced
  - File: `frontend/apps/web/src/app/employees/import/_components/ManualEntryForm.tsx`
  - Commit with message: "feat: Create manual entry form component"
  - **Depends on**: T016

- [X] **T019** [P] Create file upload component at `frontend/apps/web/src/app/employees/import/_components/FileUploadForm.tsx`
  - Drag-drop zone for .xlsx files
  - Use SheetJS `xlsx` to parse file on client-side
  - Display preview of parsed data
  - "Parse File" button triggers preview
  - File size validation
  - File: `frontend/apps/web/src/app/employees/import/_components/FileUploadForm.tsx`
  - Commit with message: "feat: Create file upload form component"
  - **Depends on**: T016

- [X] **T020** Create preview table component at `frontend/apps/web/src/app/employees/import/_components/PreviewTable.tsx`
  - Display employee data with validation status
  - Columns: Email, Given Name, Family Name, Status (Will Import / Duplicate / Invalid)
  - Color-coded status indicators (green checkmark, red X, yellow warning)
  - Show duplicate reason and validation errors
  - Summary stats at top (X valid, Y duplicates, Z invalid)
  - File: `frontend/apps/web/src/app/employees/import/_components/PreviewTable.tsx`
  - Commit with message: "feat: Create preview table component"
  - **Depends on**: T017

- [X] **T021** Create results display component at `frontend/apps/web/src/app/employees/import/_components/ResultsDisplay.tsx`
  - Display import results with success/failure per employee
  - Success count, failure count, total attempted
  - List of created employees with identity IDs
  - List of failed employees with error messages
  - "Import More Employees" button to restart flow
  - File: `frontend/apps/web/src/app/employees/import/_components/ResultsDisplay.tsx`
  - Commit with message: "feat: Create results display component"
  - **Depends on**: T017

### Frontend Integration
- [X] **T022** Wire up API calls in import page `frontend/apps/web/src/app/employees/import/page.tsx`
  - Connect "Next: Preview" button to `previewEmployeeImport` API call
  - Connect "Confirm Import" button to `executeEmployeeImport` API call
  - Handle loading states (show spinners during API calls)
  - Handle error states (show error messages)
  - Update stepper on successful transitions
  - File: `frontend/apps/web/src/app/employees/import/page.tsx`
  - Commit with message: "feat: Wire up API calls in import page"
  - **Depends on**: T017, T020, T021

- [X] **T023** Add navigation to employee import from main employees page
  - Add "Import Employees" button to `frontend/apps/web/src/app/employees/page.tsx` (or create if doesn't exist)
  - Button links to `/employees/import`
  - Only show button if user has 'owner' role
  - File: `frontend/apps/web/src/app/employees/page.tsx`
  - Commit with message: "feat: Add navigation to employee import"
  - **Depends on**: T017

## Phase 3.5: Manual Verification ⚠️ REQUIRED BEFORE TESTS

**Human developer MUST verify behavior is correct before adding tests**

- [ ] **T024** Manual test: Parse .xlsx file (Happy Path)
  - Create test file `employees-test.xlsx` with 5 employees
  - Upload file via UI
  - Verify: All 5 employees parsed correctly
  - Verify: Preview shows all fields populated
  - Document results in verification log

- [ ] **T025** Manual test: Preview with duplicates
  - Import 1 employee via UI
  - Attempt to import same employee again
  - Verify: Preview shows duplicate flag
  - Verify: Duplicate marked as "will not be imported"
  - Document results in verification log

- [ ] **T026** Manual test: Execute import (Happy Path)
  - Import batch of 3 new employees
  - Click "Confirm Import"
  - Verify: Success message with 3 imported
  - Verify: Database contains 3 new identities with organization_id filter
  - Verify: All 3 have 'employee' role assigned
  - Verify: Zitadel shows 3 new users
  - Document results in verification log

- [ ] **T027** Manual test: Multi-tenant isolation
  - Login as owner of Organization A
  - Import employee `test@example.com`
  - Login as owner of Organization B
  - Import employee `test@example.com` (same email, different org)
  - Verify: Both imports succeed (no cross-org duplicate detection)
  - Verify: Database shows 2 separate identities with different organization_ids
  - Document results in verification log

- [ ] **T028** Manual test: Transaction rollback on Zitadel failure
  - Simulate Zitadel API failure (disconnect network or use invalid credentials)
  - Attempt import
  - Verify: No identity records created in database
  - Verify: Error message shown to user
  - Document results in verification log

- [ ] **T029** Manual test: Batch size limit enforcement
  - Attempt to upload .xlsx file with 101 employees
  - Verify: Error message "Maximum 100 employees per batch"
  - Verify: Import blocked
  - Document results in verification log

- [ ] **T030** Manual test: RBAC enforcement (owner role only)
  - Login as user with 'employee' role (not 'owner')
  - Attempt to access `/employees/import`
  - Verify: Access denied or 403 error
  - Document results in verification log

- [ ] **T031** Run all scenarios from `specs/003-feature-import-employees/quickstart.md`
  - Execute Scenario 1: Manual Form Entry (Happy Path)
  - Execute Scenario 2: File Upload (.xlsx)
  - Execute Scenario 3: Duplicate Detection
  - Document all verification results
  - Get stakeholder sign-off on behavior

## Phase 3.6: Tests (After Verification)

**Add tests ONLY after T024-T031 confirm correct behavior**

### Backend Unit Tests
- [ ] **T032** [P] Create unit tests for `ParseEmployeeFile` in `backend/internal/iam/employee_import_test.go`
  - Test: Valid .xlsx file with 3 employees
  - Test: Invalid file format
  - Test: Missing required columns
  - Test: Batch size exceeds 100
  - Test: Empty file
  - File: `backend/internal/iam/employee_import_test.go`
  - Commit with message: "test: Add unit tests for ParseEmployeeFile"

- [ ] **T033** [P] Create unit tests for `PreviewEmployeeImport` in `backend/internal/iam/employee_import_test.go`
  - Test: Valid employees with no duplicates
  - Test: Duplicate email detection
  - Test: Invalid email format validation
  - Test: Missing required fields
  - Test: Mixed batch (valid + duplicates + invalid)
  - File: `backend/internal/iam/employee_import_test.go`
  - Commit with message: "test: Add unit tests for PreviewEmployeeImport"

- [ ] **T034** [P] Create unit tests for `ExecuteEmployeeImport` in `backend/internal/iam/employee_import_test.go`
  - Test: Successful import of 3 employees
  - Test: Transaction rollback on DB error
  - Test: Compensation (Zitadel user deletion) on DB error
  - Test: Concurrent import with goroutines
  - Test: Partial success (some employees succeed, some fail)
  - Mock Zitadel API calls
  - File: `backend/internal/iam/employee_import_test.go`
  - Commit with message: "test: Add unit tests for ExecuteEmployeeImport"

### Backend Integration Tests
- [ ] **T035** [P] Create integration test in `backend/integration/employee_import_test.go`
  - Test end-to-end flow: Parse → Preview → Execute
  - Use real database (test container)
  - Mock Zitadel API
  - Verify:
    - Identities created with correct organization_id
    - Roles assigned correctly
    - Multi-tenant isolation (organization_id filtering)
    - Transaction semantics
  - File: `backend/integration/employee_import_test.go`
  - Commit with message: "test: Add integration tests for employee import"

### Contract Tests
- [ ] **T036** [P] Create contract test for `ParseEmployeeFile` RPC
  - Test RPC request/response schema
  - Validate proto message serialization
  - Test error responses
  - File: Add to existing contract test suite (e.g., `backend/internal/iam/contract_test.go`)
  - Commit with message: "test: Add contract tests for ParseEmployeeFile"

- [ ] **T037** [P] Create contract test for `PreviewEmployeeImport` RPC
  - Test RPC request/response schema
  - Validate `EmployeePreviewItem` structure
  - Test `ImportStats` calculation
  - File: Add to existing contract test suite
  - Commit with message: "test: Add contract tests for PreviewEmployeeImport"

- [ ] **T038** [P] Create contract test for `ExecuteEmployeeImport` RPC
  - Test RPC request/response schema
  - Validate `EmployeeImportResult` structure
  - Test error code enums
  - File: Add to existing contract test suite
  - Commit with message: "test: Add contract tests for ExecuteEmployeeImport"

### Frontend Tests
- [ ] **T039** [P] Create tests for `ManualEntryForm` component
  - Test: Add/remove rows
  - Test: Inline validation
  - Test: Max 100 rows enforcement
  - File: `frontend/apps/web/src/app/employees/import/_components/ManualEntryForm.test.tsx`
  - Commit with message: "test: Add tests for ManualEntryForm component"

- [ ] **T040** [P] Create tests for `FileUploadForm` component
  - Test: File upload and parsing
  - Test: File type validation (.xlsx only)
  - Test: File size validation
  - File: `frontend/apps/web/src/app/employees/import/_components/FileUploadForm.test.tsx`
  - Commit with message: "test: Add tests for FileUploadForm component"

- [ ] **T041** [P] Create tests for `PreviewTable` component
  - Test: Display employee data correctly
  - Test: Status indicators (duplicate, invalid, valid)
  - Test: Summary stats calculation
  - File: `frontend/apps/web/src/app/employees/import/_components/PreviewTable.test.tsx`
  - Commit with message: "test: Add tests for PreviewTable component"

- [ ] **T042** Create integration test for import page flow
  - Test: Complete user journey from entry to results
  - Mock API calls
  - Test: Stepper navigation
  - Test: Error handling
  - File: `frontend/apps/web/src/app/employees/import/page.test.tsx`
  - Commit with message: "test: Add integration test for import page"
  - **Depends on**: T039, T040, T041

## Phase 3.7: Polish & Documentation

- [ ] **T043** [P] Add performance logging and metrics
  - Log import duration (preview and execution)
  - Log batch size statistics
  - Log Zitadel API call durations
  - Add structured logging with context fields
  - File: `backend/internal/iam/employee_import.go`
  - Commit with message: "feat: Add performance logging and metrics"

- [ ] **T044** [P] Optimize database queries for performance
  - Verify `idx_iam_identity_org_email` index is used
  - Run EXPLAIN ANALYZE on `CheckDuplicateEmailsBatch`
  - Optimize batch insert performance (target <10 seconds for 100 employees)
  - File: Performance optimization notes or query adjustments
  - Commit with message: "perf: Optimize employee import queries"

- [ ] **T045** [P] Add user-friendly error messages
  - Review all error messages for clarity
  - Add actionable guidance (e.g., "Please check your .xlsx file format")
  - Ensure frontend displays backend error messages correctly
  - File: `backend/internal/iam/employee_import.go` and frontend components
  - Commit with message: "ux: Improve error messages for employee import"

- [ ] **T046** Update API documentation
  - Document new RPC methods in project README or API docs
  - Include request/response examples
  - Document error codes and their meanings
  - File: Create or update `docs/api-employee-import.md`
  - Commit with message: "docs: Document employee import API"

- [ ] **T047** Final smoke test
  - Run all manual verification scenarios (T024-T031) again
  - Verify all tests pass (T032-T042)
  - Check code coverage (aim for >80% for new code)
  - Verify no regressions in existing features
  - Document final smoke test results

## Dependencies

### Critical Path
1. **Setup** (T001-T003) → Database (T004-T005) → Proto (T006-T007) → Frontend RPC (T008-T009)
2. **Backend Core** (T010-T015): Sequential, each task depends on previous
3. **Frontend** (T016-T023): T016 blocks all frontend components
4. **Verification** (T024-T031): Blocks all tests (T032-T042)
5. **Tests** (T032-T042): Run after verification complete
6. **Polish** (T043-T047): Run after tests complete

### Detailed Dependencies
- **T005** (sqlc generate) blocks **T010-T014** (service implementation)
- **T007** (buf generate) blocks **T010-T014** (service implementation)
- **T009** (frontend build) blocks **T016** (API wrapper)
- **T010** (service struct) blocks **T011-T014** (method implementations)
- **T014** (validation) blocks **T015** (handler registration)
- **T016** (API wrapper) blocks **T017-T023** (frontend components)
- **T017** (import page) blocks **T020-T021** (preview/results components)
- **T020-T021** block **T022** (API wiring)
- **T017** blocks **T023** (navigation)
- **T024-T031** (verification) block **T032-T042** (all tests)
- **T039-T041** (component tests) block **T042** (page integration test)

### Parallel Execution Groups
**Group 1 (Setup)**:
- T001 (backend dependency)
- T002 (frontend dependency) [P]
- T003 (verify MUI) [P]

**Group 2 (Backend Implementation)**:
- T011 (ParseEmployeeFile)
- T012 (PreviewEmployeeImport) - after T011
- T013 (ExecuteEmployeeImport) - after T012
- T014 (validation) - after T013
(Sequential due to same file and logical dependencies)

**Group 3 (Frontend Components)**:
- T017 (import page) [P]
- T018 (manual form) [P]
- T019 (file upload) [P]
(Different files, but all depend on T016)

**Group 4 (Verification)** - Sequential, manual testing:
- T024-T031 (manual tests)

**Group 5 (Backend Tests)**:
- T032 (ParseEmployeeFile tests) [P]
- T033 (PreviewEmployeeImport tests) [P]
- T034 (ExecuteEmployeeImport tests) [P]
- T035 (integration tests) [P]

**Group 6 (Contract Tests)**:
- T036 (ParseEmployeeFile contract) [P]
- T037 (PreviewEmployeeImport contract) [P]
- T038 (ExecuteEmployeeImport contract) [P]

**Group 7 (Frontend Tests)**:
- T039 (ManualEntryForm tests) [P]
- T040 (FileUploadForm tests) [P]
- T041 (PreviewTable tests) [P]

**Group 8 (Polish)**:
- T043 (performance logging) [P]
- T044 (query optimization) [P]
- T045 (error messages) [P]

## Parallel Example

```bash
# After T009 (frontend build) complete, launch frontend components in parallel:
Task: "Create import page at frontend/apps/web/src/app/employees/import/page.tsx"
Task: "Create manual entry form at frontend/apps/web/src/app/employees/import/_components/ManualEntryForm.tsx"
Task: "Create file upload form at frontend/apps/web/src/app/employees/import/_components/FileUploadForm.tsx"

# After T031 (verification complete), launch backend unit tests in parallel:
Task: "Create unit tests for ParseEmployeeFile in backend/internal/iam/employee_import_test.go"
Task: "Create unit tests for PreviewEmployeeImport in backend/internal/iam/employee_import_test.go"
Task: "Create unit tests for ExecuteEmployeeImport in backend/internal/iam/employee_import_test.go"
Task: "Create integration test in backend/integration/employee_import_test.go"
```

## Notes

- **[P] tasks**: Different files, no dependencies, safe to run in parallel
- **MUST verify behavior manually** (T024-T031) before adding tests (T032-T042)
- **Tests document and lock in verified-correct behavior**
- Commit after each task
- Use structured logging for observability
- Follow Constitution v3.3.0 patterns for service structure and transaction handling
- All database queries must include `organization_id` for multi-tenant isolation

## Validation Checklist

*GATE: Check before marking tasks complete*

- [x] All contracts have corresponding implementations (T011-T013 implement proto methods from T006)
- [x] All entities have model tasks (No new entities; using existing `iam.identity` and `iam.identity_role`)
- [x] Manual verification phase present before tests (T024-T031 before T032-T042)
- [x] All implementations have corresponding tests (T032-T042 cover T011-T023)
- [x] Parallel tasks truly independent (Groups 1, 3, 5, 6, 7, 8 verified)
- [x] Each task specifies exact file path (All tasks include file paths)
- [x] No task modifies same file as another [P] task (Verified per group)
- [x] Codegen tasks (T005, T007, T009) block dependent implementation tasks (T010-T014, T016-T023)
- [x] Transaction validation included (T014 validates txn.WithTxn usage)
- [x] Multi-tenant isolation verified (T027 tests organization_id filtering)
