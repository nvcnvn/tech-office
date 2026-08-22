package integration

import (
	"testing"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEvidenceRequirementCRUD covers evidence requirement creation, update, delete, and listing.
func TestEvidenceRequirementCRUD(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProjectWithMode(owner, "Evidence Requirements Project", uniqueProjectKey("EVREQ"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	def := w.createRitualDefinition(owner, proj.ID, "Daily Check", dailyRecurrenceRule())

	t.Run("when creating evidence requirements for a ritual definition", func(t *testing.T) {
		req1 := w.createEvidenceRequirement(owner, def.Id, "Photo Check",
			rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO,
			rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL)
		req2 := w.createEvidenceRequirement(owner, def.Id, "Text Check",
			rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
			rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL)

		t.Run("it creates requirements with correct types and approval modes", func(t *testing.T) {
			require.NotEmpty(t, req1.Id)
			assert.Equal(t, "Photo Check", req1.Name)
			assert.True(t, req1.IsRequired)
			require.NotEmpty(t, req2.Id)
			assert.True(t, req2.IsRequired)
		})

		t.Run("it assigns sequential positions", func(t *testing.T) {
			reqs := w.listEvidenceRequirements(owner, def.Id)
			require.GreaterOrEqual(t, len(reqs), 2)
			assert.Less(t, reqs[0].Position, reqs[1].Position)
		})
	})

	t.Run("when updating an evidence requirement", func(t *testing.T) {
		req := w.createEvidenceRequirement(owner, def.Id, "Original Name",
			rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
			rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL)

		newName := "Updated Name"
		updated := w.updateEvidenceRequirement(owner, req.Id, &newName)

		t.Run("it updates only the specified fields", func(t *testing.T) {
			assert.Equal(t, "Updated Name", updated.Name)
			assert.True(t, updated.IsRequired) // unchanged
		})
	})

	t.Run("when deleting an evidence requirement with no submissions", func(t *testing.T) {
		req := w.createEvidenceRequirement(owner, def.Id, "To Delete",
			rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
			rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL)

		err := w.deleteEvidenceRequirement(owner, req.Id)

		t.Run("it deletes successfully", func(t *testing.T) {
			assert.NoError(t, err)
		})
	})

	t.Run("when deleting an evidence requirement that has submissions", func(t *testing.T) {
		// Create definition + requirement + generate instance + submit evidence
		defWithSub := w.createRitualDefinition(owner, proj.ID, "Definition With Submissions", dailyRecurrenceRule())
		subReq := w.createEvidenceRequirement(owner, defWithSub.Id, "Evidence Required",
			rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
			rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL)
		w.generateRitualInstances(owner)
		instances := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		if len(instances) > 0 {
			w.submitTextEvidence(owner, instances[0].Id, subReq.Id, "test submission")

			err := w.deleteEvidenceRequirement(owner, subReq.Id)

			t.Run("it returns a constraint error (RESTRICT)", func(t *testing.T) {
				assert.Error(t, err)
			})
		}
	})

	t.Run("when listing evidence requirements for a ritual definition", func(t *testing.T) {
		listDef := w.createRitualDefinition(owner, proj.ID, "List Requirements Ritual", dailyRecurrenceRule())
		w.createEvidenceRequirement(owner, listDef.Id, "Req A",
			rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO,
			rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL)
		w.createEvidenceRequirement(owner, listDef.Id, "Req B",
			rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
			rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL)

		reqs := w.listEvidenceRequirements(owner, listDef.Id)

		t.Run("requirements are ordered by position ascending", func(t *testing.T) {
			require.Len(t, reqs, 2)
			assert.LessOrEqual(t, reqs[0].Position, reqs[1].Position)
		})
	})
}

// TestEvidenceSubmission covers evidence submission, auto-approval, review, and state transitions.
func TestEvidenceSubmission(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProjectWithMode(owner, "Evidence Submission Project", uniqueProjectKey("EVSUB"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

	// Set up a ritual definition with a text evidence requirement (manual approval)
	def := w.createRitualDefinition(owner, proj.ID, "Evidence Test Ritual", dailyRecurrenceRule())
	textReq := w.createEvidenceRequirement(owner, def.Id, "Text Note",
		rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE,
		rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL)

	// Generate instances so there's a task to submit evidence against
	w.generateRitualInstances(owner)
	instances := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(t, instances, "expected at least one ritual instance task to be generated")
	taskID := instances[0].Id

	t.Run("when submitting text evidence", func(t *testing.T) {
		sub := w.submitTextEvidence(owner, taskID, textReq.Id, "Daily safety check completed at 08:00")

		t.Run("the submission starts in pending_review status", func(t *testing.T) {
			require.NotEmpty(t, sub.Id)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, sub.ApprovalStatus)
			assert.Equal(t, "Daily safety check completed at 08:00", sub.TextContent)
			assert.Equal(t, owner.ID.String(), sub.SubmittedByEmployeeId)
		})
	})

	t.Run("when a reviewer approves evidence", func(t *testing.T) {
		sub := w.submitTextEvidence(owner, taskID, textReq.Id, "Submitted for approval")
		reviewed := w.approveEvidence(owner, sub.Id, "Looks good")

		t.Run("the submission status changes to approved", func(t *testing.T) {
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, reviewed.ApprovalStatus)
			assert.Equal(t, owner.ID.String(), reviewed.ReviewedByEmployeeId)
			assert.Equal(t, "Looks good", reviewed.ReviewerComment)
		})
	})

	t.Run("when a reviewer rejects evidence with a comment", func(t *testing.T) {
		sub := w.submitTextEvidence(owner, taskID, textReq.Id, "Incomplete submission")
		rejected := w.rejectEvidence(owner, sub.Id, "Please provide more detail")

		t.Run("the submission status changes to rejected", func(t *testing.T) {
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_REJECTED, rejected.ApprovalStatus)
			assert.Equal(t, "Please provide more detail", rejected.ReviewerComment)
		})
	})

	t.Run("when listing evidence submissions for a task", func(t *testing.T) {
		sub1 := w.submitTextEvidence(owner, taskID, textReq.Id, "Submission 1")
		sub2 := w.submitTextEvidence(owner, taskID, textReq.Id, "Submission 2")

		subs := w.listEvidenceSubmissions(owner, taskID)

		t.Run("it returns all submissions for the task", func(t *testing.T) {
			require.GreaterOrEqual(t, len(subs), 2)
			ids := make([]string, len(subs))
			for i, s := range subs {
				ids[i] = s.Id
			}
			assert.Contains(t, ids, sub1.Id)
			assert.Contains(t, ids, sub2.Id)
		})
	})
}

// TestGPSEvidenceAutoApprove covers GPS-based automatic evidence approval.
func TestGPSEvidenceAutoApprove(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProjectWithMode(owner, "GPS Evidence Project", uniqueProjectKey("GPSPROJ"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

	// Paris coordinates as geofence target
	const targetLat = 48.8566
	const targetLon = 2.3522
	const radiusMeters = 500

	gpsReq := w.createEvidenceRequirement(owner,
		w.createRitualDefinition(owner, proj.ID, "GPS Ritual", dailyRecurrenceRule()).Id,
		"GPS Checkin",
		rpcv1.EvidenceType_EVIDENCE_TYPE_GPS_CHECKIN,
		rpcv1.ApprovalMode_APPROVAL_MODE_AUTO_APPROVE,
	)
	_ = gpsReq // will be used below once we have a definitions with proper config

	// A separate ritual with GPS auto-approve config
	defWithGPS := w.createRitualDefinitionWithAssigneesAndRequirements(
		owner, proj.ID, "GPS Auto-Approve Ritual", dailyRecurrenceRule(),
		[]string{owner.ID.String()},
		[]*rpcv1.CreateEvidenceRequirementInput{
			{
				Name:          "GPS Check",
				EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_GPS_CHECKIN},
				IsRequired:    true,
				ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_AUTO_APPROVE,
				AutoApproveConfig: &rpcv1.AutoApproveConfig{
					GpsTarget:       &rpcv1.GpsTarget{Latitude: targetLat, Longitude: targetLon},
					GpsRadiusMeters: radiusMeters,
				},
			},
		},
	)
	require.NotNil(t, defWithGPS)
	require.Len(t, defWithGPS.EvidenceRequirements, 1)
	gpsRequirementID := defWithGPS.EvidenceRequirements[0].Id

	w.generateRitualInstances(owner)
	gpsTasks := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(t, gpsTasks)
	// Use last task (from defWithGPS)
	gpsTaskID := gpsTasks[len(gpsTasks)-1].Id

	t.Run("when GPS coordinates are within the required geofence", func(t *testing.T) {
		sub := w.submitEvidenceWithGPS(owner, gpsTaskID, gpsRequirementID, targetLat, targetLon, 5.0)

		t.Run("the evidence is auto-approved immediately", func(t *testing.T) {
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, sub.ApprovalStatus)
		})
	})

	t.Run("when GPS coordinates are outside the required geofence", func(t *testing.T) {
		// London is ~340km from Paris
		sub := w.submitEvidenceWithGPS(owner, gpsTaskID, gpsRequirementID, 51.5074, -0.1278, 5.0)

		t.Run("the evidence remains in pending_review", func(t *testing.T) {
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, sub.ApprovalStatus)
		})
	})
}

// TestEvidenceFileUpload covers presigned URL requests and upload confirmation.
func TestEvidenceFileUpload(t *testing.T) {
	t.Parallel()
	t.Skip("File upload tests require live MinIO integration — covered by T014/T015 file storage tests")
}
