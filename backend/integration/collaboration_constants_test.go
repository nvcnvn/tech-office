package integration

import (
	"testing"

	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
)

// TestConstantSync verifies that DB CHECK constraints, Go constants, and proto enums
// remain synchronized across all collaboration entity types.
func TestConstantSync(t *testing.T) {
	t.Parallel()
	t.Run("when checking ProjectVisibility", func(t *testing.T) {
		dbValues := []string{"public", "private"}
		goValues := []string{
			collaboration.ProjectVisibilityPublic,
			collaboration.ProjectVisibilityPrivate,
		}

		t.Run("Go constants match DB CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, dbValues, goValues)
		})
		t.Run("proto enum count equals DB values + UNSPECIFIED", func(t *testing.T) {
			assert.Equal(t, len(dbValues)+1, len(rpcv1.ProjectVisibility_name))
		})
	})

	t.Run("when checking StateCategory", func(t *testing.T) {
		dbValues := []string{"todo", "in_progress", "done", "cancelled", "scheduled", "submitted", "verified", "overdue", "missed", "skipped"}
		goValues := []string{
			collaboration.StateCategoryTodo,
			collaboration.StateCategoryInProgress,
			collaboration.StateCategoryDone,
			collaboration.StateCategoryCancelled,
			collaboration.StateCategoryScheduled,
			collaboration.StateCategorySubmitted,
			collaboration.StateCategoryVerified,
			collaboration.StateCategoryOverdue,
			collaboration.StateCategoryMissed,
			collaboration.StateCategorySkipped,
		}

		t.Run("Go constants match DB CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, dbValues, goValues)
		})
		t.Run("proto enum count equals DB values + UNSPECIFIED", func(t *testing.T) {
			assert.Equal(t, len(dbValues)+1, len(rpcv1.StateCategory_name))
		})
	})

	t.Run("when checking CustomFieldType", func(t *testing.T) {
		dbValues := []string{"text", "number", "single_select", "multi_select", "date", "user", "checkbox"}
		goValues := []string{
			collaboration.CustomFieldTypeText,
			collaboration.CustomFieldTypeNumber,
			collaboration.CustomFieldTypeSingleSelect,
			collaboration.CustomFieldTypeMultiSelect,
			collaboration.CustomFieldTypeDate,
			collaboration.CustomFieldTypeUser,
			collaboration.CustomFieldTypeCheckbox,
		}

		t.Run("Go constants match DB CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, dbValues, goValues)
		})
		t.Run("proto enum count equals DB values + UNSPECIFIED", func(t *testing.T) {
			assert.Equal(t, len(dbValues)+1, len(rpcv1.CustomFieldType_name))
		})
	})

	t.Run("when checking WorkflowTriggerType", func(t *testing.T) {
		dbValues := []string{"state_entered", "state_exited", "field_changed", "task_created"}
		goValues := []string{
			collaboration.WorkflowTriggerTypeStateEntered,
			collaboration.WorkflowTriggerTypeStateExited,
			collaboration.WorkflowTriggerTypeFieldChanged,
			collaboration.WorkflowTriggerTypeTaskCreated,
		}

		t.Run("Go constants match DB CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, dbValues, goValues)
		})
		t.Run("proto enum count equals DB values + UNSPECIFIED", func(t *testing.T) {
			assert.Equal(t, len(dbValues)+1, len(rpcv1.WorkflowTriggerType_name))
		})
	})

	t.Run("when checking WorkflowActionType", func(t *testing.T) {
		dbValues := []string{"set_state", "set_field", "assign_user", "notify", "close_task"}
		goValues := []string{
			collaboration.WorkflowActionTypeSetState,
			collaboration.WorkflowActionTypeSetField,
			collaboration.WorkflowActionTypeAssignUser,
			collaboration.WorkflowActionTypeNotify,
			collaboration.WorkflowActionTypeCloseTask,
		}

		t.Run("Go constants match DB CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, dbValues, goValues)
		})
		t.Run("proto enum count equals DB values + UNSPECIFIED", func(t *testing.T) {
			assert.Equal(t, len(dbValues)+1, len(rpcv1.WorkflowActionType_name))
		})
	})

	t.Run("when checking ProjectMemberRole", func(t *testing.T) {
		dbValues := []string{"owner", "admin", "member", "viewer"}
		goValues := []string{
			collaboration.ProjectMemberRoleOwner,
			collaboration.ProjectMemberRoleAdmin,
			collaboration.ProjectMemberRoleMember,
			collaboration.ProjectMemberRoleViewer,
		}

		t.Run("Go constants match DB CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, dbValues, goValues)
		})
		t.Run("proto enum count equals DB values + UNSPECIFIED", func(t *testing.T) {
			assert.Equal(t, len(dbValues)+1, len(rpcv1.ProjectMemberRole_name))
		})
	})

	t.Run("when checking TaskAssigneeRole", func(t *testing.T) {
		dbValues := []string{"assignee", "reviewer", "approver"}
		goValues := []string{
			collaboration.TaskAssigneeRoleAssignee,
			collaboration.TaskAssigneeRoleReviewer,
			collaboration.TaskAssigneeRoleApprover,
		}

		t.Run("Go constants match DB CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, dbValues, goValues)
		})
		t.Run("proto enum count equals DB values + UNSPECIFIED", func(t *testing.T) {
			assert.Equal(t, len(dbValues)+1, len(rpcv1.TaskAssigneeRole_name))
		})
	})

	t.Run("when checking ViewType", func(t *testing.T) {
		dbValues := []string{"board", "list", "gantt", "calendar", "today", "health"}
		goValues := []string{
			collaboration.ViewTypeBoard,
			collaboration.ViewTypeList,
			collaboration.ViewTypeGantt,
			collaboration.ViewTypeCalendar,
			collaboration.ViewTypeToday,
			collaboration.ViewTypeHealth,
		}

		t.Run("Go constants match DB CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, dbValues, goValues)
		})
		t.Run("proto enum count equals DB values + UNSPECIFIED", func(t *testing.T) {
			assert.Equal(t, len(dbValues)+1, len(rpcv1.ViewType_name))
		})
	})
}
