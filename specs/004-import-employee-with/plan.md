
# Implementation Plan: Enhanced Employee Import with Additional Fields

**Branch**: `004-import-employee-with` | **Date**: October 26, 2025 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-import-employee-with/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code, or `AGENTS.md` for all other agents).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
This feature extends the existing employee import functionality (spec 003) to support four additional optional fields during bulk import: `hire_date`, `date_of_birth`, `phone_number`, and `home_address`. The enhancement maintains full backward compatibility - imports can still be performed with only the required fields (email, given name, family name) or include any combination of the optional fields.

**Technical Approach**: 
- Extend the existing `EmployeeData` message in `iam.proto` to include optional fields
- Update parsing logic in `employee_import.go` to handle additional Excel columns
- Add validation for date formats (5 common formats), phone numbers (numeric/+/- only), and address length (500 chars max)
- Extend the frontend import form and preview components to display optional fields
- Leverage existing two-step import process (entry → preview → confirm) without architectural changes
- Database schema already supports these fields (organization.employee table lines 61-64)

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Vitest, React Testing Library (post-verification)

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: https://github.com/nvcnvn/flows (not used for this feature)
- Testing: Go testing, testify (post-verification)

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: Atlas (no migration needed - schema already has fields)
- Deployment: dev/prod overlays (no infra changes needed)

**Performance Goals**: 
- File parsing: <2s for 100-row Excel files
- Preview generation: <1s for 100 employees
- Import execution: <5s for 100 employees (including Zitadel calls)

**Constraints**: 
- Multi-tenant isolation: All queries MUST filter by `organization_id`
- Backward compatibility: Existing imports without optional fields MUST continue working
- Transaction atomicity: All-or-nothing import (Constitution v3.3.0 requirement)
- Optional field validation: Only validate when data is provided
- RBAC enforcement: Only `ROLE_OWNER` and `ROLE_OPERATOR` can import

**Scale/Scope**: 
- Max batch size: 100 employees per import (existing constraint)
- Extend 1 RPC service (IAMService)
- Modify 3 RPC methods (ParseEmployeeFile, PreviewEmployeeImport, ExecuteEmployeeImport)
- Add 4 optional protobuf fields
- Update 1 frontend feature module (workspace/organization)
- No new database tables (schema already complete)

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Schema-First & Multi-Tenant (NON-NEGOTIABLE)
- [x] **Schema already complete**: The `organization.employee` table (lines 58-68 in schema.sql) already contains all four optional fields:
  - `hire_date DATE` (line 61)
  - `date_of_birth DATE` (line 62)
  - `phone_number TEXT` (line 63)
  - `home_address TEXT` (line 64)
- [x] **No schema changes needed**: This feature only exposes existing columns through the import interface
- [x] **Multi-tenant isolation preserved**: All employee queries already filter by `organization_id` (RLS policy enabled)
- [x] **No migration required**: Database structure is already in place

**Status**: ✅ PASS - No schema modifications needed; leveraging existing multi-tenant structure

### Post-Verification Testing (NON-NEGOTIABLE)
- [x] **Implementation-first approach**: Core functionality (protobuf changes, parsing logic, validation) will be implemented first
- [x] **Human verification required**: Manual testing of date parsing, phone validation, and address handling before test creation
- [x] **Test types planned**:
  1. Unit tests: Date parsing functions, validation logic (after verification)
  2. Integration tests: End-to-end import with optional fields (after verification)
  3. Contract tests: RPC message structure validation (after verification)

**Status**: ✅ PASS - Following post-verification testing principle

### Backend Service Architecture Checks
- [x] **Service struct compliance**: `EmployeeImportService` already follows Constitution v3.3.0 pattern:
  - Has `AdminPool database.AdminDatabaseConnector` for identity creation
  - Has `TenantPool database.TenantDatabaseConnector` for duplicate checking
  - Uses `Queries *database.Queries` for sqlc methods
  - Includes `ZitadelClient *zitadelcli.Client`
- [x] **Transaction handling**: Existing `ExecuteEmployeeImport` uses `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [x] **Pool usage documented**: Service already documents why AdminPool (system-scope onboarding) vs TenantPool (duplicate checking)
- [x] **Method decomposition**: Existing methods already use helper functions (`validateEmployeeData`, `checkDuplicates`, etc.)
- [x] **No new methods needed**: Extending existing ParseEmployeeFile, PreviewEmployeeImport, ExecuteEmployeeImport methods

**Status**: ✅ PASS - Extending existing service that already complies with all backend architecture requirements

### Codegen & Generated-Client Checks
- [x] **Proto changes required**: Extending `EmployeeData` message with 4 optional fields
- [x] **Backend codegen step**: `cd backend && buf generate` (commit generated Go files)
- [x] **Frontend codegen step**: 
  - `cd frontend && pnpm -r build` to regenerate TypeScript protobuf types
  - Update `frontend/packages/rpc/index.ts` exports if new types added
  - Update `frontend/packages/apis/src/iam.ts` wrapper methods
- [x] **No SQL changes**: No `sqlc generate` needed (schema unchanged)

**Status**: ✅ PASS - Codegen steps identified and will be documented in implementation plan

### SQL & Data Safety Standards
- [x] **No SQL changes**: Feature uses existing `organization.employee` columns
- [x] **Tenant isolation**: All queries already include `organization_id` filters via RLS policies
- [x] **Connection pools**: AdminPool for identity creation, TenantPool for validation (already in use)
- [x] **sqlc integration**: Existing queries (`CreateEmployee`, `GetEmployeeByEmail`) already handle these fields

**Status**: ✅ PASS - No SQL modifications; existing queries support optional fields

### Observability, Simplicity & YAGNI
- [x] **Simple approach**: Extends existing import feature without adding complexity
- [x] **No premature optimization**: Uses existing file parsing and validation patterns
- [x] **Structured logging**: Existing service already logs operations with `slog.InfoContext`
- [x] **Observability plan**:
  - Logs: Parsing errors, validation failures, optional field usage stats
  - Metrics: Track how often optional fields are populated (can add later)
  - Owner: Same as existing employee import feature (IAM service owner)

**Status**: ✅ PASS - Minimal complexity, extends proven patterns

### Versioning, Breaking Changes & Review
- [x] **Non-breaking change**: Adding optional protobuf fields is backward compatible
- [x] **No migration plan needed**: Database schema already supports fields
- [x] **Contract test updates**: Will add tests for optional field scenarios (post-verification)
- [x] **Review requirements**: 
  - Standard 2 reviewers (1 maintainer)
  - No special DB/infra expertise required (schema unchanged)

**Status**: ✅ PASS - Backward compatible enhancement, standard review process

### Frontend Workspace Pattern (Constitution v3.4.0)
- [x] **Uses workspace layout**: Feature is part of existing `workspace/organization/` domain
- [x] **No duplicate layouts**: Extends existing organization import page
- [x] **Tab navigation**: Import accessed via Organization domain tab (already exists)
- [x] **Component organization**: 
  - Existing: `workspace/organization/components/ImportDialog.tsx`
  - Will extend form fields and preview display in existing components
- [x] **No new routes needed**: Uses existing `/workspace/organization?tab=employees` route

**Status**: ✅ PASS - Extends existing workspace feature, no structural changes

### Overall Assessment
**GATE STATUS**: ✅ **PASS** - All constitutional requirements satisfied

**Key Strengths**:
1. Database schema already prepared (no migration risk)
2. Service architecture already compliant (no refactoring needed)
3. Backward compatible protobuf extension (safe rollout)
4. Extends proven import patterns (low implementation risk)
5. No infrastructure changes required (simple deployment)

**Complexity Level**: **Low** - This is a straightforward extension of existing functionality with well-defined validation rules. No constitutional deviations.

## Project Structure

### Documentation (this feature)
```
specs/004-import-employee-with/
├── spec.md             # Feature specification (complete with clarifications)
├── plan.md             # This file (/plan command output)
├── research.md         # Phase 0 output (/plan command) - validation patterns
├── data-model.md       # Phase 1 output (/plan command) - field specifications
├── quickstart.md       # Phase 1 output (/plan command) - test scenarios
├── contracts/          # Phase 1 output (/plan command)
│   ├── iam.proto       # Extended EmployeeData message definition
│   └── validation.md   # Date parsing & validation rules
└── tasks.md            # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (Tech Office Monorepo)

**Backend Structure**:
```
backend/
├── database/
│   ├── scripts/
│   │   ├── schema.sql              # [NO CHANGE - fields already exist]
│   │   └── iam.query.sql           # [MAY EXTEND - if additional queries needed]
│   ├── models.go                   # [GENERATED - may add Go types for optional fields]
│   └── iam.query.sql.go            # [GENERATED - if new queries added]
├── internal/
│   └── iam/
│       ├── employee_import.go      # [MODIFY - extend parsing & validation]
│       │   # - ParseEmployeeFile: read 4 additional Excel columns
│       │   # - PreviewEmployeeImport: validate optional field formats
│       │   # - ExecuteEmployeeImport: pass optional fields to CreateEmployee
│       │   # - Add helper: parseDateField(value string) (time.Time, error)
│       │   # - Add helper: validatePhoneNumber(phone string) error
│       │   # - Add helper: validateAddress(addr string) error
│       └── employee_import_test.go # [ADD - post-verification tests]
│           # - Test date parsing (5 formats)
│           # - Test phone validation
│           # - Test address length
│           # - Test mixed optional/required field combinations
├── rpc/
│   └── v1/
│       ├── iam.proto               # [MODIFY - extend EmployeeData message]
│       │   # message EmployeeData {
│       │   #   string email = 1;
│       │   #   string given_name = 2;
│       │   #   string family_name = 3;
│       │   #   int32 row_number = 4;
│       │   #   // NEW OPTIONAL FIELDS:
│       │   #   optional string hire_date = 5;       // ISO 8601 date string
│       │   #   optional string date_of_birth = 6;   // ISO 8601 date string
│       │   #   optional string phone_number = 7;    // International format
│       │   #   optional string home_address = 8;    // Free-form text
│       │   # }
│       ├── iam.pb.go               # [GENERATED from iam.proto]
│       └── rpcv1connect/
│           └── iam.connect.go      # [GENERATED from iam.proto]

Database Schemas Involved: 
- iam: Core identity management (identity, identity_role)
- organization: Employee details (organization.employee - already has optional fields)

**Backend Service Structure Requirements**:
✅ EmployeeImportService already compliant with Constitution v3.3.0:
- Has AdminPool and TenantPool with documented usage
- Uses txn.WithTxn for transactions
- Methods already decomposed into validation helpers
- Proto-level access_control already configured (ROLE_OWNER, ROLE_OPERATOR)

**Code Generation Commands** (MUST run after proto changes):
```bash
# Backend: Generate Go protobuf code
cd backend && buf generate

# Verify generated files are committed in same PR
git add rpc/v1/iam.pb.go rpc/v1/rpcv1connect/iam.connect.go
```
```

**Frontend Structure**:
```
frontend/
├── packages/
│   ├── rpc/                        # [GENERATED - TypeScript protobuf types]
│   │   ├── index.ts                # [MODIFY - export new optional field types]
│   │   └── rpc/v1/
│   │       └── iam_pb.ts           # [GENERATED from backend proto]
│   └── apis/                       # [MODIFY - API client wrappers]
│       └── src/
│           └── iam.ts              # [MODIFY - extend wrapper methods]
│               # - parseEmployeeFile(): handle optional fields in response
│               # - previewEmployeeImport(): include optional fields in request
│               # - executeEmployeeImport(): pass optional fields
└── apps/
    └── web/
        └── src/
            └── app/
                └── workspace/
                    └── organization/   # [MODIFY - existing import feature]
                        ├── components/
                        │   ├── ImportDialog.tsx           # [MODIFY - add optional form fields]
                        │   │   # - Add date pickers for hire_date, date_of_birth
                        │   │   # - Add text field for phone_number (with format hint)
                        │   │   # - Add multiline text field for home_address
                        │   │   # - All fields optional with "(optional)" label
                        │   │   # - Add inline validation hints
                        │   ├── EmployeePreviewTable.tsx   # [MODIFY - display optional fields]
                        │   │   # - Add columns for optional fields
                        │   │   # - Show "—" for empty values
                        │   │   # - Format dates as "02 Jan 2022"
                        │   │   # - Highlight validation errors for optional fields
                        │   └── FileUploadSection.tsx     # [MAY MODIFY - show column hints]
                        │       # - Update column order documentation
                        │       # - Show optional columns in help text
                        └── components/
                            └── *.test.tsx              # [ADD - post-verification tests]
                                # - Test optional field rendering
                                # - Test validation error display
                                # - Test empty/null field handling

**Code Generation Commands** (MUST run after backend proto changes):
```bash
# Frontend: Regenerate TypeScript types from backend protos
cd frontend && pnpm -r build

# Verify generated files and manual API wrapper updates
git add packages/rpc/rpc/v1/iam_pb.ts
git add packages/apis/src/iam.ts  # Manual wrapper updates
```

**PR Checklist** (MUST include in description):
- [ ] `buf generate` (backend proto): committed ✅
- [ ] `frontend/packages/rpc` exports: updated ✅
- [ ] `frontend/packages/apis` wrappers: added optional field handling ✅
- [ ] `pnpm -r build` run: artifacts committed ✅
```

**Testing Structure** (post-verification):
```
backend/internal/iam/
├── employee_import_test.go         # [ADD after manual verification]
│   # - TestParseDateField_VariousFormats()
│   # - TestValidatePhoneNumber()
│   # - TestValidateAddress()
│   # - TestParseEmployeeFile_WithOptionalFields()
│   # - TestPreviewEmployeeImport_OptionalFieldValidation()
└── integration/
    └── employee_import_integration_test.go  # [ADD after manual verification]
        # - TestImportEmployees_WithAllOptionalFields()
        # - TestImportEmployees_WithPartialOptionalFields()
        # - TestImportEmployees_WithInvalidOptionalFields()

frontend/apps/web/src/app/workspace/organization/
└── components/
    ├── ImportDialog.test.tsx       # [ADD after manual verification]
    └── EmployeePreviewTable.test.tsx  # [ADD after manual verification]
```

**Structure Decision**: Extend existing full-stack employee import feature:
- Backend: Modify existing IAMService and EmployeeImportService
- Frontend: Enhance existing workspace/organization import components
- Database: No changes (schema already complete)
- RPC: Backward-compatible proto extension (optional fields)

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Tech Office Specific Research**:
   - **Database Schema Design**: Which domain schema(s) to use? New entities or extend existing?
   - **Multi-Tenant Isolation**: How to enforce `organization_id` constraints?
   - **Cross-Schema References**: Which central entities (`organization.employee`, `organization.customer`) to reference?
   - **RPC Contract Design**: New proto definitions or extend existing services?
   - **Zitadel Integration**: New roles/permissions needed? Project resource mappings?
   - **Frontend Patterns**: Reuse existing MUI theme? Auth context patterns?
   - **Subdomain Routing**: Impact on tenant-specific features?

3. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For existing patterns:
     Task: "Review Tech Office patterns for {area} in {domain}"
   For schema design:
     Task: "Analyze existing {domain} schema for extension points"
   ```

4. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen - reference existing Tech Office patterns]
   - Alternatives considered: [what else evaluated]
   - Existing patterns to follow: [reference specific files/implementations]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Database Schema Design** → `data-model.md`:
   - **Schema Selection**: Which domain schema(s) (iam, organization, finance, crm, support, etc.)?
   - **Entity Design**: 
     - Table name (plural, snake_case)
     - Primary key (UUID v7)
     - Foreign keys (organization_id REQUIRED for multi-tenant isolation)
     - Timestamps (created_at, updated_at, deleted_at for soft deletes)
     - JSONB fields for flexible metadata
   - **Relationships**:
     - References to central entities (organization.employee, organization.customer)
     - Cross-schema foreign keys
     - One-to-many, many-to-many relationships
   - **Indexes**: Performance-critical queries
   - **Constraints**: CHECK constraints, NOT NULL, UNIQUE
   - **Migration Strategy**: Atlas migration from schema.sql changes

2. **RPC Contract Design** → `/contracts/`:
   - **Protocol Buffer Definitions** (`.proto` files):
     - Service definitions with methods
     - Request/Response message types
     - Validation rules (buf validate)
     - RBAC annotations for access control
   - **Generated Code Locations**:
     - Backend: `backend/rpc/v1/[feature].pb.go`
     - Frontend: `frontend/packages/rpc/rpc/v1/[feature]_pb.ts`

3. **Backend Service Architecture**:
   - **Service Struct Design**:
     - Include `AdminPool database.AdminDatabaseConnector` for system-scope operations
     - Include `TenantPool database.TenantDatabaseConnector` for tenant-aware operations
     - Include `Queries *database.Queries` for sqlc-generated methods
     - Include external clients as needed (e.g., `ZClient *zitadelcli.Client`)
   - **Method Implementation**:
     - Document which pool each method uses (AdminPool vs TenantPool)
     - Use `TenantPool` for user-facing operations (default for most methods)
     - Use `AdminPool` for system operations (onboarding, background jobs, cross-tenant)
     - Always use `txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {...})` for transactions
     - Never manually call `Begin()`, `Commit()`, or `Rollback()`
   - **Tenant Isolation**:
     - TenantPool methods MUST validate organization context from auth token
     - AdminPool methods MUST document why system scope is required
     - All queries MUST include `organization_id` filters for tenant data

4. **API Endpoint Design** (if REST needed):
   - For each user action → endpoint
   - Follow ConnectRPC patterns for RPC
   - Authentication: Bearer token from Zitadel
   - Authorization: Check organization context + RBAC

5. **sqlc Query Design**:
   - SQL queries in `backend/database/scripts/[domain].query.sql`
   - Name queries: `-- name: GetFeatureByID :one`
   - Always include `organization_id` in WHERE clauses for tenant isolation
   - Use prepared statements (`:param` syntax)

6. **Frontend Component Design**:
   - Page components (`page.tsx`) with App Router patterns
   - Reuse existing MUI theme and components
   - Auth context integration (`useAuth()`)
   - Tenant check hooks (`useTenantCheck()`)
   - API client utilities in `packages/apis/`

7. **Generate contract tests** from contracts:
   - Backend: Go unit tests for service methods
   - Backend: Integration tests with test database
   - Frontend: Component tests with React Testing Library
   - E2E: Quickstart test scenarios

8. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Multi-tenant isolation verification
   - RBAC permission checks
   - Quickstart test = story validation steps

8. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh copilot`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to `.github/copilot-instructions.md`

**Output**: 
- `data-model.md` with complete schema design
- `/contracts/*.proto` for RPC definitions
- `/contracts/*.sql` for sqlc queries
- `quickstart.md` with test scenarios
- `.github/copilot-instructions.md` updated
- Failing test stubs (Go and TypeScript)

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
The /tasks command will load `.specify/templates/tasks-template.md` as the base template and generate tasks from the Phase 1 design artifacts (contracts, data-model.md, quickstart.md). Tasks will follow the Tech Office development workflow with implementation-first ordering (core functionality before tests, per Constitution v3.3.0 post-verification testing principle).

### Backend Task Sequence

**Protobuf Extension Tasks** (Foundation):
1. **[P] Extend EmployeeData message in `backend/rpc/v1/iam.proto`**
   - Add 4 optional fields: `hire_date`, `date_of_birth`, `phone_number`, `home_address`
   - Use `optional string` type for backward compatibility
   - Add detailed field comments with validation rules
   - Estimate: 15 minutes

2. **Generate protobuf code: `buf generate`** [depends on 1]
   - Run `cd backend && buf generate`
   - Commit generated files: `iam.pb.go`, `iam.connect.go`
   - Verify no compilation errors
   - Estimate: 5 minutes

**Validation Logic Tasks** (Core Functionality):
3. **[P] Implement date parsing helper in `employee_import.go`**
   - Add `parseDateField(value string, fieldName string) (*time.Time, error)` function
   - Support 5 date formats (YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY)
   - Handle empty strings (return nil, nil)
   - Return descriptive error with supported formats
   - Estimate: 30 minutes

4. **[P] Implement phone validation helper in `employee_import.go`** [parallel with 3]
   - Add `validatePhoneNumber(phone string) error` function
   - Regex pattern: `^[0-9+\-]{7,20}$`
   - Handle empty strings (return nil)
   - Return descriptive error for invalid characters/length
   - Estimate: 20 minutes

5. **[P] Implement address validation helper in `employee_import.go`** [parallel with 3,4]
   - Add `validateAddress(address string) error` function
   - UTF-8 character count (max 500)
   - Handle empty strings (return nil)
   - Return descriptive error with character count
   - Estimate: 15 minutes

**Parser Extension Tasks**:
6. **Extend ParseEmployeeFile to read optional columns** [depends on 2]
   - Update Excel column detection logic (case-insensitive header matching)
   - Map headers to optional fields: "hire date"→hire_date, "dob"→date_of_birth, etc.
   - Populate EmployeeData optional fields from Excel cells
   - Transmit as ISO 8601 strings for dates
   - Estimate: 45 minutes

7. **Extend PreviewEmployeeImport to validate optional fields** [depends on 3,4,5,6]
   - Call `parseDateField()` for hire_date and date_of_birth (if provided)
   - Call `validatePhoneNumber()` for phone_number (if provided)
   - Call `validateAddress()` for home_address (if provided)
   - Append validation errors to EmployeePreviewItem.validation_errors
   - Estimate: 30 minutes

8. **Extend ExecuteEmployeeImport to store optional fields** [depends on 7]
   - Convert protobuf optional strings to database types (pgtype.Date, pgtype.Text)
   - Pass optional fields to CreateEmployee query parameters
   - Preserve null vs empty string distinction
   - Estimate: 30 minutes

**Testing Tasks** (Post-Verification):
9. **Manual verification of core functionality** [depends on 8]
   - Test date parsing with various formats (see quickstart.md scenarios)
   - Test phone validation with valid/invalid formats
   - Test address length validation
   - Test end-to-end import with optional fields
   - Test backward compatibility (no optional fields)
   - Document any deviations or issues
   - Estimate: 2 hours

10. **Add unit tests for validation helpers** [depends on 9]
    - `TestParseDateField_AllFormats()` - all 5 supported formats
    - `TestParseDateField_InvalidFormats()` - edge cases
    - `TestValidatePhoneNumber_ValidFormats()` - international formats
    - `TestValidatePhoneNumber_InvalidFormats()` - spaces, parentheses, letters
    - `TestValidateAddress_LengthLimits()` - boundary testing
    - `TestValidateAddress_UTF8Characters()` - accents, non-Latin scripts
    - Estimate: 1.5 hours

11. **Add integration tests for employee import** [depends on 10]
    - `TestParseEmployeeFile_WithAllOptionalFields()` - end-to-end parsing
    - `TestParseEmployeeFile_WithNoOptionalFields()` - backward compatibility
    - `TestPreviewEmployeeImport_InvalidDates()` - validation error scenarios
    - `TestExecuteEmployeeImport_WithOptionalFields()` - database storage
    - Estimate: 2 hours

### Frontend Task Sequence

**Code Generation Tasks**:
12. **Rebuild frontend packages to regenerate TypeScript protobuf types** [depends on 2]
    - Run `cd frontend && pnpm -r build`
    - Verify `packages/rpc/rpc/v1/iam_pb.ts` includes optional fields
    - Update `packages/rpc/index.ts` exports if needed
    - Estimate: 10 minutes

13. **Update API client wrappers in `packages/apis/src/iam.ts`** [depends on 12]
    - Extend `parseEmployeeFile()` wrapper to handle optional fields in response
    - Extend `previewEmployeeImport()` wrapper to include optional fields in request
    - Extend `executeEmployeeImport()` wrapper to pass optional fields
    - Add TypeScript types for optional field validation
    - Estimate: 30 minutes

**UI Component Extension Tasks**:
14. **Extend ImportDialog form with optional field inputs** [depends on 13]
    - Add MUI DatePicker for hire_date (with label "Hire Date (optional)")
    - Add MUI DatePicker for date_of_birth (with label "Date of Birth (optional)")
    - Add MUI TextField for phone_number (with pattern hint and label "Phone Number (optional)")
    - Add MUI TextField (multiline) for home_address (with character counter "0/500" and label "Home Address (optional)")
    - Add client-side validation hints (optional - server-side is authoritative)
    - Estimate: 1 hour

15. **Extend EmployeePreviewTable to display optional fields** [depends on 13]
    - Add columns for Hire Date, Date of Birth, Phone, Address
    - Format dates as "02 Jan 2022" (unambiguous display)
    - Show "—" (em dash) for empty/null values
    - Highlight validation errors for optional fields (red text or icon)
    - Truncate address to 100 chars with "..." for preview
    - Estimate: 45 minutes

16. **Update FileUploadSection help text** [depends on 13]
    - Document optional column headers (case-insensitive matching)
    - Show example Excel structure with optional columns
    - Link to quickstart.md or inline validation rules
    - Estimate: 15 minutes

**Testing Tasks** (Post-Verification):
17. **Manual verification of frontend functionality** [depends on 14,15,16]
    - Test manual form entry with optional fields
    - Test file upload with optional fields
    - Test preview display of optional fields
    - Test validation error display for optional fields
    - Test backward compatibility (no optional fields)
    - Document UI/UX issues
    - Estimate: 1.5 hours

18. **Add component tests for optional field UI** [depends on 17]
    - `ImportDialog.test.tsx` - optional field inputs render correctly
    - `EmployeePreviewTable.test.tsx` - optional fields display correctly
    - Test validation error display for optional fields
    - Test empty/null field handling
    - Estimate: 1.5 hours

### Infrastructure & Documentation Tasks

19. **[P] Update API documentation** [parallel]
    - Document extended EmployeeData message in API docs (if exists)
    - Update import feature documentation with optional field instructions
    - Estimate: 30 minutes

20. **[P] Update user guide** [parallel]
    - Add section on optional fields to employee import guide
    - Include Excel template examples with optional columns
    - Document date format recommendations (YYYY-MM-DD preferred)
    - Document phone number format requirements
    - Estimate: 45 minutes

### Task Dependencies Summary
```
Backend Chain:
1 (proto) → 2 (buf gen) → 6 (parser) → 7 (preview) → 8 (execute) → 9 (manual test) → 10,11 (automated tests)
         ↘ 3,4,5 (validators, parallel) ↗

Frontend Chain:
2 (buf gen) → 12 (pnpm build) → 13 (API wrappers) → 14,15,16 (UI components, parallel) → 17 (manual test) → 18 (automated tests)

Documentation (parallel):
19,20 (docs, no dependencies)
```

### Estimated Total Effort
- **Backend**: 7.5 hours (including testing)
- **Frontend**: 5.5 hours (including testing)
- **Documentation**: 1.25 hours
- **Total**: ~14.25 hours (approx. 2 days for single developer)

### Task Ordering Principles
1. **Implementation-first**: Core functionality before tests (Constitution v3.3.0)
2. **Dependency order**: Foundation (protobuf) → Logic (validation) → Integration (parser/preview/execute) → Tests
3. **Backend before Frontend**: RPC contracts must exist before frontend can consume them
4. **Manual verification gate**: Automated tests only after human verification (post-verification testing)
5. **Parallel tasks marked [P]**: Can be worked on independently

### CI/CD Integration
- PR must include both generated code commits (buf generate, pnpm build)
- CI pipeline verifies:
  - `buf generate` output matches committed files (buf lint/format check)
  - `pnpm -r build` succeeds (frontend packages build)
  - `go test ./...` passes (all backend tests)
  - `pnpm test` passes (all frontend tests)
  - No breaking changes to existing employee import functionality

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan. The /plan command STOPS here.

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) ✅
  - Created: research.md with validation patterns, date format decisions, phone/address rules
  - Resolved: All technical unknowns from spec clarifications
  - Decision: Extend existing import feature, no schema changes needed
- [x] Phase 1: Design complete (/plan command) ✅
  - Created: data-model.md with field specifications and Go/TS type mappings
  - Created: contracts/iam.proto with extended EmployeeData message
  - Created: contracts/validation.md with detailed validation algorithms
  - Created: quickstart.md with 10 manual test scenarios
  - Verified: Database schema already supports all fields (no migration)
- [x] Phase 2: Task planning complete (/plan command - describe approach only) ✅
  - Described: 20 ordered tasks across backend, frontend, testing, documentation
  - Estimated: ~14.25 hours total effort (2 days for single developer)
  - Identified: Dependencies and parallel work opportunities
  - **Note**: Actual tasks.md generation happens via /tasks command
- [ ] Phase 3: Tasks generated (/tasks command) - **NEXT STEP**
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS ✅
  - Schema-first: No changes needed (fields already exist)
  - Post-verification testing: Implementation-first approach planned
  - Backend architecture: Service already compliant (AdminPool/TenantPool pattern)
  - Codegen: Protobuf extension identified, both backend and frontend steps documented
  - SQL safety: No SQL changes, existing queries support optional fields
  - Observability: Simple extension, structured logging already in place
  - Versioning: Backward-compatible protobuf optional fields
  - Frontend workspace: Extends existing workspace/organization feature
- [x] Post-Design Constitution Check: PASS ✅
  - Re-verified after Phase 1 design completion
  - No new violations introduced
  - Validation approach aligns with constitutional principles
  - Task ordering follows post-verification testing (manual → automated)
- [x] All NEEDS CLARIFICATION resolved ✅
  - Spec has comprehensive Clarifications section (Session 2025-10-26)
  - All validation rules defined (dates, phone, address)
  - All edge cases addressed in research and quickstart
- [x] Complexity deviations documented ✅
  - **No deviations**: This is a straightforward extension with low complexity
  - Leverages existing patterns (employee import service, validation helpers)
  - No new architectural patterns introduced

**Artifacts Generated**:
- ✅ `/specs/004-import-employee-with/research.md` (7 research areas, decision table, risk analysis)
- ✅ `/specs/004-import-employee-with/data-model.md` (field specs, validation rules, type mappings)
- ✅ `/specs/004-import-employee-with/contracts/iam.proto` (extended EmployeeData message)
- ✅ `/specs/004-import-employee-with/contracts/validation.md` (validation algorithms with code samples)
- ✅ `/specs/004-import-employee-with/quickstart.md` (10 test scenarios with expected results)
- ✅ `/specs/004-import-employee-with/plan.md` (this file)
- ⏳ `/specs/004-import-employee-with/tasks.md` (pending /tasks command execution)

**Ready for Next Phase**: ✅ YES
- All Phase 0-2 artifacts complete
- Constitution gates passed
- Implementation approach validated
- Test scenarios defined
- Dependencies identified
- **Action**: Run `/tasks` command to generate tasks.md

---
*Based on Constitution v3.4.0 - See `.specify/memory/constitution.md`*
