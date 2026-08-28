-- T007: Create collaboration.evidence_submission table
CREATE TABLE IF NOT EXISTS collaboration.evidence_submission (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    task_id UUID NOT NULL,
    evidence_requirement_id UUID NOT NULL,
    submitted_by_employee_id UUID NOT NULL,
    evidence_type TEXT NOT NULL CHECK (evidence_type IN ('photo', 'voice_memo', 'pdf', 'file', 'link', 'text_note', 'gps_checkin')),
    file_id UUID,
    text_content TEXT,
    link_url TEXT,
    device_timestamp TIMESTAMPTZ,
    server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    gps_latitude DECIMAL(10, 7),
    gps_longitude DECIMAL(10, 7),
    gps_accuracy_meters DECIMAL(8, 2),
    approval_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (approval_status IN ('pending_review', 'approved', 'rejected')),
    reviewed_by_employee_id UUID,
    reviewed_at TIMESTAMPTZ,
    reviewer_comment TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_es_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_es_evidence_req
        FOREIGN KEY (organization_id, evidence_requirement_id)
        REFERENCES collaboration.evidence_requirement(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_es_submitter
        FOREIGN KEY (organization_id, submitted_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_es_reviewer
        FOREIGN KEY (organization_id, reviewed_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('collaboration.evidence_submission', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_evidence_sub_task
    ON collaboration.evidence_submission(organization_id, task_id);

CREATE INDEX IF NOT EXISTS idx_evidence_sub_requirement
    ON collaboration.evidence_submission(organization_id, evidence_requirement_id);

CREATE INDEX IF NOT EXISTS idx_evidence_sub_pending
    ON collaboration.evidence_submission(organization_id, approval_status)
    WHERE approval_status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_evidence_sub_submitter
    ON collaboration.evidence_submission(organization_id, submitted_by_employee_id);
