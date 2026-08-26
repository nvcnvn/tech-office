---

description: "Task list for feature 035 — Mobile SMB owner onboarding & PIN-first login"
---

# Tasks: Mobile SMB owner onboarding & PIN-first login

**Input**: Design documents from `/specs/035-mobile-owner-onboarding/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED, not optional. Constitution Principle II (Scenario-First Integration &
E2E Testing) and Principle XIII (Maestro blackbox coverage) are both marked NON-NEGOTIABLE,
so every user story carries backend scenario tests and at least one Maestro flow.

**Organization**: Grouped by user story so each is independently implementable and testable.

## ⚠️ Blocking governance gate

**No task in Phase 3–6 may merge until the Principle XIII conflict is resolved.** The
constitution restricts organization creation and member management to web. This feature puts
both on mobile. See plan.md → Complexity Tracking. Resolution is the product owner's decision
(amend XIII to carve out first-run onboarding, or cancel the feature).

- [ ] T000 Resolve Principle XIII gate: amend `.specify/memory/constitution.md` to permit first-run onboarding on mobile (MINOR version bump, update Version History), or record the decision to stop

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3 — maps to spec.md user stories

## Path Conventions

Mobile + API per plan.md. Backend at `backend/`, mobile at `frontend/apps/mobile/`, shared
API wrappers at `frontend/packages/apis/`.

---

## Phase 1: Setup

**Purpose**: Directory and codegen scaffolding the later phases write into

- [ ] T001 [P] Create the onboarding route group `frontend/apps/mobile/src/app/(onboarding)/_layout.tsx` exporting a `Stack` with `headerBackVisible: false`
- [ ] T002 [P] Create the Maestro onboarding directory `frontend/apps/mobile/.maestro/onboarding/` with a `.gitkeep`
- [ ] T003 Verify `make sqlc` and `make proto` run clean on the current tree before any contract edits

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The identity-lookup change everything rests on, plus shared error infrastructure

**⚠️ CRITICAL**: T004–T006 prove research decision D1. If the email lookup does not work, the
design changes and Phases 3–6 are invalid. Do these first and stop if they fail.

- [ ] T004 Widen `GetIdentityByOrgAndLoginIdentifier` in `backend/database/scripts/iam.query.sql` to match `login_identifier` OR `lower(email)`, with `ORDER BY (login_identifier = @identifier) DESC LIMIT 1` for deterministic precedence, then run `make sqlc`
- [ ] T005 Update `LoginWithPIN` in `backend/internal/iam/logic_org_accounts.go` to pass the single identifier through to the widened query and rename the local parameter from `loginIdentifier` to `identifier`
- [ ] T006 Add integration test in `backend/integration/iam_auth_methods_test.go` proving an email-registered owner can `SetPIN` then `LoginWithPIN` using their email, and that a worker's `login_identifier` still resolves and takes precedence over a colliding email
- [ ] T007 [P] Reject `login_identifier` values containing `@` in `CreateOrgAccount` in `backend/internal/iam/logic_org_accounts.go`, with a new `ErrLoginIdentifierInvalid` in `backend/internal/iam/errors.go`
- [ ] T008 [P] Attach `google.rpc.RetryInfo` to lockout errors in `backend/internal/iam/connect_org_accounts.go` per `contracts/error-details.md`, omitting the detail for tier 4 (full lock)
- [ ] T009 [P] Add `RetryInfo` and `BadRequest` extraction helpers to `frontend/packages/apis/src/errors.ts`, returning undefined rather than throwing when the detail is absent or malformed
- [ ] T010 Add integration test in `backend/integration/iam_auth_methods_test.go` verifying the lockout `RetryInfo` round-trip: tiers 1–3 carry a delay within one second of the remaining lockout, tier 4 carries none
- [ ] T011 [P] Add `auth.last_display_name` read/write/clear to `frontend/apps/mobile/src/lib/auth-subdomain-storage.ts`, and a `clearRememberedAuth()` that clears subdomain, identifier and display name together
- [ ] T012 [P] Create `frontend/apps/mobile/src/lib/onboarding-progress.ts` with MMKV-backed `onboarding.step` (`pin` | `teammate` | `done`) and `onboarding.subdomain`, per data-model.md

**Checkpoint**: An owner can hold a usable PIN, lockouts carry timing, and the device can
remember a name. User stories can begin.

---

## Phase 3: User Story 1 — Returning worker signs in (Priority: P1) 🎯 MVP

**Goal**: A returning user signs in with six taps and no text entry. The method picker is gone.

**Independent Test**: Sign in once on a fresh simulator, kill the app, reopen. The screen shows
the name and workspace with the keypad up; six digits authenticate. Ships without any
onboarding work existing.

### Tests for User Story 1

- [ ] T013 [P] [US1] Write Maestro flow `frontend/apps/mobile/.maestro/auth/signin-known-device.yaml` — sign in, relaunch with `clearState: false` and `clearKeychain: false`, assert the display name is visible and no workspace field is present, enter the PIN, assert the app lands in chat
- [ ] T014 [P] [US1] Update `frontend/apps/mobile/.maestro/auth/signin.yaml` to follow the fresh-device sequence, applying the `eraseText: 20` workaround before each secure field

### Implementation for User Story 1

- [ ] T015 [US1] Delete the method picker `frontend/apps/mobile/src/app/(auth)/index.tsx`
- [ ] T016 [US1] Repoint `frontend/apps/mobile/src/app/canonical-signin.tsx` and the `(auth)` index route to the PIN screen, preserving the `Linking` deep-link handler and `setPendingPostSignInRedirect` behaviour deleted with T015
- [ ] T017 [US1] Rewrite `frontend/apps/mobile/src/app/(auth)/pin.tsx` known-device state: avatar, display name, workspace name, six PIN boxes, keypad focused on mount, auto-submit on the sixth digit, no editable field
- [ ] T018 [US1] Implement the fresh-device state in `frontend/apps/mobile/src/app/(auth)/pin.tsx` as a revealed sequence — workspace, then identifier, then PIN — with answered steps collapsing to a checked line with an Edit affordance
- [ ] T019 [US1] Validate the workspace at its own step in `pin.tsx` via `getOrganizationBySubdomain`, failing there with "We couldn't find that workspace. Check the spelling with your manager."
- [ ] T020 [US1] Persist display name alongside subdomain and identifier on successful PIN login in `pin.tsx`, and wire "Not you?" to `clearRememberedAuth()` from T011
- [ ] T021 [US1] Replace every `Alert.alert` in `pin.tsx` with inline banner or field-level text; on failure clear the boxes in place, keep the keypad up, and fire `Haptics.notificationAsync(Error)` on iOS via `process.env.EXPO_OS`
- [ ] T022 [US1] Render the lockout countdown in `pin.tsx` from the `RetryInfo` helper (T009), reading tier thresholds from the synced constants rather than restating them, per Constitution VIII
- [ ] T023 [US1] Rewrite all user-facing copy in `pin.tsx` per the spec: "Where do you work?", "Who are you?" / "Your ID or work email", "Enter your PIN", "Sign in with email" — and add `testID` to every interactive element per Constitution XIII

**Checkpoint**: US1 is fully functional and shippable on its own.

---

## Phase 4: User Story 2 — Owner creates a workspace (Priority: P1)

**Goal**: An SMB owner creates a working workspace from a phone without meeting the word
"subdomain".

**Independent Test**: Fresh install → "Create a workspace" → four fields → an authenticated
session in a new organization. Testable without the PIN or teammate steps existing.

### Tests for User Story 2

- [ ] T024 [P] [US2] Add integration test in `backend/integration/mobile_owner_onboarding_test.go` for subdomain derivation and collision: two organizations with the same company name produce `annas-cafe` and `annas-cafe-2`
- [ ] T025 [P] [US2] Add integration test in `backend/integration/mobile_owner_onboarding_test.go` asserting a taken subdomain returns `AlreadyExists` with a `google.rpc.BadRequest` naming the `subdomain` field, and a malformed one returns `InvalidArgument`

### Implementation for User Story 2

- [ ] T026 [P] [US2] Create `backend/internal/organization/subdomain.go` with `Derive(companyName)`, `Normalize`, and `Validate` implementing the format rules and reserved-word list in data-model.md
- [ ] T027 [US2] Add `CheckSubdomainAvailable` to `backend/rpc/v1/organization.proto` per `contracts/organization.proto`, marked unauthenticated in its `access_control` option, then run `make proto`
- [ ] T028 [US2] Implement `CheckSubdomainAvailable` in `backend/internal/organization/connect.go`, returning `available=false` with a `suggested` variant rather than an error for a taken-but-valid address
- [ ] T029 [US2] Validate the subdomain in `RegisterOrganizationWithAdmin` in `backend/internal/organization/logic.go` before insert, and return a typed conflict carrying `BadRequest` instead of the raw unique-violation surfaced today
- [ ] T030 [P] [US2] Add `registerOrganization` and `checkSubdomainAvailable` wrappers with hand-written input/output types to `frontend/packages/apis/src/organization.ts`, per Constitution VII
- [ ] T031 [US2] Rewrite `frontend/apps/mobile/src/app/(auth)/signup.tsx` with four fields — company name, owner name, email, password — deleting the stubbed success `Alert` that currently reports success without creating anything
- [ ] T032 [US2] Display the derived workspace address live under the company-name field in `signup.tsx` as "Your team will sign in at …" with a Change affordance, never as an empty required field
- [ ] T033 [US2] Check availability on blur in `signup.tsx` and offer the suggested alternative inline without blocking the form
- [ ] T034 [US2] Chain register → `login` behind a single spinner in `signup.tsx`, and on partial failure show "Your workspace is ready, but we couldn't sign you in. Try signing in with your email." rather than a signup failure
- [ ] T035 [US2] State the 8-character password rule before submit in `signup.tsx`, add `testID` to every interactive element, and link "Create a workspace" from the sign-in screen built in T018

**Checkpoint**: US1 and US2 both work independently.

---

## Phase 5: User Story 3 — Owner sets a PIN and onboards a teammate (Priority: P2)

**Goal**: The owner ends onboarding holding a PIN, and their first teammate holds a shareable
code.

**Independent Test**: Complete US2, then set a PIN and add a teammate. Sign out, sign back in
with the owner's email and new PIN. Create the teammate and confirm the share sheet opens
pre-filled.

### Tests for User Story 3

- [ ] T036 [P] [US3] Add integration test in `backend/integration/org_managed_accounts_test.go` asserting a voluntary `SetPIN` without `current_pin` is rejected, a wrong `current_pin` is rejected, and first-time set — no credential, `temporary` credential, or `pin_change_token` — remains exempt
- [ ] T037 [P] [US3] Write Maestro flow `frontend/apps/mobile/.maestro/onboarding/owner-signup.yaml` covering signup → PIN with confirmation → add teammate → assert the one-time code is visible, using a run-unique company name so repeated local runs do not collide

### Implementation for User Story 3

- [ ] T038 [US3] Add a `currentPIN` parameter to `iamLogicImpl.SetPIN` in `backend/internal/iam/logic_org_accounts.go` and verify it with `ComparePINHash` when an `active` credential exists and no `pin_change_token` was supplied
- [ ] T039 [US3] Pass `req.Msg.CurrentPin` through in `backend/internal/iam/connect_org_accounts.go` — the handler currently ignores the field entirely — and add `ErrCurrentPINRequired` and `ErrCurrentPINIncorrect` to `backend/internal/iam/errors.go`
- [ ] T040 [US3] Update the `SetPIN` proto comment in `backend/rpc/v1/iam.proto` per `contracts/iam.proto` to document the now-enforced field and its exemptions
- [ ] T041 [P] [US3] Update the `setPIN` wrapper in `frontend/packages/apis/src/iam-org-accounts.ts` to accept an optional `currentPin`, and update the web caller at `frontend/apps/web/src/app/login/pin/set-pin/` in the same change set — this is a breaking change and all clients ship together
- [ ] T042 [US3] Create `frontend/apps/mobile/src/app/(onboarding)/set-pin.tsx` — six boxes, confirmation entry revealed after the first completes, no skip and no back
- [ ] T043 [US3] Add the recovery info card to `(onboarding)/set-pin.tsx` stating that email and password remain the way back in, per spec FR-010
- [ ] T044 [US3] Handle `ComparePINWithPersonalData` rejection in `(onboarding)/set-pin.tsx` as "Pick something that isn't your birthday or phone number — those are easy to guess."
- [ ] T045 [US3] Create `frontend/apps/mobile/src/app/(onboarding)/add-teammate.tsx` with name and identifier fields calling `createOrgAccount`, plus a "Skip for now" secondary action
- [ ] T046 [US3] Display the returned one-time PIN in `(onboarding)/add-teammate.tsx` with a warning-weight banner, `fontVariant: 'tabular-nums'`, and `selectable`, stating it is shown once and expires in 3 days
- [ ] T047 [US3] Make the OS share sheet the primary action in `(onboarding)/add-teammate.tsx`, pre-filled with workspace, identifier, PIN and expiry in plain language per research D5, with clipboard copy as a quieter secondary
- [ ] T048 [US3] Write and advance `onboarding-progress` (T012) after registration and after each step, and route into the first incomplete step from `frontend/apps/mobile/src/app/(onboarding)/_layout.tsx` so an interrupted owner resumes at the PIN step rather than at signup

**Checkpoint**: All three user stories work independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T049 Update `docs/domain/auth-identity.md` — the PIN section to record email-or-identifier resolution, the client-surfaces list for the deleted picker and the new `(onboarding)` group, and drift entry D4, per Constitution XII
- [ ] T050 [P] Audit all five screens for internal vocabulary and confirm no string contains "subdomain", "organization context", "SSO", "account ID" or "identifier" (spec SC-004)
- [ ] T051 [P] Audit the five screens for hardcoded colours and replace with `@tech-office/theme-tokens`, per Constitution VII
- [ ] T052 [P] Confirm every interactive element across `(auth)` and `(onboarding)` carries a `testID`, per Constitution XIII
- [ ] T053 Run `make test-mobile` and confirm the full suite is green with zero failures
- [ ] T054 Run `go test ./integration/...` and confirm no regression in `iam_permission_test.go`, `organization_onboarding_test.go` or `multi_tenancy_test.go`
- [ ] T055 Walk the six manual checks in quickstart.md on a mid-range device in portrait, timing the fresh-install-to-workspace path against SC-002 (under three minutes)
- [ ] T056 Delete `frontend/apps/mobile/src/hooks/use-biometrics.ts` if still imported by nothing, or record it in the drift register — do not leave it ambiguous while touching this domain

---

## Dependencies & Execution Order

### Phase Dependencies

- **T000 (governance gate)**: blocks merge of everything, not the writing of it
- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: T004→T005→T006 are strictly sequential and prove D1. T007–T012 are independent of that chain and of each other
- **US1 (Phase 3)**: needs T011 and T009 only. Does NOT need T004–T006 for the worker case — but FR-004's email-in-identifier behaviour does
- **US2 (Phase 4)**: needs Phase 1 only. Fully independent of US1 and US3
- **US3 (Phase 5)**: needs US2 (there is no workspace to set a PIN in otherwise) and T012
- **Polish (Phase 6)**: after the stories being shipped are complete

### User Story Dependencies

- **US1 (P1)**: independent. Ships alone as the MVP
- **US2 (P1)**: independent of US1
- **US3 (P2)**: depends on US2

### Parallel Opportunities

- T007, T008, T009, T011, T012 run in parallel once T003 passes
- T004–T006 run as a sequential chain alongside them
- Once Phase 2 lands, US1 and US2 proceed in parallel on different files — US1 is entirely mobile, US2 is mostly backend
- Within US2, T026 and T030 are parallel; T027→T028→T029 are sequential
- Within US3, T036 and T037 are parallel; T038→T039→T040→T041 are sequential
- T050, T051, T052 are parallel audits

---

## Parallel Example: Phase 2

```bash
# The D1 proof chain, sequential:
Task: "T004 widen GetIdentityByOrgAndLoginIdentifier in backend/database/scripts/iam.query.sql"
Task: "T005 update LoginWithPIN in backend/internal/iam/logic_org_accounts.go"
Task: "T006 integration test for owner PIN login by email"

# Independent, all at once:
Task: "T007 reject '@' in login_identifier in backend/internal/iam/logic_org_accounts.go"
Task: "T008 attach RetryInfo to lockout in backend/internal/iam/connect_org_accounts.go"
Task: "T009 add error-detail extraction to frontend/packages/apis/src/errors.ts"
Task: "T011 add display-name storage to frontend/apps/mobile/src/lib/auth-subdomain-storage.ts"
Task: "T012 create frontend/apps/mobile/src/lib/onboarding-progress.ts"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Resolve T000 — without it nothing merges
2. Phase 1 Setup
3. Phase 2 Foundational, starting with T004–T006
4. Phase 3 User Story 1
5. **STOP and VALIDATE**: `make test-mobile-one F=auth/signin-known-device`, then sign in by hand
6. Ship. Every employee gets six-tap sign-in before any onboarding work exists

US1 is the right MVP because it is the highest-frequency interaction in the product and the
only one that improves life for users who already exist.

### Incremental delivery

1. Setup + Foundational → foundation ready
2. US1 → six-tap sign-in for everyone → ship
3. US2 → owners can create a workspace on a phone → ship
4. US3 → owners hold a PIN and can onboard staff → ship

### Notes

- T041 is a breaking change to `SetPIN`. Backend, web and mobile land in one change set — no
  compatibility window, per the project's stated stance
- T006 is a stop-the-line test. If it fails, research D1 is wrong and Phases 3–6 need rework
  before any more of them is written
- Commit after each task or logical group
