# Phase 0 Research: Org-Managed User Accounts with Passkey-Based Login

## 1. Existing Identity Architecture

### Decision: Extend existing shared-ID architecture
**Rationale**: The codebase uses a shared-UUID pattern where `iam.user.id` = `iam.identity.id` = `organization.employee.id`. All three tables share the same UUID, established during invitation acceptance (`AcceptInvitationWithToken` in `logic.go`). The permission system (`GetUserPermissionsInOrg`) uses this shared ID directly as `employee_id` in the `iam.employee_role` JOIN chain.

**Key finding**: JWT `sub` claim holds the shared ID, which the interceptor passes directly to `iam.employee_role.employee_id` queries. This means the JWT format can remain unchanged for PIN-based workers — they just need to follow the same shared-ID pattern.

### Current Table Relationships
```
iam.user (global, id=UUID)
  └── iam.identity (org-scoped, id=user.id, organization_id)
  └── organization.employee (org-scoped, id=user.id, organization_id)
  └── iam.employee_role (org-scoped, employee_id=user.id)
  └── iam.session (global, user_id=user.id)
  └── iam.password_credential (global, user_id=user.id)
  └── iam.sso_identity (global, user_id=user.id)
```

**Alternatives considered**:
- Create separate auth anchor for workers (new table) — rejected: breaks shared-ID pattern, doubles auth paths
- Use iam.identity as sole auth anchor (remove iam.user dependency) — rejected: massive migration, breaks all existing sessions/tokens

### Existing patterns to follow:
- `backend/internal/iam/logic.go` — AcceptInvitationWithToken shared-ID creation
- `backend/internal/iam/connect_auth.go` — JWT generation with shared user ID
- `backend/internal/iam/permission_lookup.go` — permission resolution via shared ID

---

## 2. Schema Extension Design

### Decision: Make `iam.user.email` nullable + add `login_identifier` to `iam.identity`

**Rationale**: 
- PostgreSQL UNIQUE constraint allows multiple NULLs — workers without email get `iam.user.email = NULL`
- `iam.identity.email` becomes nullable, with new `login_identifier` column (org-scoped unique)
- `organization.employee.email` already defaults to `''` — no changes needed
- CHECK constraint ensures at least one of email/login_identifier is set on `iam.identity`

**Alternatives considered**:
- Generate synthetic emails for workers (e.g., `badge123@org.internal`) — rejected: leaks implementation detail, confusing for queries/display
- Skip `iam.user` for workers entirely — rejected: breaks shared-ID pattern and session/JWT system

---

## 3. Credential Unification

### Decision: New `iam.credential` table (org-scoped) for PIN/biometric, keep existing tables for backward compat

**Rationale**: 
- Existing `iam.password_credential` and `iam.sso_identity` are global (no organization_id). They work for email-based users across orgs.
- PIN credentials are inherently org-scoped (a worker's PIN is per-org). A new org-scoped `iam.credential` table supports PIN/biometric with proper Citus distribution.
- Existing `iam.password_credential` remains for email+password auth. No migration needed.
- Future: password credentials could be moved to `iam.credential` in a subsequent feature if desired.

**Alternatives considered**:
- Extend `iam.password_credential` with type column — rejected: it's global (no org_id), can't be Citus-distributed, and would break existing FK structure
- Replace all credential tables with one unified table — rejected: over-engineering for this feature, existing password/SSO flows work fine

---

## 4. Login Flow for PIN-Based Workers

### Decision: New dedicated RPC methods for PIN auth (not overloading existing Login)

**Rationale**:
- Existing `Login` method takes email+password. PIN login takes (org_subdomain, login_identifier, pin).
- Different input shape → different RPC method is cleaner than conditional logic.
- PIN login requires org context upfront (to resolve login_identifier uniqueness), unlike email login which is global.

**Flow**:
1. Worker enters: org subdomain + login identifier + PIN on a dedicated login screen
2. `LoginWithPIN(organization_subdomain, login_identifier, pin)` → resolves org → finds identity → checks credential → issues JWT
3. If credential state = 'temporary' → return `pin_change_required: true` in response (client redirects to PIN change screen)
4. `SetPIN(new_pin)` → validates 6-digit numeric, not DOB/phone → replaces temporary credential with active one

**Existing patterns**:
- `LoginWithPassword` in logic.go — password verification flow structure
- `SwitchOrganization` in connect_auth.go — generates org-scoped JWT with session

---

## 5. Account Lockout Design

### Decision: New `iam.account_lockout` table (org-scoped) with tier-based escalation

**Rationale**: No existing lockout mechanism in the codebase. Need a dedicated table to track failed attempts across server instances (distributed-first architecture, Constitution Principle XI).

**Lockout tiers** (from spec):
- Tier 0: 0-2 failures, no lockout
- Tier 1: 3 failures → 1 minute lockout
- Tier 2: 4 failures → 5 minute lockout  
- Tier 3: 5 failures → 15 minute lockout
- Tier 4: 6 failures → full account lock (admin reset required)

**State management**: Lockout state stored in database (not memory), consistent across all instances per Constitution Principle XI.

---

## 6. Batch Import Extension

### Decision: Extend existing `ExecuteEmployeeImport` to support email-free workers

**Rationale**: 
- Existing import creates `organization.employee` + invitation (email-based).
- For email-free workers: skip invitation, create the full entity chain (iam.user + iam.identity + organization.employee + iam.credential with temporary PIN + iam.employee_role) in one transaction.
- One-time PIN batch results returned in response, not stored persistently.

**Existing patterns**:
- `importSingleEmployee` in connect_auth.go — current per-row import logic
- `dbcrud.Create` — generic record creation helper

---

## 7. Permission Addition

### Decision: Add `iam.manageOrgAccounts` to default Owner permissions

**Rationale**: Follows existing pattern in `public.default_role_permission` seeding. Owner role gets the new permission by default. Operators can be granted it explicitly via role management.

**Existing patterns**:
- `public.default_role_permission` table seeds — initial org role permissions
- `iam.role_permission` — runtime permission management
- Proto `access_control` options on RPC methods

---

## 8. JWT & Session Compatibility

### Decision: No JWT format changes. Sessions created identically for PIN and email users.

**Rationale**:
- JWT `sub` = shared ID (iam.user.id = iam.identity.id = organization.employee.id) — same for PIN workers
- JWT includes `org_id` — already present for org-scoped tokens
- JWT `email` field — will be empty string for email-free workers (non-breaking)
- `iam.session` table — works as-is with `user_id` = shared ID
- Interceptor permission resolution — unchanged, uses shared ID as employee_id

**Existing patterns**:
- `GenerateTokenWithOrg(userID, email, orgID)` — token generation
- `CreateSessionForUser` — session persistence

---

## 9. Frontend Login Flow

### Decision: Separate PIN login page from existing email login

**Rationale**: PIN login requires org context (subdomain/selection) + login identifier + PIN. This is a fundamentally different UX from email+password or SSO login. A dedicated route avoids confusing the existing login flow.

**Route**: `/login/pin` or org-subdomain-specific login with PIN tab.

---

## 10. Citus Sharding Compliance Check

All new tables must follow Citus requirements:
- ✅ `iam.credential` — distributed on `organization_id`, composite PK `(organization_id, id)`
- ✅ `iam.account_lockout` — distributed on `organization_id`, composite PK `(organization_id, identity_id)`
- ✅ `iam.identity` changes — already distributed, new columns don't affect distribution
- ⚠️ `iam.user.email` nullable change — global table (not distributed), standard ALTER
- ✅ All FKs reference composite keys including `organization_id`
- ✅ No triggers, no `ON DELETE SET NULL`, no `now()` in ON CONFLICT DO UPDATE
