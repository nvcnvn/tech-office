-- Feature 041: Evidence Review Queue
--
-- The queue's dominant access path: pending submissions in an organization, in
-- (server_timestamp, id) order, stopping at the page size.
CREATE INDEX IF NOT EXISTS idx_evidence_sub_pending_queue
    ON collaboration.evidence_submission (organization_id, server_timestamp, id)
    WHERE approval_status = 'pending_review';

-- Superseded: idx_evidence_sub_pending was (organization_id, approval_status) with the same
-- partial predicate. It found the pending set but carried no ordering column, so the planner
-- sorted every pending row in the organization before applying the limit. The new index
-- serves every query shape the old one did. Per Constitution Principle I's index-reuse rule,
-- the redundant overlapping index is dropped rather than left in place.
DROP INDEX IF EXISTS collaboration.idx_evidence_sub_pending;
