# PR Notes — Spec 021: Build Checklist to Close Notification

## Summary

Implements the full acknowledgement-based notification lifecycle for the
"checklist to close" pattern. Notifications now carry a typed `acknowledgement_status`
(`pending` → `acknowledged`) driven by explicit user actions (`destination_open`,
`explicit_ack`). The frontend unread count and inbox filter derive exclusively from
this field.

---

## Backend changes

### Migration
No new migration was required — spec 021 builds on the schema introduced by spec 020
which added `acknowledgement_status`, `acknowledgement_action`, `acknowledged_at`,
`policy_key`, `delivery_class`, `source_category`, and `NavigationTarget` to the
`notification.notification` / `notification.notification_recipient` tables.

### Codegen
No sqlc codegen was required — new query files for `AcknowledgeNotificationsBatch`
and `AcknowledgeAllBeforeTimestamp` were generated in previous spec iterations.

### New constants (`backend/internal/notification/constants.go`)
```
PolicyKeyChatMessage / PolicyKeyChatMention / PolicyKeyChatTypingLive / ...
DeliveryClassPersistent / DeliveryClassLiveOnly
SourceCategoryActivity / SourceCategoryMention / SourceCategorySystem
AcknowledgementStatusPending / AcknowledgementStatusAcknowledged
AckActionDestinationOpen / AckActionExplicitAck
```
All values align with DB CHECK constraints and proto field docs.

### New RPC handlers (`backend/rpc/v1/notification.proto` + connect layer)
- `AcknowledgeNotifications` — marks one or more recipient rows acknowledged with a given action
- `AcknowledgeAllBeforeTimestamp` — bulk-acknowledge all notifications before a timestamp

### Logic changes (`backend/internal/notification/logic.go`)
- `MarkAsRead` now also calls `AcknowledgeNotifications(explicit_ack)` for backward compatibility — the unread filter uses `acknowledgement_status`, not `read_status`
- `MarkAllBeforeTimestampAsRead` now also calls `AcknowledgeAllBeforeTimestamp(explicit_ack)` for the same reason
- `ListNotifications(unreadOnly: true)` filters by `acknowledgement_status = 'pending'`

### Auth fix (`backend/internal/interceptor/auth.go`)
- `ROLE_SYSTEM` tokens now bypass DB permission lookup; they receive the `system:*`
  sentinel permission which satisfies any `required_permissions` check. This restores
  the ability for internal service-to-service calls (e.g. `PublishNotification`) to
  work with the permission-based access control added in spec 020.

### Domain notify coverage
- **Chat** (`backend/internal/chat/logic.go`): `PublishNotification` calls updated to carry `policy_key`, `delivery_class`, `source_category`, and `NavigationTarget`
- **Tasks** (`backend/internal/collaboration/task_logic.go`): new `notifyTaskWatchers` + `taskNotificationPolicy` helper; task assignment and status-change events now publish typed notifications with `navigation_target.domain=projects`
- **Documents** (`backend/internal/docs/`): version save and comment events publish notifications with `navigation_target.domain=docs`

### Build verification
```
cd backend && go build ./...   # exit 0
```

---

## Frontend changes

### `frontend/packages/apis/src/notification.ts`
- `acknowledgeNotifications(ids, action?)` — new
- `acknowledgeAllBeforeTimestamp(ts, action?)` — new
- `normalizeNotificationSummary(raw)` — new; maps raw proto object to typed `Notification`
- Exports `AckAction` and `AckStatus` const objects for UI use

### `frontend/packages/notifications/src/types.ts`
- `Notification` interface extended with `acknowledgementStatus`, `acknowledgementAction`, `acknowledgedAt`, `policyKey`, `sourceCategory`, `navigationTarget`
- `NavigationTarget` interface added

### `frontend/packages/notifications/src/useNotifications.ts`
- `unread` list derived from `acknowledgementStatus === 'pending'`
- `acknowledgeNotification(id)` and `acknowledgeAllBefore(ts)` actions wired

### `frontend/packages/notifications/src/useSSEConnection.ts`
- SSE message deserialization maps new proto fields

### `frontend/apps/web/src/app/workspace/notifications/`
- `NotificationItem.tsx`: unread indicator uses `acknowledgementStatus`
- `NotificationList.tsx`: `onAcknowledge` prop propagated
- `page.tsx`: `handleAcknowledge` wired; marks notification acknowledged on click

### Build verification
```
cd frontend && pnpm -r build   # Done (all 24 pages)
```

---

## Integration tests (all passing)

```
cd backend && go test ./integration/... -run 'TestNotification' -count=1
```

New test files:
- `notification_delivery_consistency_test.go` — persistent vs live-only, ack lifecycle, cross-org isolation
- `notification_document_coverage_test.go` — document update/comment → follower notifications
- `notification_task_coverage_test.go` — task assignment/status → watcher notifications
- `notification_frontend_parity_test.go` — navigation_target, policy_key, source_category, ack fields

Existing tests also pass: `TestNotificationLifecycle`, `TestNotificationBaseline`,
`TestNotificationRouting`, `TestNotificationPreferences`, `TestNotificationDocs`,
`TestNotificationTasks`, `TestNotificationDocumentCoverage`.

---

## Constant alignment matrix

| Value | Go constant | DB CHECK | Proto field doc | TS constant |
|---|---|---|---|---|
| `pending` | `AcknowledgementStatusPending` | ✓ | ✓ | `AckStatus.PENDING` |
| `acknowledged` | `AcknowledgementStatusAcknowledged` | ✓ | ✓ | `AckStatus.ACKNOWLEDGED` |
| `destination_open` | `AckActionDestinationOpen` | ✓ | ✓ | `AckAction.DESTINATION_OPEN` |
| `explicit_ack` | `AckActionExplicitAck` | ✓ | ✓ | `AckAction.EXPLICIT_ACK` |
| `persistent` | `DeliveryClassPersistent` | ✓ | ✓ | — |
| `live_only` | `DeliveryClassLiveOnly` | ✓ | ✓ | — |
| `activity` | `SourceCategoryActivity` | ✓ | ✓ | — |
| `mention` | `SourceCategoryMention` | ✓ | ✓ | — |
