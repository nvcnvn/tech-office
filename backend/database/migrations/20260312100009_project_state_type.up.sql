-- Add state_type column to collaboration.project_state
-- Distinguishes standard workflow states from ritual workflow states
-- Used for dual swim lane board view in mixed projects
ALTER TABLE collaboration.project_state
    ADD COLUMN IF NOT EXISTS state_type TEXT NOT NULL DEFAULT 'standard';
