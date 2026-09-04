package integration

import (
	"testing"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRitualDefinitionCRUD covers ritual definition creation, retrieval, update, archive, and listing.
func TestRitualDefinitionCRUD(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when a project admin creates a ritual definition", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Ritual Project", uniqueProjectKey("RIT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		emp := w.withEmployee()
		w.addProjectMember(owner, proj.ID, emp.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)

		def := w.createRitualDefinitionWithAssigneesAndRequirements(
			emp,
			proj.ID,
			"Daily Safety Check",
			dailyRecurrenceRule(),
			[]string{emp.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{
				{
					Name:          "Photo Evidence",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				},
			},
		)

		t.Run("it creates the definition with recurrence schedule and evidence requirements", func(t *testing.T) {
			require.NotEmpty(t, def.Id)
			assert.Equal(t, "Daily Safety Check", def.Name)
			assert.Equal(t, rpcv1.RecurrenceType_RECURRENCE_TYPE_DAILY, def.RecurrenceRule.Type)
			assert.Equal(t, int32(8), def.CompletionWindowHours)
		})

		t.Run("it auto-creates default assignees from the request", func(t *testing.T) {
			assert.NotEmpty(t, def.DefaultAssigneeIds)
			assert.Contains(t, def.DefaultAssigneeIds, emp.ID.String())
		})

		t.Run("it returns the full ritual definition with evidence requirements", func(t *testing.T) {
			assert.Len(t, def.EvidenceRequirements, 1)
			assert.Equal(t, "Photo Evidence", def.EvidenceRequirements[0].Name)
		})
	})

	t.Run("when getting a ritual definition", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Get Ritual Project", uniqueProjectKey("GRIT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		def := w.createRitualDefinition(owner, proj.ID, "Weekly Audit", dailyRecurrenceRule())

		fetched := w.getRitualDefinition(owner, def.Id)

		t.Run("it returns the definition with all evidence requirements and assignees", func(t *testing.T) {
			require.NotNil(t, fetched)
			assert.Equal(t, def.Id, fetched.Id)
			assert.Equal(t, "Weekly Audit", fetched.Name)
		})
	})

	t.Run("when updating a ritual definition name and schedule", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Update Ritual Project", uniqueProjectKey("URIT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		def := w.createRitualDefinition(owner, proj.ID, "Old Name", dailyRecurrenceRule())

		newName := "Updated Name"
		updated := w.updateRitualDefinition(owner, def.Id, &newName)

		t.Run("it updates only the specified fields (COALESCE partial update)", func(t *testing.T) {
			assert.Equal(t, "Updated Name", updated.Name)
			// Recurrence rule untouched
			assert.Equal(t, rpcv1.RecurrenceType_RECURRENCE_TYPE_DAILY, updated.RecurrenceRule.Type)
		})

		t.Run("it does not affect existing generated instances", func(t *testing.T) {
			// The definition still exists and is not archived
			fetched := w.getRitualDefinition(owner, def.Id)
			assert.False(t, fetched.IsArchived)
		})
	})

	t.Run("when archiving a ritual definition", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Archive Ritual Project", uniqueProjectKey("ARIT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		def := w.createRitualDefinition(owner, proj.ID, "To Archive", dailyRecurrenceRule())

		archived, err := w.archiveRitualDefinition(owner, def.Id, true)
		require.NoError(t, err)

		t.Run("it stops generating new instances", func(t *testing.T) {
			assert.True(t, archived.IsArchived)
		})

		t.Run("it preserves all historical instances", func(t *testing.T) {
			// Definition still retrievable
			fetched := w.getRitualDefinition(owner, def.Id)
			require.NotNil(t, fetched)
			assert.True(t, fetched.IsArchived)
		})

		t.Run("it appears in list when include_archived is true", func(t *testing.T) {
			defs := w.listRitualDefinitions(owner, proj.ID, true)
			found := findRitualDefinition(defs, def.Id)
			assert.NotNil(t, found)
		})

		t.Run("it does not appear in list when include_archived is false", func(t *testing.T) {
			defs := w.listRitualDefinitions(owner, proj.ID, false)
			found := findRitualDefinition(defs, def.Id)
			assert.Nil(t, found)
		})

		// Feature 044, US4 scenario 2. Archiving soft-deletes every pending instance but
		// leaves the generation waterline where it was, so a restored definition used to
		// read as active and produce nothing until real time caught up with the old
		// window — up to generation_window_days of a ritual that looks alive and never
		// runs. Unarchiving now clears the waterline.
		t.Run("restoring it brings its runs back", func(t *testing.T) {
			before := countRitualInstances(w.listTasks(owner, proj.ID), def.Id)
			require.Zero(t, before, "archiving removes the pending runs")

			restored, err := w.archiveRitualDefinition(owner, def.Id, false)
			require.NoError(t, err)
			assert.False(t, restored.IsArchived)

			after := countRitualInstances(w.listTasks(owner, proj.ID), def.Id)
			assert.NotZero(t, after, "a restored ritual generates runs again")
		})
	})

	t.Run("when listing ritual definitions for a project", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "List Ritual Project", uniqueProjectKey("LRIT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		active := w.createRitualDefinition(owner, proj.ID, "Active Ritual", dailyRecurrenceRule())
		toArchive := w.createRitualDefinition(owner, proj.ID, "Archived Ritual", dailyRecurrenceRule())
		_, err := w.archiveRitualDefinition(owner, toArchive.Id, true)
		require.NoError(t, err)

		t.Run("it returns only non-archived definitions by default", func(t *testing.T) {
			defs := w.listRitualDefinitions(owner, proj.ID, false)
			assert.NotNil(t, findRitualDefinition(defs, active.Id))
			assert.Nil(t, findRitualDefinition(defs, toArchive.Id))
		})

		t.Run("it returns all definitions when include_archived is true", func(t *testing.T) {
			defs := w.listRitualDefinitions(owner, proj.ID, true)
			assert.NotNil(t, findRitualDefinition(defs, active.Id))
			assert.NotNil(t, findRitualDefinition(defs, toArchive.Id))
		})
	})

	// FR-013: the mobile create form sends its evidence requirements inline rather than
	// creating the definition and then looping. A ritual with no evidence requirement is a
	// task with a schedule, so a half-created definition is never an acceptable outcome.
	t.Run("when a definition is created with its evidence requirements inline", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Inline Reqs Project", uniqueProjectKey("INL"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

		def := w.createRitualDefinitionWithAssigneesAndRequirements(
			owner,
			proj.ID,
			"Opening Checklist",
			dailyRecurrenceRule(),
			nil,
			[]*rpcv1.CreateEvidenceRequirementInput{
				{
					Name:          "Shutters up",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				},
				{
					Name: "Anything odd overnight",
					EvidenceTypes: []rpcv1.EvidenceType{
						rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
						rpcv1.EvidenceType_EVIDENCE_TYPE_VOICE_MEMO,
					},
					IsRequired:   false,
					ApprovalMode: rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				},
			},
		)

		t.Run("both requirements exist with the names, types and optionality that were sent", func(t *testing.T) {
			reqs := w.listEvidenceRequirements(owner, def.Id)
			require.Len(t, reqs, 2)

			assert.Equal(t, "Shutters up", reqs[0].Name)
			assert.Equal(t, []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO}, reqs[0].EvidenceTypes)
			assert.True(t, reqs[0].IsRequired)

			assert.Equal(t, "Anything odd overnight", reqs[1].Name)
			assert.Equal(t, []rpcv1.EvidenceType{
				rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
				rpcv1.EvidenceType_EVIDENCE_TYPE_VOICE_MEMO,
			}, reqs[1].EvidenceTypes)
			assert.False(t, reqs[1].IsRequired)
		})

		t.Run("position follows the order they were sent in", func(t *testing.T) {
			reqs := w.listEvidenceRequirements(owner, def.Id)
			require.Len(t, reqs, 2)
			assert.Equal(t, int32(0), reqs[0].Position)
			assert.Equal(t, int32(1), reqs[1].Position)
		})
	})

	// FR-013 atomicity: a refused request creates neither the definition nor any of the
	// requirements it carried, so the phone can retry the same draft without producing a
	// stripped ritual it would have to notice and clean up.
	t.Run("when a create request carrying requirements is refused", func(t *testing.T) {
		proj := w.createProjectWithMode(owner, "Atomic Reqs Project", uniqueProjectKey("ATM"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

		err := w.createRitualDefinitionWithRequirementsError(
			owner,
			proj.ID,
			"Never Lands",
			dailyRecurrenceRule(),
			[]*rpcv1.CreateEvidenceRequirementInput{
				{
					Name:          "Shutters up",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				},
				{
					// Points at a document that does not exist, so the whole request is
					// refused after the first requirement would otherwise have been written.
					Name:          "Signed off",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_PDF},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				},
			},
			ptr("00000000-0000-0000-0000-000000000000"),
		)

		t.Run("the request is refused", func(t *testing.T) {
			require.Error(t, err)
		})

		t.Run("no definition was created", func(t *testing.T) {
			defs := w.listRitualDefinitions(owner, proj.ID, true)
			assert.Nil(t, findRitualDefinitionByName(defs, "Never Lands"))
		})

		t.Run("no evidence requirement rows were left behind in the project", func(t *testing.T) {
			assert.Zero(t, w.countEvidenceRequirementsInProject(proj.ID))
		})
	})
}

// TestRitualDefinitionPermissions covers RBAC on ritual definition operations.
func TestRitualDefinitionPermissions(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProjectWithMode(owner, "Permissions Ritual Project", uniqueProjectKey("PRIT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

	viewer := w.withEmployee()
	member := w.withEmployee()
	admin := w.withEmployee()

	w.addProjectMember(owner, proj.ID, viewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)
	w.addProjectMember(owner, proj.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
	w.addProjectMember(owner, proj.ID, admin.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)

	t.Run("when a project viewer tries to create a ritual definition", func(t *testing.T) {
		err := w.createRitualDefinitionError(viewer, proj.ID, "Viewer Ritual", dailyRecurrenceRule())

		t.Run("it returns permission denied", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})
	})

	t.Run("when a project member (non-admin) tries to create a ritual definition", func(t *testing.T) {
		err := w.createRitualDefinitionError(member, proj.ID, "Member Ritual", dailyRecurrenceRule())

		t.Run("it returns permission denied", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})
	})

	t.Run("when a project admin creates a ritual definition", func(t *testing.T) {
		def := w.createRitualDefinition(admin, proj.ID, "Admin Ritual", dailyRecurrenceRule())

		t.Run("it succeeds", func(t *testing.T) {
			assert.NotEmpty(t, def.Id)
		})
	})

	t.Run("when a project owner creates a ritual definition", func(t *testing.T) {
		def := w.createRitualDefinition(owner, proj.ID, "Owner Ritual", dailyRecurrenceRule())

		t.Run("it succeeds", func(t *testing.T) {
			assert.NotEmpty(t, def.Id)
		})
	})
}
