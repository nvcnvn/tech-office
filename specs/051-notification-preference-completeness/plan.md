# Implementation Plan: Notification Preference Completeness

**Branch**: `051-notification-preference-completeness` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/051-notification-preference-completeness/spec.md`

## Summary

Give `notification.personal_preference` the read/write surface it never had, add
`calendar` to the domains that may be muted, and move the mobile in-app alert
switch off the handset and onto that record. Closes drift **D28**.

The suppression machinery is already correct and is not touched.
`ShouldSuppressPush` already mutes push only, already leaves the notification
row, the SSE event and the unread count alone, and already exempts priority-0
mentions and calls (`routing_logic.go:233`). FR-015 through FR-018 are
statements about behaviour that already exists but that nobody can reach,
because the table has exactly one query against it — a `SELECT` — and no RPC at
all.

So the work is a write path and a screen, plus one missing value:

1. **One migration.** `in_app_alerts_enabled boolean NOT NULL DEFAULT true`, and
   `muted_domains_valid` widened by the single value `calendar`. Widening a
   contained-by CHECK only admits values that were previously refused, so no
   data migration is needed. **(R1, R2)**
2. **Two RPCs on the existing `NotificationService`**,
   `GetNotificationPreferences` and `UpdateNotificationPreferences`, shaped like
   the `GetPresenceSettings`/`SetPresenceVisibility` pair three lines above them
   in the same proto, and guarded by the existing `pref.view`/`pref.update`
   permissions rather than new ids that would cost a per-organization back-fill
   migration. The update is a whole-record upsert, which is what makes FR-009
   structural rather than a rule to remember. **(R3, R4)**
3. **One Go list as the source of truth for "a domain".**
   `AllSourceDomains` in `constants.go`, with `IsValidSourceDomain` defined over
   it, plus an integration scenario that mutes every entry in turn. That test is
   how FR-002 is enforced: the next domain added to the system cannot quietly
   become a second unmutable one. **(R2)**
4. **The in-app alert value is stored but never read by the server.** It gates
   one client-drawn banner; putting it anywhere near `ShouldSuppressPush` would
   silence pushes too, which FR-012 forbids in as many words. **(R5)**
5. **One mobile hook, two call sites, one deleted file.**
   `useNotificationPreferences` over React Query with optimistic update and
   rollback — the pattern feature 050 established for the theme toggle and that
   the spec names as precedent. `src/lib/app-settings.ts` holds nothing but the
   old MMKV key, so FR-014 deletes the file rather than emptying it. **(R5, R6)**
6. **The mute list goes in the settings screen that already exists**, as nine
   rows under the Notifications section already there, with the copy that US3
   asks for specified as contract rather than left to the implementer. **(R7)**

No new dependency, no new service, no new table, no new screen, no change to
the delivery pipeline, and no web change.

## Technical Context

**Language/Version**: Go 1.27 (backend), TypeScript 5.9 / React 19.2 / React
Native 0.83.4 / Expo SDK 55 (mobile), PostgreSQL 18

**Primary Dependencies**: ConnectRPC, `sqlc`, `buf`, `pgx/v5` on the backend;
`@tanstack/react-query` 5.90, `expo-router` 55, the workspace `apis` and
`rpc` packages on mobile — **no new dependency is added**

**Storage**: `notification.personal_preference` — one new column, one widened
CHECK. No new table, no index change, no data migration.

**Testing**: `backend/integration/notification_personal_preference_test.go`
(new, `testWorld` idiom); `backend/internal/notification/preference_logic_test.go`
(new, two pure transforms); `.maestro/settings/notification-preferences.yaml`
(new); `make lint-tenancy`; `pnpm run typecheck:mobile`; `pnpm lint`

**Target Platform**: Linux server (backend); iOS 16.4+ and Android — both
verified, per the standing rule that mobile UI is checked on Android as well as
iOS, since the habitual test device is an iPhone SE and a nine-row settings
section is exactly the shape that overflows unnoticed on a narrow Android screen

**Project Type**: Mobile + API — Go backend, pnpm monorepo frontend

**Performance Goals**: Both RPCs are a single primary-key hit on a table with one
row per person per organization; no added query on the delivery path, which is
the only hot path in reach. The mute list renders from a nine-element constant,
not from the network.

**Constraints**: The delivery pipeline must not change behaviour (FR-012,
FR-015…FR-018 already hold); no value may remain authoritative on the device
(FR-014, SC-007); a refused write must be visible and must not be queued
(FR-021, spec assumption); `schema.sql` is generated and must not be hand-edited

**Scale/Scope**: 1 migration, 1 new query, 2 RPCs, 4 proto messages, 2 new Go
files, 3 modified Go files, 1 new + 1 modified `apis` module, 1 new mobile hook,
2 modified mobile files, 1 deleted mobile file, 1 Maestro flow, 3 domain
documents

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution v5.20.0.

| # | Principle | Verdict | Basis |
|---|---|---|---|
| I | Data Governance & Multi-Tenancy | **PASS** | `personal_preference` already has the composite primary key `(organization_id, employee_id)`, the composite FK to `organization.employee`, and no cross-tenant uniqueness; the feature adds a column to a table that already satisfies the checklist. `UpsertPersonalPreference` pins `organization_id` from the auth context, touches one schema, and needs no `-- lint:cross-tenant` marker. `ON CONFLICT … DO UPDATE SET updated_at = now()` is explicitly permitted on this un-sharded deployment. The migration is a new timestamped `.up.sql`; `schema.sql` is regenerated by `regen-schema.sh`, never edited. |
| II | Scenario-First Integration & E2E Testing | **PASS with justification** | Every user story and user-observable FR maps to a `t.Run` scenario in [contracts/test-scenarios.md](./contracts/test-scenarios.md), with the traceability table required by the principle. There is **no Playwright spec**: the feature adds no web surface. Recorded in Complexity Tracking. |
| III | Two-Layer Service Architecture & Proto-Level Authorization | **PASS** | `preference_logic.go` is pool-agnostic and takes `tx database.DBTX`; `preference_connect.go` owns `txn.WithTxn`, calls `extractAuthContext`, and translates domain errors to `connect.Error` — the exact split `visibility_logic.go`/`visibility_connect.go` already uses in this package. Both rpcs declare `required_permissions`. Authorization is by permission, never by role. |
| IV | Cross-Domain Integration | **PASS (N/A)** | No cross-domain call is added. The notifications domain owns this record and continues to; calendar is affected only as a value in a list. |
| V | Observability, Simplicity & YAGNI | **PASS** | Zero new dependencies, no new table, no new screen, no new provider, no offline queue, no field-mask machinery. One file is **deleted**. The do-not-disturb fields ride the contract because a partial-update mechanism to avoid carrying them would be strictly more code (R4). Refused writes are surfaced to the person, not swallowed. |
| VI | Versioning & Breaking Changes | **PASS** | Breaking, and shipped atomically. `SourceDomain` in `packages/apis` gains a member, which is source-compatible; the mobile in-app alert preference **moves** from MMKV to the server with no migration of the old value, per the project's standing position that early development does not carry compatibility shims. Every client is in this repository and changes in the same set. |
| VII | Frontend API Wrapper Pattern & Type Safety | **PASS** | All server access goes through `apis` (`notification-preferences.ts`); no screen touches `notificationClient`. `updateNotificationPreferences` takes `Omit<…, 'updatedAt' \| 'exists'>`, so a partial update is not expressible. Every new control carries a `testID`. |
| VIII | Cross-Stack Constant & Type Synchronization | **PASS, and advanced** | This principle is the reason D28 exists. The nine source domains live in four places that had drifted into three different lists; after this feature Go has a single `AllSourceDomains` slice, the two CHECKs and the TypeScript union agree with it, and an integration scenario fails if they stop agreeing. The alignment becomes machine-checked rather than a comment asking for it. |
| IX | UUID v7 & Nullable Cursor Params | **PASS (N/A)** | No identifiers minted, no pagination. |
| X | Structured Error Details | **PASS** | No new error-detail type. `CodeInvalidArgument` with a message naming the rejected domain is actionable on its own, and the principle says to prefer plain codes when they are. |
| XI | Distributed-First Architecture | **PASS** | No in-memory state and no coordination. The record is per-person rows read and written through the tenant pool; concurrent writes from two devices resolve last-write-wins over one row, which is the intended semantics for a record with exactly one writer. |
| XII | Living Documentation | **PASS, required** | `docs/domain/notifications-presence.md` and `docs/domain/calendar.md` both carry a "calendar cannot be muted" drift paragraph that must be **removed**, and D28 must come out of the register in `docs/domain/README.md` — SC-008 makes this part of the feature, not a follow-up. The notifications snapshot also gains the two new RPCs and the new column. `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` is checked for statements that the preference has no write path. |
| XIII | Mobile Design & Testing — Expo + Maestro | **PASS** | Notification preferences are a personal, day-to-day employee setting sitting beside the theme toggle — not administration, so the four-capability carve-out is untouched. No new route, no new navigation model, no dense table: nine switch rows reusing the screen's existing `SettingRow`, large tap targets, plain-language labels ("Tasks and projects", not `projects`). One Maestro flow; `testID` on every control. |

**Gate result: PASS.** One justification recorded below.

### Post-Phase-1 re-check

Re-evaluated against [data-model.md](./data-model.md), [contracts/](./contracts/)
and [quickstart.md](./quickstart.md):

- Phase 1 added no service, table, index, dependency, provider or abstraction
  beyond two pure functions and one hook. Principle V holds, and the net file
  count on mobile is zero — one hook added, one settings module deleted.
- Principle VIII's enforcement is a contract, not an intention: the "every
  source domain can be muted" scenario in
  [contracts/test-scenarios.md](./contracts/test-scenarios.md) is what makes
  FR-002 true going forward.
- Principle XII's obligations are checkboxes in
  [quickstart.md's Definition of Done](./quickstart.md), including the removal
  of D28 and of both drift paragraphs.
- Two facts surfaced during design and are flagged rather than absorbed:
  1. The `SourceDomain` union in `packages/apis/src/notification.ts` omits
     `calendar` too — a second, unregistered instance of D28 on the client side.
     It is fixed here rather than recorded, since a settings screen that renders
     one row per `SourceDomain` would otherwise still have no Calendar row.
  2. `notification.personal_preference` has never been written by anything.
     Every scenario in the new test file is therefore first coverage, not
     regression coverage, and the DND suppression branch of `ShouldSuppressPush`
     has never run against a row created through a supported path.

**Gate result: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/051-notification-preference-completeness/
├── plan.md                              # This file
├── spec.md                              # Feature specification
├── research.md                          # Phase 0 — R1…R9
├── data-model.md                        # Phase 1 — the column, the CHECK, defaults, validation
├── quickstart.md                        # Phase 1 — how to run and prove it
├── contracts/
│   ├── notification-preferences.proto   # The two rpcs and four messages
│   ├── apis-wrapper.md                  # `apis` exports and the mobile hook
│   ├── settings-copy.md                 # Controls, testIDs, and the FR-020 copy
│   └── test-scenarios.md                # The behavioural contract (Principle II)
└── tasks.md                             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── database/
│   ├── migrations/
│   │   └── 20260905000002_notification_preference_completeness.up.sql
│   │                                    # NEW — in_app_alerts_enabled; muted_domains CHECK += calendar
│   ├── scripts/
│   │   ├── notification.query.sql       # MODIFIED — UpsertPersonalPreference :one
│   │   └── schema.sql                   # REGENERATED by regen-schema.sh — never hand-edited
│   ├── models.go                        # REGENERATED by sqlc
│   └── notification.query.sql.go        # REGENERATED by sqlc
│
├── rpc/v1/
│   ├── notification.proto               # MODIFIED — 2 rpcs, 4 messages
│   └── notification.pb.go               # REGENERATED by buf
│
├── internal/notification/
│   ├── constants.go                     # MODIFIED — AllSourceDomains; IsValidSourceDomain over it
│   ├── preference_logic.go              # NEW — get-with-defaults, validate, normalize, upsert
│   ├── preference_logic_test.go         # NEW — the two pure transforms
│   ├── preference_connect.go            # NEW — the two handlers
│   └── connect.go                       # MODIFIED — wire PreferenceLogic into the service
│
└── integration/
    ├── helper_test.go                   # MODIFIED — publishDomainNotification + preference RPC helpers
    └── notification_personal_preference_test.go   # NEW — the behavioural contract

frontend/
├── packages/apis/src/
│   ├── notification.ts                  # MODIFIED — SourceDomain += 'calendar'; SOURCE_DOMAINS
│   ├── notification-preferences.ts      # NEW — get/update wrappers
│   └── index.ts                         # MODIFIED — re-export
│
└── apps/mobile/
    ├── .maestro/settings/
    │   └── notification-preferences.yaml            # NEW — the happy path
    └── src/
        ├── hooks/use-notification-preferences.ts    # NEW — query + optimistic mutation
        ├── components/ui/sf-icon.tsx                # MODIFIED — creditcard.fill → Ionicons card
        ├── lib/app-settings.ts                      # DELETED (FR-014)
        └── app/(app)/
            ├── _layout.tsx                          # MODIFIED — banner gate reads the hook
            └── (more)/settings.tsx                  # MODIFIED — alerts row rewired; mute list added

docs/domain/
├── notifications-presence.md            # MODIFIED — drift paragraph removed; RPCs and column added
├── calendar.md                          # MODIFIED — drift paragraph removed
└── README.md                            # MODIFIED — D28 removed from the register (SC-008)
```

**Structure Decision**: The existing Option 3 shape — a Go backend plus a mobile
app in the `frontend/` pnpm workspace. No new project, package, service or
directory. The two new Go files sit in `internal/notification/` beside
`visibility_logic.go`/`visibility_connect.go`, whose split they copy; the new
`apis` module sits beside `notification-status.ts` and `push-tokens.ts`, which
are the same kind of module; the new hook sits in `src/hooks/` with the other
seventeen.

The feature is genuinely small in code and disproportionately large in what it
unlocks, because the enforcement half of domain muting and do-not-disturb was
built two years of features ago and has been sitting behind a table nobody could
write to.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Principle II: no Playwright E2E spec for a user-facing feature | The feature adds no web surface. The web settings area manages push tokens and presence visibility and has no notification-preference controls; adding them there is explicitly out of scope in the spec, and in-app banners plus push suppression are mobile concerns. There is no browser journey to drive. | Writing a Playwright spec would mean first building the web controls this feature does not build. UI coverage is instead Principle XIII's Maestro flow, plus backend integration scenarios for every rule the screen depends on — which is where the real behaviour lives, since the screen is nine switches over one RPC. |
| Two new RPCs guarded by `pref.*` permissions on a `notif.*` service | `pref.view` ("View user preferences") and `pref.update` ("Update user preferences") already exist, already mean exactly this, and are already granted to owner, operator and employee in every organization. `voice.proto` already guards all of its rpcs with `chat.*` ids, so cross-prefix reuse is established here. | A new `notif.notificationSettings` id costs a migration that inserts into `public.permission`, rewrites all three `default_role_permission` sets, and back-fills `iam.role_permission` for every existing organization — roughly 90 lines of migration, per the `20260403000001` template — to express a distinction no organization has asked for. The trade-off is recorded as an assumption in [research.md R3](./research.md): an organization stripping `pref.update` from a custom role would lose both the theme toggle and notification preferences. |
