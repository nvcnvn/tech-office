-- Migration: Add flows.schedules table (required by flows v0.0.7 for cron scheduling)
-- This table was missing from the initial schema but is required by flows.ScheduleTx()
-- for per-definition ritual scheduling.

CREATE TABLE IF NOT EXISTS "flows"."schedules" (
    schedule_id    text NOT NULL PRIMARY KEY,
    workflow_name  text NOT NULL,
    cron_expr      text NOT NULL,
    input_json     jsonb NOT NULL,
    enabled        boolean NOT NULL DEFAULT true,
    last_run_at    timestamptz,
    next_run_at    timestamptz NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Schedules is a reference table (replicated to all nodes) because it is
-- not sharded by workflow_name_shard and is small (one row per cron schedule).
SELECT create_reference_table('flows.schedules');
