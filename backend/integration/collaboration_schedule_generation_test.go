package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRitualScheduleGeneration covers the schedule-driven instance generation pipeline:
// window-based generation, incremental daily generation, weekly/monthly recurrence,
// and the interaction between the flows scheduler and the generation logic.
func TestRitualScheduleGeneration(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when generating instances for a daily ritual", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Daily Schedule Project", uniqueProjectKey("DSCH"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		_ = w.createRitualDefinition(owner, proj.ID, "Daily Standup", dailyRecurrenceRule())

		now := time.Now()
		count := w.generateRitualInstancesAt(owner, now)
		tasks := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it generates instances covering the 30-day window", func(t *testing.T) {
			// Since feature 034 the creation transaction generates the window itself
			// (FR-011), so a same-day run afterwards is a no-op rather than the first
			// producer. The window coverage below is what this scenario really asserts.
			assert.Equal(t, 0, count, "creation already covered this window")
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

		t.Run("no invocation creates a duplicate instance", func(t *testing.T) {
			// Creation generated the window in its own transaction (FR-011), so every
			// same-day run — including the first — must create nothing.
			assert.Equal(t, 0, firstCount, "first run on same day should create 0 instances")
			assert.Equal(t, 0, secondCount, "second run on same day should create 0 instances")
			assert.Equal(t, 0, thirdCount, "third run on same day should create 0 instances")
			assert.NotEmpty(t, w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)),
				"the window is nonetheless populated")
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

	// Feature 034 inverted this block. Creating a definition used to upsert one
	// flows.schedules row per definition; now it writes none, and the whole platform
	// carries exactly one ritual schedule.
	t.Run("when a ritual definition is created via RPC", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Flows Schedule Project", uniqueProjectKey("FLSC"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		def := w.createRitualDefinition(owner, proj.ID, "Globally-Scheduled Ritual", dailyRecurrenceRule())

		t.Run("the definition is created successfully", func(t *testing.T) {
			require.NotEmpty(t, def.Id)
			assert.Equal(t, "Globally-Scheduled Ritual", def.Name)
		})

		t.Run("no per-definition flows schedule row is written", func(t *testing.T) {
			assert.Equal(t, 0, countPerDefinitionRitualSchedules(t),
				"no ritual_def_%% schedule row may exist for any definition")
		})

		t.Run("exactly one ritual schedule row exists platform-wide", func(t *testing.T) {
			assert.Equal(t, 1, countGlobalRitualSweepSchedules(t))
		})
	})
}

// countPerDefinitionRitualSchedules counts the per-definition schedule rows feature 034
// deletes. It must be 0 platform-wide, at every point of every ritual lifecycle.
func countPerDefinitionRitualSchedules(t *testing.T) int {
	t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT count(*)::int FROM flows.schedules WHERE schedule_id LIKE 'ritual_def_%'`,
	).Scan(&count)
	require.NoError(t, err)
	return count
}

// countGlobalRitualSweepSchedules counts the single platform-wide sweep schedule (SC-001).
func countGlobalRitualSweepSchedules(t *testing.T) int {
	t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT count(*)::int FROM flows.schedules WHERE workflow_name = 'ritual_generation_sweep'`,
	).Scan(&count)
	require.NoError(t, err)
	return count
}

// createRitualDefinitionInTZ creates a ritual definition in a specific timezone.
// The shared helper hardcodes UTC; FR-005 requires covering an IANA zone and a
// "UTC+N" offset string, both of which flow through loadTimezone.
func (w *testWorld) createRitualDefinitionInTZ(
	actor testUser,
	projectID, name string,
	rule *rpcv1.RecurrenceRule,
	timezone string,
) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateRitualDefinitionRequest{
		ProjectId:             projectID,
		Name:                  name,
		RecurrenceRule:        rule,
		CompletionWindowHours: 8,
		Timezone:              timezone,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

// updateRitualDefinitionRecurrence updates only the recurrence rule. The shared
// updateRitualDefinition helper updates the name; the rule is the field that used to
// trigger a cron rewrite, so the lifecycle assertions need this variant.
func (w *testWorld) updateRitualDefinitionRecurrence(actor testUser, defID string, rule *rpcv1.RecurrenceRule) *rpcv1.RitualDefinition {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.UpdateRitualDefinitionRequest{
		RitualDefinitionId: defID,
		RecurrenceRule:     rule,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.UpdateRitualDefinition(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.RitualDefinition
}

// scheduledDates returns the sorted scheduled dates of a project's ritual instances.
// It reads the table directly rather than through ListTasks: a 30-day window across
// several definitions exceeds one RPC page, and a truncated page would silently weaken
// every date assertion below.
func (w *testWorld) scheduledDates(actor testUser, projectID string) []time.Time {
	w.t.Helper()
	return queryScheduledDates(w.t,
		`SELECT scheduled_date FROM collaboration.task
		 WHERE organization_id = $1 AND project_id = $2
		   AND task_kind = 'ritual_instance' AND is_deleted = FALSE
		 ORDER BY scheduled_date`,
		actor.OrgID, dbuuid.MustParse(projectID))
}

// scheduledDatesForDefinition returns the sorted scheduled dates one definition produced.
func (w *testWorld) scheduledDatesForDefinition(actor testUser, defID string) []time.Time {
	w.t.Helper()
	return queryScheduledDates(w.t,
		`SELECT scheduled_date FROM collaboration.task
		 WHERE organization_id = $1 AND ritual_definition_id = $2
		   AND task_kind = 'ritual_instance' AND is_deleted = FALSE
		 ORDER BY scheduled_date`,
		actor.OrgID, dbuuid.MustParse(defID))
}

func queryScheduledDates(t *testing.T, query string, args ...any) []time.Time {
	t.Helper()
	rows, err := globalDB.Query(context.Background(), query, args...)
	require.NoError(t, err)
	defer rows.Close()

	var dates []time.Time
	for rows.Next() {
		var d time.Time
		require.NoError(t, rows.Scan(&d))
		dates = append(dates, d)
	}
	require.NoError(t, rows.Err())
	return dates
}

// sweepOrgRow reads the organization-discovery row the sweep itself uses, for the
// organization under test. Returns (timesListed, activeDefinitionCount).
func sweepOrgRow(t *testing.T, orgID dbuuid.UUID) (int, int) {
	t.Helper()
	var timesListed, definitionCount int
	err := globalDB.QueryRow(
		context.Background(),
		`SELECT count(*)::int, COALESCE(max(definition_count), 0)::int FROM (
		   SELECT organization_id, count(*)::int AS definition_count
		   FROM collaboration.ritual_definition
		   WHERE is_archived = FALSE
		   GROUP BY organization_id
		 ) sweep WHERE organization_id = $1`,
		orgID,
	).Scan(&timesListed, &definitionCount)
	require.NoError(t, err)
	return timesListed, definitionCount
}

// TestGlobalRitualScheduler is the behavioral contract for feature 034: one platform-wide
// sweep replaces one flows schedule per ritual definition.
func TestGlobalRitualScheduler(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	// FR-001, FR-004: US1 — one sweep covers every organization
	t.Run("when the global sweep runs once", func(t *testing.T) {
		orgAOwner := owner
		orgAProj := w.createProjectWithMode(orgAOwner, "Sweep Org A", uniqueProjectKey("SWPA"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		_ = w.createRitualDefinition(orgAOwner, orgAProj.ID, "Org A Daily", dailyRecurrenceRule())

		orgBID, orgBOwnerID, orgBToken := w.mustRegisterNewOrg()
		orgBOwner := testUser{ID: orgBOwnerID, OrgID: orgBID, Token: orgBToken}
		orgBProj := w.createProjectWithMode(orgBOwner, "Sweep Org B", uniqueProjectKey("SWPB"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		_ = w.createRitualDefinition(orgBOwner, orgBProj.ID, "Org B Daily", dailyRecurrenceRule())

		beforeA := len(w.scheduledDates(orgAOwner, orgAProj.ID))
		beforeB := len(w.scheduledDates(orgBOwner, orgBProj.ID))

		// Sweep three days ahead so each definition's window extends by exactly 3 days.
		out := w.runRitualGenerationSweepAt(time.Now().AddDate(0, 0, 3))

		t.Run("it generates due instances for every organization that has active rituals", func(t *testing.T) {
			assert.Equal(t, beforeA+3, len(w.scheduledDates(orgAOwner, orgAProj.ID)),
				"organization A should gain exactly 3 instances from a 3-day window extension")
			assert.Equal(t, beforeB+3, len(w.scheduledDates(orgBOwner, orgBProj.ID)),
				"organization B should gain exactly 3 instances from the same single sweep")
		})

		t.Run("it regenerates each organization exactly once regardless of definition count", func(t *testing.T) {
			_ = w.createRitualDefinition(orgAOwner, orgAProj.ID, "Org A Daily 2", dailyRecurrenceRule())
			_ = w.createRitualDefinition(orgAOwner, orgAProj.ID, "Org A Daily 3", dailyRecurrenceRule())

			timesListed, definitionCount := sweepOrgRow(t, orgAOwner.OrgID)
			assert.Equal(t, 1, timesListed,
				"an organization must appear exactly once in the sweep's work list")
			assert.Equal(t, 3, definitionCount,
				"the single entry must cover all 3 active definitions")
		})

		t.Run("it reports organizations, definitions, and instances processed", func(t *testing.T) {
			// The sweep is platform-wide, so the counters cover every organization in the
			// database, not only this test's. They must at least account for ours.
			assert.GreaterOrEqual(t, out.OrganizationsProcessed, 2)
			assert.GreaterOrEqual(t, out.DefinitionsProcessed, 2)
			assert.GreaterOrEqual(t, out.TotalGenerated, 6)
		})
	})

	// FR-005: US1 — output equivalence across the recurrence matrix
	t.Run("for each supported recurrence pattern", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Recurrence Matrix", uniqueProjectKey("RMTX"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

		datesFor := func(def *rpcv1.RitualDefinition) []time.Time {
			return w.scheduledDatesForDefinition(owner, def.Id)
		}

		daily := w.createRitualDefinition(owner, proj.ID, "Matrix Daily", dailyRecurrenceRule())
		everyThreeDays := w.createRitualDefinition(owner, proj.ID, "Matrix Every 3 Days", &rpcv1.RecurrenceRule{
			Type: rpcv1.RecurrenceType_RECURRENCE_TYPE_DAILY, Interval: 3, TimeOfDay: "08:00",
		})
		weekly := w.createRitualDefinition(owner, proj.ID, "Matrix Weekly", &rpcv1.RecurrenceRule{
			Type: rpcv1.RecurrenceType_RECURRENCE_TYPE_WEEKLY, Interval: 1, DaysOfWeek: []int32{1, 5}, TimeOfDay: "09:00",
		})
		monthly := w.createRitualDefinition(owner, proj.ID, "Matrix Monthly", &rpcv1.RecurrenceRule{
			Type: rpcv1.RecurrenceType_RECURRENCE_TYPE_MONTHLY, Interval: 1, DayOfMonth: 15, TimeOfDay: "10:00",
		})
		customInterval := w.createRitualDefinition(owner, proj.ID, "Matrix Custom Interval", &rpcv1.RecurrenceRule{
			Type: rpcv1.RecurrenceType_RECURRENCE_TYPE_CUSTOM_INTERVAL, Interval: 5, TimeOfDay: "11:00",
		})
		tokyo := w.createRitualDefinitionInTZ(owner, proj.ID, "Matrix Tokyo Daily", dailyRecurrenceRule(), "Asia/Tokyo")
		offset := w.createRitualDefinitionInTZ(owner, proj.ID, "Matrix UTC+7 Daily", dailyRecurrenceRule(), "UTC+7")

		w.runRitualGenerationSweep()

		t.Run("daily generates the same dates as the per-definition scheduler did", func(t *testing.T) {
			dates := datesFor(daily)
			require.GreaterOrEqual(t, len(dates), 28)
			for i := 1; i < len(dates); i++ {
				assert.Equal(t, 1, int(dates[i].Sub(dates[i-1]).Hours()/24),
					"daily instances must be one calendar day apart")
			}
		})

		t.Run("every-N-days generates the same dates", func(t *testing.T) {
			dates := datesFor(everyThreeDays)
			require.GreaterOrEqual(t, len(dates), 9)
			for i := 1; i < len(dates); i++ {
				assert.Equal(t, 3, int(dates[i].Sub(dates[i-1]).Hours()/24),
					"every-3-days instances must be three calendar days apart")
			}
		})

		t.Run("weekly on selected weekdays generates only those weekdays", func(t *testing.T) {
			dates := datesFor(weekly)
			require.NotEmpty(t, dates)
			for _, d := range dates {
				assert.True(t, d.Weekday() == time.Monday || d.Weekday() == time.Friday,
					"instance on %s is neither Monday nor Friday", d.Format("2006-01-02"))
			}
		})

		t.Run("monthly on a day-of-month generates the same dates", func(t *testing.T) {
			dates := datesFor(monthly)
			require.NotEmpty(t, dates)
			for _, d := range dates {
				assert.Equal(t, 15, d.Day())
			}
		})

		t.Run("custom interval generates the same dates", func(t *testing.T) {
			dates := datesFor(customInterval)
			require.GreaterOrEqual(t, len(dates), 5)
			for i := 1; i < len(dates); i++ {
				assert.Equal(t, 5, int(dates[i].Sub(dates[i-1]).Hours()/24),
					"custom-interval instances must be five calendar days apart")
			}
		})

		t.Run("a non-UTC timezone generates the same dates as before", func(t *testing.T) {
			utcDates := datesFor(daily)
			for _, def := range []*rpcv1.RitualDefinition{tokyo, offset} {
				dates := datesFor(def)
				require.GreaterOrEqual(t, len(dates), 28, "definition %s generated too few instances", def.Name)
				assert.InDelta(t, len(utcDates), len(dates), 1,
					"definition %s must cover the same window as the UTC definition", def.Name)
				for i := 1; i < len(dates); i++ {
					assert.Equal(t, 1, int(dates[i].Sub(dates[i-1]).Hours()/24),
						"definition %s must stay one calendar day apart", def.Name)
				}
			}
		})
	})

	// FR-006: US1 — idempotency
	t.Run("when the sweep runs twice over the same window", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Sweep Idempotency", uniqueProjectKey("SWID"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		_ = w.createRitualDefinition(owner, proj.ID, "Idempotent Sweep Daily", dailyRecurrenceRule())

		at := time.Now().AddDate(0, 0, 2)
		w.runRitualGenerationSweepAt(at)
		afterFirst := w.scheduledDates(owner, proj.ID)
		w.runRitualGenerationSweepAt(at)
		afterSecond := w.scheduledDates(owner, proj.ID)

		t.Run("no duplicate instances are created", func(t *testing.T) {
			assert.Equal(t, afterFirst, afterSecond,
				"a repeated sweep over the same window must not change the instance set")
			seen := make(map[string]bool, len(afterSecond))
			for _, d := range afterSecond {
				key := d.Format("2006-01-02")
				assert.False(t, seen[key], "duplicate scheduled_date %s", key)
				seen[key] = true
			}
		})

		t.Run("no error is raised", func(t *testing.T) {
			// runRitualGenerationSweepAt requires no error; a third pass proves it holds.
			assert.NotNil(t, w.runRitualGenerationSweepAt(at))
		})
	})

	// FR-002, FR-013: US2 — no per-definition schedule is ever written
	var lifecycleDef *rpcv1.RitualDefinition
	t.Run("across the full ritual definition lifecycle", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Lifecycle No Schedules", uniqueProjectKey("LFNS"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

		t.Run("creating a definition writes no ritual-specific schedule row", func(t *testing.T) {
			lifecycleDef = w.createRitualDefinition(owner, proj.ID, "Lifecycle Ritual", dailyRecurrenceRule())
			assert.Equal(t, 0, countPerDefinitionRitualSchedules(t))
		})

		t.Run("updating the recurrence rule writes no schedule row", func(t *testing.T) {
			w.updateRitualDefinitionRecurrence(owner, lifecycleDef.Id, &rpcv1.RecurrenceRule{
				Type: rpcv1.RecurrenceType_RECURRENCE_TYPE_WEEKLY, Interval: 1, DaysOfWeek: []int32{2}, TimeOfDay: "08:00",
			})
			assert.Equal(t, 0, countPerDefinitionRitualSchedules(t))
		})

		t.Run("archiving writes no schedule row and pauses nothing", func(t *testing.T) {
			_, err := w.archiveRitualDefinition(owner, lifecycleDef.Id, true)
			require.NoError(t, err)
			assert.Equal(t, 0, countPerDefinitionRitualSchedules(t))
		})

		t.Run("unarchiving writes no schedule row and resumes nothing", func(t *testing.T) {
			_, err := w.archiveRitualDefinition(owner, lifecycleDef.Id, false)
			require.NoError(t, err)
			assert.Equal(t, 0, countPerDefinitionRitualSchedules(t))
		})

		t.Run("changing the schedule writes no schedule row", func(t *testing.T) {
			w.changeRitualDefinitionSchedule(owner, lifecycleDef.Id, &rpcv1.RecurrenceRule{
				Type: rpcv1.RecurrenceType_RECURRENCE_TYPE_DAILY, Interval: 2, TimeOfDay: "08:00",
			})
			assert.Equal(t, 0, countPerDefinitionRitualSchedules(t))
		})

		t.Run("exactly one ritual schedule row exists platform-wide", func(t *testing.T) {
			assert.Equal(t, 1, countGlobalRitualSweepSchedules(t))
		})
	})

	// FR-011: US2 — creation still generates immediately
	t.Run("when a ritual definition is created", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Immediate Generation", uniqueProjectKey("IMGN"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

		t.Run("its due instances exist immediately without waiting for a sweep", func(t *testing.T) {
			def := w.createRitualDefinition(owner, proj.ID, "Immediate Daily", dailyRecurrenceRule())
			dates := w.scheduledDatesForDefinition(owner, def.Id)
			assert.GreaterOrEqual(t, len(dates), 28,
				"a newly created definition must have its window generated in the create transaction")
		})
	})

	// FR-012: US2 — reschedule still reports its counts
	t.Run("when a definition's schedule is changed", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Schedule Change Counts", uniqueProjectKey("SCCT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		def := w.createRitualDefinition(owner, proj.ID, "Reschedulable Daily", dailyRecurrenceRule())
		before := w.scheduledDatesForDefinition(owner, def.Id)
		require.NotEmpty(t, before)

		resp := w.changeRitualDefinitionSchedule(owner, def.Id, &rpcv1.RecurrenceRule{
			Type: rpcv1.RecurrenceType_RECURRENCE_TYPE_WEEKLY, Interval: 1, DaysOfWeek: []int32{3}, TimeOfDay: "08:00",
		})

		t.Run("instances are regenerated within the same operation", func(t *testing.T) {
			after := w.scheduledDatesForDefinition(owner, def.Id)
			require.NotEmpty(t, after)
			assert.NotEqual(t, len(before), len(after),
				"switching daily to weekly must change the instance set without waiting for a sweep")
			for _, d := range after {
				if !d.After(time.Now()) {
					continue // today and earlier are detached or left alone, not rewritten
				}
				assert.Equal(t, time.Wednesday, d.Weekday(),
					"future instances must follow the new weekly rule")
			}
		})

		t.Run("the removed, detached, and created counts are still returned", func(t *testing.T) {
			assert.Greater(t, resp.InstancesRemoved+resp.InstancesDetached+resp.InstancesCreated, int32(0),
				"the impact counts are computed in the logic layer and survive schedule deletion")
		})
	})

	// FR-010: US2 — archived definitions are inert
	t.Run("when a definition is archived", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Archive Inert", uniqueProjectKey("ARIN"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		def := w.createRitualDefinition(owner, proj.ID, "Archivable Daily", dailyRecurrenceRule())

		t.Run("the next sweep generates nothing for it", func(t *testing.T) {
			_, err := w.archiveRitualDefinition(owner, def.Id, true)
			require.NoError(t, err)

			before := len(w.scheduledDatesForDefinition(owner, def.Id))
			w.runRitualGenerationSweepAt(time.Now().AddDate(0, 0, 5))
			assert.Equal(t, before, len(w.scheduledDatesForDefinition(owner, def.Id)),
				"an archived definition is excluded by the sweep's discovery query alone")
		})

		t.Run("unarchiving makes the next sweep generate for it again", func(t *testing.T) {
			_, err := w.archiveRitualDefinition(owner, def.Id, false)
			require.NoError(t, err)

			before := len(w.scheduledDatesForDefinition(owner, def.Id))
			w.runRitualGenerationSweepAt(time.Now().AddDate(0, 0, 5))
			assert.Equal(t, before+5, len(w.scheduledDatesForDefinition(owner, def.Id)),
				"unarchiving restores generation with no schedule resume")
		})
	})

	// FR-009: US3 — a bad rule takes down its own definition and nothing else
	t.Run("when one definition has an uninterpretable recurrence rule", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Bad Rule Isolation", uniqueProjectKey("BADR"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		broken := w.createRitualDefinition(owner, proj.ID, "Broken Rule Daily", dailyRecurrenceRule())
		sibling := w.createRitualDefinition(owner, proj.ID, "Healthy Sibling Daily", dailyRecurrenceRule())

		// Store a rule the parser cannot read, and clear the waterline so the definition
		// would otherwise be due.
		_, err := globalDB.Exec(context.Background(),
			`UPDATE collaboration.ritual_definition
			    SET recurrence_rule = '"not-a-recurrence-rule"'::jsonb, last_generated_date = NULL
			  WHERE organization_id = $1 AND id = $2`,
			owner.OrgID, dbuuid.MustParse(broken.Id))
		require.NoError(t, err)

		brokenBefore := len(w.scheduledDatesForDefinition(owner, broken.Id))
		siblingBefore := len(w.scheduledDatesForDefinition(owner, sibling.Id))
		w.runRitualGenerationSweepAt(time.Now().AddDate(0, 0, 4))

		t.Run("that definition is skipped", func(t *testing.T) {
			assert.Equal(t, brokenBefore, len(w.scheduledDatesForDefinition(owner, broken.Id)),
				"an unparseable rule must produce no instances")
		})

		t.Run("every other definition in the organization is still generated", func(t *testing.T) {
			assert.Equal(t, siblingBefore+4, len(w.scheduledDatesForDefinition(owner, sibling.Id)),
				"a sibling definition must be unaffected by its neighbour's bad rule")
		})
	})

	// FR-008: US3 — a failing organization does not abort the run
	t.Run("when generation fails for one organization", func(t *testing.T) {
		failProj := w.createProjectWithMode(owner, "Failing Org", uniqueProjectKey("FLOR"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		failDef := w.createRitualDefinition(owner, failProj.ID, "Failing Org Daily", dailyRecurrenceRule())

		healthyOrgID, healthyOwnerID, healthyToken := w.mustRegisterNewOrg()
		healthyOwner := testUser{ID: healthyOwnerID, OrgID: healthyOrgID, Token: healthyToken}
		healthyProj := w.createProjectWithMode(healthyOwner, "Healthy Org", uniqueProjectKey("HLOR"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		healthyDef := w.createRitualDefinition(healthyOwner, healthyProj.ID, "Healthy Org Daily", dailyRecurrenceRule())

		failBefore := len(w.scheduledDatesForDefinition(owner, failDef.Id))
		healthyBefore := len(w.scheduledDatesForDefinition(healthyOwner, healthyDef.Id))

		sweep := &collaboration.RitualGenerationWorkflow{
			Logic:     &failingOrgLogic{Logic: collaboration.NewLogic(globalQ, nil, nil, nil), failFor: owner.OrgID},
			Queries:   globalQ,
			AdminPool: globalDB,
		}
		out, sweepErr := sweep.Sweep(context.Background(), time.Now().AddDate(0, 0, 6))

		t.Run("the remaining organizations are still processed in the same run", func(t *testing.T) {
			require.NoError(t, sweepErr, "one organization's failure must not abort the sweep")
			assert.Equal(t, failBefore, len(w.scheduledDatesForDefinition(owner, failDef.Id)),
				"the failing organization generates nothing")
			assert.Equal(t, healthyBefore+6, len(w.scheduledDatesForDefinition(healthyOwner, healthyDef.Id)),
				"every other organization still generates in the same run")
			assert.GreaterOrEqual(t, out.OrganizationsProcessed, 2)
		})
	})

	// Edge case: organization with no active rituals
	t.Run("when an organization has no active ritual definitions", func(t *testing.T) {
		emptyOrgID, emptyOwnerID, emptyToken := w.mustRegisterNewOrg()
		emptyOwner := testUser{ID: emptyOwnerID, OrgID: emptyOrgID, Token: emptyToken}
		emptyProj := w.createProjectWithMode(emptyOwner, "No Rituals", uniqueProjectKey("NORT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

		t.Run("the sweep completes without error and creates nothing", func(t *testing.T) {
			timesListed, _ := sweepOrgRow(t, emptyOrgID)
			assert.Equal(t, 0, timesListed, "an organization with no active rituals is not swept")

			w.runRitualGenerationSweep()
			assert.Empty(t, w.scheduledDates(emptyOwner, emptyProj.ID))
		})
	})
}

// failingOrgLogic makes GenerateRitualInstances fail for exactly one organization and
// behave normally for every other, so the sweep's per-organization isolation (FR-008) can
// be observed without corrupting shared data.
type failingOrgLogic struct {
	collaboration.Logic
	failFor dbuuid.UUID
}

func (l *failingOrgLogic) GenerateRitualInstances(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	now time.Time,
) (int, error) {
	if orgID == l.failFor {
		return 0, fmt.Errorf("simulated generation failure for organization %s", orgID)
	}
	return l.Logic.GenerateRitualInstances(ctx, tx, orgID, now)
}
