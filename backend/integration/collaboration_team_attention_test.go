package integration

import (
	"context"
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
		t.Skip("pending: US2 query")

		t.Run("it is listed in the unassigned category", func(t *testing.T) {})
		t.Run("it carries no assignee name, so the client can label it Unassigned", func(t *testing.T) {})
	})

	t.Run("when an unassigned instance is given an assignee", func(t *testing.T) {
		t.Skip("pending: US2 query")
		t.Run("it leaves the unassigned category on the next request", func(t *testing.T) {})
	})

	t.Run("when an unassigned instance is scheduled for a future date", func(t *testing.T) {
		t.Skip("pending: US2 query")
		t.Run("it is not listed", func(t *testing.T) {})
	})

	t.Run("when an instance is both overdue and unassigned", func(t *testing.T) {
		t.Skip("pending: US2 query")
		t.Run("it appears once, under overdue, and is counted once", func(t *testing.T) {})
	})

	t.Run("when the caller supervises projects and nothing is overdue or unassigned", func(t *testing.T) {
		t.Skip("pending: US3")
		t.Run("it returns can_supervise true with a non-zero supervised project count", func(t *testing.T) {})
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
		t.Skip("pending: US4")

		t.Run("it returns the true count alongside the shortened list", func(t *testing.T) {})
		t.Run("it clamps the requested limit to the ceiling", func(t *testing.T) {})
	})

	t.Run("when more instances match than the count cap", func(t *testing.T) {
		t.Skip("pending: US4")

		t.Run("it reports the capped figure and sets the capped flag", func(t *testing.T) {})
		t.Run("it costs the same as a small backlog", func(t *testing.T) {})
	})

	t.Run("when as_of_date is supplied", func(t *testing.T) {
		t.Skip("pending: US2 query")
		t.Run("it scopes the unassigned category to that date and leaves overdue unbounded", func(t *testing.T) {})
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
