package integration

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestContextRail captures the behavior-contract scenarios for the workspace
// context rail before the backend summary contracts are implemented.
func TestContextRail(t *testing.T) {
	t.Run("when requesting the assigned work summary for the authenticated employee", func(t *testing.T) {
		t.Run("it returns due-today and overdue work across projects", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			employee := w.withEmployee()
			projectA := w.createProject(owner, "Context Rail Project A", uniqueProjectKey("CRPA"))
			projectB := w.createProject(owner, "Context Rail Project B", uniqueProjectKey("CRPB"))
			w.addProjectMember(owner, projectA.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			w.addProjectMember(owner, projectB.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			levelA := levelByDepth(projectA.Levels, 0)
			levelB := levelByDepth(projectB.Levels, 0)
			require.NotNil(t, levelA)
			require.NotNil(t, levelB)

			todayTask := w.createTask(owner, projectA.ID, "Due Today Task", levelA.Id)
			overdueTask := w.createTask(owner, projectB.ID, "Overdue Task", levelB.Id)
			futureTask := w.createTask(owner, projectB.ID, "Future Task", levelB.Id)
			closedTask := w.createTask(owner, projectA.ID, "Closed Task", levelA.Id)

			w.assignTask(owner, todayTask.Id, employee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
			w.assignTask(owner, overdueTask.Id, employee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
			w.assignTask(owner, futureTask.Id, employee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
			w.assignTask(owner, closedTask.Id, employee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

			today := time.Now().Format("2006-01-02")
			overdue := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
			future := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
			w.updateTaskDueDate(owner, todayTask.Id, today)
			w.updateTaskDueDate(owner, overdueTask.Id, overdue)
			w.updateTaskDueDate(owner, futureTask.Id, future)
			w.updateTaskDueDate(owner, closedTask.Id, today)

			doneState := stateByCategory(projectA.States, rpcv1.StateCategory_STATE_CATEGORY_DONE)
			require.NotNil(t, doneState)
			w.moveTask(owner, closedTask.Id, doneState.Id)

			summary := w.getAssignedWorkSummary(employee, nil, false)

			t.Run("the response includes counts for due-today and overdue work", func(t *testing.T) {
				assert.Equal(t, today, summary.AsOfDate)
				assert.Equal(t, int32(1), summary.DueTodayCount)
				assert.Equal(t, int32(1), summary.OverdueCount)
			})

			t.Run("the response returns matching items across projects", func(t *testing.T) {
				require.Len(t, summary.Items, 2)

				byTitle := map[string]*string{}
				for _, item := range summary.Items {
					urgency := item.UrgencyBucket
					byTitle[item.Title] = &urgency
				}

				require.Contains(t, byTitle, "Due Today Task")
				require.Contains(t, byTitle, "Overdue Task")
				assert.Equal(t, "due_today", *byTitle["Due Today Task"])
				assert.Equal(t, "overdue", *byTitle["Overdue Task"])
			})

			t.Run("the response excludes future and closed tasks", func(t *testing.T) {
				for _, item := range summary.Items {
					assert.NotEqual(t, futureTask.Id, item.TaskId)
					assert.NotEqual(t, closedTask.Id, item.TaskId)
				}
			})
		})

		// FR-010
		t.Run("it returns an empty summary when no assigned work is due today", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			employee := w.withEmployee()
			project := w.createProject(owner, "Empty Context Rail Project", uniqueProjectKey("CREM"))
			w.addProjectMember(owner, project.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			level := levelByDepth(project.Levels, 0)
			require.NotNil(t, level)

			futureTask := w.createTask(owner, project.ID, "Future Only Task", level.Id)
			w.assignTask(owner, futureTask.Id, employee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
			w.updateTaskDueDate(owner, futureTask.Id, time.Now().AddDate(0, 0, 2).Format("2006-01-02"))

			summary := w.getAssignedWorkSummary(employee, nil, false)

			assert.Equal(t, int32(0), summary.DueTodayCount)
			assert.Equal(t, int32(0), summary.OverdueCount)
			assert.Empty(t, summary.Items)
		})

		t.Run("it isolates the summary to the authenticated organization", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			employee := w.withEmployee()
			project := w.createProject(owner, "Home Org Context Rail", uniqueProjectKey("CRHO"))
			w.addProjectMember(owner, project.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			homeLevel := levelByDepth(project.Levels, 0)
			require.NotNil(t, homeLevel)
			homeTask := w.createTask(owner, project.ID, "Home Org Overdue Task", homeLevel.Id)
			w.assignTask(owner, homeTask.Id, employee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
			w.updateTaskDueDate(owner, homeTask.Id, time.Now().AddDate(0, 0, -1).Format("2006-01-02"))

			otherWorld := newTestWorld(t)
			otherOwner := otherWorld.withOwner()
			otherEmployee := otherWorld.withEmployee()

			otherProject := otherWorld.createProject(otherOwner, "Other Org Context Rail", uniqueProjectKey("CROT"))
			otherWorld.addProjectMember(otherOwner, otherProject.ID, otherEmployee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			level := levelByDepth(otherProject.Levels, 0)
			require.NotNil(t, level)

			otherTask := otherWorld.createTask(otherOwner, otherProject.ID, "Other Org Overdue Task", level.Id)
			otherWorld.assignTask(otherOwner, otherTask.Id, otherEmployee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
			otherWorld.updateTaskDueDate(otherOwner, otherTask.Id, time.Now().AddDate(0, 0, -2).Format("2006-01-02"))

			summary := w.getAssignedWorkSummary(employee, nil, false)
			require.Len(t, summary.Items, 1)
			assert.Equal(t, homeTask.Id, summary.Items[0].TaskId)
			assert.Equal(t, int32(0), summary.DueTodayCount)
			assert.Equal(t, int32(1), summary.OverdueCount)
		})
	})

	t.Run("when responding to pending calendar invites from the rail", func(t *testing.T) {
		// FR-013
		t.Run("accepting an invite updates the attendee response status", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			attendee := w.withEmployee()
			start := time.Now().UTC().Truncate(time.Second).Add(2 * time.Hour)
			end := start.Add(time.Hour)

			event := w.calCreateEventWithRequiredAttendees(
				owner,
				"Context Rail Invite Accept",
				start,
				end,
				[]string{attendee.ID.String()},
			)

			updatedAttendee := w.calRespondToInvite(
				attendee,
				event.Id,
				rpcv1.RSVPResponse_RSVP_RESPONSE_ACCEPTED,
			)

			assert.Equal(t, "accepted", updatedAttendee.RsvpStatus)
			require.NotNil(t, updatedAttendee.ResponseTime)
		})

		t.Run("declining an invite updates the attendee response status", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			attendee := w.withEmployee()
			start := time.Now().UTC().Truncate(time.Second).Add(4 * time.Hour)
			end := start.Add(time.Hour)

			event := w.calCreateEventWithRequiredAttendees(
				owner,
				"Context Rail Invite Decline",
				start,
				end,
				[]string{attendee.ID.String()},
			)

			updatedAttendee := w.calRespondToInvite(
				attendee,
				event.Id,
				rpcv1.RSVPResponse_RSVP_RESPONSE_DECLINED,
			)

			assert.Equal(t, "declined", updatedAttendee.RsvpStatus)
		})

		t.Run("a user cannot respond to an invite from another organization", func(t *testing.T) {
			w := newTestWorld(t)
			employee := w.withEmployee()

			otherWorld := newTestWorld(t)
			otherOwner := otherWorld.withOwner()
			otherAttendee := otherWorld.withEmployee()
			start := time.Now().UTC().Truncate(time.Second).Add(6 * time.Hour)
			end := start.Add(time.Hour)

			event := otherWorld.calCreateEventWithRequiredAttendees(
				otherOwner,
				"Foreign Organization Invite",
				start,
				end,
				[]string{otherAttendee.ID.String()},
			)

			err := w.calRespondToInviteError(
				employee,
				event.Id,
				rpcv1.RSVPResponse_RSVP_RESPONSE_ACCEPTED,
			)

			require.Error(t, err)
			assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
		})
	})

	t.Run("when requesting the active chat context summary", func(t *testing.T) {
		// FR-014
		t.Run("it returns member summaries and pinned messages for a channel", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			employee := w.withEmployee()
			
			channelId := w.createChannel(owner, "Test Rail Channel", false)
			w.joinChannel(employee, channelId)
			
			summary := w.getChannelContextSummary(employee, channelId)
			
			assert.Equal(t, int32(2), summary.MemberCount)
			require.Len(t, summary.Members, 2)
			
			// Verify members
			byId := map[string]*rpcv1.ChannelMemberSummary{}
			for _, m := range summary.Members {
				byId[m.EmployeeId] = m
			}
			
			require.Contains(t, byId, owner.ID.String())
			require.Contains(t, byId, employee.ID.String())
			
			assert.Equal(t, "Admin", byId[owner.ID.String()].RoleLabel)
			assert.Equal(t, "Member", byId[employee.ID.String()].RoleLabel)
			
			// Empty pinned messages for now since DB doesn't support them yet
			assert.Empty(t, summary.PinnedMessages)
			assert.Nil(t, summary.DmCounterpart)
		})

		t.Run("it returns counterpart identity and presence for a direct message", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			employee := w.withEmployee()
			
			resp := w.createOrGetDirectMessage(owner, employee.ID.String())
			
			summary := w.getChannelContextSummary(owner, resp.Channel.Id)
			
			assert.Equal(t, int32(2), summary.MemberCount)
			require.Len(t, summary.Members, 2)
			
			// Check DM counterpart
			require.NotNil(t, summary.DmCounterpart)
			assert.Equal(t, employee.ID.String(), summary.DmCounterpart.EmployeeId)
			assert.NotEmpty(t, summary.DmCounterpart.Email)
		})

		t.Run("it denies access to channels outside the authenticated organization", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			channelId := w.createChannel(owner, "Org 1 Channel", false)
			
			otherWorld := newTestWorld(t)
			otherEmployee := otherWorld.withEmployee()
			
			err := w.getChannelContextSummaryError(otherEmployee, channelId)
			require.Error(t, err)
			assert.Equal(t, connect.CodeNotFound, connect.CodeOf(err))
		})
	})
}
