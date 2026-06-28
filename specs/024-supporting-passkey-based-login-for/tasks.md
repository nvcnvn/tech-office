# Tasks: Org-Managed User Accounts with PIN-Based Login

**Input**: Design documents from `/specs/024-supporting-passkey-based-login-for/`
**Branch**: `024-supporting-passkey-based-login-for`
**Prerequisites**: plan.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

---

## Phase 3.1: Setup

- [X] **T001** Create DB migration file `backend/database/scripts/migrations/NNNN_org_managed_accounts.up.sql` with:
  - `ALTER TABLE iam.user ALTER COLUMN email DROP NOT NULL`
  - `ALTER TABLE iam.user ADD COLUMN is_org_managed BOOLEAN NOT NULL DEFAULT FALSE`
  - Drop and recreate `idx_user_email` as partial unique index (`WHERE email IS NOT NULL`)
  - `ALTER TABLE iam.identity ALTER COLUMN email DROP NOT NULL`
  - `ALTER TABLE iam.identity ADD COLUMN login_identifier TEXT`
  - `ALTER TABLE iam.identity ADD CONSTRAINT identity_has_identifier CHECK (...)`
  - Partial unique index for `(organization_id, login_identifier) WHERE login_identifier IS NOT NULL`
  - Partial unique index for `(organization_id, email) WHERE email IS NOT NULL` (replaces old index)
  - `CREATE TABLE iam.credential (...)` with Citus distribution
  - `CREATE TABLE iam.account_lockout (...)` with Citus distribution
  - Apply all comments from data-model.md
  - Pair with `.down.sql` that reverses all changes

- [X] **T002** Apply schema changes to `backend/database/scripts/schema.sql` (in-place edits mirroring migration):
  - Update `iam.user` column definitions
  - Add `iam.credential` and `iam.account_lockout` table blocks
  - Add permission seed for `iam.manageOrgAccounts` in `public.default_role_permission`
  - Add backfill INSERT for existing owner roles in `iam.role_permission`

- [X] **T003** Add sqlc queries to `backend/database/scripts/iam.query.sql` from `contracts/iam_org_accounts.query.sql`:
  - `GetIdentityByOrgAndLoginIdentifier`
  - `GetOrgBySubdomain`
  - `CreateCredential`, `GetActiveCredential`, `RevokeCredentialsByIdentityAndType`, `ActivateTemporaryCredential`
  - `GetAccountLockout`, `UpsertAccountLockout`, `ResetAccountLockout`, `DeleteAccountLockout`
  - `CreateIdentityWithLoginIdentifier`, `CreateOrgManagedUser`
  - `DeactivateUser`, `ReactivateUser`
  - `ListOrgManagedAccounts`, `GetOrgManagedAccountCount`
  - `InvalidateAllUserSessionsForDeactivation`
  - `GetEmployeePersonalInfo`
  - Run `cd backend && sqlc generate` and verify generated Go code compiles

---

## Phase 3.1.5: Test Scenario Composition — DONE (Phase 1.5)

Test scenarios already scaffolded in `backend/integration/org_managed_accounts_test.go` (36 scenarios, 7 top-level `t.Run` groups). Review before proceeding.

- [X] **T003a** Developer review of `backend/integration/org_managed_accounts_test.go`:
  - Verify 8 scenario groups cover: account creation, temporary PIN login, PIN set, personal PIN login, lockout tiers, admin unlock, deactivation, credential reset, batch create, PIN validation, permissions, email/PIN coexistence
  - Confirm `t.Skip("TODO: implement after scenario review")` stubs are present on all leaf cases
  - Approve test scenarios before implementation begins

---

## Phase 3.2: Core Implementation

### Proto Error Details (FIRST — shared between backend and frontend)

- [X] **T004** Define proto error detail messages in a new file `backend/rpc/v1/iam_error_details.proto`:
  ```proto
  // PinAuthErrorDetail — attached to RESOURCE_EXHAUSTED for lockout errors.
  // Frontend reads: lockout_until_unix (for countdown), tier (for UX copy), admin_reset_required.
  message PinAuthErrorDetail {
    int32  lockout_tier          = 1;
    int64  lockout_until_unix    = 2; // Unix seconds; 0 when admin_reset_required=true
    bool   admin_reset_required  = 3;
  }
  ```
  - Re-use **standard** `google.rpc` error details from `google/rpc/error_details.proto` for field validation and resource conflicts:
    - `BadRequest.FieldViolation` → PIN format/complexity errors (field: `"new_pin"`)
    - `ResourceInfo` → duplicate `login_identifier` on create
    - `ErrorInfo` (reason: `"PIN_ACCOUNT_LOCKED"`, domain: `"iam.tech-office"`) → tier-4 full lock
  - Custom `PinAuthErrorDetail` only for lockout tiers 1–3 (carries retry-until timestamp)
  - Run `cd backend && buf generate` to produce Go + TypeScript code

- [X] **T005** [P] Add error detail helpers to `backend/internal/iam/errors.go`:
  - New domain errors:
    - `ErrPINTooShort`, `ErrPINNotNumeric`, `ErrPINMatchesDOB`, `ErrPINMatchesPhone`
    - `ErrAccountLocked` (carries lockout tier + until time — use a struct error type)
    - `ErrAccountFullyLocked` (tier 4, admin reset required)
    - `ErrDuplicateLoginIdentifier`
    - `ErrTemporaryPINExpired`, `ErrInvalidPINChangeToken`
    - `ErrWorkerAccountSuspended`
  - Extend `ToConnectError` to attach structured details using `connectrpc.com/connect` error detail API:
    - Lockout tiers 1–3 → `connect.CodeResourceExhausted` + attach `PinAuthErrorDetail` proto detail
    - Tier 4 full lock → `connect.CodeResourceExhausted` + attach `PinAuthErrorDetail` (admin_reset_required=true) + `ErrorInfo`
    - PIN validation errors → `connect.CodeInvalidArgument` + attach `BadRequest.FieldViolation`
    - Duplicate identifier → `connect.CodeAlreadyExists` + attach `ResourceInfo`
  - Import `google.golang.org/genproto/googleapis/rpc/errdetails` (already in go.mod as indirect; promote to direct if needed)

- [X] **T006** [P] Create `frontend/packages/apis/src/errorDetails.ts`:
  - Implement source file matching the compiled contract in `dst/src/errorDetails.d.ts`
  - Import `RetryInfoSchema`, `BadRequestSchema`, `ErrorInfoSchema`, `ResourceInfoSchema` from `@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb`
  - Import generated `PinAuthErrorDetailSchema` from the buf-generated TS package once T004 buf generate runs
  - Export:
    ```ts
    extractRetryInfo(error: unknown): RetryDetail | null
    extractFieldViolations(error: unknown): FieldViolation[] | null
    extractErrorInfo(error: unknown): ErrorInfoDetail | null
    extractResourceInfo(error: unknown): ResourceInfoDetail | null
    extractPinAuthErrorDetail(error: unknown): PinAuthErrorDetail | null
    ```
  - Use `ConnectError.from(error).findDetails(SchemaType)` pattern (same as chat.ts)
  - Export `PinAuthErrorDetail` TS interface:
    ```ts
    interface PinAuthErrorDetail {
      lockoutTier: number;
      lockoutUntilUnix: bigint; // 0n when adminResetRequired=true
      adminResetRequired: boolean;
    }
    ```
  - Export all types: `RetryDetail`, `FieldViolation`, `ErrorInfoDetail`, `ResourceInfoDetail`, `PinAuthErrorDetail`

- [X] **T007** Update `frontend/packages/apis/src/rpcWrapper.ts`:
  - Remove `Code.ResourceExhausted` from the `NetworkError` fallback switch — let it bubble as a raw `ConnectError` so callers (PIN login handler) can extract lockout details via `extractPinAuthErrorDetail`
  - Add JSDoc noting that callers of PIN-auth endpoints must handle `ConnectError` with code `ResourceExhausted` directly

- [X] **T008** Export `errorDetails` helpers from `frontend/packages/apis/src/index.ts`:
  - Add export of all functions and types from `./errorDetails`

### Backend: Business Logic Layer

- [X] **T009** Create `backend/internal/iam/logic_org_accounts.go` — new file extending `IAMLogic` interface:
  - `LoginWithPIN(ctx, tx, orgID, loginIdentifier, pin string) (LoginWithPINResult, error)`:
    - Fetch identity by `(orgID, loginIdentifier)` → `ErrUserNotFound` if missing
    - Check `iam.account_lockout` → return typed `ErrAccountLocked{tier, until}` or `ErrAccountFullyLocked`
    - Fetch active credential via `GetActiveCredential` → check `credential_type=pin`, check expiry
    - `bcrypt.CompareHashAndPassword` → on failure: `UpsertAccountLockout` with new tier; return error
    - On success: `ResetAccountLockout`; if `state=temporary` return `PINChangeRequired=true` + short-lived pin_change_token; else issue full JWT
  - `SetPIN(ctx, tx, orgID, identityID, newPIN string, isFirstSet bool) error`:
    - Validate `newPIN`: 6 digits, numeric only → `ErrPINTooShort` / `ErrPINNotNumeric`
    - Load employee personal info from `GetEmployeePersonalInfo` → validate not DOB / phone prefix → `ErrPINMatchesDOB` / `ErrPINMatchesPhone`
    - Fetch active/temporary credential; `ActivateTemporaryCredential` with bcrypt hash of new PIN
  - `CreateOrgAccount(ctx, tx, orgID string, req CreateOrgAccountParams) (CreateOrgAccountResult, error)`:
    - Generate shared UUID via `dbuuid.Must()`
    - `CreateOrgManagedUser` → `CreateIdentityWithLoginIdentifier` → `CreateEmployee` (existing) → `CreateCredential` (state=temporary, 6-digit PIN) → assign default employee role
    - Return plaintext temporary PIN (only returned once, never stored)
  - `DeactivateOrgAccount(ctx, tx, orgID, identityID string) error`: `DeactivateUser` + `InvalidateAllUserSessionsForDeactivation`
  - `UnlockOrgAccount(ctx, tx, orgID, identityID string, resetPIN bool) (*string, error)`: `ResetAccountLockout` + optionally `RevokeCredentialsByIdentityAndType` + `CreateCredential` with fresh temp PIN
  - `ResetOrgAccountCredential(ctx, tx, orgID, identityID string) (string, error)`: revoke existing + create new temp + `InvalidateAllUserSessionsForDeactivation`
  - `ListOrgAccounts(ctx, tx, orgID string, cursor *string, limit int, statusFilter *string) ([]OrgAccountRow, error)`

- [X] **T010** Add lockout constants and PIN validation helpers to `backend/internal/iam/constants.go` (new file if not exists):
  - Lockout tier table: `[3: 1min, 4: 5min, 5: 15min, 6+: full_lock]`
  - `GenerateTemporaryPIN() string` — crypto/rand 6-digit numeric string
  - `ValidatePINFormat(pin string) error`
  - `ComparePINWithPersonalData(pin, dob, phone string) error`

### Backend: Connect (RPC Handler) Layer

- [X] **T011** Add new RPC methods to `backend/rpc/v1/iam.proto`:
  - Copy all `rpc` method signatures and messages from `contracts/iam_org_accounts.proto`
  - Ensure `access_control` options match (allow_unauthenticated for LoginWithPIN, iam.manageOrgAccounts for admin ops, iam.changePassword for SetPIN)
  - Run `cd backend && buf generate`

- [X] **T012** Create `backend/internal/iam/connect_org_accounts.go` — Connect handler methods:
  - Implement `LoginWithPIN(ctx, req)`: resolve org from subdomain using AdminPool's `GetOrgBySubdomain`; open TenantPool tx; call `logic.LoginWithPIN`; map errors via `ToConnectError`
  - Implement `SetPIN(ctx, req)`: validate pin_change_token or require standard auth; open TenantPool tx; call `logic.SetPIN`; map errors
  - Implement `CreateOrgAccount(ctx, req)`: auth; TenantPool tx; call `logic.CreateOrgAccount`
  - Implement `BatchCreateOrgAccounts(ctx, req)`: iterate, call CreateOrgAccount per row in separate txns; collect success/failure results
  - Implement `DeactivateOrgAccount(ctx, req)`: auth; call `logic.DeactivateOrgAccount`
  - Implement `UnlockOrgAccount(ctx, req)`: auth; call `logic.UnlockOrgAccount`
  - Implement `ResetOrgAccountCredential(ctx, req)`: auth; call `logic.ResetOrgAccountCredential`
  - Implement `ListOrgAccounts(ctx, req)`: auth; call `logic.ListOrgAccounts`
  - All error returns go through `ToConnectError` (which now attaches structured proto error details per T005)

- [X] **T013** Register new handler methods on the `IAMServiceConnect` server in `backend/cmd/server.go` or wherever the IAM handler is wired up

### Frontend: API Wrapper & PIN Login Page

- [X] **T014** Create `frontend/packages/apis/src/iam-org-accounts.ts`:
  - Import `iamClient` from `./rpc`
  - Import `PinAuthErrorDetail`, `extractPinAuthErrorDetail`, `extractFieldViolations` from `./errorDetails`
  - `loginWithPIN(subdomain, loginIdentifier, pin)`:
    - Call via raw `iamClient.loginWithPIN(...)` (do NOT use `rpcCall` wrapper for this — handle `ConnectError` directly)
    - On `ResourceExhausted`: extract `PinAuthErrorDetail`, throw `AccountLockedError(detail)` (new error class)
    - On `Unauthenticated`: throw `AuthError("INVALID_PIN", ...)`
    - On success: return `{ accessToken, expiresAt, pinChangeRequired, pinChangeToken }`
  - `setPIN(newPin, opts?: { pinChangeToken?: string, currentPin?: string })`: wrap with `rpcCall`; catch `InvalidArgument` + `extractFieldViolations` → throw `PINValidationError(violations)`
  - `createOrgAccount(req)`: wrap with `rpcCall`
  - `batchCreateOrgAccounts(accounts)`: wrap with `rpcCall`
  - `deactivateOrgAccount(id)`: wrap with `rpcCall`
  - `unlockOrgAccount(id, resetPIN)`: wrap with `rpcCall`
  - `resetOrgAccountCredential(id)`: wrap with `rpcCall`
  - `listOrgAccounts(opts)`: wrap with `rpcCall`
  - Add `AccountLockedError` and `PINValidationError` to `frontend/packages/apis/src/errors.ts`

- [X] **T015** Export new module from `frontend/packages/apis/src/index.ts`:
  - Add `export * from './iam-org-accounts'`

- [X] **T016** [P] Add workspace tab in `frontend/apps/web/src/app/workspace/layout.tsx`:
  - Add "Accounts" (or "Worker Accounts") tab linking to `/workspace/org-accounts`
  - Gate display on `iam.manageOrgAccounts` permission (use existing permission hook)

- [X] **T017** [P] Create PIN login page at `frontend/apps/web/src/app/login/pin/page.tsx`:
  - `'use client'` component
  - Three-step form: (1) org subdomain, (2) login identifier, (3) PIN entry
  - On `AccountLockedError`: display lockout timer using `lockoutUntilUnix`, show "contact admin" if `adminResetRequired=true`
  - On `pinChangeRequired=true`: redirect to `/login/pin/set-pin` with `pin_change_token` in state
  - On success: store token, redirect to workspace

- [X] **T018** [P] Create set-PIN page at `frontend/apps/web/src/app/login/pin/set-pin/page.tsx`:
  - PIN input with 6-digit numeric validation (client-side)
  - Call `setPIN` with `pin_change_token` from navigation state
  - On `PINValidationError`: display field violations from `extractFieldViolations`
  - On success: store full token, redirect to workspace

- [X] **T019** [P] Create org accounts management page `frontend/apps/web/src/app/workspace/org-accounts/page.tsx`:
  - Auth guard via `useRequireAuth` + `iam.manageOrgAccounts` permission
  - Tab navigation: "All Accounts", "Locked", "Deactivated"
  - Table: login_identifier, display_name, account_status, pin_configured, last_login_at, actions
  - "Create Account" dialog → calls `createOrgAccount` → shows temporary PIN in a copy prompt
  - "Batch Import" drawer → CSV-style input → calls `batchCreateOrgAccounts` → shows results table with per-row pins
  - Row actions: Unlock (with optional PIN reset), Deactivate, Reset Credentials

---

## Phase 3.3: Integration

- [X] **T020** Run DB migration: `cd backend && ./scripts/migrate.sh up`; verify tables in `docker compose exec postgres psql -U postgres -d tech_office_db -c "\d iam.credential"`

- [X] **T021** Verify `buf generate` output compiles end-to-end:
  - `cd backend && go build ./...`
  - Check `frontend/packages/rpc/rpc/v1/iam_error_details_pb.ts` generated correctly

- [X] **T022** Verify `iam.manageOrgAccounts` permission appears in `public.default_role_permission` after migration:
  ```sh
  docker compose exec postgres psql -P pager -U postgres -d tech_office_db \
    -c "select * from public.default_role_permission where permission_id = 'iam.manageOrgAccounts'"
  ```

---

## Phase 3.4: Integration Tests & Verification

- [X] **T023** Implement integration tests in `backend/integration/org_managed_accounts_test.go` — replace all `t.Skip("TODO")` stubs:
  - **Account creation group**: Create account → verify response has id/login_identifier/temporary_pin; check worker appears in ListOrgAccounts; check default employee role assigned; try duplicate login_identifier → expect `AlreadyExists` + `ResourceInfo` detail
  - **Temporary PIN login group**: LoginWithPIN with temp PIN → verify `pin_change_required=true` and `pin_change_token`; try reuse of same temp PIN after first use → expect error; create expired temp credential and try → expect `Unauthenticated`
  - **SetPIN group**: Call SetPIN with pin_change_token → verify JWT issued with org context; verify credential state = 'active'; decode JWT and compare structure with email-based user token
  - **Personal PIN login group**: LoginWithPIN with personal PIN → `pin_change_required=false`, valid JWT; use that JWT to call a protected endpoint (e.g., ListOrgAccounts for owner)
  - **Lockout group**: Call LoginWithPIN with wrong PIN 3x → verify `ResourceExhausted` + `PinAuthErrorDetail{lockout_tier:1}`; 4th wrong → tier 2, 5 min; 5th wrong → tier 3, 15 min; 6th wrong → tier 4 full lock + `ErrorInfo{reason:"PIN_ACCOUNT_LOCKED"}`; try correct PIN after full lock → still `ResourceExhausted`; successful login after tier-1 wait → lockout record reset to 0
  - **Admin unlock group**: Unlock locked account → verify lockout cleared, worker can log in; unlock with `reset_pin=true` → verify temporary_pin returned, old PIN invalidated
  - **Deactivation group**: Deactivate account → verify sessions invalidated; try LoginWithPIN → expect `PermissionDenied`; account shows as "deactivated" in ListOrgAccounts
  - **Credential reset group**: ResetOrgAccountCredential → old PIN rejected, new temp PIN provided; SetPIN flow works with new temp PIN
  - **Batch create group**: BatchCreateOrgAccounts × 3 → success_count=3, each with temp_pin; re-run with duplicate → failure_count=1, error in result; each can log in independently
  - **PIN validation group**: SetPIN with "12345" → `BadRequest.FieldViolation{field:"new_pin"}`; "1234567" → same; "abcdef" → same; PIN matching DOB YYMMDD → same; PIN matching phone last 6 → same
  - **Permission group**: Employee without manageOrgAccounts calls CreateOrgAccount → `PermissionDenied`; owner calls → success
  - **Coexistence group**: Existing email user calls Login → still works; both user types call ListEmployees with their JWT → both succeed; permission resolution returns same result structure

- [X] **T024** Run ENTIRE integration test suite — ALL must pass (zero failures):
  ```sh
  cd backend && go test ./integration/... -v -timeout 5m 2>&1 | tail -50
  ```
  Fix any regressions before continuing.

- [X] **T025** Manual verification per quickstart.md scenarios 1–8:
  - Scenario 1: Admin creates single worker — verify temporary PIN in response
  - Scenario 2: Worker logs in with temp PIN — verify `pin_change_required=true`
  - Scenario 3: Worker sets personal PIN — verify full JWT returned
  - Scenario 4: Worker logs in with personal PIN — verify no `pin_change_required`
  - Scenario 5: PIN lockout tiers — verify `RESOURCE_EXHAUSTED` with lockout durations
  - Scenario 6: Admin unlock with new PIN — verify new temp PIN works
  - Scenario 7: Batch import 3 workers + duplicate detection
  - Scenario 8: Existing email user login unaffected

---

## Phase 3.5: Polish

- [X] **T026** [P] Verify all `data-testid` attributes present on interactive elements in PIN login pages

- [X] **T027** [P] Ensure `google.golang.org/genproto/googleapis/rpc/errdetails` is promoted from indirect to direct in `backend/go.mod`:
  ```sh
  cd backend && go get google.golang.org/genproto/googleapis/rpc/errdetails
  ```

- [X] **T028** Update `backend/docs/SYSTEM-ARCHITECTURE.md`:
  - Add `iam.credential` and `iam.account_lockout` tables to domain catalog
  - Add `iam.manageOrgAccounts` permission to IAM permission catalog
  - Note PIN-based worker creation flow in auth domain section
  - Update document version and date

- [X] **T029** [P] Code cleanup:
  - Remove any `fmt.Println` or debug logging added during development
  - Ensure all temporary PIN generation uses `crypto/rand` (not `math/rand`)
  - Verify no hardcoded org IDs or test credentials remain

---

## Dependencies

```
T001 → T002 → T003 (migration before schema, schema before sqlc)
T004 (proto error types) → T005 (Go error builders) → T011 (proto RPC methods)
T004 → T006 (TS errorDetails.ts uses generated PinAuthErrorDetail)
T006 → T007 (rpcWrapper update after errorDetails source exists)
T007 → T014 (iam-org-accounts.ts uses updated error handling)
T003 + T005 → T009 (logic layer uses queries + error types)
T009 + T011 → T012 (connect layer uses logic + proto types)
T012 + T013 → T020 (wire handlers before integration)
T014 + T015 → T016..T019 (frontend pages after API wrappers)
T020 + T021 + T022 → T023 (integration tests after everything wired)
T023 → T024 → T025 → T026..T029 (polish after tests pass)
```

## Parallel Execution Groups

**Group A** (run together after T003):
```
Task agent: T004 (proto error details file)
Task agent: T010 (constants + helpers)
```

**Group B** (run together after T004):
```
Task agent: T005 (Go error builders with error details — depends on T004 for PinAuthErrorDetail type)
Task agent: T006 (TS errorDetails.ts — depends on T004 for generated TS schema)
```

**Group C** (run together after T005 + T006 + T010):
```
Task agent: T007 (rpcWrapper update)
Task agent: T009 (logic layer — depends on T005 + T010)
Task agent: T011 (proto RPC methods — depends on T004)
```

**Group D** (run together after T009 + T011):
```
Task agent: T012 (connect layer)
Task agent: T014 (iam-org-accounts.ts — depends on T006 + T007)
```

**Group E** (run together after T012 + T013 + T014 + T015):
```
Task agent: T016 (workspace tab)
Task agent: T017 (PIN login page)
Task agent: T018 (set-PIN page)
Task agent: T019 (org accounts management page)
```

**Group F** (run together after T024):
```
Task agent: T026 (data-testid audit)
Task agent: T027 (go.mod direct dependency)
Task agent: T028 (architecture docs)
Task agent: T029 (code cleanup)
```

---

## Error Detail Contract (Backend ↔ Frontend Alignment)

| Error Scenario | gRPC Code | Error Detail Type | Frontend Handler |
|---|---|---|---|
| Wrong PIN (tier 1–3 lockout) | `ResourceExhausted` | `PinAuthErrorDetail{lockout_tier, lockout_until_unix}` | `extractPinAuthErrorDetail` → show countdown |
| Full lockout (tier 4) | `ResourceExhausted` | `PinAuthErrorDetail{admin_reset_required: true}` + `ErrorInfo{reason: "PIN_ACCOUNT_LOCKED"}` | Show "contact admin" message |
| PIN too short/long/non-numeric | `InvalidArgument` | `BadRequest.FieldViolation{field: "new_pin"}` | `extractFieldViolations` → show field error |
| PIN matches DOB or phone | `InvalidArgument` | `BadRequest.FieldViolation{field: "new_pin", description: "..."}` | `extractFieldViolations` → show field error |
| Duplicate login_identifier | `AlreadyExists` | `ResourceInfo{resource_type: "iam.identity", resource_name: login_identifier}` | `extractResourceInfo` → show duplicate error |
| Account suspended | `PermissionDenied` | (no detail — just message) | `AuthError` from `rpcWrapper` |
| Temp PIN expired | `Unauthenticated` | (no detail — just message) | Generic auth error |

All detail types use standard `google.rpc` error detail protos (via `google/rpc/error_details.proto`) except `PinAuthErrorDetail` which is custom and defined in `backend/rpc/v1/iam_error_details.proto` — generated for both Go and TypeScript via `buf generate`.

---

## Phase 3.6: Employee Listing Enhanced View

- [X] **T030** Add SQL query `GetRoleNamesForEmployeeBatch` to `backend/database/scripts/iam.query.sql`:
  - Batch-fetch role names for a list of employee IDs
  - Returns `(employee_id, role_name)` pairs ordered by system roles first, then alpha
  - Run `cd backend && sqlc generate`

- [X] **T031** Add SQL query `GetIsOrgManagedForBatch` to `backend/database/scripts/iam.query.sql`:
  - Batch-fetch `is_org_managed` flag from `iam.user` for a list of user IDs
  - Run `cd backend && sqlc generate`

- [X] **T032** Add `role_names` and `is_org_managed` fields to proto `EmployeeListItem` in `backend/rpc/v1/iam.proto`:
  - `repeated string role_names = 10;` — role names assigned to this employee
  - `bool is_org_managed = 11;` — whether this is an org-managed (PIN-based) account
  - Run `cd backend && buf generate`

- [X] **T033** Update `ListEmployees` connect handler in `backend/internal/iam/connect_auth.go`:
  - After fetching employees, batch-fetch roles via `GetRoleNamesForEmployeeBatch`
  - Batch-fetch is_org_managed flags via `GetIsOrgManagedForBatch`
  - Populate `RoleNames` and `IsOrgManaged` on each `EmployeeListItem` proto response
  - Non-fatal: if enrichment queries fail, continue without role/managed data

- [X] **T034** Update `EmployeeListItem` TypeScript interface in `frontend/packages/apis/src/iam-employee-list.ts`:
  - Add `roleNames: string[]` and `isOrgManaged: boolean` fields
  - Map from proto response in `listEmployees` function

- [X] **T035** [P] Update `EmployeesTab` in `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.tsx`:
  - Add "Roles" column to the table showing role name chips (blue rounded-full badges)
  - Make rows clickable (cursor-pointer, opens EmployeeDetailDialog)
  - Add `data-testid` attributes on employee rows
  - Update colspan counts for loading/error/empty states

- [X] **T036** [P] Create `EmployeeDetailDialog` component at `frontend/apps/web/src/app/workspace/organization/components/EmployeeDetailDialog.tsx`:
  - Shows full employee details (name, email, hire date, phone, DOB, home address)
  - Shows account type label (Managed Account / Email Account) and active status
  - "Roles" section displays assigned roles with "Remove" button (admin only, non-system roles)
  - "Assign Role" panel with search and one-click assign capability
  - "PIN Management" section for org-managed accounts: Reset PIN button, shows temporary PIN with copy-to-clipboard
  - Calls existing API wrappers: `listEmployeeRoles`, `listRoles`, `assignRole`, `revokeRole`, `resetOrgAccountCredential`
  - All interactive elements have `data-testid` attributes
  - Uses `useThemeColors()` for all styling — NO hardcoded colors

- [X] **T037** Fix `InviteMemberDialog` local `EmployeeItem` type to include new fields (`roleNames`, `isOrgManaged`)
