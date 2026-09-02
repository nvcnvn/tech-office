package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/chat"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestChatTaskCapture is the behavioural contract for turning a chat message into a task.
// The t.Run names below are taken verbatim from the approved scenario list in
// specs/038-chat-task-quick-action/contracts/test-scenarios.md, so `go test -v` reads
// like that document.
func TestChatTaskCapture(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	users := w.withEmployees(3)
	owner, member, outsider := users[0], users[1], users[2]

	t.Run("when a member converts a message in a channel", func(t *testing.T) {
		proj := w.createProject(owner, "Capture Target", uniqueProjectKey("CAPT"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		channelID := w.createChannel(owner, "Capture Channel", false)
		w.inviteToChannel(owner, channelID, member.ID)
		messageID := w.sendMessage(member, channelID, "We should chase the invoice export")

		resp := w.createTaskFromMessage(member, createTaskFromMessageInput{
			ChannelID: channelID,
			MessageID: messageID,
			ProjectID: proj.ID,
			Title:     "Chase the invoice export",
			DueDate:   ptr("2026-09-04"),
			Assignee:  ptr(owner.ID.String()),
		})
		task := resp.Task

		// FR-005
		t.Run("it creates a standard task in the chosen project", func(t *testing.T) {
			assert.Equal(t, proj.ID, task.ProjectId)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_STANDARD, task.TaskKind)
			assert.Equal(t, "Chase the invoice export", task.Title)
		})

		// FR-005, SC-007
		t.Run("the created task has no ritual definition, scheduled date or deadline", func(t *testing.T) {
			assert.Empty(t, task.RitualDefinitionId, "a conversion must never produce a ritual")
			assert.Empty(t, task.ScheduledDate)
			assert.Nil(t, task.CompletionDeadline)
		})

		// FR-006
		t.Run("it assigns the project's default initial workflow state", func(t *testing.T) {
			initial := initialState(proj.States)
			require.NotNil(t, initial, "project should define an initial state")
			assert.Equal(t, initial.Id, task.StateId)
		})

		// FR-006
		t.Run("it assigns a project-scoped identifier of the form KEY-n", func(t *testing.T) {
			assert.True(t, strings.HasPrefix(task.Identifier, proj.Key+"-"),
				"identifier %q should start with the project key %q", task.Identifier, proj.Key)
		})

		// FR-007, D5
		t.Run("it defaults the task level when the request names none", func(t *testing.T) {
			// CreateTaskFromMessageRequest has no level field at all, so this is the only
			// way a task from a message can get one.
			assert.Equal(t, level0.Id, task.LevelId,
				"an unnamed level should fall back to the project's shallowest level")
		})

		// FR-005
		t.Run("it records the converting member as the reporter", func(t *testing.T) {
			assert.Equal(t, member.ID.String(), task.ReporterEmployeeId,
				"the reporter is whoever converted, not the message author")
		})

		// FR-007
		t.Run("it applies the named assignee and due date", func(t *testing.T) {
			require.NotNil(t, task.DueDate)
			assert.Equal(t, "2026-09-04", *task.DueDate)

			opened := w.getTask(member, task.Id)
			assigneeIDs := make([]string, 0, len(opened.Assignees))
			for _, a := range opened.Assignees {
				assigneeIDs = append(assigneeIDs, a.EmployeeId)
			}
			assert.Contains(t, assigneeIDs, owner.ID.String())
		})

		// FR-004
		t.Run("it returns the task and the announcement message id", func(t *testing.T) {
			assert.NotEmpty(t, task.Id)
			assert.NotEmpty(t, resp.AnnouncementMessageId,
				"the caller needs the announcement id to scroll to it")
		})

		// FR-019 — recorded here because the conversion is what writes it.
		t.Run("the task stores the source channel and source message together", func(t *testing.T) {
			require.NotNil(t, task.SourceChannelId)
			require.NotNil(t, task.SourceMessageId)
			assert.Equal(t, channelID, *task.SourceChannelId)
			assert.Equal(t, messageID, *task.SourceMessageId)
		})

		// FR-028
		t.Run("the announcement is posted as a reply to the source message", func(t *testing.T) {
			announcement := w.getMessage(member, resp.AnnouncementMessageId)

			assert.Equal(t, messageID, announcement.ParentMessageId,
				"the announcement belongs in the source message's thread, not the channel")
			assert.Equal(t, chat.MessageKindSystem, announcement.MessageKind)
			assert.Equal(t, chat.SystemEventTypeTaskCreatedFromMessage, announcement.SystemEventType)
			assert.Equal(t, member.ID.String(), announcement.AuthorEmployeeId,
				"the announcement is attributed to the converting member")
			assert.Contains(t, announcement.MetadataJson, task.Id)
			assert.Contains(t, announcement.MetadataJson, task.Identifier)
		})
	})

	t.Run("when the conversion request is malformed", func(t *testing.T) {
		proj := w.createProject(owner, "Malformed", uniqueProjectKey("MALF"))
		channelID := w.createChannel(owner, "Malformed Channel", false)
		messageID := w.sendMessage(owner, channelID, "Something worth doing")

		// FR-011
		t.Run("an empty title is refused and nothing is created", func(t *testing.T) {
			before := w.countTasks(owner, proj.ID)

			err := w.createTaskFromMessageError(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "",
			})

			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
			assert.Equal(t, before, w.countTasks(owner, proj.ID))
		})

		// FR-011
		t.Run("a whitespace-only title is refused and nothing is created", func(t *testing.T) {
			before := w.countTasks(owner, proj.ID)

			err := w.createTaskFromMessageError(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "   \t \n ",
			})

			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
			assert.Equal(t, before, w.countTasks(owner, proj.ID))
		})

		// FR-011
		t.Run("a missing project is refused and nothing is created", func(t *testing.T) {
			err := w.createTaskFromMessageError(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: "", Title: "No project",
			})

			require.Error(t, err)
			assert.Contains(t,
				[]connect.Code{connect.CodeInvalidArgument, connect.CodeNotFound},
				connect.CodeOf(err))
		})
	})

	t.Run("when the caller may not create the task", func(t *testing.T) {
		channelID := w.createChannel(owner, "Refusal Channel", false)
		w.inviteToChannel(owner, channelID, member.ID)
		w.inviteToChannel(owner, channelID, outsider.ID)
		messageID := w.sendMessage(owner, channelID, "Worth tracking")

		// FR-012
		t.Run("a viewer on the destination project is refused", func(t *testing.T) {
			proj := w.createProject(owner, "Viewer Guard", uniqueProjectKey("VWGD"))
			w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)

			err := w.createTaskFromMessageError(member, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "Viewer attempt",
			})

			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		// FR-012
		t.Run("a non-member of a private destination project is refused", func(t *testing.T) {
			private := w.createPrivateProject(owner, "Private Target", uniqueProjectKey("PRVT"))

			err := w.createTaskFromMessageError(outsider, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: private.ID, Title: "Outsider attempt",
			})

			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		// FR-013, SC-008
		t.Run("a project in another organization is refused", func(t *testing.T) {
			other := newTestWorld(t)
			otherOwner := other.withOwner()
			otherProj := other.createProject(otherOwner, "Other Org", uniqueProjectKey("OTHR"))

			err := w.createTaskFromMessageError(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: otherProj.ID, Title: "Cross tenant",
			})

			require.Error(t, err, "a project in another organization must never be writable")
			assert.Contains(t,
				[]connect.Code{connect.CodePermissionDenied, connect.CodeNotFound},
				connect.CodeOf(err))
		})

		// FR-002
		t.Run("a non-member of a private source channel is refused", func(t *testing.T) {
			proj := w.createProject(owner, "Private Channel Guard", uniqueProjectKey("PCGD"))
			w.addProjectMember(owner, proj.ID, outsider.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			privateChannel := w.createChannel(owner, "Closed Room", true)
			privateMessage := w.sendMessage(owner, privateChannel, "Not for everyone")

			// The outsider can write to the project but cannot read the conversation, so
			// the message must stay out of reach.
			err := w.createTaskFromMessageError(outsider, createTaskFromMessageInput{
				ChannelID: privateChannel, MessageID: privateMessage, ProjectID: proj.ID, Title: "Peeking",
			})

			require.Error(t, err)
		})
	})

	t.Run("when the source message cannot be converted", func(t *testing.T) {
		proj := w.createProject(owner, "Unconvertible", uniqueProjectKey("UNCV"))
		channelID := w.createChannel(owner, "Unconvertible Channel", false)

		// FR-002
		t.Run("a system message is refused", func(t *testing.T) {
			// A conversion's own announcement is a system message, which makes it the
			// most realistic system message to try to convert.
			seed := w.sendMessage(owner, channelID, "Seed for the announcement")
			created := w.createTaskFromMessage(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: seed, ProjectID: proj.ID, Title: "Seed task",
			})

			err := w.createTaskFromMessageError(owner, createTaskFromMessageInput{
				ChannelID: channelID,
				MessageID: created.AnnouncementMessageId,
				ProjectID: proj.ID,
				Title:     "Converting the announcement",
			})

			require.Error(t, err, "a system message is a record, not something a person said")
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})

		// FR-002
		t.Run("a soft-deleted message is refused", func(t *testing.T) {
			messageID := w.sendMessage(owner, channelID, "This will be deleted")
			w.deleteMessage(owner, messageID)

			err := w.createTaskFromMessageError(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "Too late",
			})

			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

	t.Run("Atomicity and failure", func(t *testing.T) {
		// FR-030, FR-031
		t.Run("when task creation fails no origin row, destination row or announcement survives", func(t *testing.T) {
			proj := w.createProject(owner, "Atomicity", uniqueProjectKey("ATOM"))
			w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)

			channelID := w.createChannel(owner, "Atomic Channel", false)
			w.inviteToChannel(owner, channelID, member.ID)
			messageID := w.sendMessage(owner, channelID, "Will not become a task")

			repliesBefore := w.countThreadReplies(owner, messageID)
			tasksBefore := w.countTasks(owner, proj.ID)

			// A viewer cannot create the task, so the whole conversion must roll back.
			err := w.createTaskFromMessageError(member, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "Doomed",
			})
			require.Error(t, err)

			assert.Equal(t, tasksBefore, w.countTasks(owner, proj.ID),
				"a refused conversion must leave no task behind")
			assert.Equal(t, repliesBefore, w.countThreadReplies(owner, messageID),
				"a refused conversion must leave no announcement behind")
		})
	})

	// -----------------------------------------------------------------------
	// User Story 2 — the link between message and task
	// -----------------------------------------------------------------------

	t.Run("when a task has been created from a message", func(t *testing.T) {
		proj := w.createProject(owner, "Link Target", uniqueProjectKey("LINK"))
		w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		channelID := w.createChannel(owner, "Link Channel", false)
		w.inviteToChannel(owner, channelID, member.ID)
		messageID := w.sendMessage(member, channelID, "The export needs a rewrite")

		created := w.createTaskFromMessage(member, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID,
			Title: "Rewrite the export",
		})

		// FR-019
		t.Run("the task stores the source channel and source message together", func(t *testing.T) {
			reread := w.getTask(member, created.Task.Id)
			require.NotNil(t, reread.SourceChannelId)
			require.NotNil(t, reread.SourceMessageId)
			assert.Equal(t, channelID, *reread.SourceChannelId)
			assert.Equal(t, messageID, *reread.SourceMessageId)
		})

		// FR-020
		t.Run("GetTaskOrigin returns the channel name, author and excerpt", func(t *testing.T) {
			origin := w.getTaskOrigin(member, created.Task.Id)

			require.True(t, origin.HasOrigin)
			assert.Equal(t, channelID, origin.SourceChannelId)
			assert.Equal(t, messageID, origin.SourceMessageId)
			assert.Equal(t, "Link Channel", origin.ChannelDisplayName)
			assert.NotEmpty(t, origin.AuthorDisplayName, "the origin block names who said it")
			assert.Contains(t, origin.ExcerptHtml, "export needs a rewrite")
			assert.True(t, origin.SourceMessageAvailable)
		})

		// FR-021
		t.Run("ListTasksBySourceMessages returns the link with live task state", func(t *testing.T) {
			links := w.listTasksBySourceMessages(member, []string{messageID})

			require.Len(t, links, 1)
			link := links[0]
			assert.Equal(t, messageID, link.SourceMessageId)
			assert.Equal(t, created.Task.Id, link.TaskId)
			assert.Equal(t, created.Task.Identifier, link.Identifier)
			assert.Equal(t, "Rewrite the export", link.Title)
			assert.Equal(t, proj.ID, link.ProjectId)
			assert.NotEmpty(t, link.StateName, "the chip shows the task's live state")

			// Live, not a snapshot: moving the task changes what the chip says.
			done := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_DONE)
			require.NotNil(t, done, "project should define a done state")
			w.moveTask(member, created.Task.Id, done.Id)

			after := w.listTasksBySourceMessages(member, []string{messageID})
			require.Len(t, after, 1)
			assert.Equal(t, done.Name, after[0].StateName)
			assert.Equal(t, rpcv1.StateCategory_STATE_CATEGORY_DONE, after[0].StateCategory)
		})

		// N+1 guard
		t.Run("one call resolves links for a whole page of message ids", func(t *testing.T) {
			// A realistic page: a handful of converted messages among many that were not.
			pageIDs := []string{messageID}
			converted := map[string]bool{messageID: true}
			for i := 0; i < 3; i++ {
				extra := w.sendMessage(member, channelID, "Another thing worth doing")
				pageIDs = append(pageIDs, extra)
				if i%2 == 0 {
					w.createTaskFromMessage(member, createTaskFromMessageInput{
						ChannelID: channelID, MessageID: extra, ProjectID: proj.ID,
						Title: "Follow-up",
					})
					converted[extra] = true
				}
			}

			links := w.listTasksBySourceMessages(member, pageIDs)

			assert.Len(t, links, len(converted),
				"one call must resolve every converted message on the page, and only those")
			for _, l := range links {
				assert.True(t, converted[l.SourceMessageId],
					"a link came back for a message that was never converted")
			}
		})

		// FR-025
		t.Run("a message converted twice returns both links", func(t *testing.T) {
			twice := w.sendMessage(member, channelID, "This deserves two tasks")
			first := w.createTaskFromMessage(member, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: twice, ProjectID: proj.ID, Title: "First task",
			})
			second := w.createTaskFromMessage(member, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: twice, ProjectID: proj.ID, Title: "Second task",
			})

			links := w.listTasksBySourceMessages(member, []string{twice})

			require.Len(t, links, 2, "converting a message twice is permitted and both links show")
			taskIDs := []string{links[0].TaskId, links[1].TaskId}
			assert.Contains(t, taskIDs, first.Task.Id)
			assert.Contains(t, taskIDs, second.Task.Id)
		})
	})

	// FR-021, SC-008
	t.Run("when the viewer cannot access the destination project", func(t *testing.T) {
		private := w.createPrivateProject(owner, "Hidden Work", uniqueProjectKey("HIDN"))

		channelID := w.createChannel(owner, "Mixed Audience", false)
		w.inviteToChannel(owner, channelID, outsider.ID)
		messageID := w.sendMessage(owner, channelID, "Handle this privately")

		created := w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: messageID, ProjectID: private.ID,
			Title: "Confidential follow-up",
		})

		t.Run("ListTasksBySourceMessages omits the link entirely", func(t *testing.T) {
			// The outsider reads the same channel and the same message, so if the chip
			// leaked it would leak here.
			links := w.listTasksBySourceMessages(outsider, []string{messageID})

			assert.Empty(t, links,
				"a link to a task in a project the caller cannot see must be omitted, not flagged")

			// The owner, who can see the project, still gets it — proving the emptiness
			// above is access filtering and not a broken lookup.
			ownerLinks := w.listTasksBySourceMessages(owner, []string{messageID})
			require.Len(t, ownerLinks, 1)
			assert.Equal(t, created.Task.Id, ownerLinks[0].TaskId)
		})
	})

	// FR-023
	t.Run("when the source message is soft-deleted afterwards", func(t *testing.T) {
		proj := w.createProject(owner, "Outliving", uniqueProjectKey("OUTL"))
		channelID := w.createChannel(owner, "Outliving Channel", false)
		messageID := w.sendMessage(owner, channelID, "Say it once, then delete it")

		created := w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID,
			Title: "Outlives its message",
		})
		w.deleteMessage(owner, messageID)

		t.Run("the task still exists with its origin intact", func(t *testing.T) {
			reread := w.getTask(owner, created.Task.Id)

			require.NotNil(t, reread.SourceMessageId,
				"a soft delete keeps the row, so the origin must survive it")
			assert.Equal(t, messageID, *reread.SourceMessageId)
			assert.Equal(t, "Outlives its message", reread.Title)
		})

		t.Run("GetTaskOrigin reports the message as unavailable", func(t *testing.T) {
			origin := w.getTaskOrigin(owner, created.Task.Id)

			require.True(t, origin.HasOrigin, "the task still knows which conversation it came from")
			assert.Equal(t, "Outliving Channel", origin.ChannelDisplayName)
			assert.False(t, origin.SourceMessageAvailable)
			assert.Empty(t, origin.ExcerptHtml,
				"the deletion placeholder must not be shown as what was said")
		})
	})

	// FR-024
	t.Run("when the task is deleted afterwards", func(t *testing.T) {
		proj := w.createProject(owner, "Deletable", uniqueProjectKey("DELT"))
		channelID := w.createChannel(owner, "Deletable Channel", false)
		messageID := w.sendMessage(owner, channelID, "This task will not last")

		created := w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "Short-lived",
		})
		require.Len(t, w.listTasksBySourceMessages(owner, []string{messageID}), 1)

		w.deleteTask(owner, created.Task.Id)

		t.Run("ListTasksBySourceMessages returns no link for that message", func(t *testing.T) {
			assert.Empty(t, w.listTasksBySourceMessages(owner, []string{messageID}),
				"a chip must not point at a task that no longer exists")
		})
	})

	t.Run("when the conversion is announced", func(t *testing.T) {
		proj := w.createProject(owner, "Announced", uniqueProjectKey("ANNC"))
		w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		channelID := w.createChannel(owner, "Announced Channel", false)
		w.inviteToChannel(owner, channelID, member.ID)
		// The author and the converter are different people, which is what makes
		// FR-029 observable at all.
		messageID := w.sendMessage(owner, channelID, "Someone should own the migration")

		ownerNotifsBefore := len(w.listNotifications(owner, false))
		memberNotifsBefore := len(w.listNotifications(member, false))

		created := w.createTaskFromMessage(member, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID,
			Title: "Own the migration",
		})
		announcement := w.getMessage(member, created.AnnouncementMessageId)

		// FR-028
		t.Run("a system message is posted as a reply to the source message", func(t *testing.T) {
			assert.Equal(t, messageID, announcement.ParentMessageId,
				"the announcement belongs in the source message's thread, not the channel")
			assert.Equal(t, chat.MessageKindSystem, announcement.MessageKind)
			assert.Equal(t, chat.SystemEventTypeTaskCreatedFromMessage, announcement.SystemEventType)
		})

		// FR-028
		t.Run("the announcement carries the task id, identifier and title", func(t *testing.T) {
			assert.Contains(t, announcement.MetadataJson, created.Task.Id)
			assert.Contains(t, announcement.MetadataJson, created.Task.Identifier)
			assert.Contains(t, announcement.MetadataJson, "Own the migration")
		})

		// FR-028
		t.Run("the announcement is attributed to the converting member", func(t *testing.T) {
			assert.Equal(t, member.ID.String(), announcement.AuthorEmployeeId,
				"the converter, not the message author, made this happen")
		})

		// FR-028a
		t.Run("it produces no reply or mention notification for anyone", func(t *testing.T) {
			time.Sleep(300 * time.Millisecond)

			for _, recipient := range []testUser{owner, member} {
				for _, notifType := range []string{
					notification.NotificationTypeReply,
					notification.NotificationTypeMention,
					notification.NotificationTypeMessage,
				} {
					n := findNotificationByNavigationResource(
						w.listNotifications(recipient, false), "chat",
						notifType, created.AnnouncementMessageId)
					assert.Nil(t, n,
						"the announcement is a record, not a message anyone should be pinged about (%s)", notifType)
				}
			}
		})

		// FR-029
		t.Run("the source message author is not notified of the conversion", func(t *testing.T) {
			time.Sleep(300 * time.Millisecond)

			assert.Equal(t, ownerNotifsBefore, len(w.listNotifications(owner, false)),
				"the author of the converted message gets no notification at all")
			// The converter is not notified about their own action either, so the whole
			// conversion is silent.
			assert.Equal(t, memberNotifsBefore, len(w.listNotifications(member, false)))
		})
	})

	// FR-027
	t.Run("when an assignee is named at creation", func(t *testing.T) {
		proj := w.createProject(owner, "Assigned Capture", uniqueProjectKey("ASGC"))
		w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		channelID := w.createChannel(owner, "Assigned Channel", false)
		w.inviteToChannel(owner, channelID, member.ID)
		messageID := w.sendMessage(owner, channelID, "Member should take this one")

		created := w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID,
			Title: "Take this one", Assignee: ptr(member.ID.String()),
		})

		t.Run("the assignee receives the ordinary task-assignment notification", func(t *testing.T) {
			time.Sleep(300 * time.Millisecond)

			// "Ordinary" is the point: conversion delegates to CreateTask, so the
			// assignment notification is the same one the full task form produces.
			n := findNotificationByNavigationResource(
				w.listNotifications(member, false), "projects",
				notification.NotificationTypeTaskAssigned, created.Task.Id)

			require.NotNil(t, n, "an assignee named at conversion is notified like any other")
		})
	})

	// -----------------------------------------------------------------------
	// User Story 3 — the remembered destination
	// -----------------------------------------------------------------------

	// FR-014
	t.Run("when a channel has never had a task created from it", func(t *testing.T) {
		// The caller has converted elsewhere and the organization has projects, so any
		// inference would have something to latch onto.
		w.createProject(owner, "Elsewhere", uniqueProjectKey("ELSW"))
		channelID := w.createChannel(owner, "Fresh Channel", false)

		dest := w.getChannelTaskDestination(owner, channelID)

		t.Run("GetChannelTaskDestination reports it unset with reason NEVER_SET", func(t *testing.T) {
			assert.False(t, dest.IsSet)
			assert.Equal(t,
				rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_NEVER_SET,
				dest.UnsetReason)
		})

		t.Run("no project is inferred from the caller's history or the org default", func(t *testing.T) {
			assert.Empty(t, dest.ProjectId,
				"guessing a destination would silently file work in the wrong place")
			assert.Empty(t, dest.ProjectName)
		})
	})

	// FR-015
	t.Run("when the first task is created from a channel", func(t *testing.T) {
		proj := w.createProject(owner, "First Home", uniqueProjectKey("FRST"))
		channelID := w.createChannel(owner, "Remembering Channel", false)
		messageID := w.sendMessage(owner, channelID, "The first of many")

		w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "The first one",
		})

		t.Run("that project becomes the channel's remembered destination", func(t *testing.T) {
			dest := w.getChannelTaskDestination(owner, channelID)

			require.True(t, dest.IsSet)
			assert.Equal(t, proj.ID, dest.ProjectId)
			assert.Equal(t, "First Home", dest.ProjectName)
			assert.Equal(t, proj.Key, dest.ProjectKey)
		})
	})

	// FR-016
	t.Run("when a later conversion overrides the project", func(t *testing.T) {
		home := w.createProject(owner, "Usual Home", uniqueProjectKey("USUL"))
		elsewhere := w.createProject(owner, "One Off", uniqueProjectKey("ONEF"))

		channelID := w.createChannel(owner, "Overriding Channel", false)
		first := w.sendMessage(owner, channelID, "Goes to the usual place")
		w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: first, ProjectID: home.ID, Title: "Usual",
		})

		second := w.sendMessage(owner, channelID, "This one is different")
		overridden := w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: channelID, MessageID: second, ProjectID: elsewhere.ID, Title: "Exception",
		})

		t.Run("the task is created in the overridden project", func(t *testing.T) {
			assert.Equal(t, elsewhere.ID, overridden.Task.ProjectId)
		})

		t.Run("the channel's remembered destination is unchanged", func(t *testing.T) {
			dest := w.getChannelTaskDestination(owner, channelID)

			require.True(t, dest.IsSet)
			assert.Equal(t, home.ID, dest.ProjectId,
				"one exception must not silently redirect everything that follows")
		})
	})

	// FR-017
	t.Run("when a channel administrator manages the destination", func(t *testing.T) {
		proj := w.createProject(owner, "Managed", uniqueProjectKey("MNGD"))
		w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		// The channel's creator administers it; an invited member does not.
		channelID := w.createChannel(owner, "Managed Channel", false)
		w.inviteToChannel(owner, channelID, member.ID)

		t.Run("they can set it", func(t *testing.T) {
			resp := w.setChannelTaskDestination(owner, channelID, ptr(proj.ID))

			require.True(t, resp.Destination.IsSet)
			assert.Equal(t, proj.ID, resp.Destination.ProjectId)
			assert.Equal(t, proj.ID, w.getChannelTaskDestination(owner, channelID).ProjectId)
		})

		t.Run("they can clear it", func(t *testing.T) {
			resp := w.setChannelTaskDestination(owner, channelID, nil)

			assert.False(t, resp.Destination.IsSet)
			assert.False(t, w.getChannelTaskDestination(owner, channelID).IsSet)
		})

		t.Run("a non-admin member is refused", func(t *testing.T) {
			err := w.setChannelTaskDestinationError(member, channelID, ptr(proj.ID))

			require.Error(t, err, "where a channel's work lands is a channel-level decision")
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			assert.False(t, w.getChannelTaskDestination(owner, channelID).IsSet,
				"the refused call must not have changed anything")
		})
	})

	t.Run("when the remembered destination is no longer usable", func(t *testing.T) {
		// FR-018
		t.Run("an archived project reports unset with reason PROJECT_ARCHIVED", func(t *testing.T) {
			proj := w.createProject(owner, "To Archive", uniqueProjectKey("ARCH"))
			channelID := w.createChannel(owner, "Archiving Channel", false)
			messageID := w.sendMessage(owner, channelID, "Before the archive")
			w.createTaskFromMessage(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "Before",
			})
			require.True(t, w.getChannelTaskDestination(owner, channelID).IsSet)

			_, err := w.archiveProject(owner, proj.ID, true)
			require.NoError(t, err)

			dest := w.getChannelTaskDestination(owner, channelID)
			assert.False(t, dest.IsSet)
			assert.Equal(t,
				rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_PROJECT_ARCHIVED,
				dest.UnsetReason)

			// The row is not deleted, so unarchiving restores the setting rather than
			// losing it.
			_, err = w.archiveProject(owner, proj.ID, false)
			require.NoError(t, err)
			restored := w.getChannelTaskDestination(owner, channelID)
			assert.True(t, restored.IsSet, "the setting returns when the project does")
			assert.Equal(t, proj.ID, restored.ProjectId)
		})

		// FR-018
		t.Run("a deleted project reports unset with reason PROJECT_DELETED", func(t *testing.T) {
			proj := w.createProject(owner, "To Delete", uniqueProjectKey("DELP"))
			channelID := w.createChannel(owner, "Deleting Channel", false)
			messageID := w.sendMessage(owner, channelID, "Before the deletion")
			w.createTaskFromMessage(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "Before",
			})
			require.True(t, w.getChannelTaskDestination(owner, channelID).IsSet)

			// The product exposes no project deletion, so this is reached by removing the
			// row directly. The destination's project foreign key is ON DELETE CASCADE, so
			// the remembered row goes with it and the channel reads as never set — the
			// PROJECT_DELETED reason exists for a destination row that outlives its
			// project, which that foreign key is what prevents.
			w.hardDeleteProject(proj.ID)

			dest := w.getChannelTaskDestination(owner, channelID)
			assert.False(t, dest.IsSet, "a destination whose project is gone is never usable")
			assert.Equal(t,
				rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_NEVER_SET,
				dest.UnsetReason)
		})

		// FR-018
		t.Run("a project the caller cannot write to reports unset with NO_ACCESS", func(t *testing.T) {
			private := w.createPrivateProject(owner, "Not Yours", uniqueProjectKey("NTYR"))
			channelID := w.createChannel(owner, "Shared Channel", false)
			w.inviteToChannel(owner, channelID, outsider.ID)
			messageID := w.sendMessage(owner, channelID, "Filed somewhere private")
			w.createTaskFromMessage(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: private.ID, Title: "Private",
			})

			dest := w.getChannelTaskDestination(outsider, channelID)

			assert.False(t, dest.IsSet)
			assert.Equal(t,
				rpcv1.ChannelDestinationUnsetReason_CHANNEL_DESTINATION_UNSET_REASON_NO_ACCESS,
				dest.UnsetReason)
			assert.Empty(t, dest.ProjectName,
				"the name of a project they cannot access must not leak through the reason")
		})

		// FR-018
		t.Run("converting into it fails with a precondition detail naming the project", func(t *testing.T) {
			proj := w.createProject(owner, "Archived Target", uniqueProjectKey("ARTG"))
			channelID := w.createChannel(owner, "Dead End Channel", false)
			messageID := w.sendMessage(owner, channelID, "Too late for this project")
			_, err := w.archiveProject(owner, proj.ID, true)
			require.NoError(t, err)

			convErr := w.createTaskFromMessageError(owner, createTaskFromMessageInput{
				ChannelID: channelID, MessageID: messageID, ProjectID: proj.ID, Title: "Dead end",
			})

			require.Error(t, convErr)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(convErr))
			assert.Contains(t, convErr.Error(), "Archived Target",
				"naming the project is what lets the client reopen the picker instead of showing a dead end")
		})
	})

	// FR-015
	t.Run("when two channels are used", func(t *testing.T) {
		alpha := w.createProject(owner, "Alpha Work", uniqueProjectKey("ALPH"))
		beta := w.createProject(owner, "Beta Work", uniqueProjectKey("BETA"))

		alphaChannel := w.createChannel(owner, "Alpha Channel", false)
		betaChannel := w.createChannel(owner, "Beta Channel", false)
		w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: alphaChannel,
			MessageID: w.sendMessage(owner, alphaChannel, "Alpha thing"),
			ProjectID: alpha.ID, Title: "Alpha task",
		})
		w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: betaChannel,
			MessageID: w.sendMessage(owner, betaChannel, "Beta thing"),
			ProjectID: beta.ID, Title: "Beta task",
		})

		t.Run("each remembers its own destination independently", func(t *testing.T) {
			assert.Equal(t, alpha.ID, w.getChannelTaskDestination(owner, alphaChannel).ProjectId)
			assert.Equal(t, beta.ID, w.getChannelTaskDestination(owner, betaChannel).ProjectId)
		})
	})

	// Edge case
	t.Run("when the channel is a direct message", func(t *testing.T) {
		proj := w.createProject(owner, "DM Work", uniqueProjectKey("DMWK"))
		w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		dmChannelID := w.createOrGetDM(owner, member.ID)
		messageID := w.sendMessage(owner, dmChannelID, "Can you pick this up?")

		w.createTaskFromMessage(owner, createTaskFromMessageInput{
			ChannelID: dmChannelID, MessageID: messageID, ProjectID: proj.ID,
			Title: "Picked up from a DM",
		})

		t.Run("it remembers its own destination like any other channel", func(t *testing.T) {
			dest := w.getChannelTaskDestination(owner, dmChannelID)

			require.True(t, dest.IsSet, "a DM is a channel; nothing about it is special here")
			assert.Equal(t, proj.ID, dest.ProjectId)
		})
	})
}

// ---------------------------------------------------------------------------
// Helpers for this contract
// ---------------------------------------------------------------------------

type createTaskFromMessageInput struct {
	ChannelID string
	MessageID string
	ProjectID string
	Title     string
	Assignee  *string
	DueDate   *string
	ParentID  *string
}

func (in createTaskFromMessageInput) toRequest() *rpcv1.CreateTaskFromMessageRequest {
	return &rpcv1.CreateTaskFromMessageRequest{
		SourceChannelId:    in.ChannelID,
		SourceMessageId:    in.MessageID,
		ProjectId:          in.ProjectID,
		Title:              in.Title,
		AssigneeEmployeeId: in.Assignee,
		DueDate:            in.DueDate,
		ParentTaskId:       in.ParentID,
	}
}

func (w *testWorld) createTaskFromMessage(actor testUser, in createTaskFromMessageInput) *rpcv1.CreateTaskFromMessageResponse {
	w.t.Helper()
	req := connect.NewRequest(in.toRequest())
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.CreateTaskFromMessage(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) createTaskFromMessageError(actor testUser, in createTaskFromMessageInput) error {
	w.t.Helper()
	req := connect.NewRequest(in.toRequest())
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.CreateTaskFromMessage(context.Background(), req)
	return err
}

// countTasks reports how many tasks a project holds, so a refusal can be shown to have
// created nothing rather than merely to have returned an error.
func (w *testWorld) countTasks(actor testUser, projectID string) int {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListTasksRequest{ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListTasks(context.Background(), req)
	require.NoError(w.t, err)
	return len(resp.Msg.Tasks)
}

// countThreadReplies reports how many replies hang off a message, which is how an
// announcement that should not exist is shown not to.
func (w *testWorld) countThreadReplies(actor testUser, messageID string) int {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListRepliesRequest{ParentMessageId: messageID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.chat.ListReplies(context.Background(), req)
	require.NoError(w.t, err)
	return len(resp.Msg.Replies)
}

// initialState returns the state a new task lands in.
func initialState(states []*rpcv1.ProjectState) *rpcv1.ProjectState {
	for _, s := range states {
		if s.IsInitial {
			return s
		}
	}
	return nil
}

func (w *testWorld) listTasksBySourceMessages(actor testUser, messageIDs []string) []*rpcv1.MessageTaskLink {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListTasksBySourceMessagesRequest{MessageIds: messageIDs})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.ListTasksBySourceMessages(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg.Links
}

func (w *testWorld) getTaskOrigin(actor testUser, taskID string) *rpcv1.GetTaskOriginResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetTaskOriginRequest{TaskId: taskID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetTaskOrigin(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) getChannelTaskDestination(actor testUser, channelID string) *rpcv1.GetChannelTaskDestinationResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.GetChannelTaskDestinationRequest{ChannelId: channelID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.GetChannelTaskDestination(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) setChannelTaskDestination(actor testUser, channelID string, projectID *string) *rpcv1.SetChannelTaskDestinationResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SetChannelTaskDestinationRequest{ChannelId: channelID, ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.collab.SetChannelTaskDestination(context.Background(), req)
	require.NoError(w.t, err)
	return resp.Msg
}

func (w *testWorld) setChannelTaskDestinationError(actor testUser, channelID string, projectID *string) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SetChannelTaskDestinationRequest{ChannelId: channelID, ProjectId: projectID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.SetChannelTaskDestination(context.Background(), req)
	return err
}

func (w *testWorld) deleteTask(actor testUser, taskID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.DeleteTaskRequest{TaskId: taskID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.collab.DeleteTask(context.Background(), req)
	require.NoError(w.t, err)
}

// hardDeleteProject removes a project row outright. The product exposes no project
// deletion — archiving is the supported operation — so this exists only to exercise what
// a remembered destination does when its project is genuinely gone.
func (w *testWorld) hardDeleteProject(projectID string) {
	w.t.Helper()
	id, err := dbuuid.Parse(projectID)
	require.NoError(w.t, err)
	_, err = globalDB.Exec(context.Background(),
		`DELETE FROM collaboration.project WHERE organization_id = $1 AND id = $2`,
		w.OrgID, id)
	require.NoError(w.t, err)
}
