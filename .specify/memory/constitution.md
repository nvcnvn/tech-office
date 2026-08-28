<!--
SYNC IMPACT REPORT - Constitution v5.17.0
Generated: 2026-08-26

VERSION CHANGE: 5.16.0 → 5.17.0 (MINOR)

MODIFIED PRINCIPLES:
- Principle XIII (Mobile Application Design & Testing): "Feature Scope
  (NON-NEGOTIABLE)" gains a narrow, exhaustive first-run onboarding carve-out.
  Mobile MAY now surface exactly two otherwise-administrative capabilities, and
  only during first-run onboarding:
    1. Creating an organization (SMB owner registering their own workspace)
    2. Creating the first org-managed accounts (so a new workspace is not
       stranded as a one-person workspace)
  The carve-out is explicitly about *starting* a workspace, never *administering*
  an existing one. Role and permission editing, department management, bulk
  member import, account deactivation, credential reset for other members,
  billing and plan management all remain web-only. Any mobile surface beyond the
  two named capabilities requires a further amendment.

RATIONALE:
  The target user is a small-business owner who may not use a desktop computer
  for work at all. Requiring a laptop to create the workspace defeats the
  product's stated purpose, and a mid-flow handoff to a browser is the highest
  drop-off point available. A workspace with no employees has no value, so the
  first teammate must be creatable where the workspace was created.

ADDED SECTIONS:
- None (carve-out added inside an existing subsection)

REMOVED SECTIONS:
- None

TEMPLATE UPDATE STATUS:
✅ .specify/memory/constitution.md - MINOR version bump (5.16.0 → 5.17.0)
✅ Version history updated with v5.17.0 entry
✅ .specify/templates/plan-template.md - No changes needed (references principles generically)
✅ .specify/templates/tasks-template.md - No changes needed
✅ .specify/templates/spec-template.md - No changes needed
✅ AGENTS.md - No changes needed (does not restate the XIII feature-scope list)

UNBLOCKS:
- specs/035-mobile-owner-onboarding (T000 governance gate)

PLACEHOLDERS: None

VALIDATION SUMMARY:
✅ No placeholder tokens found
✅ All 13 core principles defined
✅ All dates in ISO format (YYYY-MM-DD)
✅ Governance procedures defined
-->

# Tech Office Constitution

**Version**: 5.17.0 | **Ratified**: 2024-10-01 | **Last Amended**: 2026-08-26

## Purpose & Scope

This constitution defines **governance principles** and **architectural mandates** for the Tech Office multi-tenant SaaS platform. It establishes non-negotiable rules ensuring security, maintainability, and operational excellence.

**Scope**: Governance rules and architectural requirements. Implementation details (syntax, code patterns, examples) are in language-specific instruction files referenced throughout.

---

## Core Principles

### I. Data Governance & Multi-Tenancy with Citus Sharding (NON-NEGOTIABLE)

**Rule**: All data modeling MUST begin with PostgreSQL schema design. Use schema-per-domain approach. ALL business tables MUST include `organization_id UUID NOT NULL` with foreign key to `public.organization(id)`.

**Requirements**:
- Design SQL schema first, then generate types and APIs
- Primary keys: UUID v7 (`id UUID PRIMARY KEY DEFAULT uuidv7()`)
- DDL changes: Use `IF NOT EXISTS` for idempotency
- Schema organization: `public` for system, domain schemas for business logic (e.g., `iam`, `organization`, `crm`)
- All tenant tables must have `organization_id` for partition and tenant isolation
- **Citus Sharding Requirement (CRITICAL)**: ALL unique indexes and primary keys MUST include `organization_id` as first column for sharding compatibility
- **Composite Foreign Keys (CRITICAL)**: Any foreign key referencing a tenant table MUST reference the composite key `(organization_id, id)` (or additional business keys) and declare `organization_id` as the leading column in the constraint. Inline single-column `REFERENCES ... (id)` declarations are forbidden for tenant tables.
- Composite indexes: Design based on data cardinality and query patterns for optimal performance
- Index reuse: Prefer a single composite index `(organization_id, col_a [, col_b ...])` that satisfies multiple query patterns over multiple overlapping indexes. Document why additional indexes are needed when creating more than one per leading key combination.
- Code generation: Use `sqlc` for type-safe Go models from SQL queries
- Use `TenantPool` for user-facing operations (enforces `organization_id` context)
- Use `AdminPool` ONLY for system operations (requires documented justification)
- ALL queries MUST explicitly filter by `organization_id` for tenant data access
- Cross-schema SQL joins are FORBIDDEN (use service method calls instead)
- User-facing API contracts MUST NOT include `organization_id` fields; extract from auth context via interceptors
- Allow `organization_id` in request ONLY for system-scope operations (background jobs, admin operations) with documented justification

**Migration Workflow (CRITICAL - forward-only psql runner)**:
1. Keep `backend/database/scripts/schema.sql` authoritative. Update it before writing migrations so schema and generated code stay aligned.
2. Create timestamped `.up.sql` files under `backend/database/migrations/` using `YYYYMMDDHHMMSS_description.up.sql`. `.down.sql` files may exist for manual rollback documentation, but the standard runner is forward-only and does not execute them.
3. Run `cd backend && ./scripts/migrate.sh` after setting `DATABASE_URL`. The script applies each `.up.sql` file with `psql`, records the current version in `public.schema_migrations`, and replays the dirty version automatically if a previous run failed mid-file.
4. Treat rollback as an explicit operator task: write compensating forward migrations or execute reviewed manual SQL when necessary. Do not rely on automated down-migration execution in routine workflows.
5. Commit schema changes, migrations, and regenerated artifacts in the same PR. Atlas or other auto-diff tooling is prohibited.

**Citus Sharding Constraints (CRITICAL - NON-NEGOTIABLE)**:

Due to Citus distributed architecture, the following limitations MUST be adhered to:

1. **NO Triggers**: Citus does NOT support triggers on distributed tables. ALL trigger logic MUST be implemented in application code.

2. **Immutable Functions in ON CONFLICT DO UPDATE**: When using `ON CONFLICT ... DO UPDATE`, you CANNOT use `now()` or other volatile functions in the UPDATE clause. MUST pass timestamp as parameter from application.
   - ❌ FORBIDDEN: `ON CONFLICT ... DO UPDATE SET updated_at = now()`
   - ✅ CORRECT: `ON CONFLICT ... DO UPDATE SET updated_at = $N` (parameterized timestamp)

3. **Foreign Key Cascade Restrictions**:
   - ✅ SUPPORTED: `ON DELETE CASCADE`, `ON DELETE RESTRICT`, `ON UPDATE CASCADE`, `ON UPDATE RESTRICT`
   - ❌ NOT SUPPORTED: `ON DELETE SET NULL`, `ON DELETE SET DEFAULT`, `ON UPDATE SET NULL`, `ON UPDATE SET DEFAULT`

4. **Index Requirements**:
   - ALL indexes on distributed tables MUST include `organization_id` as the first column
   - Partial indexes are supported but MUST include `organization_id` in the indexed columns

5. **JOIN Requirements**:
   - ALL JOINs between distributed tables MUST include `organization_id` in the join condition
   - Example: `JOIN table2 ON (table1.organization_id, table1.ref_id) = (table2.organization_id, table2.id)`

6. **Transaction Limitations**:
   - Cross-shard transactions are supported but have performance implications
   - Keep transactions within single organization (single shard) when possible

**Schema Design Checklist**:
- [ ] All tenant tables have composite primary key `(organization_id, id)`
- [ ] All unique indexes start with `organization_id`
- [ ] All foreign keys reference composite keys including `organization_id`
- [ ] No triggers defined on distributed tables
- [ ] No `ON DELETE SET NULL` or `ON DELETE SET DEFAULT` in foreign keys
- [ ] No `now()` in `ON CONFLICT DO UPDATE` clauses
- [ ] All JOINs include `organization_id` in the join condition
- [ ] New migration files added under `backend/database/migrations/` and validated via `./scripts/migrate.sh`

**Examples**:
```sql
-- ✅ CORRECT: Tenant table with UUID v7 PK and organization_id FK (Citus-ready)
CREATE TABLE crm.contact (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    -- Primary key already includes organization_id implicitly for Citus
    CONSTRAINT pk_contact PRIMARY KEY (organization_id, id)
);

-- ✅ CORRECT: Unique index includes organization_id for Citus sharding
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_org_email 
    ON crm.contact(organization_id, email);

-- ✅ CORRECT: Composite foreign key referencing tenant identity table
ALTER TABLE organization.employee
    ADD CONSTRAINT fk_employee_identity
        FOREIGN KEY (organization_id, id)
        REFERENCES iam.identity(organization_id, id)
        ON DELETE CASCADE;

-- ✅ CORRECT: Consolidated index reused by multiple queries (org + status filters)
CREATE INDEX IF NOT EXISTS idx_employee_org_status
    ON organization.employee(organization_id, status, updated_at DESC);

-- ✅ CORRECT: Query explicitly filters by organization_id
-- name: GetContact :one
SELECT * FROM crm.contact 
WHERE organization_id = $1 AND id = $2;

-- ✅ CORRECT: ON CONFLICT DO UPDATE with parameterized timestamp
-- name: UpsertContact :one
INSERT INTO crm.contact (id, organization_id, name, email)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, email) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = $5  -- ✅ Parameter, not now()
RETURNING *;

-- ❌ WRONG: ON CONFLICT DO UPDATE with now() function
INSERT INTO crm.contact (id, organization_id, name, email)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, email) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = now()  -- ❌ Citus does not support volatile functions here
RETURNING *;
```

```go
// ✅ CORRECT: Use TenantPool for user operations
func (s *ContactService) GetContact(ctx context.Context, id dbuuid.UUID) (*Contact, error) {
    orgID := interceptor.OrgIDFromContext(ctx) // Extract from auth context
    return s.queries.WithTx(s.tenantPool).GetContact(ctx, orgID, id)
}
```

**Rationale**: Multi-tenancy is non-negotiable for SaaS. Schema-first prevents drift between database and code, enforces tenant isolation at the data layer, and makes cross-service contracts explicit. Multi-tenant data breach = catastrophic business failure. Defense in depth: enforce isolation at connection pool layer (TenantPool/AdminPool), application layer (explicit `organization_id` filters), and API contract layer (context-derived tenant context prevents manipulation attacks).

---

### II. Scenario-First Integration & E2E Testing (NON-NEGOTIABLE)

**Rule**: Every new feature MUST begin with composing backend integration test scenarios that describe expected behavior. Features with user-facing UI MUST also include web E2E test scenarios (Playwright) that validate the same behavioral contract from the browser perspective. Test scenarios MUST be derived from and traceable to the User Stories and functional Requirements (FR-XXX) in the feature spec — every User Story and every user-observable Requirement MUST have at least one corresponding backend integration test scenario, and every UI-visible behavior MUST have a corresponding E2E test scenario. Test scenarios (not their implementations) constitute the **behavioral contract** for the feature: they MUST be reviewed and approved as part of the planning phase before tasks are created and before any code is written. Backend integration tests MUST be placed in `backend/integration/` directory. Web E2E tests MUST be placed in `frontend/apps/web/e2e/` directory. AVOID unit/snapshot/component tests. A feature is considered DONE only when all code and tests are implemented AND **both** the backend integration test suite and the E2E test suite pass.

**Scenario-as-Contract (NON-NEGOTIABLE)**:

Test scenarios are planning artifacts first and test files second. Written as `t.Run` stubs before any implementation, they translate spec intent into observable, executable behavior descriptions that stakeholders can read and agree on.

- Every **User Story** in the feature spec MUST be covered by at least one `t.Run` scenario. The scenario name MUST echo the user-observable outcome described in the story.
- Every **Functional Requirement** (FR-XXX) that describes user-observable behavior MUST be traceable to at least one scenario. FR numbers SHOULD appear as comments in the test file for traceability.
- Scenario names MUST be expressive enough that a non-technical reader can verify alignment with the spec (the `go test -v` output reads like a behavior specification).
- The scenario stubs MUST be presented and approved during planning (before the `/tasks` command is run). This approval constitutes the behavioral contract for the feature. Implementation cannot begin until this contract is agreed upon.
- If a User Story or FR is intentionally excluded from testing scope, that exclusion MUST be documented with justification in the plan.

**Workflow**:
1. **Derive test scenarios from spec**: Read the feature spec's User Stories and Functional Requirements. Map each to one or more `t.Run` behavior descriptions in `backend/integration/`.
2. **Compose scenario stubs**: Write test function stubs with descriptive `t.Run` names (no implementation yet — scenario structure only). Add `// FR-XXX` comments to link scenarios to requirements.
3. **Contract review during planning**: Scenarios are reviewed and approved by developer(s) as part of the plan review — before tasks are created and before any code is written. This is the behavioral contract gate.
4. **Implement feature code AND test code**: Build the backend/frontend functionality and fill in test implementations.
5. **Run ALL tests**: Execute the full integration test suite (`go test ./integration/...`), not just the new tests.
6. **Feature is DONE**: Only when all code + tests are implemented AND all tests pass (zero failures across the entire suite).

**Test Scenario Composition (Step 2 — Before Implementation)**:

Test scenarios are lightweight stubs that capture WHAT the feature should do, not HOW. They serve as the behavioral contract derived from the spec's User Stories and Requirements that the team reviews during planning before writing any production code. Following the `testWorld` pattern defined in `backend/integration/helper_test.go`, scenarios use nested `t.Run` with descriptive names.

```go
// ✅ CORRECT: Scenario stubs derived from spec User Stories and FR-XXX requirements
// File: backend/integration/billing_test.go
func TestBilling(t *testing.T) {
    w := newTestWorld(t)
    _ = w // scenarios only — implementation comes after contract review

    // FR-001, FR-002: User Story 1 — invoice generated for unbilled work
    t.Run("when an invoice is generated", func(t *testing.T) {
        t.Run("it includes all unbilled line items", func(t *testing.T) {
            t.Skip("TODO: implement after scenario review")
        })
        t.Run("the invoice total matches the sum of line items", func(t *testing.T) {
            t.Skip("TODO: implement after scenario review")
        })
        t.Run("it is associated with the correct organization", func(t *testing.T) {
            t.Skip("TODO: implement after scenario review")
        })
    })

    // FR-003: User Story 2 — unauthorized user cannot generate invoices
    t.Run("when a non-owner tries to generate an invoice", func(t *testing.T) {
        t.Run("it returns permission denied", func(t *testing.T) {
            t.Skip("TODO: implement after scenario review")
        })
    })
}
```

The `go test -v` output of scenario stubs reads like a behavior specification:
```
=== RUN   TestBilling
=== RUN   TestBilling/when_an_invoice_is_generated
=== RUN   TestBilling/when_an_invoice_is_generated/it_includes_all_unbilled_line_items
=== RUN   TestBilling/when_an_invoice_is_generated/the_invoice_total_matches_the_sum_of_line_items
=== RUN   TestBilling/when_an_invoice_is_generated/it_is_associated_with_the_correct_organization
=== RUN   TestBilling/when_a_non-owner_tries_to_generate_an_invoice
=== RUN   TestBilling/when_a_non-owner_tries_to_generate_an_invoice/it_returns_permission_denied
```

**Definition of Done (NON-NEGOTIABLE)**:

A feature is considered complete ONLY when ALL of the following are true:
- [ ] Test scenarios derived from spec User Stories and FR-XXX requirements
- [ ] Backend integration test scenarios composed in `backend/integration/` with descriptive `t.Run` names and `// FR-XXX` traceability comments
- [ ] Web E2E test scenarios composed in `frontend/apps/web/e2e/` with descriptive `test.describe`/`test` names mirroring backend scenarios
- [ ] Every User Story and user-observable Requirement has at least one corresponding backend integration scenario (or exclusion documented with justification)
- [ ] Every UI-visible behavior has a corresponding E2E test scenario (or exclusion documented with justification)
- [ ] Test scenarios reviewed and approved as behavioral contract during planning (before tasks created)
- [ ] All feature code implemented (backend and/or frontend)
- [ ] All backend test stubs replaced with real test implementations (no remaining `t.Skip("TODO")` for the feature)
- [ ] All E2E test stubs replaced with real test implementations (no remaining `test.skip` for the feature)
- [ ] **The ENTIRE backend integration test suite passes** (`go test ./integration/...` — zero failures, not just the new tests)
- [ ] **The ENTIRE E2E test suite passes** (`pnpm --filter web exec playwright test` — zero failures, not just the new tests)
- [ ] For features with mobile UI: Maestro flow(s) added in `frontend/apps/mobile/.maestro/` covering the feature's main happy path (or exclusion documented with justification); **the ENTIRE Maestro suite passes** (`make test-mobile` — zero failures)

**Rationale for "all tests must pass"**: Existing tests serve as regression guards. A new feature that breaks existing tests indicates unintended side effects. Both the full backend integration suite and the full E2E suite MUST pass to ensure the new feature integrates correctly with the rest of the system.

**Test Requirements**:
- **Backend**: Integration tests REQUIRED - use RPC client with dev token to mimic frontend calls
- **Frontend**: Web E2E tests (Playwright) REQUIRED - NO unit/snapshot/component tests
- **Backend Location**: ALL integration tests MUST be in `backend/integration/` package
- **E2E Location**: ALL E2E tests MUST be in `frontend/apps/web/e2e/` directory
- Integration tests MUST use `NewDevJWTSigner` to generate tokens with appropriate roles
- Tests MUST call RPC endpoints exactly as frontend would (via Connect RPC client)
- Load test data from database (organization ID, employee ID) for realistic scenarios
- Use `GetRandomTestIdentityAndKey(role)` helper to obtain test identities with specific roles from database
- Tests MUST follow the `testWorld` pattern and naming conventions defined in the `backend-integration-testing` skill

**Test Helper Utilities** (`backend/integration/helper_test.go`):
- `GlobalSigner`: Shared `DevJWTSigner` instance initialized with dev keys
- `GlobalDbPool`: Shared `AdminDatabaseConnector` for test data queries
- `GetRandomTestIdentityAndKey(role string)`: Returns random test identity with specified role from database
  * Parameters: organization-scoped role (e.g., `iam.IdentityRoleEmployee`, `iam.IdentityRoleOwner`, `iam.IdentityRoleOperator`)
  * Returns: `(orgID, identityID dbuuid.UUID, jwt string)`
  * Automatically maps organization-scoped roles to API-level roles for token generation

**Examples**:
```go
// ✅ CORRECT: Behavior-focused test using testWorld pattern
func TestNotificationLifecycle(t *testing.T) {
    w := newTestWorld(t)
    owner := w.withOwner()
    emp := w.withEmployee()

    t.Run("when a notification is published to an employee", func(t *testing.T) {
        notif := w.publishNotification(owner, emp.ID, "Test", "Message")

        t.Run("the notification appears in the employee list", func(t *testing.T) {
            list := w.listNotifications(emp)
            found := findNotification(list, notif.ID)
            require.NotNil(t, found)
            assert.Equal(t, "Test", found.Title)
        })

        t.Run("when marked as read", func(t *testing.T) {
            w.markAsRead(emp, notif.ID)

            t.Run("it no longer appears as unread", func(t *testing.T) {
                list := w.listUnreadNotifications(emp)
                found := findNotification(list, notif.ID)
                assert.Nil(t, found)
            })
        })
    })
}

// ❌ WRONG: Unit test mocking internal logic (avoid this)
func TestNotificationLogic_Unit(t *testing.T) {
    mockQueries := &MockQueries{} // Don't do this
    // ...
}

// ❌ WRONG: Integration test in wrong location
// File: backend/internal/notification/notification_test.go
func TestNotificationIntegration(t *testing.T) { // VIOLATION: Must be in backend/integration/
    // ...
}

// ❌ WRONG: Skipping full test suite and only running new tests
// go test ./integration/ -run TestBilling  ← VIOLATION: Must run ALL tests
// ✅ CORRECT: Run full suite
// go test ./integration/...
```

**Web E2E Testing (Playwright) — NON-NEGOTIABLE**:

Web E2E tests validate that the system works correctly from the user's perspective — through the browser UI. E2E tests are the primary frontend testing strategy. A single User Story produces **two layers of verification** from the same behavioral scenario: backend integration tests validate API contracts and data integrity; E2E tests validate that the UI renders the correct state and user interactions work.

**E2E Test Pattern: Arrange via API, Act via UI, Assert via UI**:
- **Arrange** (setup): Use direct API/RPC calls to create test data. Do NOT click through the UI to set up preconditions — it is slow and fragile.
- **Act** (user action): Drive the browser UI as a real user would — click, type, navigate.
- **Assert** (verification): Check what the user sees — visible text, element states, URLs, toasts.

**E2E Test Location & Structure**:
- ALL E2E tests MUST be in `frontend/apps/web/e2e/` directory
- File naming: `<domain>-<feature>.spec.ts` — mirrors backend's `<domain>_<feature>_test.go`
- Test helpers in `frontend/apps/web/e2e/helpers/` (auth, API, fixtures, screenshot utilities)
- Configuration in `frontend/apps/web/e2e/playwright.config.ts`

**E2E Test Helpers** (`frontend/apps/web/e2e/helpers/`):
- `auth.ts`: `createTestOrg()`, `createTestEmployee(owner)`, `loginAs(page, user)` — mirrors backend `testWorld` identity helpers
- `api.ts`: `apiCall(user, path, body)` — direct RPC calls for arrange steps (no browser needed)
- `fixtures.ts`: `setupTestContext(employeeCount)` — Playwright fixtures for pre-authenticated pages
- `screenshot.ts`: `stepScreenshot(page, testInfo, label)` — optional per-step screenshots (enable via `E2E_SCREENSHOTS=1`)

**E2E Scenario Composition (Before Implementation)**:

E2E scenario stubs follow the same contract-first approach as backend integration tests: compose stubs with descriptive `test.describe`/`test` names before writing any implementation. Scenario names MUST mirror the backend integration test names so both suites tell the same behavioral story.

```typescript
// ✅ CORRECT: E2E scenario stubs derived from spec User Stories
// File: frontend/apps/web/e2e/billing.spec.ts
import { test, expect } from '@playwright/test';
import { createTestOrg, createTestEmployee, loginAs, type TestUser } from './helpers/auth';
import * as api from './helpers/api';

test.describe('Billing', () => {
  let owner: TestUser;
  let employee: TestUser;

  test.beforeAll(async () => {
    owner = await createTestOrg();
    employee = await createTestEmployee(owner);
  });

  // FR-001, FR-002: User Story 1 — invoice displayed to user
  test.describe('when an invoice is generated', () => {
    test('the invoice appears in the billing dashboard', async ({ page }) => {
      test.skip(true, 'TODO: implement after scenario review');
    });
    test('the invoice total is displayed correctly', async ({ page }) => {
      test.skip(true, 'TODO: implement after scenario review');
    });
  });

  // FR-003: User Story 2 — unauthorized access
  test.describe('when a non-owner tries to access billing', () => {
    test('the billing page shows access denied', async ({ page }) => {
      test.skip(true, 'TODO: implement after scenario review');
    });
  });
});
```

**E2E Test Implementation Example**:

```typescript
// ✅ CORRECT: Arrange via API, Act via UI, Assert via UI
test.describe('when a team collaborates in a public channel', () => {
  let channelId: string;

  test.beforeAll(async () => {
    // Arrange: create channel and data via API (fast, reliable)
    const resp = await api.createChannel(owner, { titleSlug: 'general' });
    channelId = resp.channel.id;
    await api.inviteMember(owner, channelId, alice.id);
    await api.sendMessage(alice, channelId, 'Hello from Alice!');
  });

  test('bob sees alice\'s message in the channel', async ({ page }) => {
    // Act: navigate via browser
    await loginAs(page, bob);
    await page.goto(`/workspace/chat?channel=${channelId}`);

    // Assert: check what the user sees
    await expect(page.getByText('Hello from Alice!')).toBeVisible();
  });
});

// ❌ WRONG: Arranging through UI clicks (slow, fragile)
test('bob sees alice\'s message', async ({ page }) => {
  await loginAs(page, owner);
  await page.goto('/workspace/chat');
  await page.click('button:has-text("New Channel")');
  await page.fill('[name="channel-name"]', 'general');
  // ... 20 more lines of fragile UI setup ...
});

// ❌ WRONG: E2E test in wrong location
// File: frontend/apps/web/src/__tests__/chat.spec.ts
test('chat works', async ({ page }) => { // VIOLATION: Must be in e2e/
  // ...
});

// ❌ WRONG: Skipping full E2E suite and only running new tests
// pnpm exec playwright test billing.spec.ts ← VIOLATION: Must run ALL tests
// ✅ CORRECT: Run full suite
// pnpm --filter web exec playwright test
```

**Rationale**: Scenario-first testing ensures expected behavior is explicitly defined and reviewed before implementation begins, preventing scope creep and ensuring all stakeholders agree on requirements. Test scenarios derived from User Stories and Requirements close the gap between the spec and the code — if a User Story has no corresponding scenario, the feature is incomplete by definition. Treating the scenario list as a planning contract (reviewed before tasks are created) makes the behavioral specification a formal, agreed-upon artifact rather than a side effect of construction. Test scenarios serve as executable behavior documentation — `go test -v` output and `playwright test --reporter=list` output read like a specification. Integration tests that mimic real frontend usage (via RPC client) validate actual API behavior, not mocked logic. E2E tests validate that the UI correctly renders state and responds to user interactions — the two layers together provide full-stack behavioral coverage. Requiring both entire test suites to pass ensures new features do not introduce regressions. Centralized test locations (`backend/integration/` and `frontend/apps/web/e2e/`) with shared helpers ensure consistent patterns and reusable fixtures across all services.

---

### III. Two-Layer Service Architecture & Proto-Level Authorization (MANDATORY)

**Rule**: Every service MUST separate business logic from infrastructure concerns using two distinct layers. ALL RPC methods MUST declare authorization requirements at proto level using `access_control` options.

**Layers**:
- **Logic Layer**: Pure business logic, pool-agnostic, accepts `tx database.DBTX` parameter, returns domain errors, implements interfaces, performs complex business authorization rules
- **Connect Layer**: RPC handlers, owns connection pools, extracts auth, manages transactions, translates errors to `connect.Error`, performs lightweight proto-level authorization verification

**Proto-Level Authorization (MANDATORY)**:
- ALL RPC methods MUST explicitly declare `allowed_roles` in proto `access_control` option
- NO role inheritance - MUST list ALL roles explicitly (e.g., `[ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]`)
- Connect layer performs lightweight verification of proto-declared roles
- Logic layer implements complex business rules (e.g., "only department managers can approve", "users can only edit own records")
- Proto authorization is declarative and self-documenting; logic authorization is imperative and context-dependent

**Examples**:
```protobuf
// ✅ CORRECT: Proto-level authorization declaration
service PreferenceService {
  rpc GetUserPreference(GetUserPreferenceRequest) returns (GetUserPreferenceResponse){
    option (rpc.v1.access_control) = {
      allowed_roles: [ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]
      allow_unauthenticated: false
    };
  }
}

// ❌ WRONG: Missing authorization declaration
service PreferenceService {
  rpc GetUserPreference(GetUserPreferenceRequest) returns (GetUserPreferenceResponse);
  // VIOLATION: No access_control option
}

// ❌ WRONG: Relying on role inheritance (not supported)
service DepartmentService {
  rpc CreateDepartment(CreateDepartmentRequest) returns (CreateDepartmentResponse){
    option (rpc.v1.access_control) = {
      allowed_roles: [ROLE_OWNER]  // VIOLATION: Must list ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR explicitly
      allow_unauthenticated: false
    };
  }
}
```

```go
// ✅ CORRECT: Logic Layer - pure business logic, accepts tx parameter
type ContactLogic interface {
    CreateContact(ctx context.Context, tx database.DBTX, params CreateContactParams) (*Contact, error)
}

func (l *contactLogic) CreateContact(ctx context.Context, tx database.DBTX, params CreateContactParams) (*Contact, error) {
    // Pure business logic, no pool dependencies
    return q.Queries.InsertContact(ctx, tx, params)
}

// ✅ CORRECT: Connect Layer - handles infrastructure
func (s *ContactServiceServer) CreateContact(ctx context.Context, req *connect.Request[v1.CreateContactRequest]) (*connect.Response[v1.CreateContactResponse], error) {
    orgID := interceptor.OrgIDFromContext(ctx) // Extract auth
    var contact *proto.Response
    err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
	var err error
	params := CreateContactParams{
	    OrganizationID: dbuuid.Parse(orgID),
	    ...
	}
	contact, err := s.logic.CreateContact(ctx, tx, params)
        return err
    })
    return connect.NewResponse(&v1.CreateContactResponse{...}), nil
}

// ❌ WRONG: Logic layer creating transactions (tight coupling)
func (l *contactLogic) CreateContact(ctx context.Context, params CreateContactParams) (*Contact, error) {
    tx, _ := l.pool.Begin(ctx) // VIOLATION: Logic layer shouldn't own pools
    defer tx.Rollback(ctx)
    // ...
}
```

**Rationale**: 
- Logic layer is reusable across services without pool dependencies
- Transaction safety: only Connect layer creates transactions
- Testability: mock interfaces instead of infrastructure
- Clear separation: business logic vs infrastructure concerns
- Proto-level authorization: Self-documenting access control, compile-time role validation
- Explicit role listing: Prevents security gaps from assumed inheritance

**Reference**: `.github/copilot-instructions.md` for implementation patterns

---

### IV. Cross-Domain Integration (CRITICAL)

**Rule**: Services MUST NOT access other domains via SQL layer. Use service method calls for cross-domain data access.

**Requirements**:
- AVOID cross-schema SQL joins (creates tight coupling, bypasses validation)
- Services depend on other services' **Logic Layer interfaces** (not Connect layer)
- Inject logic dependencies at initialization (`backend/cmd/server.go`)
- Logic layer methods MUST accept `tx database.DBTX` to support transaction-aware calls
- NEVER nest transactions; pass existing `tx` for atomic cross-domain operations

**Context Propagation Rules**:
- **User-scope**: Pass request context through logic layers (preserves `organization_id` and auth)
- **System-scope**: Use `context.Background()` ONLY for background jobs (document justification)
- Default to user-scope unless explicitly justified

**Examples**:
```go
// ✅ CORRECT: Cross-domain via logic layer interface
type OrderLogic struct {
    customerLogic CustomerLogic // Depend on interface, not SQL
}

func (l *OrderLogic) CreateOrder(ctx context.Context, tx database.DBTX, params CreateOrderParams) (*Order, error) {
    // Reuse same transaction for atomic operation
    customer, err := l.customerLogic.GetCustomer(ctx, tx, params.CustomerID)
    if err != nil {
        return nil, err
    }
    // Create order with customer data
    return l.queries.InsertOrder(ctx, tx, ...)
}

// Initialization in backend/cmd/server.go
customerLogic := customer.NewLogic(queries)
orderLogic := order.NewLogic(queries, customerLogic) // Inject dependency

// ❌ WRONG: Cross-schema SQL join (tight coupling)
-- name: GetOrderWithCustomer :one
SELECT o.*, c.name, c.email 
FROM orders.order o 
JOIN customers.customer c ON o.customer_id = c.id  -- VIOLATION
WHERE o.id = $1;

// ❌ WRONG: Nested transactions (causes deadlocks)
func (l *OrderLogic) CreateOrder(ctx context.Context, tx database.DBTX, params CreateOrderParams) (*Order, error) {
    newTx, _ := l.pool.Begin(ctx) // VIOLATION: Nesting transactions
    customer, _ := l.customerLogic.GetCustomer(ctx, newTx, params.CustomerID)
    // ...
}
```

**Rationale**: Direct service dependencies avoid RPC overhead, enable transactional consistency, maintain architectural clarity, and enforce security boundaries. SQL-level coupling complicates migrations and bypasses domain logic.

---

### V. Observability, Simplicity & YAGNI

**Rule**: Prefer simple, observable solutions. Avoid premature optimization.

**Requirements**:
- Use `log/slog` exclusively for structured logging (key-value pairs)
- Add debug logs at all major logic points
- Use context-aware logging (`slog.DebugContext`, `slog.InfoContext`, `slog.ErrorContext`)
- Every non-trivial service change MUST include observability plan (logs, metrics, owner)
- Document complexity when introduced

**Examples**:
```go
// ✅ CORRECT: Structured logging with context
func (l *OrderLogic) CreateOrder(ctx context.Context, tx database.DBTX, params CreateOrderParams) (*Order, error) {
    slog.DebugContext(ctx, "OrderLogic.CreateOrder",
        "customer_id", params.CustomerID,
        "total_amount", params.TotalAmount)
    
    order, err := l.queries.InsertOrder(ctx, tx, params)
    if err != nil {
        slog.ErrorContext(ctx, "failed to insert order",
            "error", err,
            "customer_id", params.CustomerID)
        return nil, err
    }
    
    slog.InfoContext(ctx, "order created successfully",
        "order_id", order.ID,
        "customer_id", params.CustomerID)
    return order, nil
}

// ❌ WRONG: Unstructured logging, no context
func (l *OrderLogic) CreateOrder(ctx context.Context, tx database.DBTX, params CreateOrderParams) (*Order, error) {
    log.Println("Creating order for customer:", params.CustomerID) // No structure, no context
    // ...
}
```

**Rationale**: Multi-tenant SaaS requires deep observability for debugging. Simplicity reduces security risks and maintenance burden. YAGNI prevents technical debt.

---

### VI. Versioning, Breaking Changes & Review

**Rule**: Use semantic versioning for public APIs and this constitution. Breaking changes require MAJOR version bump and migration plan.

**PR Requirements for Schema/API Changes**:
- Migration plan and rollback strategy
- Contract test updates
- 2+ reviewers (1 MUST be maintainer with DB/infra expertise)
- Security review of `organization_id` filters (tenant isolation changes)

**Versioning**:
- MAJOR: Breaking changes to principles, governance, or public APIs
- MINOR: New principles/sections, backward-compatible features
- PATCH: Clarifications, wording fixes, non-semantic refinements

**Rationale**: Prevents accidental breaking changes. Ensures migration readiness for multi-tenant deployments. Maintains constitutional stability.

---

### VII. Frontend API Wrapper Pattern & Type Safety (MANDATORY)

**Rule**: Frontend applications MUST NOT directly use protobuf-generated types from `packages/rpc`. ALL RPC calls MUST go through typed wrapper functions in `packages/apis` that provide custom TypeScript interfaces for inputs and outputs. ALL interactive UI components MUST include `data-testid` attributes for accessibility testing. ALL UI styling MUST use the theme system - hardcoded colors are FORBIDDEN.

**Requirements**:
- ✅ **Define custom input/output types**: Create domain-specific TypeScript interfaces for all API parameters and responses
- ✅ **Wrap RPC calls**: Each RPC method MUST have a corresponding wrapper function
- ✅ **Type assertions**: Use explicit `as ResponseType` assertions when returning from `rpcCall` wrapper
- ✅ **Convert protobuf types**: Use shared utilities from `packages/apis/src/proto-utils.ts` to convert protobuf types (e.g., `Timestamp`) to JavaScript native types (e.g., `Date`)
- ✅ **Add data-testid attributes**: ALL interactive elements (buttons, inputs, links, forms) MUST have `data-testid` for testing
- ✅ **Use theme system for colors**: ALL colors MUST come from `useThemeColors()` hook - NO hardcoded color values (hex, rgb, named colors)
- ❌ **DO NOT expose protobuf types**: Applications MUST import from `apis`, NOT from `rpc` package directly

**Examples**:
```typescript
// ✅ CORRECT: Custom TypeScript interface with native types
export interface Contact {
  id: string;
  name: string;
  email: string;
  createdAt: Date; // Native JavaScript Date, not protobuf Timestamp
}

// ✅ CORRECT: Wrapper function with type conversion
export async function getContact(id: string): Promise<Contact> {
  const response = await rpcCall(async () => {
    const resp = await crmClient.getContact({
      id: id
    });
    return resp;
  });
  return {
    id: response.id,
    name: response.name,
    email: response.email,
    createdAt: timestampToDate(response.createdAt), // Convert protobuf type
  } as Contact;
}

// ✅ CORRECT: Interactive UI component with data-testid
<Button 
  data-testid="contact-save-btn"
  onClick={handleSave}
>
  Save Contact
</Button>

<input 
  data-testid="contact-email-input"
  type="email"
  value={email}
  onChange={handleChange}
/>

// ❌ WRONG: Direct protobuf import in application
import { Contact as ProtoContact } from 'rpc'; // VIOLATION

// ❌ WRONG: Interactive element without data-testid
<Button onClick={handleSave}>Save</Button> // VIOLATION: Missing data-testid

// ❌ WRONG: Hardcoded color values
<div style={{ backgroundColor: '#1976d2' }}>  // VIOLATION: Hardcoded hex color
<span style={{ color: 'rgb(255, 0, 0)' }}>   // VIOLATION: Hardcoded RGB
<Box sx={{ bgcolor: 'primary.main' }}>      // VIOLATION: Direct MUI theme path

// ✅ CORRECT: Using theme system for colors
import { useThemeColors } from '@/theme/useThemeColors';

function MyComponent() {
  const colors = useThemeColors();
  
  return (
    <div style={colors.bg.paper.style} className={colors.border.default.className}>
      <h1 style={colors.text.primary.style}>Title</h1>
      <Button style={colors.bg.primary.style}>Action</Button>
    </div>
  );
}
```

**Benefits**:
- **Type Safety**: Custom types prevent direct usage of complex protobuf message types in application code
- **API Stability**: Wrapper layer insulates apps from protobuf schema changes
- **Developer Experience**: Clean TypeScript interfaces with JavaScript native types instead of protobuf types
- **Centralized Transformation**: Type conversions, error handling, and business logic centralized in wrapper layer
- **Theme Consistency**: Centralized color system ensures Dark/Light mode support and prevents hardcoded color drift

---

### VIII. Cross-Stack Constant & Type Synchronization (CRITICAL - QUALITY)

**Rule**: String-based constants that span multiple layers (database, backend, frontend) MUST be explicitly validated for alignment. ALL code MUST reference named constants — using string/value literals instead of defined constants is FORBIDDEN. When constants cannot be defined in protobuf, coordinate changes across all affected layers AND write automated tests to validate constant synchronization.

**Requirements**:

**1. Proto Enum Preference (Strongly Recommended - Prevents Synchronization Bugs)**:
- When possible, define constants as protobuf enums to auto-generate type-safe code
- Proto enums provide compile-time safety and eliminate manual synchronization
- Proto enums automatically generate matching constants in all layers (Go, TypeScript, database comments)

**2. String Constant Coordination (When Proto Enums Not Viable)**:
- **Database Layer**: Use CHECK constraints to enforce valid values
- **Backend Layer**: Define constants as Go `const` declarations in domain packages
- **Frontend Layer**: Define TypeScript union types or enums for constants
- **CRITICAL**: Values MUST match exactly across all layers (case-sensitive)

**3. Mandatory Constant Usage — No Value Literals (NON-NEGOTIABLE)**:
- Once a constant is defined (e.g., `UserStatusActive = "active"`), ALL code MUST use the constant name, NEVER the literal value
- This applies to: comparisons (`==`), assignments, function arguments, switch/case branches, struct field initializations
- Violations are treated as bugs — they bypass IDE refactoring, hide typos, and defeat the purpose of centralized constant definitions
- Code reviewers MUST reject PRs containing value literals where a named constant exists
- When a value does not have a corresponding constant but is used more than once, define a new constant BEFORE using it

**4. Automated Testing Requirement (MANDATORY - Prevents Runtime Bugs)**:
- Write integration tests that verify constant values match across layers
- Test MUST fail if backend and frontend constants diverge
- Test MUST validate that all hardcoded strings use defined constants
- Run tests in CI/CD pipeline before merge

**5. Change Coordination Process (MANDATORY)**:
When adding/removing/renaming string constants, update layers atomically in single PR with:
- Database CHECK constraint updates
- Backend constant definitions
- Frontend type definitions
- All hardcoded strings replaced with constants
- Integration tests validating constant synchronization
- Documentation updated (schema comments, API docs)

**Examples**:
```sql
-- ✅ CORRECT: Database CHECK constraint
CREATE TABLE iam.user (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'deleted'))
);

-- ✅ CORRECT: Database CHECK constraint for changeType
CREATE TABLE docs.diff_change (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    change_type TEXT NOT NULL CHECK (change_type IN ('add', 'remove', 'unchanged'))
);
```

```go
// ✅ CORRECT: Backend constants matching database
package iam

const (
    UserStatusActive    = "active"
    UserStatusSuspended = "suspended"
    UserStatusDeleted   = "deleted"
)

// ✅ CORRECT: Using named constant in comparison
if user.Status == iam.UserStatusActive {
    // ...
}

// ✅ CORRECT: Using named constant in struct initialization
record := database.IamIdentity{
    IdentityType: database.IdentityTypeHuman,
}

// ✅ CORRECT: Using named constant in switch case
switch ch.ChannelType {
case chat.ChannelTypeChat:
    // ...
case chat.ChannelTypeDirectMessage:
    // ...
}

// ❌ WRONG: Using literal value when constant exists
if user.Status == "active" {  // VIOLATION: Must use iam.UserStatusActive
    // ...
}

// ❌ WRONG: String literal in struct field
record := database.IamIdentity{
    IdentityType: "human",  // VIOLATION: Must use database.IdentityTypeHuman
}

// ❌ WRONG: Literal in switch case when constant exists
switch ch.ChannelType {
case "chat":            // VIOLATION: Must use ChannelTypeChat
case "direct_message":  // VIOLATION: Must use ChannelTypeDirectMessage
}

// ❌ WRONG: Literal in boolean expression
IsManager: role == "manager"  // VIOLATION: Must use DepartmentRoleManager
```

```typescript
// ✅ CORRECT: Frontend types matching backend/database exactly
export type UserStatus = 'active' | 'suspended' | 'deleted';

// ✅ CORRECT: Frontend types matching backend for diff changes
export type DiffChangeType = 'add' | 'remove' | 'unchanged';

// ❌ WRONG: Hardcoded string not matching backend constant
if (user.status === 'inactive') { // VIOLATION: Value not in CHECK constraint

// ❌ WRONG: Hardcoded string in API call
organizationClient.createEmployee({
  roles: ['ROLE_OPERATOR'] // VIOLATION: Should use constant
})
```

**Integration Test Example**:
```go
// ✅ CORRECT: Integration test validating constant synchronization
func TestDiffChangeTypeConstants(t *testing.T) {
    // Test that backend constants match database CHECK constraint
    validTypes := []string{
        docs.DiffChangeTypeAdd,
        docs.DiffChangeTypeRemove,
        docs.DiffChangeTypeUnchanged,
    }

    // Verify constants match expected database values
    assert.Equal(t, "add", docs.DiffChangeTypeAdd)
    assert.Equal(t, "remove", docs.DiffChangeTypeRemove)
    assert.Equal(t, "unchanged", docs.DiffChangeTypeUnchanged)

    // Test API returns expected constants
    diff := getDiffFromAPI(t)
    for _, change := range diff.Changes {
        assert.Contains(t, validTypes, change.ChangeType,
            "API returned unexpected changeType: %s", change.ChangeType)
    }
}
```

**Real Bug Examples**:

*Cross-Layer Mismatch (December 2025)*:
- **Backend** returned: `changeType: "remove"` / **Frontend** expected: `"removed"`
- **Result**: Diff viewer showed empty content despite valid data
- **Prevention**: Integration tests validating constant synchronization

*Value Literal Instead of Constant (March 2026)*:
- Code used `role == "manager"` instead of `role == DepartmentRoleManager`
- Code used `IdentityType: "human"` instead of `IdentityType: database.IdentityTypeHuman`
- **Result**: 34 violations across 9 files — typo-prone, unrefactorable, defeats centralized definitions
- **Prevention**: This principle now mandates using named constants everywhere

**Rationale**:
- **Refactoring Safety**: Named constants enable IDE-assisted renames across the entire codebase; literals silently drift
- **Typo Prevention**: `iam.UserStatusActive` triggers a compile error if misspelled; `"actve"` silently passes
- **Runtime Safety**: Mismatched constants cause silent failures that are hard to debug
- **Maintainability**: Centralized constant definitions prevent drift across layers
- **Developer Experience**: Type-safe constants with IDE autocomplete reduce bugs
- **Quality Assurance**: Automated tests catch synchronization issues before production
- **Documentation**: Constants serve as executable documentation of valid values

---

### IX. UUID v7 Usage & Nullable Parameters for Cursor Pagination (CRITICAL - DATA INTEGRITY)

**Rule**: UUID v7 MUST be used for primary keys to enable time-sortable cursor-based pagination. Optional UUID parameters (cursors, filters) MUST use nullable types to distinguish between "not provided" and "zero value".

**Requirements**:

**1. UUID v7 for Primary Keys (MANDATORY)**:
- All entity primary keys MUST use UUID v7: `id UUID PRIMARY KEY DEFAULT uuidv7()`
- Benefits: Time-sortable IDs, cursor-based pagination without separate timestamp columns, distributed ID generation

**2. Nullable UUID Parameters (CRITICAL)**:
- Use `sqlc.narg()` for optional UUID parameters in SQL queries
- Use `dbuuid.NullUUID` for optional UUID parameters in Go code
- Distinguish between NULL (not provided) and zero value `00000000-0000-0000-0000-000000000000`

**Examples**:
```sql
-- ✅ CORRECT: UUID v7 primary key
CREATE TABLE crm.contact (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id)
);

-- ✅ CORRECT: Nullable UUID parameter for cursor pagination
-- name: ListContacts :many
SELECT * FROM crm.contact
WHERE organization_id = $1
  AND (sqlc.narg('cursor')::uuid IS NULL OR id < sqlc.narg('cursor'))
ORDER BY id DESC
LIMIT $2;
```

```go
// ✅ CORRECT: Using dbuuid.NullUUID for optional parameter
func (l *ContactLogic) ListContacts(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, cursor dbuuid.NullUUID, limit int) ([]*Contact, error) {
    return l.queries.ListContacts(ctx, tx, database.ListContactsParams{
        OrganizationID: orgID,
        Cursor:         cursor, // Nullable UUID
        Limit:          limit,
    })
}

// ❌ WRONG: Using dbuuid.UUID for optional parameter (zero-value bug)
func (l *ContactLogic) ListContacts(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, cursor dbuuid.UUID, limit int) ([]*Contact, error) {
    // When cursor is not provided, it's 00000000-..., NOT NULL in SQL!
}
```

**Rationale**:
- **NULL vs Zero Distinction**: Zero-value UUIDs are NOT NULL in SQL. Queries checking `$param::uuid IS NULL` will always be false for zero-value UUIDs, causing all records to be filtered out
- **Type Safety**: `dbuuid.NullUUID` makes nullability explicit in code, preventing accidental zero-value bugs

---

### X. Structured Error Details for Cross-Stack Error Handling (MANDATORY)

**Rule**: When generic Connect error codes are insufficient to guide client behavior, backend MUST attach structured error details using `google.rpc.ErrorDetails` proto definitions. Frontend MUST extract and handle these error details type-safely using schema validation.

**Requirements**:

**1. Error Detail Usage Criteria**:
- Use error details ONLY when generic error codes (`CodeUnavailable`, `CodeInvalidArgument`, etc.) cannot convey actionable information
- Error details MUST guide client code or user behavior in meaningful ways (e.g., retry timing, validation errors, resource quotas)
- DO NOT add error details for every error - prefer simple error codes and messages for common cases

**2. Backend Implementation (Go)**:
- Use standard `google.rpc.ErrorDetails` proto definitions (e.g., `RetryInfo`, `BadRequest`, `QuotaFailure`, `PreconditionFailure`)
- Create error details using `connect.NewErrorDetail()` for type-safe proto message attachment
- Attach error details to Connect errors using `err.AddDetail(detail)`
- Document error detail contract in API documentation and proto comments

**3. Frontend Implementation (TypeScript)**:
- Import error detail schemas from `@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb`
- Extract error details using `ConnectError.findDetails(Schema)` for type-safe schema validation
- Handle error details gracefully with fallback behavior if details missing or malformed
- Document error detail handling in API wrapper functions

**4. Coordination Process (MANDATORY)**:
When adding new error detail contracts:
- Define error detail proto message (use existing `google.rpc.ErrorDetails` when possible)
- Implement backend error detail attachment in Connect layer
- Implement frontend error detail extraction in API wrapper layer
- Document error detail contract in proto comments and API documentation
- Add integration tests verifying error detail round-trip (backend → frontend)
- Submit all changes in single PR with alignment verification

**Examples**:

```go
// ✅ CORRECT: Backend attaching RetryInfo for transient errors
func (s *ChatServiceServer) SendMessage(ctx context.Context, req *connect.Request[v1.SendMessageRequest]) (*connect.Response[v1.SendMessageResponse], error) {
    // ... business logic ...
    
    if isOverloaded {
        err := connect.NewError(
            connect.CodeUnavailable,
            errors.New("chat service overloaded: back off and retry"),
        )
        
        // Attach structured retry guidance
        retryInfo := &errdetails.RetryInfo{
            RetryDelay: durationpb.New(10 * time.Second),
        }
        if detail, detailErr := connect.NewErrorDetail(retryInfo); detailErr == nil {
            err.AddDetail(detail)
        }
        
        return nil, err
    }
    
    // ...
}

// ✅ CORRECT: Backend attaching BadRequest with field violations
func (s *DepartmentServiceServer) CreateDepartment(ctx context.Context, req *connect.Request[v1.CreateDepartmentRequest]) (*connect.Response[v1.CreateDepartmentResponse], error) {
    violations := validateDepartmentRequest(req.Msg)
    if len(violations) > 0 {
        err := connect.NewError(
            connect.CodeInvalidArgument,
            errors.New("invalid department data"),
        )
        
        badRequest := &errdetails.BadRequest{
            FieldViolations: violations, // []*errdetails.BadRequest_FieldViolation
        }
        if detail, detailErr := connect.NewErrorDetail(badRequest); detailErr == nil {
            err.AddDetail(detail)
        }
        
        return nil, err
    }
    
    // ...
}
```

```typescript
// ✅ CORRECT: Frontend extracting and handling RetryInfo
import { ConnectError } from "@connectrpc/connect";
import { RetryInfoSchema } from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
    try {
        return await rpcCall(async () => {
            const resp = await chatClient.sendMessage({
                channelId: params.channelId,
                messageText: params.messageText,
            });
            return resp as SendMessageResponse;
        });
    } catch (error) {
        if (error instanceof ConnectError && error.code === Code.Unavailable) {
            // Extract structured retry guidance
            const retryDetails = error.findDetails(RetryInfoSchema);
            if (retryDetails.length > 0) {
                const retryDelay = retryDetails[0].retryDelay?.seconds || 10;
                console.warn(`Service overloaded, retry in ${retryDelay}s`);
                // Client can schedule automatic retry or show user-friendly message
            }
        }
        throw error;
    }
}

// ✅ CORRECT: Frontend extracting and handling BadRequest field violations
import { BadRequestSchema } from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";

export async function createDepartment(params: CreateDepartmentParams): Promise<CreateDepartmentResponse> {
    try {
        return await rpcCall(async () => {
            const resp = await departmentClient.createDepartment({
                name: params.name,
                description: params.description,
            });
            return resp as CreateDepartmentResponse;
        });
    } catch (error) {
        if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
            // Extract field-level validation errors
            const badRequestDetails = error.findDetails(BadRequestSchema);
            if (badRequestDetails.length > 0) {
                const violations = badRequestDetails[0].fieldViolations || [];
                // Map violations to form field errors for user-friendly display
                const fieldErrors = violations.reduce((acc, v) => {
                    acc[v.field] = v.description;
                    return acc;
                }, {} as Record<string, string>);
                
                throw new ValidationError("Invalid department data", fieldErrors);
            }
        }
        throw error;
    }
}

// ❌ WRONG: Using error details for simple cases (unnecessary complexity)
func (s *UserServiceServer) GetUser(ctx context.Context, req *connect.Request[v1.GetUserRequest]) (*connect.Response[v1.GetUserResponse], error) {
    user, err := s.logic.GetUser(ctx, tx, req.Msg.UserId)
    if err == ErrNotFound {
        // VIOLATION: Simple not found case doesn't need error details
        err := connect.NewError(connect.CodeNotFound, errors.New("user not found"))
        notFoundInfo := &errdetails.ResourceInfo{
            ResourceType: "User",
            ResourceName: req.Msg.UserId,
        }
        // Unnecessary - generic CodeNotFound is sufficient
        err.AddDetail(connect.NewErrorDetail(notFoundInfo))
        return nil, err
    }
    // ...
}

// ❌ WRONG: Frontend not handling error details (missing type safety)
export async function sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
    try {
        return await rpcCall(async () => {
            const resp = await chatClient.sendMessage({
                channelId: params.channelId,
                messageText: params.messageText,
            });
            return resp as SendMessageResponse;
        });
    } catch (error) {
        // VIOLATION: Not extracting error details, losing retry guidance
        if (error instanceof ConnectError && error.code === Code.Unavailable) {
            console.warn("Service unavailable, try again later");
            // Missing: Extract RetryInfo to determine exact retry delay
        }
        throw error;
    }
}
```

**Common Error Detail Types**:
- `RetryInfo`: Transient errors with retry timing guidance (e.g., rate limiting, service overload)
- `BadRequest`: Field-level validation errors with specific field violations
- `QuotaFailure`: Resource quota exceeded with quota details
- `PreconditionFailure`: Business rule violations with specific precondition failures
- `ResourceInfo`: Resource-related errors (existence, ownership, conflicts)
- `DebugInfo`: Additional debug information for development/support (use sparingly in production)

**Rationale**:
- **Client Guidance**: Error details enable client code to make informed decisions (retry timing, field-level validation, quota management)
- **Type Safety**: Proto-based error details provide compile-time type checking across stack boundaries
- **Standard Definitions**: Using `google.rpc.ErrorDetails` ensures interoperability and reduces custom error detail definitions
- **Selective Usage**: Reserving error details for edge cases prevents unnecessary complexity in common error handling paths

**Reference**: ConnectRPC error handling documentation, `google.rpc.ErrorDetails` proto definitions

---

### XI. Distributed-First Architecture & Horizontal Scalability (MANDATORY)

**Rule**: ALL system designs MUST assume distributed deployment from the beginning. Backend services MUST be stateless and horizontally scalable. Ephemeral state MUST be stored in PostgreSQL UNLOGGED tables or distributed caches, NEVER in process memory.

**Requirements**:

**1. Multi-Instance Deployment Assumption (NON-NEGOTIABLE)**:
- Backend MUST deploy as minimum 3 instances for high availability
- NO assumptions about single-server deployment or process affinity
- Load balancers distribute requests randomly across instances
- Any instance can fail at any time without data loss

**2. Stateless Application Design (CRITICAL)**:
- NO in-process caches or session state (causes inconsistency across instances)
- NO local file storage (use object storage like Cloudflare R2)
- NO process-local counters or aggregations (use database atomic operations)
- Server-Sent Events (SSE) and WebSocket connections MUST handle reconnection across instances

**3. Ephemeral State Management**:
- **First Choice**: PostgreSQL UNLOGGED tables for fast ephemeral state (2-3x faster writes, automatic cleanup on crash)
- **Second Choice**: Distributed cache (Redis, Memcached) only if proven necessary via load testing
- **FORBIDDEN**: In-memory state shared via message queues or pub/sub (adds unnecessary complexity)
- UNLOGGED tables MUST be documented with data loss acceptance (e.g., "notification.active_connection - users reconnect on crash")

**4. Database Sharding Awareness**:
- PostgreSQL database MUST use Citus distributed architecture (see Principle I)
- All queries MUST be shard-aware (include `organization_id` for co-location)
- Cross-shard queries have performance implications (document justification)

**5. Connection Management**:
- Connection pools MUST be sized for N instances × concurrent requests
- Database connections MUST NOT assume server affinity (use connection pooling like PgBouncer)
- SSE/WebSocket connection registries MUST use database or distributed store (see `notification.active_connection` UNLOGGED table)

**Examples**:

```go
// ✅ CORRECT: Stateless backend using UNLOGGED table for ephemeral state
func (s *NotificationServer) RegisterConnection(ctx context.Context, employeeID dbuuid.UUID) error {
    // Store SSE connection in UNLOGGED table (shared across instances)
    return s.queries.UpsertActiveConnection(ctx, database.UpsertActiveConnectionParams{
        EmployeeID:     employeeID,
        InstanceID:     s.instanceID, // Backend instance identifier
        ConnectionID:   uuid.New(),
        LastHeartbeat:  time.Now(),
    })
}

// ✅ CORRECT: Query all instances to find active connections
func (s *NotificationServer) RouteNotification(ctx context.Context, employeeID dbuuid.UUID) error {
    // Query database to find which instance has the active connection
    conns, err := s.queries.GetActiveConnections(ctx, employeeID)
    if err != nil {
        return err
    }
    
    // Route notification to specific instance(s) via internal RPC or direct delivery
    for _, conn := range conns {
        if conn.InstanceID == s.instanceID {
            // Deliver locally to SSE connection
            s.deliverToLocalConnection(conn.ConnectionID, notification)
        } else {
            // Route to remote instance via internal RPC (optional)
            s.routeToInstance(conn.InstanceID, conn.ConnectionID, notification)
        }
    }
    return nil
}

// ❌ WRONG: In-process connection registry (not visible to other instances)
type NotificationServer struct {
    connections map[dbuuid.UUID]*sse.Connection // VIOLATION: Local state
}

func (s *NotificationServer) RegisterConnection(employeeID dbuuid.UUID, conn *sse.Connection) {
    s.connections[employeeID] = conn // VIOLATION: Not distributed
}

// ❌ WRONG: Local file storage (not accessible from other instances)
func (s *FileService) SaveUpload(ctx context.Context, file []byte) error {
    return os.WriteFile("/tmp/uploads/file.dat", file, 0644) // VIOLATION: Local disk
}

// ✅ CORRECT: Object storage (accessible from all instances)
func (s *FileService) SaveUpload(ctx context.Context, file []byte, key string) error {
    return s.r2Client.PutObject(ctx, s.bucket, key, bytes.NewReader(file))
}
```

```sql
-- ✅ CORRECT: UNLOGGED table for ephemeral connection state
CREATE UNLOGGED TABLE IF NOT EXISTS notification.active_connection(
    employee_id uuid NOT NULL,
    instance_id text NOT NULL, -- Backend instance hostname/ID
    connection_id uuid NOT NULL,
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    last_heartbeat timestamptz DEFAULT now(),
    PRIMARY KEY (organization_id, employee_id, connection_id)
);

COMMENT ON TABLE notification.active_connection IS 
'UNLOGGED table tracking active SSE connections across backend instances. 
Data lost on crash is acceptable (users reconnect). 2-3x faster writes than regular table.';

-- ✅ CORRECT: Query to find connections across all instances
-- name: GetActiveConnections :many
SELECT employee_id, instance_id, connection_id 
FROM notification.active_connection
WHERE organization_id = $1 AND employee_id = $2
  AND last_heartbeat > now() - interval '60 seconds';
```

```typescript
// ✅ CORRECT: Frontend handles reconnection across instances
class NotificationClient {
  private reconnect() {
    // SSE connection may reconnect to different backend instance
    this.eventSource = new EventSource('/api/notifications/stream');
    this.eventSource.onmessage = (event) => {
      // Handle notification
    };
    this.eventSource.onerror = () => {
      // Exponential backoff reconnection
      setTimeout(() => this.reconnect(), this.backoffMs);
    };
  }
}
```

**Design Checklist for New Features**:
- [ ] Backend logic is stateless (no process-local caches or state)
- [ ] Ephemeral state uses UNLOGGED tables or documented distributed cache
- [ ] Connection registries stored in database (not process memory)
- [ ] File uploads go to object storage (not local disk)
- [ ] Database queries are shard-aware (include `organization_id`)
- [ ] Load testing performed with 3+ backend instances
- [ ] Failure scenario tested (kill random instance, verify no data loss)

**Rationale**:
- **High Availability**: Multi-instance deployment prevents single point of failure
- **Horizontal Scalability**: Stateless backends scale linearly by adding instances
- **Cost Efficiency**: UNLOGGED tables provide 2-3x write performance for ephemeral state without external cache infrastructure
- **Operational Simplicity**: Database-backed state eliminates complex distributed coordination (no Redis cluster, no message queue dependencies)
- **Failure Resilience**: UNLOGGED table data loss on crash is acceptable for reconnectable state (users simply reconnect)

**Reference**: PostgreSQL UNLOGGED tables documentation, Citus distributed architecture (Principle I)

---

### XII. Living Documentation & Architecture Documentation Maintenance (MANDATORY)

**Rule**: Living domain documentation under `docs/domain/` and backend architecture documentation under `backend/docs/` MUST be consulted before making changes and MUST be updated after implementation is complete and all tests pass. Documentation updates are part of the Definition of Done.

**Domain Snapshots (`docs/domain/`) — the source of truth for current behaviour**:

`docs/domain/` holds one living document per business domain describing how the system behaves **today**, plus `README.md` (index and drift register). It is the authoritative answer to "what does this domain do right now".

`specs/NNN-*` records historical **intent** only. Specs are incremental change proposals written before implementation; reconstructing current state from them requires replaying every spec in order, and some describe designs that were later replaced. Agents and humans MUST read the relevant `docs/domain/*.md` rather than walking the spec history.

Where a spec and the code disagree, **the code wins**, and the disagreement MUST be recorded in the drift register in `docs/domain/README.md`.

| Document | Covers |
|----------|--------|
| `docs/domain/platform.md` | Architecture tiers, multi-tenancy, auth interceptor, background jobs, config, testing |
| `docs/domain/auth-identity.md` | Sign-up, sign-in, SSO, PIN accounts, sessions, invitations, roles and permissions |
| `docs/domain/organization-people.md` | Organizations, employees, employee import, departments, org chart |
| `docs/domain/chat.md` | Channels, messages, threads, reactions, typing, sidebar config, chat file uploads |
| `docs/domain/voice.md` | Voice calls, voice messages, recordings, transcripts, LiveKit integration |
| `docs/domain/notifications-presence.md` | Notification hub, subscriptions, SSE, push, rescue push, presence ping-pong |
| `docs/domain/rituals-tasks.md` | Projects, tasks, workflow rules, ritual definitions, evidence, generation sweep |
| `docs/domain/docs-knowledge.md` | Documents, versions, comments, embeds, collaborative editing |
| `docs/domain/files.md` | Upload flow, quota, validation, access rules, PDF conversion, content index |
| `docs/domain/calendar.md` | Events, recurrence, attendees, resources, booking links, delegation, check-in |
| `docs/domain/workspace-navigation.md` | Federated search, canonical resource links, context rail, theme, web and mobile shells |
| `docs/domain/compliance-safety.md` | Content reporting, blocking, account deletion, removal requests, terms acceptance |

**Architecture Documents (`backend/docs/`) — engineering-internal deep references**:
- `backend/docs/SYSTEM-ARCHITECTURE.md` — Domain-driven design, tier model, dependency graphs (code-level and data-level), server initialization order, cross-domain integration patterns
- `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` — Notification service ownership, subscription resolution, event taxonomy, delivery pipeline, cross-domain call graph

These are narrower and deeper than the domain snapshots and are NOT superseded by them. Both sets are maintained: a change to the tier model or the delivery pipeline updates `backend/docs/`, a change to what a domain does updates `docs/domain/`, and a change that does both updates both.

**Requirements**:

**1. Consult Before Changes (NON-NEGOTIABLE)**:
- Before specifying, planning, or implementing a change to any domain, read that domain's snapshot in `docs/domain/` to establish current behaviour. Do NOT derive current behaviour by reading the numbered specs in sequence.
- Before adding a new domain, service, or cross-domain dependency, read the relevant architecture document to understand the current tier model and dependency rules
- Before modifying database schema relationships across domains, consult the Database Schema Dependency Graph in `SYSTEM-ARCHITECTURE.md`
- Before changing notification publishing, routing, or subscription logic, consult `NOTIFICATION-SYSTEM-ARCHITECTURE.md`
- Proposed changes that violate documented dependency direction rules (Tier model: T0→T1→T2→T3, inward only) MUST be flagged and justified before implementation

**2. Update After Implementation + Tests Pass (NON-NEGOTIABLE)**:
- Architecture documentation MUST be updated ONLY after the implementation is complete AND all integration tests pass (`go test ./integration/...` — zero failures)
- This ordering ensures documentation reflects the actual implemented behavior, not aspirational designs
- Documentation updates MUST be included in the same PR as the implementation
- Updating documentation before tests pass is FORBIDDEN (risks documenting behavior that does not work)

**3. What MUST Be Updated**:
- **Any behaviour change** — a changed or added RPC surface, database constraint, background job cadence, or cross-domain call — MUST update the affected `docs/domain/*.md`. Superseded behaviour MUST be DELETED, not annotated: these documents describe the present tense and are not a changelog. Refresh the document's "Status date" line.
- **Drift discovered**: an inconsistency found and fixed MUST have its row removed from the drift register in `docs/domain/README.md`; an inconsistency found and NOT fixed MUST have a row added.
- **New domain added**: Update tier model table, dependency graphs (code-level and data-level), domain catalog, and server initialization order in `SYSTEM-ARCHITECTURE.md`
- **New cross-domain dependency**: Update both code-level and data-level dependency graphs; verify dependency direction compliance
- **New notification type or event**: Update event taxonomy table, delivery pipeline, and cross-domain call graph in `NOTIFICATION-SYSTEM-ARCHITECTURE.md`
- **New resource surface or subscription pattern**: Update Resource Surface Model and V2 Subscription Resolution sections
- **Schema changes affecting FK references**: Update Appendix: Full FK Reference Map in `SYSTEM-ARCHITECTURE.md`
- **Server initialization order changes**: Update Server Initialization Order section

**4. Documentation Quality Standards**:
- Mermaid diagrams MUST accurately reflect the current codebase (no stale nodes or edges)
- Tables MUST include all current entries (no omissions of existing domains, event types, or schemas)
- Version and date in document header MUST be updated when content changes

**Definition of Done Extension (NON-NEGOTIABLE)**:

A feature involving behaviour or architectural changes is complete ONLY when ALL of the following are true:
- [ ] All feature code implemented
- [ ] All integration tests pass (entire suite, zero failures)
- [ ] Affected `docs/domain/*.md` snapshots updated; superseded behaviour deleted; "Status date" refreshed
- [ ] Drift register in `docs/domain/README.md` reconciled (rows removed for fixes, added for known-unfixed issues)
- [ ] Architecture documentation reviewed against implementation
- [ ] Relevant `backend/docs/` files updated to reflect actual changes
- [ ] Mermaid diagrams verified against current dependency graph
- [ ] Documentation committed in the same PR as implementation

**Rationale**: Documentation is the primary reference for understanding system behaviour, structure, dependency rules, and integration patterns. Specifications alone cannot serve this role: they are cumulative and written before implementation, so answering "how does this work today" from them costs a full replay of the feature history and still misses work that landed outside the spec workflow. Stale documentation causes incorrect architectural decisions, dependency violations, and wasted investigation time. Updating after tests pass ensures documentation reflects working, verified behavior — not aspirational designs that may not work. Requiring same-PR commits prevents documentation from drifting behind implementation.

---

### XIII. Mobile Application Design & Testing — Expo + Maestro (MANDATORY)

**Rule**: The mobile app (Expo / React Native) targets **employees performing day-to-day tasks**.
Owners and operators MUST use the web application for full configuration and administrative
functions. Mobile UI MUST be simple, optimized for common phone screen sizes, and use
distinct layouts from the web app to make the best use of portrait mobile space.
All mobile UI MUST be covered by at least one Maestro blackbox flow that verifies the
feature works end-to-end on a real or simulated device.

**Feature Scope (NON-NEGOTIABLE)**:
- Mobile app MUST only surface employee-facing day-to-day features:
  task checking, chat, notifications, calendar events, personal profile, global search.
- Administrative / configuration features (department management, member import, IAM
  settings, billing, etc.) MUST remain web-only.
- **First-run onboarding carve-out (narrow, exhaustive)**: mobile MAY surface exactly two
  otherwise-administrative capabilities, and only as part of first-run onboarding:
  1. **Creating an organization** — an SMB owner registering their own workspace from a
     phone, before any account exists.
  2. **Creating the first org-managed accounts** — so a newly created workspace is not
     stranded as a one-person workspace.
  Everything else in IAM administration stays web-only: role and permission editing,
  department management, bulk member import, account deactivation, credential reset for
  other members, billing and plan management. The carve-out covers *starting* a workspace,
  never *administering* an existing one. Any mobile surface beyond these two capabilities
  requires a further amendment.
- When implementing a new backend feature, mobile is NOT required to expose it unless it
  is clearly part of an employee's day-to-day workflow. Justify any mobile additions
  that are not obviously day-to-day employee actions.

**Mobile UX Principles (MANDATORY)**:
- **Simplicity for low-tech users**: Minimize cognitive load. Prefer large tap targets,
  plain language labels, and minimal number of steps for primary actions. Avoid jargon,
  dropdowns with many options, or dense data tables.
- **Screen-size optimization**: Design for common portrait phone dimensions (360–430 dp
  width). Test layouts on a mid-range device (e.g., iPhone 14 / Pixel 7 equivalent).
  Do NOT assume tablet or foldable form factors unless explicitly specified.
- **Layout independence from web**: Mobile layouts MUST be purpose-built for mobile and
  MUST NOT be responsive copies of the web layout. Sidebars, multi-column grids, and
  dense toolbars used on web are FORBIDDEN on mobile. Use bottom tab navigation, full-
  screen detail views, and action sheets instead.
- **Distinct navigation model**: Primary navigation via the bottom tab bar
  (`tab-chat`, `tab-tasks`, `tab-calendar`, `tab-alerts`, `tab-more`). Secondary
  features accessible via the "More" menu. Deep-links MUST remain consistent with
  tab structure.

**testID Attribute Requirement (MANDATORY for Mobile — parallels `data-testid` rule)**:
- ALL interactive mobile elements MUST have a `testID` prop for Maestro targeting.
  This is the React Native equivalent of the web's `data-testid` requirement (Principle VII).
- Tab bar buttons MUST use `tabBarButtonTestID` (not `tabBarTestID`) — React Navigation v7.
- `Pressable` components with multiple text children MUST set `testID` on the `Pressable`
  itself (child `Text` nodes are not individually accessible via Maestro).
- Naming convention: `kebab-case`, descriptive, globally unique within the screen
  (e.g., `signin-button`, `task-complete-checkbox`, `send-message-button`).

**Maestro Blackbox Testing (MANDATORY)**:

The mobile testing bar is deliberately lighter than backend integration or web E2E tests:
Maestro operates as a pure blackbox UI driver, so we optimize for **functional coverage
of the happy path** rather than exhaustive edge-case coverage.

*Testing objectives*:
- Every mobile feature domain MUST have at least one Maestro flow that exercises its
  primary happy-path scenario from the user's perspective (open screen → perform action
  → verify result).
- Edge cases and error states are OPTIONAL in Maestro flows; cover them in backend
  integration tests instead.
- Flows MUST be readable YAML — a non-technical person who reads the flow should
  understand what the user is doing.

*Test location & organization*:
- ALL Maestro flows MUST be in `frontend/apps/mobile/.maestro/` organized by feature
  domain (e.g., `auth/`, `tasks/`, `chat/`, `notifications/`, `calendar/`, `profile/`,
  `search/`, `settings/`).
- One file per user scenario (e.g., `tasks/task-complete.yaml`, `chat/send-message.yaml`).
- Config in `frontend/apps/mobile/.maestro/config.yaml`; credentials in `.maestro/.env`
  (gitignored; template in `.maestro/.env.example`).

*Running tests*:
- Full suite: `make test-mobile` — runs ALL flows.
- Single flow: `make test-mobile-one F=<domain/flow-name>` (e.g., `F=auth/signin`).
- Prerequisites: Metro running on port 8082, backend running on port 8080.

*Known Maestro workarounds (MUST apply)*:
- **Secure text fields**: Always precede `inputText` with `eraseText: 20` to establish
  focus (iOS AutoFill / `secureTextEntry` blocks text otherwise).
- **Keyboard dismissal**: Tap a non-interactive visible element (e.g., page header) —
  `hideKeyboard` is not supported for React Native `TextInput`.
- **Duplicate text matches**: Add `testID` to the target element and use the `id:`
  selector in the flow YAML instead of relying on text matching.
- **clearState**: Use `clearState: false` with `clearKeychain: true` (not `clearState:
  true`, which wipes the Metro URL from UserDefaults).
- **Maestro variable syntax**: Use plain `${VAR_NAME}` without defaults; pass values via
  `-e` flags or the `.env` file.

**Example Maestro flow** (`frontend/apps/mobile/.maestro/tasks/task-complete.yaml`):
```yaml
# Functional coverage: employee marks a task as complete from the task list
appId: com.devguards.TechOffice
---
- launchApp:
    clearState: false
    clearKeychain: true
- runFlow: ../auth/signin.yaml   # reuse shared auth flow
- tapOn:
    id: tab-tasks
- assertVisible: "My Tasks"
- tapOn:
    id: first-task-item          # testID on the Pressable
- assertVisible: "Task Detail"
- tapOn:
    id: task-complete-checkbox
- assertVisible: "Task completed"
```

**Design Checklist for New Mobile Features**:
- [ ] Feature is in scope for mobile (employee day-to-day task — not admin/config)
- [ ] UI is simple: large tap targets, plain labels, ≤3 steps for primary action
- [ ] Layout designed for portrait phone (360–430 dp), NOT adapted from web layout
- [ ] All interactive elements have `testID` props
- [ ] Tab bar buttons use `tabBarButtonTestID`
- [ ] Maestro flow(s) added in `frontend/apps/mobile/.maestro/<domain>/` covering
      the happy path
- [ ] `make test-mobile` passes (full suite, zero failures)

**Rationale**: The mobile app serves field workers who may not be technically proficient.
Keeping the feature scope limited to day-to-day employee tasks prevents feature bloat
and ensures the app stays simple and purposeful. Separate mobile layouts from web avoid
forcing responsive compromises onto both platforms. Maestro blackbox tests verify real
device behavior without relying on component mocks, and the lighter testing bar (happy
path only) reflects the blackbox constraint while still ensuring all functions are
exercised before release.

---

## Operational & Security Constraints

### Secrets Management
- ❌ NO secrets in source control
- ✅ Use environment variables or secret stores

### Database Standards
- Target: PostgreSQL 18+
- Singular table names, `snake_case` naming
- Primary keys: `id`, updated timestamps: `updated_at` (no `created_at`)
- Migrations: forward-only `psql` runner over timestamped `.up.sql` files in `backend/database/migrations/`; apply via `cd backend && ./scripts/migrate.sh`, check state with `./scripts/migrate.sh status`, and recover by rerunning the script after fixing SQL issues
- Query files: `backend/database/scripts/*.query.sql` (domain-specific)
- Code generation: Run `sqlc generate` after SQL changes

### Infrastructure Changes
- MUST include migration and rollout plan
- Follow k8s overlay patterns in `k8s/overlays/`
- Document rollback procedures
- Test in dev environment first

---

## Amendment & Governance

### Compliance Review
- All PRs MUST be reviewed against this constitution
- Constitutional violations MUST be flagged during code review
- Exceptions require explicit maintainer approval with documented rationale
- Plan template includes "Constitution Check" gate (`.specify/templates/plan-template.md`)

### Version History
- v5.17.0 (2026-08-26): MINOR — Principle XIII Feature Scope gains a narrow, exhaustive first-run onboarding carve-out permitting exactly two otherwise-administrative capabilities on mobile: creating an organization, and creating the first org-managed accounts. Rationale: the target user is a small-business owner who may not use a desktop computer for work at all, so requiring a laptop to create the workspace defeats the product's purpose, and a workspace with no employees has no value. Ongoing IAM administration — role and permission editing, department management, bulk import, deactivation, credential reset for others, billing — remains web-only. Unblocks feature 035 (mobile SMB owner onboarding & PIN-first login)
- v5.16.0 (2026-08-22): MINOR — Principle XII renamed to "Living Documentation & Architecture Documentation Maintenance" and extended to cover `docs/domain/`: per-domain living snapshots are declared the source of truth for current system behaviour, `specs/NNN-*` is demoted to historical intent, agents MUST read the snapshot rather than replaying spec history, superseded behaviour MUST be deleted rather than annotated, and the drift register in `docs/domain/README.md` MUST be reconciled; Definition of Done extended with snapshot and drift-register items; Reference Documents section updated
- v5.15.0 (2026-04-02): MINOR — Replaced golang-migrate workflow with a forward-only `psql` migration runner in `backend/scripts/migrate.sh`; updated migration policy to use timestamped `.up.sql` files, `public.schema_migrations` bookkeeping, status checks via `./scripts/migrate.sh status`, and compensating forward migrations instead of automated down execution
- v5.14.0 (2026-03-22): MINOR — Added Principle XIII (Mobile Application Design & Testing — Expo + Maestro): defines employee-only feature scope for mobile, UX rules (simplicity, screen-size optimization, layout independence from web), testID attribute requirement (React Native equivalent of data-testid), and Maestro blackbox testing mandate (happy-path flows per domain in `frontend/apps/mobile/.maestro/`, full suite via `make test-mobile`); Principle II Definition of Done extended with mobile Maestro requirement
- v5.13.0 (2026-03-21): MINOR — Principle II expanded to mandate web E2E tests (Playwright) as NON-NEGOTIABLE alongside backend integration tests; E2E scenarios MUST be derived from spec User Stories using the same scenario-as-contract workflow; added E2E test location, pattern ("Arrange via API, Act via UI, Assert via UI"), helper documentation, and scenario stub examples; Definition of Done updated to require both full backend integration suite AND full E2E suite to pass
- v5.12.1 (2026-03-19): PATCH — Fixed speckit.constitution.agent.md propagation checklist: step 4 path corrected from non-existent `.specify/templates/commands/*.md` to `.github/agents/speckit.*.agent.md` and `.github/prompts/speckit.*.prompt.md`; all agent files now verified consistent with current constitution; no principle changes.
- v5.12.0 (2026-03-18): Principle II expanded with Scenario-as-Contract mandate — test scenarios MUST be derived from spec User Stories and FR-XXX Requirements; every User Story and user-observable FR must have a scenario; scenario stubs reviewed and approved during planning (before tasks are created) constitute the behavioral contract; FR traceability comments required in test files; plan-template.md updated with traceability checks
- v5.11.0 (2026-03-10): Added Principle XII (Architecture Documentation Maintenance) mandating that backend/docs/ architecture documents be consulted before architectural changes and updated after implementation + tests pass; added architecture doc checks to plan and tasks templates
- v5.10.0 (2026-03-10): Principle II overhauled to scenario-first testing workflow — test scenarios MUST be composed and reviewed before implementation; added Definition of Done requiring entire test suite to pass; updated plan and tasks templates with scenario composition and review gates
- v5.9.0 (2026-03-07): Enhanced Principle VIII with NON-NEGOTIABLE rule mandating named constants instead of value literals; fixed 34 existing violations across 9 backend files; added NotificationPreference constants to notification package
- v5.8.0 (2025-12-20): Enhanced Principle VIII (Cross-Stack Constant & Type Synchronization) with automated testing requirements and real bug example demonstrating the impact of constant mismatches between backend and frontend layers
- v5.7.0 (2025-11-12): Added Principle XI (Distributed-First Architecture & Horizontal Scalability) to mandate distributed system design thinking from day one
- v5.6.0 (2025-11-09): Added Principle X (Structured Error Details for Cross-Stack Error Handling) to standardize error detail contracts between backend and frontend
- v5.5.0 (2025-11-09): Added proto-level authorization requirements (Principle III) and theme system requirements (Principle VII) to enforce declarative access control and consistent UI theming
- v5.4.1 (2025-11-07): Consolidated examples from language-specific instruction files; no semantic changes to principles (clarification)
- v5.4.0 (2025-11-04): Replaced Atlas migration workflow with golang-migrate requirements, mandated migrate.sh validation, and updated templates/instructions accordingly.
- v5.3.0 (2025-11-04): Added comprehensive Citus sharding constraints (trigger prohibition, immutable function requirement for ON CONFLICT DO UPDATE, FK cascade restrictions)
- v5.2.2 (2025-11-04): Clarified composite foreign key rules and tenant index consolidation guidance
- v5.2.1 (2025-11-03): Enhanced Principle II with test helper utilities documentation (`GetRandomTestIdentityAndKey`, `GlobalSigner`, `GlobalDbPool`), clarified test location requirement (`backend/integration/`), added examples for different role-based test scenarios (clarification)
- v5.2.0 (2025-11-03): Added Citus sharding requirements (unique indexes + organization_id), updated testing philosophy (backend integration tests, no frontend unit tests), added UI accessibility requirements (data-testid)
- v5.1.1 (2025-11-02): Added concise code examples to 7 coding-related principles (clarification)
- v5.1.0 (2025-11-02): Removed Citus-specific requirements (distributed tables, rigid index ordering); added cardinality-based index optimization guidance
- v5.0.0 (2025-11-01): Major restructure to eliminate duplication and consolidate data governance principles
- v4.0.0 (2025-10-29): Major restructure to eliminate duplication; constitution now focuses on governance, delegates implementation to language-specific guides
- v3.6.0 (2025-10-29): Added Principle VI (Cross-Domain Integration)
- Earlier versions: See git history

---

## Reference Documents

**Domain Snapshots — source of truth for current behaviour** (see Principle XII):
- `docs/domain/README.md` - Index, maintenance rule, and drift register
- `docs/domain/*.md` - One living document per business domain: platform, auth-identity, organization-people, chat, voice, notifications-presence, rituals-tasks, docs-knowledge, files, calendar, workspace-navigation

**Architecture Documentation**:
- `backend/docs/SYSTEM-ARCHITECTURE.md` - Domain-driven design, tier model, dependency graphs, server init order
- `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` - Notification service architecture, event taxonomy, delivery pipeline

**Templates & Processes**:
- `.specify/templates/plan-template.md` - Feature planning template with constitution checks
- `.specify/templates/spec-template.md` - Technical specification template
- `.specify/templates/tasks-template.md` - Task breakdown template
