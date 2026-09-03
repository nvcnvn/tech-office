# Quickstart & Validation Guide: Evidence Review Queue

How to run the feature and prove it works end to end. Implementation detail lives in
[data-model.md](./data-model.md) and [contracts/](./contracts/collaboration-review-queue.proto);
this file is the run guide and the behavioural contract.

---

## Prerequisites

```bash
cd backend && docker compose up -d postgres    # Postgres on PG_PORT
make voice-dev-backend                         # backend on :8080 (sources voice-env.sh, as the tests do)
cd frontend && pnpm --filter web dev           # Next.js web app on :13000
cd frontend/apps/mobile && pnpm start          # Metro (LAN IP resolved by scripts/with-lan-ip.sh)
make check-servers                             # confirms Postgres, backend and web are all reachable
```

After the schema change lands:

```bash
cd backend && DATABASE_URL=... ./scripts/migrate.sh    # applies the new index migration
./scripts/regen-schema.sh                              # regenerates schema.sql — never hand-edit it
sqlc generate                                          # regenerates Go models for the new queries
cd .. && make lint-tenancy                             # every join must carry organization_id
```

Proto regeneration after editing `backend/rpc/v1/collaboration.proto`:

```bash
cd backend && buf generate    # per backend/buf.gen.yaml: Go + Connect stubs in place,
                              # TypeScript stubs into frontend/packages/rpc
cd ../frontend && pnpm --filter rpc build
```

---

## Seed data for manual validation

One organization, two projects, one reviewer, one submitter:

| Fixture | Purpose |
|---|---|
| `PROJ-A` — reviewer is `member`, submitter is `member` | entries appear, decisions accepted |
| `PROJ-B` — reviewer is `viewer` | entries absent, decisions refused (US4-2) |
| `PROJ-C` — reviewer is not a member at all, `visibility = private` | entries absent, direct-id decision refused (US4-1) |
| A ritual in `PROJ-A` with 2 requirements: one photo (manual), one GPS (auto-approve) | proves auto-approved submissions never queue (US1-2) |
| One instance in `PROJ-A` pushed past its deadline into `overdue` | proves the `LATE` bucket sorts first (US5-1) |
| 30 pending submissions in `PROJ-A` | proves the page boundary (US1-7) |

Arrange these through RPC calls, not the UI — the same "arrange via API" rule the E2E suite
follows.

---

## Manual validation walkthrough

### Web

1. Sign in as the reviewer. The **Reviews** tab is visible in the workspace nav with a count
   badge. Sign in as an employee without `collab.reviewEvidence` — the tab is absent (FR-012,
   FR-020).
2. Open `/workspace/reviews`. Entries from `PROJ-A` only. The `overdue` instance's entry is
   marked and sits at the top; the rest are oldest-first (FR-005, US5-1).
3. The photo entry renders a viewable thumbnail without navigating to the task (US1-6).
4. Approve an entry → the row leaves the list immediately, no manual refresh (FR-017).
5. Reject an entry → a reason is required; submit with only spaces and the action is refused
   (FR-014).
6. Approve the last outstanding requirement on an instance → open that task; its state is
   `verified` (US2-3).
7. Open the same entry in two browser sessions and approve in both → the second reports the
   submission was already decided, and names who decided it (US2-5, SC-008).
8. Scroll past the first page → the next page loads with no duplicate and no gap (US1-7).
9. Clear the queue → an explicit empty state, not a blank screen (FR-008, US1-4).

### Mobile (360–430 dp portrait, Android **and** iOS)

1. Tasks tab shows the review entry point with the pending count before the queue is opened
   (US3-5, FR-021).
2. Open the queue → same entries in the same order as web (US3-1).
3. The photo is legible at device width and opens full-screen (US3-2, FR-022).
4. Reject → the reason sheet's confirm button stays reachable with the keyboard raised
   (US3-3, FR-022).
5. Approve → the row leaves the list and the decision is visible on web (FR-024).
6. Empty queue → the entry point says so plainly (US3-4).

Verify on both platforms. The narrow-Android and iOS-only-prop regressions this repo has hit
before do not show up on an iPhone SE alone.

### Authorization (the gap this feature closes)

Call `ApproveEvidence` directly with a submission id from `PROJ-C`, as the reviewer, using a
raw RPC client. It must be refused, the submission unchanged, and the refusal must carry no
detail naming the project or task (FR-011, SC-006, FR-007). Repeat as a `viewer` on `PROJ-B`.

---

## Behavioural contract — backend integration scenarios

`backend/integration/collaboration_evidence_review_queue_test.go`, composed as `t.Run` stubs
before any implementation, per Constitution Principle II.

```
TestEvidenceReviewQueue
  when a reviewer with pending submissions across three projects opens the queue
    it returns every pending submission from all three projects in one list      // FR-001
    it orders the entries oldest submission first                                // FR-005
    it carries the ritual name, task identifier, project, submitter and age      // FR-003
    it carries the evidence content for each evidence type                       // FR-004
  when a submission was auto-approved by geofence
    it does not appear in the queue                                              // FR-002
  when a submission has already been approved or rejected
    it does not appear in the queue                                              // FR-002
  when the reviewer has nothing waiting
    it returns an empty list and no cursor rather than an error                  // FR-008
  when a pending submission belongs to a project the caller cannot access
    it is absent from the response entirely, not flagged                         // FR-007
  when there are more pending submissions than fit one page
    the next page continues without duplicating or skipping an entry             // FR-005
  when the caller asks for the pending count
    it returns the count without fetching the entries                            // FR-006
    it caps the count and reports that it was capped                             // FR-006
  when a submission's underlying evidence file is unretrievable
    the entry is still listed and still decidable                                // FR-009

TestEvidenceReviewQueueScope
  when the caller lacks the evidence-review permission
    the queue is empty rather than an authorization failure                      // FR-012
  when the caller's only role on the project is viewer
    the project's submissions do not appear                                      // FR-010
    a decision on one of them is refused                                         // FR-011
  when the caller is not a member of the submission's private project
    approving it by identifier is refused and the status is unchanged            // FR-011
    rejecting it by identifier is refused and the status is unchanged            // FR-011
    the refusal discloses nothing about the project or the task                  // FR-007
  when the caller's membership is removed after the queue was loaded
    the action is refused and the entry is gone on the next fetch                // FR-010

TestEvidenceDecisionFromQueue
  when a reviewer approves a pending submission
    the submission records the reviewer, the decision time and the comment       // FR-013, FR-019
    the submitter is notified                                                    // FR-016
    the entry no longer appears in the queue                                     // FR-017
  when a reviewer rejects with a reason
    the reason reaches the submitter with the rejection notification             // FR-014
  when a reviewer rejects with a whitespace-only reason
    the rejection is refused and the submission stays pending                    // FR-014
  when the approved submission was the instance's last outstanding requirement
    the ritual instance becomes verified without further action                  // US2-3
  when a submission on an overdue instance is rejected
    the instance state re-derives by the existing rules                          // US2-4
    the instance does not become terminal as a side effect of the review         // US2-4
  when two reviewers decide the same submission concurrently
    exactly one decision is recorded                                             // FR-015
    the loser is told it was already decided and by whom                         // FR-015
    the first decision is not overwritten                                        // FR-015
  when a decision fails partway
    no partial state is recorded and the submission stays pending                // FR-018
  when the same decision is made from the task detail path and from the queue
    both produce the same submitter notification                                 // FR-016, SC-007
    both produce the same resulting ritual instance state                        // FR-016, SC-007
  when a submitter decides their own submission holding the review permission
    the decision is recorded against them and is visible in the audit trail      // FR-019

TestEvidenceReviewQueueUrgency
  when a pending submission's instance is overdue
    the entry is marked late and sorts above entries that are not late           // FR-005, US5-1
  when a pending submission's instance has become missed
    the entry still appears, marked as belonging to a missed instance            // US5-2
  when a submission's task is deleted or detached from its ritual
    the entry does not appear                                                    // US5-3
  when a submission's ritual definition has been archived
    the entry still appears                                                      // spec edge case
```

Run: `make test-backend` (full suite — zero failures, not just the new file).
Single file while iterating: `make test-backend-one T=TestEvidenceReviewQueue`.

---

## Behavioural contract — web E2E scenarios

`frontend/apps/web/e2e/collaboration-evidence-review-queue.spec.ts`. Names mirror the backend
scenarios so both suites tell the same story. Arrange via API, act via UI, assert via UI.

```
Evidence Review Queue
  when a reviewer opens the review queue
    all pending submissions across projects appear in one list                   // FR-001, FR-020
    the oldest submission appears first                                          // FR-005
    a photo submission is viewable from the row                                  // FR-004
  when the reviewer approves from a queue row
    the row leaves the queue without a manual refresh                            // FR-017
  when the reviewer rejects from a queue row
    a reason is required before the rejection is accepted                        // FR-014
    a whitespace-only reason is refused                                          // FR-014
  when a decision fails
    the row returns to its pending presentation with the reason shown            // FR-018
  when the submission was already decided elsewhere
    the reviewer is told it was already decided rather than silently succeeding  // FR-015, FR-024
  when the reviewer has nothing to review
    an explicit empty state is shown, distinct from loading and from failure     // FR-008
  when an employee without the evidence-review permission signs in
    the review queue entry point is not offered                                  // FR-012, FR-020
  when items are waiting
    the navigation entry point shows a count                                     // FR-006, FR-020
```

Run: `make test-frontend` (full suite).
Single spec: `make test-frontend-one F=collaboration-evidence-review-queue`.

Every interactive element carries `data-testid` (FR-025):
`review-queue-list`, `review-queue-row-<submissionId>`, `review-queue-approve-btn`,
`review-queue-reject-btn`, `review-queue-reject-reason-input`,
`review-queue-reject-confirm-btn`, `review-queue-empty-state`, `review-queue-load-more-btn`,
`workspace-tab-reviews`, `workspace-tab-reviews-badge`.

---

## Behavioural contract — Maestro flow

`frontend/apps/mobile/.maestro/tasks/evidence-review-approve.yaml` — happy path only, per
Principle XIII's lighter mobile bar: sign in → tasks tab → review entry point → first entry →
approve → assert the entry is gone.

Run: `make test-mobile` (full suite).
Single flow: `make test-mobile-one F=tasks/evidence-review-approve`.

Every interactive element carries `testID` (FR-025):
`review-queue-entry-card`, `review-queue-list`, `review-queue-item-<submissionId>`,
`review-approve-button`, `review-reject-button`, `review-reject-reason-input`,
`review-reject-confirm-button`, `review-photo-fullscreen-button`, `review-queue-empty-state`.

---

## Requirement coverage

| Requirement | Covered by |
|---|---|
| FR-001 … FR-009 (the queue) | `TestEvidenceReviewQueue`, web E2E "opens the review queue" |
| FR-010 … FR-012 (authorization) | `TestEvidenceReviewQueueScope`, web E2E "without the evidence-review permission" |
| FR-013 … FR-019 (deciding) | `TestEvidenceDecisionFromQueue`, web E2E approve/reject scenarios |
| FR-020 (web surface + count) | web E2E entry-point scenarios |
| FR-021, FR-022 (mobile surface) | Maestro flow + the manual mobile walkthrough above |
| FR-023 (mobile layout independence) | design review against Principle XIII's checklist; not machine-testable |
| FR-024 (cross-surface consistency) | `TestEvidenceDecisionFromQueue` "already decided" + web E2E "already decided elsewhere" |
| FR-025 (test identifiers) | enforced by the E2E and Maestro selectors above — a missing id fails the suite |
| SC-001, SC-002, SC-009 | manual walkthrough / usability testing; not machine-testable |
| SC-003, SC-004 | post-release measurement against the pre-feature baseline; not machine-testable |
| SC-005 | perf check: seed 500 pending submissions across 50 projects, assert first page < 2 s |
| SC-006 | `TestEvidenceReviewQueueScope` |
| SC-007 | `TestEvidenceDecisionFromQueue` "same decision from both paths" |
| SC-008 | `TestEvidenceDecisionFromQueue` concurrent-decision scenario |

**Documented exclusions**: FR-023 and SC-001/002/003/004/009 have no automated scenario.
FR-023 is a layout property verified by review against the Principle XIII checklist; the
success criteria are timing, adoption and usability measures that require real users or
post-release telemetry. Everything else is covered.

---

## Definition of Done

- [ ] Migration applied, `schema.sql` regenerated by script, `sqlc generate` run
- [ ] `make lint-tenancy` green
- [ ] Backend scenario stubs replaced with real implementations — no `t.Skip("TODO")` left
- [ ] E2E stubs replaced with real implementations — no `test.skip` left
- [ ] `make test-backend` passes in full
- [ ] `make test-frontend` passes in full
- [ ] `make test-mobile` passes in full
- [ ] Mobile verified on Android **and** iOS at 360–430 dp portrait
- [ ] `listRitualReviewBacklog` and `RitualReviewBacklog.tsx` deleted, not deprecated
- [ ] `docs/domain/rituals-tasks.md` and `docs/domain/workspace-navigation.md` updated to
      describe the queue and the tightened decision scope, with superseded behaviour removed
