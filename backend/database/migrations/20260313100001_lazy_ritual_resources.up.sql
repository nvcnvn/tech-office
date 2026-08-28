-- Migration: Lazy ritual resources + schedule versioning
-- Feature: 023-ritual-tasks-improvement-lazy-resource

-- 1. Add detached_from_ritual flag to collaboration.task
--    Tracks tasks that were once ritual instances but detached
--    when the schedule changed (advisory-only after detachment).
ALTER TABLE collaboration.task
  ADD COLUMN IF NOT EXISTS detached_from_ritual BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Add schedule_version counter to collaboration.ritual_definition
--    Monotonically incremented on every recurrence pattern change.
ALTER TABLE collaboration.ritual_definition
  ADD COLUMN IF NOT EXISTS schedule_version INT NOT NULL DEFAULT 1;
