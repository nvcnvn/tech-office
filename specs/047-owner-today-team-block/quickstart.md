# Quickstart: Team block on mobile Today

How to build, run and prove this feature. Design details live in
[data-model.md](data-model.md) and [contracts/](contracts/collaboration-team-attention.proto);
this file is the run guide.

---

## Prerequisites

- PostgreSQL running (`make check-postgres`) with migrations applied — **no new migration for
  this feature**.
- Backend on `:8080` (`make check-backend`), Metro on `:8082` for the mobile flow.
- `buf`, `sqlc` and Go 1.24 on `PATH`.
- Maestro installed and `frontend/apps/mobile/.maestro/.env` populated (`make check-maestro-env`).

## Regenerating after the contract change

```bash
cd backend && buf generate     # proto -> Go + frontend/packages/rpc TypeScript
cd backend && sqlc generate    # collaboration.query.sql -> collaboration.query.sql.go
make lint-tenancy              # must be green: the new joins carry organization_id
```

`buf generate` writes both the Go stubs and the TypeScript client, so the mobile app and the
backend cannot disagree about the wire shape. No `regen-schema.sh` run is needed — there is no
migration.

---

## The behavioural contract (Constitution II)

`backend/integration/team_attention_test.go`. Written as `t.Run` stubs **before** any
implementation and reviewed as the contract for this feature. Run it with:

```bash
make test-backend-one T=TestTeamAttentionSummary
```

```text
TestTeamAttentionSummary
  when the caller supervises a project with a late ritual instance
    it lists the overdue instance with its title, project and assignee name       US1-1, FR-006, FR-011
    it returns the instance's project name rather than an identifier fragment     FR-011
    it orders the longest-late instance first                                     FR-012
  when the caller supervises nothing
    it returns can_supervise false with no items and no error                     US1-3, FR-001, FR-002
  when the caller lacks collab.reviewEvidence
    it returns an empty summary rather than PERMISSION_DENIED                     FR-002
  when the caller is a viewer on a project holding a late instance
    it omits that instance from the items and from the counts                     FR-004
  when a late instance belongs to another organization
    it is never returned                                                          FR-005
  when the overdue instance is assigned to the caller
    it is excluded from the team summary                                          US1-4, FR-009
  when the instance has reached a closed state
    it is excluded from both categories and both counts                           US1-5, FR-008
  when the instance is soft-deleted, detached, or its project archived
    it is excluded                                                                Edge cases
  when a ritual instance scheduled for as_of_date has no assignee
    it is listed in the unassigned category                                       US2-1, FR-006
    it carries no assignee name, so the client can label it Unassigned            US2-2, FR-011
  when an unassigned instance is given an assignee
    it leaves the unassigned category on the next request                         US2-3
  when an unassigned instance is scheduled for a future date
    it is not listed                                                              US2-4
  when an instance is both overdue and unassigned
    it appears once, under overdue, and is counted once                           FR-010
  when the caller supervises projects and nothing is overdue or unassigned
    it returns can_supervise true with a non-zero supervised project count        US3-1, FR-016
  when the assignee's employee record is archived
    it still lists the instance rather than dropping the row                      Edge cases
  when an instance has several assignees
    it names one and reports the count of the rest                                Edge cases
  when more instances match than the requested limit
    it returns the true count alongside the shortened list                        US4-1, FR-013
    it clamps the requested limit to the ceiling                                  US4-2, FR-013
  when more instances match than the count cap
    it reports the capped figure and sets the capped flag                         US4-3, FR-014
    it costs the same as a small backlog                                          SC-005
  when as_of_date is supplied
    it scopes the unassigned category to that date and leaves overdue unbounded   Edge cases
  when as_of_date is malformed
    it returns InvalidArgument with a field violation on as_of_date               Constitution X
```

Fixtures come from the existing `newTestWorld(t)` helpers — `withOwner`, `withEmployee`,
`createProject`, `addProjectMember`, `createTask`, `assignTask`, `moveTask`,
`stateByCategory` — the same set `context_rail_test.go` uses. Two helpers are new:
`w.createRitualInstance(...)` for a ritual-kind task with a `scheduled_date` and
`completion_deadline`, and `w.getTeamAttentionSummary(actor, asOfDate, limit)`.

**No web E2E suite is added.** The feature has no web surface (spec assumption: mobile-only in
this feature; the web app already answers the supervisory question through the Reviews tab and
the project Health tab). Constitution II's E2E requirement is scoped to "features with
user-facing UI" on web; the mobile UI obligation is discharged by the Maestro flow below. This
exclusion is deliberate and recorded here as Constitution II requires.

---

## Manual validation

### 1. The owner sees the team's late work

```bash
# As a project owner/admin who is NOT the assignee:
#  - seed a ritual instance in a supervised project, assigned to another employee
#  - let ritual_reconciliation_sweep mark it overdue (runs every 5 minutes), or drive one
#    cycle directly from the integration test's injected clock
```

Open Today on the device. Expect a **Team** block below "Running late", listing the instance
with its title, project name and the assignee's name. Tap it: the ritual instance opens; back
returns to Today with scroll position preserved.

### 2. The worker sees nothing

Sign in as an employee who is a `member` or `viewer` everywhere. Expect Today to be
byte-for-byte what it is today: no Team heading, no card, no placeholder, and — verified in
the network log — **no `GetTeamAttentionSummary` request marked visible**. (The request may be
issued; what must not happen is any rendered artefact. SC-008.)

### 3. The all-clear

As a supervisor whose rituals are all current and assigned, expect the Team block to render an
explicit all-clear naming the number of projects covered — not to disappear.

### 4. The team feed fails alone

Stop the backend after the personal feeds resolve, or force the team query to reject. Expect
the caller's own overdue work, events and due-today work to stay fully rendered, with a
retryable error confined to the Team block (FR-018, SC-006).

---

## Mobile blackbox flow

The team assertions extend the existing Today screen sweep rather than adding a new file —
Today is one screen and one flow should describe it:

```bash
make test-mobile-one F=screens/today
```

`frontend/apps/mobile/.maestro/screens/today.yaml` gains, after the existing overview
screenshot: assert the `today-section-team` heading is visible for the supervisor account,
screenshot the block, tap the first team row (`id: today-team-row-0`), assert the ritual
instance screen, and return via `top-level-back-button`. The signed-in Maestro account must be
an owner or admin of at least one project holding a seeded overdue instance — record that
requirement in `.maestro/.env.example` alongside the existing per-flow env notes.

Full suite before merge:

```bash
make test-mobile
```

## Mobile design checklist

Carried from Constitution XIII; verify each before calling the feature done.

- [x] Feature is in scope for mobile — read-only supervisory view, no configuration
      (justified in [plan.md](plan.md#principle-xiii-scope-justification))
- [ ] Large tap targets: every row meets `mobileLayout.listRowHeight`; the expand control
      meets `mobileLayout.compactRowHeight`
- [ ] Plain labels: "Team", "Running late in your projects", "Nobody assigned", "All clear"
- [ ] Portrait layout 360–430 dp; the responsibility label and the counts must not truncate on
      a narrow Android device **or** on an iPhone SE (FR-021) — check both, not only the
      habitual iPhone SE
- [ ] `testID` on every interactive element: `today-section-team`,
      `today-team-row-<taskId>`, `today-team-expand`, `today-team-retry`
- [ ] `accessibilityLabel` on every row and control, reading the title, project and
      responsibility (FR-021)
- [ ] Skeleton state matches the rest of Today so the screen does not shift when team data
      lands (FR-022)
- [ ] `make test-mobile` passes

---

## Definition of done

1. `make test-backend-one T=TestTeamAttentionSummary` green, then `make test-backend` green.
2. `make lint-tenancy` green.
3. `make test-mobile` green.
4. `docs/domain/rituals-tasks.md` and `docs/domain/workspace-navigation.md` updated in the
   same change set (Constitution XII), including the note in `docs/domain/README.md`'s drift
   register that `ListEvidenceReviewQueue`'s direct `organization.employee` join is
   pre-existing drift this feature deliberately did not copy.
5. Backend, `frontend/packages/rpc`, `frontend/packages/apis` and `frontend/apps/mobile`
   land together — the proto change is breaking for nobody only because they ship atomically.

## Scenario-to-requirement map

Every User Story and every user-observable FR is covered above:

| Source | Covered by |
|---|---|
| US1 (owner sees late work) | first four contract scenarios + manual validation 1 |
| US2 (owner sees unassigned) | unassigned scenarios + `as_of_date` scenarios |
| US3 (explicit all-clear) | all-clear scenario + manual validation 3 |
| US4 (readable at scale) | limit/cap scenarios |
| FR-001 – FR-014, FR-016 | named inline in the contract listing |
| FR-015 | Not integration-testable — three concurrent queries in one render; verified by code review of the Today screen and by manual validation 1 |
| FR-017 | Maestro flow refresh + `useManualRefresh` / `useStreamRecoveryRefresh` wiring |
| FR-018 | manual validation 4 |
| FR-019 | Maestro flow row tap and back |
| FR-020 | Existing "Nothing due today" copy is unchanged; asserted by the existing flow |
| FR-021, FR-022 | Mobile design checklist |
