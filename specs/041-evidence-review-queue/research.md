# Phase 0 Research: Evidence Review Queue

All Technical Context unknowns are resolved here. The spec carried no `[NEEDS CLARIFICATION]`
markers; the open questions were design choices the plan had to settle, and each is recorded
below with the assumption tag so it can be reviewed later.

---

## R1. What exactly is "reviewer scope"?

**Decision**: A caller may decide a submission when **both** hold:

1. they hold the `collab.reviewEvidence` permission (org-wide, from the auth interceptor), and
2. they have a `collaboration.project_membership` row on the submission's task's project with
   `role <> 'viewer'` — i.e. `member`, `admin` or `owner`.

The same predicate drives the list query and the decision check, so the queue and the actions
cannot disagree (FR-010, US4).

**Rationale**: The spec's FR-010 says "access to the submission's project other than
`viewer`", and the codebase already models project access as
`collaboration.project_membership.role` with the hierarchy
`viewer(1) < member(2) < admin(3) < owner(4)` in
`backend/internal/collaboration/membership_logic.go:451`. Reusing `CheckProjectAccess(...,
[]string{ProjectMemberRoleMember})` gets the exact semantics for free.

**[ASSUMPTION: a `public` project does not grant decide rights without a membership row.**
`CheckProjectAccess` short-circuits to `true` for public projects only when
`requiredRoles` is empty. Passing `ProjectMemberRoleMember` therefore requires a real
membership row even on a public project. This is the safe reading: public visibility is a
*read* affordance equivalent to `viewer`, and FR-010 excludes `viewer`. The alternative —
treating any employee as a decider on any public ritual project — would make the
authorization tightening cosmetic for the most common project type.]

**Alternatives considered**:
- *Task-assignee based* (only the task's `reviewer`/`approver` assignees may decide).
  Rejected: the spec's edge case "a task with no reviewer and no approver assigned" requires
  project owners and admins to see those submissions anyway, so assignee alone is
  insufficient, and layering both produces two competing scopes.
- *Department-based scope.* Rejected: rituals are attached to projects, not departments;
  there is no department edge on `collaboration.task`.

---

## R2. How is the queue ordered and paginated so the boundary is stable?

**Decision**: Order by the tuple `(urgency_rank, server_timestamp, id)` ascending, where
`urgency_rank` is `0` when the ritual instance's state category is `overdue` or `missed` and
`1` otherwise. The cursor is the same tuple, encoded as an opaque base64 string
`"<rank>|<RFC3339Nano>|<uuid>"`, and the page predicate is a SQL row comparison:

```sql
(urgency_rank, server_timestamp, id) > (@cursor_rank, @cursor_server_timestamp, sqlc.narg('cursor_submission_id'))
```

`urgency_rank` is computed once in a CTE so both `WHERE` and `ORDER BY` reference the same
expression.

**Rationale**: FR-005 demands *both* a non-duplicating page boundary *and* overdue-first
ordering, so the sort key cannot be `id` alone. A row comparison on the full sort tuple is
the standard keyset-pagination form: it is total (the `id` leg is a UUID v7 primary key, so
no two rows tie), it uses the ordering index directly, and it cannot skip or repeat within a
snapshot. `server_timestamp` is the server's own record, which satisfies the clock-skew edge
case — a phone with a wrong clock writes `device_timestamp`, which is not part of the sort.

**[ASSUMPTION: an entry that changes urgency bucket between two page fetches may be seen
twice or not at all.** The bucket is derived from live instance state, which the
reconciliation sweep mutates independently. No cursor over a mutable derived key can prevent
this without a snapshot. It is harmless here — the queue is explicitly "a snapshot" per the
spec's edge cases, a duplicate row is idempotent to look at, and a missed row reappears on
the next refresh. Recording it rather than adding a materialised ordering column.]

**Alternatives considered**:
- *Offset pagination.* Rejected: `OFFSET` over a set that shrinks as the reviewer works
  through it skips rows, which is precisely the FR-005 failure.
- *Two separate queries (urgent page, then normal page).* Rejected: doubles the round trips
  and pushes the merge into every client.
- *A stored `urgency_rank` column maintained by the state writer.* Rejected as YAGNI: it
  adds a column and a write path to make a `CASE` expression indexable, for a query the
  supporting index already covers.

**Page size**: default 25, maximum 100. `[ASSUMPTION: 25 matches the density of the mobile
card layout — roughly three screens of scroll on a 430 dp phone — and keeps the p95 well
inside SC-005's 2 s budget.]`

---

## R3. How is the badge count computed without an unbounded scan?

**Decision**: `CountEvidenceReviewQueue` runs the same joins and predicates as the list but
selects `COUNT(*)` over a bounded subquery:

```sql
SELECT COUNT(*)::int AS pending_count FROM (SELECT 1 FROM ... LIMIT 100) capped;
```

The response carries `pending_count` and `is_capped`. Clients render `99+` when
`is_capped` is true.

**Rationale**: FR-006 requires a count obtainable without fetching entries, and the spec's
own edge case says the count is "capped in presentation ('99+') rather than requiring an
exact count of an unbounded set". Bounding inside SQL means a reviewer returning from leave
with 4 000 pending items costs the same as one with 100. SC-005 requires the badge to appear
without waiting for the list, so it is a separate RPC the clients fire in parallel.

**Alternatives considered**:
- *Return the count on the list response.* Rejected: couples the badge to a list fetch, so
  the entry point cannot show a count until the surface is opened — the opposite of what
  FR-006 and FR-021 ask for.
- *A denormalised per-employee counter.* Rejected: reviewer scope is a set of projects that
  changes with membership, so a per-employee counter would need invalidating on every
  membership and every submission change. Classic YAGNI trap.

---

## R4. How is the concurrent-decision race resolved (FR-015, SC-008)?

**Decision**: Compare-and-set. `UpdateEvidenceSubmissionApproval` gains
`AND approval_status = 'pending_review'` to its `WHERE` clause. The decision flow inside the
handler's single transaction is:

1. `GetEvidenceSubmissionForReview` — returns the submission joined to its task's
   `project_id`, plus the current `approval_status`, `reviewed_by_employee_id` and
   `reviewed_at`.
2. Project-scope check (R1). Refuse with `PERMISSION_DENIED` if it fails.
3. If `approval_status <> 'pending_review'` → refuse with `FAILED_PRECONDITION` +
   `PreconditionFailure` naming the prior decider and time.
4. CAS update. Zero rows affected means a concurrent transaction won between steps 1 and 4 →
   same `FAILED_PRECONDITION` refusal.
5. `reconcileRitualTaskState` — the existing single writer.
6. Notify.

**Rationale**: This mirrors the compare-and-set the ritual state writer already uses, and it
needs no lock, no advisory lock and no serialisable isolation. Step 3 exists so the common
case produces a *useful* message (who decided it); step 4 exists because step 3 alone is a
TOCTOU window. The refusal never overwrites, satisfying FR-015 and SC-008 — exactly one
decision is recorded and the loser is told why.

**Alternatives considered**:
- *`SELECT ... FOR UPDATE`.* Rejected: serialises reviewers on a row for the duration of the
  reconciliation, and still needs the status check afterwards, so it buys nothing.
- *Last-write-wins.* Rejected outright — it is the bug FR-015 exists to prevent.

---

## R5. Does the queue need a new decision path, or can it reuse the existing RPCs?

**Decision**: Reuse. The queue's approve and reject buttons call the existing
`ApproveEvidence` and `RejectEvidence` RPCs unchanged in shape. No new RPC, no new logic
method, no duplicated notification or state-derivation code.

**Rationale**: FR-016 requires a decision from the queue to be indistinguishable from one
made at the task detail view, and forbids a parallel decision path. Those RPCs already call
`reconcileRitualTaskState` (`backend/internal/collaboration/evidence_logic.go:277, 312`),
which is documented as the single writer of ritual instance state. Adding a queue-specific
decision endpoint would immediately create the second path the FR forbids, and SC-007's
"verified by test against both paths" would then be testing two implementations rather than
one.

The scoping and CAS work described in R1 and R4 lands *inside* those existing methods, so the
task detail view inherits both fixes. That is the root-cause fix rather than a queue-local
guard: every caller routes through one place.

---

## R6. What is broken in the existing decision notifications, and how far does this feature go?

**Findings from the current code**:

- `notifyEvidenceApproved` / `notifyEvidenceRejected`
  (`backend/internal/collaboration/ritual_notification_logic.go:434, 443`) are both invoked
  with `taskTitle == ""`, so the delivered body reads literally
  `"Evidence has been rejected for: "`.
- Neither carries the reviewer's comment, so a rejection reason never reaches the submitter.
- Both resolve recipients via `notifyTaskWatchers`
  (`backend/internal/collaboration/task_logic.go:1202`), which reads
  `resource_subscription` for the task and **excludes the actor**. The submitter is a
  recipient only if they happen to hold an active subscription on that task.

**Decision**: Fix all three, scoped tightly to the evidence-decision path:

1. Load the task inside `ApproveEvidence`/`RejectEvidence` (already loaded for the project
   scope check in R4 step 1) and pass its real title.
2. Append the reviewer's comment to the rejection body — FR-014 requires the reason to reach
   the submitter, and the reason is worthless if it stops at the database.
3. Add `evidence_submission.submitted_by_employee_id` to the recipient set explicitly, so
   "the submitter is notified" (FR-016, US2 scenario 1) is guaranteed rather than incidental.
   The actor-exclusion rule still applies, which is what makes the self-approval edge case
   ("permitted, but recorded") behave sensibly: a reviewer approving their own submission
   does not notify themselves, and the audit trail carries the decision either way.

**[ASSUMPTION: this stays inside the feature rather than becoming a follow-up.** FR-014 and
FR-016 are unmeetable without it — a rejection whose reason is not delivered fails the
acceptance scenario outright. Out of scope remains anything about *who else* is notified
(the spec's Out of Scope list) and any new notification type.]

**Alternatives considered**: Introducing a dedicated `evidence_decision` notification type
carrying structured fields. Rejected — the spec's assumptions explicitly rule out a new
notification type, and the existing `evidence_approved` / `evidence_rejected` types are the
ones clients already route.

---

## R7. Which index supports the queue query?

**Decision**: One new partial index, plus reuse of what already exists.

```sql
CREATE INDEX IF NOT EXISTS idx_evidence_sub_pending_queue
    ON collaboration.evidence_submission (organization_id, server_timestamp, id)
    WHERE approval_status = 'pending_review';
```

**Rationale**: The existing `idx_evidence_sub_pending` is
`(organization_id, approval_status) WHERE approval_status = 'pending_review'` — it finds the
pending set but carries no ordering column, so the planner sorts every pending row in the
organization before applying the limit. Adding `server_timestamp, id` to the partial index
makes the dominant ordering leg an index scan that stops at the page size. The predicate is
already the partial-index condition, so the index stays small (it holds only undecided rows,
which is a shrinking working set by construction).

Per Principle I's index-reuse rule the new index supersedes the old one for every query
shape the old one served, so `idx_evidence_sub_pending` is **dropped in the same migration**
rather than left as a redundant overlapping index.

`urgency_rank` is deliberately not indexed — it is derived from a join to
`collaboration.project_state`, and the reviewer-scope join to `project_membership` bounds the
candidate set long before ordering cost matters at the scales in SC-005.

**Membership side**: `collaboration.project_membership` already carries an index leading with
`(organization_id, employee_id)` used by the existing "my projects" queries; the queue's
`pm.employee_id = @reviewer_employee_id` predicate reuses it.

---

## R8. How do the clients render evidence in a row without a second request?

**Decision**: The queue entry carries the submission's own content inline — `text_content`,
`link_url`, GPS coordinates and accuracy, `evidence_type` — and, for file-backed types, the
`file_id`. Clients resolve the viewable URL through the **existing** files path
(`getDownloadUrl(fileId)` in `frontend/packages/apis/src/files.ts:167`), which the task
detail view already uses
(`.../tasks/[taskId]/components/EvidenceChecklist.tsx:290`).

**Rationale**: FR-004 asks the entry to carry enough to judge, not that the queue RPC mint
signed URLs. Download URLs are short-lived and per-file; embedding them in a list response
would either expire before the reviewer scrolls to the row or force the queue to mint 25 of
them per page. Resolving lazily per visible row reuses the audited files access-control path
untouched.

**Unavailable evidence (FR-009)**: when `getDownloadUrl` fails or the row's `file_id` is null
for a file-backed type, the row renders with its metadata plus an explicit "evidence
unavailable" marker and **stays decidable** — the reviewer can reject it on that basis. The
entry is never dropped from the response, because a broken upload silently clearing the
queue is the exact failure FR-009 names.

**Alternatives considered**: A `viewable_url` field on the entry populated server-side.
Rejected for the expiry and fan-out reasons above.

---

## R9. Where does each surface live, and how is the entry point gated?

**Web** — a new top-level workspace tab. `frontend/apps/web/src/app/workspace/layout.tsx`
already supports `permission?: string` on `TabConfig` (used by the Organization tab at
`layout.tsx:143`, filtered at `layout.tsx:577`). The new tab reuses that mechanism with
`permission: "collab.reviewEvidence"`, so FR-012's "the entry point is not offered to them"
needs no new machinery. Route: `/workspace/reviews`. The count comes from
`GetEvidenceReviewQueueCount` and renders as an unread-style badge on the tab.

**[ASSUMPTION: shortcut ⌘8, taking the slot currently held by the disabled CRM tab.**
⌘1–⌘7 are occupied by enabled tabs. CRM is `enabled: false`, so nothing user-visible moves;
CRM takes ⌘9 and the remaining disabled tabs shift down when they are eventually enabled.]

**Mobile** — a new full-screen route `(app)/(tasks)/review/index.tsx`, registered in the
existing tasks stack (`(app)/(tasks)/_layout.tsx`), reached from a card at the top of the
tasks tab index that shows the pending count. Not a new bottom tab: Principle XIII fixes the
tab set at `tab-chat` / `tab-tasks` / `tab-calendar` / `tab-alerts` / `tab-more`, and the
spec's FR-021 says "reachable from the tasks area".

**[ASSUMPTION: the mobile entry-point card is hidden entirely when the count is zero and the
caller lacks the permission, and shows an explicit "Nothing to review" state when the caller
holds the permission but has an empty queue.** FR-021 requires a visible count and US3
scenario 4 requires the entry point to "communicate that plainly"; hiding it from
non-reviewers matches FR-012.]

---

## R10. Does anything existing get deleted?

**Decision**: Yes — `listRitualReviewBacklog` and `RitualReviewBacklogItem` in
`frontend/packages/apis/src/collaboration-ritual.ts:580` are removed, along with their only
consumer, the per-project `RitualReviewBacklog` component at
`frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx`.

**Rationale**: That helper is the client-side ancestor of this feature: it lists every ritual
task in *one* project, then issues `listEvidenceSubmissions` per task and filters for
`pending_review` in the browser — an N+1 over the network that is unscoped, unpaginated and
single-project. The server-side queue supersedes it completely. The project-scoped view it
powered is reachable as the queue filtered to that project.

Per the project's early-development stance, it is deleted rather than deprecated alongside
the new path. Leaving both would mean two answers to "what is waiting for review", differing
whenever project scope and reviewer scope disagree.

**[ASSUMPTION: the per-project review backlog panel is replaced by a link from the project
page to the queue pre-filtered to that project, not by an embedded second instance of the
queue.** `ListEvidenceReviewQueueRequest` therefore carries an optional `project_id` filter
— one extra predicate on a query that already joins the project — and the project page links
to `/workspace/reviews?projectId=<id>`. This keeps "one queue" as the spec requires while
preserving the one thing the deleted panel did that the queue does not do by default. The
filter narrows reviewer scope; it never widens it.]
