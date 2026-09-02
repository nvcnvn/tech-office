package integration

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/nvcnvn/tech-office/backend/internal/chat"
	"github.com/nvcnvn/tech-office/backend/internal/collaboration"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

// TestSystemEventTypeConstantSync pins the chat system event vocabulary across the three
// places it is written down. Unlike the tables above it does not restate the expected
// values: it parses the generated schema snapshot and the shared TypeScript union, so a
// value added to one layer and forgotten in another fails here rather than at runtime
// against a CHECK constraint (Constitution principle VIII).
func TestSystemEventTypeConstantSync(t *testing.T) {
	t.Parallel()

	goValues := []string{
		chat.SystemEventTypeVoiceCallStarted,
		chat.SystemEventTypeVoiceCallEnded,
		chat.SystemEventTypeVoiceCallMissed,
		chat.SystemEventTypeVoiceCallCancelled,
		chat.SystemEventTypeTaskCreatedFromMessage,
	}

	t.Run("task_created_from_message matches across DB, Go and TypeScript", func(t *testing.T) {
		const value = "task_created_from_message"

		t.Run("the Go constant carries the canonical value", func(t *testing.T) {
			assert.Equal(t, value, chat.SystemEventTypeTaskCreatedFromMessage)
		})
		t.Run("IsValidSystemEventType admits it", func(t *testing.T) {
			assert.True(t, chat.IsValidSystemEventType(chat.SystemEventTypeTaskCreatedFromMessage))
		})
		t.Run("the database CHECK admits it", func(t *testing.T) {
			assert.Contains(t, systemEventTypesFromSchema(t), value)
		})
		t.Run("the TypeScript union admits it", func(t *testing.T) {
			assert.Contains(t, systemEventTypesFromTypeScript(t), value)
		})
	})

	t.Run("the whole vocabulary matches across DB, Go and TypeScript", func(t *testing.T) {
		t.Run("Go constants match the database CHECK constraint", func(t *testing.T) {
			assert.ElementsMatch(t, goValues, systemEventTypesFromSchema(t))
		})
		t.Run("Go constants match the TypeScript union", func(t *testing.T) {
			assert.ElementsMatch(t, goValues, systemEventTypesFromTypeScript(t))
		})
	})
}

// systemEventTypesFromSchema reads the values admitted by the
// message_system_event_type_valid CHECK out of the generated schema snapshot.
func systemEventTypesFromSchema(t *testing.T) []string {
	t.Helper()
	snapshot := readRepoFile(t, "database/scripts/schema.sql")

	idx := strings.Index(snapshot, "message_system_event_type_valid")
	require.NotEqual(t, -1, idx, "message_system_event_type_valid CHECK not found in schema.sql")
	end := strings.Index(snapshot[idx:], ";")
	require.NotEqual(t, -1, end, "unterminated CHECK constraint in schema.sql")

	values := quotedLiterals(snapshot[idx : idx+end])
	require.NotEmpty(t, values, "no values parsed from message_system_event_type_valid")
	return values
}

// systemEventTypesFromTypeScript reads the SystemEventType union out of the shared API
// package, which both clients import.
func systemEventTypesFromTypeScript(t *testing.T) []string {
	t.Helper()
	source := readRepoFile(t, "../frontend/packages/apis/src/chat.ts")

	idx := strings.Index(source, "export type SystemEventType")
	require.NotEqual(t, -1, idx, "SystemEventType union not found in chat.ts")
	end := strings.Index(source[idx:], ";")
	require.NotEqual(t, -1, end, "unterminated SystemEventType union in chat.ts")

	values := quotedLiterals(source[idx : idx+end])
	require.NotEmpty(t, values, "no values parsed from the SystemEventType union")
	return values
}

var quotedLiteralPattern = regexp.MustCompile(`'([a-z_]+)'`)

// quotedLiterals pulls the single-quoted snake_case literals out of a fragment. Both the
// SQL CHECK and the TypeScript union quote their values this way, so one parser serves
// both and neither list has to be restated in this file.
func quotedLiterals(fragment string) []string {
	matches := quotedLiteralPattern.FindAllStringSubmatch(fragment, -1)
	seen := make(map[string]struct{}, len(matches))
	values := make([]string, 0, len(matches))
	for _, m := range matches {
		if _, dup := seen[m[1]]; dup {
			continue
		}
		seen[m[1]] = struct{}{}
		values = append(values, m[1])
	}
	return values
}

// readRepoFile reads a file relative to the backend directory, which is the working
// directory for these tests.
func readRepoFile(t *testing.T, relPath string) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", relPath))
	require.NoError(t, err, "reading %s", relPath)
	return string(content)
}
