-- T003: Add ritual columns to collaboration.task (columns only, FK comes in T008)
ALTER TABLE collaboration.task
    ADD COLUMN IF NOT EXISTS task_kind TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE collaboration.task
    ADD CONSTRAINT task_kind_check
    CHECK (task_kind IN ('standard', 'ritual_instance'));
ALTER TABLE collaboration.task
    ADD COLUMN IF NOT EXISTS ritual_definition_id UUID,
    ADD COLUMN IF NOT EXISTS scheduled_date DATE,
    ADD COLUMN IF NOT EXISTS completion_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS skip_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_task_ritual_today
    ON collaboration.task(organization_id, task_kind, completion_deadline)
    WHERE task_kind = 'ritual_instance' AND is_deleted = FALSE;
