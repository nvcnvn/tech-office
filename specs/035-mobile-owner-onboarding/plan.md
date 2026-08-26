# Implementation Plan: Mobile SMB owner onboarding & PIN-first login

**Branch**: `035-mobile-owner-onboarding` | **Date**: 2026-08-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/035-mobile-owner-onboarding/spec.md`

## Summary

Make PIN the default door for everyone on mobile and give an SMB owner a way to create a
workspace from their phone. Two halves that depend on each other: the login surface loses
its method picker and its three-field form, becoming a six-digit screen for anyone the
device already knows; and `signup.tsx` — today a stub that reports success without creating
anything — becomes a real four-screen owner onboarding that ends with the owner holding a
PIN and their first teammate holding a shareable code.

The technical approach rests on one verified fact: `iam.user.id`, `iam.identity.id` and
`organization.employee.id` are the same UUID for a person in an organization, enforced
deliberately on both creation paths. That means an owner registered by email can hold a PIN
credential with **no schema change**. The only thing blocking it is that PIN login resolves
identities by `login_identifier` alone, and registration leaves that column NULL for owners.
Widening that lookup to accept an email is the load-bearing backend change; everything else
is mobile work plus two gaps that must be closed before the signup screen can be honest.

## Technical Context

**Language/Version**: Go 1.25 (backend); TypeScript 5 / React Native 0.83.4 (mobile)

**Primary Dependencies**: Expo ~55.0, expo-router ~55.0, react-native-mmkv ^3.2,
react-native-reanimated ~4.2, react-hook-form ^7.65, Connect-RPC, sqlc, pgx

**Storage**: PostgreSQL with Citus (`iam.identity`, `iam.credential`, `public.organization`);
MMKV on device for remembered sign-in state and onboarding progress

**Testing**: Go integration tests under `backend/integration/`; Maestro blackbox flows under
`frontend/apps/mobile/.maestro/auth/` and `.maestro/onboarding/`

**Target Platform**: iOS 16+ and Android, portrait phone 360–430 dp

**Project Type**: Mobile app + Connect-RPC backend

**Performance Goals**: Returning-user sign-in reaches an authenticated session in ≤2 s on a
mid-range device; the PIN screen is interactive with the keypad up on first frame

**Constraints**: PIN is exactly 6 digits, bcrypt cost 10; temporary PINs expire in 3 days;
lockout escalates 3/4/5/6+ failures to 1/5/15 min/full; sessions last 30 days; no new
runtime dependencies

**Scale/Scope**: 5 mobile screens (2 rewritten, 2 new, 1 deleted), 1 SQL query change,
2 backend validation changes, 1 security fix

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Note |
|---|---|---|
| I. Data Governance & Citus | ✅ Pass | No new tables. `iam.identity` and `iam.credential` stay org-distributed; the widened lookup keeps `organization_id` in the predicate. |
| II. Scenario-First Integration & E2E | ⚠️ Obligation | The three user stories must exist as backend integration scenarios **and** Maestro flows derived from the same stories. Not optional. |
| III. Two-Layer Service & Proto Authorization | ✅ Pass | Changes live in existing `logic` + `connect` layers. `CreateOrgAccount` keeps `iam.manageOrgAccounts`. |
| IV. Cross-Domain Integration | ✅ Pass | Registration already calls collaboration to seed a default project; unchanged. |
| V. Observability, Simplicity & YAGNI | ✅ Pass | Net deletion on mobile: the method picker goes, one screen replaces two. |
| VI. Versioning & Breaking Changes | ⚠️ Breaking, accepted | `SetPIN` gains `current_pin` enforcement — a behaviour break for any client that omits it. Shipped atomically across backend/web/mobile per the project's stated no-compatibility stance. |
| VII. Frontend API Wrapper & Type Safety | ⚠️ Obligation | New calls go through `packages/apis` wrappers with hand-written types; no protobuf types in screens; `testID` on every interactive element; theme tokens only. |
| VIII. Cross-Stack Constant Sync | ⚠️ Obligation | PIN length, temporary-PIN expiry and lockout tiers are already duplicated; the countdown copy must read them from the synced constants, not re-hardcode them. |
| IX. UUID v7 & Nullable Cursor Params | ✅ Pass | No new pagination. |
| X. Structured Error Details | ⚠️ Obligation | Lockout must carry `RetryInfo` so the client can render a live countdown; subdomain conflict must carry `BadRequest`. Both currently return bare messages. |
| XI. Distributed-First | ✅ Pass | No cross-shard queries introduced. |
| XII. Living Documentation | ⚠️ Obligation | `docs/domain/auth-identity.md` must be updated in this change set — the authentication-methods section, the client-surfaces list, and drift entry D4. |
| **XIII. Mobile Design & Testing** | ❌ **VIOLATION** | See below. Requires an amendment or an accepted justification. |

### Principle XIII violation — mobile scope

Principle XIII is marked NON-NEGOTIABLE and states:

> The mobile app targets **employees performing day-to-day tasks**. Owners and operators
> MUST use the web application for full configuration and administrative functions.
> Administrative / configuration features (department management, member import, **IAM
> settings**, billing, etc.) MUST remain web-only.

This feature puts two explicitly web-only capabilities on mobile:

1. **Creating an organization** (`RegisterOrganizationWithAdminPassword`) — administrative
   by any reading.
2. **Creating an org-managed account** (`CreateOrgAccount`) — member management, named in
   the web-only list.

This is not an incidental overlap; it is the feature. It cannot be resolved by scoping and
must be settled before implementation. Recorded in Complexity Tracking below. The product
owner directed this work explicitly, so the reasonable resolution is a MINOR amendment to
XIII carving out first-run onboarding — but that is the owner's decision, not this plan's,
and the gate stays red until it is made.

The rest of XIII applies unchanged and is accepted: `testID` on every interactive element,
purpose-built portrait layouts, plain language, ≤3 steps for a primary action, and a Maestro
flow per user story.

## Project Structure

### Documentation (this feature)

```text
specs/035-mobile-owner-onboarding/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/
│   └── organization.proto              # + CheckSubdomainAvailable RPC
├── database/scripts/
│   └── iam.query.sql                   # ~ GetIdentityByOrgAndLoginIdentifier (email fallback)
├── internal/iam/
│   ├── logic_org_accounts.go           # ~ SetPIN verifies current_pin
│   ├── connect_org_accounts.go         # ~ SetPIN passes current_pin; RetryInfo on lockout
│   └── errors.go                       # + ErrCurrentPINRequired / ErrCurrentPINIncorrect
├── internal/organization/
│   ├── logic.go                        # + subdomain format validation + availability
│   ├── connect.go                      # + CheckSubdomainAvailable; BadRequest detail
│   └── subdomain.go                    # + derive/normalize/validate helpers (new)
└── integration/
    ├── iam_auth_methods_test.go        # ~ PIN login by email
    ├── org_managed_accounts_test.go    # ~ SetPIN current-PIN enforcement
    └── mobile_owner_onboarding_test.go # + US1–US3 backend scenarios (new)

frontend/
├── packages/apis/src/
│   ├── organization.ts                 # + registerOrganization, checkSubdomainAvailable
│   ├── iam-org-accounts.ts             # ~ setPIN(currentPin?), createOrgAccount types
│   └── errors.ts                       # + lockout RetryInfo, subdomain-conflict extraction
└── apps/mobile/
    ├── src/lib/
    │   ├── auth-subdomain-storage.ts   # + remembered display name
    │   └── onboarding-progress.ts      # + resumable step state (new)
    ├── src/app/(auth)/
    │   ├── index.tsx                   # DELETED — method picker
    │   ├── pin.tsx                     # ~ rewritten: known-device / fresh-device states
    │   └── signup.tsx                  # ~ rewritten: real registration
    ├── src/app/(onboarding)/
    │   ├── _layout.tsx                 # + Stack (new)
    │   ├── set-pin.tsx                 # + owner PIN with confirmation (new)
    │   └── add-teammate.tsx            # + create + share one-time code (new)
    ├── src/app/canonical-signin.tsx    # ~ re-export target changes
    └── .maestro/
        ├── auth/signin.yaml            # ~ follows the new screen
        ├── auth/signin-known-device.yaml   # + US1 (new)
        └── onboarding/owner-signup.yaml    # + US2/US3 (new)
```

**Structure Decision**: Mobile + API. All mobile work is confined to `(auth)` and a new
`(onboarding)` group so the post-signup sequence is a stack the app can resume into without
entangling it with the sign-in routes. Backend changes stay inside the existing `iam` and
`organization` two-layer services; the only new file is a subdomain helper, because deriving
and validating an address is logic the connect layer should not carry.

## Implementation Sequence

Ordered so each step is independently verifiable and nothing is built on an unproven
assumption.

**Step 1 — Backend: PIN login accepts an email (unblocks everything).**
Widen `GetIdentityByOrgAndLoginIdentifier` with an email fallback and login-identifier
precedence. Integration test: register an org, `SetPIN` as the owner, `LoginWithPIN` with
the owner's email. This is the single change the whole feature rests on; if it does not
work the design changes, so it goes first.

**Step 2 — Backend: subdomain validation and availability.**
Format rules, derivation helper, `CheckSubdomainAvailable` RPC, and a typed conflict error
carrying `BadRequest`. Without this the signup screen either lies about availability or
surfaces a raw constraint violation.

**Step 3 — Backend: `SetPIN` verifies `current_pin`.**
Enforce for voluntary changes; keep first-set and `pin_change_token` paths exempt. Breaking
for existing callers — web and mobile update in the same change set.

**Step 4 — Backend: structured lockout errors.**
Attach `RetryInfo` to lockout failures so the client renders a real countdown instead of a
static string.

**Step 5 — API wrappers.**
`registerOrganization`, `checkSubdomainAvailable`, updated `setPIN`, and error extraction
for the two new detail types. Nothing in Steps 6–9 touches protobuf types directly.

**Step 6 — Mobile: sign-in rewrite.**
Delete the method picker, repoint the routes, rewrite `pin.tsx` into its two states, add the
remembered display name. Ships the highest-frequency win on its own — US1 is deliverable
here, before any onboarding work exists.

**Step 7 — Mobile: owner signup.**
Real registration with derived address, availability check, and the register-then-login pair
with its distinct failure message.

**Step 8 — Mobile: onboarding stack.**
`(onboarding)` group, mandatory PIN step with confirmation, skippable teammate step, share
sheet, resumable progress in MMKV.

**Step 9 — Tests and documentation.**
Maestro flows for US1–US3; backend scenarios; update `docs/domain/auth-identity.md`
(authentication methods, client surfaces, drift D4) per Principle XII.

Steps 1–4 are independent of each other and can run in parallel. Step 6 depends only on
Step 1 and Step 5, so the sign-in improvement can ship ahead of onboarding.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Principle XIII — admin features on mobile** (organization creation, member creation) | The product owner's stated goal is that an SMB owner can start and run the business from a phone. Requiring a laptop to create the workspace defeats the feature; requiring one to add the first employee leaves a one-person workspace, which has no value. | "Keep it web-only and link the owner to the web signup" was considered and rejected: the target user is a small-business owner who may not use a desktop computer for work at all, and a mid-flow handoff to a browser is the highest-drop-off point available. Scoping mobile to *first-run* onboarding only — not ongoing IAM administration — is the narrowest carve-out that delivers the feature, and is what the amendment should say. |
| **Breaking change to `SetPIN`** (Principle VI) | The `current_pin` field is declared and documented as required for voluntary changes but never read, so any holder of a session can silently rotate a PIN. The proposed flow sets an owner's first PIN over the same unvalidated path. | Leaving it alone was rejected because this feature makes the path more heavily used, not less. A compatibility window was rejected under the project's no-backward-compatibility stance: all clients ship together. |

## Notes for the next phase

`/speckit-tasks` should slice along the nine steps above. Steps 1–4 are backend-only and
testable without any mobile work; Step 6 is the first user-visible delivery and should not
be blocked behind Steps 7–8.
