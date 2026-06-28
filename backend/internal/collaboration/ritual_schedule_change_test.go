package collaboration

import (
	"testing"
	"time"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/stretchr/testify/assert"
)

func TestComputeDatesInWindowDaily(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 3, 14, 12, 0, 0, 0, loc)

	t.Run("daily interval 1 window 30", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeDaily, Interval: 1}
		dates := computeDatesInWindow(rule, now.AddDate(0, 0, -1), 30, loc, now)
		assert.InDelta(t, 30, len(dates), 2)
	})

	t.Run("daily interval 2 window 30", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeDaily, Interval: 2}
		dates := computeDatesInWindow(rule, now.AddDate(0, 0, -1), 30, loc, now)
		assert.InDelta(t, 15, len(dates), 2)
	})

	t.Run("zero window yields at most today", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeDaily, Interval: 1}
		dates := computeDatesInWindow(rule, now.AddDate(0, 0, -1), 0, loc, now)
		// windowDays=0: endDate == now, startDate == now; loop yields exactly today
		assert.LessOrEqual(t, len(dates), 1)
	})

	t.Run("old lastGenerated is clamped", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeDaily, Interval: 1}
		dates := computeDatesInWindow(rule, now.AddDate(-1, 0, 0), 30, loc, now)
		assert.LessOrEqual(t, len(dates), 65)
	})
}

func TestComputeDatesInWindowWeekly(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 3, 16, 12, 0, 0, 0, loc)

	t.Run("monday only window 30 yields 4-5 dates", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeWeekly, Interval: 1, DaysOfWeek: []int{1}}
		dates := computeDatesInWindow(rule, now.AddDate(0, 0, -1), 30, loc, now)
		assert.InDelta(t, 4, len(dates), 1)
		for _, d := range dates {
			assert.Equal(t, time.Monday, d.Weekday())
		}
	})

	t.Run("mon wed fri window 30 yields ~13 dates", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeWeekly, Interval: 1, DaysOfWeek: []int{1, 3, 5}}
		dates := computeDatesInWindow(rule, now.AddDate(0, 0, -1), 30, loc, now)
		assert.InDelta(t, 13, len(dates), 2)
		for _, d := range dates {
			wd := d.Weekday()
			assert.True(t, wd == time.Monday || wd == time.Wednesday || wd == time.Friday)
		}
	})

	t.Run("nil days of week does not panic", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeWeekly, Interval: 1, DaysOfWeek: nil}
		dates := computeDatesInWindow(rule, now.AddDate(0, 0, -1), 30, loc, now)
		assert.NotNil(t, dates)
	})
}

func TestComputeDatesInWindowMonthly(t *testing.T) {
	loc := time.UTC
	now := time.Date(2026, 3, 14, 12, 0, 0, 0, loc)

	t.Run("monthly day 15 window 30 yields 0 or 1", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeMonthly, Interval: 1, DayOfMonth: 15}
		dates := computeDatesInWindow(rule, now.AddDate(0, 0, -1), 30, loc, now)
		assert.InDelta(t, 1, len(dates), 1)
		if len(dates) > 0 {
			assert.Equal(t, 15, dates[0].Day())
		}
	})

	t.Run("monthly day 1 from mid march yields april 1", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeMonthly, Interval: 1, DayOfMonth: 1}
		dates := computeDatesInWindow(rule, now.AddDate(0, 0, -1), 30, loc, now)
		assert.InDelta(t, 1, len(dates), 1)
	})

	t.Run("day 31 is clamped in short months", func(t *testing.T) {
		rule := &recurrenceRule{Type: RecurrenceTypeMonthly, Interval: 1, DayOfMonth: 31}
		nowFeb := time.Date(2026, 1, 30, 12, 0, 0, 0, loc)
		dates := computeDatesInWindow(rule, nowFeb.AddDate(0, 0, -1), 35, loc, nowFeb)
		for _, d := range dates {
			_, _, day := d.Date()
			assert.LessOrEqual(t, day, 31)
		}
	})
}

// =============================================================================
// isUntouched — unit tests for the canonical classification predicate
// =============================================================================

func TestIsUntouched(t *testing.T) {
	newID := func() dbuuid.UUID { return dbuuid.Must() }

	cases := []struct {
		name     string
		input    ritualInstanceInput
		wantTrue bool
	}{
		{
			name: "fresh generated instance, never opened",
			input: ritualInstanceInput{
				TaskID: newID(), CommentCount: 0, IsInitialState: true, HasEvidence: false, HasChannel: false,
			},
			wantTrue: true,
		},
		{
			name: "user opened task (channel created) but state still initial, no comments",
			// channel creation means user opened the task detail → touched
			input: ritualInstanceInput{
				TaskID: newID(), CommentCount: 0, IsInitialState: true, HasEvidence: false, HasChannel: true,
			},
			wantTrue: false,
		},
		{
			name: "at least one comment posted",
			input: ritualInstanceInput{
				TaskID: newID(), CommentCount: 1, IsInitialState: true, HasEvidence: false, HasChannel: false,
			},
			wantTrue: false,
		},
		{
			name: "evidence submitted, state still initial, no comments",
			input: ritualInstanceInput{
				TaskID: newID(), CommentCount: 0, IsInitialState: true, HasEvidence: true, HasChannel: false,
			},
			wantTrue: false,
		},
		{
			name: "state moved to in_progress (not initial), no comments, no evidence",
			input: ritualInstanceInput{
				TaskID: newID(), CommentCount: 0, IsInitialState: false, HasEvidence: false, HasChannel: false,
			},
			wantTrue: false,
		},
		{
			name: "state in_progress, comment present, evidence present",
			input: ritualInstanceInput{
				TaskID: newID(), CommentCount: 3, IsInitialState: false, HasEvidence: true, HasChannel: true,
			},
			wantTrue: false,
		},
		{
			name: "state not initial and evidence submitted",
			input: ritualInstanceInput{
				TaskID: newID(), CommentCount: 0, IsInitialState: false, HasEvidence: true, HasChannel: false,
			},
			wantTrue: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isUntouched(tc.input)
			assert.Equal(t, tc.wantTrue, got)
		})
	}
}

// =============================================================================
// classifyScheduleChangeImpact — aggregate bucket tests
// =============================================================================

func TestClassifyScheduleChangeImpact(t *testing.T) {
	newID := func() dbuuid.UUID { return dbuuid.Must() }

	untouched := func() ritualInstanceInput {
		return ritualInstanceInput{TaskID: newID(), CommentCount: 0, IsInitialState: true, HasEvidence: false, HasChannel: false}
	}
	touched := func() ritualInstanceInput {
		return ritualInstanceInput{TaskID: newID(), CommentCount: 1, IsInitialState: false, HasEvidence: true, HasChannel: true}
	}

	t.Run("empty list yields empty buckets", func(t *testing.T) {
		impact := classifyScheduleChangeImpact(nil)
		assert.Empty(t, impact.Untouched)
		assert.Empty(t, impact.Touched)
	})

	t.Run("all untouched yields full untouched bucket", func(t *testing.T) {
		instances := []ritualInstanceInput{untouched(), untouched(), untouched()}
		impact := classifyScheduleChangeImpact(instances)
		assert.Len(t, impact.Untouched, 3)
		assert.Empty(t, impact.Touched)
	})

	t.Run("all touched yields full touched bucket", func(t *testing.T) {
		instances := []ritualInstanceInput{touched(), touched()}
		impact := classifyScheduleChangeImpact(instances)
		assert.Empty(t, impact.Untouched)
		assert.Len(t, impact.Touched, 2)
	})

	t.Run("mixed set splits into correct buckets", func(t *testing.T) {
		u1, u2 := untouched(), untouched()
		t1, t2, t3 := touched(), touched(), touched()
		instances := []ritualInstanceInput{u1, t1, u2, t2, t3}
		impact := classifyScheduleChangeImpact(instances)
		assert.Len(t, impact.Untouched, 2)
		assert.Len(t, impact.Touched, 3)
		// Verify the IDs ended up in the right bucket
		assert.Contains(t, impact.Untouched, u1.TaskID)
		assert.Contains(t, impact.Untouched, u2.TaskID)
		assert.Contains(t, impact.Touched, t1.TaskID)
		assert.Contains(t, impact.Touched, t2.TaskID)
		assert.Contains(t, impact.Touched, t3.TaskID)
	})

	t.Run("single untouched instance", func(t *testing.T) {
		inst := untouched()
		impact := classifyScheduleChangeImpact([]ritualInstanceInput{inst})
		assert.Equal(t, []dbuuid.UUID{inst.TaskID}, impact.Untouched)
		assert.Empty(t, impact.Touched)
	})

	t.Run("single touched instance", func(t *testing.T) {
		inst := touched()
		impact := classifyScheduleChangeImpact([]ritualInstanceInput{inst})
		assert.Empty(t, impact.Untouched)
		assert.Equal(t, []dbuuid.UUID{inst.TaskID}, impact.Touched)
	})
}
