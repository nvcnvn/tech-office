-- Rollback state_type column from collaboration.project_state
ALTER TABLE collaboration.project_state DROP COLUMN IF EXISTS state_type;
