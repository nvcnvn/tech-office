-- Feature 042: ritual assignment follows the shift.
--
-- A department pool can now draw its assignee from whoever is rostered for the
-- instance's scheduled date instead of from a rotation that ignores the rota.
-- Because instances are materialised 30 days ahead and rotas are published a week
-- or two ahead, resolution is late-bound: generation records one row per
-- (ritual instance, department pool) and the ritual_shift_resolution_sweep binds,
-- rebinds and finally escalates it. There is deliberately no fallback strategy —
-- falling back to round_robin is the defect this feature exists to remove.

-- 1. The third strategy.
ALTER TABLE collaboration.ritual_definition_department_pool
    DROP CONSTRAINT IF EXISTS ritual_definition_department_pool_assignment_strategy_check;

ALTER TABLE collaboration.ritual_definition_department_pool
    ADD CONSTRAINT ritual_definition_department_pool_assignment_strategy_check
        CHECK (assignment_strategy IN ('round_robin', 'least_assigned', 'on_shift'));

-- 2. The late-binding record.
CREATE TABLE IF NOT EXISTS collaboration.ritual_instance_pool_assignment (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL REFERENCES public.organization(id),

    -- The ritual instance whose pool slot this row governs.
    task_id uuid NOT NULL,
    -- The department pool that owns the slot. One instance can carry several.
    pool_id uuid NOT NULL,

    resolution_state text DEFAULT 'awaiting_shift' NOT NULL
        CHECK (resolution_state IN ('resolved', 'awaiting_shift', 'closed_unresolved')),

    -- Why a closed row stopped being re-resolved. NULL unless closed.
    closed_reason text
        CHECK (closed_reason IN ('no_roster', 'manual_override')),

    -- The employee THIS feature put in the slot. NULL while awaiting or after
    -- withdrawal. Deliberately no FK, for the same reason last_assigned_employee_id
    -- has none: the employee may leave the department or the organization and the
    -- record must survive that, because it is what proves the slot was not changed
    -- by a person.
    assigned_employee_id uuid,

    -- The instant the instance's scheduled date begins, in the ritual definition's
    -- own timezone. One column, two jobs: resolution is attempted only while
    -- now() < resolve_by, and escalation fires once now() >= resolve_by. Storing the
    -- instant rather than the date keeps every sweep predicate free of timezone
    -- arithmetic in SQL.
    resolve_by timestamp with time zone NOT NULL,

    resolved_at timestamp with time zone,
    escalated_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,

    CONSTRAINT pk_ripa PRIMARY KEY (organization_id, id),

    CONSTRAINT fk_ripa_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ripa_pool
        FOREIGN KEY (organization_id, pool_id)
        REFERENCES collaboration.ritual_definition_department_pool(organization_id, id)
        ON DELETE CASCADE,

    CONSTRAINT uq_ripa_instance_pool
        UNIQUE (organization_id, task_id, pool_id),

    -- A resolved row names its assignee; a closed row names its reason.
    CONSTRAINT chk_ripa_resolved_has_assignee
        CHECK (resolution_state <> 'resolved' OR assigned_employee_id IS NOT NULL),
    CONSTRAINT chk_ripa_closed_has_reason
        CHECK (resolution_state <> 'closed_unresolved' OR closed_reason IS NOT NULL)
);

COMMENT ON TABLE collaboration.ritual_instance_pool_assignment IS
    'Late-binding record for on-shift department pool slots. One row per (ritual instance, pool); the ritual_shift_resolution_sweep binds, rebinds and escalates it.';

-- The sweep's working set: rows still eligible to change. Partial, because a closed
-- row is never read again by the sweep and there will eventually be far more of
-- those than of live ones.
CREATE INDEX IF NOT EXISTS idx_ripa_open
    ON collaboration.ritual_instance_pool_assignment (organization_id, resolve_by, id)
    WHERE resolution_state IN ('awaiting_shift', 'resolved');

-- Reading the state back for a batch of tasks.
CREATE INDEX IF NOT EXISTS idx_ripa_task
    ON collaboration.ritual_instance_pool_assignment (organization_id, task_id);

-- 3. The new notification type.
--
-- TestNotificationTypeCheckMatchesGoConstants asserts this list equals
-- notification.AllNotificationTypes() in backend/internal/notification/constants.go.
ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_notification_type_valid;

ALTER TABLE notification.notification
    ADD CONSTRAINT notification_notification_type_valid CHECK (
        notification_type IN (
            'message',
            'mention',
            'reply',
            'typing',
            'reaction',
            'voice_call_incoming',
            'voice_call_started',
            'voice_call_updated',
            'voice_call_ended',
            'task_assigned',
            'task_status_changed',
            'task_commented',
            'task_mentioned',
            'task_description_modified',
            'task_updated',
            'doc_updated',
            'doc_commented',
            'doc_mentioned',
            'evidence_submitted',
            'evidence_approved',
            'evidence_rejected',
            'ritual_instances_scheduled',
            'ritual_instance_overdue',
            'ritual_instance_missed',
            'ritual_instance_unassigned',
            'calendar_event_invite',
            'calendar_event_cancel',
            'calendar_event_change',
            'calendar_event_reminder',
            'calendar_check_in_missed',
            'calendar_event_digest',
            'account_removal_requested'
        )
    );
