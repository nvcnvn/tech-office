-- Migration: feature tour (Feature 039)
-- Direction: UP
--
-- Rollback posture: forward-only, purely additive. One new table, two new permission
-- rows and grants of those two to the three seeded role templates. Nothing existing is
-- dropped or rewritten (Constitution VI).
--
-- Tour *content* is deliberately not in the database. It lives in Go values in
-- backend/internal/tour/content.go, because a tour authoring interface is out of scope
-- and a content table would be a table with a dozen immutable rows nobody can edit.

-- ============================================================================
-- iam.tour_progress: what a person has seen
--
-- One row per person per tour, created on first write and never on read. The absence of
-- a row IS "not started": storing that state would turn workspace entry into a write
-- path and inflate the denominator of every completion-rate query.
--
-- current_stop indexes the *filtered* stop list, whose length depends on the person's
-- permissions. content_version records which version of the copy they actually saw;
-- nothing reads it today, but without it a later decision to re-offer after a rewrite
-- would have no data to act on.
--
-- Tenancy shape is copied from iam.user_preference, which scopes identically.
-- ============================================================================

CREATE TABLE IF NOT EXISTS iam.tour_progress (
    id              uuid        DEFAULT uuidv7() NOT NULL,
    organization_id uuid        NOT NULL,
    employee_id     uuid        NOT NULL,
    tour_id         text        NOT NULL,
    status          text        NOT NULL,
    current_stop    integer     DEFAULT 0 NOT NULL,
    content_version text        NOT NULL,
    updated_at      timestamptz DEFAULT now() NOT NULL,

    CONSTRAINT tour_progress_pkey
        PRIMARY KEY (organization_id, id),

    -- The natural key every query uses, so no second index is needed.
    CONSTRAINT unique_employee_tour
        UNIQUE (organization_id, employee_id, tour_id),

    CONSTRAINT fk_tour_progress_organization
        FOREIGN KEY (organization_id)
        REFERENCES public.organization(id) ON DELETE CASCADE,

    CONSTRAINT fk_tour_progress_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,

    CONSTRAINT tour_progress_tour_id_check
        CHECK (tour_id IN ('administrator', 'worker')),

    CONSTRAINT tour_progress_status_check
        CHECK (status IN ('in_progress', 'completed', 'dismissed')),

    CONSTRAINT tour_progress_current_stop_check
        CHECK (current_stop >= 0)
);

COMMENT ON TABLE iam.tour_progress IS
    'How far a person got in a feature tour. One row per employee per tour, written on first engagement and never on read — the absence of a row is "not started". MUST align with backend constants in internal/tour/content.go.';
COMMENT ON COLUMN iam.tour_progress.tour_id IS
    'Which tour: administrator or worker. Derived from the caller''s permissions by the server, never sent by a client.';
COMMENT ON COLUMN iam.tour_progress.current_stop IS
    'Zero-based index of the first stop not yet completed, addressing the permission-filtered stop list. Clamped to that list on read without being written back.';
COMMENT ON COLUMN iam.tour_progress.content_version IS
    'The tour content version in force when the row was last written — the record of which copy this person actually saw.';

-- ============================================================================
-- Two new permissions, granted to every seeded role. Everyone needs to see their own
-- tour, so there is no exclusion list here: tour.view and tour.update go to owner,
-- operator and employee alike.
-- ============================================================================

INSERT INTO public.permission (id, domain, description) VALUES
('tour.view',   'tour', 'Read one''s own feature tour and progress'),
('tour.update', 'tour', 'Record progress through one''s own feature tour')
ON CONFLICT (id) DO NOTHING;

-- Defaults for organizations created from here on.
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT r.role_id, p.id
FROM (VALUES ('owner'), ('operator'), ('employee')) AS r(role_id),
     (VALUES ('tour.view'), ('tour.update')) AS p(id)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Back-fill the roles of organizations that already exist.
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM iam.role r, (VALUES ('tour.view'), ('tour.update')) AS p(id)
WHERE r.source_default_role_id IN ('owner', 'operator', 'employee')
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
