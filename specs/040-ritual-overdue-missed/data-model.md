# Phase 1 Data Model: Overdue and Missed Rituals

**No new tables. No new columns. One CHECK constraint widened.** This feature makes an
existing column authoritative rather than adding storage.

---

## Entities read

### `collaboration.task` (ritual instance rows)

Only rows with `task_kind = 'ritual_instance'` participate. The columns that matter:

| Column | Type | Role in this feature |
|---|---|---|
| `id`, `organization_id`, `project_id` | uuid | Identity and tenancy |
| `state_id` | uuid → `collaboration.project_state` | **Written** by reconciliation. Becomes the authority on lateness. |
| `task_kind` | text | Must be `ritual_instance`; standard tasks are never reconciled |
| `ritual_definition_id` | uuid → `collaboration.ritual_definition` | Resolves the grace period |
| `scheduled_date` | date | The day the ritual was for; appears in the notification body |
| `completion_deadline` | timestamptz, nullable | The lateness threshold. **NULL means never late** (FR-005) |
| `detached_from_ritual` | boolean | `TRUE` → never reconciled (FR-004) |
| `is_deleted` | boolean | `TRUE` → never reconciled |
| `due_date` | date | Set to `scheduled_date` at generation; still used for the assigned-work summary's standard-task bucketing |
| `updated_at` | timestamptz | Written with the state change; compliance uses it for on-time vs. late |

No column is added. `completion_deadline` and `state_id` already exist and are already
populated at generation time.

### `collaboration.project_state`

The per-project workflow column. `category` is the value this feature reads and writes
through.

Relevant categories, all already seeded into every project by
`DefaultRitualStates` / the mixed-project defaults in
`backend/internal/collaboration/constants.go`:

| Name | Category | `is_closed` | Meaning here |
|---|---|---|---|
| Scheduled | `scheduled` | false | Candidate for reconciliation |
| Open | `todo` | false | Candidate |
| In Progress | `in_progress` | false | Candidate |
| Submitted | `submitted` | false | **Not** a candidate — the reviewer owes the action |
| Verified | `verified` | true | Terminal; never reconciled |
| Overdue | `overdue` | false | Written by this feature; still a candidate (→ `missed`) |
| Missed | `missed` | true | Written by this feature; **terminal** (FR-003) |
| Skipped | `skipped` | true | Terminal; never reconciled |

`Missed` being `is_closed = true` is what removes a missed instance from the assigned-work
summary and every other `is_closed = FALSE` filter without a single query change.

**Validation rule**: if a project has no state row in the target category, the instance is
left in its current state and the condition is logged at WARN with the project ID and the
category (spec edge case). This is the existing `findProjectStateByCategory` returning `nil`,
which today returns silently; the log line is added.

### `collaboration.ritual_definition`

Read for exactly one field.

| Column | Role |
|---|---|
| `completion_window_hours` (int, default 24) | The grace period between `overdue` and `missed` |
| `is_archived` | **Deliberately not filtered on.** An instance outlives its definition's archival (FR-009) |

### `collaboration.evidence_requirement` / `collaboration.evidence_submission`

Read through the existing `loadTaskEvidenceSnapshot`, unchanged. The snapshot's
`requiredCount`, `requiredSubmittedCount`, `requiredApprovedCount`, `requiredRejectedCount`
and `progress.SubmittedCount` are the inputs to the precedence table below.

### `collaboration.task_assignee`

| `role` | Notified |
|---|---|
| `assignee` | Overdue and missed |
| `reviewer` | Overdue and missed |
| `approver` | Overdue and missed (treated as a reviewer — spec assumption) |

### `collaboration.project_membership`

Read only when an instance transitions to `missed` and has no `reviewer` or `approver`.
Members with `role IN ('owner','admin')` receive the missed notification (FR-016).

---

## The state transition

### Precedence table

`determineRitualTaskStateCategory(task, snapshot, graceWindow, now) → category`

| # | Condition | Result |
|---|---|---|
| 1 | `snapshot.progress.AllRequiredApproved` | `verified` |
| 2 | `requiredCount > 0 && requiredSubmittedCount == requiredCount && requiredRejectedCount == 0` | `submitted` |
| 3 | `completion_deadline` valid **and** `now > completion_deadline + graceWindow` | `missed` |
| 4 | `completion_deadline` valid **and** `now > completion_deadline` | `overdue` |
| 5 | `snapshot.progress.SubmittedCount > 0` | `in_progress` |
| 6 | `scheduled_date` is after today (in the instance's stored terms) | `scheduled` |
| 7 | — | `todo` |

Rows 3 and 4 are new. Row 5 moved *below* them; that single reordering is FR-006.

`graceWindow` is `time.Duration(definition.CompletionWindowHours) * time.Hour`. When the
definition cannot be loaded, `graceWindow` is treated as infinite: row 3 cannot fire, row 4
still can.

### Legal transitions

```
                     ┌─────────────┐
  scheduled ────────►│             │
  todo ─────────────►│   overdue   │────────► missed  (terminal)
  in_progress ──────►│             │
                     └─────────────┘
        │                   │
        │                   └──────► verified | submitted | in_progress
        │                            (evidence arrives; the ordinary path)
        └──────────────────────────► missed
                                     (deadline + grace already elapsed
                                      when first evaluated — one step)
```

**Guards, all pre-existing except the last:**

- `task_kind != 'ritual_instance'` → no-op
- `detached_from_ritual` → no-op
- current category ∈ {`verified`, `missed`, `skipped`} → no-op (**`missed` is terminal**)
- target category == current category → no-op, **no write, no notification** (FR-010, FR-020)
- target state row absent in the project → no-op, logged at WARN

### Idempotency

The transition is a pure function of stored row state plus `now`. Two overlapping passes both
read the same `state_id`; whichever writes second finds `target == current` and does nothing.
No advisory lock, no `processed_at` marker, no dedup table (FR-010).

---

## Reconciliation pass (not persisted)

The pass is a job, not an entity. It holds no state between runs — its "cursor" is the state
column of the instances themselves.

**Per-run output** (FR-012):

| Field | Meaning |
|---|---|
| `OrganizationsProcessed` | Organizations the pass attempted |
| `InstancesExamined` | Candidate instances loaded and evaluated |
| `MarkedOverdue` | Transitions into `overdue` |
| `MarkedMissed` | Transitions into `missed` |

Emitted as one structured log line per pass and returned from `Sweep` so integration tests can
assert on it. A pass that examined 40 instances and moved 0 is distinguishable from one that
found nothing to examine.

**Bounds**: at most 500 candidate instances per organization per pass, oldest deadline first
(FR-013, research R6).

**Failure isolation** (FR-011): an error listing or reconciling one organization is logged
with its ID and the loop continues; an error on one instance is logged with its ID and the
organization's remaining instances are still reconciled.

---

## Notification records

Rows in `notification.notification`, written by the existing publisher. Nothing about the
table changes except the widened CHECK.

| Field | `ritual_instance_overdue` | `ritual_instance_missed` |
|---|---|---|
| `notification_type` | `ritual_instance_overdue` | `ritual_instance_missed` |
| `source_domain` | `projects` | `projects` |
| `priority` | 2 (ordinary) | 2 (ordinary) |
| `policy_key` | `task_status` | `task_status` |
| `delivery_class` | `persistent` | `persistent` |
| `source_category` | `activity` | `activity` |
| Title | `Ritual overdue` | `Ritual missed` |
| Message | names the ritual, its scheduled date and how late it is | names the ritual and its scheduled date |
| `action_data` | `taskId`, `projectId`, `deepLink`, `focusIntent=submit_requirement` | `taskId`, `projectId`, `deepLink`, `focusIntent=view_instance` |
| `navigation_target` | domain `projects`, type `task`, id = task id | same |

**Suppressed** when `completion_deadline` is more than 7 days before `now` (FR-021). The state
transition still occurs.

### Constraint change

`notification.notification.notification_type` CHECK gains `ritual_instance_overdue` and
`ritual_instance_missed`. It does **not** regain `ritual_instance_assigned`, which has no
producer.

`backend/internal/notification/constants.go` must gain the same two values in the const block,
`IsValidNotificationType` and `AllNotificationTypes`;
`TestNotificationTypeCheckMatchesGoConstants` fails the build if the two sides disagree
(FR-019).

---

## Client-side type changes

| File | Change |
|---|---|
| `frontend/packages/apis/src/notification.ts` | `NotificationType` union: remove `'ritual_instance_assigned'`; `'ritual_instance_overdue'` and `'ritual_instance_missed'` stay |
| `frontend/packages/notifications/src/utils.ts` | Remove the `ritual_instance_assigned` icon and label entries; `⏰ Ritual overdue` and `⚠️ Ritual missed` already exist |
| `frontend/packages/apis/src/collaboration-ritual.ts` | `RitualWorklistBuckets` gains `missed: RitualInstanceTask[]`; `classifyRitualTaskBucket` / `groupRitualWorklistBuckets` take `states: ProjectState[]` |
