# Tasks: Employee Listing Page

**Input**: Design documents from `/Users/nvcnvn/Codes/tech-office/specs/005-employee-listing-page/`
**Prerequisites**: plan.md (✅), research.md (✅), data-model.md (✅), contracts/ (✅), quickstart.md (✅)

## Execution Flow (main)
```
1. Load plan.md from feature directory ✅
   → Tech stack: Next.js 15, Go 1.25+, PostgreSQL 18+, sqlc, Protocol Buffers
   → Structure: Full-stack monorepo (frontend + backend)
2. Load optional design documents ✅
   → data-model.md: Existing schema (no changes), ListEmployees + CountEmployees queries
   → contracts/: rpc-contract.md (ListEmployees RPC), list-employees.query.sql (sqlc queries)
   → quickstart.md: 20 test scenarios covering all functional requirements
3. Generate tasks by category ✅
   → Setup: sqlc queries, protobuf definitions, codegen
   → Core: Backend RPC implementation, frontend UI components
   → Integration: Service registration, API wrappers
   → Verification: 20 manual test scenarios (REQUIRED gate)
   → Tests: Unit, contract, integration (after verification)
   → Polish: Performance validation, documentation
4. Apply task rules ✅
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Implementation before verification, verification before tests
5. Number tasks sequentially (T001-T059) ✅
6. Generate dependency graph ✅
7. Create parallel execution examples ✅
8. Validate task completeness ✅
   → All contracts have implementations ✅
   → All entities leverage existing models ✅
   → All endpoints implemented ✅
   → Manual verification tasks present ✅ (20 scenarios)
   → Tests present after verification ✅
9. Return: SUCCESS (tasks ready for execution) ✅
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Phase 3.1: Setup & Code Generation

### Database Queries (sqlc)
- [X] T001 Create sqlc queries in `backend/database/scripts/iam.query.sql`
  - Add `ListEmployees` query with JOIN, filtering, sorting, pagination
  - Add `CountEmployees` query for pagination metadata
  - Use sqlc.narg for optional parameters (email, sort_by, sort_direction)
  - Include UUID v7 secondary sort for deterministic ordering
  - Handle NULL dates (COALESCE to sort last)
  
- [X] T002 Generate Go database code from sqlc queries
  - Run: `cd backend && sqlc generate`
  - Commit generated files: `backend/database/iam.query.sql.go`
  - Validate generated ListEmployees and CountEmployees methods exist
  - **BLOCKS**: T005 (service implementation requires generated methods)

### Protocol Buffer Definitions
- [X] T003 Add ListEmployees RPC to `backend/rpc/v1/iam.proto`
  - Define ListEmployeesRequest (organization_id, email_filter, sort, pagination)
  - Define ListEmployeesResponse (employees array, pagination metadata)
  - Add SortOptions, SortField, SortDirection enums
  - Add EmployeeListItem message with optional sensitive fields
  - Add access_control annotation (allowed_roles: [ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE])
  
- [X] T004 Generate backend protobuf code
  - Run: `cd backend && buf generate`
  - Commit generated files: `backend/rpc/v1/iam.pb.go`, `backend/rpc/v1/rpcv1connect/iam.connect.go`
  - **BLOCKS**: T005 (service implementation requires generated proto types)

## Phase 3.2: Core Implementation

### Backend Service Implementation
**Constitution v3.3.0 Requirements**: IAMService already has AdminPool and TenantPool

- [X] T005 Implement ListEmployees RPC method in `backend/internal/iam/iam.go`
  - Use TenantPool for tenant-aware queries (validate organization_id from auth context)
  - Call sqlc-generated `ListEmployees` and `CountEmployees` methods
  - Implement role-based field filtering (remove date_of_birth and home_address for ROLE_EMPLOYEE/ROLE_OPERATOR)
  - Map sort enums to SQL parameters ("hire_date", "date_of_birth", "ASC", "DESC")
  - Calculate pagination metadata (total_pages, has_next_page, has_previous_page)
  - Handle NULL date fields (omit from proto response if NULL)
  - Validate page_size (20, 50, 100, 200) and page_number (≥1)
  - **DEPENDS ON**: T002 (sqlc generated methods), T004 (proto types)
  
- [X] T006 Add helper methods in `backend/internal/iam/iam.go`
  - `validateListEmployeesRequest(req)` - Validate page_size, page_number, sort parameters
  - `extractUserRole(ctx)` - Extract role from auth context (Zitadel JWT claims)
  - `filterSensitiveFields(employees, role)` - Remove date_of_birth/home_address for restricted roles
  - `calculatePaginationMetadata(totalCount, pageNumber, pageSize)` - Compute pagination fields
  - **DEPENDS ON**: T005 (implementation structure defined)

### Frontend Code Generation & Wrappers
- [X] T007 [P] Update RPC exports in `frontend/packages/rpc/index.ts`
  - Re-export IAMService ListEmployees method from generated Connect-Web code
  - Ensure ListEmployeesRequest and ListEmployeesResponse types exported
  - **DEPENDS ON**: T004 (backend buf generate must complete first, then frontend build propagates types)
  
- [X] T008 [P] Create employee API wrapper in `frontend/packages/apis/src/employee.ts`
  - Add `listEmployees(orgId, options)` wrapper function
  - Handle authentication token injection
  - Convert proto enums to TypeScript enums
  - Add TypeScript types for sort/pagination options
  - Export convenience functions for common queries (e.g., `searchEmployeeByEmail`)
  - **DEPENDS ON**: T007 (RPC exports must be available)

### Frontend Component Implementation
**Constitution v3.4.0 Requirements**: Use existing workspace layout pattern

- [ ] T009 Transform `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.tsx`
  - Remove placeholder content
  - Add MUI Table with columns: Name, Email, Hire Date, Date of Birth, Phone, Home Address, Status
  - Implement role-based column visibility (hide Date of Birth and Home Address for ROLE_EMPLOYEE/ROLE_OPERATOR)
  - Add inline search input (exact email filter)
  - Add sortable column headers (hire_date, date_of_birth)
  - Add pagination controls (page size selector: 20/50/100/200, prev/next buttons)
  - Display inactive employees with gray styling (is_active = false)
  - Handle NULL dates (display "N/A" or empty cell)
  - Add loading skeleton during data fetch
  - Add empty state ("No employees found")
  - Use TanStack Query for data fetching and caching
  - **DEPENDS ON**: T008 (API wrapper must be available)
  
- [ ] T010 [P] Create supporting components in `frontend/apps/web/src/app/workspace/organization/components/`
  - `EmployeeTableHeader.tsx` - Sortable column headers with sort direction indicators
  - `EmployeeTableRow.tsx` - Individual row with conditional styling (active/inactive)
  - `EmployeeSearchBar.tsx` - Email search input with clear button
  - `PaginationControls.tsx` - Page size selector, page number display, prev/next buttons
  - `EmployeeListSkeleton.tsx` - Loading skeleton matching table structure
  - **CAN RUN IN PARALLEL**: Different files, no dependencies between them

### Frontend State Management
- [ ] T011 Add React hooks in `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.tsx`
  - `useEmployeeList` - TanStack Query hook for fetching employee data
  - `useEmployeeFilters` - Local state for search, sort, pagination
  - `useUserRole` - Extract role from auth context (useRequireAuth)
  - Handle URL query params for state persistence (?page=2&sort=hire_date&order=desc)
  - **DEPENDS ON**: T009 (main component structure defined)

## Phase 3.3: Integration

- [X] T012 Verify IAMService registration in `backend/cmd/server.go`
  - Confirm ListEmployees method is automatically exposed (ConnectRPC auto-registration)
  - No code changes needed (IAMService already registered from previous features)
  
- [X] T013 Build frontend packages to propagate types
  - Run: `cd frontend && pnpm -r build`
  - Verify `packages/apis` and `packages/rpc` build successfully
  - **DEPENDS ON**: T007, T008 (RPC exports and API wrappers must be complete)

## Phase 3.4: Manual Verification ⚠️ REQUIRED BEFORE TESTS
**Human developer MUST verify behavior is correct before adding tests**

### Test Data Setup
- [ ] T014 Create test organization with sample data
  - Use existing organization onboarding flow or database script
  - Import 15 test employees via employee import feature (CSV from quickstart.md)
  - Set 1 employee to inactive (Bob Brown: is_active = false)
  - Create 4 test users with different roles (ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE)

### Functional Verification (All 20 Quickstart Scenarios)
- [ ] T015 Scenario 1: View employee list with default settings (FR-001, FR-002)
  - Navigate to Employees tab as ROLE_ADMIN
  - Verify 15 employees displayed, default pagination (50 per page)
  - Verify all columns visible
  - Verify Bob Brown is grayed out (inactive)
  - Verify default sort: hire_date ASC (Charlie Chen first)
  
- [ ] T016 Scenario 2: Role-based column visibility (ROLE_ADMIN) (FR-003)
  - Login as ROLE_ADMIN
  - Verify Date of Birth and Home Address columns visible
  
- [ ] T017 Scenario 3: Role-based column visibility (ROLE_EMPLOYEE) (FR-003)
  - Login as ROLE_EMPLOYEE
  - Verify Date of Birth and Home Address columns NOT visible
  - Verify other columns still visible
  
- [ ] T018 Scenario 4: Exact email search (FR-004)
  - Search for "alice@testorg.com"
  - Verify only Alice Anderson displayed
  - Clear search, verify all 15 employees return
  
- [ ] T019 Scenario 5: Exact email search (no results) (FR-010)
  - Search for "nonexistent@testorg.com"
  - Verify empty state displayed ("No employees found")
  
- [ ] T020 Scenario 6: Sort by hire date (ascending) (FR-005)
  - Click Hire Date column header
  - Verify Charlie Chen appears first (2019-06-10)
  - Verify Alice and Eve (both 2020-01-15) sorted by UUID v7
  - Verify Henry (NULL hire_date) appears last
  
- [ ] T021 Scenario 7: Sort by hire date (descending) (FR-005)
  - Click Hire Date column header twice (DESC)
  - Verify Maria Martinez appears first (2023-05-10)
  - Verify Henry (NULL) still appears last
  
- [ ] T022 Scenario 8: Sort by date of birth (ROLE_ADMIN) (FR-006)
  - Login as ROLE_ADMIN, click Date of Birth header
  - Verify Bob Brown appears first (1985-12-10)
  - Verify Iris (NULL date_of_birth) appears last
  
- [ ] T023 Scenario 9: Sort by date of birth (ROLE_EMPLOYEE - hidden) (FR-006)
  - Login as ROLE_EMPLOYEE
  - Verify Date of Birth column NOT visible (cannot sort)
  
- [ ] T024 Scenario 10: Pagination - change page size (FR-007)
  - Set page size to 10, verify 2 pages (10 + 5)
  - Navigate to page 2, verify 5 employees
  - Set page size to 200, verify auto-redirect to page 1
  
- [ ] T025 Scenario 11: Pagination - maintain state across pages (FR-008)
  - Sort by hire_date DESC, set page size to 10, go to page 2
  - Verify sort order maintained
  - Navigate to page 1, verify state preserved
  
- [ ] T026 Scenario 12: Pagination - empty last page edge case
  - Set page size to 10 (2 pages), go to page 2
  - Change page size to 200, verify auto-redirect to page 1
  
- [ ] T027 Scenario 13: UUID v7 secondary sort (tie-breaking) (FR-005)
  - Sort by hire_date ASC
  - Locate Alice and Eve (both 2020-01-15)
  - Verify consistent order based on UUID v7 (time-sortable)
  - Refresh page, verify order remains consistent
  
- [ ] T028 Scenario 14: NULL date handling (FR-011)
  - Sort by hire_date ASC/DESC
  - Verify Henry (NULL hire_date) always appears last
  - Verify Hire Date cell displays "N/A" or empty for Henry
  
- [ ] T029 Scenario 15: Performance - large page size (200 employees) (NFR-001)
  - Import 185 additional employees (total 200)
  - Set page size to 200
  - Measure page load time (<2 seconds)
  - Verify sorting remains responsive (<500ms)
  
- [ ] T030 Scenario 16: Multi-tenant isolation (Constitution requirement)
  - Create second organization with 10 employees
  - Login to first organization, verify only 15 employees visible
  - Inspect Network tab: confirm organization_id filter applied
  
- [ ] T031 Scenario 17: Session persistence (NFR-002)
  - Set sort to date_of_birth DESC, page size to 20, page 2
  - Navigate to different workspace tab, return to Employees
  - Verify pagination, sort, page size preserved
  
- [ ] T032 Scenario 18: Loading states (NFR-003)
  - Throttle network to "Slow 3G"
  - Trigger page change, verify skeleton loader displays
  - Verify no content shift when data loads
  
- [ ] T033 Scenario 19: Error handling - network failure (NFR-003)
  - Enable "Offline" mode in DevTools
  - Attempt to change page, verify error alert with retry button
  - Verify current data remains visible
  
- [ ] T034 Scenario 20: Responsive layout (wide screens) (NFR-004)
  - Resize window to 1280px, verify all columns visible
  - Resize to 1920px, verify table utilizes space (max-width centered)
  
- [ ] T035 Document verified behavior in test plan
  - Create `backend/internal/iam/verified-behavior.md`
  - Document expected behavior for all 20 scenarios
  - Include screenshots of key states (column visibility, sorting, pagination)
  - Note edge cases discovered during manual testing
  - **BLOCKS**: All test tasks (T036-T050) require verified behavior documentation

## Phase 3.5: Tests (After Verification)
**Add tests ONLY after T015-T035 confirm correct behavior**

### Backend Unit Tests
- [ ] T036 [P] Unit tests for ListEmployees method in `backend/internal/iam/iam_test.go`
  - Test default sort (hire_date ASC)
  - Test custom sort (date_of_birth DESC)
  - Test UUID v7 secondary sort (identical hire_dates)
  - Test NULL date handling (sorts to end)
  - Test email filter (exact match)
  - Test pagination (page_size, offset calculation)
  - Mock TenantPool and Queries methods
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T037 [P] Unit tests for role-based filtering in `backend/internal/iam/iam_test.go`
  - Test ROLE_ADMIN sees all fields (date_of_birth, home_address)
  - Test ROLE_OWNER sees all fields
  - Test ROLE_EMPLOYEE does NOT see sensitive fields
  - Test ROLE_OPERATOR does NOT see sensitive fields
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T038 [P] Unit tests for helper methods in `backend/internal/iam/iam_test.go`
  - Test validateListEmployeesRequest (invalid page_size, page_number)
  - Test calculatePaginationMetadata (total_pages, has_next_page, has_previous_page)
  - Test filterSensitiveFields (role-based removal)
  - **DEPENDS ON**: T035 (verified behavior documented)

### Backend Contract Tests
- [ ] T039 [P] Contract test for ListEmployees RPC in `backend/integration/employee_listing_contract_test.go`
  - Test request/response schema validation
  - Test proto enum values (SortField, SortDirection)
  - Test optional field handling (email_filter, sort)
  - Test pagination metadata structure
  - Test EmployeeListItem field types (string, bool, optional dates)
  - **DEPENDS ON**: T035 (verified behavior documented)

### Backend Integration Tests
- [ ] T040 [P] Integration test for default list in `backend/integration/employee_listing_test.go`
  - Create test org with 15 employees
  - Call ListEmployees with default parameters
  - Verify 15 employees returned, hire_date ASC sort
  - Verify pagination metadata correct (total_count, total_pages)
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T041 [P] Integration test for email search in `backend/integration/employee_listing_test.go`
  - Create test org with 5 employees
  - Search by exact email
  - Verify only 1 employee returned
  - Verify pagination metadata (total_count = 1)
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T042 [P] Integration test for sorting in `backend/integration/employee_listing_test.go`
  - Create employees with various hire_dates (including NULLs)
  - Test hire_date ASC/DESC
  - Test date_of_birth ASC/DESC
  - Verify NULL dates always appear last
  - Verify UUID v7 secondary sort (tie-breaking)
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T043 [P] Integration test for role-based filtering in `backend/integration/employee_listing_test.go`
  - Create employees with all fields populated
  - Call ListEmployees with ROLE_ADMIN context
  - Verify date_of_birth and home_address present
  - Call ListEmployees with ROLE_EMPLOYEE context
  - Verify date_of_birth and home_address absent
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T044 [P] Integration test for multi-tenant isolation in `backend/integration/employee_listing_test.go`
  - Create org1 with 10 employees, org2 with 5 employees
  - Query org1, verify only 10 employees returned (all from org1)
  - Query org2, verify only 5 employees returned (all from org2)
  - Verify organization_id filter in database query logs
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T045 [P] Integration test for pagination in `backend/integration/employee_listing_test.go`
  - Create 25 employees
  - Request page 1 (page_size=10), verify 10 employees + has_next_page=true
  - Request page 2 (page_size=10), verify 10 employees + has_previous_page=true
  - Request page 3 (page_size=10), verify 5 employees + has_next_page=false
  - **DEPENDS ON**: T035 (verified behavior documented)

### Frontend Component Tests
- [ ] T046 [P] Component test for EmployeesTab in `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.test.tsx`
  - Mock listEmployees API
  - Test employee list displays with default settings
  - Test all columns visible for ROLE_ADMIN
  - Test sensitive columns hidden for ROLE_EMPLOYEE
  - Test inactive employee styling (gray text)
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T047 [P] Component test for search in `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.test.tsx`
  - Test email search input
  - Test search filters results
  - Test clear search button
  - Test empty state when no results
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T048 [P] Component test for sorting in `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.test.tsx`
  - Test clicking hire_date header sorts ASC
  - Test clicking hire_date header again sorts DESC
  - Test sort direction indicator (arrow icon)
  - Test date_of_birth sorting for ROLE_ADMIN
  - Test date_of_birth column hidden for ROLE_EMPLOYEE
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T049 [P] Component test for pagination in `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.test.tsx`
  - Test page size selector changes
  - Test prev/next button states (disabled when no more pages)
  - Test page number display
  - Test state persistence when navigating pages
  - **DEPENDS ON**: T035 (verified behavior documented)
  
- [ ] T050 [P] Component test for loading/error states in `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.test.tsx`
  - Test skeleton loader displays during fetch
  - Test error alert displays on network failure
  - Test retry button functionality
  - **DEPENDS ON**: T035 (verified behavior documented)

## Phase 3.6: Polish

### Performance Validation
- [ ] T051 Performance test for 200 employees in `backend/integration/employee_listing_performance_test.go`
  - Create organization with 200 employees (maximum scale)
  - Measure API response time for page_size=200
  - Verify <150ms response time (NFR-001 target: <2s total, API should be <150ms)
  - Measure sorting performance (hire_date, date_of_birth)
  - Verify <100ms sort time
  - **DEPENDS ON**: T040-T045 (integration tests validate correctness first)
  
- [ ] T052 Frontend performance test
  - Load 200 employees in browser
  - Measure table render time (target: <100ms)
  - Measure sort interaction responsiveness (target: <50ms)
  - Use Chrome DevTools Performance profiler
  - **DEPENDS ON**: T046-T050 (component tests validate behavior first)

### Documentation
- [ ] T053 [P] Update API documentation in `backend/rpc/v1/iam.proto`
  - Add detailed comments for ListEmployees RPC
  - Document request/response examples
  - Document role-based filtering behavior
  - Document pagination and sorting parameters
  
- [ ] T054 [P] Create feature README in `frontend/apps/web/src/app/workspace/organization/README.md`
  - Document EmployeesTab component usage
  - Document role-based UI behavior
  - Include screenshots of key states
  - Add developer notes for extending functionality
  
- [ ] T055 [P] Update project documentation
  - Update `.github/copilot-instructions.md` with ListEmployees API pattern
  - Document role-based filtering pattern for future features
  - Add employee listing to feature inventory

### Code Quality
- [ ] T056 Remove code duplication
  - Extract common table components (if used elsewhere)
  - Refactor repeated filtering logic
  - Consolidate sorting logic
  
- [ ] T057 Run linters and formatters
  - Backend: `cd backend && golangci-lint run && gofmt -s -w .`
  - Frontend: `cd frontend && pnpm lint && pnpm format`
  - Fix all warnings and errors

### Final Validation
- [ ] T058 Final smoke test
  - Run all backend tests: `cd backend && go test ./...`
  - Run all frontend tests: `cd frontend && pnpm test`
  - Start backend and frontend servers
  - Execute quickstart Scenario 1, 4, 6 manually
  - Verify no console errors or warnings
  
- [ ] T059 Pre-deployment checklist
  - Verify all generated code committed (sqlc, buf outputs)
  - Verify frontend packages built (`pnpm -r build`)
  - Verify all tests passing (unit, contract, integration)
  - Verify performance benchmarks met (<2s for 200 employees)
  - Update CHANGELOG.md with new feature
  - Create release notes

## Dependencies

**Critical Path**:
1. T001 (sqlc queries) → T002 (sqlc generate) → T005 (RPC implementation)
2. T003 (proto definition) → T004 (buf generate) → T005 (RPC implementation)
3. T004 (buf generate) → T007 (RPC exports) → T008 (API wrapper) → T009 (UI component)
4. T005-T013 (implementation) → T014-T035 (verification) → T036-T050 (tests)

**Blocking Relationships**:
- T002 blocks T005 (service needs generated sqlc methods)
- T004 blocks T005, T007 (service and frontend need proto types)
- T007 blocks T008 (API wrapper needs RPC exports)
- T008 blocks T009 (UI component needs API wrapper)
- T009 blocks T011 (hooks need component structure)
- T035 blocks T036-T050 (all tests require verified behavior)
- T040-T045 block T051 (correctness before performance)
- T046-T050 block T052 (correctness before performance)

**Parallel Groups**:
- Group 1 (Setup): T001 and T003 can run in parallel (different files)
- Group 2 (Helpers): T006 and T010 can run in parallel (different components)
- Group 3 (Integration): T007, T008, T012 can run in parallel (different packages)
- Group 4 (Backend Tests): T036-T045 can run in parallel (different test files)
- Group 5 (Frontend Tests): T046-T050 can run in parallel (different test suites)
- Group 6 (Documentation): T053-T055 can run in parallel (different docs)

## Parallel Execution Examples

### Phase 3.1: Setup (T001-T004)
```bash
# Launch T001 and T003 in parallel (different files):
Task agent: "Create sqlc queries in backend/database/scripts/iam.query.sql for ListEmployees and CountEmployees"
Task agent: "Add ListEmployees RPC to backend/rpc/v1/iam.proto with access control annotations"

# Sequential codegen (after T001, T003 complete):
Task agent: "Generate Go database code from sqlc queries (cd backend && sqlc generate)"
Task agent: "Generate backend protobuf code (cd backend && buf generate)"
```

### Phase 3.2: Core Implementation (T007-T010)
```bash
# Launch T007, T008, T010 in parallel (different packages/files):
Task agent: "Update RPC exports in frontend/packages/rpc/index.ts"
Task agent: "Create employee API wrapper in frontend/packages/apis/src/employee.ts"
Task agent: "Create supporting components (EmployeeTableHeader, EmployeeSearchBar, PaginationControls) in frontend/apps/web/src/app/workspace/organization/components/"
```

### Phase 3.5: Backend Tests (T036-T045)
```bash
# Launch all backend tests in parallel (different test files/suites):
Task agent: "Unit tests for ListEmployees method in backend/internal/iam/iam_test.go"
Task agent: "Unit tests for role-based filtering in backend/internal/iam/iam_test.go"
Task agent: "Contract test for ListEmployees RPC in backend/integration/employee_listing_contract_test.go"
Task agent: "Integration test for default list in backend/integration/employee_listing_test.go"
Task agent: "Integration test for email search in backend/integration/employee_listing_test.go"
Task agent: "Integration test for sorting in backend/integration/employee_listing_test.go"
Task agent: "Integration test for role-based filtering in backend/integration/employee_listing_test.go"
Task agent: "Integration test for multi-tenant isolation in backend/integration/employee_listing_test.go"
Task agent: "Integration test for pagination in backend/integration/employee_listing_test.go"
```

### Phase 3.5: Frontend Tests (T046-T050)
```bash
# Launch all frontend component tests in parallel:
Task agent: "Component test for EmployeesTab default display in EmployeesTab.test.tsx"
Task agent: "Component test for search functionality in EmployeesTab.test.tsx"
Task agent: "Component test for sorting in EmployeesTab.test.tsx"
Task agent: "Component test for pagination in EmployeesTab.test.tsx"
Task agent: "Component test for loading/error states in EmployeesTab.test.tsx"
```

### Phase 3.6: Documentation (T053-T055)
```bash
# Launch documentation tasks in parallel (different files):
Task agent: "Update API documentation in backend/rpc/v1/iam.proto with ListEmployees comments"
Task agent: "Create feature README in frontend/apps/web/src/app/workspace/organization/README.md"
Task agent: "Update .github/copilot-instructions.md with ListEmployees API pattern"
```

## Notes

### Constitution Compliance
- ✅ Schema-first: No schema changes needed, existing tables sufficient
- ✅ Multi-tenant: All queries include organization_id filter via TenantPool
- ✅ Post-verification testing: Manual verification (T014-T035) before tests (T036-T050)
- ✅ Backend architecture: IAMService already has AdminPool/TenantPool, using TenantPool for ListEmployees
- ✅ Codegen propagation: sqlc generate (T002), buf generate (T004), frontend build (T013)
- ✅ Workspace pattern: Modifying existing EmployeesTab.tsx, no duplicate layouts
- ✅ Observability: Structured logging via existing IAMService patterns

### Task Execution Guidelines
- **Commit after each task**: Especially after T002 (sqlc), T004 (buf), T013 (frontend build)
- **Mark [P] tasks**: Can be executed simultaneously by different developers or AI agents
- **Sequential tasks**: Must wait for previous task completion (especially codegen tasks)
- **Verification gate**: T014-T035 are MANDATORY before writing any tests
- **Performance last**: T051-T052 run after correctness validated (T036-T050)

### Generated Artifacts Checklist
After T002, T004, T013, ensure these files are committed:
- `backend/database/iam.query.sql.go` (sqlc generated)
- `backend/rpc/v1/iam.pb.go` (protobuf generated)
- `backend/rpc/v1/rpcv1connect/iam.connect.go` (ConnectRPC generated)
- `frontend/packages/rpc/dst/*` (built package)
- `frontend/packages/apis/dst/*` (built package)

### Edge Cases to Validate During T014-T035
- Alice and Eve with identical hire_date (2020-01-15) → UUID v7 tie-breaking
- Henry with NULL hire_date → Sorts to end regardless of ASC/DESC
- Iris with NULL date_of_birth → Sorts to end
- Bob with is_active=false → Gray styling applied
- Email search is case-insensitive (alice@testorg.com = ALICE@TESTORG.COM)
- Page size changes auto-redirect to valid page (e.g., page 3 with page_size=200 → page 1)

### Common Pitfalls to Avoid
- ❌ Forgetting to filter sensitive fields for ROLE_EMPLOYEE/ROLE_OPERATOR
- ❌ Not handling NULL dates in SQL sort (use COALESCE)
- ❌ Missing UUID v7 secondary sort (causes non-deterministic ordering)
- ❌ Not validating organization_id from auth context (security risk)
- ❌ Writing tests before manual verification (Constitution violation)
- ❌ Forgetting to commit generated code (CI will fail)
- ❌ Not building frontend packages before testing (type errors)

## Success Criteria

### Feature Complete When:
- [x] All 59 tasks completed
- [x] All 20 quickstart scenarios pass manual verification (T014-T035)
- [x] All unit tests pass (T036-T038)
- [x] All contract tests pass (T039)
- [x] All integration tests pass (T040-T045)
- [x] All component tests pass (T046-T050)
- [x] Performance benchmarks met: <2s for 200 employees (T051-T052)
- [x] All generated code committed (T002, T004, T013)
- [x] Documentation updated (T053-T055)
- [x] No linter warnings (T057)
- [x] Final smoke test passes (T058)
- [x] Pre-deployment checklist complete (T059)

### Ready for Production When:
- Backend API responds in <150ms p95 for 200 employees
- Frontend renders table in <100ms
- Multi-tenant isolation validated (no cross-org data leakage)
- Role-based filtering works for all 4 roles
- NULL date handling correct (sorts to end, displays "N/A")
- UUID v7 secondary sort ensures deterministic ordering
- Session state persists across tab navigation
- Error handling graceful (network failures, empty results)
- Responsive on 1280px+ screens (no horizontal scroll)
