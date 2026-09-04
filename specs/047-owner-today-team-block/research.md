# Phase 0 Research: Team block on mobile Today

The spec left no `[NEEDS CLARIFICATION]` markers — it resolved its own ambiguities in the
Assumptions section. This document records the **implementation** decisions those assumptions
imply, each verified against the code rather than against the numbered specs, and each with
the alternative that was rejected.

---

## Decision 1 — Supervisory scope is `project_membership.role IN ('owner','admin')`

**Decision**: A caller's supervisory scope is every non-archived project where they hold an
`owner` or `admin` `collaboration.project_membership` row. The scope is expressed as an
`EXISTS` sub-predicate inside both new queries, never as a separate "list my projects" round
trip.

**Rationale**: `project_membership.role` is CHECK-constrained to
`('owner','admin','member','viewer')` (`schema.sql:956`), so the two supervisory roles are
already a closed set. `ListEvidenceReviewQueue` scopes itself with the neighbouring predicate
`pm.role <> 'viewer'` on the same table with the same join shape, so this is one notch
tighter on a proven pattern. Owners and admins are also already the escalation audience the
`ritual_instance_unassigned` notification and the `closed_unresolved` shift alert target, so
the block shows a supervisor exactly the class of problem they are already paged about. The
index `idx_membership_employee (organization_id, employee_id)` covers the lookup, so no new
index is needed.

**Alternatives considered**:
- *`collab.reviewEvidence` alone* — rejected in the spec itself: the permission is granted to
  all three default roles, so every employee would see the whole workspace's late work.
- *A new `collab.superviseTeam` permission* — rejected: needs a migration, a back-fill across
  every existing organization and a place in the role editor, to express what two existing
  signals already express together.
- *`pm.role <> 'viewer'`, reusing the review queue's exact predicate* — rejected: it includes
  plain `member`, which reintroduces the every-employee-sees-everything problem the spec's
  first assumption exists to avoid.

---

## Decision 2 — Lateness is read from `project_state.category`, never computed

**Decision**: The overdue predicate is `ps.category = 'overdue' AND ps.is_closed = FALSE`. No
comparison against `completion_deadline` appears anywhere in the feature.

**Rationale**: FR-007 and SC-003 require that the Team block and the caller's own "Running
late" section never disagree. `determineRitualTaskStateCategory` is the sole authority on
lateness and `reconcileRitualTaskStateForTask` is its sole writer, driven by the 5-minute
`ritual_reconciliation_sweep`. `GetAssignedWorkSummaryCounts` — the query behind "Running
late" — already resolves ritual lateness this way
(`ps.category = 'overdue' OR t.due_date < as_of_date`, where the `OR` exists only to keep
*standard tasks* working). Reading the same column is the only way the two sections are
guaranteed to agree; any date arithmetic here would disagree with the sweep for up to five
minutes at every deadline.

**Alternatives considered**:
- *`completion_deadline < now()`* — rejected: correct-looking and wrong. It would list
  instances the sweep has not yet marked, producing exactly the disagreement FR-007 forbids,
  and would also list `submitted` instances, which are the reviewer's delay and not the
  worker's.

---

## Decision 3 — Terminal states are excluded by `ps.is_closed = FALSE`, not by a category list

**Decision**: Both categories filter `ps.is_closed = FALSE`.

**Rationale**: The seeded ritual states mark `verified`, `missed` and `skipped` as
`is_closed = true` — this is exactly how a `missed` instance already drops out of
`GetAssignedWorkSummary` with no query change. Filtering on the flag rather than enumerating
categories means a future terminal state is excluded automatically, and it keeps this query
agreeing with every other read surface (FR-008). `detached_from_ritual = FALSE` and
`is_deleted = FALSE` are applied for the same reason the reconciliation sweep applies them: a
detached instance is a standalone task and no longer the ritual's business.

**Alternatives considered**:
- *`ps.category NOT IN ('verified','missed','skipped')`* — rejected: a hard-coded list that
  the next seeded terminal state would silently defeat.

---

## Decision 4 — The two categories are disjoint by construction

**Decision**: `overdue` is `ps.category = 'overdue'`; `unassigned` is
`ps.category <> 'overdue' AND t.scheduled_date = @as_of_date AND NOT EXISTS(assignee)`. The
list is a `UNION ALL` of the two, ordered by a literal rank column (`0` overdue, `1`
unassigned).

**Rationale**: FR-010 requires an instance satisfying both to be listed and counted once,
under overdue. Making the predicates mutually exclusive in SQL satisfies that without a
`DISTINCT ON`, a post-filter in Go, or any risk of the *counts* double-counting while the
*items* de-duplicate. The rank column, not the category enum, drives `ORDER BY` — the same
discipline `ListEvidenceReviewQueue` uses, where `urgency_rank` is the authority and the wire
enum is derived from it so the two cannot disagree.

**Alternatives considered**:
- *One predicate with a `CASE` category and `DISTINCT ON (t.id)`* — rejected: it makes the
  count query and the item query express the de-duplication differently, which is how a count
  the caller cannot substantiate by opening the rows (FR-004) gets shipped.

---

## Decision 5 — Assignee names come from `EmployeeNameLookup`, not a cross-schema join

**Decision**: The queries return `primary_assignee_id` (COALESCEd to the nil UUID) and
`assignee_count`; the logic layer resolves ids to display names with one batched
`EmployeeNameLookup.ListEmployeeNames` call for the whole response.

**Rationale**: Constitution IV forbids cross-schema SQL joins, and `internal/collaboration`
already declares `EmployeeNameLookup` on the consumer side precisely for this — it is what
the feature-046 link previews use for the identical "one name per row, one lookup per page"
problem. The COALESCE-to-nil-UUID trick is copied verbatim from `ListTaskPreviews`, where it
exists because sqlc infers a `LEFT JOIN`ed `NOT NULL` column as non-nullable and scanning a
real `NULL` fails the whole batch; `assignee_count`, not the id, is what the Go side reads to
decide whether an assignee exists at all.

Crucially, a name that fails to resolve **does not drop the row**: a departed or archived
assignee is exactly the situation the owner needs to see (spec edge case). An unresolved id
falls back to the empty string and the client renders the row with no name rather than
omitting it.

**Alternatives considered**:
- *`JOIN organization.employee emp ON ...`, as `ListEvidenceReviewQueue` does* — rejected. It
  is shorter and it is what the nearest neighbour does, but it is pre-existing drift from
  Constitution IV, and it would turn a departed employee into a dropped row unless written as
  a `LEFT JOIN` anyway. Copying a violation because it is nearby is how drift becomes the
  norm. **This is recorded in the drift register in `docs/domain/README.md` as part of the
  documentation update, not silently repeated.**

---

## Decision 6 — `as_of_date` is an explicit optional proto field

**Decision**: `GetTeamAttentionSummaryRequest.as_of_date` is an `optional string` carrying an
ISO `YYYY-MM-DD` date. The mobile client passes the device's local date — the same value it
already computes for its React Query key. Absent or empty → the server's current date. A
present-but-unparseable value is `InvalidArgument` with a `google.rpc.BadRequest` field
violation, never a silent fallback.

**Rationale**: The spec's day-boundary assumption requires the *device's* date: for a
supervisor at UTC+7 the local date and the server's UTC date differ precisely during the
early-morning hours when the block is most useful, so a server-only clock would hide this
morning's unassigned opening ritual until 07:00 local. An explicit field is preferred over an
ambient HTTP header read through an interceptor. Silently accepting a malformed date would
mean the caller believes they asked about one day and was answered about another.

**Scope note — `GetAssignedWorkSummary` is deliberately left alone.** It resolves its own
`as_of` from `time.Now()`. No disagreement can arise from the mismatch, because ritual
lateness in *both* surfaces comes from the stored state category (Decision 2) and never from
a date; `as_of_date` in the new RPC governs only the *unassigned* category, which has no
counterpart in the caller's personal sections. Widening the context rail's contract is a
separate change.

**Alternatives considered**:
- *Server `time.Now()` only, mirroring `GetAssignedWorkSummary`* — rejected: shortest diff,
  but it silently drops the spec's day-boundary requirement for every non-UTC workspace.
- *A timezone/offset header on the interceptor* — rejected on the standing preference for an
  explicit proto field over an ambient header.

---

## Decision 7 — Bounds: 5 default, 20 ceiling, 100 count cap; expansion is a refetch

**Decision**: `limit` defaults to `5` per category and is clamped to `20`. Counts are
computed inside a `LIMIT 100` subquery per category, and `overdue_count_capped` /
`unassigned_count_capped` are `count >= 100`. "Show more" refetches with `limit: 20`; there
is no cursor and no page token.

**Rationale**: These are the limits the neighbouring surfaces already use —
`defaultAssignedWorkSummaryLimit = 5` / `maxAssignedWorkSummaryLimit = 20` in
`context_rail_logic.go`, and `reviewQueueCountCap = 100` in `evidence_review_queue_logic.go`
— so the block behaves like its neighbours and needs no new tuning story. Bounding the count
inside SQL is what makes SC-005 true: 5 000 matching instances cost the same as 50. Two
separate capped flags rather than one shared flag, because a workspace can plausibly have 100+
overdue and 3 unassigned, and reporting the exact 3 as "100+" would be a lie the caller can
disprove by expanding.

A ceiling of 20 rows does not need cursor pagination; adding one would be scaffolding for a
"load more" the spec explicitly rules out (FR-013 caps the rendered list).

**Alternatives considered**:
- *Cursor pagination like the review queue* — rejected: YAGNI. The ceiling is 20 rows, total.
- *One `counts_capped` flag for both categories* — rejected as above.

---

## Decision 8 — The Team block owns its own loading and error state

**Decision**: A third `useQuery` (`["today-team", dayKey]`) is started in the same render as
the existing work and events queries. Its `isLoading` feeds the block's own skeleton, and its
`error` renders an inline retry **inside** the block. The screen's existing whole-screen
error path stays wired to `workError || eventsError` only.

**Rationale**: FR-018 and SC-006 require that a failure of the team feed leaves the caller's
own day fully rendered. Today's screen currently returns a full-screen error when *either*
query fails; folding a third, supervisory-only query into that condition would let an extra
blank out the screen a worker depends on. Starting all three in the same render (rather than
chaining the team query behind the work query) is what satisfies FR-015 — the added cost is
the difference between the slowest feed and the previous slowest, not a third serial hop.

The block is hidden entirely — no heading, no card, no skeleton — when `canSupervise` is
false, which is also why `can_supervise` is a distinct response field rather than being
inferred from a zero count (FR-001, SC-008). This mirrors `GetEvidenceReviewQueueCount`'s
`can_review`, which exists for exactly the same reason.

**Alternatives considered**:
- *Fetch the team block only after the work query resolves* — rejected: serialises two round
  trips and breaks FR-015.
- *Infer visibility from `overdue_count + unassigned_count > 0`* — rejected: it makes "you
  supervise nothing" and "your team is fine" indistinguishable, which is the exact defect the
  all-clear state (User Story 3) exists to fix.

---

## Verified against the code

| Claim | Verified at |
|---|---|
| Permission-as-empty-result is an established pattern | `internal/collaboration/ritual_connect.go:432-521` |
| Ritual lateness is read from the stored state | `database/scripts/collaboration.query.sql`, `GetAssignedWorkSummaryCounts` |
| Limits 5/20 and cap 100 already exist | `context_rail_logic.go:14-15`, `evidence_review_queue_logic.go:20-24` |
| Batched name lookup exists on the consumer side | `internal/collaboration/preview_logic.go:12-20` |
| Single-assignee-plus-count without row fan-out | `ListTaskPreviews` LATERAL + correlated sub-select |
| Membership roles are a closed CHECK set | `database/scripts/schema.sql:956` |
| Scope and instance lookups are already indexed | `idx_membership_employee`, `idx_task_project_state` |
| Today runs two concurrent queries and one shared refresh | `frontend/apps/mobile/src/app/(app)/(today)/index.tsx` |
