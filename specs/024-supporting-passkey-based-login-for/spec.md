# Feature Specification: Org-Managed User Accounts with Passkey-Based Login

**Feature Branch**: `024-supporting-passkey-based-login-for`  
**Created**: 2026-03-18  
**Status**: Ready  
**Input**: User description: "Supporting passkey-based login for workers without email — unified org-scoped model using iam.identity as single auth anchor, iam.identity extended to support email OR login_identifier (nullable email), single credential table supporting sso/password/PIN/biometric, workers without email get a login_identifier instead, single session model with one JWT format, passkey-based onboarding where admins generate temporary codes that employees must reset on first login with escalating lockouts after failed attempts, batch import capability with one-time PIN reveal, admin-created accounts without email requirements, complexity rules for employee-set PIN, and a new iam.manageOrgAccounts permission"

---

## User Scenarios & Testing

### Primary User Story

A **factory-floor supervisor** (worker without a corporate email address) needs to access the organization's platform to log daily reports, join task discussions, and receive notifications. The organization's **HR admin** creates an account for this worker by assigning a unique login handle (e.g., an employee badge number or username) and generating a one-time PIN. The worker uses that PIN to log in for the first time, is immediately forced to set a new personal PIN that meets complexity rules, and from that point on authenticates using their PIN. All sessions use the same token format as email-based users — the worker has full platform access with no email address ever required.

### Secondary User Stories

1. An **HR admin** imports 200 factory workers from a spreadsheet. None have email addresses. The import generates accounts with login identifiers and temporary one-time PINs. The admin can reveal (or download) the full one-time PIN list once; after that, individual PINs are no longer retrievable. Workers log in with their PIN and are forced to set a new one on first use.
2. An **HR admin** creates a single worker account manually, assigns a login handle, and generates a temporary PIN. The admin shares the PIN with the worker verbally or on a slip of paper. The worker logs in, resets the PIN, and is active.
3. A **worker** enters their PIN incorrectly multiple times. The system escalates lockout durations progressively (e.g., 1 min → 5 min → 15 min → account lock). After final lockout the admin must reset the account to unblock the worker.
4. An **owner or operator** (with `iam.manageOrgAccounts` permission) manages all org-created worker accounts: creates, deactivates, unlocks, and resets credentials — without requiring a system super-admin.
5. An **email-based employee** already on the platform logs in as before (email + password or SSO). No behavior changes for email users. All existing sessions and tokens remain valid.

### Acceptance Scenarios

1. **Given** an admin creates a worker account with only a login identifier (no email), **When** the worker enters their one-time PIN, **Then** the system authenticates them and immediately requires a PIN change before granting full access.
2. **Given** a worker has set a new personal PIN, **When** they log in with that PIN on a subsequent session, **Then** a valid session token is issued that is structurally identical to tokens issued to email-based users.
3. **Given** a batch import file containing 50 workers without emails, **When** the admin confirms the import, **Then** 50 accounts are created, one-time PINs are generated, and the admin can download or view the full PIN list exactly once.
4. **Given** a worker enters an incorrect PIN 3 consecutive times, **When** attempting again within the lockout window, **Then** the system rejects the attempt and communicates the remaining lockout duration.
5. **Given** a worker is locked out after exceeding max failed attempts, **When** an admin with `iam.manageOrgAccounts` unlocks the account, **Then** the worker can attempt login again with their current PIN or a new admin-issued temporary PIN.
6. **Given** an email-based employee logs in, **When** the system issues a session token, **Then** the token format is identical to one issued to a PIN-based worker — there is only one token schema.
7. **Given** a worker sets a new PIN, **When** the PIN does not meet complexity rules (minimum length, character types), **Then** the system rejects it with a descriptive error and prompts for a compliant PIN.
8. **Given** an operator without `iam.manageOrgAccounts` permission attempts to create or manage worker accounts, **When** the request is made, **Then** the system denies the request with a permission error.
9. **Given** an SSO-linked employee and a PIN-based worker both have active sessions, **When** both call the same API endpoint, **Then** both are authorized using the same session validation path — credential type is opaque to downstream services.

### Edge Cases

- What happens when a worker account import file contains duplicate login identifiers? The system rejects the entire import with a list of conflicting identifiers before creating any accounts.
- What happens if the one-time PIN list is not downloaded immediately after batch import? The PINs are no longer retrievable in plaintext; the admin must reset individual PINs for workers who haven't logged in yet.
- What happens when a worker's personal PIN is in use indefinitely? Personal PINs do not expire — only temporary (admin-generated) PINs have an expiry window.
- What happens when a login identifier conflicts with another worker's identifier in the same organization? The system rejects the creation and prompts the admin to choose a unique identifier.
- What happens if a worker who has a login identifier is later given an email address? The system MUST allow associating an email with an existing identity without disrupting the active session or credential.

---

## Requirements

### Functional Requirements

#### Unified Identity Model

- **FR-001**: Every authenticated user (whether email-based or email-free) MUST be represented by a single identity record that serves as the authentication anchor for the entire organization.
- **FR-002**: An identity MUST support one of two identification modes: (a) an email address, or (b) an organization-scoped login identifier (e.g., badge number, username). Both modes are mutually exclusive at creation but the system MUST allow adding an email to an identifier-only identity later.
- **FR-003**: Login identifiers MUST be unique within an organization but do NOT need to be globally unique across organizations.
- **FR-004**: The system MUST issue exactly one session token format regardless of credential type used to authenticate (SSO, password, PIN). Downstream services MUST NOT need to know which credential type was used.

#### Credential Management

- **FR-005**: The system MUST maintain a single credential store per identity supporting the following credential types: SSO, password, PIN, and biometric. An identity MAY have multiple credential types simultaneously.
- **FR-006**: Admins MUST be able to generate a one-time temporary PIN for any org-managed identity. The temporary PIN MUST be invalidated after first use or after a configurable expiry window (whichever comes first).
- **FR-007**: On first login using a temporary PIN, the system MUST force the user to set a new personal PIN before any other action is allowed.
- **FR-008**: Employee-set PINs MUST be exactly 6 numeric digits. The system MUST reject PINs that match the worker's known date of birth or phone number (where those are on record). No alphanumeric or special characters are required or accepted.
- **FR-009**: The system MUST enforce escalating lockouts on consecutive failed PIN authentication attempts. The lockout schedule MUST be: 1 minute after 3 failed attempts, 5 minutes after the 4th failure, 15 minutes after the 5th failure, and full account lock after the 6th consecutive failure.
- **FR-010**: A fully locked account MUST require admin intervention (an admin with `iam.manageOrgAccounts`) to unlock. Self-service unlock via email reset is NOT available for email-free accounts.
- **FR-011**: Biometric credential support MUST be defined as a credential type in the data model for future readiness, but active biometric authentication flows are out of scope for this feature.

#### Admin Account Management

- **FR-012**: A new permission `iam.manageOrgAccounts` MUST be introduced. Users with this permission can: create org-managed identities, generate temporary PINs, unlock locked accounts, deactivate accounts, and view the sanitized account list.
- **FR-013**: By default, the organization Owner role MUST have `iam.manageOrgAccounts`. Operators may be granted this permission explicitly.
- **FR-014**: Admins MUST be able to create a single org-managed account by providing: a login identifier, the worker's display name, and optionally department assignment. The system generates a temporary PIN automatically.
- **FR-015**: After creating a single account, the admin MUST be able to view the generated temporary PIN once before it is hidden. Subsequent views MUST show only a masked representation.
- **FR-016**: Admins MUST be able to deactivate an org-managed account, immediately invalidating all active sessions for that identity.
- **FR-017**: Admins MUST be able to reset credentials on a locked or active account, generating a new temporary PIN and invalidating any existing credentials.

#### Batch Import

- **FR-018**: Admins MUST be able to import multiple org-managed worker accounts in a single operation via a structured file (format to be determined in planning: CSV or similar).
- **FR-019**: The batch import MUST support accounts with no email address. Fields required per row: login identifier, display name. Optional fields: department, job title.
- **FR-020**: On batch import confirmation, the system MUST create all accounts atomically. If any row fails validation (duplicate identifier, missing required fields), the entire import MUST be rejected with a per-row error list before any accounts are created.
- **FR-021**: After a successful batch import, the system MUST make the full list of generated one-time PINs (paired with login identifiers) available to the admin for download or inline display exactly once. After the admin closes or dismisses this view, the plaintext PINs MUST NOT be retrievable again.
- **FR-022**: Workers whose one-time PINs were never revealed to them (e.g., admin closed the window early) MUST be resettable individually by the admin using the standard credential reset flow (FR-017).

#### Session & Token Compatibility

- **FR-023**: All existing email-based sessions and tokens MUST remain valid without migration. The new unified identity model MUST be backward-compatible.
- **FR-024**: The session token MUST carry sufficient claims for the system to identify the organization, the identity, and the user's roles — regardless of credential type.

### Key Entities

- **Identity**: Represents a single authenticated user within an organization. Has either an email address or a login identifier (not both at creation, though email can be added later). Carries display name, status (active/deactivated/locked), and a reference to the organization.
- **Credential**: A single credential record attached to an identity. Has a type (sso, password, pin, biometric), a state (active, temporary, expired, revoked), and the credential secret in a safely hashed form. One identity can have multiple credentials of different types.
- **Session**: Represents an authenticated session for an identity. Carries expiry, the credential type used, and maps to a single JWT issued to the client. An identity MAY have multiple concurrent sessions (e.g., multiple devices).
- **One-Time PIN Batch**: A transient record associated with a batch import operation. Contains the generated plaintext PINs available for a single retrieval window, then discarded.
- **Account Lockout Record**: Tracks consecutive failed authentication attempts per identity, current lockout tier, and the lockout expiry timestamp. Reset on successful authentication.

### Scale & Distribution Considerations

- **Expected concurrent users**: PIN-based authentication must perform equivalently to email/password authentication for organizations with up to several thousand workers.
- **State lifecycle**: Lockout state MUST be consistent across all server instances — a worker locked on one server MUST be locked when they retry on another instance.
- **Temporary PIN lifecycle**: Temporary PINs MUST expire after 3 days if never used (configurable at deployment via a database default value). After expiry they MUST be treated as revoked credentials; the worker cannot log in until an admin issues a new temporary PIN.
- **Session invalidation on deactivation**: When an admin deactivates an account, all existing sessions MUST be invalidated within seconds, not eventually.

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous (except where marked)
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---
