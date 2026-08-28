-- T005: Create collaboration.ritual_definition_assignee table
CREATE TABLE IF NOT EXISTS collaboration.ritual_definition_assignee (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    ritual_definition_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_rda_ritual_def
        FOREIGN KEY (organization_id, ritual_definition_id)
        REFERENCES collaboration.ritual_definition(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rda_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT uq_rda_unique_assignment
        UNIQUE (organization_id, ritual_definition_id, employee_id)
);

SELECT create_distributed_table('collaboration.ritual_definition_assignee', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_rda_definition
    ON collaboration.ritual_definition_assignee(organization_id, ritual_definition_id);
