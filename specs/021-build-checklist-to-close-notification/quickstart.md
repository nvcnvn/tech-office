# Quickstart: Notification Delivery Consistency and Coverage

## Goal

Validate that backend delivery policy, realtime routing, unread counts, fallback auditing, and frontend destination behavior stay consistent for chat, documents, and tasks.

## Prerequisites

```bash
cd /Volumes/T5/Codes/tech-office/backend
docker compose up -d
go test ./integration/... -run 'TestNotification' -count=1
```

After proto and frontend changes:

```bash
cd /Volumes/T5/Codes/tech-office/backend
buf generate
sqlc generate

cd /Volumes/T5/Codes/tech-office/frontend
pnpm -r build
```

## Verification Scenarios

### QS-01: Live-only contextual chat signal does not create unread state

Given two employees actively viewing the same chat channel and a typing event is published with context-based delivery,
when the event is emitted,
then both active viewers receive the live signal,
and no notification-center row is created,
and unread counts remain unchanged.

### QS-02: Persistent chat mention creates durable unread state

Given a user is mentioned in chat,
when the notification is published,
then the notification appears in listing APIs,
and unread count increases,
and acknowledgement remains pending until the destination is opened or explicitly acknowledged.

### QS-03: Document coverage includes authors, commenters, followers, and mentions

Given a document with an author, a previous commenter, a follower, and a mentioned user,
when a new comment or update event is published,
then all eligible recipients except the actor receive exactly one notification each,
and each recipient receives the expected notification type and navigation target.

### QS-04: Task coverage includes assignee, reporter, watchers, commenters, and mentions

Given a task with all supported participant roles,
when assignment, comment, mention, and status-change events are published,
then mandatory recipients receive notifications according to the clarified rules,
and duplicate eligibility paths do not create duplicate recipient rows.

### QS-05: Popup display alone does not acknowledge

Given a user receives a persistent notification and sees it in popup UI,
when they dismiss or ignore the popup,
then acknowledgement remains pending,
and unread count does not change.

### QS-06: Destination open acknowledges the notification

Given a popup or center item with a valid navigation target,
when the user opens the linked destination,
then the corresponding notification becomes acknowledged,
and unread counts update within 2 seconds.

### QS-07: Offline fallback reasons are auditable

Given recipients with no push target, muted fallback, and provider failure conditions,
when a persistent notification cannot be delivered live,
then the recipient summary and delivery-attempt history record the correct fallback status and reason,
and no duplicate fallback attempt is created for the same lifecycle transition.

### QS-08: Reconnect replay does not contradict list state

Given a user disconnects before a persistent notification is delivered,
when they reconnect,
then replayed events match the same notification summary returned by listing APIs,
and acknowledgement state remains unchanged until the configured acknowledgement action occurs.

### QS-09: Source-domain parity is consistent across backend and frontend

Given chat, docs, and task notifications exist for the same user,
when unread counts and filters are queried,
then frontend source-domain filters match backend unread breakdown keys,
and every persistent domain can be rendered and opened from the UI.

### QS-10: Multi-instance routing remains consistent

Given active recipients connected through different backend instances,
when a persistent or live-only event is published,
then the same effective audience receives the event regardless of publisher instance,
and no event depends on sticky sessions or process-local-only state.
