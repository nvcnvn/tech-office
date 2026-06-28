-- T008: Add FK from task to ritual_definition, idempotency index, and extend saved_view view_type
ALTER TABLE collaboration.task
    ADD CONSTRAINT fk_task_ritual_definition
    FOREIGN KEY (organization_id, ritual_definition_id)
    REFERENCES collaboration.ritual_definition(organization_id, id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_ritual_instance_unique
    ON collaboration.task(organization_id, ritual_definition_id, scheduled_date)
    WHERE task_kind = 'ritual_instance' AND ritual_definition_id IS NOT NULL AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_task_ritual_definition
    ON collaboration.task(organization_id, ritual_definition_id, scheduled_date DESC)
    WHERE task_kind = 'ritual_instance' AND is_deleted = FALSE;

-- Extend saved_view view_type to include 'today' and 'health'
ALTER TABLE collaboration.saved_view DROP CONSTRAINT IF EXISTS saved_view_view_type_check;
ALTER TABLE collaboration.saved_view
    ADD CONSTRAINT saved_view_view_type_check
    CHECK (view_type IN ('board', 'list', 'gantt', 'calendar', 'today', 'health'));
