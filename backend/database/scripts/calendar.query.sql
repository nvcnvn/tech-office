-- Calendar SQL Queries
-- For use with sqlc code generation
-- File: backend/database/scripts/calendar.query.sql

-- =============================================================================
-- EVENT QUERIES
-- =============================================================================

-- name: InsertEvent :one
INSERT INTO calendar.event (
    id, organization_id, title, description, event_type, visibility,
    start_time, end_time, all_day, location_text, virtual_link, organizer_id,
    recurrence_rule, recurrence_end, series_id,
    is_exception_instance, original_start_time,
    description_document_id, discussion_channel_id,
    requires_check_in, requires_evidence, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12,
    sqlc.narg('recurrence_rule'), sqlc.narg('recurrence_end'), sqlc.narg('series_id'),
    $13, sqlc.narg('original_start_time'),
    sqlc.narg('description_document_id'), sqlc.narg('discussion_channel_id'),
    $14, $15, $16
)
RETURNING *;

-- name: GetEvent :one
SELECT * FROM calendar.event
WHERE organization_id = $1 AND id = $2;

-- name: ListEventsForEmployee :many
-- Overlap test: an event is in range when it starts before the range ends and ends
-- after the range begins. The bounds are named for the RANGE, not for the column they
-- are compared against — naming them start_time/end_time inverts their meaning and is
-- exactly the mix-up that returns an empty list.
SELECT e.* FROM calendar.event e
LEFT JOIN calendar.attendee a
    ON a.organization_id = e.organization_id
 AND a.event_id = e.id
 AND a.employee_id = @employee_id
WHERE e.organization_id = @organization_id
    AND (e.organizer_id = @employee_id OR a.employee_id IS NOT NULL)
  AND e.start_time < @range_end
  AND e.end_time > @range_start
  AND e.cancelled_at IS NULL
ORDER BY e.start_time ASC;

-- name: ListEventsForOrg :many
-- Bounds are named for the range; see ListEventsForEmployee.
SELECT * FROM calendar.event
WHERE organization_id = @organization_id
  AND start_time < @range_end
  AND end_time > @range_start
  AND cancelled_at IS NULL
  AND visibility IN ('team', 'org_wide')
ORDER BY start_time ASC;

-- name: UpdateEvent :one
UPDATE calendar.event
SET
    title           = COALESCE(sqlc.narg('title'), title),
    description     = COALESCE(sqlc.narg('description'), description),
    event_type      = COALESCE(sqlc.narg('event_type'), event_type),
    visibility      = COALESCE(sqlc.narg('visibility'), visibility),
    start_time      = COALESCE(sqlc.narg('start_time'), start_time),
    end_time        = COALESCE(sqlc.narg('end_time'), end_time),
    all_day         = COALESCE(sqlc.narg('all_day'), all_day),
    location_text   = sqlc.narg('location_text'),
    virtual_link    = sqlc.narg('virtual_link'),
    recurrence_rule = COALESCE(sqlc.narg('recurrence_rule'), recurrence_rule),
    recurrence_end  = COALESCE(sqlc.narg('recurrence_end'), recurrence_end),
    updated_at      = $3
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: CancelEvent :one
UPDATE calendar.event
SET
    cancelled_at    = $3,
    cancelled_by_id = $4,
    updated_at      = $3
WHERE organization_id = $1 AND id = $2
  AND cancelled_at IS NULL
RETURNING *;

-- name: SearchEvents :many
SELECT * FROM calendar.event
WHERE organization_id = $1
  AND cancelled_at IS NULL
  AND to_tsvector('simple', title || ' ' || coalesce(description, '')) @@ websearch_to_tsquery('simple', $2)
  AND (sqlc.narg('event_type')::text IS NULL OR event_type = sqlc.narg('event_type'))
  AND (sqlc.narg('from_time')::timestamptz IS NULL OR start_time >= sqlc.narg('from_time'))
  AND (sqlc.narg('until_time')::timestamptz IS NULL OR end_time <= sqlc.narg('until_time'))
  AND (sqlc.narg('cursor')::uuid IS NULL OR id < sqlc.narg('cursor'))
ORDER BY updated_at DESC, id DESC
LIMIT $3;

-- =============================================================================
-- ATTENDEE QUERIES
-- =============================================================================

-- name: InsertAttendee :one
INSERT INTO calendar.attendee (
    id, organization_id, event_id, employee_id, role, rsvp_status, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (organization_id, event_id, employee_id) DO NOTHING
RETURNING *;

-- name: ListAttendees :many
SELECT * FROM calendar.attendee
WHERE organization_id = $1 AND event_id = $2
ORDER BY role DESC, updated_at ASC;

-- name: UpdateAttendeeRSVP :one
UPDATE calendar.attendee
SET
    rsvp_status   = $4,
    response_time = $5,
    response_note = sqlc.narg('response_note'),
    updated_at    = $5
WHERE organization_id = $1 AND event_id = $2 AND employee_id = $3
RETURNING *;

-- name: ResetAttendeesRSVP :exec
UPDATE calendar.attendee
SET rsvp_status = 'pending', response_time = NULL, response_note = NULL, updated_at = $3
WHERE organization_id = $1 AND event_id = $2 AND role != 'organizer';

-- =============================================================================
-- RECURRENCE EXCEPTION QUERIES
-- =============================================================================

-- name: InsertRecurrenceException :one
INSERT INTO calendar.recurrence_exception (
    id, organization_id, series_id, original_start_time,
    exception_type, new_event_id, changed_by_id, changed_at, change_scope, updated_at
) VALUES (
    $1, $2, $3, $4, $5, sqlc.narg('new_event_id'), $6, $7, $8, $7
)
RETURNING *;

-- name: InsertResource :one
INSERT INTO calendar.resource (
    id, organization_id, name, resource_type, location, capacity, is_active, updated_at
) VALUES (
    $1, $2, $3, $4, sqlc.narg('location'), sqlc.narg('capacity'), TRUE, $5
)
RETURNING *;

-- name: GetResource :one
SELECT * FROM calendar.resource
WHERE organization_id = $1 AND id = $2;

-- name: ListResources :many
SELECT * FROM calendar.resource
WHERE organization_id = $1
  AND (sqlc.narg('resource_type')::text IS NULL OR resource_type = sqlc.narg('resource_type'))
  AND (sqlc.narg('min_capacity')::int IS NULL OR capacity >= sqlc.narg('min_capacity'))
  AND is_active = TRUE
ORDER BY name ASC;

-- name: UpdateResource :one
UPDATE calendar.resource
SET
    name          = COALESCE(sqlc.narg('name'), name),
    location      = sqlc.narg('location'),
    capacity      = sqlc.narg('capacity'),
    is_active     = COALESCE(sqlc.narg('is_active'), is_active),
    updated_at    = $3
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- =============================================================================
-- RESOURCE ACL QUERIES
-- =============================================================================

-- name: UpsertResourceACL :one
INSERT INTO calendar.resource_acl (
    id, organization_id, resource_id, employee_id, department_id, can_book, updated_at
) VALUES (
    $1, $2, $3, sqlc.narg('employee_id'), sqlc.narg('department_id'), $4, $5
)
RETURNING *;

-- name: DeleteResourceACLForResource :exec
DELETE FROM calendar.resource_acl
WHERE organization_id = $1 AND resource_id = $2;

-- name: ListResourceACLEntries :many
SELECT * FROM calendar.resource_acl
WHERE organization_id = $1 AND resource_id = $2;

-- =============================================================================
-- RESOURCE BOOKING QUERIES
-- =============================================================================

-- name: InsertResourceBooking :one
INSERT INTO calendar.resource_booking (
    id, organization_id, resource_id, event_id, start_time, end_time, booked_by_id, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING *;

-- name: DetectResourceConflict :many
-- Bounds are named for the range; see ListEventsForEmployee.
SELECT * FROM calendar.resource_booking
WHERE organization_id = @organization_id
  AND resource_id = @resource_id
  AND start_time < @range_end
  AND end_time > @range_start
  AND event_id != @event_id
FOR UPDATE;

-- name: DeleteResourceBookingsForEvent :exec
DELETE FROM calendar.resource_booking
WHERE organization_id = $1 AND event_id = $2;

-- name: ListResourceBookingsForEvent :many
SELECT rb.*, r.name AS resource_name
FROM calendar.resource_booking rb
JOIN calendar.resource r ON r.id = rb.resource_id AND r.organization_id = rb.organization_id
WHERE rb.organization_id = $1 AND rb.event_id = $2
ORDER BY rb.start_time ASC;

-- =============================================================================
-- WORKING HOURS QUERIES
-- =============================================================================

-- name: UpsertWorkingHours :one
INSERT INTO calendar.working_hours (
    id, organization_id, employee_id, day_of_week, start_time, end_time, is_working_day, timezone, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
ON CONFLICT (organization_id, employee_id, day_of_week)
DO UPDATE SET
    start_time     = EXCLUDED.start_time,
    end_time       = EXCLUDED.end_time,
    is_working_day = EXCLUDED.is_working_day,
    timezone       = EXCLUDED.timezone,
    updated_at     = EXCLUDED.updated_at
RETURNING *;

-- name: ListWorkingHours :many
SELECT * FROM calendar.working_hours
WHERE organization_id = $1 AND employee_id = $2
ORDER BY day_of_week ASC;

-- =============================================================================
-- DELEGATION QUERIES
-- =============================================================================

-- name: InsertDelegation :one
INSERT INTO calendar.delegation (
    id, organization_id, owner_id, delegate_id,
    can_create, can_modify, can_cancel, expires_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, sqlc.narg('expires_at'), $8
)
RETURNING *;

-- name: GetDelegation :one
SELECT * FROM calendar.delegation
WHERE organization_id = $1 AND owner_id = $2 AND delegate_id = $3;

-- name: DeleteDelegation :exec
DELETE FROM calendar.delegation
WHERE organization_id = $1 AND owner_id = $2 AND delegate_id = $3;

-- name: ListDelegationsByDelegate :many
SELECT * FROM calendar.delegation
WHERE organization_id = $1 AND delegate_id = $2
  AND (expires_at IS NULL OR expires_at > $3)
ORDER BY updated_at DESC;

-- =============================================================================
-- CHECK-IN QUERIES
-- =============================================================================

-- name: InsertCheckIn :one
INSERT INTO calendar.check_in (
    id, organization_id, event_id, employee_id, checked_in_at, is_late, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $5
)
RETURNING *;

-- name: UpdateCheckInEvidence :one
UPDATE calendar.check_in
SET
    evidence_file_ids = $4,
    submitted_at      = $5,
    updated_at        = $5
WHERE organization_id = $1 AND event_id = $2 AND employee_id = $3
RETURNING *;

-- name: InsertAuditEntry :one
INSERT INTO calendar.audit_entry (
    id, organization_id, event_id, actor_id, delegate_id, action_type, diff_snapshot, occurred_at
) VALUES (
    $1, $2, $3, $4, sqlc.narg('delegate_id'), $5, $6, $7
)
RETURNING *;

-- name: ListAuditEntries :many
SELECT * FROM calendar.audit_entry
WHERE organization_id = $1 AND event_id = $2
  AND (sqlc.narg('cursor')::uuid IS NULL OR id < sqlc.narg('cursor'))
ORDER BY occurred_at DESC, id DESC
LIMIT $3;

-- =============================================================================
-- BOOKING LINK QUERIES
-- =============================================================================

-- name: InsertBookingLink :one
INSERT INTO calendar.booking_link (
    id, organization_id, owner_id, token, title, duration_minutes,
    available_windows, valid_from, valid_until, expires_at, status, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11
)
RETURNING *;

-- name: GetBookingLinkByToken :one
SELECT * FROM calendar.booking_link
WHERE organization_id = $1 AND token = $2;

-- name: ClaimBookingLink :one
UPDATE calendar.booking_link
SET
    status           = 'claimed',
    claimed_event_id = $4,
    claimed_by_id    = $5,
    claimed_at       = $6,
    updated_at       = $6
WHERE organization_id = $1 AND id = $2 AND status = 'active'
  AND (expires_at IS NULL OR expires_at > $3)
RETURNING *;

-- =============================================================================
-- EVENT REMINDER QUERIES
-- =============================================================================

-- name: InsertEventReminder :one
INSERT INTO calendar.event_reminder (
    id, organization_id, event_id, attendee_employee_id,
    reminder_offset_minutes, fire_at, status, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, 'pending', $7
)
ON CONFLICT (organization_id, event_id, attendee_employee_id) DO NOTHING
RETURNING *;

-- name: UpdateEventReminderStatus :exec
UPDATE calendar.event_reminder
SET status = $4
WHERE organization_id = $1 AND event_id = $2 AND attendee_employee_id = $3;

-- name: CancelRemindersForEvent :exec
UPDATE calendar.event_reminder
SET status = 'cancelled'
WHERE organization_id = $1 AND event_id = $2 AND status = 'pending';

-- lint:cross-tenant scheduler sweep over every organization's due reminders; runs on AdminPool
-- The event title is joined in because a reminder that does not name the event it is for
-- is unactionable on a lock screen, where the notification body is all the user sees.
-- name: ListPendingRemindersGlobal :many
SELECT r.*, e.title AS event_title
FROM calendar.event_reminder r
JOIN calendar.event e ON (e.organization_id, e.id) = (r.organization_id, r.event_id)
WHERE r.status = 'pending'
  AND r.fire_at <= $1
ORDER BY r.fire_at ASC
LIMIT $2;
