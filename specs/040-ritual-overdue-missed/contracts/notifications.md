# Contract: Overdue and Missed Notifications

Two notification types are restored to the system. They are published by
`internal/collaboration` through the `NotificationPublisher` interface it already holds; no
notification table is touched directly and no new publisher path is introduced.

---

## Type declarations — three places, one change set (FR-019)

### 1. Database

`backend/database/migrations/20260903000001_ritual_overdue_missed_notification_types.up.sql`
drops and re-adds `notification_notification_type_valid` with two values added:

```
'ritual_instance_overdue',
'ritual_instance_missed',
```

`ritual_instance_assigned` is **not** re-added — it has no producer, having been replaced by
the `ritual_instances_scheduled` summary.

Then: `backend/scripts/regen-schema.sh` regenerates
`backend/database/scripts/schema.sql` (generated file, never hand-edited).

### 2. Go

`backend/internal/notification/constants.go` — the two constants appear in **all three**
places or the alignment test fails:

```go
// Published by internal/collaboration when the reconciliation sweep moves a ritual
// instance past its completion deadline, and one completion window later when it
// gives up on the instance entirely.
NotificationTypeRitualInstanceOverdue = "ritual_instance_overdue"
NotificationTypeRitualInstanceMissed  = "ritual_instance_missed"
```

plus a `case` in `IsValidNotificationType` and an entry in `AllNotificationTypes()`.

`backend/internal/collaboration/constants.go` gains the two aliases beside
`NotificationTypeRitualInstancesScheduled`.

### 3. TypeScript

`frontend/packages/apis/src/notification.ts` — the `NotificationType` union keeps
`'ritual_instance_overdue'` and `'ritual_instance_missed'` and **loses**
`'ritual_instance_assigned'`.

`frontend/packages/notifications/src/utils.ts` — the icon map (`⏰`, `⚠️`) and label map
(`Ritual overdue`, `Ritual missed`) already carry both types; only the
`ritual_instance_assigned` rows are removed.

**Enforcement**: `TestNotificationTypeCheckMatchesGoConstants`
(`backend/integration/notification_type_alignment_test.go`) fails if the Go list and the
database CHECK disagree. It needs no modification — it is the guard FR-019 asks for.

---

## Publication

`backend/internal/collaboration/ritual_notification_logic.go` gains two functions beside the
existing `notifyRitualInstancesScheduled`:

```go
func (l *logicImpl) notifyRitualInstanceOverdue(
    ctx context.Context, tx database.DBTX,
    orgID dbuuid.UUID, task *database.CollaborationTask,
    ritualName string, now time.Time,
)

func (l *logicImpl) notifyRitualInstanceMissed(
    ctx context.Context, tx database.DBTX,
    orgID dbuuid.UUID, task *database.CollaborationTask,
    ritualName string, now time.Time,
)
```

Both are called from `reconcileRitualTaskStateForTask`, **only** on a transition this feature
performed, and only when the current category differs from the target (FR-020). Both are
no-ops when `l.NotificationPublisher == nil` and log at WARN on publish failure without
failing the transition — the state change is the more important of the two, and the pattern
matches every other notifier in the file.

### Recipients

| | `ritual_instance_overdue` | `ritual_instance_missed` |
|---|---|---|
| Task assignees (`role = 'assignee'`) | ✅ | ✅ |
| Task reviewers (`role = 'reviewer'`) | ✅ | ✅ |
| Task approvers (`role = 'approver'`) | ✅ | ✅ |
| Project `owner` and `admin` members | ❌ | ✅ **only when the task has no reviewer and no approver** (FR-016) |

Deduplicated by employee ID with the existing `appendUniqueRecipient` helper, so a person who
is both assignee and reviewer receives one notification, not two (FR-014, FR-015: "each be
notified **once**").

An instance with no assignee and no reviewer produces no overdue notification — there is
nobody to tell — but its `missed` transition still escalates to owners and admins, which is
what closes the "unassigned ritual failing silently" hole.

### Envelope

| Field | Value |
|---|---|
| `SourceDomain` | `notification.SourceDomainProjects` |
| `Priority` | `2` — ordinary. **Not** the always-deliver priority reserved for mentions and incoming calls (FR-018) |
| `PolicyKey` | `notification.PolicyKeyTaskStatus` — these are workflow state transitions; already permitted by `notification_policy_key_valid`, so no policy migration |
| `DeliveryClass` | `notification.DeliveryClassPersistent` |
| `SourceCategory` | `notification.SourceCategoryActivity` |

Because publication goes through the ordinary pipeline at ordinary priority, do-not-disturb
windows, domain mute and presence rules apply with **no special case written anywhere** — the
"correct by construction" property Story 4 asks for.

### Body

Generated server-side in the existing style; no template system, no per-organization
customisation.

| | Title | Message |
|---|---|---|
| Overdue | `Ritual overdue` | `"{ritual name}" for {scheduled date} is {n} hours overdue` (`is overdue by less than an hour` under 1h; `{n} days overdue` at 48h and beyond) |
| Missed | `Ritual missed` | `"{ritual name}" for {scheduled date} was missed — no evidence was submitted` |

`{ritual name}` is the ritual definition's `name`, falling back to the task title if the
definition cannot be loaded. `{scheduled date}` is the instance's `scheduled_date`.

### Navigation payload (FR-017)

```go
ActionData: map[string]string{
    "taskId":      taskID,
    "projectId":   projectID,
    "deepLink":    fmt.Sprintf("tasks/%s/%s", projectID, taskID),
    "focusIntent": focusIntent, // "submit_requirement" for overdue, "view_instance" for missed
},
NavigationTarget: &rpcv1.NavigationTarget{
    Domain:       notification.SourceDomainProjects,
    ResourceType: "task",
    ResourceId:   taskID,
},
```

This is the identical shape `notifyEvidenceSubmitted` uses, so both clients' existing deep-link
resolvers already handle it once the type is mapped to a focus intent.

**Overdue opens with `submit_requirement`** because the recipient can still recover the work —
that recoverability is the point of alerting early. **Missed opens with `view_instance`**
because the state is terminal and there is nothing to submit.

### Suppression (FR-021)

When `now - task.completion_deadline > ritualReconciliationBackfillHorizon` (7 days), the
state transition is performed and **no notification is published**. The check is against the
stored deadline, not against elapsed wall-clock since the state change, so it is deterministic
and a repeated pass cannot change the answer.

A single `slog.InfoContext` line records the suppression count per pass, so a silent first
deployment is distinguishable from a broken one.

---

## Client resolution (FR-023)

### Web — `frontend/apps/web/src/app/workspace/notifications/utils/notificationNavigation.ts`

`mapNotificationTypeToFocusIntent` gains:

```ts
case 'ritual_instance_overdue':
    return RITUAL_FOCUS_INTENT_SUBMIT_REQUIREMENT;
case 'ritual_instance_missed':
    return RITUAL_FOCUS_INTENT_VIEW_INSTANCE;
```

and drops the dead `'ritual_instance_assigned'` case.

### Mobile — `frontend/apps/mobile/src/lib/linking.ts`

`focusIntentFromNotificationType` gains the same two cases and drops the same dead one.

Both clients already route a `projects` / `task` navigation target and a
`tasks/{projectId}/{taskId}` deep link to the ritual instance screen, so no route change is
needed — only the type-to-intent mapping.
