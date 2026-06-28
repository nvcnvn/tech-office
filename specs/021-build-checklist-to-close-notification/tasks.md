# Tasks: Notification Delivery Consistency and Coverage

**Input**: Design artifacts from `/Volumes/T5/Codes/tech-office/specs/021-build-checklist-to-close-notification/`

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel when dependencies are satisfied
- Every task references an exact path or command target

## Phase 1: Schema and Codegen Foundations

- [X] T001 Update `/Volumes/T5/Codes/tech-office/backend/database/scripts/schema.sql` with notification policy, acknowledgement, fallback, and active-context schema changes from `data-model.md`
- [X] T002 Add paired migration files under `/Volumes/T5/Codes/tech-office/backend/k8s/base/database/migrations/` for the new notification lifecycle schema
- [X] T003 [P] Update `/Volumes/T5/Codes/tech-office/backend/database/scripts/notification.query.sql` with acknowledgement, unread-count, fallback-attempt, and active-context queries
- [X] T004 [P] Update `/Volumes/T5/Codes/tech-office/backend/database/scripts/docs.query.sql` with document recipient eligibility queries for authors, commenters, followers, and mentions
- [X] T005 [P] Update `/Volumes/T5/Codes/tech-office/backend/database/scripts/collaboration.query.sql` with task recipient eligibility queries for assignees, reporters, watchers, commenters, and mentions
- [X] T006 Run `cd /Volumes/T5/Codes/tech-office/backend && ./scripts/migrate.sh` and resolve any migration issues before proceeding
- [X] T007 Run `cd /Volumes/T5/Codes/tech-office/backend && sqlc generate` and verify generated outputs are updated

## Phase 2: Notification Contract and Infrastructure

- [X] T008 Update `/Volumes/T5/Codes/tech-office/backend/rpc/v1/notification.proto` with policy, acknowledgement, fallback, navigation-target, and contextual-audience fields
- [X] T009 Run `cd /Volumes/T5/Codes/tech-office/backend && buf generate` and refresh generated backend/frontend RPC outputs
- [X] T010 Update `/Volumes/T5/Codes/tech-office/backend/internal/notification/constants.go` with aligned policy keys, acknowledgement actions, fallback reasons, and any new validation helpers
- [X] T011 Refactor `/Volumes/T5/Codes/tech-office/backend/internal/notification/publisher.go` to enforce business policy, deduplicate recipient eligibility, and persist delivery metadata
- [X] T012 Refactor `/Volumes/T5/Codes/tech-office/backend/internal/notification/routing_logic.go` to make a single authoritative fallback decision and record skip/retry/failure reasons
- [X] T013 Refactor `/Volumes/T5/Codes/tech-office/backend/internal/notification/logic.go` and `/Volumes/T5/Codes/tech-office/backend/internal/notification/connect.go` so unread and list flows use acknowledgement state instead of popup/read shortcuts
- [X] T014 Update `/Volumes/T5/Codes/tech-office/backend/internal/notification/listener.go` and `/Volumes/T5/Codes/tech-office/backend/internal/notification/sse.go` for shared-context live routing and replay consistency
- [X] T015 Update `/Volumes/T5/Codes/tech-office/backend/cmd/server.go` wiring for any new notification logic dependencies or lifecycle helpers

## Phase 3: Domain Recipient Coverage

- [X] T016 Update `/Volumes/T5/Codes/tech-office/backend/internal/docs/follower_logic.go` to resolve and deduplicate document followers, authors, commenters, and explicitly mentioned recipients
- [X] T017 Update `/Volumes/T5/Codes/tech-office/backend/internal/docs/comment_logic.go` to publish comment and mention notifications with typed navigation targets
- [X] T018 Update `/Volumes/T5/Codes/tech-office/backend/internal/docs/version_logic.go` to publish document update notifications under the explicit policy registry
- [X] T019 Update `/Volumes/T5/Codes/tech-office/backend/internal/collaboration/task_logic.go` to resolve assignees, reporters, watchers, commenters, and mentioned users as mandatory recipients
- [X] T020 Update `/Volumes/T5/Codes/tech-office/backend/internal/collaboration/assignment_logic.go` to publish assignment notifications with critical policy and auditable lifecycle state
- [X] T021 Update `/Volumes/T5/Codes/tech-office/backend/internal/chat/logic.go` so chat notifications also use the explicit policy registry and aligned navigation-target contract

## Phase 4: Frontend Parity and Acknowledgement Behavior

- [X] T022 Update `/Volumes/T5/Codes/tech-office/frontend/packages/apis/src/notification.ts` with new acknowledgement RPC wrappers, navigation-target typing, and lifecycle field normalization
- [X] T023 Update `/Volumes/T5/Codes/tech-office/frontend/packages/notifications/src/types.ts` and `/Volumes/T5/Codes/tech-office/frontend/packages/notifications/src/useNotifications.ts` so unread state derives from acknowledgement status
- [X] T024 Update `/Volumes/T5/Codes/tech-office/frontend/packages/notifications/src/useSSEConnection.ts` to normalize new stream payload fields and preserve replay parity
- [X] T025 Update `/Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/notifications/components/NotificationItem.tsx` so destination open triggers acknowledgement and popup/list display alone does not
- [X] T026 [P] Update `/Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/notifications/components/NotificationList.tsx` and `/Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/notifications/components/NotificationFilters.tsx` for source-domain parity and test hooks
- [X] T027 Update `/Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/notifications/page.tsx` and related popup/navigation wiring to use the shared navigation-target resolver
- [X] T028 Run `cd /Volumes/T5/Codes/tech-office/frontend && pnpm -r build` and fix any contract or type drift before merge

## Phase 5: Integration Verification

- [X] T029 Add `/Volumes/T5/Codes/tech-office/backend/integration/notification_delivery_consistency_test.go` covering persistent vs live-only delivery, replay, and unread consistency
- [X] T030 Add `/Volumes/T5/Codes/tech-office/backend/integration/notification_document_coverage_test.go` covering document recipient eligibility and deduplication
- [X] T031 Add `/Volumes/T5/Codes/tech-office/backend/integration/notification_task_coverage_test.go` covering task recipient eligibility and critical assignment behavior
- [X] T032 Add `/Volumes/T5/Codes/tech-office/backend/integration/notification_frontend_parity_test.go` validating navigation metadata, acknowledgement action, and source-domain parity from backend contracts
- [X] T033 Run `cd /Volumes/T5/Codes/tech-office/backend && go test ./integration/... -run 'TestNotification' -count=1`
- [X] T034 Run `cd /Volumes/T5/Codes/tech-office/backend && go build ./...` and confirm generated/query code compiles cleanly

## Phase 6: Release Readiness

- [X] T035 Verify all new constants are aligned across `/Volumes/T5/Codes/tech-office/backend/internal/notification/constants.go`, `/Volumes/T5/Codes/tech-office/backend/database/scripts/schema.sql`, `/Volumes/T5/Codes/tech-office/backend/rpc/v1/notification.proto`, and `/Volumes/T5/Codes/tech-office/frontend/packages/apis/src/notification.ts`
- [X] T036 Confirm migration, codegen, backend build, integration tests, and frontend build outputs are captured in the implementation PR notes
- [X] T037 Improve backend startup and shutdown diagnostics so the first server-start failure is visible before notification worker shutdown noise
- [X] T038 Re-run migration verification and notification integration tests after the startup/shutdown bugfix
