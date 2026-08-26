# Feature Specification: Mobile SMB owner onboarding & PIN-first login

**Feature Branch**: `035-mobile-owner-onboarding`
**Created**: 2026-08-23
**Status**: Draft
**Input**: Conversation with the product owner, 2026-08-23. Source of the UX direction,
the PIN-first decision, and the owner-recovery decision recorded in Assumptions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Returning worker signs in (Priority: P1)

Ana opens the app at the start of her shift. She sees her own name and her employer's
name, and six empty boxes with the number pad already up. She types six digits and she is
in. She types nothing else and makes no choices.

**Why P1**: This is the most frequent interaction in the entire product — every employee,
every shift. Today it costs three text fields and a method choice.

**Acceptance**:
1. Given a device with a prior successful sign-in, when the app opens without a session,
   then the sign-in screen shows the remembered display name and workspace and no text
   input, with the numeric keypad focused.
2. Given the PIN screen, when the sixth digit is entered, then sign-in submits without a
   further tap.
3. Given a wrong PIN, when submission fails, then the boxes clear in place, the keypad
   stays up, and the message appears inline — not in a modal alert.
4. Given the remembered person is not the current user, when "Not you?" is tapped, then
   remembered values clear and the fresh-device flow starts.

### User Story 2 — Owner creates a workspace (Priority: P1)

Anna owns a café. She installs the app, taps "Create a workspace", enters her business
name, her name, her email and a password, and lands in a working workspace. She is never
asked what a subdomain is.

**Why P1**: There is no owner signup on mobile at all today; `signup.tsx` reports success
without creating anything. Without this, an SMB owner cannot start on the device they
actually own.

**Acceptance**:
1. Given the signup screen, when a company name is typed, then a workspace address is
   derived and displayed as an explanation of where the team will sign in, with an edit
   affordance — never as an empty required field.
2. Given a derived address already in use, when availability is checked, then an
   alternative is proposed inline without blocking the form.
3. Given valid input, when "Create workspace" is tapped, then the organization is created
   and the owner holds an active session.
4. Given the organization was created but the follow-up sign-in failed, when the error is
   shown, then it states the workspace exists and directs the owner to sign in — it must
   not read as a failed signup.

### User Story 3 — Owner sets a PIN and onboards a teammate (Priority: P2)

Immediately after signup Anna picks a six-digit PIN, twice, and is told her email and
password are how she gets back in if she forgets it. She then adds Ana, and shares the
one-time code by message without copying anything by hand.

**Why P2**: Depends on US2. It is what makes US1 true for the owner as well as staff, and
it is the moment a one-user workspace becomes a two-user one.

**Acceptance**:
1. Given a newly created workspace, when the owner reaches the PIN step, then it cannot be
   skipped or dismissed.
2. Given the PIN step, when the first entry completes, then a confirmation entry is
   required and a mismatch is reported without losing the screen.
3. Given the PIN step, then the screen states plainly that email and password remain the
   recovery path.
4. Given a teammate is created, when the one-time PIN is displayed, then the primary
   action opens the OS share sheet pre-filled with workspace, identifier, PIN and expiry.
5. Given the teammate step, when "Skip for now" is tapped, then onboarding completes.
6. Given onboarding was interrupted after the workspace was created, when the app is
   reopened, then it resumes at the step that was not completed.

### Edge Cases

- Owner's PIN is locked out after 6 failures → they sign in with email and password, which
  is not gated by PIN lockout, and unlock themselves.
- Owner forgets the PIN and the password → password reset by email. Both lost → support
  (see Assumptions).
- A worker's chosen PIN matches their date of birth or phone number → rejected with a
  plain-language reason.
- A temporary PIN older than 3 days → rejected, worker told to ask for a new code.
- Workspace address typed incorrectly on a fresh device → caught at the workspace step,
  not as a generic failure after the PIN is entered.
- An identifier that is already taken in the organization → alternative suggested.
- A person employed by two organizations → out of scope for this feature (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The sign-in method picker MUST be removed. The app MUST determine the
  sign-in path from stored device state, never by asking the user to classify themselves.
- **FR-002**: On a device with remembered credentials, the sign-in screen MUST present the
  remembered person and workspace as text and require only the PIN.
- **FR-003**: On a fresh device, workspace, identifier and PIN MUST be requested as a
  revealed sequence, each validated at its own step.
- **FR-004**: The identifier field MUST accept either an org login identifier or an email
  address, so that owners and workers use one field.
- **FR-005**: Email-and-password sign-in MUST remain reachable as a quiet secondary action
  and MUST retain existing Google and Apple SSO behaviour.
- **FR-006**: Mobile MUST support creating an organization with company name, owner name,
  owner email and password.
- **FR-007**: The workspace address MUST be derived from the company name, displayed for
  confirmation, editable, and checked for availability before submission.
- **FR-008**: After creating an organization the client MUST obtain an active session, and
  MUST distinguish "workspace created but sign-in failed" from "signup failed".
- **FR-009**: Setting an owner PIN MUST be a required, non-skippable step immediately after
  workspace creation, with confirmation entry.
- **FR-010**: The PIN step MUST state that email and password remain the recovery path.
- **FR-011**: Mobile MUST support creating one org-managed account with name and login
  identifier, and this step MUST be skippable.
- **FR-012**: A newly issued one-time PIN MUST be offered to the OS share sheet with
  workspace, identifier, PIN and expiry in plain language, and MUST carry an explicit
  warning that it is shown once.
- **FR-013**: Onboarding progress MUST survive app termination and resume at the first
  incomplete step.
- **FR-014**: PIN authentication MUST resolve an identity by login identifier or by email,
  with login identifier taking precedence, so that an owner registered by email can use a
  PIN.
- **FR-015**: Organization registration MUST validate the workspace address server-side and
  expose an availability check, returning typed errors rather than raw constraint
  violations.
- **FR-016**: A voluntary PIN change MUST verify the current PIN. First-time PIN set — no
  existing credential, a temporary credential, or a PIN change token — remains exempt.
- **FR-017**: All user-facing errors MUST be actionable sentences shown inline, without
  internal vocabulary, and MUST NOT be presented as modal alerts.
- **FR-018**: All interactive elements MUST carry `testID` props, and the flows in User
  Stories 1–3 MUST each be covered by a Maestro flow.

### Key Entities

- **Organization** — the workspace. Identified to users by its address (subdomain).
- **Identity** — a person's membership in one organization; carries an email, a login
  identifier, or both.
- **PIN credential** — org-scoped, six digits, states active / temporary / revoked.
- **Remembered device state** — workspace address, identifier and display name held on the
  device to make the returning-user screen possible.
- **Onboarding progress** — which post-signup step the owner has reached.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A returning user signs in with exactly six taps and no text entry.
- **SC-002**: An SMB owner goes from a fresh install to a working workspace with a PIN in
  under three minutes without assistance.
- **SC-003**: Screens shown before a returning user can enter their PIN drops from two to
  one; fields filled drops from three to zero.
- **SC-004**: No user-facing string contains "subdomain", "organization context", "SSO",
  "account ID" or "identifier".
- **SC-005**: Every failure listed in Edge Cases produces a message naming the next action.
- **SC-006**: A first-time low-tech user completes sign-in without guessing, verified by
  the mobile design checklist in Constitution XIII.

## Assumptions

- **Owner recovery is email plus support.** Decided by the product owner on 2026-08-23: an
  owner who loses their PIN uses email sign-in and password reset; if both are lost they
  contact support, which is the product owner personally at current scale. No in-product
  recovery mechanism is built for this case.
- **Email and password remain mandatory at signup.** They are the only path that is not
  gated by PIN lockout, so they are the owner's escape hatch, not a convenience.
- **PIN is acceptable on an owner account** despite that account holding every permission,
  because lockout escalation caps brute force at six attempts.
- **SSO signup is out of scope.** `ExchangeToken` cannot create an organization, and an
  SSO-only owner would have no password to recover with.
- **Multi-organization sign-in is out of scope.** The sign-in screen assumes one remembered
  workspace per device.
- **Phone/SMS authentication is out of scope.** No backend support exists.
- **Biometric unlock is out of scope.** The existing `biometric` credential type and
  `use-biometrics.ts` remain unused drift.
- **Bulk employee import stays web-only.**
- **Billing, plans and trials are out of scope.**
