-- Add CHECK constraint for state_type
ALTER TABLE collaboration.project_state
    ADD CONSTRAINT project_state_type_check CHECK (state_type IN ('standard', 'ritual'));
