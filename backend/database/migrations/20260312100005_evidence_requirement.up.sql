-- T006: Create collaboration.evidence_requirement table
CREATE TABLE IF NOT EXISTS collaboration.evidence_requirement (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    ritual_definition_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    evidence_types TEXT[] NOT NULL DEFAULT '{}',
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    approval_mode TEXT NOT NULL DEFAULT 'manual' CHECK (approval_mode IN ('manual', 'auto_approve')),
    auto_approve_config JSONB,
    position INT NOT NULL DEFAULT 0,
    deadline_offset_hours INT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_evidence_req_ritual_def
        FOREIGN KEY (organization_id, ritual_definition_id)
        REFERENCES collaboration.ritual_definition(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('collaboration.evidence_requirement', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_evidence_req_definition
    ON collaboration.evidence_requirement(organization_id, ritual_definition_id, position);
