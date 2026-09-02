# Phase 0 Research: Feature Tour

Decisions taken before design, with what was rejected and why. Every item was resolved
against the code as it stands on `main`; nothing here is left as NEEDS CLARIFICATION.

## Server-driven or client-driven

**Decision**: Server-driven. `TourService.GetTour` returns the selected tour, the filtered
and platform-adapted stops, and the caller's progress. Clients render and report progress.

**Rationale**: Three of the spec's requirements — FR-002 (select the tour from permissions),
FR-006 (omit stops the person cannot use), FR-023 (adapt each stop to the platform) — are
rules that would otherwise be implemented twice, once in `apps/web` and once in
`apps/mobile`, and would drift. The auth interceptor already resolves the caller's full
permission set and puts it in the request context
(`interceptor.UserPermissionsFromContext`, `backend/internal/interceptor/auth.go:384`), so
evaluating them server-side costs nothing.

There is also a hard blocker on the client-side route. A client cannot read its own
permissions today: `IAMService.GetEmployeePermissions` takes an `employee_id`
(`backend/rpc/v1/iam.proto:1170`) that neither `AuthContext` on web nor `use-auth` on mobile
holds — `GetProfile` returns a `User`, whose id is a user id, not an employee id. Going
client-side would mean either adding a "my permissions" RPC or threading the employee id
through both clients, which is more work than the server-side design it was meant to avoid.

**Alternatives considered**:
- *Shared TypeScript content package* (`frontend/packages/tour`) with client-side filtering.
  Rejected for the reasons above, and because it puts product copy in a place the backend
  cannot see, splitting the feature across three packages instead of one.
- *Static content per app.* Rejected outright: two copies of the same copy, guaranteed drift.

## Where tour progress is stored

**Decision**: A new tenant table, `iam.tour_progress`, one row per
`(organization_id, employee_id, tour_id)`.

**Rationale**: The spec's success criteria SC-002 and SC-004 are completion rates. A table with a `status` column answers those with a `GROUP BY`; it is the
reason the cheaper option was not taken. Progress is also per tour, not per person — FR-014
and the role-change edge case both require remembering the two tours independently.

`iam.user_preference` already scopes exactly this way (`organization_id` + `employee_id`,
one row per employee, `backend/database/scripts/schema.sql:2535`), so the tenancy shape is
proven and `iam` is the right schema.

**Alternatives considered**:
- *`iam.user_preference.additional_preferences` JSONB.* This column exists and is explicitly
  reserved for future per-user state, so it would need **no migration at all** — the lazy
  answer, and genuinely tempting. Rejected because the adoption metrics in SC-002 – SC-005
  would then be unindexed JSONB traversals, and because per-tour state in a blob has no
  constraint enforcing which statuses are legal.
- *A row per stop.* Rejected as YAGNI. Progress is a single high-water mark; per-stop rows
  would answer questions nobody asked.

## Which service owns it

**Decision**: A new `internal/tour` domain package and `rpc/v1/tour.proto`, modelled on
`internal/preference` (three files, 463 lines total — the smallest domain in the repository
and the right template).

**Rationale**: The tour serves *content*, which is not a preference under any reading.
Keeping it separate also keeps `PreferenceService` a single-purpose service.

**Alternatives considered**: two extra RPCs on `PreferenceService`, saving roughly two files
and a service registration. Rejected — see Complexity Tracking in [plan.md](plan.md).

## Where tour content lives

**Decision**: Go values in `internal/tour/content.go`. Two `Tour` structs, each a slice of
`Stop`. A `contentVersion` constant travels in the response.

**Rationale**: The spec puts a tour authoring interface out of scope and states that content
is defined by the product, not per organization. A content table would therefore be a table
with a dozen immutable rows, a migration every time copy changes, and a seeding path — all
cost, no benefit. Copy changes ship with a backend deploy, which is acceptable because all
clients in this repository release together.

**Consequence to accept**: localisation would require moving copy out of Go. Localisation is
out of scope for this feature, and the move is mechanical when it is wanted.

## How a stop is selected out for permissions

**Decision**: Each `Stop` declares `RequiredPermission string`. The logic layer drops a stop
whose permission is absent from the context permission set. An empty value means always show.

**Rationale**: This is display filtering, not authorization — the RPCs behind each surface
still enforce their own permissions. Reusing the existing permission ids means a custom role
lands on the correct stops with no extra mapping.

## How the audience is chosen

**Decision**: The administrator tour is served when the caller holds `iam.inviteUser`;
otherwise the worker tour.

**Rationale**: `iam.inviteUser` is granted to `owner` and `operator` and explicitly excluded
from `employee` in the seeded role templates
(`backend/database/migrations/20260310120000_init.up.sql:306`). It is also semantically
exact: "can bring people into the workspace" is the premise of the administrator tour's
first stop. A custom role granted that permission is, for tour purposes, an administrator —
which is the correct answer rather than an accident.

**Alternatives considered**: role-name matching (`owner`/`operator`). Rejected because
Feature 020 replaced role checks with permission checks throughout, and because a custom
role would fall through to the wrong tour.

## Target routing across platforms {#target-routing}

**Decision**: The response carries a `TourTarget` enum value per stop (`TARGET_PEOPLE`,
`TARGET_PROJECTS`, `TARGET_RITUALS`, `TARGET_CHAT`, `TARGET_CALENDAR`, `TARGET_DOCS`,
`TARGET_TODAY`, `TARGET_ALERTS`, `TARGET_SEARCH`, `TARGET_NONE`). Each client owns a small
map from enum to its own route.

**Rationale**: Routes are genuinely platform-specific — `/workspace/projects` on web,
`/(app)/(tasks)` on mobile — so the enum is the only sharable part. `internal/linking` was
considered and is the wrong tool: it resolves *resources* by id, and tour stops point at
*surfaces*.

**Drift guard (Constitution VIII)**: each client's route map is exhaustive over the generated
enum, checked by a test that fails when a new `TourTarget` has no route — the same
lightweight-check-over-infrastructure approach used elsewhere in the repository. Adding a
target without routing it is a build failure, not a silent dead button.

## Copy: server-rendered or client-held

**Decision**: The server returns the rendered title, body and action label per stop.

**Rationale**: One source of truth for copy, and it makes FR-023 (say "do this on the web"
on mobile) a server-side substitution instead of two client-side conditionals.

## When the tour is offered

**Decision**: The server computes `should_offer` from the stored status. The client asks for
the tour on workspace entry and shows the offer only when nothing else is holding the person:
after `TermsGate` and the onboarding redirect on mobile, after auth and terms on web, and
never while a pending deep-link redirect is being followed (FR-008, FR-013).

**Rationale**: The offer *rule* belongs on the server so it is stated once; the offer
*timing* is a client-shell concern that only the client knows.

## Deletion and data lifecycle

**Decision**: `DeleteTourProgressForOrganization` is called from
`internal/iam/logic_account_deletion.go`, next to the existing
`DeleteUserPreferencesForOrganization` call (line 215).

**Rationale**: Account and organization deletion already sweep per-domain tables explicitly
rather than relying on cascades. A new tenant table that is not added to that sweep leaves
orphaned rows behind a deleted organization, which is exactly the kind of drift the register
in `docs/domain/README.md` exists to record. Cheaper to do now than to find later.

## Measuring the success criteria

**Decision**: No new analytics pipeline, matching the spec's stated assumption. SC-002 is
answered by `SELECT status, count(*) FROM iam.tour_progress GROUP BY status` filtered by
`tour_id`. SC-003 and SC-004 compare existing ritual-definition and evidence counts against a
pre-release baseline. SC-001, SC-005, SC-006, SC-007 and SC-008 are verified by test or by
review and need no measurement at all.

**Nothing counts individual offers.** SC-005 was originally worded as "zero repeat automatic
offers across a full release cycle", which implies telemetry this design does not produce —
only the status is stored, never the act of offering. The criterion has been restated as the
property the backend scenarios actually verify: a completed or dismissed tour is never
offered automatically again. Adding offer logging to satisfy the original wording would have
meant a write on every workspace entry, which is exactly the cost the not-started-is-an-absent-row
design exists to avoid.

**Open item with a hard deadline**: SC-003 and SC-004 are increases against a "pre-tour
baseline". That baseline must be captured from production **before** this feature ships, or
the criteria become permanently unfalsifiable — once the tour is live there is no un-toured
population left to compare against. Tracked as T042; it is an operational step, not
implementation work, which is precisely why it is easy to lose.
