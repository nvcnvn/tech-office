# Phase 0 Research: Mobile owner onboarding & PIN-first login

**Date**: 2026-08-23. All Technical Context unknowns resolved; no NEEDS CLARIFICATION remain.

## D1 — How can an email-registered owner hold a PIN?

**Decision**: Widen `GetIdentityByOrgAndLoginIdentifier` to match `login_identifier` **or**
case-insensitive `email`, with login identifier taking precedence. No schema change.

**Rationale**: `iam.user.id == iam.identity.id == organization.employee.id` is a deliberate
invariant on both creation paths — `CreateOrgAccount` allocates one `sharedID` for all three
rows, and `RegisterOrganizationWithAdmin` step 4 passes `identityRecord.ID` to
`CreateIAMUser` with an explicit comment that the JWT `sub` claim is treated as
`employee_id` downstream. `SetPIN` therefore writes `iam.credential` keyed on a value that
`LoginWithPIN` can find. The *only* break is the lookup: registration leaves the owner's
`login_identifier` NULL, and the query matches that column alone.

**Alternatives considered**:
- *Assign a derived `login_identifier` at registration* (e.g. the email local part). Rejected:
  needs a collision strategy, and gives the owner a second name to remember on a screen whose
  entire purpose is asking for fewer things.
- *A separate owner-PIN table.* Rejected: duplicates a working credential model to avoid a
  one-line predicate.

**Risk**: `login_identifier` and `email` are each unique per organization, but their union is
not — a worker whose badge number is literally another person's email address would match two
rows. Mitigated by explicit precedence and by rejecting `@` in `login_identifier` at creation.

## D2 — Where does the workspace address come from?

**Decision**: Derive it from the company name (lowercase, non-alphanumerics → hyphen, collapse
repeats, trim, truncate), display it as an explanation of where the team signs in, allow edit,
check availability on blur, and disambiguate collisions with a numeric suffix.

**Rationale**: "Subdomain" is the clearest example in this feature of a field that exists for
the system's benefit. The target user does not know the word. Deriving it removes a question
without removing the capability.

**Alternatives considered**:
- *Keep asking for it.* Rejected: it is the field most likely to strand a low-tech owner.
- *Hide it entirely and generate an opaque address.* Rejected: the owner must be able to tell
  their staff where to sign in, so the value has to be visible and memorable.

**Finding**: registration performs **no** subdomain validation today — not format, not
availability. `GetOrganizationBySubdomain` checks only non-emptiness. Duplicates reach the
UNIQUE index and surface as a raw database error. Derivation makes this worse (two cafés named
"Anna's Café" collide silently), so validation is a prerequisite, not a nicety.

## D3 — What does the returning user see?

**Decision**: Remembered display name, workspace name, and six PIN boxes with the keypad
focused on mount. Auto-submit on the sixth digit. No editable field.

**Rationale**: `auth-subdomain-storage.ts` already persists the subdomain and login identifier
after every successful PIN login, and `pin.tsx` already reads them — but only to prefill, so
the user still faces three labelled fields. The data needed to remove the form is on the
device and unused. Showing the name turns recall into recognition and makes "Not you?"
self-explanatory.

**Cost**: one additional MMKV key for the display name, alongside the two that exist.

**Alternatives considered**:
- *Prefill and disable the fields.* Rejected: disabled fields still read as a form and still
  occupy the screen.
- *Biometric unlock.* Rejected: `use-biometrics.ts` exists and is imported by nothing, and the
  `biometric` credential type is written by nothing. Adopting it is a separate feature.

## D4 — Is the owner's PIN mandatory?

**Decision**: Yes, non-skippable, with a confirmation entry. Email and password stay mandatory
at signup as the recovery anchor.

**Rationale**: `checkLockout` is called from `LoginWithPIN` and nowhere else, so email sign-in
is not gated by PIN lockout. That makes email the owner's escape hatch from a full lock — the
tier that otherwise requires an admin, which a sole owner does not have. A skippable PIN step
also leaves the owner on a login path their staff do not share, which is precisely the
situation that makes an owner unable to help a stuck employee.

**Owner recovery, decided by the product owner 2026-08-23**: PIN lost → email sign-in;
password lost → email reset; both lost → contact support, which is the product owner
personally at current scale. No in-product mechanism is built for the both-lost case.

**Alternatives considered**:
- *Optional PIN.* Rejected for the reasons above.
- *An owner-specific recovery code.* Rejected as unnecessary at current scale per the decision
  above.

## D5 — How does the one-time worker PIN leave the phone?

**Decision**: The OS share sheet is the primary action, pre-filled with workspace, identifier,
PIN and expiry in a plain-language message.

**Rationale**: `CreateOrgAccount` returns `temporary_pin` exactly once and it is never
retrievable; recovery is `ResetOrgAccountCredential`. A screen that displays an unrecoverable
secret and labels it "shown once" without offering a way to send it is a design that loses
credentials. This is the step that converts a one-person workspace into a two-person one.

**Alternatives considered**:
- *Copy to clipboard.* Kept as a secondary affordance; rejected as primary because it leaves
  the user to find a messaging app and reconstruct the context.
- *Email the worker.* Rejected: org-managed workers have no email by definition — that is why
  they use a PIN.

**Deferred**: embedding a deep link in the share message would drop the recipient into the
fresh-device flow with workspace and identifier prefilled, cutting worker onboarding to "tap
link, type PIN". `auth-redirect-handoff.ts` already parses these links. Out of scope here;
worth its own slice.

## D6 — What happens after registration returns?

**Decision**: The client calls `Login` immediately and treats the pair as one operation behind
one spinner, with a distinct message if only the second half fails.

**Rationale**: `RegisterOrganizationWithAdminPasswordResponse` carries only `organization` —
there is no token. Onboarding cannot continue into `SetPIN` without a session. If the login
half fails and the UI says "Sign up failed", the owner retries and now collides on their own
subdomain, which is a worse state than where they started.

**Alternatives considered**:
- *Return a token from registration.* Cleaner, and worth doing eventually, but it widens a
  proto surface for a case the client can already handle in one extra call.

## D7 — Why fix `SetPIN` here?

**Decision**: Enforce `current_pin` for voluntary changes in this change set. First-time set —
no existing credential, a `temporary` credential, or a `pin_change_token` — stays exempt.

**Rationale**: `SetPINRequest` declares `optional string current_pin` and documents it as
required for a voluntary change; `connect_org_accounts.go` never reads it and
`iamLogicImpl.SetPIN` has no parameter for it. Anyone holding a session can silently rotate a
PIN. This feature routes the owner's first PIN through that same path and makes it more
heavily used, so fixing it elsewhere later means shipping the flow over a known hole.

**Breaking**: yes, for any caller omitting the field on a voluntary change. Acceptable — all
clients in this repository release together.

## D8 — Error presentation

**Decision**: Inline banners and field-level text. No `Alert.alert`. Lockout carries
`RetryInfo`; subdomain conflict carries `BadRequest`.

**Rationale**: `pin.tsx` currently raises a modal alert on every failure, which dismisses the
keyboard, drops the keypad, and costs an extra tap to return to the state the user was already
in. For the highest-frequency screen in the product, that is the wrong cost. Structured details
are required by Principle X wherever a code alone cannot guide behaviour — a lockout countdown
is the canonical case, and today it is a static string.

**Constraint**: lockout tiers, PIN length and temporary-PIN expiry are already synchronised
constants under Principle VIII. The countdown copy reads them; it does not restate them.
