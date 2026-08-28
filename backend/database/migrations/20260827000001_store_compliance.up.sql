-- Migration: App Store & Google Play compliance sweep (Feature 036)
-- Direction: UP
--
-- Adds the compliance domain (content reports, blocks, removal requests, account
-- deletion records), terms-acceptance columns on the global iam.user record, and
-- the four new permissions.

CREATE SCHEMA IF NOT EXISTS compliance;

-- ============================================================================
-- Permissions
-- ============================================================================

INSERT INTO public.permission (id, domain, description) VALUES
('compliance.reportContent', 'compliance', 'Report abusive or objectionable content'),
('compliance.blockPerson', 'compliance', 'Block and unblock direct contact from another person'),
('compliance.reviewReports', 'compliance', 'Review and resolve content reports'),
('compliance.manageRemovalRequests', 'compliance', 'Review and decide account removal requests')
ON CONFLICT (id) DO NOTHING;

-- Owner: all four.
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'owner', id FROM public.permission
WHERE id IN ('compliance.reportContent', 'compliance.blockPerson',
             'compliance.reviewReports', 'compliance.manageRemovalRequests')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Operator: all four.
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'operator', id FROM public.permission
WHERE id IN ('compliance.reportContent', 'compliance.blockPerson',
             'compliance.reviewReports', 'compliance.manageRemovalRequests')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Employee: reporting and blocking only. Review stays off mobile (Constitution XIII).
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'employee', id FROM public.permission
WHERE id IN ('compliance.reportContent', 'compliance.blockPerson')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Propagate to existing organizations' roles.
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, drp.permission_id
FROM iam.role r
JOIN public.default_role_permission drp ON drp.role_id = r.source_default_role_id
WHERE drp.permission_id IN ('compliance.reportContent', 'compliance.blockPerson',
                            'compliance.reviewReports', 'compliance.manageRemovalRequests')
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

-- ============================================================================
-- iam.user: terms acceptance (R9)
-- ============================================================================

ALTER TABLE iam.user
    ADD COLUMN IF NOT EXISTS terms_version_accepted TEXT,
    ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

COMMENT ON COLUMN iam.user.terms_version_accepted IS
'Version string of the terms this person last accepted. Compared against the current version constant to decide whether to re-prompt. NULL until first acceptance.';

-- ============================================================================
-- iam.identity: document the load-bearing shared-UUID invariant (R2)
-- ============================================================================

COMMENT ON COLUMN iam.identity.id IS
'Same UUID as iam.user.id and organization.employee.id for the same person. This invariant is load-bearing: GetUserRoleNamesInOrg filters iam.employee_role.employee_id with a JWT user id, and account deletion enumerates memberships with SELECT organization_id FROM iam.identity WHERE id = $1. Do not allocate a fresh id here.';

-- ============================================================================
-- compliance.content_report
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance.content_report (
    id                       UUID        NOT NULL DEFAULT uuidv7(),
    organization_id          UUID        NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,

    reporter_employee_id     UUID        NOT NULL,
    reported_employee_id     UUID        NOT NULL,

    target_kind              TEXT        NOT NULL CHECK (target_kind IN (
                                             'chat_message', 'direct_message', 'file',
                                             'document_comment', 'call_record'
                                         )),
    -- Deliberately not a foreign key: target_id points into five different schemas
    -- depending on target_kind, and cross-schema references are forbidden (Principle IV).
    -- content_snapshot is what keeps the report reviewable (FR-018).
    target_id                UUID        NOT NULL,
    content_snapshot         TEXT        NOT NULL,

    reason                   TEXT        NOT NULL CHECK (reason IN (
                                             'harassment', 'hate_speech', 'sexual_content',
                                             'violence', 'spam', 'other'
                                         )),
    note                     TEXT,

    status                   TEXT        NOT NULL DEFAULT 'outstanding' CHECK (status IN (
                                             'outstanding', 'actioned', 'dismissed'
                                         )),
    outcome_note             TEXT,
    reviewed_by_employee_id  UUID,
    reviewed_at              TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_compliance_content_report PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_compliance_content_report_reporter
        FOREIGN KEY (organization_id, reporter_employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_compliance_content_report_reported
        FOREIGN KEY (organization_id, reported_employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_compliance_content_report_reviewer
        FOREIGN KEY (organization_id, reviewed_by_employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_compliance_content_report_queue
    ON compliance.content_report(organization_id, status, id DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_content_report_reported
    ON compliance.content_report(organization_id, reported_employee_id);

COMMENT ON TABLE compliance.content_report IS
'One person''s assertion that a specific item is abusive. content_snapshot records the content as it stood at report time so the report outlives deletion of its subject (FR-018).';

-- ============================================================================
-- compliance.block
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance.block (
    id                    UUID        NOT NULL DEFAULT uuidv7(),
    organization_id       UUID        NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,

    blocker_employee_id   UUID        NOT NULL,
    blocked_employee_id   UUID        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_compliance_block PRIMARY KEY (organization_id, id),
    CONSTRAINT uq_compliance_block_pair
        UNIQUE (organization_id, blocker_employee_id, blocked_employee_id),
    CONSTRAINT compliance_block_not_self
        CHECK (blocker_employee_id <> blocked_employee_id),
    CONSTRAINT fk_compliance_block_blocker
        FOREIGN KEY (organization_id, blocker_employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_compliance_block_blocked
        FOREIGN KEY (organization_id, blocked_employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE
);

-- Asked from the opposite side by the guards in CreateOrGetDirectMessage and call
-- initiation: "has the recipient blocked this initiator?"
CREATE INDEX IF NOT EXISTS idx_compliance_block_blocked
    ON compliance.block(organization_id, blocked_employee_id);

COMMENT ON TABLE compliance.block IS
'One-directional block scoped to direct contact within an organization. Unblocking deletes the row; no history is kept. Never notifies the blocked person (FR-022) and never touches channel membership (FR-023).';

-- ============================================================================
-- compliance.removal_request
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance.removal_request (
    id                       UUID        NOT NULL DEFAULT uuidv7(),
    organization_id          UUID        NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,

    employee_id              UUID        NOT NULL,
    status                   TEXT        NOT NULL DEFAULT 'outstanding' CHECK (status IN (
                                             'outstanding', 'granted', 'declined'
                                         )),
    note                     TEXT,
    decided_by_employee_id   UUID,
    decided_at               TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_compliance_removal_request PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_compliance_removal_request_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_compliance_removal_request_decider
        FOREIGN KEY (organization_id, decided_by_employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE
);

-- One outstanding request per person per organization: a second tap re-surfaces the
-- existing request rather than creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_compliance_removal_request_outstanding
    ON compliance.removal_request(organization_id, employee_id)
    WHERE status = 'outstanding';

CREATE INDEX IF NOT EXISTS idx_compliance_removal_request_queue
    ON compliance.removal_request(organization_id, status, id DESC);

COMMENT ON TABLE compliance.removal_request IS
'An admin-provisioned worker asking to be removed from an organization. Granting ends the membership and, when it was the last, enqueues the global purge.';

-- ============================================================================
-- compliance.account_deletion
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance.account_deletion (
    id               UUID        NOT NULL DEFAULT uuidv7(),
    organization_id  UUID        NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,

    -- No foreign key to iam.user: that is a global table on a different shard
    -- topology, and this row must survive the moment iam.user is deleted so that
    -- 'done' is observable.
    user_id          UUID        NOT NULL,

    state            TEXT        NOT NULL DEFAULT 'pending' CHECK (state IN (
                                     'pending', 'anonymising', 'purging', 'done', 'failed'
                                 )),
    trigger          TEXT        NOT NULL CHECK (trigger IN (
                                     'self_service', 'removal_request_granted'
                                 )),
    failure_reason   TEXT,
    attempts         INT         NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Set by application code rather than a trigger.
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_compliance_account_deletion PRIMARY KEY (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_compliance_account_deletion_active
    ON compliance.account_deletion(organization_id, state)
    WHERE state IN ('pending', 'anonymising', 'purging');

CREATE INDEX IF NOT EXISTS idx_compliance_account_deletion_user
    ON compliance.account_deletion(organization_id, user_id);

COMMENT ON TABLE compliance.account_deletion IS
'Resumable record of an account erase in progress: one row per organization the person belongs to. Whichever row purges last finds no iam.identity rows remaining for the user and destroys the global iam.user record, so the terminal step needs no marker column. A failure leaves the row in its last completed state for the worker to retry.';
