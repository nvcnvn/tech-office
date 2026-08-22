-- Feature 034: per-definition ritual schedules are replaced by one global sweep.
-- These rows point at the removed 'ritual_scheduler' workflow; left in place they would
-- keep enqueueing runs for a workflow name no longer in the registry.
DELETE FROM flows.schedules WHERE schedule_id LIKE 'ritual_def_%';
