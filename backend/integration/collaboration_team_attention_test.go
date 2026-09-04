package integration

import (
	"context"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
)

// ---------------------------------------------------------------------------
// Arrange: a supervised ritual project the test controls end to end
// ---------------------------------------------------------------------------

// teamProject is a ritual-mode project plus the two states the summary's predicates turn
// on: the one that means "late" and the one that means "finished".
type teamProject struct {
	projectResult
	overdueState string
	closedState  string
}

// newTeamProject creates a ritual project owned by `owner`. Ritual mode is what seeds the
// overdue and verified states; a standard project has no 'overdue' state to move an
// instance into, and lateness here is the stored state, never a date comparison.
func (w *testWorld) newTeamProject(owner testUser, name, keyPrefix string) teamProject {
	w.t.Helper()
	proj := w.createProjectWithMode(owner, name, uniqueProjectKey(keyPrefix),
		rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

	overdue := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_OVERDUE)
	require.NotNil(w.t, overdue, "fixture precondition: a ritual project has an overdue state")
	verified := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_VERIFIED)
	require.NotNil(w.t, verified, "fixture precondition: a ritual project has a verified state")

	return teamProject{projectResult: proj, overdueState: overdue.Id, closedState: verified.Id}
}

// newOverdueInstance is the fixture almost every scenario starts from: one ritual instance
// in a supervised project, assigned to somebody other than the caller, and sitting in the
// stored overdue state.
func (w *testWorld) newOverdueInstance(
	owner testUser,
	proj teamProject,
	title string,
	assignee *testUser,
	deadline time.Time,
) *rpcv1.Task {
	w.t.Helper()
	task := w.createRitualInstance(owner, proj.projectResult, title, deadline, deadline)
	if assignee != nil {
		w.assignTask(owner, task.Id, assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
	}
	w.moveTask(owner, task.Id, proj.overdueState)
	return task
}

// softDeleteTask, archiveEmployeeName and detachTask write columns no RPC on this path
// exposes, the same way the reconciliation suite's fixtures do.

func (w *testWorld) softDeleteTask(taskID string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.task SET is_deleted = TRUE WHERE id = $1`,
		dbuuid.MustParse(taskID))
	require.NoError(w.t, err)
}

// blankEmployeeName models an employee record the name lookup cannot resolve — a departed
// or archived person. ListEmployeeNames drops an entry whose name trims to empty, which is
// exactly the "somebody is on it and we could not name them" case the row must survive.
func (w *testWorld) blankEmployeeName(employeeID dbuuid.UUID) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE organization.employee SET given_name = '', family_name = '' WHERE id = $1`,
		employeeID)
	require.NoError(w.t, err)
}

// seedOverdueInstances makes `count` overdue instances in one supervised project, all
// assigned to `assignee`.
//
// Written as two bulk INSERT ... SELECTs off a single seed instance rather than as `count`
// trips through CreateTask/AssignTask/MoveTask: the cap scenario needs more than a hundred
// of them, and three hundred round trips would make the suite's slowest test about HTTP
// rather than about the bound it is asserting.
func (w *testWorld) seedOverdueInstances(owner testUser, proj teamProject, assignee testUser, count int) {
	w.t.Helper()
	seed := w.newOverdueInstance(owner, proj, "Seeded late", &assignee, time.Now().AddDate(0, 0, -1))

	_, err := globalDB.Exec(context.Background(),
		`INSERT INTO collaboration.task (
		    id, organization_id, project_id, identifier, title, depth, path, level_id,
		    state_id, reporter_employee_id, task_kind, scheduled_date, completion_deadline
		 )
		 SELECT uuidv7(), t.organization_id, t.project_id, t.identifier || '-' || n, t.title || ' ' || n,
		        t.depth, t.path, t.level_id, t.state_id, t.reporter_employee_id, t.task_kind,
		        t.scheduled_date, t.completion_deadline - (n || ' hours')::interval
		   FROM collaboration.task t, generate_series(1, $2) AS n
		  WHERE t.id = $1`,
		dbuuid.MustParse(seed.Id), count-1)
	require.NoError(w.t, err)

	_, err = globalDB.Exec(context.Background(),
		`INSERT INTO collaboration.task_assignee (
		    id, organization_id, task_id, employee_id, role, assigned_by_employee_id
		 )
		 SELECT uuidv7(), t.organization_id, t.id, $2, 'assignee', $3
		   FROM collaboration.task t
		  WHERE t.organization_id = $4
		    AND t.project_id = $1
		    AND NOT EXISTS (
		      SELECT 1 FROM collaboration.task_assignee ta
		       WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
		    )`,
		dbuuid.MustParse(proj.ID), assignee.ID, owner.ID, owner.OrgID)
	require.NoError(w.t, err)
}

// isoDate renders a date the way the wire carries it.
func isoDate(t time.Time) string { return t.Format("2006-01-02") }

// ---------------------------------------------------------------------------
// TestTeamAttentionSummary — the behavioural contract for feature 047
// ---------------------------------------------------------------------------
//
// Written as stubs before any query and reviewed as the contract for the feature
// (Constitution II). Every scenario names the user story or requirement it discharges.

func TestTeamAttentionSummary(t *testing.T) {
	t.Parallel()

	t.Run("when the caller supervises a project with a late ritual instance", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "Store Ops", "SO")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		threeDaysLate := time.Now().AddDate(0, 0, -3)
		oneDayLate := time.Now().AddDate(0, 0, -1)
		oldest := w.newOverdueInstance(owner, proj, "Open the store", &worker, threeDaysLate)
		newest := w.newOverdueInstance(owner, proj, "Count the till", &worker, oneDayLate)

		resp := w.getTeamAttentionSummary(owner, nil, nil)

		t.Run("it lists the overdue instance with its title, project and assignee name", func(t *testing.T) {
			// US1-1, FR-006, FR-011.
			item := teamAttentionItem(resp, oldest.Id)
			require.NotNil(t, item, "the supervised project's overdue instance is the whole point")
			assert.Equal(t, "Open the store", item.Title)
			assert.Equal(t, rpcv1.TeamAttentionCategory_TEAM_ATTENTION_CATEGORY_OVERDUE, item.Category)
			assert.NotEmpty(t, item.GetAssigneeDisplayName(),
				"the supervisor needs the name of whoever is on it, not an id")
			assert.Equal(t, int32(0), item.AdditionalAssigneeCount)
			assert.True(t, resp.CanSupervise)
			assert.GreaterOrEqual(t, resp.OverdueCount, int32(2))
		})

		t.Run("it returns the instance's project name rather than an identifier fragment", func(t *testing.T) {
			// FR-011: the label a supervisor would say out loud, not the key.
			item := teamAttentionItem(resp, oldest.Id)
			require.NotNil(t, item)
			assert.Equal(t, "Store Ops", item.ProjectName)
			assert.Equal(t, proj.ID, item.ProjectId)
		})

		t.Run("it orders the longest-late instance first", func(t *testing.T) {
			// FR-012: the oldest deadline has been late the longest.
			ids := teamAttentionTaskIDs(resp)
			assert.Less(t, teamAttentionIndexOf(ids, oldest.Id), teamAttentionIndexOf(ids, newest.Id),
				"the instance late three days sorts ahead of the one late one day")
		})
	})

	t.Run("when the caller supervises nothing", func(t *testing.T) {
		t.Parallel()
		// US1-3, FR-001, FR-002: an employee who owns or administers no project.
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "Not Theirs", "NT")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.newOverdueInstance(owner, proj, "Late but not their problem", &owner, time.Now().AddDate(0, 0, -2))

		t.Run("it returns can_supervise false with no items and no error", func(t *testing.T) {
			require.NoError(t, w.getTeamAttentionSummaryError(worker, nil, nil),
				"not being anyone's supervisor is not a failed request")

			resp := w.getTeamAttentionSummary(worker, nil, nil)
			assert.False(t, resp.CanSupervise)
			assert.Equal(t, int32(0), resp.SupervisedProjectCount)
			assert.Equal(t, int32(0), resp.OverdueCount)
			assert.Equal(t, int32(0), resp.UnassignedCount)
			assert.Empty(t, resp.Items)
		})
	})

	t.Run("when the caller lacks collab.reviewEvidence", func(t *testing.T) {
		t.Parallel()
		// FR-002. The permission is revoked org-wide, so this scenario owns its own
		// organization.
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "No Permission", "NP")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		late := w.newOverdueInstance(owner, proj, "Late", &worker, time.Now().AddDate(0, 0, -1))

		before := w.getTeamAttentionSummary(owner, nil, nil)
		require.Contains(t, teamAttentionTaskIDs(before), late.Id,
			"fixture precondition: the instance is visible while the permission is held")

		w.revokePermission(owner.OrgID, "collab.reviewEvidence")

		t.Run("it returns an empty summary rather than PERMISSION_DENIED", func(t *testing.T) {
			require.NoError(t, w.getTeamAttentionSummaryError(owner, nil, nil),
				"a caller with no supervisory permission is not a failed request")

			resp := w.getTeamAttentionSummary(owner, nil, nil)
			assert.False(t, resp.CanSupervise, "no permission means the block renders nothing")
			assert.Equal(t, int32(0), resp.SupervisedProjectCount)
			assert.Empty(t, resp.Items)
		})
	})

	t.Run("when the caller is a viewer on a project holding a late instance", func(t *testing.T) {
		t.Parallel()
		// FR-004: a count the caller cannot substantiate by opening the rows is worse than
		// no count, so the viewer's project is absent from items AND from counts.
		w := newTestWorld(t)
		owner := w.withOwner()
		viewer := w.withEmployee()
		assignee := w.withEmployee()
		proj := w.newTeamProject(owner, "Viewer Scope", "VS")
		w.addProjectMember(owner, proj.ID, viewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)
		w.addProjectMember(owner, proj.ID, assignee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		late := w.newOverdueInstance(owner, proj, "Not the viewer's to supervise", &assignee, time.Now().AddDate(0, 0, -1))

		t.Run("it omits that instance from the items and from the counts", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(viewer, nil, nil)
			assert.NotContains(t, teamAttentionTaskIDs(resp), late.Id)
			assert.False(t, resp.CanSupervise)
			assert.Equal(t, int32(0), resp.OverdueCount)
		})
	})

	t.Run("when a late instance belongs to another organization", func(t *testing.T) {
		t.Parallel()
		// FR-005, Constitution I.
		w := newTestWorld(t)
		outsider, _ := w.withUsersFromDifferentOrgs()

		other := newTestWorld(t)
		otherOwner := other.withOwner()
		otherWorker := other.withEmployee()
		proj := other.newTeamProject(otherOwner, "Other Org", "OO")
		other.addProjectMember(otherOwner, proj.ID, otherWorker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		late := other.newOverdueInstance(otherOwner, proj, "Another org's problem", &otherWorker, time.Now().AddDate(0, 0, -1))

		t.Run("it is never returned", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(outsider, nil, nil)
			assert.NotContains(t, teamAttentionTaskIDs(resp), late.Id)
		})
	})

	t.Run("when the overdue instance is assigned to the caller", func(t *testing.T) {
		t.Parallel()
		// US1-4, FR-009: the caller's own work belongs in their own sections, and showing
		// it twice would make the Team block look like it is about them.
		w := newTestWorld(t)
		owner := w.withOwner()
		proj := w.newTeamProject(owner, "Own Work", "OW")
		mine := w.newOverdueInstance(owner, proj, "Mine to do", &owner, time.Now().AddDate(0, 0, -1))

		t.Run("it is excluded from the team summary", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, nil, nil)
			assert.NotContains(t, teamAttentionTaskIDs(resp), mine.Id)
			assert.Equal(t, int32(0), resp.OverdueCount, "and it is not counted either")
		})
	})

	t.Run("when the instance has reached a closed state", func(t *testing.T) {
		t.Parallel()
		// US1-5, FR-008: terminality is `is_closed`, not a hard-coded category list.
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "Closed State", "CS")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		task := w.newOverdueInstance(owner, proj, "Done in the end", &worker, time.Now().AddDate(0, 0, -1))

		before := w.getTeamAttentionSummary(owner, nil, nil)
		require.Contains(t, teamAttentionTaskIDs(before), task.Id, "fixture precondition")

		w.moveTask(owner, task.Id, proj.closedState)

		t.Run("it is excluded from both categories and both counts", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, nil, nil)
			assert.NotContains(t, teamAttentionTaskIDs(resp), task.Id)
			assert.Equal(t, int32(0), resp.OverdueCount)
			assert.Equal(t, int32(0), resp.UnassignedCount)
		})
	})

	t.Run("when the instance is soft-deleted, detached, or its project archived", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deletedProj := w.newTeamProject(owner, "Deleted", "DEL")
		w.addProjectMember(owner, deletedProj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		deleted := w.newOverdueInstance(owner, deletedProj, "Soft-deleted", &worker, time.Now().AddDate(0, 0, -1))
		detached := w.newOverdueInstance(owner, deletedProj, "Detached", &worker, time.Now().AddDate(0, 0, -1))

		archivedProj := w.newTeamProject(owner, "Archived", "ARC")
		w.addProjectMember(owner, archivedProj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		inArchived := w.newOverdueInstance(owner, archivedProj, "In an archived project", &worker, time.Now().AddDate(0, 0, -1))

		before := w.getTeamAttentionSummary(owner, nil, ptr(int32(20)))
		require.Subset(t, teamAttentionTaskIDs(before), []string{deleted.Id, detached.Id, inArchived.Id},
			"fixture precondition: all three are listed before they are excluded")

		w.softDeleteTask(deleted.Id)
		w.detachRitualInstanceFromSweep(detached.Id)
		_, err := w.archiveProject(owner, archivedProj.ID, true)
		require.NoError(t, err)

		t.Run("it is excluded", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, nil, ptr(int32(20)))
			ids := teamAttentionTaskIDs(resp)
			assert.NotContains(t, ids, deleted.Id, "a soft-deleted instance is gone")
			assert.NotContains(t, ids, detached.Id, "a detached instance is a standalone task")
			assert.NotContains(t, ids, inArchived.Id, "an archived project is not being run")
			assert.Equal(t, int32(0), resp.OverdueCount, "and none of the three is counted")
		})
	})

	t.Run("when a ritual instance scheduled for as_of_date has no assignee", func(t *testing.T) {
		t.Parallel()
		// US2-1, US2-2, FR-006, FR-011. The instance sits in a non-overdue state — it is
		// not late, it simply has nobody on it, which is the other half of "is the store
		// OK".
		w := newTestWorld(t)
		owner := w.withOwner()
		proj := w.newTeamProject(owner, "Nobody On It", "NOI")
		today := time.Now()
		task := w.createRitualInstance(owner, proj.projectResult, "Open the store", today, today)

		resp := w.getTeamAttentionSummary(owner, ptr(isoDate(today)), nil)

		t.Run("it is listed in the unassigned category", func(t *testing.T) {
			item := teamAttentionItem(resp, task.Id)
			require.NotNil(t, item, "an instance nobody is on is the supervisor's problem")
			assert.Equal(t, rpcv1.TeamAttentionCategory_TEAM_ATTENTION_CATEGORY_UNASSIGNED, item.Category)
			assert.Equal(t, int32(1), resp.UnassignedCount)
			assert.Equal(t, int32(0), resp.OverdueCount, "it is not late, only unheld")
		})

		t.Run("it carries no assignee name, so the client can label it Unassigned", func(t *testing.T) {
			item := teamAttentionItem(resp, task.Id)
			require.NotNil(t, item)
			assert.Nil(t, item.AssigneeDisplayName, "never an empty name and never an id fragment")
			assert.Equal(t, int32(0), item.AdditionalAssigneeCount)
		})
	})

	t.Run("when an unassigned instance is given an assignee", func(t *testing.T) {
		t.Parallel()
		// US2-3: the block is a live answer, not a snapshot — giving the instance an owner
		// is what removes it.
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "Now Held", "NH")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		today := time.Now()
		task := w.createRitualInstance(owner, proj.projectResult, "Cash up", today, today)

		before := w.getTeamAttentionSummary(owner, ptr(isoDate(today)), nil)
		require.Contains(t, teamAttentionTaskIDs(before), task.Id, "fixture precondition")

		w.assignTask(owner, task.Id, worker.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

		t.Run("it leaves the unassigned category on the next request", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, ptr(isoDate(today)), nil)
			assert.NotContains(t, teamAttentionTaskIDs(resp), task.Id)
			assert.Equal(t, int32(0), resp.UnassignedCount)
		})
	})

	t.Run("when an unassigned instance is scheduled for a future date", func(t *testing.T) {
		t.Parallel()
		// US2-4: equality on scheduled_date, not `<=`, is what keeps next Tuesday out of
		// this morning's block.
		w := newTestWorld(t)
		owner := w.withOwner()
		proj := w.newTeamProject(owner, "Next Week", "NW")
		today := time.Now()
		nextWeek := today.AddDate(0, 0, 7)
		future := w.createRitualInstance(owner, proj.projectResult, "Stocktake", nextWeek, nextWeek)

		t.Run("it is not listed", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, ptr(isoDate(today)), nil)
			assert.NotContains(t, teamAttentionTaskIDs(resp), future.Id)
			assert.Equal(t, int32(0), resp.UnassignedCount)
		})
	})

	t.Run("when an instance is both overdue and unassigned", func(t *testing.T) {
		t.Parallel()
		// FR-010. The two legs are mutually exclusive by construction, so the row appears
		// once and is counted once without a DISTINCT in either query — and it appears
		// under the more urgent of the two.
		w := newTestWorld(t)
		owner := w.withOwner()
		proj := w.newTeamProject(owner, "Both", "BTH")
		today := time.Now()
		task := w.createRitualInstance(owner, proj.projectResult, "Late and unheld", today, today)
		w.moveTask(owner, task.Id, proj.overdueState)

		t.Run("it appears once, under overdue, and is counted once", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, ptr(isoDate(today)), nil)
			ids := teamAttentionTaskIDs(resp)
			assert.Equal(t, []string{task.Id}, ids, "one row, not two")

			item := teamAttentionItem(resp, task.Id)
			require.NotNil(t, item)
			assert.Equal(t, rpcv1.TeamAttentionCategory_TEAM_ATTENTION_CATEGORY_OVERDUE, item.Category,
				"late is the more urgent fact")
			assert.Equal(t, int32(1), resp.OverdueCount)
			assert.Equal(t, int32(0), resp.UnassignedCount, "counted once, in one category")
		})
	})

	t.Run("when the caller supervises projects and nothing is overdue or unassigned", func(t *testing.T) {
		t.Parallel()
		// US3-1, FR-016. A silent block read as good news is the defect this whole feature
		// exists to fix, so a healthy team and no supervisory scope must be distinguishable
		// on the wire: same zero counts, different can_supervise and project count.
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "All Clear", "AC")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		// Current and held: scheduled today, somebody on it, not in the overdue state.
		today := time.Now()
		healthy := w.createRitualInstance(owner, proj.projectResult, "Opening checks", today, today)
		w.assignTask(owner, healthy.Id, worker.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

		t.Run("it returns can_supervise true with a non-zero supervised project count", func(t *testing.T) {
			healthySupervisor := w.getTeamAttentionSummary(owner, ptr(isoDate(today)), nil)
			assert.True(t, healthySupervisor.CanSupervise)
			assert.Greater(t, healthySupervisor.SupervisedProjectCount, int32(0),
				"the all-clear names how many projects it covered")
			assert.Equal(t, int32(0), healthySupervisor.OverdueCount)
			assert.Equal(t, int32(0), healthySupervisor.UnassignedCount)
			assert.Empty(t, healthySupervisor.Items)

			nonSupervisor := w.getTeamAttentionSummary(worker, ptr(isoDate(today)), nil)
			assert.False(t, nonSupervisor.CanSupervise)
			assert.Equal(t, int32(0), nonSupervisor.SupervisedProjectCount)
			assert.Equal(t, healthySupervisor.OverdueCount, nonSupervisor.OverdueCount,
				"the counts alone cannot tell the two apart — which is why can_supervise exists")
		})
	})

	t.Run("when the assignee's employee record is archived", func(t *testing.T) {
		t.Parallel()
		// Edge case: a departed assignee is exactly the situation the owner needs to see,
		// so an unresolvable name must never drop the row. `assignee_count` is what
		// distinguishes "nobody is on this" from "somebody is and we cannot name them" —
		// opposite facts for a supervisor.
		w := newTestWorld(t)
		owner := w.withOwner()
		departed := w.withEmployee()
		proj := w.newTeamProject(owner, "Departed", "DEP")
		w.addProjectMember(owner, proj.ID, departed.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		task := w.newOverdueInstance(owner, proj, "Left behind", &departed, time.Now().AddDate(0, 0, -1))
		w.blankEmployeeName(departed.ID)

		t.Run("it still lists the instance rather than dropping the row", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, nil, nil)
			item := teamAttentionItem(resp, task.Id)
			require.NotNil(t, item, "a row is never dropped for want of a resolvable name")
			assert.Empty(t, item.GetAssigneeDisplayName(), "no name, rather than a fabricated one")
			assert.Equal(t, rpcv1.TeamAttentionCategory_TEAM_ATTENTION_CATEGORY_OVERDUE, item.Category,
				"an unnamed assignee is not the same fact as no assignee")
			assert.Equal(t, int32(1), resp.OverdueCount)
		})
	})

	t.Run("when an instance has several assignees", func(t *testing.T) {
		t.Parallel()
		// Edge case: one row, one name, and a count of the rest — never three rows and
		// never three names wrapped onto three lines.
		w := newTestWorld(t)
		owner := w.withOwner()
		crew := w.withEmployees(3)
		proj := w.newTeamProject(owner, "Crew", "CRW")
		for _, member := range crew {
			w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		}
		task := w.newOverdueInstance(owner, proj, "Everybody's job", &crew[0], time.Now().AddDate(0, 0, -1))
		w.assignTask(owner, task.Id, crew[1].ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		w.assignTask(owner, task.Id, crew[2].ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

		t.Run("it names one and reports the count of the rest", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, nil, nil)
			assert.Len(t, teamAttentionTaskIDs(resp), 1, "three assignees must not fan out into three rows")

			item := teamAttentionItem(resp, task.Id)
			require.NotNil(t, item)
			assert.NotEmpty(t, item.GetAssigneeDisplayName())
			assert.Equal(t, int32(2), item.AdditionalAssigneeCount)
			assert.Equal(t, int32(1), resp.OverdueCount, "and it is one problem, not three")
		})
	})

	t.Run("when more instances match than the requested limit", func(t *testing.T) {
		t.Parallel()
		// US4-1, US4-2, FR-013. The counts are the truth about size; the items are what
		// fits on a phone. A supervisor must never be shown a short list presented as the
		// whole picture.
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "Bad Week", "BW")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		for i := range 8 {
			w.newOverdueInstance(owner, proj, "Late "+strconv.Itoa(i), &worker,
				time.Now().AddDate(0, 0, -(i + 1)))
		}

		t.Run("it returns the true count alongside the shortened list", func(t *testing.T) {
			resp := w.getTeamAttentionSummary(owner, nil, ptr(int32(5)))
			assert.Len(t, resp.Items, 5, "the list is bounded")
			assert.Equal(t, int32(8), resp.OverdueCount, "the count is not")
			assert.False(t, resp.OverdueCountCapped, "eight is well under the cap")
		})

		t.Run("it clamps the requested limit to the ceiling", func(t *testing.T) {
			// Asking for too much is not a client error a supervisor can act on, so it is
			// clamped rather than rejected.
			require.NoError(t, w.getTeamAttentionSummaryError(owner, nil, ptr(int32(500))))
			resp := w.getTeamAttentionSummary(owner, nil, ptr(int32(500)))
			assert.Len(t, resp.Items, 8, "every match fits under the ceiling of 20")
			assert.LessOrEqual(t, len(resp.Items), 20)
		})
	})

	t.Run("when more instances match than the count cap", func(t *testing.T) {
		t.Parallel()
		// US4-3, FR-014, SC-005. Two flags, not one: a workspace can plausibly have 100+
		// overdue and 3 unassigned, and reporting the exact 3 as "99+" would be a lie the
		// supervisor can disprove by expanding.
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "Very Bad Week", "VBW")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		// Past the cap of 100 on one category, and well under it on the other.
		const overCap = 105
		w.seedOverdueInstances(owner, proj, worker, overCap)
		today := time.Now()
		for i := range 3 {
			w.createRitualInstance(owner, proj.projectResult, "Unheld "+strconv.Itoa(i), today, today)
		}

		resp := w.getTeamAttentionSummary(owner, ptr(isoDate(today)), ptr(int32(20)))

		t.Run("it reports the capped figure and sets the capped flag", func(t *testing.T) {
			assert.Equal(t, int32(100), resp.OverdueCount, "counted up to the cap, not past it")
			assert.True(t, resp.OverdueCountCapped, "so the client renders 99+ rather than a false exact figure")

			assert.Equal(t, int32(3), resp.UnassignedCount, "the other category is exact")
			assert.False(t, resp.UnassignedCountCapped,
				"the two flags are independent — 100+ overdue must not make 3 unassigned read as capped")
		})

		t.Run("it costs the same as a small backlog", func(t *testing.T) {
			// The bound is server-side and inside SQL, so the response a huge backlog
			// produces is the same size as a healthy one's: at most `limit` rows per
			// category, never the backlog.
			assert.LessOrEqual(t, len(resp.Items), 40, "at most 20 per category at the ceiling")
			assert.LessOrEqual(t, resp.OverdueCount, int32(100))
			assert.LessOrEqual(t, resp.UnassignedCount, int32(100))
		})
	})

	t.Run("when as_of_date is supplied", func(t *testing.T) {
		t.Parallel()
		// Edge case: the date governs the unassigned category only. An instance that went
		// late three days ago is still the store's problem this morning, so overdue stays
		// unbounded — which is also what makes the block usable for a supervisor at UTC+7
		// whose local date differs from the server's.
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		proj := w.newTeamProject(owner, "As Of", "AOF")
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		today := time.Now()
		tomorrow := today.AddDate(0, 0, 1)
		longAgo := today.AddDate(0, 0, -5)

		unheldToday := w.createRitualInstance(owner, proj.projectResult, "Unheld today", today, today)
		unheldTomorrow := w.createRitualInstance(owner, proj.projectResult, "Unheld tomorrow", tomorrow, tomorrow)
		lateLongAgo := w.newOverdueInstance(owner, proj, "Late five days ago", &worker, longAgo)

		t.Run("it scopes the unassigned category to that date and leaves overdue unbounded", func(t *testing.T) {
			todayResp := w.getTeamAttentionSummary(owner, ptr(isoDate(today)), nil)
			todayIDs := teamAttentionTaskIDs(todayResp)
			assert.Contains(t, todayIDs, unheldToday.Id)
			assert.NotContains(t, todayIDs, unheldTomorrow.Id)
			assert.Contains(t, todayIDs, lateLongAgo.Id, "five days late is still this morning's problem")

			tomorrowResp := w.getTeamAttentionSummary(owner, ptr(isoDate(tomorrow)), nil)
			tomorrowIDs := teamAttentionTaskIDs(tomorrowResp)
			assert.Contains(t, tomorrowIDs, unheldTomorrow.Id)
			assert.NotContains(t, tomorrowIDs, unheldToday.Id)
			assert.Contains(t, tomorrowIDs, lateLongAgo.Id,
				"moving the date must not move the overdue category")
		})
	})

	t.Run("when as_of_date is malformed", func(t *testing.T) {
		t.Parallel()
		// Constitution X: exactly one client-fixable failure, named on the field the
		// caller got wrong, never a silent fallback to a different day.
		w := newTestWorld(t)
		owner := w.withOwner()

		t.Run("it returns InvalidArgument with a field violation on as_of_date", func(t *testing.T) {
			err := w.getTeamAttentionSummaryError(owner, ptr("not-a-date"), nil)
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))

			var connectErr *connect.Error
			require.ErrorAs(t, err, &connectErr)
			assert.Contains(t, badRequestFields(connectErr), "as_of_date",
				"the client must be able to mark the one input that is wrong")
		})
	})
}

// teamAttentionIndexOf reports where an id sits in the returned order, or -1. Ordering assertions read
// better as a comparison of positions than as a slice equality that a parallel fixture
// could perturb.
func teamAttentionIndexOf(ids []string, want string) int {
	for i, id := range ids {
		if id == want {
			return i
		}
	}
	return -1
}

// badRequestFields pulls the field names out of a connect error's BadRequest detail.
func badRequestFields(err *connect.Error) []string {
	var fields []string
	for _, detail := range err.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}
		badReq, ok := value.(*errdetails.BadRequest)
		if !ok {
			continue
		}
		for _, violation := range badReq.FieldViolations {
			fields = append(fields, violation.Field)
		}
	}
	return fields
}
