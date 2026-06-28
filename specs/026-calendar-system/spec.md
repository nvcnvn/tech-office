# Feature Specification: Calendar System

**Feature Branch**: `026-calendar-system`  
**Created**: 2026-03-20  
**Status**: Draft  
**Input**: User description: "build calendar system with personal views, team calendars, event types, attendees/RSVP, availability scheduling, notification integration, task/ritual integration, document/chat integration, recurrence, search/filters, operations-aware scheduling, resource booking, presence-aware coordination, cross-domain overlays, permission model, audit/history for compliance events, mobile-first event actions"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Personal Calendar with Event Creation (Priority: P1)

An employee opens their personal calendar, sees their day/week/month/agenda views, and creates a new meeting event. They select required and optional attendees, set a time, and the system immediately shows conflicts with other attendees' busy periods. After saving, attendees receive an invitation and can RSVP. The creator sees RSVP status update in real time on the event.

**Why this priority**: The personal calendar event lifecycle is the atomic unit all other features depend on. Without reliable event creation, attendee management, and RSVP, no other calendar feature delivers value.

**Independent Test**: A single user can create a meeting with two other users, both users can see and RSVP to the invitation, and the creator can see the updated RSVP statuses — all without any other calendar feature being present.

**Acceptance Scenarios**:

1. **Given** an employee has their calendar open in week view, **When** they click a time slot and fill in event title, time, and attendees, **Then** the event is saved and appears on all attendees' calendars.
2. **Given** an event exists with multiple attendees, **When** an attendee responds Accept/Decline/Tentative, **Then** the response status is immediately visible to the event organizer.
3. **Given** a user creating an event and adding an attendee, **When** the proposed time overlaps an existing event for that attendee, **Then** the system shows a conflict indicator without blocking submission.
4. **Given** a user in a non-UTC timezone, **When** they view an event created by someone in a different timezone, **Then** the event displays in the viewer's local timezone with the original timezone noted.
5. **Given** a user on a mobile device, **When** they open their calendar, **Then** day/week/month/agenda views are usable without zooming or horizontal scrolling.

---

### User Story 2 - Recurring Events with Exceptions (Priority: P2)

A manager creates a weekly team standup that recurs every Monday at 9 AM. One week, she moves a single instance to Tuesday because of a holiday. The following week, a team member is added to only one occurrence. The recurring pattern continues unmodified except for the explicit exceptions. Attendees see each modified instance correctly on their calendars.

**Why this priority**: Recurrence is used for the majority of operational events (shifts, stand-ups, ceremonies, compliance checkpoints). Incorrect recurrence modeling creates data integrity problems that are expensive to fix retroactively.

**Independent Test**: Create a weekly recurring event, move one instance, skip another instance, and confirm that the series, the moved instance, and the gap for the skipped instance all display correctly without affecting surrounding instances.

**Acceptance Scenarios**:

1. **Given** a recurring event series, **When** a user edits only one instance (title, time, attendees), **Then** only that instance changes, the rest of the series is unchanged, and an exception entry is recorded.
2. **Given** a recurring event series, **When** a user cancels a single instance, **Then** that date appears as cancelled/skipped, future instances remain, and attendees see the cancellation.
3. **Given** a recurring event with exceptions, **When** a user edits "this and all following" from a mid-series point, **Then** a new series fork is created from that point and earlier instances remain intact.
4. **Given** an audit-flagged recurring event (shift or compliance checkpoint), **When** any change is made to an instance or series, **Then** a history entry capturing who changed what and when is created.

---

### User Story 3 - Resource Booking with Conflict Prevention (Priority: P3)

An operations coordinator books a meeting room for a training session. The system shows room availability for the selected time slot and prevents double-booking. They also reserve a projector. When an event is cancelled, the resources are automatically released and become available to others.

**Why this priority**: Resource booking is a core operational need (rooms, vehicles, equipment, labs) that differentiates this calendar from a generic scheduling tool. Conflict prevention is necessary before any room can be shared across teams.

**Independent Test**: Create two events attempting to book the same meeting room at the same time — the second booking must be refused with the conflict shown, and room availability must be visible before booking.

**Acceptance Scenarios**:

1. **Given** a user adding a resource (room, vehicle, equipment) to an event, **When** that resource is already booked for the same time, **Then** the conflict is shown and the booking cannot be submitted without resolving it.
2. **Given** a resource is booked for an event, **When** the event is cancelled or rescheduled, **Then** the resource is automatically freed for the new time.
3. **Given** a user browsing for a meeting room, **When** they search by capacity, date range, and availability, **Then** only rooms with no conflicts in that window are listed.
4. **Given** a user with resource-booking permission limited to specific resources, **When** they attempt to book a resource outside their permission, **Then** the booking is rejected with an appropriate message.

---

### User Story 4 - Team and Org-Wide Calendar Overlays (Priority: P4)

A department head views the department calendar to understand team coverage, on-call rotation, and upcoming deadlines for the week. They toggle overlays to include project milestones and company announcements. They can see any team member's free/busy status without seeing the private details of personal events marked as private.

**Why this priority**: Team and org-wide visibility drives coordination. The permission model (private vs. team-visible vs. org-wide) must be correct before any calendar is shared beyond the individual.

**Independent Test**: A department head can view their department calendar, see that a team member marked an event as private (shown as "Busy" with no details), and see org-wide company events alongside department events — all controllable via toggleable overlays.

**Acceptance Scenarios**:

1. **Given** a department calendar view, **When** a team member has a private personal event during working hours, **Then** their time shows as "Busy" with no title, location, or attendee details visible to the department head.
2. **Given** a user toggling calendar overlays, **When** they enable the project calendar overlay, **Then** project milestones and deadlines appear in a distinct visual style layered over their personal events.
3. **Given** an org-wide event (company all-hands) created by HR, **When** any employee opens their calendar, **Then** the event is visible without it needing to be individually accepted.
4. **Given** a delegated calendar manager, **When** they create or modify events on behalf of another user, **Then** events are attributed to the delegating user, not the manager.

---

### User Story 5 - Cross-Domain Overlays: Tasks, Rituals, and Docs (Priority: P5)

A project lead opens their week view and sees task due dates from active projects alongside ritual instances (weekly review ceremony, shift sign-off), document review deadlines, and their regular meetings — all in one timeline. Clicking a task due date navigates to the task. Clicking a ritual instance opens the ritual without converting it to an event. Clicking a meeting opens the event with its attached agenda document and discussion channel.

**Why this priority**: The unique value of this calendar is unified time awareness across domains. This layer is what makes Tech Office's calendar more useful than a standalone scheduling tool.

**Independent Test**: A user with at least one upcoming task due date, one ritual instance, and one meeting with an attached doc can open their calendar and verify all three appear distinctly and link correctly to their source records.

**Acceptance Scenarios**:

1. **Given** a task with a due date in the next 7 days, **When** the user opens their week view with the task overlay enabled, **Then** the task due date appears on the correct day with a visual indicator distinguishing it from calendar events.
2. **Given** a ritual instance scheduled for the week, **When** it appears on the calendar, **Then** clicking it opens the ritual record (with its assignment, evidence, and approval workflow), not a calendar event editor.
3. **Given** a meeting event with an attached agenda document and a linked discussion channel, **When** the user opens the event detail, **Then** they can navigate to the document and the chat channel without leaving the calendar context.
4. **Given** cross-domain items displayed on the calendar, **When** a task is marked complete or a ritual is closed, **Then** the calendar overlay updates to reflect the new status without a manual refresh.

---

### User Story 6 - Availability Scheduling and Booking Links (Priority: P6)

An employee needs to schedule an internal sync with three colleagues. They use the scheduling assistant to find open slots that work for all four people based on their working hours and existing calendar commitments. They select a slot and the event is created for all attendees. Optionally, they share a booking link so the other person can self-select a slot from available windows without seeing full event details.

**Why this priority**: Scheduling across teams is a daily friction point. Conflict detection at event creation (Story 1) is minimum viable; the scheduling assistant and booking links reduce back-and-forth for multi-person meetings.

**Independent Test**: Select three internal users and use the scheduling assistant to find the next available 30-minute window within working hours that has no conflicts for any of them — verify the suggested slot is genuinely conflict-free for all parties.

**Acceptance Scenarios**:

1. **Given** four attendees selected for a meeting, **When** the organizer opens the scheduling assistant, **Then** it shows a merged busy/free view covering the next 5 business days for all attendees.
2. **Given** suggested time slots from the assistant, **When** the organizer selects one and confirms, **Then** an event is created and invitations are sent to all attendees.
3. **Given** a user generating a booking link, **When** they configure available windows and event duration, **Then** the link shows only the free slots to the recipient without revealing other event details.
4. **Given** working hours set per user, **When** the scheduling assistant searches for slots, **Then** suggestions fall within all attendees' working hours and respect timezone differences.

---

### User Story 7 - Operational Event Check-In and Evidence (Priority: P7)

A field technician has a maintenance window event on their calendar. On their mobile device, they open the event at start time and mark themselves as "checked in." After completing the work, they attach a photo or document as field evidence directly from the event and submit. A compliance supervisor can later view the event's check-in record and attached evidence.

**Why this priority**: Operational and compliance events require accountability beyond simple RSVP. Check-in, evidence attachment, and supervisor visibility are the mobile-first actions that distinguish operations from office scheduling.

**Independent Test**: A technician can check in to an event on mobile, attach a file, and a supervisor account can see the check-in timestamp and attached evidence on the same event — with all changes recorded in the event's audit history.

**Acceptance Scenarios**:

1. **Given** an operational event at or after its start time, **When** the assigned attendee taps "Check In" on their mobile device, **Then** a check-in record is created with timestamp and the attendee's identity.
2. **Given** a checked-in event, **When** the attendee attaches a photo or document as evidence, **Then** the file is linked to the event and visible to users with supervisor or compliance viewer permission.
3. **Given** an event with check-in and evidence requirements, **When** the end time passes without a check-in, **Then** the event is flagged as unacknowledged and the organizer is notified.
4. **Given** a compliance supervisor viewing an operational event, **When** they open the event history, **Then** they see a full audit trail: creation, modification, check-in, evidence submission, and any cancellations with actor and timestamp.

---

### User Story 8 - Notification and Reminders (Priority: P8)

An employee receives reminder notifications before meetings (configurable, e.g., 15 min), a "starting soon" alert when an event is about to begin, and notifications when an event they're invited to is changed or cancelled. They can set a daily or weekly digest for low-priority calendar changes instead of individual notifications for every update.

**Why this priority**: Calendar notifications drive on-time attendance and awareness of changes. Without them, a calendar system's operational value is significantly diminished.

**Independent Test**: Create a meeting with a 10-minute reminder, observe that the reminder notification arrives near that threshold; then modify the event title, and verify the invited attendee receives a "changed event" notification.

**Acceptance Scenarios**:

1. **Given** an event with reminder settings, **When** the reminder threshold is reached, **Then** the attendee receives a notification via the existing notification hub.
2. **Given** an event organizer cancels a meeting, **When** the cancellation is saved, **Then** all invited attendees receive a cancellation notification immediately.
3. **Given** an event organizer changes the time of a meeting, **When** the change is saved, **Then** all invited attendees receive a notification indicating the new time, and RSVP statuses are reset.
4. **Given** a user who has opted into digest mode for a calendar, **When** multiple low-priority changes accumulate, **Then** a single digest notification is sent at the configured interval instead of individual alerts.

---

### Edge Cases

- What happens when an attendee's timezone or working hours change after a recurring event series is created? Each instance displays times converted to the viewer's current timezone, and the stored timezone-naive UTC times remain unchanged.
- What happens when a resource is deleted (a room decommissioned) and existing future events reference it? Those events are flagged for organizer review without cancelling the events automatically.
- What happens when a user who owns a series of recurring events leaves the organization? The series must be transferable to a designated calendar owner with full history preserved.
- What happens when a recurring instance is moved to a date already occupied by another instance of the same series? The system detects the collision and requires the user to resolve it explicitly.
- What happens when a cross-domain overlay item (task, ritual) is deleted from its source system? The calendar overlay removes it gracefully — the calendar grid does not show broken references.
- What happens when the scheduling assistant cannot find any available slot within the selected range? The system reports no availability and suggests expanding the search window or the date range.
- What happens when a user's booking link receives multiple simultaneous selections for the same slot? The first confirmed claim wins; others receive a notification that the slot is taken and are shown the next available slot.
- What happens when an event check-in is submitted after the event end time? The system accepts it as late check-in and flags the delay in the audit record.

## Requirements *(mandatory)*

### Functional Requirements

#### Personal Calendar

- **FR-001**: Users MUST be able to view their calendar in day, week, month, and agenda layouts, switchable without page reload.
- **FR-002**: All event times MUST be displayed in the viewing user's configured timezone, with the original timezone available on demand.
- **FR-003**: Calendar views MUST be usable on mobile devices with touch-friendly event creation, navigation, and actions.
- **FR-004**: Users MUST be able to set and update their working hours per day of week and timezone.

#### Event Management

- **FR-005**: Users MUST be able to create events of the following types: meeting, shift, deadline, reminder, out-of-office (OOO), company event, training, maintenance window.
- **FR-006**: Events MUST support a title, description, start and end time (with all-day option), location (physical or virtual link), visibility level, and event type.
- **FR-007**: Events MUST support attaching documents (agenda, meeting notes) and linking a discussion channel directly on the event record.
- **FR-008**: Events MUST support required and optional attendees drawn from the organization's user directory.
- **FR-009**: Attendees MUST be able to accept, decline, or mark tentative for event invitations.
- **FR-010**: The event organizer MUST be able to view per-attendee RSVP status at any time.
- **FR-011**: Events MUST support one or more bookable resources (rooms, vehicles, equipment, desks, labs).
- **FR-012**: The system MUST prevent double-booking of any resource: a resource already reserved for an overlapping time MUST NOT be bookable for another event.
- **FR-013**: When an event is cancelled or rescheduled, all reserved resources MUST be released for the new time.

#### Recurrence

- **FR-014**: Events MUST support recurring patterns: daily, weekly (with day-of-week selection), bi-weekly, monthly (by day or by date), and annually.
- **FR-015**: Users MUST be able to edit a single instance, "this and following" instances, or all instances of a recurring series.
- **FR-016**: Individual instances of a recurring series MUST be independently cancellable, movable, and modifiable without affecting other instances.
- **FR-017**: The original recurrence pattern and all exceptions MUST be stored in a way that allows complete reconstruction of the series history.
- **FR-018**: For compliance-flagged recurring event types (shift, maintenance window, compliance checkpoint), every change to an instance or series MUST create an audit record capturing who made the change, what changed, and when.

#### Attendees and Scheduling

- **FR-019**: During event creation and editing, the system MUST display a merged busy/free view for all selected attendees within the proposed time range.
- **FR-020**: The scheduling assistant MUST suggest available time slots that fall within all selected attendees' working hours and have no conflicts.
- **FR-021**: Users MUST be able to generate a booking link defining available windows and meeting duration; recipients select a slot without seeing the organizer's full calendar.
- **FR-022**: Booking slot reservations MUST be exclusive: simultaneous selections for the same slot MUST resolve to a single confirmed booking with other claimants notified.

#### Team and Org Calendars

- **FR-023**: Department calendars MUST aggregate events for all members of the department and be visible to department members and their managers.
- **FR-024**: Project calendars MUST aggregate events tagged to a project and be visible to project members.
- **FR-025**: Organization-wide ("company") events MUST be visible to all employees without requiring individual RSVP acceptance to appear on the calendar.
- **FR-026**: Calendar overlays (team, project, org) MUST be independently toggleable per user session.
- **FR-027**: Events marked as private MUST display only as "Busy" (no title, description, attendees, or location) to anyone other than the event owner.

#### Cross-Domain Overlays

- **FR-028**: Task due dates from the task management system MUST optionally appear on the calendar as read-only overlay items; clicking navigates to the task record.
- **FR-029**: Ritual instances MUST optionally appear on the calendar as read-only overlay items; clicking opens the ritual record, NOT a calendar event editor.
- **FR-030**: Document review deadlines and project milestones MUST optionally appear on the calendar as read-only overlay items.
- **FR-031**: Cross-domain overlay items MUST be visually distinct from editable calendar events and display status changes (task completed, ritual closed) without requiring a manual page reload.

#### Presence Integration

- **FR-032**: A user's presence status MUST reflect calendar state: if the user has an active meeting, their status shows as "In Meeting" regardless of any manually set presence.
- **FR-033**: "In Meeting" presence status MUST NOT block a user from being shown as available outside their meeting window.
- **FR-034**: When the meeting ends, the system MUST revert the user's presence to their prior manual status (or the system default if no manual status was set).

#### Permissions and Delegation

- **FR-035**: Events MUST have one of these visibility scopes: Private (owner only), Personal-shared (free/busy visible to team), Team (full details to department), Org-wide (full details to all employees).
- **FR-036**: Users MUST be able to delegate calendar management to another user, allowing the delegate to create, modify, and cancel events on their behalf.
- **FR-037**: Delegated actions MUST be attributed to the delegating user on the event, with the delegate's identity recorded in the audit trail.
- **FR-038**: Resource booking permissions MUST be configurable per resource, limiting who can book it.

#### Notifications

- **FR-039**: The system MUST send reminder notifications before events at the attendee's configured threshold (default: 15 minutes, configurable per-event and per-user).
- **FR-040**: The system MUST send "starting soon" alerts at event start time.
- **FR-041**: When an event is cancelled, all attendees and accepted RSVP holders MUST receive a cancellation notification immediately.
- **FR-042**: When an event's time, location, or title changes, all attendees MUST receive an "event changed" notification and their RSVP status MUST be reset to pending.
- **FR-043**: Users MUST be able to configure digest mode for non-critical calendar change notifications, receiving a single batched notification at a configurable interval instead of per-change alerts.
- **FR-044**: All calendar notifications MUST route through the existing notification hub.

#### Operational and Compliance Events

- **FR-045**: Operational event types (shift, maintenance window) MUST support attendee "check in" at or after event start time, recording a timestamp and the checking-in user's identity.
- **FR-046**: Checked-in events MUST support file attachment (photos, documents) as field evidence linked to the event.
- **FR-047**: Events not checked into by their end time (for types that require it) MUST be flagged as unacknowledged and trigger a notification to the event organizer.
- **FR-048**: Compliance event types MUST maintain a full, append-only audit history: creation, modification, cancellation, check-in, evidence submission, and acknowledgement — each with actor and timestamp.

#### Search and Filters

- **FR-049**: Users MUST be able to search events by title, attendee name, department, event type, resource/location, and project/tag.
- **FR-050**: Search results MUST include both past and future events within permission scope.
- **FR-051**: Users MUST be able to filter the calendar view by event type to reduce visual noise.

### Key Entities

- **Event**: Represents a single point in time or time range. Attributes: id, title, description, event type, start time (UTC), end time (UTC), all-day flag, organizer, location, virtual link, visibility scope, recurrence rule id, exception flag, audit trail reference, attached documents, linked chat channel.
- **RecurrenceRule**: Defines the repeating pattern for a series. Attributes: frequency (daily/weekly/monthly/annually), interval, day-of-week mask, end condition (count or until date), exception list.
- **RecurrenceException**: Records a modification, skip, or cancellation of a specific instance. Attributes: series id, original date, exception type (moved/skipped/cancelled/modified), new instance id if moved/modified, changed-by, changed-at.
- **Attendee**: Represents a user's participation in an event. Attributes: event id, user id, role (required/optional), RSVP status (pending/accepted/declined/tentative), response time.
- **Resource**: A bookable physical resource. Attributes: id, name, type (room/vehicle/equipment/desk/lab), location, capacity, booking permission scope.
- **ResourceBooking**: A reservation of a resource for an event. Attributes: resource id, event id, start time, end time, booked-by.
- **CalendarPermission**: Defines visibility and management rights. Attributes: owner user id, scope (private/personal-shared/team/org-wide), delegate user id (optional).
- **CheckIn**: Records an operational check-in against an event. Attributes: event id, user id, check-in time, evidence files, submitted-at.
- **AuditEntry**: Append-only record for compliance events. Attributes: event id, actor user id, action type, diff snapshot, timestamp.
- **BookingLink**: A shareable availability link. Attributes: id, owner user id, available windows, meeting duration, expiry, claimed slot (null until confirmed).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a meeting with multiple attendees and receive confirmation in under 10 seconds on a standard mobile connection.
- **SC-002**: The scheduling assistant returns a list of available slots for up to 10 attendees within 3 seconds.
- **SC-003**: Calendar views (day, week, month, agenda) load and render completely in under 2 seconds on mobile devices for a 30-day event window.
- **SC-004**: 95% or more of event reminder notifications are delivered within 60 seconds of the configured threshold.
- **SC-005**: Resource double-booking conflicts are detected and blocked in 100% of concurrent booking attempts.
- **SC-006**: All changes to compliance-flagged events produce an audit entry within 1 second of the change being committed.
- **SC-007**: Overlay items (tasks, rituals, milestones) reflect status changes (completed, closed) on the calendar within 30 seconds without a manual page reload.
- **SC-008**: Users can complete the full event creation flow (type, time, attendees, resource, save) in under 3 minutes on mobile.
- **SC-009**: Field technicians can check in and attach evidence to an operational event in under 2 minutes on a mobile device with a standard connection.
- **SC-010**: The calendar system supports the full user population of the organization without degradation as the number of concurrent active sessions grows.

## Assumptions

- The organization's user directory (names, departments, working hours, timezone) is already available from the existing IAM system; the calendar system consumes this data without owning it.
- The existing notification hub is the sole delivery channel for all calendar notifications; the calendar system does not build its own delivery mechanism.
- Rituals, tasks, project milestones, and document review deadlines each have a stable, queryable due-date or scheduled-date field that the calendar can read as a read-only overlay source.
- External calendar synchronization (Google Calendar, Microsoft 365) is explicitly out of scope for this version; internal scheduling correctness is prioritized.
- "Compliance-flagged" event types in this version are shift and maintenance window; the set may be expanded in a future version without requiring a schema rebuild.
- Resource booking permissions are managed by administrators; self-service resource creation is not in scope.
- Booking links are for internal scheduling only in this version and do not require anonymous or unauthenticated access.
- Personal presence status integration relies on the existing real-time presence system (spec 012); the calendar system sends calendar-state signals to that system but does not replace it.

## Out of Scope

- External calendar sync (Google Calendar, Microsoft Outlook/365) — deferred to a future version.
- Converting any calendar event into a ritual task. Rituals have separate assignment, evidence, approval, and audit semantics.
- Public-facing booking pages for external guests or clients.
- Video conferencing integration beyond storing a virtual meeting link on the event record.
- Automatic scheduling AI that proposes meeting times without human confirmation.
- Building a new notification delivery system — the existing notification hub is used as-is.
