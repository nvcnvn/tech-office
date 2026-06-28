# Data Model: Calendar System

**Phase**: 1 — Design  
**Spec**: `specs/026-calendar-system/spec.md`  
**Date**: 2026-03-20

---

## Schema Overview

All tables live in the `calendar` PostgreSQL schema. All comply with Citus sharding requirements: composite primary key `(organization_id, id)`, `organization_id` as first column in every index, no triggers, no `ON DELETE SET NULL`, no `now()` in `ON CONFLICT DO UPDATE`.

### New Tables

| Table | Purpose |
|---|---|
| `calendar.event` | Core event record (single instance or series head) |
| `calendar.recurrence_rule` | JSONB-based recurrence pattern for a series |
| `calendar.recurrence_exception` | Modifications/skips/cancellations to individual series instances |
| `calendar.attendee` | Event participant with RSVP status |
| `calendar.resource` | Bookable physical resource (room, vehicle, desk, equipment, lab) |
| `calendar.resource_acl` | Who can book a specific resource |
| `calendar.resource_booking` | Time-bounded reservation of a resource against an event |
| `calendar.working_hours` | Per-user configured working hours per day of week |
| `calendar.delegation` | Calendar management delegation |
| `calendar.check_in` | Operational check-in record for shift/maintenance window events |
| `calendar.audit_entry` | Append-only compliance audit (shift, maintenance window) |
| `calendar.booking_link` | Shareable availability link for internal scheduling |

### Modified (Extension)

| File | Change |
|---|---|
| `backend/internal/files/constants.go` | Add `UploadContextCalendar = "calendar"` to `ValidUploadContexts()` |
| `backend/internal/notification/constants.go` | Add `PresenceStatusInMeeting = "in_meeting"`, new notification type and policy_key constants for calendar |
| `backend/database/scripts/schema.sql` | Extend CHECK constraints for notification tables (source_domain, notification_type, policy_key, resource_domain) |

---

## Table Definitions

### `calendar.event`

Central table for all calendar events. A standalone event or the "head" record of a recurring series.

```sql
CREATE TABLE IF NOT EXISTS calendar.event (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    -- Core fields
    title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    description     TEXT,
    event_type      TEXT NOT NULL CHECK (event_type IN (
                        'meeting', 'shift', 'deadline', 'reminder',
                        'out_of_office', 'company_event', 'training',
                        'maintenance_window'
                    )),
    visibility      TEXT NOT NULL DEFAULT 'personal_shared' CHECK (visibility IN (
                        'private', 'personal_shared', 'team', 'org_wide'
                    )),

    -- Time fields (always stored in UTC)
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    all_day         BOOLEAN NOT NULL DEFAULT FALSE,

    -- Location
    location_text   TEXT,           -- Physical address or description
    virtual_link    TEXT,           -- Video conferencing URL

    -- Organizer (creates the event, always an attendee)
    organizer_id    UUID NOT NULL,

    -- Recurrence (null for one-time events)
    recurrence_rule TEXT,           -- RFC 5545 RRULE string (e.g. FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261231T000000Z)
    recurrence_end  TIMESTAMPTZ,    -- Computed from RRULE UNTIL/COUNT for efficient range queries
    series_id       UUID,           -- Self-reference for "this and following" forks; null for head

    -- Exception flag (for instances that are result of recurrence_exception)
    is_exception_instance BOOLEAN NOT NULL DEFAULT FALSE,
    original_start_time   TIMESTAMPTZ,  -- The original time slot this instance replaced

    -- Cross-domain links
    description_document_id UUID,   -- docs.document reference (soft, no FK — lazy created)
    discussion_channel_id   UUID,   -- chat.channel reference (soft, no FK — lazy created)

    -- Compliance flag
    requires_check_in BOOLEAN NOT NULL DEFAULT FALSE,
    requires_evidence BOOLEAN NOT NULL DEFAULT FALSE,

    -- Soft delete
    cancelled_at    TIMESTAMPTZ,
    cancelled_by_id UUID,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_event PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_event_organizer FOREIGN KEY (organization_id, organizer_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_event_end_after_start CHECK (end_time > start_time OR all_day = TRUE)
);

CREATE INDEX IF NOT EXISTS idx_event_org_organizer
    ON calendar.event(organization_id, organizer_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_event_org_time_range
    ON calendar.event(organization_id, start_time, end_time)
    WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_org_series
    ON calendar.event(organization_id, series_id)
    WHERE series_id IS NOT NULL;

COMMENT ON TABLE calendar.event IS
'Calendar events — one-time or recurring series head. Times stored UTC.
Recurring events: recurrence_rule JSONB defines the pattern;
recurrence_exception holds individual instance overrides.
event_type compliance audit: shift and maintenance_window require check_in and audit_entry.';
```

**State machine for cancelled events**: `cancelled_at IS NULL` = active. No separate status field — using a timestamp avoids a mutable state column and preserves the timestamp of cancellation.

---

### `calendar.recurrence_exception`

Records modifications, skips, or cancellations for a specific instance within a recurring series.

```sql
CREATE TABLE IF NOT EXISTS calendar.recurrence_exception (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    -- Series this exception belongs to (points to the series head event)
    series_id           UUID NOT NULL,
    original_start_time TIMESTAMPTZ NOT NULL,   -- The original computed date of this instance

    -- Exception type
    exception_type  TEXT NOT NULL CHECK (exception_type IN (
                        'modified',     -- Instance was changed (title/time/attendees)
                        'skipped',      -- Instance was skipped (deleted) for this date
                        'cancelled'     -- Instance was explicitly cancelled (different from skipped)
                    )),

    -- If modified: points to the new standalone event record
    new_event_id    UUID,

    -- Audit
    changed_by_id   UUID NOT NULL,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    change_scope    TEXT NOT NULL CHECK (change_scope IN (
                        'this_instance', 'this_and_following', 'all'
                    )),

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_recurrence_exception PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_recurrence_exception_series FOREIGN KEY (organization_id, series_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_recurrence_exception_new_event FOREIGN KEY (organization_id, new_event_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_recurrence_exception_changed_by FOREIGN KEY (organization_id, changed_by_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_recurrence_exception_instance
        UNIQUE (organization_id, series_id, original_start_time)
);

CREATE INDEX IF NOT EXISTS idx_recurrence_exception_series
    ON calendar.recurrence_exception(organization_id, series_id, original_start_time);

COMMENT ON TABLE calendar.recurrence_exception IS
'Tracks modifications/skips for specific instances of a recurring event series.
Use series_id + original_start_time to find exceptions when rendering a series.';
```

---

### `calendar.attendee`

Event participant record with RSVP status.

```sql
CREATE TABLE IF NOT EXISTS calendar.attendee (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    event_id        UUID NOT NULL,
    employee_id     UUID NOT NULL,
    role            TEXT NOT NULL DEFAULT 'required' CHECK (role IN ('required', 'optional', 'organizer')),
    rsvp_status     TEXT NOT NULL DEFAULT 'pending' CHECK (rsvp_status IN (
                        'pending', 'accepted', 'declined', 'tentative'
                    )),
    response_time   TIMESTAMPTZ,
    response_note   TEXT,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_attendee PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_attendee_event FOREIGN KEY (organization_id, event_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_attendee_employee FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_attendee_event_employee UNIQUE (organization_id, event_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_attendee_org_employee_event
    ON calendar.attendee(organization_id, employee_id, event_id);

CREATE INDEX IF NOT EXISTS idx_attendee_org_event
    ON calendar.attendee(organization_id, event_id);

COMMENT ON TABLE calendar.attendee IS
'Event participants. Organizer gets a row with role=organizer and rsvp_status=accepted.
RSVP status resets to pending when event time/location changes (FR-042).';
```

---

### `calendar.resource`

Bookable physical resource (meeting room, vehicle, equipment, desk, lab).

```sql
CREATE TABLE IF NOT EXISTS calendar.resource (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    name            TEXT NOT NULL,
    resource_type   TEXT NOT NULL CHECK (resource_type IN (
                        'room', 'vehicle', 'equipment', 'desk', 'lab'
                    )),
    location        TEXT,           -- Building, floor, or address
    capacity        INT,            -- For rooms: max people; NULL for non-capacity resources
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_resource PRIMARY KEY (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_resource_org_type_active
    ON calendar.resource(organization_id, resource_type, is_active);

COMMENT ON TABLE calendar.resource IS
'Bookable resources: rooms, vehicles, equipment, desks, labs.
Deactivated resources (is_active=FALSE) show a warning on existing future events.';
```

---

### `calendar.resource_acl`

Per-resource booking permission (who can book it). If no ACL rows exist for a resource, any org member can book it (open by default).

```sql
CREATE TABLE IF NOT EXISTS calendar.resource_acl (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    resource_id         UUID NOT NULL,
    -- Either employee_id OR department_id must be set (not both)
    employee_id         UUID,
    department_id       UUID,
    can_book            BOOLEAN NOT NULL DEFAULT TRUE,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_resource_acl PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_resource_acl_resource FOREIGN KEY (organization_id, resource_id)
        REFERENCES calendar.resource(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_resource_acl_employee FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_resource_acl_target CHECK (
        (employee_id IS NOT NULL AND department_id IS NULL) OR
        (employee_id IS NULL AND department_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_resource_acl_resource
    ON calendar.resource_acl(organization_id, resource_id);

COMMENT ON TABLE calendar.resource_acl IS
'Per-resource booking permissions. No rows = open to all org members.
Either employee_id or department_id is set (not both).';
```

---

### `calendar.resource_booking`

Time-bounded reservation of a resource against an event.

```sql
CREATE TABLE IF NOT EXISTS calendar.resource_booking (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    resource_id     UUID NOT NULL,
    event_id        UUID NOT NULL,
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    booked_by_id    UUID NOT NULL,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_resource_booking PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_resource_booking_resource FOREIGN KEY (organization_id, resource_id)
        REFERENCES calendar.resource(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_resource_booking_event FOREIGN KEY (organization_id, event_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_resource_booking_booked_by FOREIGN KEY (organization_id, booked_by_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT
);

-- Index used by conflict detection query (SELECT FOR UPDATE)
CREATE INDEX IF NOT EXISTS idx_resource_booking_resource_time
    ON calendar.resource_booking(organization_id, resource_id, start_time, end_time);

COMMENT ON TABLE calendar.resource_booking IS
'Resource reservations. Conflict detection uses SELECT FOR UPDATE on rows with overlapping
tstzrange. Citus shard co-location on organization_id ensures single-shard transactions.
Released automatically when event is cancelled (via ON DELETE CASCADE on event_id FK).';
```

---

### `calendar.working_hours`

Per-user configured working hours per day of week.

```sql
CREATE TABLE IF NOT EXISTS calendar.working_hours (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    employee_id     UUID NOT NULL,
    day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),   -- ISO: 1=Mon, 7=Sun
    start_time      TIME NOT NULL,   -- Local working day start
    end_time        TIME NOT NULL,   -- Local working day end
    is_working_day  BOOLEAN NOT NULL DEFAULT TRUE,
    timezone        TEXT NOT NULL DEFAULT 'UTC',

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_working_hours PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_working_hours_employee FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_working_hours_employee_day UNIQUE (organization_id, employee_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_working_hours_employee
    ON calendar.working_hours(organization_id, employee_id);

COMMENT ON TABLE calendar.working_hours IS
'Per-user working hours per ISO day of week (1=Mon, 7=Sun).
Used by scheduling assistant for free/busy computation.
timezone is IANA name (e.g., "Asia/Ho_Chi_Minh"). Defaults to UTC.';
```

---

### `calendar.delegation`

Allows one user to manage another user's calendar (create/edit/cancel events on their behalf).

```sql
CREATE TABLE IF NOT EXISTS calendar.delegation (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    owner_id        UUID NOT NULL,   -- Whose calendar is delegated
    delegate_id     UUID NOT NULL,   -- Who has management rights
    can_create      BOOLEAN NOT NULL DEFAULT TRUE,
    can_modify      BOOLEAN NOT NULL DEFAULT TRUE,
    can_cancel      BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at      TIMESTAMPTZ,     -- NULL = indefinite

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_delegation PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_delegation_owner FOREIGN KEY (organization_id, owner_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_delegation_delegate FOREIGN KEY (organization_id, delegate_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_delegation_owner_delegate UNIQUE (organization_id, owner_id, delegate_id)
);

CREATE INDEX IF NOT EXISTS idx_delegation_delegate
    ON calendar.delegation(organization_id, delegate_id);

COMMENT ON TABLE calendar.delegation IS
'Calendar management delegation. delegate_id can act on behalf of owner_id.
Audit records (calendar.audit_entry) capture the delegate identity.';
```

---

### `calendar.check_in`

Operational check-in record for shift / maintenance window events (FR-045, FR-046).

```sql
CREATE TABLE IF NOT EXISTS calendar.check_in (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    event_id        UUID NOT NULL,
    employee_id     UUID NOT NULL,
    checked_in_at   TIMESTAMPTZ NOT NULL,
    is_late         BOOLEAN NOT NULL DEFAULT FALSE,   -- TRUE if checked in after event end_time

    -- Evidence files (soft references to files.file_metadata by UUID)
    evidence_file_ids UUID[] NOT NULL DEFAULT '{}',
    submitted_at    TIMESTAMPTZ,   -- When evidence was finalized/submitted

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_check_in PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_check_in_event FOREIGN KEY (organization_id, event_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_check_in_employee FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_check_in_event_employee UNIQUE (organization_id, event_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_check_in_event
    ON calendar.check_in(organization_id, event_id);

COMMENT ON TABLE calendar.check_in IS
'Operational check-in records. evidence_file_ids is a UUID array (soft refs to files.file_metadata,
no FK constraint). is_late=TRUE when checked in after event end_time (allowed, flagged in audit).';
```

---

### `calendar.audit_entry`

Append-only compliance audit trail for shift and maintenance window events (FR-048).

```sql
CREATE TABLE IF NOT EXISTS calendar.audit_entry (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    event_id        UUID NOT NULL,
    actor_id        UUID NOT NULL,
    -- For delegated actions, delegate_id records who acted on behalf of actor_id
    delegate_id     UUID,

    action_type     TEXT NOT NULL CHECK (action_type IN (
                        'created', 'modified', 'cancelled',
                        'checked_in', 'evidence_submitted',
                        'acknowledged', 'flagged_unacknowledged',
                        'series_forked', 'instance_skipped'
                    )),
    diff_snapshot   JSONB NOT NULL DEFAULT '{}',   -- Before/after diff for modified
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_audit_entry PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_audit_event FOREIGN KEY (organization_id, event_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_audit_actor FOREIGN KEY (organization_id, actor_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_audit_entry_event_time
    ON calendar.audit_entry(organization_id, event_id, occurred_at DESC);

COMMENT ON TABLE calendar.audit_entry IS
'Append-only compliance audit trail. NEVER delete or update rows — insert only.
Covers: shift, maintenance_window event types (requires_check_in=TRUE events).
diff_snapshot captures before/after JSON diff for modified actions.';
```

---

### `calendar.booking_link`

Shareable availability link for internal scheduling (FR-021, FR-022).

```sql
CREATE TABLE IF NOT EXISTS calendar.booking_link (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    owner_id        UUID NOT NULL,          -- Who owns this availability link
    token           TEXT NOT NULL,          -- Cryptographically secure 32-byte base64url token
    title           TEXT NOT NULL,          -- E.g., "30-min chat with Jane"
    duration_minutes INT NOT NULL,          -- Meeting duration

    -- Available windows: JSONB array of {day_of_week, start_time, end_time, timezone}
    available_windows JSONB NOT NULL DEFAULT '[]',
    -- Date range the link is valid for
    valid_from      DATE NOT NULL,
    valid_until     DATE NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,   -- Hard expiry (can be revoked)

    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'claimed')),

    -- Claimed slot (set when a booking is confirmed)
    claimed_event_id UUID,
    claimed_by_id    UUID,
    claimed_at       TIMESTAMPTZ,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_booking_link PRIMARY KEY (organization_id, id),
    CONSTRAINT uq_booking_link_token UNIQUE (organization_id, token),
    CONSTRAINT fk_booking_link_owner FOREIGN KEY (organization_id, owner_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    -- No FK on claimed_event_id: Citus does not support ON DELETE SET NULL on distributed tables.
    -- Application layer nullifies claimed_event_id when the claimed event is cancelled.
    CONSTRAINT fk_booking_link_owner FOREIGN KEY (organization_id, owner_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE
);

SELECT create_distributed_table('calendar.booking_link', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_booking_link_token
    ON calendar.booking_link(organization_id, token)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_booking_link_owner
    ON calendar.booking_link(organization_id, owner_id, expires_at)
    WHERE status = 'active';

COMMENT ON TABLE calendar.booking_link IS
'Internal-only booking links. Token is base64url(32 cryptographically random bytes).
claimed_event_id set when recipient claims a slot; status changes to claimed.
Concurrent claims resolved via SELECT FOR UPDATE on this row.
claimed_event_id has NO FK (Citus: ON DELETE SET NULL not supported on distributed tables);
application layer clears the field when the claimed event is cancelled.';
```

---

---

### `calendar.event_reminder`

Staging table consumed by `CalendarReminderWorkflow`. One durable row per attendee reminder. Rows are polled by the workflow (fire_at <= now()) and fired as notifications.

```sql
CREATE TABLE IF NOT EXISTS calendar.event_reminder (
    id                      UUID        NOT NULL DEFAULT uuidv7(),
    organization_id         UUID        NOT NULL REFERENCES public.organization(id),

    event_id                UUID        NOT NULL,
    attendee_employee_id    UUID        NOT NULL,
    reminder_offset_minutes INT         NOT NULL DEFAULT 15,
    fire_at                 TIMESTAMPTZ NOT NULL,  -- event.start_time - reminder_offset_minutes
    status                  TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
                                            'pending', 'sent', 'cancelled'
                                        )),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_event_reminder PRIMARY KEY (organization_id, id),
    CONSTRAINT uq_calendar_event_reminder_event_employee
        UNIQUE (organization_id, event_id, attendee_employee_id),
    CONSTRAINT fk_calendar_event_reminder_event
        FOREIGN KEY (organization_id, event_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE
);

SELECT create_distributed_table('calendar.event_reminder', 'organization_id', colocate_with => 'public.organization');

-- Workflow polling index: pending reminders ready to fire
CREATE INDEX IF NOT EXISTS idx_calendar_event_reminder_pending
    ON calendar.event_reminder(organization_id, fire_at)
    WHERE status = 'pending';

COMMENT ON TABLE calendar.event_reminder IS
'Staging table for CalendarReminderWorkflow. Regular (not UNLOGGED) — reminder durability required.
Workflow polls pending rows where fire_at <= now(), fires notification via hub, marks sent.';
```

---

## Cross-Schema Notification Migrations

The following CHECK constraints on existing notification tables must be extended for calendar event support (research U7). These are paired migration files, not new tables.

### `notification.notification.source_domain` — add `'calendar'`

```sql
ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_source_domain_valid,
    ADD CONSTRAINT notification_source_domain_valid
        CHECK (source_domain IN (
            'chat', 'crm', 'projects', 'hr', 'support', 'finance', 'docs', 'system', 'calendar'
        ));
```

### `notification.notification.notification_type` — add calendar types

```sql
ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_notification_type_valid,
    ADD CONSTRAINT notification_notification_type_valid
        CHECK (notification_type IN (
            'message', 'mention', 'reply', 'typing', 'reaction',
            'task_assigned', 'task_status_changed', 'task_commented',
            'task_mentioned', 'task_description_modified', 'task_updated',
            'doc_updated', 'doc_commented', 'doc_mentioned',
            'ritual_instance_assigned', 'evidence_submitted',
            'evidence_approved', 'evidence_rejected',
            'ritual_instance_overdue', 'ritual_instance_missed',
            'calendar_event_invite', 'calendar_event_cancel', 'calendar_event_change',
            'calendar_event_reminder', 'calendar_check_in_missed', 'calendar_event_digest'
        ));
```

### `notification.notification.policy_key` — add calendar policy keys

```sql
ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_policy_key_valid,
    ADD CONSTRAINT notification_policy_key_valid
        CHECK (policy_key IN (
            'persistent_default', 'chat_message', 'chat_mention', 'chat_reply',
            'chat_typing_live', 'chat_reaction_live',
            'task_assignment', 'task_comment', 'task_mention',
            'task_status', 'task_description_modified', 'task_update',
            'document_update', 'document_comment', 'document_mention',
            'calendar_event_invite', 'calendar_event_cancel', 'calendar_event_change',
            'calendar_event_reminder', 'calendar_check_in_missed', 'calendar_event_digest'
        ));
```

### `notification.resource_subscription.resource_domain` — add `'calendar_event'`

```sql
ALTER TABLE notification.resource_subscription
    DROP CONSTRAINT IF EXISTS resource_subscription_domain_valid,
    ADD CONSTRAINT resource_subscription_domain_valid
        CHECK (resource_domain IN ('task', 'document', 'channel', 'calendar_event'));
```

### `notification.active_connection.presence_status` — add `'in_meeting'` (research U3)

```sql
ALTER TABLE notification.active_connection
    DROP CONSTRAINT IF EXISTS presence_status_valid,
    ADD CONSTRAINT presence_status_valid
        CHECK (presence_status IN ('online', 'online_hidden', 'idle', 'offline', 'in_meeting'));
```

---

## Recurrence Rule Format (RFC 5545 RRULE)

The `calendar.event.recurrence_rule` column stores a standard RFC 5545 RRULE string. Parsed and expanded via `github.com/teambition/rrule-go` in the logic layer.

| FR-014 Pattern | RRULE Example |
|---|---|
| Daily | `FREQ=DAILY;INTERVAL=1` |
| Weekly (Mon + Wed) | `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE` |
| Bi-weekly | `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO` |
| Monthly by date (15th) | `FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15` |
| Monthly by day (3rd Monday) | `FREQ=MONTHLY;INTERVAL=1;BYDAY=MO;BYSETPOS=3` |
| Annually | `FREQ=YEARLY;INTERVAL=1` |
| With UNTIL date | append `;UNTIL=20261231T000000Z` |
| With COUNT | append `;COUNT=10` |

The library handles DST transitions and leap-year edge cases. `recurrence_end` is populated by the logic layer by extracting the UNTIL date or computing the Nth occurrence date from COUNT, enabling efficient range queries without full RRULE expansion.

---

## Entity Relationship Summary

```
calendar.event
  ├── (organizer_id) → organization.employee
  ├── calendar.attendee [1..N — one per participant]
  │     └── (employee_id) → organization.employee
  ├── calendar.resource_booking [0..N — one per booked resource]
  │     └── (resource_id) → calendar.resource
  ├── calendar.recurrence_exception [0..N — for recurring series]
  ├── calendar.check_in [0..N — for compliance event types]
  └── calendar.audit_entry [0..N — append-only log]

calendar.working_hours [7 rows per employee, one per day]
  └── (employee_id) → organization.employee

calendar.delegation
  ├── (owner_id) → organization.employee
  └── (delegate_id) → organization.employee

calendar.booking_link
  ├── (owner_id) → organization.employee
  └── (claimed_event_id) → calendar.event

calendar.resource
  └── calendar.resource_acl [0..N — if no rows: open to all]
```

---

## Constants to Add (Cross-Stack)

### Backend (`backend/internal/notification/constants.go`)

```go
const (
    PresenceStatusInMeeting = "in_meeting"

    NotificationTypeCalendarEventInvite    = "calendar_event_invite"
    NotificationTypeCalendarEventCancel    = "calendar_event_cancel"
    NotificationTypeCalendarEventChange    = "calendar_event_change"
    NotificationTypeCalendarEventReminder  = "calendar_event_reminder"
    NotificationTypeCalendarCheckInMissed  = "calendar_check_in_missed"

    PolicyKeyCalendarEventInvite   = "calendar_event_invite"
    PolicyKeyCalendarEventCancel   = "calendar_event_cancel"
    PolicyKeyCalendarEventChange   = "calendar_event_change"
    PolicyKeyCalendarEventReminder = "calendar_event_reminder"
)

// Source domain constant:
SourceDomainCalendar = "calendar"
```

### Backend (`backend/internal/calendar/constants.go`)

```go
const (
    EventTypeMeeting           = "meeting"
    EventTypeShift             = "shift"
    EventTypeDeadline          = "deadline"
    EventTypeReminder          = "reminder"
    EventTypeOutOfOffice       = "out_of_office"
    EventTypeCompanyEvent      = "company_event"
    EventTypeTraining          = "training"
    EventTypeMaintenanceWindow = "maintenance_window"

    VisibilityPrivate        = "private"
    VisibilityPersonalShared = "personal_shared"
    VisibilityTeam           = "team"
    VisibilityOrgWide        = "org_wide"

    RSVPStatusPending   = "pending"
    RSVPStatusAccepted  = "accepted"
    RSVPStatusDeclined  = "declined"
    RSVPStatusTentative = "tentative"

    AttendeeRoleRequired   = "required"
    AttendeeRoleOptional   = "optional"
    AttendeeRoleOrganizer  = "organizer"

    ResourceTypeRoom      = "room"
    ResourceTypeVehicle   = "vehicle"
    ResourceTypeEquipment = "equipment"
    ResourceTypeDesk      = "desk"
    ResourceTypeLab       = "lab"

    BookingLinkStatusActive  = "active"
    BookingLinkStatusExpired = "expired"
    BookingLinkStatusClaimed = "claimed"

    AuditActionCreated             = "created"
    AuditActionModified            = "modified"
    AuditActionCancelled           = "cancelled"
    AuditActionCheckedIn           = "checked_in"
    AuditActionEvidenceSubmitted   = "evidence_submitted"
    AuditActionAcknowledged        = "acknowledged"
    AuditActionFlaggedUnacked      = "flagged_unacknowledged"
    AuditActionSeriesForked        = "series_forked"
    AuditActionInstanceSkipped     = "instance_skipped"

    ExceptionTypeModified  = "modified"
    ExceptionTypeSkipped   = "skipped"
    ExceptionTypeCancelled = "cancelled"

    ChangeScopeThisInstance    = "this_instance"
    ChangeScopeThisAndFollowing = "this_and_following"
    ChangeScopeAll             = "all"

    // Recurrence: use teambition/rrule-go constants (rrule.DAILY, rrule.WEEKLY, etc.)
    // No local recurrence type constants — rrule-go provides them.

    // Compliance-flagged event types requiring check-in and audit
    ComplianceEventTypes = []string{EventTypeShift, EventTypeMaintenanceWindow}
)
```

### Frontend (`packages/apis/src/calendar.ts`)

```typescript
export type EventType =
  | 'meeting' | 'shift' | 'deadline' | 'reminder'
  | 'out_of_office' | 'company_event' | 'training' | 'maintenance_window';

export type EventVisibility = 'private' | 'personal_shared' | 'team' | 'org_wide';

export type RSVPStatus = 'pending' | 'accepted' | 'declined' | 'tentative';

export type ResourceType = 'room' | 'vehicle' | 'equipment' | 'desk' | 'lab';

export type BookingLinkStatus = 'active' | 'expired' | 'claimed';
```

---

## Permissions Added to Schema

New permissions inserted into `public.permission`:

```sql
-- Calendar domain permissions
INSERT INTO public.permission (key, domain, description) VALUES
  ('calendar.viewEvent',      'calendar', 'View calendar events visible to the user'),
  ('calendar.createEvent',    'calendar', 'Create calendar events'),
  ('calendar.updateEvent',    'calendar', 'Update calendar events the user owns or is delegated to'),
  ('calendar.deleteEvent',    'calendar', 'Cancel/delete calendar events'),
  ('calendar.manageResource', 'calendar', 'Create, edit, deactivate bookable resources'),
  ('calendar.manageACL',      'calendar', 'Configure who can book a resource'),
  ('calendar.viewAudit',      'calendar', 'View compliance audit entries'),
  ('calendar.viewCheckIn',    'calendar', 'View check-in records for operational events'),
  ('calendar.manageDelegate', 'calendar', 'Grant or revoke calendar delegation')
ON CONFLICT DO NOTHING;
```

Default role assignments (added to `public.default_role_permission`):
- **Owner + Admin**: All calendar permissions
- **Operator**: `viewEvent`, `createEvent`, `updateEvent`, `deleteEvent`, `manageResource`, `manageACL`, `viewCheckIn`
- **Employee**: `viewEvent`, `createEvent`, `updateEvent`, `deleteEvent`
