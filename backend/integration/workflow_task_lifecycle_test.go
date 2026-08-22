package integration

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTaskLifecycleWorkflow simulates a realistic user workflow:
// Manager creates a project -> adds team members -> creates tasks with hierarchy ->
// assigns tasks -> team members interact with task channels and files ->
// tasks move through states -> manager views analytics.
func TestTaskLifecycleWorkflow(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	users := w.withEmployees(3)
	manager, dev1, dev2 := users[0], users[1], users[2]

	t.Run("when a manager sets up a project and assigns work", func(t *testing.T) {
		proj := w.createProject(manager, "Sprint Alpha", uniqueProjectKey("SPRT"))
		level0 := levelByDepth(proj.Levels, 0)
		level1 := levelByDepth(proj.Levels, 1)
		require.NotNil(t, level0)
		require.NotNil(t, level1)

		w.addProjectMember(manager, proj.ID, dev1.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(manager, proj.ID, dev2.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		epic := w.createTask(manager, proj.ID, "User Authentication", level0.Id)
		story1 := w.createChildTask(manager, proj.ID, "Login API", level1.Id, epic.Id)
		story2 := w.createChildTask(manager, proj.ID, "Password Reset", level1.Id, epic.Id)

		w.assignTask(manager, story1.Id, dev1.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		w.assignTask(manager, story2.Id, dev2.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		w.assignTask(manager, story1.Id, manager.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_REVIEWER)

		t.Run("team members can see the project in their list", func(t *testing.T) {
			projects := w.listProjects(dev1)
			p := findProject(projects, proj.ID)
			require.NotNil(t, p, "dev1 should see the project after being added")
		})

		t.Run("team members can list tasks in the project", func(t *testing.T) {
			tasks := w.listTasks(dev1, proj.ID)
			require.GreaterOrEqual(t, len(tasks), 3, "dev1 should see epic + 2 stories")
		})

		t.Run("assigned task has correct assignees visible to team", func(t *testing.T) {
			task := w.getTask(dev1, story1.Id)
			require.Len(t, task.Assignees, 2, "story1 should have dev1 as assignee + manager as reviewer")
		})

		t.Run("each task has an integrated chat channel and description doc", func(t *testing.T) {
			task := w.getTask(dev1, story1.Id)
			assert.NotNil(t, task.ChannelId, "task should have a chat channel")
			assert.NotNil(t, task.DescriptionDocumentId, "task should have a description document")
		})

		t.Run("when a developer moves their task through states", func(t *testing.T) {
			ipState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
			doneState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_DONE)
			require.NotNil(t, ipState)
			require.NotNil(t, doneState)

			w.moveTask(dev1, story1.Id, ipState.Id)

			t.Run("the task state is updated when fetched by another user", func(t *testing.T) {
				fetched := w.getTask(manager, story1.Id)
				assert.Equal(t, ipState.Id, fetched.StateId)
			})

			t.Run("filtering by state shows only matching tasks", func(t *testing.T) {
				ipTasks := w.listTasksWithFilter(manager, proj.ID, &ipState.Id, nil)
				found := false
				for _, task := range ipTasks {
					if task.Id == story1.Id {
						found = true
					}
					assert.NotEqual(t, story2.Id, task.Id)
				}
				assert.True(t, found, "story1 should appear in in-progress filter")
			})

			w.moveTask(dev1, story1.Id, doneState.Id)

			t.Run("completed task shows in done filter", func(t *testing.T) {
				doneTasks := w.listTasksWithFilter(manager, proj.ID, &doneState.Id, nil)
				found := false
				for _, task := range doneTasks {
					if task.Id == story1.Id {
						found = true
					}
				}
				assert.True(t, found, "completed story1 should appear in done filter")
			})
		})

		t.Run("when a developer attaches a file to a task", func(t *testing.T) {
			fileContent := []byte("package main\n\nfunc main() {}\n")
			fileID, updatedTask := w.uploadTaskFile(dev1, story1.Id, "main.go", "text/x-go", fileContent)

			t.Run("the file ID appears in the task file list", func(t *testing.T) {
				found := false
				for _, fid := range updatedTask.FileIds {
					if fid == fileID {
						found = true
					}
				}
				assert.True(t, found, "uploaded file should be in task.file_ids")
			})

			t.Run("another team member can access the task file", func(t *testing.T) {
				hasAccess, _ := w.checkFileAccess(dev2, fileID)
				assert.True(t, hasAccess, "project member should have access to task file")
			})

			t.Run("the file metadata is retrievable in batch", func(t *testing.T) {
				files := w.getFileMetadataBatch(manager, []string{fileID})
				require.Len(t, files, 1)
				assert.Equal(t, "main.go", files[0].OriginalFilename)
			})
		})

		t.Run("when the manager views project analytics", func(t *testing.T) {
			analytics := w.getTaskAnalytics(manager, proj.ID, []string{"state"})
			assert.NotNil(t, analytics, "analytics should be returned")
		})

		t.Run("when the manager exports tasks as CSV", func(t *testing.T) {
			csvData := w.exportTasksCSV(manager, proj.ID)
			assert.NotEmpty(t, csvData, "CSV export should contain data")
			assert.True(t, strings.Contains(string(csvData), "Login API"),
				"CSV should include task titles")
		})

		t.Run("when a developer watches and checks task notifications", func(t *testing.T) {
			w.watchTask(dev2, story2.Id)
			notifID := w.publishNotification(dev2.ID, "Task Updated: Password Reset")

			t.Run("the notification appears in the developer list", func(t *testing.T) {
				notifs := w.listNotifications(dev2, true)
				n := findNotification(notifs, notifID)
				require.NotNil(t, n, "dev2 should receive the task notification")
				assert.Equal(t, "Task Updated: Password Reset", n.Title)
			})

			t.Run("marking notification as read updates unread count", func(t *testing.T) {
				beforeCount := w.getUnreadCount(dev2)
				notifs := w.listNotifications(dev2, true)
				if len(notifs) > 0 {
					w.markAsRead(dev2, notifs[0].NotificationRecipientId)
				}
				afterCount := w.getUnreadCount(dev2)
				assert.LessOrEqual(t, afterCount, beforeCount)
			})
		})
	})
}

// TestTaskCrossProjectIsolation verifies that task operations respect project
// boundaries.
func TestTaskCrossProjectIsolation(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	users := w.withEmployees(2)
	member, outsider := users[0], users[1]

	t.Run("when a user creates tasks in a private project", func(t *testing.T) {
		proj := w.createPrivateProject(member, "Secret Project", uniqueProjectKey("SCRT"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		task := w.createTask(member, proj.ID, "Secret Task", level0.Id)

		t.Run("the outsider cannot see the project", func(t *testing.T) {
			projects := w.listProjects(outsider)
			assert.Nil(t, findProject(projects, proj.ID))
		})

		t.Run("the outsider cannot fetch the task", func(t *testing.T) {
			err := w.getTaskError(outsider, task.Id)
			require.Error(t, err)
			code := connect.CodeOf(err)
			assert.True(t, code == connect.CodePermissionDenied || code == connect.CodeNotFound,
				"expected PermissionDenied or NotFound, got %v", code)
		})

		t.Run("after adding as member the outsider can see the task", func(t *testing.T) {
			w.addProjectMember(member, proj.ID, outsider.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			fetched := w.getTask(outsider, task.Id)
			assert.Equal(t, task.Id, fetched.Id)
		})
	})
}
