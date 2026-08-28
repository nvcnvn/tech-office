-- T004: Create collaboration.ritual_definition table
CREATE TABLE IF NOT EXISTS collaboration.ritual_definition (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    project_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    recurrence_rule JSONB NOT NULL,
    completion_window_hours INT NOT NULL DEFAULT 24 CHECK (completion_window_hours > 0),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_employee_id UUID NOT NULL,
    last_generated_date DATE,
    generation_window_days INT NOT NULL DEFAULT 30,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_ritual_def_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ritual_def_creator
        FOREIGN KEY (organization_id, created_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_ritual_def_project
    ON collaboration.ritual_definition(organization_id, project_id)
    WHERE is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_ritual_def_generation
    ON collaboration.ritual_definition(organization_id, is_archived, last_generated_date)
    WHERE is_archived = FALSE;
