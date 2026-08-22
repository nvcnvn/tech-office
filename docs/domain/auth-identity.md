# Auth & Identity

Who a person is, how they prove it, which organizations they belong to, and what they are
allowed to do. Owned by `internal/iam` and `rpc/v1/iam.proto` (`IAMService`, 40 RPCs).

**Status date: 2026-08-22.** Supersedes specs 001, 002, 018, 020, 024.

## The identity model

Three layers, deliberately separate:

| Table | Scope | Holds |
|---|---|---|
| `iam.user` | **global** (not distributed) | one row per human across the whole platform. `email` is nullable; `is_org_managed` distinguishes self-registered from admin-provisioned. |
| `iam.identity` | per-organization | the user's membership in one org. Carries `email` *or* `login_identifier` (at least one, enforced by CHECK). |
| `organization.employee` | per-organization | the HR/profile record — names, hire date, phone, department membership. |

A user can belong to many organizations; each membership is a separate `iam.identity` row,
and switching orgs (`SwitchOrganization`) re-issues the JWT with a different org claim.

Credentials hang off whichever layer they belong to:

- `iam.password_credential` — global, bcrypt cost 12, 8–72 chars.
- `iam.sso_identity` — global, provider `google` or `apple`.
- `iam.credential` — **org-scoped**, `credential_type IN ('pin','biometric')`, states
  `active | temporary | revoked`, `expires_at` defaulting to `now() + 3 days`.

## Authentication methods

### 1. Email + password

`Login` verifies the bcrypt hash and issues an internal JWT. `ChangePassword` invalidates
all sessions. `RequestPasswordReset` / `ResetPassword` use `iam.password_reset_token` with
a 1-hour expiry, delivered by AWS SES (`internal/iam/email_sender_ses.go`; falls back to
logging when SES is unconfigured).

### 2. SSO (Google, Apple) — direct, no Zitadel

`ExchangeToken` takes a provider ID token, verifies it against the provider's JWKS
(`internal/iam/jwks.go`), find-or-creates the `iam.user`, links the `iam.sso_identity`, and
issues an internal JWT. **Audience validation is skipped when `GOOGLE_CLIENT_IDS` /
`APPLE_CLIENT_IDS` are unset** — the server logs this as dev-only, and it must not ship
that way. `LinkSSOIdentity` / `UnlinkSSOIdentity` manage additional providers on an
existing account.

### 3. PIN (org-managed worker accounts)

For deskless workers who have no email address. An admin with `iam.manageOrgAccounts`
creates the account (`CreateOrgAccount` / `BatchCreateOrgAccounts`); the response carries a
**one-time temporary PIN** that is never retrievable again.

- PIN is exactly 6 digits, bcrypt cost 10 (lower than passwords, deliberately — PIN checks
  are on the hot path of a shift start).
- Temporary PINs expire after 3 days and force `pin_change_required`. `SetPIN` accepts
  either a `pin_change_token` (10-minute expiry, no auth header) or a valid JWT.
- `ComparePINWithPersonalData` rejects a chosen PIN that matches the worker's date of birth
  in `YYMMDD`/`DDMMYY`/`MMDDYY` form, or the last 6 digits of their phone number.
- Login is `subdomain + login_identifier + PIN`; `login_identifier` is unique per org
  (badge number, username) via a partial unique index.

**Lockout** (`iam.account_lockout`, per identity, escalating on consecutive failures):

| Failures | Tier | Lockout |
|---|---|---|
| 0–2 | 0 | none |
| 3 | 1 | 1 minute |
| 4 | 2 | 5 minutes |
| 5 | 3 | 15 minutes |
| 6+ | 4 | full lock — admin `UnlockOrgAccount` required |

A successful authentication resets to tier 0. Admins also have
`ResetOrgAccountCredential` (new temporary PIN, revokes existing) and
`DeactivateOrgAccount` (immediately invalidates all sessions).

## Sessions

`iam.session` is a global regular table (not UNLOGGED — sessions must survive a crash). It
stores the JWT `jti`, issue/expiry, last activity, IP and user agent. Expiry is 30 days.
`GetActiveSessions` lists them; `Logout` invalidates one, `LogoutAllSessions` invalidates
all. Invalidation is a timestamp (`invalidated_at`), not a delete, so the audit trail
survives.

## Joining an organization

Two paths:

- **Invitation** — `InviteUser` writes `iam.invitation` (7-day expiry, statuses
  `pending | accepted | cancelled | expired`) and emails a link. `AcceptInvitation` creates
  the `iam.identity` + `organization.employee` and assigns the default role.
  `ListInvitations` / `CancelInvitation` for administration.
- **Import** — `PreviewEmployeeImport` then `ExecuteEmployeeImport` for CSV/Excel bulk
  onboarding. See [organization-people.md](organization-people.md).

`GetUserOrganizations` lists memberships, `SwitchOrganization` re-issues the token.

## Authorization: permissions, not roles

Feature 020 replaced role checks with permission checks. Roles are just named bundles.

- `public.permission` — the canonical catalogue, a Citus **reference table** replicated to
  every worker. IDs are `<domain>.<action>`, e.g. `chat.sendMessage`. Rows are immutable at
  runtime; only migrations change them. Domains: `iam`, `org`, `dept`, `chat`, `files`,
  `docs`, `collab`, `notif`, `calendar`, `pref`.
- `public.default_role` + `public.default_role_permission` — the three system role
  templates copied into every new organization.
- `iam.role` / `iam.role_permission` / `iam.employee_role` — the per-org instances. Orgs
  can create their own roles (`CreateRole`, `UpdateRole`, `DeleteRole`) and assign them
  (`AssignRole`, `RevokeRole`).

The three seeded roles:

| Role | Grant |
|---|---|
| `owner` | every permission. Cannot have role-management permissions removed. |
| `operator` | everything except `iam.importEmployees`, `files.updateQuota`, `iam.manageRoles`, `iam.manageOrgAccounts` |
| `employee` | everything except the invite/import/role/org-account permissions and the `dept.*` mutation permissions and `files.updateQuota` |

All three are `is_system = true` and cannot be deleted from an org.

Enforcement happens entirely in the interceptor from the proto `access_control` option —
see [platform.md](platform.md#authentication-and-authorization). Handlers do not re-check
permissions; they check *resource-level* access (project membership, channel membership,
document ACL), which is a different question.

`ListPermissions`, `ListRoles`, `GetRole`, `ListEmployeeRoles` and
`GetEmployeePermissions` expose the model to the admin UI
(`apps/web/src/app/workspace/organization/components/PermissionsTab.tsx`).

## Client surfaces

- Web: `/signup`, `/signin`, `/login/pin`, `/login/pin/set-pin`, `/forgot-password`,
  `/reset-password`, `/accept-invitation`, `/callback` (SSO), `/workspace/profile`.
- Mobile: `app/(auth)/` — `signin`, `signup`, `pin`, `set-pin`, `forgot-password`,
  `reset-password`, `accept-invitation`, `sso-callback`, plus `canonical-signin.tsx` for
  the deep-link entry path.
- Shared clients: `packages/apis/src/iam.ts`, `iam-org-accounts.ts`, `token.ts`,
  `auth-events.ts`.

## Tests

`integration/iam_auth_methods_test.go`, `iam_permission_test.go`,
`iam_role_lifecycle_test.go`, `iam_employee_cards_test.go`, `org_managed_accounts_test.go`,
`organization_onboarding_test.go`, `multi_tenancy_test.go`.

## Known drift

**D4 — spec 024 says passkey; the code says PIN.** There is no WebAuthn, no passkey, and
no `navigator.credentials` anywhere in the repo. Feature 024 shipped as PIN authentication
with escalating lockout. Two artefacts of the abandoned half remain:

- `iam.credential.credential_type` allows `'biometric'`, and
  `iam.CredentialTypeBiometric` is declared, but nothing ever writes or reads it.
- `apps/mobile/src/hooks/use-biometrics.ts` wraps `expo-local-authentication` and is
  imported by nothing.

Read spec 024 for intent only; the file name and title are misleading.

**D6 — Zitadel residue.** Spec 002 describes the Zitadel integration that feature 018
removed. The removal is complete in behaviour but left three traces:

- a stale doc comment in `apps/web/src/app/signin/components/LoginForm.tsx`
  ("Uses @zitadel/react via custom auth hooks") — the file does not;
- generated declaration files under `frontend/packages/apis/dst/` referencing
  `ZitadelAuthService` (build output, not source);
- `public.organization.project_id` and `app_id`, both still `NOT NULL`, commented as links
  to the "legacy external auth project". Every org creation must still populate them.

**SSO audience validation is opt-in.** With `GOOGLE_CLIENT_IDS`/`APPLE_CLIENT_IDS` unset
the server accepts any Google- or Apple-signed ID token regardless of which application it
was issued for. This is logged at startup but not enforced. Treat these as required in any
non-development deployment.
