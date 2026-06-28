# Quickstart: Unified Notification Routing

## Test-First Strategy

Per user directive: **integration tests must be in place FIRST** to lock down current working behavior before any refactoring. This quickstart organizes scenarios into two phases:

1. **Baseline Tests** — capture and lock current behavior (run BEFORE any code changes)
2. **Feature Tests** — validate new unified routing behavior (run AFTER implementation)

## Prerequisites

```bash
cd backend
docker compose up -d  # PostgreSQL + test infrastructure
go test ./integration/ -run TestNotificationBaseline -v  # Phase 1
```

---

## Phase 1: Baseline Integration Tests (BEFORE changes)

These tests document and lock the CURRENT behavior. They must all pass before any code is modified.

### BL-01: Chat Notification Preference Filtering

**Scenario**: Verify chat respects channel_membership.notification_preference at SQL level.

```
GIVEN organization with 3 employees (Alice, Bob, Charlie)
  AND a chat channel where:
    - Alice has notification_preference = 'all'
    - Bob has notification_preference = 'mentions'
    - Charlie has notification_preference = 'muted'
WHEN Alice sends a regular message (no mentions)
THEN Bob and Charlie do NOT receive a notification
  AND Alice does NOT receive her own notification
  AND only members with preference='all' (minus sender) receive notification

WHEN Alice sends a message mentioning Bob
THEN Bob receives a notification (preference='mentions' + is_mention=true)
  AND Charlie does NOT receive (muted overrides everything)
```

### BL-02: Task Watcher Notification Delivery

**Scenario**: Verify task watchers receive notifications (current behavior: no preference filtering).

```
GIVEN organization with 3 employees (Alice, Bob, Charlie)
  AND a project with a task
  AND Alice and Bob are watching the task
  AND Charlie is NOT watching
WHEN a comment is added to the task (by someone else)
THEN Alice and Bob both receive notifications
  AND Charlie does NOT receive a notification
  AND the actor (commenter) does NOT receive their own notification
```

### BL-03: Task Watch/Unwatch Lifecycle

**Scenario**: Verify watch and unwatch operations work correctly.

```
GIVEN organization with employee Alice
  AND a project with a task
WHEN Alice watches the task
THEN Alice appears in task watcher list

WHEN Alice unwatches the task
THEN Alice no longer appears in task watcher list

WHEN Alice watches again
THEN Alice appears in watcher list (re-watch works)
```

### BL-04: Document Follow/Unfollow Lifecycle

**Scenario**: Verify follow and unfollow operations work correctly.

```
GIVEN organization with employee Alice
  AND a document
WHEN Alice follows the document
THEN Alice appears in document followers list
  AND IsFollowing returns true for Alice

WHEN Alice unfollows the document
THEN Alice no longer appears in followers list
  AND IsFollowing returns false

WHEN Alice follows again
THEN Alice reappears in followers list
```

### BL-05: Notification Routing with Presence

**Scenario**: Verify presence-based routing decisions.

```
GIVEN employee Alice with a notification to deliver
WHEN Alice is online
THEN notification is delivered via SSE
  AND push notification is NOT sent (priority 1)

WHEN Alice is offline
THEN push notification IS sent (priority 1)

WHEN Alice is online_hidden
THEN push notification IS sent (hidden treated as offline for push)

WHEN notification has priority 0 (always)
THEN push notification IS sent regardless of online status

WHEN notification has priority 4 (ephemeral)
THEN push notification is NEVER sent
  AND notification is NOT persisted to database
```

### BL-06: Notification Lifecycle

**Scenario**: Verify publish → list → mark-read → delete cycle.

```
GIVEN organization with employee Alice
WHEN a notification is published to Alice
THEN Alice can list notifications and see it (unread)
  AND unread count is incremented

WHEN Alice marks the notification as read
THEN notification shows read_status = true
  AND unread count is decremented

WHEN Alice deletes the notification
THEN notification no longer appears in list
```

### BL-07: Multi-Tenant Notification Isolation

**Scenario**: Verify notifications don't leak across organizations.

```
GIVEN organization_A with employee Alice
  AND organization_B with employee Bob
WHEN a notification is published in org_A
THEN Alice can see it
  AND Bob CANNOT see it (different organization)

WHEN a notification is published in org_B
THEN Bob can see it
  AND Alice CANNOT see it
```

### BL-08: Document Notifications Currently Absent

**Scenario**: Verify that docs currently produce NO notifications (documenting the gap).

```
GIVEN organization with employees Alice and Bob
  AND a document followed by both
WHEN Alice saves a new version of the document
THEN NO notifications are published (current behavior — docs has no notification publisher)

WHEN Alice adds a comment to the document
THEN NO notifications are published (current behavior)
```

---

## Phase 2: Feature Integration Tests (AFTER implementation)

These tests validate the new unified notification routing behavior.

### FT-01: Task Notification Preference Enforcement

**Scenario**: project_membership.notification_preference is now enforced.

```
GIVEN organization with employees Alice, Bob, Charlie
  AND a project where:
    - Alice has notification_preference = 'all'
    - Bob has notification_preference = 'mentions'
    - Charlie has notification_preference = 'muted'
  AND all three are watching a task in that project
WHEN a comment is added to the task (no mentions)
THEN Alice receives notification
  AND Bob does NOT receive (mentions-only, no mention)
  AND Charlie does NOT receive (muted)

WHEN a comment mentions Bob
THEN Alice receives notification (preference='all')
  AND Bob receives notification (preference='mentions' + is_mention)
  AND Charlie does NOT receive (muted overrides mention)
```

### FT-02: Task Notification Type Enrichment

**Scenario**: Task notifications use specific types instead of generic 'message'.

```
GIVEN a watched task
WHEN the task is assigned to a user
THEN notification has notification_type = 'task_assigned' and priority = 0

WHEN a comment is added
THEN notification has notification_type = 'task_commented' and priority = 1

WHEN task status changes
THEN notification has notification_type = 'task_status_changed' and priority = 1

WHEN a user is mentioned in a comment
THEN notification has notification_type = 'task_mentioned' and priority = 0
```

### FT-03: Auto-Watch on Task Mention

**Scenario**: Mentioned users automatically become watchers.

```
GIVEN a task that Alice is NOT watching
WHEN a comment is posted mentioning Alice
THEN Alice becomes a watcher with watch_reason = 'mentioned'
  AND Alice receives a 'task_mentioned' notification
```

### FT-04: Auto-Watch on Task Comment

**Scenario**: Commenters automatically become watchers.

```
GIVEN a task that Alice is NOT watching
WHEN Alice posts a comment on the task
THEN Alice becomes a watcher with watch_reason = 'commented'
```

### FT-05: Document Notification — Version Save

**Scenario**: Document followers receive notifications on version save.

```
GIVEN a document followed by Alice (preference='all') and Bob (preference='mentions')
WHEN Charlie saves a new version
THEN Alice receives notification with type='doc_updated', priority=2
  AND Bob does NOT receive (preference='mentions', not a mention)
  AND Charlie does NOT receive (actor excluded)
```

### FT-06: Document Notification — Comment

**Scenario**: Document followers receive notifications on comment.

```
GIVEN a document followed by Alice (preference='all') and Bob (preference='mentions')
WHEN Charlie adds a comment (no mentions)
THEN Alice receives notification with type='doc_commented', priority=1
  AND Bob does NOT receive (preference='mentions', not a mention)
```

### FT-07: Document Notification — Mention in Comment

**Scenario**: @mention in doc comment triggers notification + auto-follow.

```
GIVEN a document followed by Alice (preference='all')
  AND Bob is NOT following the document
WHEN Charlie posts a comment mentioning Bob
THEN Alice receives 'doc_commented' notification
  AND Bob receives 'doc_mentioned' notification (priority=0)
  AND Bob is now auto-following the document with preference='all'
```

### FT-08: Document Auto-Follow on Create

**Scenario**: Document creator automatically follows their document.

```
GIVEN employee Alice
WHEN Alice creates a new document
THEN Alice is automatically a follower of that document
  AND Alice does NOT receive a notification for her own creation
```

### FT-09: Muted Follower/Watcher Suppression

**Scenario**: Muted preference suppresses all notifications.

```
GIVEN Alice follows a document with notification_preference = 'muted'
WHEN any event occurs on the document (version save, comment, mention)
THEN Alice receives NO notifications
  AND Alice remains in followers list (mute ≠ unfollow)
```

### FT-10: Global DND Suppresses Push Only

**Scenario**: DND mode suppresses push but not SSE.

```
GIVEN Alice has dnd_enabled=true, dnd_start=22:00, dnd_end=08:00
  AND current time is within DND window
WHEN a notification is published to Alice
THEN notification IS delivered via SSE (real-time UI update)
  AND push notification is NOT sent
  AND notification IS persisted to database
```

### FT-11: Global Domain Mute

**Scenario**: Domain-level mute suppresses push for an entire domain.

```
GIVEN Alice has muted_domains = ['projects']
WHEN a task notification is published (source_domain='projects')
THEN push notification is NOT sent to Alice
  AND SSE IS delivered
  AND notification IS persisted

WHEN a chat notification is published (source_domain='chat')
THEN push notification IS sent normally (chat not in muted_domains)
```

### FT-12: Critical Priority Bypasses Mute/DND

**Scenario**: Priority 0 (always) bypasses domain mute and DND.

```
GIVEN Alice has muted_domains = ['projects'] AND dnd_enabled=true (in DND window)
WHEN a task_assigned notification (priority=0) is published
THEN push notification IS sent (priority 0 bypasses mute and DND)
  AND SSE IS delivered
```

### FT-13: Deduplication — Watcher + Mention

**Scenario**: User who is both watcher and mentioned gets one notification.

```
GIVEN Alice is watching a task
WHEN a comment is posted mentioning Alice
THEN Alice receives exactly ONE notification (not two)
  AND the notification type is 'task_mentioned' (higher priority type wins)
```

### FT-14: Notification Constant Validation

**Scenario**: Backend constants match database CHECK constraints.

```
WHEN listing all notification type constants defined in code
THEN every constant value is accepted by the database CHECK constraint
  AND every value in the CHECK constraint has a matching constant
```

### FT-15: Chat Behavior Unchanged

**Scenario**: Verify chat notification behavior is completely unchanged after refactoring.

```
-- Re-run all BL-01 scenarios --
THEN all baseline chat tests still pass with identical behavior
```

---

## Test Execution Commands

```bash
# Phase 1: Baseline tests (run BEFORE any changes)
cd backend
go test ./integration/ -run "TestNotificationBaseline" -v -count=1

# Phase 2: Feature tests (run AFTER implementation)
go test ./integration/ -run "TestNotificationUnified" -v -count=1

# All notification tests
go test ./integration/ -run "TestNotification" -v -count=1

# Full integration suite (verify nothing broken)
go test ./integration/ -v -count=1
```

## Validation Checklist

- [ ] All BL-* baseline tests pass BEFORE any code changes
- [ ] All BL-* baseline tests STILL pass AFTER code changes (regression check)
- [ ] All FT-* feature tests pass after implementation
- [ ] Multi-tenancy isolation verified (BL-07 + cross-check FT-* with multi-org)
- [ ] No notification type constant drift (FT-14)
- [ ] Chat behavior unchanged (FT-15 re-runs BL-01)
