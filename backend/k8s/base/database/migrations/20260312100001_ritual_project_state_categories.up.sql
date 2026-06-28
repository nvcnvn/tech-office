-- T002: Extend project_state.category CHECK constraint to include ritual categories
ALTER TABLE collaboration.project_state
    DROP CONSTRAINT IF EXISTS project_state_category_check;
ALTER TABLE collaboration.project_state
    ADD CONSTRAINT project_state_category_check
    CHECK (category IN (
        'todo', 'in_progress', 'done', 'cancelled',
        'scheduled', 'submitted', 'verified',
        'overdue', 'missed', 'skipped'
    ));
