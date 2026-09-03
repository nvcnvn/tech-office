# Phase 1 Data Model: Evidence Review Queue

**No new table. No new column.** The queue is a read-only projection over rows that already
exist. What follows describes the projection, the entities it reads, the one index change,
and the state transitions a decision drives.

---

## 1. Review queue entry (projection — not stored)

`ReviewQueueEntry` exists only in the read path. It is one `collaboration.evidence_submission`
row with `approval_status = 'pending_review'`, joined to everything a reviewer needs to decide
without a second request.

| Field | Source | Notes |
|---|---|---|
| `evidence_submission_id` | `evidence_submission.id` | The handle `ApproveEvidence` / `RejectEvidence` take |
| `task_id`, `task_identifier`, `task_title` | `collaboration.task` | |
| `project_id`, `project_name` | `collaboration.project` | |
| `ritual_definition_id`, `ritual_name` | `collaboration.ritual_definition` | via `task.ritual_definition_id` |
| `evidence_requirement_id`, `_name`, `_position`, `_is_required` | `collaboration.evidence_requirement` | |
| `requirement_unresolved` | derived | `true` when the requirement or definition row is missing |
| `submitted_by_employee_id`, `submitted_by_display_name` | `evidence_submission` + `organization.employee` | the one cross-schema join (see plan.md Complexity Tracking) |
| `server_timestamp`, `device_timestamp` | `evidence_submission` | **only `server_timestamp` sorts** |
| `evidence_type`, `file_id`, `text_content`, `link_url`, `gps_coordinates` | `evidence_submission` | the evidence itself (FR-004) |
| `instance_state_category` | `collaboration.project_state.category` via `task.state_id` | |
| `instance_completion_deadline` | `task.completion_deadline` | nullable |
| `urgency` | derived | `LATE` when category ∈ {`overdue`, `missed`}, else `NORMAL` |

### Inclusion predicate (FR-002)

An entry is present **if and only if** all of these hold:

```
evidence_submission.organization_id = <caller org>
evidence_submission.approval_status = 'pending_review'
task.task_kind                      = 'ritual_instance'
task.is_deleted                     = FALSE
task.detached_from_ritual           = FALSE
EXISTS project_membership(org, task.project_id, <caller employee>) WITH role <> 'viewer'
AND the caller holds permission `collab.reviewEvidence`
```

Consequences worth stating, because each is an acceptance scenario:

- **Auto-approved submissions never appear.** Geofence auto-approval writes
  `approval_status = 'approved'` at submission time, so no decision is outstanding (US1-2).
- **Already-decided submissions never appear**, by the same predicate (US1-3).
- **Submissions on `missed` instances DO appear**, marked `LATE`. `missed` is terminal for the
  instance, but the submitter is still waiting on an answer, and hiding the row would leave a
  permanently pending submission invisible (US5-2).
- **Submissions on deleted or detached tasks do not appear** (US5-3).
- **Inaccessible submissions are absent, not redacted** — the membership join is an inner
  join, so nothing about them reaches the response (FR-007, US1-5).

### Ordering and cursor (FR-005)

Sort key: `(urgency_rank, server_timestamp, evidence_submission.id)` ascending, where
`urgency_rank` is `0` for `LATE` and `1` for `NORMAL`.

The cursor is that same tuple, opaque on the wire (base64 of `"<rank>|<RFC3339Nano>|<uuid>"`),
and the page predicate is a SQL row comparison against it. The `id` leg is a UUID v7 primary
key, so the ordering is total and no two rows tie — the boundary cannot duplicate or skip
within a snapshot.

`device_timestamp` is carried for display but never sorts, so a device with a wrong clock
cannot move in the queue.

---

## 2. Entities read (all existing, all unchanged)

### `collaboration.evidence_submission` — the thing being decided

The queue reads it and a decision writes `approval_status`, `reviewed_by_employee_id`,
`reviewed_at`, `reviewer_comment`, `updated_at`. Relevant existing shape:

```
PRIMARY KEY (organization_id, id)                 -- id is UUID v7
approval_status TEXT NOT NULL DEFAULT 'pending_review'
                CHECK (approval_status IN ('pending_review','approved','rejected'))
server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
FK (organization_id, task_id)                  -> collaboration.task            ON DELETE CASCADE
FK (organization_id, evidence_requirement_id)  -> collaboration.evidence_requirement ON DELETE RESTRICT
FK (organization_id, submitted_by_employee_id) -> organization.employee         ON DELETE RESTRICT
FK (organization_id, reviewed_by_employee_id)  -> organization.employee         ON DELETE RESTRICT
```

`reviewed_by_employee_id` + `reviewed_at` are what satisfy FR-019: every decision records who
made it and when, so a self-approval is visible in the audit trail rather than prevented
invisibly.

Note the `ON DELETE RESTRICT` on the requirement FK: a requirement with submissions cannot be
deleted, and `ritual_definition` deletion cascades to requirements, so in practice
`requirement_unresolved` should never be true. The field and the `LEFT JOIN` behind it exist
anyway, because the spec requires the row to degrade gracefully rather than fail the page if
the invariant is ever broken.

### `collaboration.task` — the ritual instance

Supplies `identifier`, `title`, `project_id`, `state_id`, `completion_deadline`,
`ritual_definition_id`, and the `is_deleted` / `detached_from_ritual` / `task_kind` filters.
It is also the thing whose state re-derives when a decision lands.

### `collaboration.project_state` — where the state category comes from

`task.state_id` → `project_state.category`, one of `todo`, `in_progress`, `done`, `cancelled`,
`scheduled`, `submitted`, `verified`, `overdue`, `missed`, `skipped`. The queue reads it for
display and urgency; it never writes it.

### `collaboration.project_membership` — reviewer scope

```
role TEXT NOT NULL DEFAULT 'member'
     CHECK (role IN ('owner','admin','member','viewer'))
```

The queue's inner join on `(organization_id, project_id)` with `employee_id = <caller>` and
`role <> 'viewer'` **is** the reviewer scope. The decision path evaluates the identical
predicate through the existing `CheckProjectAccess(..., []string{ProjectMemberRoleMember})`,
which applies the hierarchy `viewer(1) < member(2) < admin(3) < owner(4)`. One predicate, two
call sites — which is what makes "nothing appears in the queue that the actions would refuse,
and nothing the actions accept is hidden from the queue" (US4) true by construction rather
than by discipline.

A `public` project grants read visibility without a membership row; that is equivalent to
`viewer` and therefore does **not** grant decide rights. See research.md R1.

### `collaboration.project`, `collaboration.ritual_definition`, `collaboration.evidence_requirement`, `organization.employee`

Read for display names only.

---

## 3. Reviewer scope (derived, not stored)

> The set of projects a given employee may decide submissions in.

```
ReviewerScope(employee) =
    ∅                                            if employee lacks `collab.reviewEvidence`
    { p : membership(p, employee).role <> 'viewer' }   otherwise
```

It is never materialised. Both the queue query and the decision check evaluate it inline
against `project_membership`, so a membership revoked mid-session takes effect on the next
call — which is exactly US4 scenario 3: the action is refused and the row leaves the queue on
refresh.

---

## 4. Schema change: one index, one drop

`backend/database/migrations/20260903000001_evidence_review_queue_index.up.sql`

```sql
-- The queue's dominant access path: pending submissions in an organization, in
-- (server_timestamp, id) order, stopping at the page size.
CREATE INDEX IF NOT EXISTS idx_evidence_sub_pending_queue
    ON collaboration.evidence_submission (organization_id, server_timestamp, id)
    WHERE approval_status = 'pending_review';

-- Superseded: idx_evidence_sub_pending was (organization_id, approval_status) with the same
-- partial predicate. It found the pending set but carried no ordering column, so the planner
-- sorted every pending row in the organization before applying the limit. The new index
-- serves every query shape the old one did. Per Principle I's index-reuse rule, the redundant
-- overlapping index is dropped rather than left in place.
DROP INDEX IF EXISTS collaboration.idx_evidence_sub_pending;
```

Leads with `organization_id` (Principle I). Partial, so it holds only undecided rows — a
working set that shrinks as reviewers work, rather than growing with history.

`backend/database/scripts/schema.sql` is regenerated by `backend/scripts/regen-schema.sh`
after the migration runs. It is a generated snapshot and is never hand-edited.

---

## 5. Query change: compare-and-set on the decision

`UpdateEvidenceSubmissionApproval` gains one predicate:

```sql
-- name: UpdateEvidenceSubmissionApproval :one
UPDATE collaboration.evidence_submission
SET approval_status = @approval_status,
    reviewed_by_employee_id = @reviewed_by_employee_id,
    reviewed_at = @reviewed_at,
    reviewer_comment = @reviewer_comment,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND id = @id
  AND approval_status = 'pending_review'   -- NEW: compare-and-set
RETURNING *;
```

Zero rows now means "no longer pending", not "not found". The handler distinguishes the two by
having read the row earlier in the same transaction (see §6), so it can always say *which*
refusal happened.

---

## 6. State transitions

### The submission

```
                    ApproveEvidence (scope OK, CAS wins)
     pending_review ────────────────────────────────────► approved   [terminal]
          │
          │         RejectEvidence (scope OK, reason non-empty, CAS wins)
          └─────────────────────────────────────────────► rejected   [terminal]

     approved | rejected ──── any further decision ────► REFUSED, unchanged
                                                          FAILED_PRECONDITION
                                                          + PreconditionFailure(who, when)
```

Both terminal states are final. `approved` and `rejected` rows leave the queue but are neither
deleted nor archived — the existing per-task evidence history remains the record.

### The decision transaction (one transaction, owned by the Connect layer)

```
1. GetEvidenceSubmissionForReview   -- submission + task.project_id + current decision fields
2. project scope check              -- CheckProjectAccess(..., ["member"])
                                       fail -> PERMISSION_DENIED, no detail, nothing written
3. status check                     -- not pending -> FAILED_PRECONDITION + who/when detail
4. (reject only) trim(comment)      -- empty -> INVALID_ARGUMENT + BadRequest("comment")
5. CAS update                       -- 0 rows -> a racing tx won -> same FAILED_PRECONDITION
6. reconcileRitualTaskState         -- THE single writer; re-derives the instance state
7. notify submitter + task watchers -- evidence_approved / evidence_rejected, unchanged types
```

Steps 3 and 5 are both required: step 3 gives the common case a useful message, step 5 closes
the TOCTOU window step 3 leaves open. Any failure rolls the whole transaction back, so a
failed decision records no partial state and the row returns to the queue pending (FR-018).

### The ritual instance

The queue changes **nothing** about how instance state is derived. `reconcileRitualTaskState`
→ `determineRitualTaskStateCategory` remains the single authority, with its existing
precedence:

```
1. verified     all required evidence approved
2. submitted    all required evidence in, none rejected
3. missed       deadline + full grace window elapsed, evidence incomplete
4. overdue      deadline elapsed, evidence incomplete
5. in_progress  some evidence submitted, deadline not passed
6. scheduled    instance is for a future day
7. todo         everything else
```

So:

- Approving the last outstanding requirement moves the instance to `verified` with no further
  step (US2-3) — row 1 fires because the evidence picture changed, not because the queue said
  so.
- Rejecting a submission on an `overdue` instance re-derives from the new evidence picture
  using the same rules as the task detail path, and does not become terminal as a side effect
  of the review (US2-4). Row 3 requires the grace window to have elapsed; a rejection does not
  advance the clock.
- Deciding a submission on a `missed` instance does not resurrect it: rows 1 and 2 need the
  full required set approved or submitted, which a `missed` instance by definition lacks.

---

## 7. What is deleted

`listRitualReviewBacklog` / `RitualReviewBacklogItem`
(`frontend/packages/apis/src/collaboration-ritual.ts:580`) and their only consumer,
`frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx`.

That helper listed every ritual task in one project, then issued `listEvidenceSubmissions`
per task and filtered for `pending_review` in the browser — an unpaginated, unscoped,
single-project N+1 over the network. The server-side queue supersedes it entirely, and the
project page links to `/workspace/reviews?projectId=<id>` instead. Removed rather than
deprecated: two answers to "what is waiting for review" would disagree whenever project scope
and reviewer scope differ.
