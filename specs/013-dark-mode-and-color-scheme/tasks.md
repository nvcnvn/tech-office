# Tasks: Unified Color Scheme System with Light/Dark Mode

**Input**: Design documents from `/Users/nvcnvn/Codes/tech-office/specs/013-dark-mode-and-color-scheme/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/preference.proto, quickstart.md

## Execution Flow (main)
```
1. Load plan.md from feature directory ✓
   → Tech stack: Next.js 15, MUI v5, Go 1.25+, PostgreSQL 16+, ConnectRPC
   → Structure: Web app (frontend + backend monorepo)
2. Load design documents ✓
   → data-model.md: iam.user_preference table
   → contracts/preference.proto: PreferenceService with 3 RPCs
   → research.md: MUI theme integration, localStorage + server-side storage
   → quickstart.md: 6 manual test scenarios
3. Generate tasks by category:
   → Setup: DB migration, proto contracts, codegen
   → Core: Backend service (2-layer), frontend theme system
   → Integration: RPC endpoints, theme provider, settings UI
   → Verification: Manual testing per quickstart scenarios
   → Tests: Backend integration tests (RPC client pattern)
   → Polish: Performance validation, accessibility audit
4. Task rules applied:
   → Different files = [P] for parallel
   → Codegen gates: sqlc before backend, buf before frontend
   → Manual verification before integration tests
5. Task numbering: T001-T040
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

---

## Phase 3.1: Setup & Database Migration

### Database Schema & Migration
- [X] T001 Create migration files in `backend/k8s/base/database/migrations/`:
  - `20251109120000_add_user_preference_table.up.sql` (CREATE TABLE iam.user_preference)
  - `20251109120000_add_user_preference_table.down.sql` (DROP TABLE)
  - Include all constraints, indexes, comments per data-model.md
  - Ensure Citus sharding compliance (organization_id in PK, indexes)

- [X] T002 Run migration script to apply schema changes:
  - Execute `cd backend && ./scripts/migrate.sh` with DATABASE_URL set
  - Verify iam.user_preference table created with correct structure
  - Resolve any dirty state with `migrate force <version>` if needed

- [X] T003 Update authoritative schema file:
  - Add iam.user_preference table definition to `backend/database/scripts/schema.sql`
  - Match exact DDL from migration file
  - Keep schema.sql synchronized for developer reference

### SQL Queries & Code Generation
- [X] T004 [P] Create sqlc query file `backend/database/scripts/iam.query.sql`:
  - `-- name: GetUserPreference :one` (SELECT by organization_id + employee_id)
  - `-- name: UpsertUserPreference :one` (INSERT ON CONFLICT DO UPDATE with parameterized timestamp)
  - `-- name: DeleteUserPreference :exec` (DELETE by organization_id + employee_id)
  - All queries MUST filter by organization_id for tenant isolation
  - Use parameterized timestamps in ON CONFLICT DO UPDATE (no now() function)

- [X] T005 Generate Go types from SQL queries:
  - Run `cd backend && sqlc generate`
  - Verify generated files: `backend/database/iam.query.sql.go`, updated `backend/database/models.go`
  - Commit generated artifacts

### Protocol Buffers Contract
- [X] T006 Copy proto contract to backend RPC directory:
  - Copy `specs/013-dark-mode-and-color-scheme/contracts/preference.proto` → `backend/rpc/v1/preference.proto`
  - Ensure imports correct (google/protobuf/timestamp.proto)
  - Verify enum values match backend constants and DB CHECK constraints

- [X] T007 Generate proto code for backend and frontend:
  - Run `cd backend && buf generate`
  - Verify backend generated: `backend/rpc/v1/preferencev1/preference.pb.go`, `backend/rpc/v1/rpcv1connect/preference.connect.go`
  - Verify frontend generated: `frontend/packages/rpc/src/gen/rpc/v1/preference_pb.ts`, `frontend/packages/rpc/src/gen/rpc/v1/preference_connect.ts`
  - Commit all generated artifacts

---

## Phase 3.2: Backend Core Implementation

### Backend Constants & Types
- [X] T008 [P] Create backend constants file `backend/internal/preference/constants.go`:
  - Theme mode constants: `ThemeModeLight = "light"`, `ThemeModeDark = "dark"`
  - Preference source constants: `PreferenceSourceManual = "manual"`, `PreferenceSourceOSDefault = "os_default"`
  - Must align with DB CHECK constraints and proto enums
  - Add validation helper: `func IsValidThemeMode(mode string) bool`

### Backend Service - Two-Layer Architecture (Constitution Principle III)
- [X] T009 Create Logic Layer in `backend/internal/preference/logic.go`:
  - Define `PreferenceLogic` interface with methods:
    - `GetUserPreference(ctx, tx database.DBTX, orgID, employeeID dbuuid.UUID) (*database.IamUserPreference, error)`
    - `UpsertUserPreference(ctx, tx database.DBTX, params UpsertParams) (*database.IamUserPreference, error)`
    - `DeleteUserPreference(ctx, tx database.DBTX, orgID, employeeID dbuuid.UUID) error`
  - Implement `preferenceLogic` struct with `queries *database.Queries` field only (NO pools)
  - Methods accept `tx database.DBTX` parameter for all DB operations
  - Pure business logic: validation, default values, timestamp handling
  - Return domain errors (not connect.Error)

- [X] T010 Create Connect Layer in `backend/internal/preference/service.go`:
  - Implement `PreferenceServiceServer` struct with:
    - `TenantPool database.TenantDatabaseConnector` (for user operations)
    - `logic PreferenceLogic` (business logic interface)
  - Implement RPC handlers:
    - `GetUserPreference(ctx, *connect.Request[v1.GetUserPreferenceRequest]) (*connect.Response[v1.GetUserPreferenceResponse], error)`
    - `UpdateUserPreference(ctx, *connect.Request[v1.UpdateUserPreferenceRequest]) (*connect.Response[v1.UpdateUserPreferenceResponse], error)`
    - `ResetUserPreference(ctx, *connect.Request[v1.ResetUserPreferenceRequest]) (*connect.Response[v1.ResetUserPreferenceResponse], error)`
  - Extract auth context: `orgID := interceptor.OrgIDFromContext(ctx)`, `employeeID := interceptor.EmployeeIDFromContext(ctx)`
  - Manage transactions: `txn.WithTxn(ctx, s.TenantPool, func(ctx, tx) error {...})`
  - Translate domain errors to `connect.Error` with proper codes
  - Use TenantPool for all operations (no AdminPool needed - user-scope only)

- [X] T011 Register PreferenceService in `backend/cmd/server.go`:
  - Initialize logic layer: `preferenceLogic := preference.NewLogic(queries)`
  - Wrap with connect layer: `preferenceSvc := preference.NewService(tenantPool, preferenceLogic)`
  - Register service: `mux.Handle(rpcv1connect.NewPreferenceServiceHandler(preferenceSvc))`
  - Add structured logging for service registration

---

## Phase 3.3: Backend Integration Tests (Constitution Principle II)

### Backend Integration Tests (REQUIRED - RPC Client Pattern)
- [X] T012 [P] Integration test for GetUserPreference in `backend/integration/preference_get_test.go`:
  - Use `GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)` to get test user
  - Create RPC client: `rpcv1connect.NewPreferenceServiceClient(http.DefaultClient, "http://localhost:18080")`
  - Call GetUserPreference with Authorization header (Bearer token)
  - Validate response: `exists=false` for new user, `exists=true` after upsert
  - Verify default values returned when preference doesn't exist

- [X] T013 [P] Integration test for UpdateUserPreference in `backend/integration/preference_update_test.go`:
  - Use `GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)` to get test user
  - Test theme mode toggle: light → dark → light
  - Test preference source: `manual` vs `os_default`
  - Verify upsert behavior (creates if not exists, updates if exists)
  - Validate response contains updated preference with correct timestamp

- [X] T014 [P] Integration test for ResetUserPreference in `backend/integration/preference_reset_test.go`:
  - Create preference record via UpdateUserPreference
  - Call ResetUserPreference to delete
  - Call GetUserPreference to verify `exists=false`
  - Validate success response

- [X] T015 [P] Integration test for multi-tenant isolation in `backend/integration/preference_multi_tenant_test.go`:
  - Create preferences for employees in different organizations
  - Verify each employee only sees their own preference
  - Validate organization_id filtering prevents cross-tenant access
  - Test with mismatched org tokens (should fail authorization)

---

## Phase 3.4: Frontend Theme System Implementation

### Frontend Package Updates
- [X] T016 Re-export PreferenceService from `frontend/packages/rpc/index.ts`:
  - Add exports for generated types and client
  - Follow existing pattern for other services

- [X] T017 Build frontend workspace packages:
  - Run `cd frontend && pnpm -r build`
  - Verify `packages/rpc` dist output includes preference types
  - Ensure workspace artifacts refreshed for dependent apps

### Frontend API Wrapper (Constitution Principle VII)
- [X] T018 [P] Create TypeScript types in `frontend/packages/apis/src/types.ts`:
  - `export type ThemeMode = 'light' | 'dark';`
  - `export type PreferenceSource = 'manual' | 'os_default';`
  - Custom interface `UserPreference` with native JavaScript types (Date not Timestamp)
  - Type guards: `isValidThemeMode(mode: string): mode is ThemeMode`

- [X] T019 [P] Create API wrapper in `frontend/packages/apis/src/preference.ts`:
  - Import RPC client from `packages/rpc`
  - Export wrapper functions:
    - `getUserPreference(): Promise<{preference: UserPreference, exists: boolean}>`
    - `updateUserPreference(themeMode: ThemeMode, source: PreferenceSource): Promise<UserPreference>`
    - `resetUserPreference(): Promise<boolean>`
  - Use `rpcCall` wrapper for error handling
  - Convert protobuf enums to TypeScript strings
  - Type assertions: `as UserPreference` when returning from rpcCall

- [X] T020 Export preference API from `frontend/packages/apis/src/index.ts`:
  - Re-export types and wrapper functions
  - Follow existing pattern for other domain APIs

### Frontend Theme Provider & Storage
- [X] T021 Create theme tokens file `frontend/apps/web/src/theme/tokens.ts`:
  - Define `lightTheme` and `darkTheme` objects using MUI's `createTheme()`
  - Include palette customization: primary, secondary, error, warning, info, success
  - Background colors: paper, default for light/dark variants
  - Text colors: primary, secondary, disabled
  - Ensure WCAG 2.1 Level AA compliance (4.5:1 contrast for normal text)

- [X] T022 Create localStorage utility `frontend/packages/apis/src/theme-storage.ts`:
  - `saveThemePreference(employeeId: string, theme: ThemeMode): void`
  - `loadThemePreference(employeeId: string): ThemeMode | null`
  - `clearThemePreference(employeeId: string): void`
  - `detectOSTheme(): ThemeMode` - Detect OS color scheme preference
  - Key pattern: `theme_preference_{employeeId}`
  - Handle localStorage errors gracefully (SSR compatibility)

- [X] T023 Create custom ThemeProvider in `frontend/apps/web/src/components/ThemeProvider.tsx`:
  - Wrap MUI ThemeProvider with custom logic
  - State: `themeMode`, `loading`, `initialized`
  - On mount: Load from localStorage (immediate), fetch from server (authoritative)
  - Merge server preference with localStorage on mismatch (server wins)
  - Provide `useTheme()` hook with: `themeMode`, `toggleTheme()`, `loading`
  - Detect OS preference using `window.matchMedia('(prefers-color-scheme: dark)')`
  - If first visit (no server preference), use OS preference and set `preference_source: 'os_default'`
  - Apply CSS transitions only after initial load (add/remove `no-transition` class)

- [X] T024 Add global CSS transitions in `frontend/apps/web/src/app/globals.css`:
  - `:root` transition for 700ms ease-in-out on: background-color, color, border-color, box-shadow
  - `.no-transition` class to disable transitions during initial load
  - Ensure no layout shift (avoid transitioning width, height, position)

### Frontend UI Components
- [X] T025 [P] Create theme toggle button component in `frontend/apps/web/src/components/ThemeToggle.tsx`:
  - Use MUI IconButton with sun/moon icons (light/dark)
  - Import `useTheme()` hook from ThemeProvider
  - Call `toggleTheme()` on click
  - Show loading state during API call (CircularProgress)
  - Add tooltip: "Switch to dark mode" / "Switch to light mode"
  - Include `data-testid="theme-toggle-button"`

- [X] T026 [P] Integrate theme toggle in header `frontend/apps/web/src/app/workspace/layout.tsx`:
  - Add ThemeToggle component to header toolbar
  - Position near user avatar (top right)
  - Ensure visible on all workspace pages

- [X] T027 Create settings page `frontend/apps/web/src/app/workspace/settings/page.tsx`:
  - Client-side component with `'use client'`
  - Auth guard: `useRequireAuth()` hook
  - Section for "Appearance" preferences
  - Radio buttons for theme selection: Light / Dark
  - Display current `preference_source` with Chip component: "Manual" or "OS Default"
  - "Reset to OS Default" button to call `resetUserPreference()`
  - Save button calls `updateUserPreference(selectedMode, 'manual')`
  - Add `data-testid` attributes for all interactive elements

- [X] T028 Create user avatar menu `frontend/apps/web/src/components/UserMenu.tsx`:
  - Created new UserMenu component with dropdown menu
  - Add menu item: "Settings" with gear icon
  - Navigate to `/workspace/settings` on click
  - Integrated in workspace layout replacing static avatar
  - Includes Profile and Logout menu items for future implementation

---

## Phase 3.5: Manual Verification (Quickstart Scenarios)

### Manual Testing Checklist (Human Verification Required)
- [ ] T029 Test Scenario 1: First Visit - OS Preference Detection
  - Clear localStorage and cookies
  - Set OS to dark mode
  - Sign in and verify dark theme applied immediately (no FOUT)
  - Check database: `preference_source = 'os_default'`
  - Test inverse: OS light mode → app light theme

- [ ] T030 Test Scenario 2: Manual Theme Toggle
  - Click theme toggle button in header
  - Verify 700ms smooth transition (not instant, not jarring)
  - Check localStorage updated immediately
  - Check database: `preference_source = 'manual'`
  - Verify toggle icon updates (sun ↔ moon)

- [ ] T031 Test Scenario 3: Cross-Page Consistency
  - Navigate through: organization, chat, notifications, search pages
  - Verify theme consistent across all sections
  - Check all UI elements: backgrounds, text, borders, shadows
  - Validate readability and contrast on all pages

- [ ] T032 Test Scenario 4: Settings Page Integration
  - Access settings from user avatar menu
  - Verify current theme selection highlighted
  - Change theme via radio buttons
  - Verify change reflects in header toggle and all pages
  - Test "Reset to OS Default" button

- [ ] T033 Test Scenario 5: Cross-Device Sync
  - Set theme to dark on Device A
  - Sign in on Device B
  - Verify dark theme applied on Device B (server-side sync)
  - Toggle theme on Device B → verify Device A syncs on reload

- [ ] T034 Test Scenario 6: Performance Validation
  - Open DevTools → Performance tab
  - Record theme toggle action
  - Verify main thread doesn't block > 100ms
  - Check CSS transition completes in ~700ms
  - Validate no layout shifts or reflows during transition

---

## Phase 3.6: Polish & Accessibility

- [ ] T035 Accessibility audit for theme system:
  - Run automated WCAG checker (e.g., axe DevTools)
  - Verify 4.5:1 contrast ratio for normal text (both themes)
  - Verify 3:1 contrast ratio for large text and UI components
  - Test keyboard navigation: focus indicators visible in both themes
  - Test screen reader: theme toggle announces state change

- [ ] T036 [P] Add structured logging for preference operations:
  - Backend: Log preference updates, resets, failures with employee_id
  - Frontend: Log theme changes, storage errors, API failures
  - Use `slog.DebugContext` for preference reads
  - Use `slog.InfoContext` for preference updates
  - Use `slog.ErrorContext` for API/storage failures

- [ ] T037 [P] Performance optimization:
  - Minimize theme provider re-renders (use React.memo if needed)
  - Debounce rapid theme toggle clicks (prevent API spam)
  - Optimize CSS transitions (use transform instead of layout properties)
  - Validate theme preference load doesn't block initial page render

- [ ] T038 [P] Update documentation:
  - Add theme system overview to `specs/013-dark-mode-and-color-scheme/README.md`
  - Document localStorage key pattern and server-side storage
  - Add troubleshooting guide for theme sync issues
  - Update API docs with PreferenceService endpoints

- [ ] T039 Verify all interactive UI elements have data-testid attributes:
  - Theme toggle button: `data-testid="theme-toggle-button"`
  - Settings page radio buttons: `data-testid="theme-radio-light"`, `data-testid="theme-radio-dark"`
  - Settings save button: `data-testid="settings-save-button"`
  - Reset button: `data-testid="theme-reset-button"`
  - Run automated scan for missing test IDs

- [ ] T040 Final smoke test:
  - Deploy to dev environment
  - Test all scenarios from quickstart.md
  - Verify no console errors or warnings
  - Validate theme persistence after server restart
  - Check multi-tenant isolation (different orgs, different preferences)
  - Confirm smooth 700ms transitions on all supported browsers

---

## Dependencies

### Sequential Dependencies (Blocking)
- **T001 → T002**: Migration files must exist before running migrate.sh
- **T002 → T003**: Schema applied before updating schema.sql
- **T003 → T004**: Schema.sql updated before writing queries
- **T004 → T005**: Query file created before sqlc generate
- **T006 → T007**: Proto file copied before buf generate
- **T005, T007 → T008-T011**: Generated code ready before backend implementation
- **T009 → T010**: Logic layer interface defined before Connect layer
- **T010 → T011**: Service implemented before registration in main
- **T007 → T016-T020**: Proto generated before frontend API wrapper
- **T016 → T017**: RPC exports added before building workspace
- **T017 → T018-T020**: Workspace built before using types in API wrapper
- **T021 → T023**: Theme tokens defined before ThemeProvider
- **T022 → T023**: Storage utility ready before ThemeProvider uses it
- **T023 → T025-T028**: ThemeProvider ready before UI components
- **T025 → T026**: Toggle component ready before header integration
- **T027 → T028**: Settings page ready before adding menu link
- **T011, T026, T028 → T029-T034**: Implementation complete before manual verification
- **T029-T034 → T035-T040**: Manual verification complete before polish

### Parallel Execution Groups

#### Group 1: Database Setup (after T003)
```bash
# T004 can run independently
Task: "Create sqlc query file backend/database/scripts/iam.query.sql"
```

#### Group 2: Backend Constants (after T007)
```bash
# T008 can run independently
Task: "Create backend constants file backend/internal/preference/constants.go"
```

#### Group 3: Backend Integration Tests (after T011)
```bash
# T012-T015 test different endpoints, different files
Task: "Integration test GetUserPreference in backend/integration/preference_get_test.go"
Task: "Integration test UpdateUserPreference in backend/integration/preference_update_test.go"
Task: "Integration test ResetUserPreference in backend/integration/preference_reset_test.go"
Task: "Integration test multi-tenant isolation in backend/integration/preference_multi_tenant_test.go"
```

#### Group 4: Frontend Types & Wrappers (after T017)
```bash
# T018-T020 are different files, no dependencies
Task: "Create TypeScript types in frontend/packages/apis/src/types.ts"
Task: "Create API wrapper in frontend/packages/apis/src/preference.ts"
Task: "Export preference API from frontend/packages/apis/src/index.ts"
```

#### Group 5: Frontend UI Components (after T023)
```bash
# T025, T027 are different components
Task: "Create theme toggle button in frontend/apps/web/src/components/ThemeToggle.tsx"
Task: "Create settings page frontend/apps/web/src/app/workspace/settings/page.tsx"
```

#### Group 6: Polish Tasks (after T034)
```bash
# T036-T038 are independent polish tasks
Task: "Add structured logging for preference operations"
Task: "Performance optimization: debounce, memoization, CSS"
Task: "Update documentation and troubleshooting guide"
```

---

## Task Execution Example

### Sequential Execution (Critical Path)
```bash
# Phase 3.1: Database Setup
Task T001: Create migration files
Task T002: Run migrate.sh
Task T003: Update schema.sql
Task T004: Create iam.query.sql
Task T005: Run sqlc generate

# Phase 3.1: Proto Setup
Task T006: Copy preference.proto
Task T007: Run buf generate

# Phase 3.2: Backend Implementation
Task T008: Create constants.go
Task T009: Create logic.go (Logic Layer)
Task T010: Create service.go (Connect Layer)
Task T011: Register service in cmd/server.go
```

### Parallel Execution Examples
```bash
# After T011: Launch backend integration tests in parallel
Task T012: "Integration test GetUserPreference"
Task T013: "Integration test UpdateUserPreference"
Task T014: "Integration test ResetUserPreference"
Task T015: "Integration test multi-tenant isolation"

# After T017: Launch frontend type/wrapper creation in parallel
Task T018: "Create TypeScript types.ts"
Task T019: "Create API wrapper preference.ts"
Task T020: "Export from apis/index.ts"

# After T023: Launch UI components in parallel
Task T025: "Create ThemeToggle component"
Task T027: "Create settings page"

# After T034: Launch polish tasks in parallel
Task T036: "Add logging"
Task T037: "Performance optimization"
Task T038: "Update documentation"
```

---

## Notes

### Constitution Compliance
- ✅ **Principle I (Multi-Tenancy)**: iam.user_preference uses composite PK (organization_id, id), all queries filter by organization_id
- ✅ **Principle II (Testing)**: Backend integration tests use RPC client pattern with dev tokens, no frontend unit tests
- ✅ **Principle III (Two-Layer Architecture)**: PreferenceLogic (business logic) + PreferenceServiceServer (Connect layer)
- ✅ **Principle IV (Cross-Domain)**: No cross-domain dependencies (preference service is self-contained in iam schema)
- ✅ **Principle VII (API Wrapper Pattern)**: Frontend uses custom TypeScript interfaces, wraps RPC calls, converts proto types to native JS
- ✅ **Principle VIII (Constant Sync)**: Theme mode constants aligned across DB CHECK, backend constants, proto enums, frontend types
- ✅ **Principle IX (UUID v7)**: Primary key uses uuidv7(), nullable parameters use dbuuid.NullUUID where applicable

### Generated Artifacts Tracking
- **T005**: sqlc generate produces `iam.query.sql.go`, updated `models.go`
- **T007**: buf generate produces backend proto + connect files, frontend TypeScript client
- **T017**: pnpm build refreshes workspace package artifacts for dependent apps

### Code Review Checklist
- [ ] All tenant queries include organization_id filter
- [ ] Backend service uses TenantPool (no AdminPool needed)
- [ ] Logic layer accepts tx parameter, Connect layer manages transactions
- [ ] Proto enum values match backend constants and DB CHECK constraints
- [ ] Frontend API wrapper uses custom types (not raw proto types)
- [ ] All interactive UI elements have data-testid attributes
- [ ] 700ms CSS transitions use transform (not layout properties)
- [ ] localStorage errors handled gracefully (SSR compatibility)
- [ ] WCAG 2.1 Level AA contrast ratios validated

### Performance Targets
- Theme toggle perceived latency: < 100ms (NFR-001)
- CSS transition duration: 700ms (FR-016)
- Theme preference load: Non-blocking for initial page render
- localStorage read: Synchronous (immediate theme application)

### Testing Strategy
- **Backend**: Integration tests with RPC client + dev tokens (T012-T015)
- **Frontend**: Manual testing per quickstart scenarios (T029-T034)
- **E2E**: Not included (deferred to future comprehensive E2E test suite)

---

**Ready for Execution**: All tasks ordered by dependencies, parallel groups identified, codegen steps gated correctly per Constitution v5.4.1.
