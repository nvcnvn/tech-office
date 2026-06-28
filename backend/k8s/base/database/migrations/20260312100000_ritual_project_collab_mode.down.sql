-- T001 rollback: Remove collaboration_mode column
DROP INDEX IF EXISTS collaboration.idx_project_collab_mode;
ALTER TABLE collaboration.project DROP CONSTRAINT IF EXISTS project_collaboration_mode_check;
ALTER TABLE collaboration.project DROP COLUMN IF EXISTS collaboration_mode;
