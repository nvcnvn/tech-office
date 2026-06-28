# Feature Specification: Unified Notification Routing for Chat, Documents, and Tasks

**Feature Branch**: `019-unified-notification-routing-for-chat`  
**Created**: 2026-02-28  
**Status**: Draft  
**Input**: User description: "unified notification routing for chat documents and tasks"

---

## Background: Current State Analysis

The platform currently has three separate notification approaches with significant inconsistencies:

| Aspect | Chat | Tasks | Documents |
|---|---|---|---|
| Subscription model | Implicit (join channel = subscribed) | Explicit watchers (task_watcher table) | Explicit followers (document_follower table) |
| Preference options | `all`, `mentions`, `muted` | `all`, `mentions`, `assigned`, `muted` (defined but **not enforced**) | None |
| Preference enforcement | Filtered during recipient query | **Not enforced** — all watchers notified | N/A — no notifications sent |
| Auto-subscribe triggers | Join channel | Create (reporter), assign (assignee) | None |
| Mute semantics | Set preference to `muted` (stay in channel) | Must unwatch entirely (no mute) | Must unfollow entirely (no mute) |
| Notification types | `message`, `mention`, `reply` | Only generic `message` for all events | Types defined but unused |
| Mention auto-subscribe | N/A (already a member) | Constant defined but never wired | Not implemented |
| Comment auto-subscribe | N/A | Constant defined but never wired | Not implemented |
| Notifications published | Yes — fully operational | Yes — but no preference filtering | **No** — zero notifications sent |

**Key problems**: Mute ≠ unfollow is only respected in chat. Task/project preferences are stored but ignored. Documents have follow infrastructure but produce no notifications. Notification types are too generic for tasks. No global personal preferences exist (no DND, no per-domain mute, no push toggle).

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an employee using the Tech Office platform, I want a consistent, predictable notification experience across chat channels, documents, and project tasks — so that I receive relevant updates without being overwhelmed by noise, and so I can trust that the same "mute" or "follow" action works identically regardless of which feature I'm using.

### Acceptance Scenarios

#### Follow/Subscribe

1. **Given** an employee creates a new document, **When** the document is saved, **Then** the creator is automatically following that document and will receive notifications for it.

2. **Given** an employee is assigned to a task, **When** the assignment is saved, **Then** the assignee automatically watches the task (preserve existing behavior).

3. **Given** an employee is @mentioned in a task comment, **When** the comment is posted, **Then** the mentioned employee automatically begins watching that task.

4. **Given** an employee posts a comment on a task they are not watching, **When** the comment is saved, **Then** the commenter automatically begins watching that task.

5. **Given** an employee is @mentioned in a document comment, **When** the comment is posted, **Then** the mentioned employee automatically begins following that document.

6. **Given** an employee explicitly unfollows a document, **When** a new comment is posted on that document, **Then** the employee does NOT receive a notification.

7. **Given** an employee unwatches a task, **When** the task status is changed, **Then** the employee does NOT receive a notification.

#### Mute vs. Unfollow

8. **Given** an employee mutes a chat channel, **When** a new message is posted, **Then** the employee does NOT receive any notification but remains a channel member and can unmute later.

9. **Given** an employee mutes a task they are watching, **When** the task is updated, **Then** the employee does NOT receive a notification but remains a watcher and can unmute later.

10. **Given** an employee mutes a document they are following, **When** the document is updated, **Then** the employee does NOT receive a notification but remains a follower and can unmute later.

11. **Given** an employee has muted a resource, **When** the employee unmutes it, **Then** they resume receiving notifications according to their preference level (all or mentions-only).

#### Notification Preference Levels

12. **Given** an employee sets a chat channel preference to "mentions only", **When** a regular message is posted, **Then** the employee does NOT receive a notification. **When** the employee is @mentioned, **Then** the employee DOES receive a notification.

13. **Given** an employee sets a project preference to "mentions only", **When** a task in that project changes status, **Then** the employee does NOT receive a notification. **When** the employee is @mentioned in a task comment, **Then** the employee DOES receive a notification.

14. **Given** an employee sets a project preference to "assigned only", **When** a task the employee is NOT assigned to changes status, **Then** the employee does NOT receive a notification. **When** a task the employee IS assigned to changes status, **Then** the employee DOES receive a notification.

#### Online/Offline Delivery

15. **Given** an employee is online and viewing the relevant channel/document/task, **When** a notification is triggered, **Then** it is delivered via real-time stream only (no push notification).

16. **Given** an employee is online but NOT viewing the relevant resource (or tab is hidden), **When** a notification is triggered, **Then** it is delivered via real-time stream AND push notification.

17. **Given** an employee is offline, **When** a notification is triggered, **Then** it is delivered via push notification only.

#### Special Cases: Urgent/Critical

18. **Given** an employee has muted a resource, **When** a critical/urgent notification (priority 0) is published for that resource, **Then** the employee STILL receives the notification (mute is bypassed).

19. **Given** an employee is in DND / quiet hours, **When** a critical/urgent notification is published, **Then** the employee STILL receives the notification.

20. **Given** a system notification (security alert, admin action) is published, **Then** ALL targeted employees receive it regardless of mute, preference, or DND status.

#### Global Personal Preferences

21. **Given** an employee enables "Do Not Disturb" mode, **When** a normal notification is triggered, **Then** it is persisted but push delivery is suppressed until DND ends. Real-time stream delivery proceeds normally.

22. **Given** an employee disables push notifications globally, **When** any notification is triggered, **Then** it is delivered only via real-time stream (unless it is critical priority 0).

23. **Given** an employee mutes an entire domain (e.g., "mute all task notifications"), **When** a task notification is triggered, **Then** it is suppressed (unless critical priority 0).

#### Document Notifications (New)

24. **Given** an employee follows a document, **When** another employee edits and saves a new version, **Then** the follower receives a "document updated" notification.

25. **Given** an employee follows a document, **When** another employee adds a comment, **Then** the follower receives a "comment added" notification.

26. **Given** an employee is @mentioned in a document comment, **When** the comment is saved, **Then** the mentioned employee receives a "mention" notification (even if they don't follow the document — mention triggers auto-follow going forward).

#### Task Notification Types (Enriched)

27. **Given** an employee watches a task, **When** the task is assigned to someone, **Then** the watcher receives a notification with type "task assigned" (not generic "message").

28. **Given** an employee watches a task, **When** the task moves to a different status, **Then** the watcher receives a notification with type "task status changed".

29. **Given** an employee watches a task, **When** someone comments on the task, **Then** the watcher receives a notification with type "task commented".

### Edge Cases

- What happens when an employee is both a watcher AND @mentioned on the same task event? → They receive ONE notification (deduplicated), with the higher-priority type (mention > generic update).
- What happens when an employee unfollows a document but is later @mentioned in a comment? → The mention auto-follows them again and they receive the mention notification.
- What happens when a department is @mentioned in a private channel? → Only department members who are already channel members receive the notification (existing behavior, must be preserved).
- What happens when an employee has "mentions only" preference on a project but is assigned a task? → Assignment counts as a direct-targeting event (like mention), so they DO receive it.
- What happens when a muted employee is the only assignee of an urgent task? → Critical priority bypasses mute, they receive the notification.
- What happens when DND ends and there are accumulated notifications? → Notifications are already persisted in the database; the unread list reflects them. No retroactive push burst is sent.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Follow/Subscribe Consistency

- **FR-001**: System MUST auto-follow the creator of a document when the document is created.
- **FR-002**: System MUST auto-watch a task for the reporter when the task is created (preserve existing behavior).
- **FR-003**: System MUST auto-watch a task for the assignee when the task is assigned (preserve existing behavior).
- **FR-004**: System MUST auto-watch a task for an employee when they are @mentioned in a task comment.
- **FR-005**: System MUST auto-follow a document for an employee when they are @mentioned in a document comment.
- **FR-006**: System MUST auto-watch a task for an employee when they post a comment on that task.
- **FR-007**: System MUST allow explicit unfollow/unwatch to stop receiving notifications for a specific resource.
- **FR-008**: System MUST allow explicit mute on any followed/watched resource which suppresses notifications while preserving the subscription.
- **FR-009**: System MUST allow unmuting, which restores notification delivery according to the employee's preference level.

#### Unified Preference Model

- **FR-010**: System MUST support the following notification preference levels on every subscribable resource context (channel, project, document): `all`, `mentions`, `muted`.
- **FR-011**: For project membership, the system MUST additionally support `assigned` preference which limits notifications to tasks the employee is personally assigned to plus @mentions.
- **FR-012**: System MUST enforce notification preferences during recipient resolution — employees with `muted` preference MUST NOT receive notifications (except critical priority).
- **FR-013**: System MUST enforce `mentions` preference — employees MUST only receive notifications when the event is an @mention or direct assignment.
- **FR-014**: Preference enforcement MUST apply consistently across chat, tasks, and documents.

#### Notification Types

- **FR-015**: Chat notifications MUST use specific types: `message`, `mention`, `reply`.
- **FR-016**: Task notifications MUST use specific types: `task_assigned`, `task_status_changed`, `task_commented`, `task_mention`.
- **FR-017**: Document notifications MUST use specific types: `document_updated`, `comment_added`, `doc_mention`.
- **FR-018**: Ephemeral events (typing, reactions) MUST remain as real-time-only signals with no persistence and no push delivery.

#### Document Notifications (New Capability)

- **FR-019**: System MUST publish a `document_updated` notification to all document followers (respecting preferences) when a new version is saved.
- **FR-020**: System MUST publish a `comment_added` notification to all document followers (respecting preferences) when a comment is posted.
- **FR-021**: System MUST publish a `doc_mention` notification to @mentioned employees when they are mentioned in a document comment.

#### Delivery Routing

- **FR-022**: System MUST deliver notifications via real-time stream to online employees with active connections.
- **FR-023**: System MUST deliver push notifications to employees who are offline or whose browser tab is hidden/unfocused.
- **FR-024**: System MUST suppress push delivery when the employee is online and actively viewing the resource that generated the notification.
- **FR-025**: System MUST support delivery logging for debugging and retry of failed deliveries.

#### Global Personal Preferences

- **FR-026**: System MUST allow employees to enable "Do Not Disturb" mode which suppresses push delivery for all non-critical notifications.
- **FR-027**: System MUST allow employees to disable push notifications globally (real-time stream only, except critical).
- **FR-028**: System MUST allow employees to mute entire notification domains (e.g., "mute all task notifications").
- **FR-029**: Global preferences MUST be overridden by critical/urgent notifications (priority 0).

#### Special Case Handling

- **FR-030**: Critical notifications (priority 0) MUST bypass mute preferences, DND mode, and domain mutes.
- **FR-031**: System notifications (security alerts, admin actions) MUST always be delivered regardless of any preference or mute state.
- **FR-032**: Workflow automation-triggered notifications MUST be delivered to configured recipients regardless of follow/watch status.
- **FR-033**: When an employee would receive duplicate notifications for the same event (e.g., watcher + @mention), the system MUST deduplicate to a single notification, keeping the higher-priority type.

### Key Entities

- **Resource Subscription**: Represents an employee's follow/watch/membership relationship with a notifiable resource (channel, task, document). Tracks how the subscription was created (manual, assigned, mentioned, commented, created) and the employee's notification preference for that resource.
- **Notification Event**: A single occurrence that may trigger notifications — a message sent, a task status changed, a document version saved, a comment posted, a mention detected.
- **Personal Notification Preference**: Employee-level global settings controlling push delivery, DND mode, and per-domain mute toggles. Separate from per-resource preferences.
- **Notification Priority**: Classification of notification urgency — critical (always deliver), default (respect preferences), online-only (suppress if offline), silent/ephemeral (real-time stream only, never persisted).

### Scale & Distribution Considerations

- **Expected concurrent users**: Up to hundreds of concurrent employees per organization, each potentially subscribed to dozens of channels, tasks, and documents.
- **State lifecycle**: Subscriptions (follow/watch/membership) persist until explicitly removed. Push tokens expire based on device/browser lifecycle. Active connection state is ephemeral and may be lost on server restart.
- **Multi-instance resilience**: Notification delivery must work across multiple backend instances. An employee may have connections on multiple instances simultaneously.
- **Data consistency requirements**: Preference changes must take effect on the next notification event (not retroactive). Notification delivery status must be tracked per-recipient.
- **Deduplication**: When a single event generates multiple notification triggers (e.g., message broadcast + mention), the system must consolidate to one notification per recipient.

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---
