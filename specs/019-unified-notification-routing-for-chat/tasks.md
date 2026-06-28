# Tasks: Unified Notification Routing for Chat, Documents, and Tasks

**Input**: Design documents from `/specs/019-unified-notification-routing-for-chat/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/, quickstart.md

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Phase 3.1: Baseline Integration Tests (TEST-FIRST — lock current behavior)

Write integration tests that capture and lock the CURRENT working behavior BEFORE any code changes.
These tests document the existing contract and will catch regressions during refactoring.

- [x] T001 [P] Write baseline test for chat notification preference filtering in `backend/integration/notification_baseline_test.go`
  - Test function: `TestNotificationBaseline` with nested scenarios
  - Scenario BL-01: Create org with 3 employees, create channel, set preferences (all/mentions/muted)
  - Verify regular message only reaches preference='all' members (minus sender)
  - Verify mention message reaches preference='mentions' members
  - Verify muted members never receive notifications
  - Use helpers: `w.createChannel()`, `w.sendMessage()`, `w.sendMentionMessage()`, `w.listNotifications()`
  - Reference: quickstart.md BL-01

- [x] T002 [P] Write baseline test for task watcher notification delivery in `backend/integration/notification_baseline_test.go`
  - Scenario BL-02 inside same `TestNotificationBaseline` function
  - Create project + task, add watchers (Alice, Bob), Charlie not watching
  - Add a comment via task channel, verify Alice and Bob get notifications, Charlie does not
  - Verify the actor (commenter) does NOT receive their own notification
  - Document current behavior: NO preference filtering on task watchers
  - Use helpers: `w.createProject()`, `w.createTask()`, `w.watchTask()`, `w.sendMessage()`, `w.listNotifications()`

- [x] T003 [P] Write baseline test for task watch/unwatch lifecycle in `backend/integration/notification_baseline_test.go`
  - Scenario BL-03: Watch → appears in list, Unwatch → disappears, Re-watch → reappears
  - Use helpers: `w.watchTask()`, `w.unwatchTask()`
  - Note: No dedicated "list watchers" RPC exposed — verify via notification delivery behavior

- [x] T004 [P] Write baseline test for document follow/unfollow lifecycle in `backend/integration/notification_baseline_test.go`
  - Scenario BL-04: Follow → appears in followed list, Unfollow → disappears, Re-follow → reappears
  - Use helpers: `w.createDocument()`, `w.followDocument()`, `w.unfollowDocument()`, `w.listFollowedDocuments()`

- [x] T005 [P] Write baseline test for notification routing with presence in `backend/integration/notification_baseline_test.go`
  - Scenario BL-05: Verify presence status values are correctly stored and retrievable
  - Test online, offline, online_hidden, idle statuses
  - Verify active_channel_id tracking for context-aware suppression
  - Use helpers: `w.updatePresence()`, `w.getPresence()`, `w.updatePresenceWithChannel()`
  - Note: Push notification delivery is internal — test presence state, not push delivery directly

- [x] T006 [P] Write baseline test for notification lifecycle in `backend/integration/notification_baseline_test.go`
  - Scenario BL-06: Publish → list (unread) → mark-read → list (read) → delete → gone
  - Verify unread count increments/decrements correctly
  - Use helpers: `w.publishNotification()`, `w.listNotifications()`, `w.getUnreadCount()`, `w.markAsRead()`, `w.deleteNotification()`

- [x] T007 [P] Write baseline test for multi-tenant notification isolation in `backend/integration/notification_baseline_test.go`
  - Scenario BL-07: Two orgs, publish in org_A → only org_A employee sees it
  - Use helpers: `w.withUsersFromDifferentOrgs()`, `w.publishNotification()`, `w.listNotifications()`

- [x] T008 [P] Write baseline test documenting absent document notifications in `backend/integration/notification_baseline_test.go`
  - Scenario BL-08: Create document, have followers, save version, add comment
  - Verify NO notifications are published (documents currently don't produce notifications)
  - This test documents the gap and will be updated in Phase 3.5 to expect notifications

**Checkpoint**: Run `cd backend && go test ./integration/ -run TestNotificationBaseline -v -count=1` — ALL baseline tests must pass before proceeding.

## Phase 3.2: Schema Changes & Codegen

- [x] T009 Add `notification.personal_preference` table to `backend/database/scripts/schema.sql`
  - DDL from data-model.md: organization_id, employee_id, dnd_enabled, dnd_start, dnd_end, muted_domains
  - Composite PK (organization_id, employee_id) for Citus compliance
  - FK to organization.employee(organization_id, id)
  - CHECK constraint: muted_domains <@ ARRAY['chat','projects','docs','crm','hr','support','finance','system']
  - Add table and column COMMENTs

- [x] T010 Add `notification_preference` column to `docs.document_follower` in `backend/database/scripts/schema.sql`
  - `notification_preference text NOT NULL DEFAULT 'all'`
  - CHECK constraint: `notification_preference IN ('all', 'mentions', 'muted')`
  - Add column COMMENT
  - Depends on: T009 (same file)

- [x] T011 Update notification_type CHECK constraint on `notification.notification` in `backend/database/scripts/schema.sql`
  - Add new types: `task_assigned`, `task_status_changed`, `task_commented`, `task_mentioned`, `doc_updated`, `doc_commented`, `doc_mentioned`
  - Keep existing types: `message`, `mention`, `reply`, `typing`, `reaction`
  - Depends on: T010 (same file)

- [x] T012 Author up migration in `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_add_unified_notification_preferences.up.sql`
  - Content from data-model.md Up Migration section
  - Three changes in order: CREATE TABLE, ALTER TABLE ADD COLUMN, DROP+ADD CONSTRAINT
  - Depends on: T011

- [x] T013 Author down migration in `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_add_unified_notification_preferences.down.sql`
  - Reverse order: DROP CONSTRAINT+ADD original, DROP COLUMN, DROP TABLE
  - Content from data-model.md Down Migration section
  - Depends on: T012 (same timestamp prefix)

- [x] T014 Apply migrations locally and regenerate sqlc
  - Run: `cd backend && ./scripts/migrate.sh`
  - If dirty state: `migrate force <version>`
  - Run: `cd backend && sqlc generate`
  - Verify generated models include new table and column
  - Commit generated outputs
  - Depends on: T013

- [x] T015 [P] Add new sqlc queries to `backend/database/scripts/notification.query.sql`
  - `GetPersonalPreference` — fetch by org_id + employee_id
  - `UpsertPersonalPreference` — INSERT ON CONFLICT UPDATE
  - `DeletePersonalPreference` — DELETE by org_id + employee_id
  - `GetEmployeesMutedForDomain` — employees with domain in muted_domains array
  - `GetEmployeesInDND` — employees in DND window (dnd_enabled + time BETWEEN)
  - SQL from contracts/notification.query.sql

- [x] T016 [P] Add new sqlc queries to `backend/database/scripts/docs.query.sql`
  - `GetDocumentFollowersForNotification` — followers filtered by preference (matches chat pattern)
  - `UpdateDocumentFollowerPreference` — update preference by org_id + doc_id + employee_id
  - SQL from contracts/notification.query.sql

- [x] T017 [P] Add new sqlc query to `backend/database/scripts/collaboration.query.sql`
  - `ListTaskWatchersForNotification` — watchers joined with project_membership for preference filtering
  - LEFT JOIN task → project_membership, COALESCE preference to 'all'
  - SQL from contracts/notification.query.sql

- [x] T018 Run `cd backend && sqlc generate` after query additions
  - Verify generated Go code compiles: `cd backend && go build ./...`
  - Commit generated outputs
  - Depends on: T015, T016, T017

## Phase 3.3: Backend Constant & Type Updates

- [x] T019 [P] Add new notification type constants to `backend/internal/notification/constants.go`
  - Add constants: `NotificationTypeTaskAssigned`, `NotificationTypeTaskStatusChanged`, `NotificationTypeTaskCommented`, `NotificationTypeTaskMentioned`, `NotificationTypeDocUpdated`, `NotificationTypeDocCommented`, `NotificationTypeDocMentioned`
  - Add `SourceDomainDocs = "docs"` if not present
  - Update `IsValidNotificationType()` to include new types
  - Priority mapping constants or comments for each new type

- [x] T020 [P] Add new task notification type constants to `backend/internal/collaboration/constants.go`
  - Add: `NotificationTypeTaskAssigned = "task_assigned"`, etc. (referencing notification constants)
  - OR import from notification package if that's the pattern
  - These may just reference `notification.NotificationTypeTaskAssigned` directly

## Phase 3.4: Core Logic — Notification Infrastructure

- [x] T021 Implement preference filtering helper in `backend/internal/notification/publisher.go`
  - Add `FilterRecipientsByPreference()` or similar function
  - Input: list of candidate recipients with their preference, notification type, is_mention flag
  - Output: filtered list of recipients who should receive the notification
  - Logic: preference='all' → always include; preference='mentions' → include only if is_mention; preference='muted' → exclude; preference='assigned' → include only if watch_reason='assigned'
  - This is a pure function — no DB calls, just filtering logic
  - Depends on: T019

- [x] T022 Add DND/domain-mute checks to `backend/internal/notification/routing_logic.go`
  - Modify `ShouldSendPush()` or add new function `ShouldSuppressPush()`
  - If priority == 0 (always): bypass DND and domain mute
  - If employee is in DND window: suppress push (SSE still delivered)
  - If source_domain is in employee's muted_domains: suppress push (SSE still delivered)
  - These checks require DB queries — accept `database.DBTX` parameter
  - Depends on: T021, T015 (queries must exist)

## Phase 3.5: Core Logic — Domain Changes

- [x] T023 Wire `NotificationPublisher` into docs service in `backend/cmd/server.go`
  - Change: `docsLogic := docs.NewDocumentLogic(queries)` → `docsLogic := docs.NewDocumentLogic(queries, notificationLogic)`
  - Update all call sites of `NewDocumentLogic` if any others exist
  - Depends on: T024

- [x] T024 Add `NotificationPublisher` dependency to docs logic in `backend/internal/docs/logic.go`
  - Add field to `documentLogicImpl` struct: notification publisher interface (same as chat/collaboration use)
  - Update `NewDocumentLogic()` constructor to accept and store the publisher
  - Import notification package for the interface type
  - Depends on: T021

- [x] T025 Enforce `project_membership.notification_preference` in `notifyTaskWatchers()` in `backend/internal/collaboration/task_logic.go`
  - Replace current `ListTaskWatchers` call with new `ListTaskWatchersForNotification` query
  - Pass `is_mention` parameter based on notification type
  - Apply preference filtering from the query result
  - Existing behavior: sends to ALL watchers → New: respects project-level preference
  - Depends on: T018, T021

- [x] T026 Add auto-watch on mention in task comments in `backend/internal/collaboration/task_logic.go`
  - When a comment mentions a user (TipTap mention node parsing)
  - Call `createTaskWatcher()` with `watch_reason = 'mentioned'`
  - UPSERT ensures no error if already watching
  - Wire `TaskWatchReasonMentioned` constant (already defined but unused)
  - Depends on: T025

- [x] T027 Add auto-watch on comment in task logic in `backend/internal/collaboration/task_logic.go`
  - When a user posts a comment on a task
  - Call `createTaskWatcher()` with `watch_reason = 'commented'`
  - Wire `TaskWatchReasonCommented` constant (already defined but unused)
  - Depends on: T026 (same file, sequential)

- [x] T028 Enrich task notification types in `backend/internal/collaboration/task_logic.go`
  - Task assigned → `notification_type = 'task_assigned'`, priority = 0
  - Task comment → `notification_type = 'task_commented'`, priority = 1
  - Task status changed → `notification_type = 'task_status_changed'`, priority = 1
  - Task mention → `notification_type = 'task_mentioned'`, priority = 0
  - Replace current generic `notification_type = 'message'` with specific types
  - Depends on: T027 (same file, sequential)

- [x] T029 Implement document auto-follow on create in `backend/internal/docs/follower_logic.go`
  - After `CreateDocument()`: auto-call `FollowDocument()` for the creator
  - Creator follows with default preference='all'
  - Verify no notification is sent for own creation (actor exclusion)
  - Depends on: T024

- [x] T030 Implement document notification publishing for version save in `backend/internal/docs/follower_logic.go` or `backend/internal/docs/logic.go`
  - After version save (UpdateDocument or similar): get followers via `GetDocumentFollowersForNotification(is_mention=false)`
  - Exclude the actor (saver)
  - Publish notification with type='doc_updated', priority=2, source_domain='docs'
  - Depends on: T029

- [x] T031 Implement document notification publishing for comments in `backend/internal/docs/comment_logic.go`
  - After comment creation: get followers via `GetDocumentFollowersForNotification(is_mention=false)`
  - Exclude the actor (commenter)
  - Publish notification with type='doc_commented', priority=1, source_domain='docs'
  - Parse TipTap mentions in comment → publish 'doc_mentioned' (priority=0) to mentioned users
  - Auto-follow mentioned users (via `FollowDocument()`)
  - Depends on: T030

- [x] T032 Implement document auto-follow on comment in `backend/internal/docs/comment_logic.go`
  - When a user comments on a document they're not following → auto-follow with preference='all'
  - Use existing `FollowDocument()` which handles UPSERT
  - Depends on: T031 (same file, sequential)

- [x] T033 [P] Add global personal preference CRUD logic in `backend/internal/notification/` (new file or extend existing)
  - `GetPersonalPreference(ctx, tx, orgID, employeeID)` → returns preference or nil
  - `UpsertPersonalPreference(ctx, tx, orgID, employeeID, params)` → create/update
  - `DeletePersonalPreference(ctx, tx, orgID, employeeID)` → remove
  - Thin wrappers around sqlc-generated queries
  - Depends on: T018

## Phase 3.6: Feature Integration Tests (validate new behavior)

- [x] T034 [P] Write test for task notification preference enforcement in `backend/integration/notification_preference_test.go`
  - Test function: `TestNotificationPreferenceEnforcement`
  - Scenario FT-01: 3 employees with different project preferences (all/mentions/muted), all watching a task
  - Comment without mention → preference='all' gets notif, 'mentions' and 'muted' don't
  - Comment with mention → preference='all' and 'mentions' get notif, 'muted' still doesn't
  - Reference: quickstart.md FT-01

- [x] T035 [P] Write test for task notification type enrichment in `backend/integration/notification_task_test.go`
  - Test function: `TestNotificationTaskTypes`
  - Scenario FT-02: Verify task_assigned (priority=0), task_commented (priority=1), task_status_changed (priority=1), task_mentioned (priority=0)
  - Create watched task, trigger each event, verify notification_type and source_domain
  - Reference: quickstart.md FT-02

- [x] T036 [P] Write test for auto-watch on task mention in `backend/integration/notification_task_test.go`
  - Scenario FT-03: User NOT watching → mention in comment → becomes watcher with reason='mentioned' + receives 'task_mentioned' notification
  - Reference: quickstart.md FT-03

- [x] T037 [P] Write test for auto-watch on task comment in `backend/integration/notification_task_test.go`
  - Scenario FT-04: User NOT watching → posts comment → becomes watcher with reason='commented'
  - Reference: quickstart.md FT-04

- [x] T038 [P] Write test for document notification on version save in `backend/integration/notification_docs_test.go`
  - Test function: `TestNotificationDocuments`
  - Scenario FT-05: Doc with followers (preference=all, preference=mentions), version save → only preference='all' gets doc_updated (priority=2)
  - Reference: quickstart.md FT-05

- [x] T039 [P] Write test for document notification on comment in `backend/integration/notification_docs_test.go`
  - Scenario FT-06: Doc with followers, comment without mention → only preference='all' gets doc_commented (priority=1)
  - Reference: quickstart.md FT-06

- [x] T040 [P] Write test for document mention notification + auto-follow in `backend/integration/notification_docs_test.go`
  - Scenario FT-07: Comment mentioning non-follower → mentioned user gets doc_mentioned (priority=0) + auto-follows
  - Reference: quickstart.md FT-07

- [x] T041 [P] Write test for document auto-follow on create in `backend/integration/notification_docs_test.go`
  - Scenario FT-08: Create document → creator is automatically a follower
  - Reference: quickstart.md FT-08

- [x] T042 [P] Write test for muted follower/watcher suppression in `backend/integration/notification_preference_test.go`
  - Scenario FT-09: Muted follower receives NO notifications, but remains in follower list
  - Reference: quickstart.md FT-09

- [x] T043 [P] Write test for deduplication (watcher + mention) in `backend/integration/notification_preference_test.go`
  - Scenario FT-13: User is watcher AND mentioned → exactly ONE notification with type=task_mentioned
  - Reference: quickstart.md FT-13

- [x] T044 [P] Write test for notification constant validation in `backend/integration/notification_preference_test.go`
  - Scenario FT-14: Every notification type constant in Go code matches database CHECK constraint
  - Insert a notification with each type → no constraint violation
  - Reference: quickstart.md FT-14

- [x] T045 Write regression test verifying chat behavior unchanged in `backend/integration/notification_preference_test.go`
  - Scenario FT-15: Re-run BL-01 chat preference scenarios after all changes
  - Ensure chat notification behavior is identical to baseline
  - Depends on: T034-T044 (run after all feature tests to verify no regression)

## Phase 3.7: Helper Updates

- [x] T046 Add test helper methods to `backend/integration/helper_test.go`
  - Add `updateProjectMemberNotificationPreference(actor, projectID, memberID, preference)` if not already available
  - Add `updateDocumentFollowerPreference(actor, docID, preference)` for setting follower notification pref
  - Add `upsertPersonalPreference(actor, params)` for global preference CRUD
  - Add `getPersonalPreference(actor)` for reading global prefs
  - These helpers are needed by T034-T045 and should be created when first needed
  - Note: May be created incrementally as part of T034-T045 rather than all at once

## Phase 3.8: Constant Synchronization

- [x] T047 [P] Update frontend TypeScript notification types
  - Add new notification types to the TypeScript type union in frontend notification handling code
  - Ensure frontend gracefully handles unknown notification types (log warning, don't crash)
  - Search for existing `NotificationType` or `notification_type` type definitions in `frontend/`

## Phase 3.9: Polish & Validation

- [x] T048 Re-run ALL baseline tests to verify no regressions
  - Run: `cd backend && go test ./integration/ -run TestNotificationBaseline -v -count=1`
  - ALL BL-* tests must still pass after all code changes
  - Depends on: T045

- [x] T049 Run full integration test suite
  - Run: `cd backend && go test ./integration/ -v -count=1`
  - Verify no existing tests broken by the changes
  - Depends on: T048

- [ ] T050 Final smoke test — verify end-to-end notification flow
  - Manually verify via docker compose: publish task notification → verify preference filtering
  - Verify document notification flow: create doc → follow → update → notification appears
  - Verify chat unchanged
  - Depends on: T049

## Dependencies

```
Phase 3.1 (T001-T008): Baseline tests — NO dependencies, run FIRST
  ↓ checkpoint: all baseline tests pass
Phase 3.2 (T009-T018): Schema + codegen
  T009 → T010 → T011 (same file: schema.sql)
  T012 → T013 → T014 (migrations)
  T015, T016, T017 [P] (different query files)
  T015+T016+T017 → T018 (sqlc generate)
  ↓
Phase 3.3 (T019-T020): Constants [P] (different files)
  ↓
Phase 3.4 (T021-T022): Notification infrastructure
  T021 → T022
  ↓
Phase 3.5 (T023-T033): Domain logic
  T024 → T023 (docs logic before server.go wiring)
  T021 → T025 → T026 → T027 → T028 (task_logic.go sequential)
  T024 → T029 → T030 → T031 → T032 (docs sequential)
  T033 [P] (independent: personal preference CRUD)
  ↓
Phase 3.6 (T034-T045): Feature tests [P] (different test files)
  T046 may be done incrementally alongside T034-T045
  ↓
Phase 3.7 (T046): Helpers (may be done with T034-T045)
Phase 3.8 (T047): Frontend types [P]
  ↓
Phase 3.9 (T048-T050): Validation
  T048 → T049 → T050
```

## Parallel Execution Examples

```
# Phase 3.1 — Launch ALL baseline tests together (different scenarios, same file but independent tests):
Task T001: "Baseline test: chat notification preference filtering"
Task T002: "Baseline test: task watcher notification delivery"
Task T003: "Baseline test: task watch/unwatch lifecycle"
Task T004: "Baseline test: document follow/unfollow lifecycle"
Task T005: "Baseline test: notification routing with presence"
Task T006: "Baseline test: notification lifecycle"
Task T007: "Baseline test: multi-tenant notification isolation"
Task T008: "Baseline test: document notifications absent"

# Phase 3.2 — After schema.sql (sequential), launch query files in parallel:
Task T015: "Add personal preference queries to notification.query.sql"
Task T016: "Add follower preference queries to docs.query.sql"
Task T017: "Add watcher preference query to collaboration.query.sql"

# Phase 3.3 — Constants in parallel (different files):
Task T019: "Add notification type constants to notification/constants.go"
Task T020: "Add task notification type constants to collaboration/constants.go"

# Phase 3.6 — Feature tests in parallel (different test files):
Task T034: "Test task notification preference enforcement"
Task T035: "Test task notification type enrichment"
Task T036: "Test auto-watch on task mention"
Task T038: "Test document notification on version save"
Task T039: "Test document notification on comment"
Task T041: "Test document auto-follow on create"
Task T042: "Test muted follower/watcher suppression"
Task T043: "Test deduplication (watcher + mention)"
Task T044: "Test notification constant validation"
```

## Notes
- [P] tasks = different files, no dependencies — can run in parallel
- **TEST-FIRST**: Phase 3.1 baseline tests MUST pass before ANY code changes (user directive)
- Phase 3.6 feature tests written AFTER implementation (verify new behavior)
- Phase 3.9 re-runs baselines to confirm no regressions
- Backend-only changes in this feature — no frontend UI changes except TypeScript type sync (T047)
- All interactive UI elements already have data-testid attributes (notification panel)
- Commit after each task or logical group of tasks
