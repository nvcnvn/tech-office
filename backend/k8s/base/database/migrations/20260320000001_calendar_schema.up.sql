-- Migration: Create calendar schema tables (Feature 026)
-- Direction: UP

CREATE TABLE IF NOT EXISTS calendar.event (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

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

    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    all_day         BOOLEAN NOT NULL DEFAULT FALSE,

    location_text   TEXT,
    virtual_link    TEXT,

    organizer_id    UUID NOT NULL,

    recurrence_rule TEXT,
    recurrence_end  TIMESTAMPTZ,
    series_id       UUID,

    is_exception_instance BOOLEAN NOT NULL DEFAULT FALSE,
    original_start_time   TIMESTAMPTZ,

    description_document_id UUID,
    discussion_channel_id   UUID,

    requires_check_in BOOLEAN NOT NULL DEFAULT FALSE,
    requires_evidence BOOLEAN NOT NULL DEFAULT FALSE,

    cancelled_at    TIMESTAMPTZ,
    cancelled_by_id UUID,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_event PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_event_organizer FOREIGN KEY (organization_id, organizer_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT chk_event_end_after_start CHECK (end_time > start_time OR all_day = TRUE)
);

SELECT create_distributed_table('calendar.event', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_event_org_organizer
    ON calendar.event(organization_id, organizer_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_event_org_time_range
    ON calendar.event(organization_id, start_time, end_time)
    WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_org_series
    ON calendar.event(organization_id, series_id)
    WHERE series_id IS NOT NULL;

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.recurrence_exception (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    series_id           UUID NOT NULL,
    original_start_time TIMESTAMPTZ NOT NULL,

    exception_type  TEXT NOT NULL CHECK (exception_type IN (
                        'modified', 'skipped', 'cancelled'
                    )),

    new_event_id    UUID,

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

SELECT create_distributed_table('calendar.recurrence_exception', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_recurrence_exception_series
    ON calendar.recurrence_exception(organization_id, series_id, original_start_time);

-- -----------------------------------------------------------------------------

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

SELECT create_distributed_table('calendar.attendee', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_attendee_org_employee_event
    ON calendar.attendee(organization_id, employee_id, event_id);

CREATE INDEX IF NOT EXISTS idx_attendee_org_event
    ON calendar.attendee(organization_id, event_id);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.resource (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    name            TEXT NOT NULL,
    resource_type   TEXT NOT NULL CHECK (resource_type IN (
                        'room', 'vehicle', 'equipment', 'desk', 'lab'
                    )),
    location        TEXT,
    capacity        INT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_resource PRIMARY KEY (organization_id, id)
);

SELECT create_distributed_table('calendar.resource', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_resource_org_type_active
    ON calendar.resource(organization_id, resource_type, is_active);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.resource_acl (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    resource_id         UUID NOT NULL,
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

SELECT create_distributed_table('calendar.resource_acl', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_resource_acl_resource
    ON calendar.resource_acl(organization_id, resource_id);

-- -----------------------------------------------------------------------------

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

SELECT create_distributed_table('calendar.resource_booking', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_resource_booking_resource_time
    ON calendar.resource_booking(organization_id, resource_id, start_time, end_time);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.working_hours (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    employee_id     UUID NOT NULL,
    day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    is_working_day  BOOLEAN NOT NULL DEFAULT TRUE,
    timezone        TEXT NOT NULL DEFAULT 'UTC',

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_working_hours PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_working_hours_employee FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_working_hours_employee_day UNIQUE (organization_id, employee_id, day_of_week)
);

SELECT create_distributed_table('calendar.working_hours', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_working_hours_employee
    ON calendar.working_hours(organization_id, employee_id);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.delegation (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    owner_id        UUID NOT NULL,
    delegate_id     UUID NOT NULL,
    can_create      BOOLEAN NOT NULL DEFAULT TRUE,
    can_modify      BOOLEAN NOT NULL DEFAULT TRUE,
    can_cancel      BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at      TIMESTAMPTZ,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_delegation PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_delegation_owner FOREIGN KEY (organization_id, owner_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_delegation_delegate FOREIGN KEY (organization_id, delegate_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_delegation_owner_delegate UNIQUE (organization_id, owner_id, delegate_id)
);

SELECT create_distributed_table('calendar.delegation', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_delegation_delegate
    ON calendar.delegation(organization_id, delegate_id);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.check_in (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    event_id        UUID NOT NULL,
    employee_id     UUID NOT NULL,
    checked_in_at   TIMESTAMPTZ NOT NULL,
    is_late         BOOLEAN NOT NULL DEFAULT FALSE,

    evidence_file_ids UUID[] NOT NULL DEFAULT '{}',
    submitted_at    TIMESTAMPTZ,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_check_in PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_check_in_event FOREIGN KEY (organization_id, event_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_check_in_employee FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT uq_check_in_event_employee UNIQUE (organization_id, event_id, employee_id)
);

SELECT create_distributed_table('calendar.check_in', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_check_in_event
    ON calendar.check_in(organization_id, event_id);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.audit_entry (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    event_id        UUID NOT NULL,
    actor_id        UUID NOT NULL,
    delegate_id     UUID,

    action_type     TEXT NOT NULL CHECK (action_type IN (
                        'created', 'modified', 'cancelled',
                        'checked_in', 'evidence_submitted',
                        'acknowledged', 'flagged_unacknowledged',
                        'series_forked', 'instance_skipped'
                    )),
    diff_snapshot   JSONB NOT NULL DEFAULT '{}',
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_audit_entry PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_audit_event FOREIGN KEY (organization_id, event_id)
        REFERENCES calendar.event(organization_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_audit_actor FOREIGN KEY (organization_id, actor_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT
);

SELECT create_distributed_table('calendar.audit_entry', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_audit_entry_event_time
    ON calendar.audit_entry(organization_id, event_id, occurred_at DESC);

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.booking_link (
    id              UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    owner_id        UUID NOT NULL,
    token           TEXT NOT NULL,
    title           TEXT NOT NULL,
    duration_minutes INT NOT NULL,

    available_windows JSONB NOT NULL DEFAULT '[]',
    valid_from      DATE NOT NULL,
    valid_until     DATE NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,

    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'claimed')),

    claimed_event_id UUID,
    claimed_by_id    UUID,
    claimed_at       TIMESTAMPTZ,

    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_calendar_booking_link PRIMARY KEY (organization_id, id),
    CONSTRAINT uq_booking_link_token UNIQUE (organization_id, token),
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

-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS calendar.event_reminder (
    id                      UUID        NOT NULL DEFAULT uuidv7(),
    organization_id         UUID        NOT NULL REFERENCES public.organization(id),

    event_id                UUID        NOT NULL,
    attendee_employee_id    UUID        NOT NULL,
    reminder_offset_minutes INT         NOT NULL DEFAULT 15,
    fire_at                 TIMESTAMPTZ NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_calendar_event_reminder_pending
    ON calendar.event_reminder(organization_id, fire_at)
    WHERE status = 'pending';
