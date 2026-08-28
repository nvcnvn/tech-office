-- T001: Add collaboration_mode column to collaboration.project
-- UI display hint for project mode (standard/ritual/mixed)
ALTER TABLE collaboration.project
    ADD COLUMN IF NOT EXISTS collaboration_mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE collaboration.project
    ADD CONSTRAINT project_collaboration_mode_check
    CHECK (collaboration_mode IN ('standard', 'ritual', 'mixed'));

CREATE INDEX IF NOT EXISTS idx_project_collab_mode
    ON collaboration.project(organization_id, collaboration_mode)
    WHERE is_archived = FALSE;
