-- T008 rollback: Remove FK, indices, and restore saved_view constraint
DROP INDEX IF EXISTS collaboration.idx_task_ritual_definition;
DROP INDEX IF EXISTS collaboration.idx_task_ritual_instance_unique;
ALTER TABLE collaboration.task DROP CONSTRAINT IF EXISTS fk_task_ritual_definition;

ALTER TABLE collaboration.saved_view DROP CONSTRAINT IF EXISTS saved_view_view_type_check;
ALTER TABLE collaboration.saved_view
    ADD CONSTRAINT saved_view_view_type_check
    CHECK (view_type IN ('board', 'list', 'gantt', 'calendar'));
