-- Index for filtering states by type within a project
CREATE INDEX IF NOT EXISTS idx_state_project_type
    ON collaboration.project_state(organization_id, project_id, state_type, position);
