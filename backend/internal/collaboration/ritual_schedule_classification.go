package collaboration

import (
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// ritualInstanceInput carries the minimal data needed to classify a single
// future ritual instance as untouched (safe to soft-delete) or touched (must detach).
// Fields are pre-resolved by the DB query; no further joins needed.
type ritualInstanceInput struct {
	TaskID         dbuuid.UUID
	CommentCount   int32
	IsInitialState bool // true when the task's state has is_initial=true
	HasEvidence    bool // true when at least one evidence_submission exists
	HasChannel     bool // true when the task's chat channel has been lazily created
}

// scheduleChangeImpact holds the classified ID lists produced by
// classifyScheduleChangeImpact. These lists drive the actual DB mutations.
type scheduleChangeImpact struct {
	// Untouched instances: no human interaction → safe to soft-delete.
	Untouched []dbuuid.UUID
	// Touched instances: some interaction occurred → detach as standalone tasks.
	Touched []dbuuid.UUID
}

// isUntouched returns true when the instance has had no human interaction:
//   - still on the initial workflow state
//   - zero comments
//   - no evidence submitted
//   - no chat channel created (channel is lazily created when user opens task detail)
//
// This is a pure function with no side effects; it is the single canonical
// definition of "untouched" used by both impact preview and schedule execution.
func isUntouched(inst ritualInstanceInput) bool {
	return inst.IsInitialState && inst.CommentCount == 0 && !inst.HasEvidence && !inst.HasChannel
}

// classifyScheduleChangeImpact partitions a slice of future ritual instances
// into untouched and touched buckets. The caller provides pre-resolved inputs;
// this function contains zero DB access and is fully unit-testable.
func classifyScheduleChangeImpact(instances []ritualInstanceInput) scheduleChangeImpact {
	impact := scheduleChangeImpact{
		Untouched: make([]dbuuid.UUID, 0, len(instances)),
		Touched:   make([]dbuuid.UUID, 0),
	}
	for _, inst := range instances {
		if isUntouched(inst) {
			impact.Untouched = append(impact.Untouched, inst.TaskID)
		} else {
			impact.Touched = append(impact.Touched, inst.TaskID)
		}
	}
	return impact
}
