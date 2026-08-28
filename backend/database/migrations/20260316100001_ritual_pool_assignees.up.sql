-- Migration: Add department pool assignment support to ritual definitions.
-- This creates a new table that lets a ritual definition specify a department
-- as a pool source; during instance generation the backend resolves one
-- concrete employee_id via round_robin or least_assigned strategy.
--
-- Feature: team/round-robin pool assignment for ritual tasks

CREATE TABLE IF NOT EXISTS collaboration.ritual_definition_department_pool (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    ritual_definition_id UUID NOT NULL,
    department_id UUID NOT NULL,
    assignment_strategy TEXT NOT NULL DEFAULT 'round_robin'
        CHECK (assignment_strategy IN ('round_robin', 'least_assigned')),
    -- Waterline for round_robin: UUID of the last employee assigned from this pool.
    -- NULL means start from the beginning of the sorted member list.
    -- No FK intentionally: employee may leave the department mid-cycle.
    last_assigned_employee_id UUID NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (organization_id, id),

    CONSTRAINT fk_rddp_ritual_def
        FOREIGN KEY (organization_id, ritual_definition_id)
        REFERENCES collaboration.ritual_definition(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rddp_department
        FOREIGN KEY (organization_id, department_id)
        REFERENCES organization.department(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT uq_rddp_unique
        UNIQUE (organization_id, ritual_definition_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_rddp_definition
    ON collaboration.ritual_definition_department_pool(organization_id, ritual_definition_id);
