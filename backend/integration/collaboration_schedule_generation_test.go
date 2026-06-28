package integration

import (
	"context"
	"testing"
	"time"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRitualScheduleGeneration covers the schedule-driven instance generation pipeline:
// window-based generation, incremental daily generation, weekly/monthly recurrence,
// and the interaction between the flows scheduler and the generation logic.
func TestRitualScheduleGeneration(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when generating instances for a daily ritual", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Daily Schedule Project", uniqueProjectKey("DSCH"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		_ = w.createRitualDefinition(owner, proj.ID, "Daily Standup", dailyRecurrenceRule())

		now := time.Now()
		count := w.generateRitualInstancesAt(owner, now)
		tasks := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it generates instances covering the 30-day window", func(t *testing.T) {
			assert.Greater(t, count, 0)
			// Default generation_window_days is 30, so daily = ~30-31 instances
			assert.GreaterOrEqual(t, len(tasks), 28, "daily ritual should generate at least 28 instances for 30-day window")
			assert.LessOrEqual(t, len(tasks), 62, "daily ritual should not exceed ~62 instances (30 back + 30 forward)")
		})

		t.Run("each instance has a unique scheduled_date", func(t *testing.T) {
			seen := make(map[string]bool)
			for _, task := range tasks {
				require.NotEmpty(t, task.ScheduledDate, "ritual instance must have a scheduled_date")
				assert.False(t, seen[task.ScheduledDate], "duplicate scheduled_date: %s", task.ScheduledDate)
				seen[task.ScheduledDate] = true
			}
		})

		t.Run("each instance has a completion_deadline set", func(t *testing.T) {
			for _, task := range tasks {
				require.NotNil(t, task.CompletionDeadline, "ritual instance must have a completion_deadline")
			}
		})
	})

	t.Run("when the scheduler runs again the next day", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Incremental Schedule Project", uniqueProjectKey("ISCH"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		_ = w.createRitualDefinition(owner, proj.ID, "Incremental Daily", dailyRecurrenceRule())

		// First run: generate all instances for today's window
		now := time.Now()
		w.generateRitualInstancesAt(owner, now)
		tasksAfterFirstRun := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		firstRunCount := len(tasksAfterFirstRun)

		// Second run: simulate next day — the generation window extends by 1 day,
		// so exactly 1 new instance should appear for this project's definition.
		tomorrow := now.AddDate(0, 0, 1)
		w.generateRitualInstancesAt(owner, tomorrow)
		tasksAfterSecondRun := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it generates exactly 1 new instance for the new day", func(t *testing.T) {
			assert.Equal(t, firstRunCount+1, len(tasksAfterSecondRun),
				"second-day run should add exactly 1 new instance to this project")
		})

		// Third run: simulate day 3 — should generate exactly 1 more
		dayAfter := tomorrow.AddDate(0, 0, 1)
		w.generateRitualInstancesAt(owner, dayAfter)
		tasksAfterThirdRun := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it generates exactly 1 new instance on day 3", func(t *testing.T) {
			assert.Equal(t, firstRunCount+2, len(tasksAfterThirdRun),
				"third-day run should add exactly 1 more instance to this project")
		})
	})

	t.Run("when the scheduler is invoked multiple times on the same day", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Idempotent Schedule Project", uniqueProjectKey("IDMP"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		_ = w.createRitualDefinition(owner, proj.ID, "Idempotent Daily", dailyRecurrenceRule())

		now := time.Now()
		firstCount := w.generateRitualInstancesAt(owner, now)
		secondCount := w.generateRitualInstancesAt(owner, now)
		thirdCount := w.generateRitualInstancesAt(owner, now)

		t.Run("only the first invocation creates instances", func(t *testing.T) {
			assert.Greater(t, firstCount, 0)
			assert.Equal(t, 0, secondCount, "second run on same day should create 0 instances")
			assert.Equal(t, 0, thirdCount, "third run on same day should create 0 instances")
		})
	})

	t.Run("when generating instances for a weekly ritual", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Weekly Schedule Project", uniqueProjectKey("WSCH"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		// Monday and Friday (ISO: 1=Mon, 5=Fri)
		weeklyRule := &rpcv1.RecurrenceRule{
			Type:       rpcv1.RecurrenceType_RECURRENCE_TYPE_WEEKLY,
			Interval:   1,
			DaysOfWeek: []int32{1, 5},
			TimeOfDay:  "09:00",
		}
		_ = w.createRitualDefinition(owner, proj.ID, "Weekly Review", weeklyRule)

		now := time.Now()
		w.generateRitualInstancesAt(owner, now)
		tasks := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it only generates instances on the specified weekdays", func(t *testing.T) {
			require.NotEmpty(t, tasks, "weekly ritual should generate some instances")
			for _, task := range tasks {
				require.NotEmpty(t, task.ScheduledDate)
				date, err := time.Parse("2006-01-02", task.ScheduledDate)
				require.NoError(t, err, "scheduled_date should be parseable")
				wd := date.Weekday()
				assert.True(t, wd == time.Monday || wd == time.Friday,
					"instance on %s (%s) is not Monday or Friday", task.ScheduledDate, wd)
			}
		})

		t.Run("it generates roughly 8-10 instances for a 30-day window with 2 days/week", func(t *testing.T) {
			// 30 days / 7 days/week * 2 days/week ~ 8-9 per forward window, plus backward
			assert.GreaterOrEqual(t, len(tasks), 6, "should have at least 6 weekly instances")
			assert.LessOrEqual(t, len(tasks), 20, "should not exceed ~20 weekly instances")
		})
	})

	t.Run("when generating instances for a monthly ritual", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Monthly Schedule Project", uniqueProjectKey("MSCH"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		monthlyRule := &rpcv1.RecurrenceRule{
			Type:       rpcv1.RecurrenceType_RECURRENCE_TYPE_MONTHLY,
			Interval:   1,
			DayOfMonth: 15,
			TimeOfDay:  "10:00",
		}
		_ = w.createRitualDefinition(owner, proj.ID, "Monthly Report", monthlyRule)

		now := time.Now()
		w.generateRitualInstancesAt(owner, now)
		tasks := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it generates instances only on the 15th of each month", func(t *testing.T) {
			require.NotEmpty(t, tasks, "monthly ritual should generate at least 1 instance")
			for _, task := range tasks {
				require.NotEmpty(t, task.ScheduledDate)
				date, err := time.Parse("2006-01-02", task.ScheduledDate)
				require.NoError(t, err)
				assert.Equal(t, 15, date.Day(), "monthly instance should be on day 15, got %s", task.ScheduledDate)
			}
		})

		t.Run("it generates 1-3 instances for a 30-day window", func(t *testing.T) {
			// A 30-day forward window can contain at most 2 occurrences of the 15th
			assert.GreaterOrEqual(t, len(tasks), 1)
			assert.LessOrEqual(t, len(tasks), 3)
		})
	})

	t.Run("when the scheduler runs one week later for a daily ritual", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Week Gap Project", uniqueProjectKey("WGAP"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		_ = w.createRitualDefinition(owner, proj.ID, "Gap Test Daily", dailyRecurrenceRule())

		now := time.Now()
		w.generateRitualInstancesAt(owner, now)
		countBefore := len(w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)))

		// Simulate scheduler being down for 7 days, then runs.
		// The generation window extends by 7 days, so 7 new instances for this project.
		oneWeekLater := now.AddDate(0, 0, 7)
		w.generateRitualInstancesAt(owner, oneWeekLater)
		countAfter := len(w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)))

		t.Run("it catches up and generates the missing days", func(t *testing.T) {
			assert.Equal(t, 7, countAfter-countBefore,
				"should generate 7 new instances for the 7-day window extension")
		})
	})

	t.Run("when the flows schedule is created via RPC", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Flows Schedule Project", uniqueProjectKey("FLSC"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		def := w.createRitualDefinition(owner, proj.ID, "Flows-Scheduled Ritual", dailyRecurrenceRule())

		t.Run("the definition is created successfully (flows.ScheduleTx writes to flows.schedules)", func(t *testing.T) {
			require.NotEmpty(t, def.Id)
			assert.Equal(t, "Flows-Scheduled Ritual", def.Name)
		})

		t.Run("a flows schedule row exists for this definition", func(t *testing.T) {
			var count int
			err := globalDB.QueryRow(
				context.Background(),
				`SELECT count(*) FROM flows.schedules WHERE schedule_id LIKE '%' || $1 || '%'`,
				def.Id,
			).Scan(&count)
			require.NoError(t, err)
			assert.Equal(t, 1, count, "expected exactly 1 flows schedule for definition %s", def.Id)
		})
	})
}
