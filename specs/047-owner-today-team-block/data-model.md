# Phase 1 Data Model: Team block on mobile Today

**No schema change. No migration. No new table, column, index or constraint.** Everything
below is a *read model* — a projection over rows that already exist.

---

## Storage touched (all pre-existing)

| Table | Columns read | Why |
|---|---|---|
| `collaboration.task` | `id`, `organization_id`, `project_id`, `title`, `task_kind`, `scheduled_date`, `completion_deadline`, `is_deleted`, `detached_from_ritual`, `state_id` | The ritual instance itself |
| `collaboration.project_state` | `organization_id`, `id`, `category`, `is_closed` | The authority on lateness (Decision 2) and on terminality (Decision 3) |
| `collaboration.project` | `organization_id`, `id`, `name`, `is_archived` | Row's project label; archived projects excluded |
| `collaboration.project_membership` | `organization_id`, `project_id`, `employee_id`, `role` | Supervisory scope (Decision 1) |
| `collaboration.task_assignee` | `organization_id`, `task_id`, `employee_id`, `role`, `assigned_at`, `id` | Primary assignee, assignee count, self-exclusion |
| `organization.employee` | — via `EmployeeNameLookup` only | Display names. **Never joined** (Decision 5) |

---

## Entities

### Supervisory scope

Not an object and not a stored row — a predicate, evaluated inside both queries:

```sql
EXISTS (
    SELECT 1
      FROM collaboration.project_membership pm
     WHERE (pm.organization_id, pm.project_id) = (t.organization_id, t.project_id)
       AND pm.employee_id = @caller_employee_id
       AND pm.role IN ('owner', 'admin')
)
```

Its cardinality — the number of non-archived projects it covers — is returned as
`supervised_project_count`, because the all-clear message has to name it (FR-016) and because
`0` is what makes the whole block disappear (FR-001).

### Team attention item

One ritual instance needing a supervisor's attention.

| Field | Source | Notes |
|---|---|---|
| `task_id` | `t.id` | Enough identity to open the instance (FR-019) |
| `project_id` | `t.project_id` | Route parameter for the instance screen |
| `project_name` | `p.name` | FR-011 requires the project, and the mobile row has space for a name rather than a key |
| `title` | `t.title` | FR-011 |
| `category` | literal `0` / `1` rank → proto enum | The rank is the ordering authority; the enum is derived from it (Decision 4) |
| `due_date` | `t.completion_deadline::date` for overdue, `t.scheduled_date` for unassigned | ISO `YYYY-MM-DD`; absent when the source column is `NULL` |
| `assignee_display_name` | `EmployeeNameLookup` on `primary_assignee_id` | Absent for unassigned rows; the client renders the literal "Unassigned" (FR-011). Absent-but-`assignee_count > 0` means a departed employee — the row still renders (spec edge case) |
| `additional_assignee_count` | `assignee_count - 1`, floored at `0` | Drives the "+N" indicator (spec edge case) |

**A row is never dropped for want of a resolvable name.** That is the whole point of the
separate `assignee_count`: it distinguishes "nobody is on this" from "somebody is on this and
we could not name them", which are opposite facts for a supervisor.

### Team attention summary

The single response. Its shape is what makes each of the three visible outcomes distinguishable:

| Outcome | `can_supervise` | `supervised_project_count` | counts |
|---|---|---|---|
| Not a supervisor → render nothing | `false` | `0` | `0` |
| Supervisor, all clear → render the all-clear | `true` | `> 0` | `0` |
| Supervisor with problems → render the list | `true` | `> 0` | `> 0` |

`can_supervise` is `true` iff the caller holds `collab.reviewEvidence` **and**
`supervised_project_count > 0`. It is a distinct field precisely because a zero count cannot
tell the first row from the second (Decision 8).

---

## Predicates

Both queries share this base, applied to every candidate row:

```sql
t.organization_id = @organization_id            -- FR-005, Constitution I
AND t.task_kind = 'ritual_instance'             -- rituals only (spec assumption)
AND t.is_deleted = FALSE                        -- edge case: soft-deleted excluded
AND t.detached_from_ritual = FALSE              -- edge case: detached excluded
AND ps.is_closed = FALSE                        -- FR-008, Decision 3
AND p.is_archived = FALSE                       -- edge case: archived project excluded
AND <supervisory scope EXISTS>                  -- FR-001, FR-003, FR-004
AND NOT EXISTS (                                -- FR-009: never the caller's own work
    SELECT 1 FROM collaboration.task_assignee ta
     WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
       AND ta.role = 'assignee'
       AND ta.employee_id = @caller_employee_id
)
```

Every join in both queries carries `organization_id` on both sides in composite form
(`(a.organization_id, a.fk) = (b.organization_id, b.id)`), as Constitution I requires and as
`make lint-tenancy` verifies.

### Category-specific legs

| | Overdue (rank `0`) | Unassigned (rank `1`) |
|---|---|---|
| State | `ps.category = 'overdue'` | `ps.category <> 'overdue'` |
| Date | *unbounded* — an instance late three days ago is still the store's problem | `t.scheduled_date = @as_of_date` |
| Assignment | any | `NOT EXISTS (task_assignee WHERE role = 'assignee')` |

The two legs are **mutually exclusive by construction** (`ps.category = 'overdue'` vs
`<> 'overdue'`), which is what makes FR-010 hold identically in the count query and the item
query without a `DISTINCT` in either (Decision 4).

`scheduled_date = @as_of_date` — equality, not `<=` — is what keeps next Tuesday's unassigned
instance out of this morning's block (User Story 2, scenario 4).

---

## Ordering

```sql
ORDER BY rank ASC,                    -- overdue before unassigned (FR-012)
         sort_key ASC NULLS LAST,     -- completion_deadline for overdue: longest late first
                                      -- scheduled_date for unassigned
         task_id ASC                  -- UUID v7 total tiebreak, so the order is deterministic
```

`completion_deadline ASC` *is* "longest late first" — the oldest deadline is the one that has
been late the longest. `NULLS LAST` matters because a `NULL` `completion_deadline` means "no
deadline, never late" and such a row cannot be in the overdue leg anyway; the clause is there
so the unassigned leg (where `scheduled_date` is non-`NULL` by its own predicate) needs no
special case.

---

## Bounds

| Bound | Value | Where enforced |
|---|---|---|
| Items per category, default | `5` | Go, `defaultTeamAttentionLimit` |
| Items per category, ceiling | `20` | Go, clamped before the query runs |
| Count cap per category | `100` | SQL, `LIMIT @count_cap` inside the counted subquery |
| Supervised project count | uncapped | Bounded by the caller's real membership rows; there is no pathological case |

`overdue_count_capped` / `unassigned_count_capped` are `count >= 100` computed in Go, exactly
as `GetEvidenceReviewQueueCount` derives `is_capped`. The client renders "99+" rather than an
exact figure when either is set (FR-014).

The count query and the item query apply the **same** predicates. That is not an optimisation
to be traded away later: FR-004 says a count the caller cannot substantiate by opening the
rows is worse than no count, and the only way to keep that true is for the two queries to
differ in nothing but their projection and their bound.

---

## Query contracts

### `CountTeamAttention :one`

Returns one row: `overdue_count int`, `unassigned_count int`, `supervised_project_count int`.
Each of the first two is `COUNT(*)` over a `LIMIT @count_cap` subquery, so its cost is
independent of the true backlog (SC-005). The third counts distinct non-archived projects
where the caller is `owner`/`admin`.

### `ListTeamAttentionItems :many`

Returns, per row: `task_id`, `project_id`, `project_name`, `title`, `attention_rank int`,
`sort_date date`, `primary_assignee_id uuid` (COALESCEd to the nil UUID),
`assignee_count int`. Built as `(overdue leg LIMIT @item_limit) UNION ALL (unassigned leg
LIMIT @item_limit)`, then ordered by the ordering above. At most `2 × item_limit` rows — 40
at the ceiling.

`primary_assignee_id` comes from a `LEFT JOIN LATERAL … ORDER BY ta.assigned_at, ta.id LIMIT 1`
and `assignee_count` from a correlated sub-select, both copied from `ListTaskPreviews`, so an
instance with three assignees still produces exactly one row.

---

## Traceability

| Requirement | Where satisfied |
|---|---|
| FR-001, FR-002 | `can_supervise` + handler permission gate; empty response, never `PERMISSION_DENIED` |
| FR-003 | One RPC, one round trip, scope resolved server-side |
| FR-004, FR-005 | Shared predicates between count and list; `organization_id` pinned everywhere |
| FR-006 | The two legs |
| FR-007 | `ps.category = 'overdue'`, no date arithmetic |
| FR-008 | `ps.is_closed = FALSE` |
| FR-009 | `NOT EXISTS` self-assignee clause in the base predicate |
| FR-010 | Mutually exclusive legs |
| FR-011 | `title`, `project_name`, `assignee_display_name` / `category = UNASSIGNED` |
| FR-012 | `ORDER BY rank, sort_key, task_id` |
| FR-013, FR-014 | `limit` 5→20, `LIMIT @count_cap`, `*_count_capped` |
| FR-016 | `supervised_project_count` |
