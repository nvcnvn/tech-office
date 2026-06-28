-- Reset backfilled state_type values to default
UPDATE collaboration.project_state SET state_type = 'standard';
