-- Backfill: states with ritual-only categories are ritual type
UPDATE collaboration.project_state
SET state_type = 'ritual'
WHERE category IN ('scheduled', 'submitted', 'verified', 'overdue', 'missed', 'skipped');
