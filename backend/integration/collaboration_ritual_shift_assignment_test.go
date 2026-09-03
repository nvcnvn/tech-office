package integration

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/calendar"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// ---------------------------------------------------------------------------
// Arrange: a ritual whose department pool draws from the rota
// ---------------------------------------------------------------------------

// onShiftRitual is one ritual definition with a single on-shift department pool, plus
// everything an assertion needs to find its instances again.
type onShiftRitual struct {
	projectID    string
	departmentID string
	definitionID string
	levels       []*rpcv1.TaskLevel
}

// onShiftCollaborationLogic builds collaboration logic wired to the *real* calendar logic,
// exactly as cmd/server.go does. These scenarios deliberately do not stub the reader: the
// RSVP, cancellation and recurrence rules are half the behaviour under test.
func onShiftCollaborationLogic() collaboration.Logic {
	logic := collaboration.NewLogic(globalQ, nil, nil, &crossOrgNotificationPublisher{})
	logic.SetShiftCoverageReader(calendar.NewLogic(globalQ, nil, nil, nil))
	return logic
}

// newOnShiftRitual creates a ritual project, a department, a daily definition whose pool
// uses the on-shift strategy, and narrows the generation window so a test reasons about a
// handful of dates rather than a month of them.
func (w *testWorld) newOnShiftRitual(owner testUser, members []testUser, windowDays int, strategy string) onShiftRitual {
	w.t.Helper()

	proj := w.createProjectWithMode(owner, "On-shift Project", uniqueProjectKey("SHIFT"),
		rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

	deptID := w.createDepartment(owner, "Shop floor "+uniqueProjectKey("D"), "")
	for _, m := range members {
		w.assignEmployeeToDepartment(owner, deptID, m.ID)
		w.addProjectMember(owner, proj.ID, m.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
	}

	def := w.createRitualDefinitionDirectWithPool(owner, proj.ID, "Closing checklist",
		dailyRecurrenceRule(), deptID, strategy)
	w.setRitualGenerationWindow(def.Id, windowDays)

	return onShiftRitual{
		projectID:    proj.ID,
		departmentID: deptID,
		definitionID: def.Id,
		levels:       proj.Levels,
	}
}

// setRitualGenerationWindow narrows how far ahead generation materialises instances.
// Written directly because no RPC exposes it, and a 30-day default would make every
// per-date assertion in this file wade through a month of irrelevant instances.
func (w *testWorld) setRitualGenerationWindow(defID string, days int) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.ritual_definition SET generation_window_days = $2 WHERE id = $1`,
		dbuuid.MustParse(defID), days)
	require.NoError(w.t, err)
}

// setPoolStrategy switches an existing pool's assignment strategy, which is what a manager
// changing their mind in the definition editor does.
func (w *testWorld) setPoolStrategy(defID, strategy string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.ritual_definition_department_pool
		 SET assignment_strategy = $2 WHERE ritual_definition_id = $1`,
		dbuuid.MustParse(defID), strategy)
	require.NoError(w.t, err)
}

// setRitualTimezone rewrites the definition's timezone. Written directly because the whole
// point of the timezone scenario is that the ritual's own zone decides which UTC instants
// bound its scheduled date, and the definition editor is not what is under test.
func (w *testWorld) setRitualTimezone(defID, tz string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.ritual_definition SET timezone = $2 WHERE id = $1`,
		dbuuid.MustParse(defID), tz)
	require.NoError(w.t, err)
}

// deactivateEmployeeDirect is how a departed worker looks to the pool: still a department
// member row, no longer an active employee.
func (w *testWorld) deactivateEmployeeDirect(employeeID dbuuid.UUID) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE organization.employee SET is_active = FALSE WHERE id = $1`, employeeID)
	require.NoError(w.t, err)
}

// addRitualDefinitionAssigneeDirect names an individual assignee on a definition that was
// created with a pool, which is the "both at once" shape the strategy must not disturb.
func (w *testWorld) addRitualDefinitionAssigneeDirect(defID string, orgID, employeeID dbuuid.UUID) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`INSERT INTO collaboration.ritual_definition_assignee (organization_id, ritual_definition_id, employee_id)
		 VALUES ($1, $2, $3)`,
		orgID, dbuuid.MustParse(defID), employeeID)
	require.NoError(w.t, err)
}

// removeDepartmentMembersDirect empties a pool's department, which is what makes a slot
// wait forever and then escalate.
func (w *testWorld) removeDepartmentMembersDirect(deptID string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`DELETE FROM organization.department_member WHERE department_id = $1`, dbuuid.MustParse(deptID))
	require.NoError(w.t, err)
}

// unassignTaskDirect removes an assignee the way a manager replacing them does. Written
// directly because the manual-override freeze is about the *absence* of the row this
// feature wrote, and going through the RPC would add a second actor to reason about.
func (w *testWorld) unassignTaskDirect(taskID string, employeeID dbuuid.UUID) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`DELETE FROM collaboration.task_assignee
		 WHERE task_id = $1 AND employee_id = $2 AND role = 'assignee'`,
		dbuuid.MustParse(taskID), employeeID)
	require.NoError(w.t, err)
}

// addSecondOnShiftPoolDirect gives a definition a second on-shift pool, which is the shape
// that decides whether an instance reports the least-progressed of its pools.
func (w *testWorld) addSecondOnShiftPoolDirect(defID string, orgID dbuuid.UUID, departmentID string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`INSERT INTO collaboration.ritual_definition_department_pool
		     (organization_id, ritual_definition_id, department_id, assignment_strategy)
		 VALUES ($1, $2, $3, 'on_shift')`,
		orgID, dbuuid.MustParse(defID), dbuuid.MustParse(departmentID))
	require.NoError(w.t, err)
}

// generateOnShiftInstancesAt drives generation with the shift coverage reader wired.
func (w *testWorld) generateOnShiftInstancesAt(actor testUser, now time.Time) int {
	w.t.Helper()
	count, err := onShiftCollaborationLogic().GenerateRitualInstances(context.Background(), globalDB, actor.OrgID, now)
	require.NoError(w.t, err)
	return count
}

// generateInstancesWithNoCalendarAt drives generation with a nil reader, which is the
// state the seeder and every pre-existing test harness runs in.
func (w *testWorld) generateInstancesWithNoCalendarAt(actor testUser, now time.Time) int {
	w.t.Helper()
	logic := collaboration.NewLogic(globalQ, nil, nil, &crossOrgNotificationPublisher{})
	count, err := logic.GenerateRitualInstances(context.Background(), globalDB, actor.OrgID, now)
	require.NoError(w.t, err)
	return count
}

// resolveShiftAssignmentsAt drives one organization's resolution pass. Preferred over the
// platform-wide sweep in tests that assert exact notification counts, for the same reason
// reconcileOrganizationAt is: two parallel tests each driving a global sweep would sweep
// each other's organizations and make "exactly one notification" a race.
func (w *testWorld) resolveShiftAssignmentsAt(actor testUser, now time.Time) collaboration.RitualShiftResolutionCounts {
	w.t.Helper()
	counts, err := onShiftCollaborationLogic().ResolveRitualShiftAssignments(context.Background(), globalDB, actor.OrgID, now)
	require.NoError(w.t, err)
	return counts
}

// runShiftResolutionSweepAt drives the platform-wide sweep, which is what proves the
// discovery query and the per-organization failure isolation work.
func (w *testWorld) runShiftResolutionSweepAt(now time.Time) *collaboration.RitualShiftResolutionOutput {
	w.t.Helper()
	sweep := &collaboration.RitualShiftResolutionWorkflow{
		Logic:     onShiftCollaborationLogic(),
		Queries:   globalQ,
		AdminPool: globalDB,
	}
	out, err := sweep.Sweep(context.Background(), now)
	require.NoError(w.t, err)
	return out
}

// poolSlot is the stored late-binding record for one instance.
type poolSlot struct {
	state        string
	assignee     dbuuid.NullUUID
	closedReason pgtype.Text
	escalatedAt  pgtype.Timestamptz
}

func (w *testWorld) poolSlotFor(taskID string) (poolSlot, bool) {
	w.t.Helper()
	var s poolSlot
	err := globalDB.QueryRow(context.Background(),
		`SELECT resolution_state, assigned_employee_id, closed_reason, escalated_at
		 FROM collaboration.ritual_instance_pool_assignment WHERE task_id = $1`,
		dbuuid.MustParse(taskID)).Scan(&s.state, &s.assignee, &s.closedReason, &s.escalatedAt)
	if err != nil {
		return poolSlot{}, false
	}
	return s, true
}

func (w *testWorld) requirePoolSlot(taskID string) poolSlot {
	w.t.Helper()
	s, ok := w.poolSlotFor(taskID)
	require.True(w.t, ok, "expected a pool assignment row for task %s", taskID)
	return s
}

// taskAssigneeIDs reads the instance's actual assignees, which is the thing the whole
// feature exists to get right.
func (w *testWorld) taskAssigneeIDs(taskID string) []dbuuid.UUID {
	w.t.Helper()
	rows, err := globalDB.Query(context.Background(),
		`SELECT employee_id FROM collaboration.task_assignee
		 WHERE task_id = $1 AND role = 'assignee' ORDER BY employee_id`,
		dbuuid.MustParse(taskID))
	require.NoError(w.t, err)
	defer rows.Close()
	var out []dbuuid.UUID
	for rows.Next() {
		var id dbuuid.UUID
		require.NoError(w.t, rows.Scan(&id))
		out = append(out, id)
	}
	require.NoError(w.t, rows.Err())
	return out
}

// instancesByDate indexes an on-shift ritual's generated instances by their scheduled date
// so a scenario can say "the Wednesday one" without counting.
func (w *testWorld) instancesByDate(actor testUser, projectID string) map[string]*rpcv1.Task {
	w.t.Helper()
	out := map[string]*rpcv1.Task{}
	for _, task := range w.listTasksWithKind(actor, projectID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)) {
		out[task.ScheduledDate] = task
	}
	return out
}

// dateKey renders a UTC instant the way scheduled_date comes back over the wire.
func dateKey(t time.Time) string { return t.UTC().Format("2006-01-02") }

// rosterDay puts an employee on an ordinary 09:00–17:00 shift covering one UTC date.
func (w *testWorld) rosterDay(manager testUser, worker testUser, day time.Time) *rpcv1.CalendarEvent {
	w.t.Helper()
	dayStart, _ := utcDay(day)
	return w.calCreateShift(manager, "Shift "+dateKey(day),
		dayStart.Add(9*time.Hour), dayStart.Add(17*time.Hour), employeeIDStrings(worker))
}

// generationAnchor is the "now" every scenario generates from: midday UTC, so a generated
// scheduled_date and the UTC date of the shift covering it cannot disagree because of the
// wall clock the suite happens to run at.
func generationAnchor() time.Time {
	return time.Now().UTC().Truncate(24 * time.Hour).Add(12 * time.Hour)
}

// ---------------------------------------------------------------------------
// TestRitualOnShiftAssignment
// ---------------------------------------------------------------------------

func TestRitualOnShiftAssignment(t *testing.T) {
	t.Parallel()

	// ── User Story 1: the closing checklist goes to whoever is closing ──────────

	t.Run("when two members split the week between them", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		alice := w.withEmployee()
		bob := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{alice, bob}, 5, "on_shift")

		// Alice covers days 1 and 3, Bob covers days 2 and 4.
		days := []time.Time{now.AddDate(0, 0, 1), now.AddDate(0, 0, 2), now.AddDate(0, 0, 3), now.AddDate(0, 0, 4)}
		w.rosterDay(manager, alice, days[0])
		w.rosterDay(manager, bob, days[1])
		w.rosterDay(manager, alice, days[2])
		w.rosterDay(manager, bob, days[3])

		w.generateOnShiftInstancesAt(manager, now)
		instances := w.instancesByDate(manager, ritual.projectID)

		t.Run("the ritual assigns each date to the member rostered that day", func(t *testing.T) {
			for i, day := range days {
				expected := alice
				if i%2 == 1 {
					expected = bob
				}
				inst := instances[dateKey(day)]
				require.NotNil(t, inst, "expected an instance for %s", dateKey(day))
				assert.Equal(t, []dbuuid.UUID{expected.ID}, w.taskAssigneeIDs(inst.Id),
					"%s should belong to the member rostered that day", dateKey(day))
			}
		})

		t.Run("nobody who is off on a date is ever assigned that date's instance", func(t *testing.T) {
			for i, day := range days {
				off := bob
				if i%2 == 1 {
					off = alice
				}
				assert.NotContains(t, w.taskAssigneeIDs(instances[dateKey(day)].Id), off.ID)
			}
		})

		t.Run("each assigned slot records that it resolved", func(t *testing.T) {
			slot := w.requirePoolSlot(instances[dateKey(days[0])].Id)
			assert.Equal(t, "resolved", slot.state)
			assert.True(t, slot.assignee.Valid)
			assert.Equal(t, alice.ID, dbuuid.UUID(slot.assignee.UUID))
		})
	})

	t.Run("when three members all cover the same date", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		members := w.withEmployees(3)

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, members, 2, "on_shift")

		day := now.AddDate(0, 0, 1)
		for _, m := range members {
			w.rosterDay(manager, m, day)
		}

		w.generateOnShiftInstancesAt(manager, now)
		inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
		require.NotNil(t, inst)

		assignees := w.taskAssigneeIDs(inst.Id)

		t.Run("exactly one of them is assigned", func(t *testing.T) {
			assert.Len(t, assignees, 1)
		})

		t.Run("the winner is one of the rostered members", func(t *testing.T) {
			assert.Contains(t, employeeIDs(members...), assignees[0])
		})

		t.Run("resolving twice over unchanged data chooses the same member both times", func(t *testing.T) {
			w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))
			assert.Equal(t, assignees, w.taskAssigneeIDs(inst.Id))
		})
	})

	t.Run("when a covering shift is declined or cancelled", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		decliner := w.withEmployee()
		cancelled := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{decliner, cancelled}, 4, "on_shift")

		declineDay := now.AddDate(0, 0, 1)
		cancelDay := now.AddDate(0, 0, 2)

		declined := w.rosterDay(manager, decliner, declineDay)
		w.calRespondToInvite(decliner, declined.Id, rpcv1.RSVPResponse_RSVP_RESPONSE_DECLINED)

		cancelledEvent := w.rosterDay(manager, cancelled, cancelDay)
		w.calCancelEvent(manager, cancelledEvent.Id)

		w.generateOnShiftInstancesAt(manager, now)
		instances := w.instancesByDate(manager, ritual.projectID)

		t.Run("a member who declined their covering shift is not assigned the instance", func(t *testing.T) {
			assert.Empty(t, w.taskAssigneeIDs(instances[dateKey(declineDay)].Id))
			assert.Equal(t, "awaiting_shift", w.requirePoolSlot(instances[dateKey(declineDay)].Id).state)
		})

		t.Run("a member whose covering shift was cancelled is not assigned the instance", func(t *testing.T) {
			assert.Empty(t, w.taskAssigneeIDs(instances[dateKey(cancelDay)].Id))
			assert.Equal(t, "awaiting_shift", w.requirePoolSlot(instances[dateKey(cancelDay)].Id).state)
		})
	})

	t.Run("when a rostered person is no longer eligible for the pool", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		outsider := w.withEmployee()
		deactivated := w.withEmployee()

		now := generationAnchor()
		// Only `deactivated` joins the department; `outsider` is rostered but never a member.
		ritual := w.newOnShiftRitual(manager, []testUser{deactivated}, 3, "on_shift")
		w.addProjectMember(manager, ritual.projectID, outsider.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		day := now.AddDate(0, 0, 1)
		w.rosterDay(manager, outsider, day)
		w.rosterDay(manager, deactivated, day)
		w.deactivateEmployeeDirect(deactivated.ID)

		w.generateOnShiftInstancesAt(manager, now)
		inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
		require.NotNil(t, inst)

		t.Run("a rostered employee who is not in the pool department is not eligible", func(t *testing.T) {
			assert.NotContains(t, w.taskAssigneeIDs(inst.Id), outsider.ID)
		})

		t.Run("a rostered employee who is deactivated is not eligible", func(t *testing.T) {
			assert.NotContains(t, w.taskAssigneeIDs(inst.Id), deactivated.ID)
		})

		t.Run("the slot waits rather than guessing", func(t *testing.T) {
			assert.Equal(t, "awaiting_shift", w.requirePoolSlot(inst.Id).state)
		})
	})

	t.Run("when the ritual keeps its own timezone", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{worker}, 3, "on_shift")
		w.setRitualTimezone(ritual.definitionID, "Asia/Tokyo")

		// Tokyo is UTC+9, so the Tokyo date D starts at 15:00 UTC on D-1. A shift stored
		// in UTC that runs from 16:00 to 23:00 on D-1 is inside the Tokyo date D.
		day := now.AddDate(0, 0, 2)
		tokyoDayStartUTC := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC).Add(-9 * time.Hour)
		w.calCreateShift(manager, "Tokyo evening shift",
			tokyoDayStartUTC.Add(time.Hour), tokyoDayStartUTC.Add(8*time.Hour), employeeIDStrings(worker))

		w.generateOnShiftInstancesAt(manager, now)

		t.Run("a shift stored in UTC and a ritual in Asia Tokyo agree on which date is covered", func(t *testing.T) {
			inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
			require.NotNil(t, inst, "expected an instance for the Tokyo date %s", dateKey(day))
			assert.Equal(t, []dbuuid.UUID{worker.ID}, w.taskAssigneeIDs(inst.Id))
		})
	})

	t.Run("when the definition also names individual assignees", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		named := w.withEmployee()
		rostered := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{rostered}, 3, "on_shift")
		w.addRitualDefinitionAssigneeDirect(ritual.definitionID, manager.OrgID, named.ID)

		day := now.AddDate(0, 0, 1)
		w.rosterDay(manager, rostered, day)

		w.generateOnShiftInstancesAt(manager, now)
		inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
		require.NotNil(t, inst)

		t.Run("named individual assignees are still assigned alongside the pool slot", func(t *testing.T) {
			assignees := w.taskAssigneeIDs(inst.Id)
			assert.Contains(t, assignees, named.ID)
			assert.Contains(t, assignees, rostered.ID)
		})
	})

	t.Run("when a pool uses one of the older strategies", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		// Separate members per ritual: department membership in this schema is exclusive,
		// so reusing one pair would empty the first pool when the second one claims them.
		roundRobinMembers := w.withEmployees(2)
		leastAssignedMembers := w.withEmployees(2)

		now := generationAnchor()
		roundRobin := w.newOnShiftRitual(manager, roundRobinMembers, 2, "round_robin")
		leastAssigned := w.newOnShiftRitual(manager, leastAssignedMembers, 2, "least_assigned")

		w.generateOnShiftInstancesAt(manager, now)

		t.Run("a round robin pool still assigns without any rota", func(t *testing.T) {
			for _, inst := range w.instancesByDate(manager, roundRobin.projectID) {
				assert.Len(t, w.taskAssigneeIDs(inst.Id), 1)
			}
		})

		t.Run("a least assigned pool still assigns without any rota", func(t *testing.T) {
			for _, inst := range w.instancesByDate(manager, leastAssigned.projectID) {
				assert.Len(t, w.taskAssigneeIDs(inst.Id), 1)
			}
		})

		t.Run("neither records an on-shift slot", func(t *testing.T) {
			for _, inst := range w.instancesByDate(manager, roundRobin.projectID) {
				_, ok := w.poolSlotFor(inst.Id)
				assert.False(t, ok, "a round-robin pool has nothing to late-bind")
			}
		})
	})
}

// ---------------------------------------------------------------------------
// TestRitualOnShiftLateBinding — User Story 2: wait, never guess
// ---------------------------------------------------------------------------

func TestRitualOnShiftLateBinding(t *testing.T) {
	t.Parallel()

	t.Run("when a window is generated with no rota published", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{worker}, 10, "on_shift")

		w.generateOnShiftInstancesAt(manager, now)
		instances := w.instancesByDate(manager, ritual.projectID)
		require.NotEmpty(t, instances)

		t.Run("every instance is created with its pool slot unassigned", func(t *testing.T) {
			for date, inst := range instances {
				assert.Empty(t, w.taskAssigneeIDs(inst.Id), "instance for %s should have nobody", date)
			}
		})

		t.Run("every pool slot is recorded as awaiting shift resolution", func(t *testing.T) {
			// Scoped to strictly future dates. Generation's first date is today, whose
			// resolve_by has already passed, so the platform-wide sweep another parallel
			// test drives may legitimately have escalated it already.
			for date, inst := range instances {
				if date <= dateKey(now) {
					continue
				}
				assert.Equal(t, "awaiting_shift", w.requirePoolSlot(inst.Id).state,
					"instance for %s should be waiting", date)
			}
		})

		t.Run("no fallback to round robin or least assigned is applied", func(t *testing.T) {
			var waterline dbuuid.NullUUID
			err := globalDB.QueryRow(context.Background(),
				`SELECT last_assigned_employee_id FROM collaboration.ritual_definition_department_pool
				 WHERE ritual_definition_id = $1`, dbuuid.MustParse(ritual.definitionID)).Scan(&waterline)
			require.NoError(t, err)
			assert.False(t, waterline.Valid,
				"an on-shift pool must never advance the round-robin waterline")
		})

		t.Run("publishing one week of shifts assigns exactly those seven instances", func(t *testing.T) {
			covered := make([]time.Time, 0, 7)
			for i := 1; i <= 7; i++ {
				day := now.AddDate(0, 0, i)
				w.rosterDay(manager, worker, day)
				covered = append(covered, day)
			}

			w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))

			// Asserted per date rather than by the pass's counter: the platform-wide
			// sweep another parallel test drives may have bound some of these already,
			// which changes who counted them but never which ones are assigned.
			for _, day := range covered {
				inst := instances[dateKey(day)]
				require.NotNil(t, inst)
				assert.Equal(t, []dbuuid.UUID{worker.ID}, w.taskAssigneeIDs(inst.Id),
					"the covered date %s should be assigned", dateKey(day))
				assert.Equal(t, "resolved", w.requirePoolSlot(inst.Id).state)
			}

			for date, inst := range instances {
				if date <= dateKey(now.AddDate(0, 0, 7)) {
					continue
				}
				assert.Empty(t, w.taskAssigneeIDs(inst.Id),
					"the uncovered date %s must stay unassigned", date)
			}
		})

		t.Run("the newly assigned employee is notified that the instance is now theirs", func(t *testing.T) {
			inst := instances[dateKey(now.AddDate(0, 0, 1))]
			assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "task_assigned", inst.Id))
		})

		t.Run("a second pass over unchanged data assigns nothing and notifies nobody again", func(t *testing.T) {
			counts := w.resolveShiftAssignmentsAt(manager, now.Add(2*time.Hour))
			assert.Zero(t, counts.SlotsAssigned)
			assert.Zero(t, counts.SlotsReassigned)
			assert.Zero(t, counts.SlotsWithdrawn)

			inst := instances[dateKey(now.AddDate(0, 0, 1))]
			assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "task_assigned", inst.Id))
		})

		t.Run("the instances beyond the published week are still waiting", func(t *testing.T) {
			for i := 8; i <= 9; i++ {
				inst := instances[dateKey(now.AddDate(0, 0, i))]
				if inst == nil {
					continue
				}
				assert.Equal(t, "awaiting_shift", w.requirePoolSlot(inst.Id).state)
			}
		})
	})

	t.Run("when the calendar cannot be read at all", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{worker}, 3, "on_shift")
		w.rosterDay(manager, worker, now.AddDate(0, 0, 1))

		// A nil reader is the seeder's and every legacy harness's state.
		created := w.generateInstancesWithNoCalendarAt(manager, now)
		require.Positive(t, created)

		instances := w.instancesByDate(manager, ritual.projectID)

		t.Run("a nil shift coverage reader still creates the instance", func(t *testing.T) {
			assert.NotEmpty(t, instances)
		})

		t.Run("a nil shift coverage reader leaves the slot awaiting resolution and guesses nobody", func(t *testing.T) {
			inst := instances[dateKey(now.AddDate(0, 0, 1))]
			require.NotNil(t, inst)
			assert.Empty(t, w.taskAssigneeIDs(inst.Id))
			assert.Equal(t, "awaiting_shift", w.requirePoolSlot(inst.Id).state)
		})

		t.Run("a later pass with a working calendar binds it", func(t *testing.T) {
			inst := instances[dateKey(now.AddDate(0, 0, 1))]
			w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))
			assert.Equal(t, []dbuuid.UUID{worker.ID}, w.taskAssigneeIDs(inst.Id))
		})
	})

	t.Run("when the scheduled date arrives with nobody rostered", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{worker}, 2, "on_shift")
		w.generateOnShiftInstancesAt(manager, now)

		day := now.AddDate(0, 0, 1)
		inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
		require.NotNil(t, inst)
		require.Equal(t, "awaiting_shift", w.requirePoolSlot(inst.Id).state)

		// One second past midnight on the scheduled date, in the definition's timezone.
		dayStart, _ := utcDay(day)
		arrival := dayStart.Add(time.Second)

		counts := w.resolveShiftAssignmentsAt(manager, arrival)

		t.Run("the slot stops awaiting resolution", func(t *testing.T) {
			slot := w.requirePoolSlot(inst.Id)
			assert.Equal(t, "closed_unresolved", slot.state)
			assert.Equal(t, "no_roster", slot.closedReason.String)
			assert.True(t, slot.escalatedAt.Valid)
		})

		t.Run("the sweep reports the escalation", func(t *testing.T) {
			// Generation's window also produced a today-dated instance whose date has
			// likewise arrived, so the count is "at least this one", not "exactly one".
			assert.GreaterOrEqual(t, counts.SlotsEscalated, 1)
		})

		t.Run("the project owners are alerted that it could not be assigned", func(t *testing.T) {
			assert.Equal(t, 1, w.countNotificationsFor(manager.ID, "ritual_instance_unassigned", inst.Id))
		})

		t.Run("running the resolution pass twice produces exactly one owner alert", func(t *testing.T) {
			later := w.resolveShiftAssignmentsAt(manager, arrival.Add(time.Minute))
			assert.Zero(t, later.SlotsEscalated)
			assert.Equal(t, 1, w.countNotificationsFor(manager.ID, "ritual_instance_unassigned", inst.Id))
		})

		t.Run("a closed slot is never re-resolved even if a shift appears late", func(t *testing.T) {
			w.rosterDay(manager, worker, day)
			w.resolveShiftAssignmentsAt(manager, arrival.Add(2*time.Minute))
			assert.Equal(t, "closed_unresolved", w.requirePoolSlot(inst.Id).state)
			assert.Empty(t, w.taskAssigneeIDs(inst.Id))
		})
	})

	t.Run("when the scheduled date is far in the past", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{worker}, 2, "on_shift")
		w.generateOnShiftInstancesAt(manager, now)

		day := now.AddDate(0, 0, 1)
		inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
		require.NotNil(t, inst)

		// Thirty days after the scheduled date: well past the seven-day backfill horizon.
		counts := w.resolveShiftAssignmentsAt(manager, day.AddDate(0, 0, 30))

		t.Run("the state change still happens", func(t *testing.T) {
			slot := w.requirePoolSlot(inst.Id)
			assert.Equal(t, "closed_unresolved", slot.state)
			assert.Equal(t, "no_roster", slot.closedReason.String)
			assert.GreaterOrEqual(t, counts.SlotsEscalated, 1)
		})

		t.Run("the alert is suppressed", func(t *testing.T) {
			assert.Zero(t, w.countNotificationsFor(manager.ID, "ritual_instance_unassigned", inst.Id))
			assert.False(t, w.requirePoolSlot(inst.Id).escalatedAt.Valid,
				"escalated_at records when an owner was told, and nobody was")
		})
	})

	t.Run("when the platform-wide sweep runs", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{worker}, 3, "on_shift")
		w.generateOnShiftInstancesAt(manager, now)

		day := now.AddDate(0, 0, 1)
		w.rosterDay(manager, worker, day)

		out := w.runShiftResolutionSweepAt(now.Add(time.Hour))

		t.Run("it discovers the organization holding live slots", func(t *testing.T) {
			assert.Positive(t, out.OrganizationsProcessed)
			assert.Positive(t, out.SlotsExamined)
		})

		t.Run("it binds the slot whose date is now covered", func(t *testing.T) {
			inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
			require.NotNil(t, inst)
			assert.Equal(t, []dbuuid.UUID{worker.ID}, w.taskAssigneeIDs(inst.Id))
		})
	})
}

// ---------------------------------------------------------------------------
// TestRitualOnShiftRebinding — User Story 3: the checklist follows the swap
// ---------------------------------------------------------------------------

func TestRitualOnShiftRebinding(t *testing.T) {
	t.Parallel()

	t.Run("when the covering shift moves to another member", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		alice := w.withEmployee()
		bob := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{alice, bob}, 4, "on_shift")

		day := now.AddDate(0, 0, 2)
		aliceShift := w.rosterDay(manager, alice, day)

		w.generateOnShiftInstancesAt(manager, now)
		inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
		require.NotNil(t, inst)
		require.Equal(t, []dbuuid.UUID{alice.ID}, w.taskAssigneeIDs(inst.Id))

		// The swap: Alice's shift is cancelled and Bob takes the day.
		w.calCancelEvent(manager, aliceShift.Id)
		w.rosterDay(manager, bob, day)

		counts := w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))

		t.Run("the future instance is reassigned to the member who now covers the date", func(t *testing.T) {
			assert.Equal(t, []dbuuid.UUID{bob.ID}, w.taskAssigneeIDs(inst.Id))
			assert.Equal(t, 1, counts.SlotsReassigned)

			slot := w.requirePoolSlot(inst.Id)
			assert.Equal(t, "resolved", slot.state)
			assert.Equal(t, bob.ID, dbuuid.UUID(slot.assignee.UUID))
		})

		t.Run("the previous assignee is told the instance is no longer theirs", func(t *testing.T) {
			assert.Equal(t, 1, w.countNotificationsFor(alice.ID, "task_updated", inst.Id))
		})

		t.Run("the new assignee is told the instance is now theirs", func(t *testing.T) {
			assert.Equal(t, 1, w.countNotificationsFor(bob.ID, "task_assigned", inst.Id))
		})

		t.Run("two overlapping passes reassign once and send no duplicate notification", func(t *testing.T) {
			again := w.resolveShiftAssignmentsAt(manager, now.Add(2*time.Hour))
			assert.Zero(t, again.SlotsReassigned)
			assert.Equal(t, []dbuuid.UUID{bob.ID}, w.taskAssigneeIDs(inst.Id))
			assert.Equal(t, 1, w.countNotificationsFor(alice.ID, "task_updated", inst.Id))
			assert.Equal(t, 1, w.countNotificationsFor(bob.ID, "task_assigned", inst.Id))
		})
	})

	t.Run("when the only covering shift disappears", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		alice := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{alice}, 4, "on_shift")

		day := now.AddDate(0, 0, 2)
		shift := w.rosterDay(manager, alice, day)

		w.generateOnShiftInstancesAt(manager, now)
		inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
		require.NotNil(t, inst)
		require.Equal(t, []dbuuid.UUID{alice.ID}, w.taskAssigneeIDs(inst.Id))

		w.calCancelEvent(manager, shift.Id)
		counts := w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))

		t.Run("the assignment is withdrawn and the slot returns to awaiting", func(t *testing.T) {
			assert.Equal(t, 1, counts.SlotsWithdrawn)
			assert.Empty(t, w.taskAssigneeIDs(inst.Id))

			slot := w.requirePoolSlot(inst.Id)
			assert.Equal(t, "awaiting_shift", slot.state)
			assert.False(t, slot.assignee.Valid)
		})

		t.Run("the previous assignee is told", func(t *testing.T) {
			assert.Equal(t, 1, w.countNotificationsFor(alice.ID, "task_updated", inst.Id))
		})
	})

	t.Run("when the instance is frozen", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		alice := w.withEmployee()
		bob := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{alice, bob}, 4, "on_shift")

		startedDay := now.AddDate(0, 0, 1)
		overriddenDay := now.AddDate(0, 0, 2)

		aliceStarted := w.rosterDay(manager, alice, startedDay)
		aliceOverridden := w.rosterDay(manager, alice, overriddenDay)

		w.generateOnShiftInstancesAt(manager, now)
		instances := w.instancesByDate(manager, ritual.projectID)

		started := instances[dateKey(startedDay)]
		overridden := instances[dateKey(overriddenDay)]
		require.NotNil(t, started)
		require.NotNil(t, overridden)

		// A manager takes the second instance over by hand.
		w.assignTask(manager, overridden.Id, bob.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		w.unassignTaskDirect(overridden.Id, alice.ID)

		// Both dates lose their cover and Bob takes them on the rota instead.
		w.calCancelEvent(manager, aliceStarted.Id)
		w.calCancelEvent(manager, aliceOverridden.Id)
		w.rosterDay(manager, bob, startedDay)
		w.rosterDay(manager, bob, overriddenDay)

		t.Run("an instance whose scheduled date has arrived is not reassigned", func(t *testing.T) {
			dayStart, _ := utcDay(startedDay)
			before := w.taskAssigneeIDs(started.Id)
			w.resolveShiftAssignmentsAt(manager, dayStart.Add(time.Hour))
			assert.Equal(t, before, w.taskAssigneeIDs(started.Id),
				"the date has arrived; the assignment is nobody's to move any more")
		})

		t.Run("an instance a manager reassigned by hand is never re-resolved", func(t *testing.T) {
			w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))

			assert.Equal(t, []dbuuid.UUID{bob.ID}, w.taskAssigneeIDs(overridden.Id))
			slot := w.requirePoolSlot(overridden.Id)
			assert.Equal(t, "closed_unresolved", slot.state)
			assert.Equal(t, "manual_override", slot.closedReason.String)
			assert.False(t, slot.escalatedAt.Valid, "a manual override alerts nobody")
		})

		t.Run("a closed manual override survives further passes", func(t *testing.T) {
			w.resolveShiftAssignmentsAt(manager, now.Add(2*time.Hour))
			assert.Equal(t, []dbuuid.UUID{bob.ID}, w.taskAssigneeIDs(overridden.Id))
			assert.Equal(t, "closed_unresolved", w.requirePoolSlot(overridden.Id).state)
		})
	})

	t.Run("when the pool's department is emptied", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		alice := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{alice}, 2, "on_shift")
		w.generateOnShiftInstancesAt(manager, now)

		day := now.AddDate(0, 0, 1)
		inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
		require.NotNil(t, inst)

		w.removeDepartmentMembersDirect(ritual.departmentID)
		w.rosterDay(manager, alice, day)

		t.Run("the slot keeps waiting because nobody in the department is rostered", func(t *testing.T) {
			w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))
			assert.Empty(t, w.taskAssigneeIDs(inst.Id))
			assert.Equal(t, "awaiting_shift", w.requirePoolSlot(inst.Id).state)
		})

		t.Run("and then escalates when its date arrives", func(t *testing.T) {
			dayStart, _ := utcDay(day)
			w.resolveShiftAssignmentsAt(manager, dayStart.Add(time.Second))
			slot := w.requirePoolSlot(inst.Id)
			assert.Equal(t, "closed_unresolved", slot.state)
			assert.Equal(t, "no_roster", slot.closedReason.String)
			assert.Equal(t, 1, w.countNotificationsFor(manager.ID, "ritual_instance_unassigned", inst.Id))
		})
	})

	t.Run("when the manager changes the pool's strategy", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		alice := w.withEmployee()

		now := generationAnchor()

		t.Run("switching from round robin to on shift re-resolves the future instances", func(t *testing.T) {
			ritual := w.newOnShiftRitual(manager, []testUser{alice}, 3, "round_robin")
			w.generateOnShiftInstancesAt(manager, now)

			day := now.AddDate(0, 0, 1)
			inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
			require.NotNil(t, inst)
			require.Equal(t, []dbuuid.UUID{alice.ID}, w.taskAssigneeIDs(inst.Id))
			_, hadSlot := w.poolSlotFor(inst.Id)
			require.False(t, hadSlot)

			w.setPoolStrategy(ritual.definitionID, "on_shift")
			w.rosterDay(manager, alice, day)
			w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))

			slot := w.requirePoolSlot(inst.Id)
			assert.Equal(t, "resolved", slot.state, "the instance is adopted and resolved on the next pass")
			assert.Equal(t, []dbuuid.UUID{alice.ID}, w.taskAssigneeIDs(inst.Id))
		})

		t.Run("switching away from on shift assigns waiting slots under the new strategy", func(t *testing.T) {
			bob := w.withEmployee()
			ritual := w.newOnShiftRitual(manager, []testUser{bob}, 3, "on_shift")
			w.generateOnShiftInstancesAt(manager, now)

			day := now.AddDate(0, 0, 1)
			inst := w.instancesByDate(manager, ritual.projectID)[dateKey(day)]
			require.NotNil(t, inst)
			require.Empty(t, w.taskAssigneeIDs(inst.Id))
			require.Equal(t, "awaiting_shift", w.requirePoolSlot(inst.Id).state)

			w.setPoolStrategy(ritual.definitionID, "least_assigned")
			w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))

			assert.Equal(t, []dbuuid.UUID{bob.ID}, w.taskAssigneeIDs(inst.Id),
				"switching away must not strand the instance unassigned")

			_, stillTracked := w.poolSlotFor(inst.Id)
			assert.False(t, stillTracked, "the slot row has nothing left to describe")
		})
	})

	t.Run("when resolution runs against the calendar", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		alice := w.withEmployee()

		now := generationAnchor()
		ritual := w.newOnShiftRitual(manager, []testUser{alice}, 4, "on_shift")
		w.rosterDay(manager, alice, now.AddDate(0, 0, 1))
		w.generateOnShiftInstancesAt(manager, now)
		_ = ritual

		t.Run("resolution never creates modifies or deletes a shift event", func(t *testing.T) {
			before := w.countCalendarEvents(manager.OrgID)
			w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))
			w.resolveShiftAssignmentsAt(manager, now.Add(2*time.Hour))
			assert.Equal(t, before, w.countCalendarEvents(manager.OrgID))
		})
	})
}

// ---------------------------------------------------------------------------
// TestRitualOnShiftInstanceState — FR-019 at the API level
// ---------------------------------------------------------------------------

func TestRitualOnShiftInstanceState(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	manager := w.withOwner()
	alice := w.withEmployee()

	now := generationAnchor()
	ritual := w.newOnShiftRitual(manager, []testUser{alice}, 4, "on_shift")

	assignedDay := now.AddDate(0, 0, 1)
	waitingDay := now.AddDate(0, 0, 2)
	w.rosterDay(manager, alice, assignedDay)

	w.generateOnShiftInstancesAt(manager, now)
	instances := w.instancesByDate(manager, ritual.projectID)

	assigned := instances[dateKey(assignedDay)]
	waiting := instances[dateKey(waitingDay)]
	require.NotNil(t, assigned)
	require.NotNil(t, waiting)

	t.Run("an assigned instance reports its pool assignment state as resolved", func(t *testing.T) {
		assert.Equal(t, rpcv1.RitualPoolAssignmentState_RITUAL_POOL_ASSIGNMENT_STATE_RESOLVED,
			w.getTask(manager, assigned.Id).PoolAssignmentState)
	})

	t.Run("a waiting instance reports its pool assignment state as awaiting shift", func(t *testing.T) {
		assert.Equal(t, rpcv1.RitualPoolAssignmentState_RITUAL_POOL_ASSIGNMENT_STATE_AWAITING_SHIFT,
			w.getTask(manager, waiting.Id).PoolAssignmentState)
	})

	t.Run("a task that is not an on shift ritual instance reports unspecified", func(t *testing.T) {
		require.NotEmpty(t, ritual.levels)
		standard := w.createTask(manager, ritual.projectID, "An ordinary task", ritual.levels[0].Id)
		assert.Equal(t, rpcv1.RitualPoolAssignmentState_RITUAL_POOL_ASSIGNMENT_STATE_UNSPECIFIED,
			w.getTask(manager, standard.Id).PoolAssignmentState)
	})

	t.Run("listing tasks carries the state too, in one query per page", func(t *testing.T) {
		byID := map[string]rpcv1.RitualPoolAssignmentState{}
		for _, task := range w.listTasksWithKind(manager, ritual.projectID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)) {
			byID[task.Id] = task.PoolAssignmentState
		}
		assert.Equal(t, rpcv1.RitualPoolAssignmentState_RITUAL_POOL_ASSIGNMENT_STATE_RESOLVED, byID[assigned.Id])
		assert.Equal(t, rpcv1.RitualPoolAssignmentState_RITUAL_POOL_ASSIGNMENT_STATE_AWAITING_SHIFT, byID[waiting.Id])
	})

	t.Run("an instance with one waiting pool and one resolved pool reports awaiting shift", func(t *testing.T) {
		// A second pool on the same definition, left with nobody rostered.
		bob := w.withEmployee()
		secondDept := w.createDepartment(manager, "Second pool "+uniqueProjectKey("D"), "")
		w.assignEmployeeToDepartment(manager, secondDept, bob.ID)
		w.addSecondOnShiftPoolDirect(ritual.definitionID, manager.OrgID, secondDept)

		w.resolveShiftAssignmentsAt(manager, now.Add(time.Hour))

		assert.Equal(t, rpcv1.RitualPoolAssignmentState_RITUAL_POOL_ASSIGNMENT_STATE_AWAITING_SHIFT,
			w.getTask(manager, assigned.Id).PoolAssignmentState,
			"a waiting pool must not be hidden behind one that resolved")
	})
}
