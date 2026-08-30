# Auth & Identity

Who a person is, how they prove it, which organizations they belong to, and what they are
allowed to do. Owned by `internal/iam` and `rpc/v1/iam.proto` (`IAMService`, 40 RPCs).

**Status date: 2026-08-28.** Supersedes specs 001, 002, 018, 020, 024, 035.

## The identity model

Three layers, deliberately separate:

| Table | Scope | Holds |
|---|---|---|
| `iam.user` | **global** (not distributed) | one row per human across the whole platform. `email` is nullable; `is_org_managed` distinguishes self-registered from admin-provisioned. |
| `iam.identity` | per-organization | the user's membership in one org. Carries `email` *or* `login_identifier` (at least one, enforced by CHECK). |
| `organization.employee` | per-organization | the HR/profile record — names, hire date, phone, department membership. |

A user can belong to many organizations; each membership is a separate `iam.identity` row,
and switching orgs (`SwitchOrganization`) re-issues the JWT with a different org claim.

**The three layers share one UUID.** `iam.user.id`, `iam.identity.id` and
`organization.employee.id` are the same value for a person. This is load-bearing:
`GetUserRoleNamesInOrg` filters `iam.employee_role.employee_id` with a JWT user id, and
account deletion enumerates memberships with `SELECT organization_id FROM iam.identity
WHERE id = $1`. There is no user↔organization mapping table and none is needed. Spec 036
recorded the invariant as a `COMMENT ON COLUMN iam.identity.id`; before that it was
implicit and had to be re-derived from a query's parameter name.

Credentials hang off whichever layer they belong to:

- `iam.password_credential` — global, bcrypt cost 12, 8–72 chars.
- `iam.user.terms_version_accepted` / `terms_accepted_at` — global, the person's current
  acceptance of the published terms. Only the current one is kept, not a history.
- `iam.sso_identity` — global, provider `google` or `apple`.
- `iam.credential` — **org-scoped**, `credential_type IN ('pin','biometric')`, states
  `active | temporary | revoked`, `expires_at` defaulting to `now() + 3 days`.

## Authentication methods

### 1. Email + password

`Login` verifies the bcrypt hash and issues an internal JWT. `ChangePassword` invalidates
all sessions. `RequestPasswordReset` / `ResetPassword` use `iam.password_reset_token` with
a 1-hour expiry, delivered by AWS SES (`internal/iam/email_sender_ses.go`; falls back to
logging when SES is unconfigured).

`iam.MinPasswordLength` / `MaxPasswordLength` (8 and 72, bcrypt's ceiling) are the rule,
and every client states the same one: `frontend/packages/validations` holds the single
`passwordSchema` that the web signup form and the mobile owner signup both use. They used
to disagree — web demanded 16, mobile 8 — so the same product asked for two different
passwords depending on the device, and the web form's stricter rule appeared nowhere in
the API contract.

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
- Login is `subdomain + identifier + PIN`. The `login_identifier` request field is resolved
  against `iam.identity.login_identifier` **or** `lower(email)`, with an exact
  `login_identifier` match ordered first (`DESC NULLS LAST` — an owner's NULL
  `login_identifier` would otherwise sort ahead of a real match). `login_identifier` is
  unique per org via a partial unique index, and `email` is unique per org, but their union
  is not, so the ordering is what makes resolution deterministic.
- Because of that resolution, **an owner registered by email holds a PIN with no schema
  change**: `iam.user.id == iam.identity.id == organization.employee.id` for one person, so
  `SetPIN` writes `iam.credential` against a key `LoginWithPIN` can find. Clients present
  one "who are you" field and let the server decide how to resolve it.
- `CreateOrgAccount` rejects a `login_identifier` containing `@` (`ErrLoginIdentifierInvalid`,
  `InvalidArgument` with a `BadRequest` naming the field). This keeps the identifier and
  email namespaces disjoint, which is what makes the widened lookup unambiguous.
- **A voluntary PIN change requires `current_pin`**, verified with `ComparePINHash`. Missing
  → `InvalidArgument` with a `BadRequest` naming `current_pin`; wrong → `PermissionDenied`.
  First-time set is exempt: a `pin_change_token` was supplied, the identity holds no PIN
  credential, or the existing credential is still `temporary`.

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

A lockout returns `ResourceExhausted` carrying `rpc.v1.PinAuthErrorDetail` (tier,
`admin_reset_required`, `lockout_until_unix`). Tiers 1–3 **also** carry
`google.rpc.RetryInfo` with the time actually remaining, so a client renders a live
countdown rather than a static "try later"; tier 4 carries none, because no delay resolves
a full lock, and adds `ErrorInfo{reason: PIN_ACCOUNT_LOCKED}`. Email sign-in is **not**
gated by PIN lockout — `checkLockout` is called from `LoginWithPIN` only — which is what
makes email and password the way back in for a fully locked owner.

## Sessions

`iam.session` is a global regular table (not UNLOGGED — sessions must survive a crash). It
stores the JWT `jti`, issue/expiry, last activity, IP and user agent. Expiry is 30 days.
`GetActiveSessions` lists them; `Logout` invalidates one, `LogoutAllSessions` invalidates
all. Invalidation is a timestamp (`invalidated_at`), not a delete, so the audit trail
survives.

**On mobile the token lives in the Keychain at `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`**, set
in `apps/mobile/src/lib/secure-store.ts` and used by every secure-storage caller in the app
— the auth hook, the platform adapter the `apis` package writes through, and the stable
push installation id. `expo-secure-store` defaults to `WHEN_UNLOCKED`, which cannot be read
by an app woken on a locked screen, so a VoIP call push booted the app unauthenticated and
it could neither ring nor join; see
[voice.md](voice.md#native-call-presentation). The level is deliberately the weakest one
that survives a locked screen: nothing is readable until the phone has been unlocked once
since boot. Writes replace the entry rather than update it, because the Keychain leaves
`kSecAttrAccessible` alone on an update — which is also what migrates a phone signed in
before this, on its next launch.

## Joining an organization

Two paths:

- **Invitation** — `InviteUser` writes `iam.invitation` (7-day expiry, statuses
  `pending | accepted | cancelled | expired`) and emails a link. `AcceptInvitation` creates
  the `iam.identity` + `organization.employee` this organization is missing — including
  for a user who already exists in another workspace, which is what makes a second
  membership possible — and assigns the default role.
  `ListInvitations` / `CancelInvitation` for administration.
- **Import** — `PreviewEmployeeImport` then `ExecuteEmployeeImport` for CSV/Excel bulk
  onboarding. See [organization-people.md](organization-people.md).

`GetUserOrganizations` lists memberships, `SwitchOrganization` re-issues the token.

Both `RegisterOrganizationWithAdminPassword` and `AcceptInvitation` require an
`accepted_terms_version` matching `iam.CurrentTermsVersion`, and record it on
`iam.user.terms_version_accepted` / `terms_accepted_at` in the same transaction that
creates the account. A request without it is rejected, so no account can exist without a
stored acceptance. `AcceptTerms` / `GetTermsStatus` cover admin-provisioned workers, who
never see a signup screen — see [compliance-safety.md](compliance-safety.md).

## Leaving: deletion and removal

Which path a person gets is decided by `iam.user.is_org_managed`:

- **Self-registered** (`false`) — `IAMService.DeleteMyAccount` erases the account from
  inside the app. `GetAccountDeletionPreview` states what is erased and what is retained,
  server-assembled so both clients say the same thing.
- **Admin-provisioned** (`true`) — refused, because the account and its content are the
  employer's record. That person uses `ComplianceService.RequestAccountRemoval` instead.

Deletion is **anonymisation at the tenant layer and destruction at the global layer**: the
`organization.employee` row survives as a de-identified tombstone so the organization keeps
its business records, while `iam.user` and everything cascading from it is destroyed once
the last membership goes. Sessions are invalidated synchronously; the erase itself runs as
a resumable background job. The sole owner of a workspace that still has members is refused
with a structured `SoleOwnerBlocksDeletion` detail naming each blocking workspace.

The mechanism, the state machine and the cross-shard membership query are documented in
[compliance-safety.md](compliance-safety.md).

## Authorization: permissions, not roles

Feature 020 replaced role checks with permission checks. Roles are just named bundles.

- `public.permission` — the canonical catalogue, a global table with no `organization_id`.
  IDs are `<domain>.<action>`, e.g. `chat.sendMessage`. Rows are immutable at
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
- Mobile `app/(auth)/`:
  - `index` — **the sign-in screen, PIN first.** There is no method picker; the screen
    reads the device's remembered state and renders one of two shapes. Known device: the
    remembered display name and workspace as text, six PIN boxes, keypad focused on mount,
    auto-submit on the sixth digit, and "Not you?" to forget. Fresh device: workspace →
    identifier → PIN revealed one step at a time, each validated at its own step, with
    answered steps collapsed to a checked line. `canonical-signin.tsx` and
    `link-handoff.tsx` re-export it for the deep-link entry paths.
  - `signup` — owner workspace creation: company name, owner name, email, password. The
    workspace address is derived from the company name and shown as "Your team will sign in
    at …" with a Change affordance; availability is checked on blur and a taken address is
    offered an alternative inline. Registration returns no token, so the screen chains
    `registerOrganization` → `login` behind one spinner and reports a failed second half as
    "workspace is ready, but we couldn't sign you in".
  - `set-pin` — a worker choosing their own PIN after signing in with a one-time code,
    authorised by `pin_change_token`.
  - `signin` (email + password + SSO), `forgot-password`, `reset-password`,
    `accept-invitation`, `sso-callback`.
- Mobile `app/(onboarding)/` — the owner's first-run sequence, entered from `signup`:
  - `set-pin` — mandatory, non-dismissible, with a confirmation entry and a card stating
    that email and password remain the recovery path.
  - `add-teammate` — creates one org-managed account and hands the one-time code to the OS
    share sheet as the primary action, with clipboard copy as a quieter secondary.
    Skippable.
  - `_layout` redirects into the first incomplete step, so an owner interrupted after their
    workspace was created resumes there instead of at signup, where a retry would collide
    on the address they just claimed.
- Mobile device state (MMKV, id `tech-office`): `auth.last_subdomain`,
  `auth.last_login_identifier`, `auth.last_email`, `auth.last_display_name` (all cleared
  together by "Not you?" and sign-out; partial state is treated as absent), and
  `onboarding.step` / `onboarding.subdomain`.
- Shared clients: `packages/apis/src/iam.ts`, `iam-org-accounts.ts`, `token.ts`,
  `auth-events.ts`, `errorDetails.ts` (`lockoutRetrySeconds`, `fieldViolation`),
  `organization.ts` (`registerOrganization`, `checkSubdomainAvailable`, `deriveSubdomain`).
  `PIN_LENGTH` and `TEMPORARY_PIN_EXPIRY_DAYS` live in `iam-org-accounts.ts` and are the
  synced counterparts of `iam.PINLength` and `iam.TemporaryPINExpiry`.

## Tests

`integration/iam_auth_methods_test.go` (incl. `TestIAMPINIdentifierResolution` and
`TestIAMPINLockoutRetryInfo`), `iam_permission_test.go`, `iam_role_lifecycle_test.go`,
`iam_employee_cards_test.go`, `org_managed_accounts_test.go` (incl.
`TestOrgManagedAccountPINChange`), `mobile_owner_onboarding_test.go`,
`organization_onboarding_test.go`, `multi_tenancy_test.go`.

Mobile: `.maestro/auth/signin.yaml` (email path), `.maestro/auth/signin-known-device.yaml`
(six-tap returning sign-in), `.maestro/onboarding/owner-signup.yaml` (create workspace →
PIN → teammate). All three run under `make test-mobile`.

## Known drift

**Spec 024 says passkey; the code says PIN.** There is no WebAuthn, no passkey, and no
`navigator.credentials` anywhere in the repo. Feature 024 shipped as PIN authentication
with escalating lockout. One artefact of the abandoned half remains:
`iam.credential.credential_type` allows `'biometric'` and `iam.CredentialTypeBiometric` is
declared, but nothing ever writes or reads it. (`expo-local-authentication` and the Face ID
/ fingerprint permissions it needed are gone from the mobile app; the hook that used it was
deleted in 035.) Read spec 024 for intent only; the file name and title are misleading.

**Spec 002 describes Zitadel, which feature 018 removed.** The removal is now complete:
`LoginForm.tsx` (the last file that still named Zitadel, and which nothing rendered) is
deleted, and `public.organization.project_id` / `app_id` were dropped by
`20260830000001_drift_register_fixes.up.sql`. `frontend/packages/apis/dst/` may still hold
compiled `ZitadelAuthService` output on a machine that built before 018 — it is gitignored
build output, cleared by a rebuild, not source.

**SSO audience validation is opt-in.** With `GOOGLE_CLIENT_IDS`/`APPLE_CLIENT_IDS` unset
the server accepts any Google- or Apple-signed ID token regardless of which application it
was issued for. This is logged at startup but not enforced. Treat these as required in any
non-development deployment.
