-- T003 rollback: Remove ritual columns from collaboration.task
DROP INDEX IF EXISTS collaboration.idx_task_ritual_today;
ALTER TABLE collaboration.task DROP CONSTRAINT IF EXISTS task_kind_check;
ALTER TABLE collaboration.task
    DROP COLUMN IF EXISTS skip_reason,
    DROP COLUMN IF EXISTS completion_deadline,
    DROP COLUMN IF EXISTS scheduled_date,
    DROP COLUMN IF EXISTS ritual_definition_id,
    DROP COLUMN IF EXISTS task_kind;
