-- Drop CHECK constraint for state_type
ALTER TABLE collaboration.project_state DROP CONSTRAINT IF EXISTS project_state_type_check;
