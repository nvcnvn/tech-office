package collaboration

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
)

// ritualStateFixture builds the two inputs determineRitualTaskStateCategory reads. Only the
// fields the precedence table consults are set; everything else on a task is irrelevant to
// the decision and would only obscure which field drove the outcome.
type ritualStateFixture struct {
	scheduledDate      *time.Time
	completionDeadline *time.Time

	requiredCount          int32
	requiredSubmittedCount int32
	requiredApprovedCount  int32
	requiredRejectedCount  int32
	submittedCount         int32
}

func (f ritualStateFixture) build() (*database.CollaborationTask, *taskEvidenceSnapshot) {
	task := &database.CollaborationTask{TaskKind: TaskKindRitualInstance}
	if f.scheduledDate != nil {
		task.ScheduledDate = pgtype.Date{Time: *f.scheduledDate, Valid: true}
	}
	if f.completionDeadline != nil {
		task.CompletionDeadline = pgtype.Timestamptz{Time: *f.completionDeadline, Valid: true}
	}

	snapshot := &taskEvidenceSnapshot{
		progress: &rpcv1.TaskEvidenceProgress{
			RequiredCount:  f.requiredCount,
			SubmittedCount: f.submittedCount,
			// Mirrors loadTaskEvidenceSnapshot: no required evidence at all counts as
			// fully approved, which is why a ritual with no requirements verifies.
			AllRequiredApproved: f.requiredCount == 0 || f.requiredApprovedCount == f.requiredCount,
		},
		requiredCount:          f.requiredCount,
		requiredSubmittedCount: f.requiredSubmittedCount,
		requiredApprovedCount:  f.requiredApprovedCount,
		requiredRejectedCount:  f.requiredRejectedCount,
	}

	return task, snapshot
}

func TestDetermineRitualTaskStateCategory(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)

	yesterday := now.AddDate(0, 0, -1)
	tomorrow := now.AddDate(0, 0, 1)
	deadlinePassed := now.Add(-3 * time.Hour)
	deadlineFuture := now.Add(3 * time.Hour)
	deadlineLongPast := now.Add(-72 * time.Hour)

	const grace24h = 24 * time.Hour

	tests := []struct {
		name        string
		fixture     ritualStateFixture
		graceWindow time.Duration
		want        string
	}{
		// ── Row 1: verified outranks everything, including a blown deadline ──────────
		{
			name: "all required evidence approved is verified even long past the deadline",
			fixture: ritualStateFixture{
				completionDeadline: &deadlineLongPast,
				requiredCount:      2, requiredSubmittedCount: 2, requiredApprovedCount: 2, submittedCount: 2,
			},
			graceWindow: grace24h,
			want:        StateCategoryVerified,
		},
		// ── Row 2: submitted outranks missed and overdue ────────────────────────────
		{
			name: "fully submitted with none rejected is submitted past deadline and grace",
			fixture: ritualStateFixture{
				completionDeadline: &deadlineLongPast,
				requiredCount:      2, requiredSubmittedCount: 2, submittedCount: 2,
			},
			graceWindow: grace24h,
			want:        StateCategorySubmitted,
		},
		// ── Row 3: missed ───────────────────────────────────────────────────────────
		{
			name: "nothing submitted past deadline and grace is missed",
			fixture: ritualStateFixture{
				completionDeadline: &deadlineLongPast,
				requiredCount:      1,
			},
			graceWindow: grace24h,
			want:        StateCategoryMissed,
		},
		{
			name: "an unknown grace window can never produce missed, only overdue",
			fixture: ritualStateFixture{
				completionDeadline: &deadlineLongPast,
				requiredCount:      1,
			},
			graceWindow: 0,
			want:        StateCategoryOverdue,
		},
		// ── Row 4: overdue ──────────────────────────────────────────────────────────
		{
			name: "nothing submitted past deadline but within grace is overdue",
			fixture: ritualStateFixture{
				completionDeadline: &deadlinePassed,
				requiredCount:      1,
			},
			graceWindow: grace24h,
			want:        StateCategoryOverdue,
		},
		{
			// FR-006: this is the reordering. Before it, one of two submitted
			// requirements past the deadline read as in_progress and lateness was hidden.
			name: "one of two required submitted past the deadline is overdue, not in_progress",
			fixture: ritualStateFixture{
				completionDeadline: &deadlinePassed,
				requiredCount:      2, requiredSubmittedCount: 1, submittedCount: 1,
			},
			graceWindow: grace24h,
			want:        StateCategoryOverdue,
		},
		{
			// A rejected submission is not progress. Without the rejected-count guard on
			// row 2 this would read as submitted and shelter the instance indefinitely.
			name: "submitted then rejected past the deadline is overdue",
			fixture: ritualStateFixture{
				completionDeadline: &deadlinePassed,
				requiredCount:      1, requiredSubmittedCount: 1, requiredRejectedCount: 1, submittedCount: 1,
			},
			graceWindow: grace24h,
			want:        StateCategoryOverdue,
		},
		{
			// FR-005: no deadline means never late, no matter how old the instance is.
			name: "a NULL completion deadline is never overdue or missed",
			fixture: ritualStateFixture{
				scheduledDate: &yesterday,
				requiredCount: 1,
			},
			graceWindow: grace24h,
			want:        StateCategoryTodo,
		},
		// ── Row 5: in_progress ──────────────────────────────────────────────────────
		{
			name: "partial evidence before the deadline is in_progress",
			fixture: ritualStateFixture{
				completionDeadline: &deadlineFuture,
				requiredCount:      2, requiredSubmittedCount: 1, submittedCount: 1,
			},
			graceWindow: grace24h,
			want:        StateCategoryInProgress,
		},
		// ── Row 6: scheduled ────────────────────────────────────────────────────────
		{
			name: "a future scheduled date with no evidence is scheduled",
			fixture: ritualStateFixture{
				scheduledDate: &tomorrow, completionDeadline: &deadlineFuture,
				requiredCount: 1,
			},
			graceWindow: grace24h,
			want:        StateCategoryScheduled,
		},
		// ── Row 7: todo ─────────────────────────────────────────────────────────────
		{
			name: "today's instance with no evidence and an unpassed deadline is todo",
			fixture: ritualStateFixture{
				scheduledDate: &now, completionDeadline: &deadlineFuture,
				requiredCount: 1,
			},
			graceWindow: grace24h,
			want:        StateCategoryTodo,
		},
		// ── Boundary: "after", not "at or after" ─────────────────────────────────────
		{
			name: "exactly at the deadline is not yet overdue",
			fixture: ritualStateFixture{
				scheduledDate: &now, completionDeadline: &now,
				requiredCount: 1,
			},
			graceWindow: grace24h,
			want:        StateCategoryTodo,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			task, snapshot := tc.fixture.build()
			assert.Equal(t, tc.want, determineRitualTaskStateCategory(task, snapshot, tc.graceWindow, now))
		})
	}
}

func TestShouldSuppressRitualLatenessNotification(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)

	deadlineFor := func(d time.Duration) *database.CollaborationTask {
		return &database.CollaborationTask{
			CompletionDeadline: pgtype.Timestamptz{Time: now.Add(-d), Valid: true},
		}
	}

	// The question is asked of the stored deadline, never of elapsed time since the state
	// changed, so a second pass over the same row must give the same answer (FR-021).
	assert.False(t, shouldSuppressRitualLatenessNotification(deadlineFor(time.Hour), now))
	assert.False(t, shouldSuppressRitualLatenessNotification(deadlineFor(ritualReconciliationBackfillHorizon), now))
	assert.True(t, shouldSuppressRitualLatenessNotification(deadlineFor(ritualReconciliationBackfillHorizon+time.Hour), now))
	assert.True(t, shouldSuppressRitualLatenessNotification(deadlineFor(30*24*time.Hour), now))

	// No deadline means the instance never became late through this path at all.
	assert.False(t, shouldSuppressRitualLatenessNotification(&database.CollaborationTask{}, now))
}

func TestRitualLatenessDescription(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)

	assert.Equal(t, "is overdue by less than an hour", ritualLatenessDescription(now.Add(-59*time.Minute), now))
	assert.Equal(t, "is 1 hours overdue", ritualLatenessDescription(now.Add(-time.Hour), now))
	assert.Equal(t, "is 47 hours overdue", ritualLatenessDescription(now.Add(-47*time.Hour), now))
	assert.Equal(t, "is 2 days overdue", ritualLatenessDescription(now.Add(-48*time.Hour), now))
	assert.Equal(t, "is 30 days overdue", ritualLatenessDescription(now.AddDate(0, 0, -30), now))
}
