package integration

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Feature 041: Evidence Review Queue — behavioural contract.
//
// Each t.Run name is a sentence about observable behaviour, and the trailing comment maps
// it to the requirement it proves.

// ---------------------------------------------------------------------------
// Arrange: a ritual project whose pending submissions the test controls
// ---------------------------------------------------------------------------

// reviewQueueProject is one ritual project with a definition, a manual-approval text
// requirement and one live instance — the smallest thing a pending submission can hang off.
type reviewQueueProject struct {
	projectID     string
	definitionID  string
	requirementID string
	taskID        string
}

// newReviewQueueProject builds a ritual project the reviewer owns and the submitter is a
// member of, with one instance kept in play. The surplus instances a daily rule generates
// are detached so they cannot acquire submissions and pollute a count.
func (w *testWorld) newReviewQueueProject(owner, submitter testUser, name, keyPrefix string) reviewQueueProject {
	w.t.Helper()

	proj := w.createProjectWithMode(owner, name, uniqueProjectKey(keyPrefix),
		rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	w.addProjectMember(owner, proj.ID, submitter.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

	def := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
		owner, proj.ID, name+" Ritual", dailyRecurrenceRule(), 8,
		[]string{submitter.ID.String()},
		[]*rpcv1.CreateEvidenceRequirementInput{{
			Name:          "Gate note",
			EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
			IsRequired:    true,
			ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
		}},
	)
	require.NotEmpty(w.t, def.EvidenceRequirements, "definition should carry its requirement")

	w.generateRitualInstances(owner)
	instances := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(w.t, instances, "expected the definition to generate at least one instance")

	kept := instances[0]
	for _, extra := range instances[1:] {
		w.detachRitualInstanceFromSweep(extra.Id)
	}

	return reviewQueueProject{
		projectID:     proj.ID,
		definitionID:  def.Id,
		requirementID: def.EvidenceRequirements[0].Id,
		taskID:        kept.Id,
	}
}

// newLateableReviewQueueProject is newReviewQueueProject with a second required
// requirement that is never submitted.
//
// It exists because `overdue` and `missed` require INCOMPLETE evidence: an instance whose
// only requirement has been submitted derives to `submitted` — the reviewer owes the next
// move, so lateness is not the worker's fault. A test that wants a pending submission on a
// late instance therefore needs something still outstanding beside it.
func (w *testWorld) newLateableReviewQueueProject(owner, submitter testUser, name, keyPrefix string) reviewQueueProject {
	w.t.Helper()

	proj := w.createProjectWithMode(owner, name, uniqueProjectKey(keyPrefix),
		rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	w.addProjectMember(owner, proj.ID, submitter.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

	def := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
		owner, proj.ID, name+" Ritual", dailyRecurrenceRule(), 8,
		[]string{submitter.ID.String()},
		[]*rpcv1.CreateEvidenceRequirementInput{
			{
				Name:          "Gate note",
				EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
				IsRequired:    true,
				ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
			},
			{
				Name:          "Never submitted",
				EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
				IsRequired:    true,
				ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
			},
		},
	)
	require.Len(w.t, def.EvidenceRequirements, 2)

	w.generateRitualInstances(owner)
	instances := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(w.t, instances)

	kept := instances[0]
	for _, extra := range instances[1:] {
		w.detachRitualInstanceFromSweep(extra.Id)
	}

	return reviewQueueProject{
		projectID:     proj.ID,
		definitionID:  def.Id,
		requirementID: def.EvidenceRequirements[0].Id,
		taskID:        kept.Id,
	}
}

// failTaskUpdates installs a trigger that makes any update to one ritual instance raise.
//
// It is fault injection, and it is the only way to reach the state FR-018 is about: a
// decision that has already written its compare-and-set and then fails at the state
// re-derivation. Every other refusal in this feature happens before anything is written,
// which proves nothing about rollback. Scoped to a single task id so parallel tests on the
// shared database are untouched, and dropped when the test ends.
func (w *testWorld) failTaskUpdates(taskID string) {
	w.t.Helper()
	id := dbuuid.MustParse(taskID)
	trigger := "fail_task_update_" + strings.ReplaceAll(taskID, "-", "")

	_, err := globalDB.Exec(context.Background(), fmt.Sprintf(`
		CREATE OR REPLACE FUNCTION collaboration.%s() RETURNS trigger AS $fn$
		BEGIN
			RAISE EXCEPTION 'injected failure for task %%', NEW.id;
		END;
		$fn$ LANGUAGE plpgsql;

		CREATE TRIGGER %s
			BEFORE UPDATE ON collaboration.task
			FOR EACH ROW WHEN (NEW.id = '%s'::uuid)
			EXECUTE FUNCTION collaboration.%s();
	`, trigger, trigger, id.String(), trigger))
	require.NoError(w.t, err)

	w.t.Cleanup(func() {
		_, _ = globalDB.Exec(context.Background(), fmt.Sprintf(
			`DROP TRIGGER IF EXISTS %s ON collaboration.task; DROP FUNCTION IF EXISTS collaboration.%s();`,
			trigger, trigger))
	})
}

// setSubmissionServerTimestamp rewrites the server's record of arrival. Written directly
// because no RPC exposes it — it is set to NOW() at submission — yet it is the queue's
// ordering key, so a test that asserts an order has to be able to choose one.
func (w *testWorld) setSubmissionServerTimestamp(submissionID string, at time.Time) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.evidence_submission SET server_timestamp = $2::timestamptz WHERE id = $1`,
		dbuuid.MustParse(submissionID), at)
	require.NoError(w.t, err)
}

// seedPendingSubmissions inserts n pending submissions against one requirement in a single
// statement, each a minute apart. Driving 100+ submissions through SubmitEvidence would
// spend minutes proving something about the count cap that has nothing to do with the
// submission path.
func (w *testWorld) seedPendingSubmissions(orgID dbuuid.UUID, p reviewQueueProject, submitter testUser, n int, firstAt time.Time) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`INSERT INTO collaboration.evidence_submission
		   (organization_id, task_id, evidence_requirement_id, submitted_by_employee_id,
		    evidence_type, text_content, server_timestamp, approval_status)
		 SELECT $1, $2, $3, $4, 'text_note', 'seeded ' || i,
		        $5::timestamptz + (i || ' minutes')::interval, 'pending_review'
		 FROM generate_series(1, $6) AS i`,
		orgID, dbuuid.MustParse(p.taskID), dbuuid.MustParse(p.requirementID), submitter.ID,
		firstAt, n)
	require.NoError(w.t, err)
}

// breakSubmissionFile points a file-backed submission at a file id that resolves to
// nothing, which is what an interrupted upload leaves behind. The queue must still list
// it: a broken upload silently clearing the queue is the failure FR-009 names.
func (w *testWorld) breakSubmissionFile(submissionID string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.evidence_submission
		 SET evidence_type = 'photo', file_id = $2, text_content = NULL
		 WHERE id = $1`,
		dbuuid.MustParse(submissionID), dbuuid.Must())
	require.NoError(w.t, err)
}

// setProjectVisibility rewrites a project's visibility. Written directly because
// CreateProject fixes it and no RPC changes it afterwards, yet visibility is exactly the
// input the public-project scope question turns on.
func (w *testWorld) setProjectVisibility(projectID, visibility string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.project SET visibility = $2 WHERE id = $1`,
		dbuuid.MustParse(projectID), visibility)
	require.NoError(w.t, err)
}

func TestEvidenceReviewQueue(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	reviewer := w.withOwner()
	submitter := w.withEmployee()

	projA := w.newReviewQueueProject(reviewer, submitter, "Queue Alpha", "QA")
	projB := w.newReviewQueueProject(reviewer, submitter, "Queue Bravo", "QB")
	projC := w.newReviewQueueProject(reviewer, submitter, "Queue Charlie", "QC")

	base := time.Now().Add(-6 * time.Hour).UTC().Truncate(time.Second)
	subA := w.submitTextEvidence(submitter, projA.taskID, projA.requirementID, "alpha gate checked")
	subB := w.submitTextEvidence(submitter, projB.taskID, projB.requirementID, "bravo gate checked")
	subC := w.submitTextEvidence(submitter, projC.taskID, projC.requirementID, "charlie gate checked")

	// Oldest first: B, then A, then C. Deliberately not the creation order, so an
	// implementation that happens to return insertion order fails.
	w.setSubmissionServerTimestamp(subB.Id, base)
	w.setSubmissionServerTimestamp(subA.Id, base.Add(1*time.Hour))
	w.setSubmissionServerTimestamp(subC.Id, base.Add(2*time.Hour))

	t.Run("when a reviewer with pending submissions across three projects opens the queue", func(t *testing.T) {
		resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{})

		t.Run("it returns every pending submission from all three projects in one list", func(t *testing.T) {
			// FR-001: one surface, no project named by the caller.
			ids := reviewQueueSubmissionIDs(resp)
			assert.Contains(t, ids, subA.Id)
			assert.Contains(t, ids, subB.Id)
			assert.Contains(t, ids, subC.Id)

			projects := map[string]bool{}
			for _, e := range resp.Entries {
				projects[e.ProjectId] = true
			}
			assert.True(t, projects[projA.projectID] && projects[projB.projectID] && projects[projC.projectID],
				"all three projects should be represented in one list")
		})

		t.Run("it orders the entries oldest submission first", func(t *testing.T) {
			// FR-005. Compare only the three the test controls; nothing else is pending
			// in this organization, but asserting on a filtered slice keeps the failure
			// message about ordering rather than about set membership.
			var got []string
			for _, e := range resp.Entries {
				switch e.EvidenceSubmissionId {
				case subA.Id, subB.Id, subC.Id:
					got = append(got, e.EvidenceSubmissionId)
				}
			}
			assert.Equal(t, []string{subB.Id, subA.Id, subC.Id}, got)
		})

		t.Run("it carries the ritual name, task identifier, project, submitter and age", func(t *testing.T) {
			// FR-003: enough context to judge without opening the task.
			e := reviewQueueEntry(resp, subA.Id)
			require.NotNil(t, e, "the entry should be present")
			assert.Equal(t, "Queue Alpha Ritual", e.RitualName)
			assert.Equal(t, projA.definitionID, e.RitualDefinitionId)
			assert.NotEmpty(t, e.TaskIdentifier)
			assert.Equal(t, projA.taskID, e.TaskId)
			assert.Equal(t, projA.projectID, e.ProjectId)
			assert.Equal(t, "Queue Alpha", e.ProjectName)
			assert.Equal(t, submitter.ID.String(), e.SubmittedByEmployeeId)
			assert.NotEmpty(t, e.SubmittedByDisplayName)
			require.NotNil(t, e.ServerTimestamp, "age is derived from the server timestamp")
			assert.WithinDuration(t, base.Add(1*time.Hour), e.ServerTimestamp.AsTime(), time.Second)
			assert.Equal(t, "Gate note", e.EvidenceRequirementName)
			assert.True(t, e.EvidenceRequirementIsRequired)
			assert.False(t, e.RequirementUnresolved)
		})

		t.Run("it carries the evidence content for each evidence type", func(t *testing.T) {
			// FR-004: the entry carries the evidence itself, not just a pointer to it.
			text := reviewQueueEntry(resp, subA.Id)
			require.NotNil(t, text)
			assert.Equal(t, rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE, text.EvidenceType)
			assert.Equal(t, "alpha gate checked", text.TextContent)

			link := w.submitLinkEvidence(submitter, projA.taskID, projA.requirementID, "https://example.invalid/report")
			gps := w.submitEvidenceWithGPS(submitter, projB.taskID, projB.requirementID, 10.7769, 106.7009, 12.5)
			after := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})

			linkEntry := reviewQueueEntry(after, link.Id)
			require.NotNil(t, linkEntry)
			assert.Equal(t, rpcv1.EvidenceType_EVIDENCE_TYPE_LINK, linkEntry.EvidenceType)
			assert.Equal(t, "https://example.invalid/report", linkEntry.LinkUrl)

			gpsEntry := reviewQueueEntry(after, gps.Id)
			require.NotNil(t, gpsEntry)
			assert.Equal(t, rpcv1.EvidenceType_EVIDENCE_TYPE_GPS_CHECKIN, gpsEntry.EvidenceType)
			require.NotNil(t, gpsEntry.GpsCoordinates)
			assert.InDelta(t, 10.7769, gpsEntry.GpsCoordinates.Latitude, 0.0001)
			assert.InDelta(t, 106.7009, gpsEntry.GpsCoordinates.Longitude, 0.0001)
			assert.InDelta(t, 12.5, gpsEntry.GpsCoordinates.AccuracyMeters, 0.01)

			// Clear them again so later scenarios in this world see a predictable set.
			w.approveEvidence(reviewer, link.Id, "")
			w.approveEvidence(reviewer, gps.Id, "")
		})
	})

	t.Run("when a submission was auto-approved by geofence", func(t *testing.T) {
		// FR-002: geofence auto-approval writes `approved` at submission time, so no
		// decision is outstanding and nothing should queue.
		autoDef := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
			reviewer, projA.projectID, "Auto Approve Ritual", dailyRecurrenceRule(), 8,
			[]string{submitter.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{{
				Name:          "GPS check-in",
				EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_GPS_CHECKIN},
				IsRequired:    true,
				ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_AUTO_APPROVE,
				AutoApproveConfig: &rpcv1.AutoApproveConfig{
					GpsTarget:       &rpcv1.GpsTarget{Latitude: 10.7769, Longitude: 106.7009},
					GpsRadiusMeters: 200,
				},
			}},
		)
		w.generateRitualInstances(reviewer)
		autoTask := w.findRitualInstanceByDefinition(reviewer, projA.projectID, autoDef.Id)
		autoSub := w.submitEvidenceWithGPS(submitter, autoTask, autoDef.EvidenceRequirements[0].Id, 10.7769, 106.7009, 5)

		t.Run("it does not appear in the queue", func(t *testing.T) {
			require.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, autoSub.ApprovalStatus,
				"fixture precondition: the geofence should have auto-approved it")
			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			assert.NotContains(t, reviewQueueSubmissionIDs(resp), autoSub.Id)
		})
	})

	t.Run("when a submission has already been approved or rejected", func(t *testing.T) {
		approved := w.submitTextEvidence(submitter, projC.taskID, projC.requirementID, "will be approved")
		rejected := w.submitTextEvidence(submitter, projC.taskID, projC.requirementID, "will be rejected")
		w.approveEvidence(reviewer, approved.Id, "fine")
		w.rejectEvidence(reviewer, rejected.Id, "not fine")

		t.Run("it does not appear in the queue", func(t *testing.T) {
			// FR-002: the queue is what is outstanding, not a history.
			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			ids := reviewQueueSubmissionIDs(resp)
			assert.NotContains(t, ids, approved.Id)
			assert.NotContains(t, ids, rejected.Id)
		})
	})

	t.Run("when the reviewer has nothing waiting", func(t *testing.T) {
		// FR-008: empty is a state, not a failure. A separate organization, because the
		// outer world deliberately has a backlog.
		empty := newTestWorld(t)
		idle := empty.withOwner()

		t.Run("it returns an empty list and no cursor rather than an error", func(t *testing.T) {
			resp := empty.listEvidenceReviewQueue(idle, &rpcv1.ListEvidenceReviewQueueRequest{})
			assert.Empty(t, resp.Entries)
			assert.Nil(t, resp.NextCursor)
		})
	})

	t.Run("when a pending submission belongs to a project the caller cannot access", func(t *testing.T) {
		// FR-007: absent, not redacted — the membership join is an inner join, so nothing
		// about the submission reaches the response at all.
		outsider := w.withEmployee()

		t.Run("it is absent from the response entirely, not flagged", func(t *testing.T) {
			resp := w.listEvidenceReviewQueue(outsider, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			ids := reviewQueueSubmissionIDs(resp)
			assert.NotContains(t, ids, subA.Id)
			assert.NotContains(t, ids, subB.Id)
			assert.NotContains(t, ids, subC.Id)
		})
	})

	t.Run("when there are more pending submissions than fit one page", func(t *testing.T) {
		// FR-005: the page boundary must be total. A queue that shrinks as the reviewer
		// works through it is exactly where offset pagination skips rows.
		paged := newTestWorld(t)
		pagedReviewer := paged.withOwner()
		pagedSubmitter := paged.withEmployee()
		pagedProj := paged.newReviewQueueProject(pagedReviewer, pagedSubmitter, "Paged", "PG")
		paged.seedPendingSubmissions(pagedReviewer.OrgID, pagedProj, pagedSubmitter, 30,
			time.Now().Add(-30*time.Hour).UTC().Truncate(time.Second))

		t.Run("the next page continues without duplicating or skipping an entry", func(t *testing.T) {
			seen := map[string]bool{}
			var order []string
			var cursor *string
			for page := 0; page < 10; page++ {
				resp := paged.listEvidenceReviewQueue(pagedReviewer, &rpcv1.ListEvidenceReviewQueueRequest{
					PageSize: 7,
					Cursor:   cursor,
				})
				for _, e := range resp.Entries {
					require.False(t, seen[e.EvidenceSubmissionId],
						"submission %s appeared on two pages", e.EvidenceSubmissionId)
					seen[e.EvidenceSubmissionId] = true
					order = append(order, e.EvidenceSubmissionId)
				}
				if resp.NextCursor == nil {
					break
				}
				assert.Len(t, resp.Entries, 7, "a page with a next cursor should be full")
				cursor = resp.NextCursor
			}
			assert.Len(t, order, 30, "every seeded submission should be reached exactly once")
		})
	})

	t.Run("when the caller asks for the pending count", func(t *testing.T) {
		t.Run("it returns the count without fetching the entries", func(t *testing.T) {
			// FR-006: the badge must not require loading the list.
			counted := newTestWorld(t)
			cReviewer := counted.withOwner()
			cSubmitter := counted.withEmployee()
			cProj := counted.newReviewQueueProject(cReviewer, cSubmitter, "Counted", "CT")
			counted.seedPendingSubmissions(cReviewer.OrgID, cProj, cSubmitter, 4,
				time.Now().Add(-4*time.Hour).UTC().Truncate(time.Second))

			resp := counted.getEvidenceReviewQueueCount(cReviewer, nil)
			assert.Equal(t, int32(4), resp.PendingCount)
			assert.False(t, resp.IsCapped)
			// FR-021 / US3-5: the clients hide the entry point entirely when this is
			// false, so a reviewer losing it is a surface disappearing, not a wrong number.
			assert.True(t, resp.CanReview, "a reviewer is told they review")
		})

		t.Run("it caps the count and reports that it was capped", func(t *testing.T) {
			// FR-006 / spec edge case: an unbounded backlog costs the same as a small one.
			big := newTestWorld(t)
			bReviewer := big.withOwner()
			bSubmitter := big.withEmployee()
			bProj := big.newReviewQueueProject(bReviewer, bSubmitter, "Backlog", "BK")
			big.seedPendingSubmissions(bReviewer.OrgID, bProj, bSubmitter, 140,
				time.Now().Add(-200*time.Hour).UTC().Truncate(time.Second))

			resp := big.getEvidenceReviewQueueCount(bReviewer, nil)
			assert.Equal(t, int32(100), resp.PendingCount, "the count stops at the server-side cap")
			assert.True(t, resp.IsCapped)
		})
	})

	t.Run("when a submission's underlying evidence file is unretrievable", func(t *testing.T) {
		broken := w.submitTextEvidence(submitter, projB.taskID, projB.requirementID, "about to lose its file")
		w.breakSubmissionFile(broken.Id)

		t.Run("the entry is still listed and still decidable", func(t *testing.T) {
			// FR-009: a broken upload must not silently clear the queue.
			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			entry := reviewQueueEntry(resp, broken.Id)
			require.NotNil(t, entry, "a submission whose file is gone is still awaiting a decision")
			assert.Equal(t, rpcv1.EvidenceType_EVIDENCE_TYPE_PHOTO, entry.EvidenceType)
			assert.NotEmpty(t, entry.FileId)

			assert.NoError(t, w.rejectEvidenceError(reviewer, broken.Id, "the photo cannot be opened"),
				"the reviewer must be able to reject it on that basis")
		})
	})
}

// findRitualInstanceByDefinition returns the one live instance generated for a definition.
func (w *testWorld) findRitualInstanceByDefinition(actor testUser, projectID, definitionID string) string {
	w.t.Helper()
	instances := w.listTasksWithKind(actor, projectID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	var kept string
	for _, inst := range instances {
		if inst.RitualDefinitionId != definitionID {
			continue
		}
		if kept == "" {
			kept = inst.Id
			continue
		}
		w.detachRitualInstanceFromSweep(inst.Id)
	}
	require.NotEmpty(w.t, kept, fmt.Sprintf("no instance generated for definition %s", definitionID))
	return kept
}

// ---------------------------------------------------------------------------
// TestEvidenceReviewQueueScope — who may see and who may decide (US4)
// ---------------------------------------------------------------------------

func TestEvidenceReviewQueueScope(t *testing.T) {
	t.Parallel()

	t.Run("when the caller lacks the evidence-review permission", func(t *testing.T) {
		// FR-012: an empty queue, not an authorization failure. The permission is revoked
		// org-wide, so this scenario owns its own organization.
		w := newTestWorld(t)
		reviewer := w.withOwner()
		submitter := w.withEmployee()
		proj := w.newReviewQueueProject(reviewer, submitter, "No Permission", "NP")
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "waiting")

		before := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{})
		require.Contains(t, reviewQueueSubmissionIDs(before), sub.Id,
			"fixture precondition: the entry is visible while the permission is held")

		w.revokePermission(reviewer.OrgID, "collab.reviewEvidence")

		t.Run("the queue is empty rather than an authorization failure", func(t *testing.T) {
			require.NoError(t, w.listEvidenceReviewQueueError(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{}),
				"a caller with nothing to review is not a failed request")

			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{})
			assert.Empty(t, resp.Entries)
			assert.Nil(t, resp.NextCursor)

			count := w.getEvidenceReviewQueueCount(reviewer, nil)
			assert.Equal(t, int32(0), count.PendingCount)
			assert.False(t, count.IsCapped)
			// FR-012 / US3-4: zero alone cannot distinguish "not a reviewer" from "a
			// reviewer who is up to date". This flag is what lets the client hide the
			// entry point for the first and say "nothing to review" for the second.
			assert.False(t, count.CanReview, "a non-reviewer is not offered the queue")
		})
	})

	t.Run("when the caller's only role on the project is viewer", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		submitter := w.withEmployee()
		viewer := w.withEmployee()
		proj := w.newReviewQueueProject(owner, submitter, "Viewer Scope", "VS")
		w.addProjectMember(owner, proj.projectID, viewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER)
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "viewer must not decide this")

		t.Run("the project's submissions do not appear", func(t *testing.T) {
			// FR-010: viewer is read access, not decide rights.
			resp := w.listEvidenceReviewQueue(viewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			assert.NotContains(t, reviewQueueSubmissionIDs(resp), sub.Id)
		})

		t.Run("a decision on one of them is refused", func(t *testing.T) {
			// FR-011: the actions agree with the query, even by direct id.
			err := w.approveEvidenceError(viewer, sub.Id, "")
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			assert.Equal(t, "pending_review", w.evidenceApprovalStatus(sub.Id))
		})
	})

	t.Run("when the caller is not a member of the submission's private project", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		submitter := w.withEmployee()
		outsider := w.withEmployee()

		// A private project the outsider has no membership row on at all.
		proj := w.createProjectWithMode(owner, "Private Scope", uniqueProjectKey("PS"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		w.setProjectVisibility(proj.ID, "private")
		w.addProjectMember(owner, proj.ID, submitter.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		def := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
			owner, proj.ID, "Private Ritual", dailyRecurrenceRule(), 8,
			[]string{submitter.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{{
				Name:          "Private note",
				EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
				IsRequired:    true,
				ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
			}},
		)
		w.generateRitualInstances(owner)
		taskID := w.findRitualInstanceByDefinition(owner, proj.ID, def.Id)

		approveTarget := w.submitTextEvidence(submitter, taskID, def.EvidenceRequirements[0].Id, "approve target")
		rejectTarget := w.submitTextEvidence(submitter, taskID, def.EvidenceRequirements[0].Id, "reject target")

		t.Run("approving it by identifier is refused and the status is unchanged", func(t *testing.T) {
			err := w.approveEvidenceError(outsider, approveTarget.Id, "")
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			assert.Equal(t, "pending_review", w.evidenceApprovalStatus(approveTarget.Id))
		})

		t.Run("rejecting it by identifier is refused and the status is unchanged", func(t *testing.T) {
			err := w.rejectEvidenceError(outsider, rejectTarget.Id, "not my call to make")
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			assert.Equal(t, "pending_review", w.evidenceApprovalStatus(rejectTarget.Id))
		})

		t.Run("the refusal discloses nothing about the project or the task", func(t *testing.T) {
			// FR-007: the refusal must not confirm the project exists or name the work.
			err := w.approveEvidenceError(outsider, approveTarget.Id, "")
			require.Error(t, err)

			var cErr *connect.Error
			require.True(t, errors.As(err, &cErr))
			assert.Empty(t, cErr.Details(), "a scope refusal carries no error detail")

			leaks := []string{proj.ID, "Private Scope", "Private Ritual", "Private note", taskID}
			for _, leak := range leaks {
				assert.NotContains(t, cErr.Message(), leak,
					"the refusal must not name %q", leak)
			}
		})
	})

	t.Run("when the caller's membership is removed after the queue was loaded", func(t *testing.T) {
		// FR-010: reviewer scope is evaluated per call, never cached, so a revoked
		// membership takes effect on the very next request.
		w := newTestWorld(t)
		owner := w.withOwner()
		submitter := w.withEmployee()
		reviewer := w.withEmployee()
		proj := w.newReviewQueueProject(owner, submitter, "Revoked", "RV")
		w.addProjectMember(owner, proj.projectID, reviewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "loaded before revocation")

		loaded := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
		require.Contains(t, reviewQueueSubmissionIDs(loaded), sub.Id)

		w.removeProjectMember(owner, proj.projectID, reviewer.ID)

		t.Run("the action is refused and the entry is gone on the next fetch", func(t *testing.T) {
			err := w.approveEvidenceError(reviewer, sub.Id, "")
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			assert.Equal(t, "pending_review", w.evidenceApprovalStatus(sub.Id))

			after := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			assert.NotContains(t, reviewQueueSubmissionIDs(after), sub.Id)
		})
	})

	t.Run("for every seeded project role", func(t *testing.T) {
		// The US4 goal stated as one assertion: the set the queue lists and the set the
		// actions accept are the same set. Anything listed that would be refused is a
		// dead-end action; anything accepted that is hidden is an invisible power.
		w := newTestWorld(t)
		owner := w.withOwner()
		submitter := w.withEmployee()
		subject := w.withEmployee()

		roles := []struct {
			name    string
			role    rpcv1.ProjectMemberRole
			member  bool
			canSee  bool
			project reviewQueueProject
		}{
			{name: "owner", role: rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_OWNER, member: true, canSee: true},
			{name: "admin", role: rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN, member: true, canSee: true},
			{name: "member", role: rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER, member: true, canSee: true},
			{name: "viewer", role: rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER, member: true, canSee: false},
			{name: "non-member", member: false, canSee: false},
		}

		submissions := make(map[string]string, len(roles))
		for i := range roles {
			r := &roles[i]
			r.project = w.newReviewQueueProject(owner, submitter, "Role "+r.name, "RL")
			if r.member {
				w.addProjectMember(owner, r.project.projectID, subject.ID, r.role)
			}
			sub := w.submitTextEvidence(submitter, r.project.taskID, r.project.requirementID, "role probe "+r.name)
			submissions[r.name] = sub.Id
		}

		t.Run("the queue lists exactly the submissions the decision actions accept", func(t *testing.T) {
			listed := map[string]bool{}
			for _, id := range reviewQueueSubmissionIDs(
				w.listEvidenceReviewQueue(subject, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100}),
			) {
				listed[id] = true
			}

			for _, r := range roles {
				id := submissions[r.name]
				assert.Equal(t, r.canSee, listed[id], "role %s: queue visibility", r.name)

				err := w.approveEvidenceError(subject, id, "")
				if r.canSee {
					assert.NoError(t, err, "role %s: a listed entry must be decidable", r.name)
				} else {
					assert.Error(t, err, "role %s: a hidden entry must not be decidable", r.name)
					assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err),
						"role %s: refusal code", r.name)
				}
			}
		})
	})

	t.Run("when the project is public and the caller has no membership row", func(t *testing.T) {
		// research.md R1: public visibility is a read affordance equivalent to viewer, so
		// it satisfies neither the queue's membership join nor the decision's scope check.
		// Without this, the tightening would be cosmetic for the commonest project type.
		w := newTestWorld(t)
		owner := w.withOwner()
		submitter := w.withEmployee()
		bystander := w.withEmployee()
		proj := w.newReviewQueueProject(owner, submitter, "Public Scope", "PU")
		w.setProjectVisibility(proj.projectID, "public")
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "public project probe")

		t.Run("the submission is neither listed nor decidable", func(t *testing.T) {
			resp := w.listEvidenceReviewQueue(bystander, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			assert.NotContains(t, reviewQueueSubmissionIDs(resp), sub.Id)

			err := w.approveEvidenceError(bystander, sub.Id, "")
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
			assert.Equal(t, "pending_review", w.evidenceApprovalStatus(sub.Id))
		})
	})
}

// ---------------------------------------------------------------------------
// TestEvidenceDecisionFromQueue — deciding, and what a decision costs (US2)
// ---------------------------------------------------------------------------

func TestEvidenceDecisionFromQueue(t *testing.T) {
	t.Parallel()

	t.Run("when a reviewer approves a pending submission", func(t *testing.T) {
		w := newTestWorld(t)
		reviewer := w.withOwner()
		submitter := w.withEmployee()
		proj := w.newReviewQueueProject(reviewer, submitter, "Approve Path", "AP")
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "gate checked")

		before := len(w.listNotifications(submitter, false))
		decided := w.approveEvidence(reviewer, sub.Id, "clear photo, thanks")

		t.Run("the submission records the reviewer, the decision time and the comment", func(t *testing.T) {
			// FR-013, FR-019: who decided and when is the audit trail.
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, decided.ApprovalStatus)
			assert.Equal(t, reviewer.ID.String(), decided.ReviewedByEmployeeId)
			require.NotNil(t, decided.ReviewedAt)
			assert.WithinDuration(t, time.Now(), decided.ReviewedAt.AsTime(), time.Minute)
			assert.Equal(t, "clear photo, thanks", decided.ReviewerComment)
		})

		t.Run("the submitter is notified", func(t *testing.T) {
			// FR-016: guaranteed, not incidental on holding a task subscription.
			notifs := w.waitForNotificationCountIncreaseAndStable(submitter, false, before, 500*time.Millisecond, 15*time.Second)
			approved := filterNotifsByType(notifs, "evidence_approved")
			require.NotEmpty(t, approved, "the submitter should receive the approval notification")
			// The body must name the task. It used to read literally
			// "Evidence has been approved for: " with nothing after the colon.
			assert.Regexp(t, `approved for: \S`, approved[0].Message,
				"the notification body should name the task, not trail off after the colon")
		})

		t.Run("the entry no longer appears in the queue", func(t *testing.T) {
			// FR-017.
			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			assert.NotContains(t, reviewQueueSubmissionIDs(resp), sub.Id)
		})
	})

	t.Run("when a reviewer rejects with a reason", func(t *testing.T) {
		w := newTestWorld(t)
		reviewer := w.withOwner()
		submitter := w.withEmployee()
		proj := w.newReviewQueueProject(reviewer, submitter, "Reject Path", "RP")
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "blurry")

		before := len(w.listNotifications(submitter, false))
		w.rejectEvidence(reviewer, sub.Id, "The gate number is not readable")

		t.Run("the reason reaches the submitter with the rejection notification", func(t *testing.T) {
			// FR-014: a reason that stops at the database is not a reason.
			notifs := w.waitForNotificationCountIncreaseAndStable(submitter, false, before, 500*time.Millisecond, 15*time.Second)
			rejected := filterNotifsByType(notifs, "evidence_rejected")
			require.NotEmpty(t, rejected, "the submitter should receive the rejection notification")
			assert.Contains(t, rejected[0].Message, "The gate number is not readable")
		})
	})

	t.Run("when a reviewer rejects with a whitespace-only reason", func(t *testing.T) {
		w := newTestWorld(t)
		reviewer := w.withOwner()
		submitter := w.withEmployee()
		proj := w.newReviewQueueProject(reviewer, submitter, "Blank Reason", "BR")
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "pending")

		t.Run("the rejection is refused and the submission stays pending", func(t *testing.T) {
			err := w.rejectEvidenceError(reviewer, sub.Id, "   \t \n ")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))

			var cErr *connect.Error
			require.True(t, errors.As(err, &cErr))
			assert.NotEmpty(t, cErr.Details(), "the refusal names the field the reviewer got wrong")

			assert.Equal(t, "pending_review", w.evidenceApprovalStatus(sub.Id))
			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			assert.Contains(t, reviewQueueSubmissionIDs(resp), sub.Id,
				"a refused rejection leaves the entry in the queue")
		})
	})

	t.Run("when the approved submission was the instance's last outstanding requirement", func(t *testing.T) {
		// US2-3: verified follows from the evidence picture changing, with no extra step
		// and nothing queue-specific about it.
		w := newTestWorld(t)
		reviewer := w.withOwner()
		submitter := w.withEmployee()
		proj := w.newReviewQueueProject(reviewer, submitter, "Last Requirement", "LR")
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "the only requirement")

		w.approveEvidence(reviewer, sub.Id, "")

		t.Run("the ritual instance becomes verified without further action", func(t *testing.T) {
			assert.Equal(t, "verified", w.ritualStateCategory(proj.taskID))
		})
	})

	t.Run("when a submission on an overdue instance is rejected", func(t *testing.T) {
		w := newTestWorld(t)
		reviewer := w.withOwner()
		submitter := w.withEmployee()
		proj := w.newLateableReviewQueueProject(reviewer, submitter, "Overdue Reject", "OR")
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "late and wrong")

		// Push the instance past its deadline and reconcile, so it is genuinely overdue
		// rather than merely backdated.
		w.setRitualDeadline(proj.taskID, time.Now().Add(-2*time.Hour))
		w.reconcileOrganizationAt(reviewer, time.Now())
		require.Equal(t, "overdue", w.ritualStateCategory(proj.taskID),
			"fixture precondition: the instance is overdue before the decision")

		w.rejectEvidence(reviewer, sub.Id, "Retake the photo")
		after := w.ritualStateCategory(proj.taskID)

		t.Run("the instance state re-derives by the existing rules", func(t *testing.T) {
			// US2-4: the same rules the task detail path uses, unchanged.
			assert.Contains(t, []string{"overdue", "in_progress", "todo"}, after,
				"a rejection re-derives from the evidence picture, it does not pick a state")
		})

		t.Run("the instance does not become terminal as a side effect of the review", func(t *testing.T) {
			// `missed` needs the full grace window to have elapsed; a rejection does not
			// advance the clock, and `verified` needs the required set approved.
			assert.NotEqual(t, "missed", after)
			assert.NotEqual(t, "verified", after)
		})
	})

	t.Run("when two reviewers decide the same submission concurrently", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		submitter := w.withEmployee()
		second := w.withEmployee()
		proj := w.newReviewQueueProject(owner, submitter, "Race", "RC")
		w.addProjectMember(owner, proj.projectID, second.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "two reviewers want this")

		// Both decisions are fired at once. Which one wins is the database's business; that
		// exactly one wins and the loser is told why is the contract.
		type outcome struct {
			actor testUser
			err   error
		}
		results := make(chan outcome, 2)
		start := make(chan struct{})
		go func() {
			<-start
			results <- outcome{owner, w.approveEvidenceError(owner, sub.Id, "owner approves")}
		}()
		go func() {
			<-start
			results <- outcome{second, w.rejectEvidenceError(second, sub.Id, "second reviewer rejects")}
		}()
		close(start)
		first, secondResult := <-results, <-results

		winners := 0
		var loserErr error
		for _, r := range []outcome{first, secondResult} {
			if r.err == nil {
				winners++
			} else {
				loserErr = r.err
			}
		}

		t.Run("exactly one decision is recorded", func(t *testing.T) {
			// FR-015.
			assert.Equal(t, 1, winners, "exactly one of the two decisions should succeed")
			assert.Contains(t, []string{"approved", "rejected"}, w.evidenceApprovalStatus(sub.Id))
		})

		t.Run("the loser is told it was already decided and by whom", func(t *testing.T) {
			// FR-015, SC-008: a bare failure would be indistinguishable from a bug.
			require.Error(t, loserErr)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(loserErr))

			var cErr *connect.Error
			require.True(t, errors.As(loserErr, &cErr))
			require.NotEmpty(t, cErr.Details(), "the refusal carries who decided it and when")
		})

		t.Run("the first decision is not overwritten", func(t *testing.T) {
			status := w.evidenceApprovalStatus(sub.Id)
			// Re-deciding after the fact must also be refused, not applied.
			assert.Error(t, w.approveEvidenceError(owner, sub.Id, "second thoughts"))
			assert.Equal(t, status, w.evidenceApprovalStatus(sub.Id))
		})
	})

	t.Run("when a decision fails partway", func(t *testing.T) {
		// FR-018: the decision, the state re-derivation and the notification share one
		// transaction, so a failure after the update still leaves the row pending.
		// Removing the project's ritual state rows makes reconciliation — step 6 — fail
		// after the compare-and-set has already written.
		w := newTestWorld(t)
		reviewer := w.withOwner()
		submitter := w.withEmployee()
		proj := w.newReviewQueueProject(reviewer, submitter, "Partial", "PT")
		sub := w.submitTextEvidence(submitter, proj.taskID, proj.requirementID, "will fail to land")

		w.failTaskUpdates(proj.taskID)

		t.Run("no partial state is recorded and the submission stays pending", func(t *testing.T) {
			err := w.approveEvidenceError(reviewer, sub.Id, "")
			require.Error(t, err, "the state re-derivation cannot succeed")

			// The compare-and-set had already written `approved` before the failure. If the
			// decision and the state re-derivation were not one transaction, the submission
			// would now be approved on an instance whose state never moved.
			assert.Equal(t, "pending_review", w.evidenceApprovalStatus(sub.Id),
				"the whole transaction rolled back, including the decision")

			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			assert.Contains(t, reviewQueueSubmissionIDs(resp), sub.Id,
				"the entry returns to the queue for another attempt")
		})
	})

	t.Run("when the same decision is made from the task detail path and from the queue", func(t *testing.T) {
		// SC-007, FR-016: there is only one decision path, so "both" here means the same
		// RPC reached from two surfaces. The proof is that the queue's approve is
		// indistinguishable in effect from the task detail view's.
		w := newTestWorld(t)
		reviewer := w.withOwner()
		submitter := w.withEmployee()

		viaTask := w.newReviewQueueProject(reviewer, submitter, "Via Task", "VT")
		viaQueue := w.newReviewQueueProject(reviewer, submitter, "Via Queue", "VQ")

		taskSub := w.submitTextEvidence(submitter, viaTask.taskID, viaTask.requirementID, "decided from task detail")
		queueSub := w.submitTextEvidence(submitter, viaQueue.taskID, viaQueue.requirementID, "decided from the queue")

		// The queue path reads the entry first, exactly as the surface does; the task path
		// goes straight to the id it already has on screen.
		queueEntry := reviewQueueEntry(
			w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100}),
			queueSub.Id,
		)
		require.NotNil(t, queueEntry)

		before := len(w.listNotifications(submitter, false))
		fromTask := w.approveEvidence(reviewer, taskSub.Id, "")
		fromQueue := w.approveEvidence(reviewer, queueEntry.EvidenceSubmissionId, "")

		t.Run("both produce the same submitter notification", func(t *testing.T) {
			notifs := w.waitForNotificationCountIncreaseAndStable(submitter, false, before, 500*time.Millisecond, 15*time.Second)
			approved := filterNotifsByType(notifs, "evidence_approved")
			require.GreaterOrEqual(t, len(approved), 2, "both decisions notify the submitter")
			assert.Equal(t, approved[0].Title, approved[1].Title,
				"the same decision from two surfaces produces the same notification")
		})

		t.Run("both produce the same resulting ritual instance state", func(t *testing.T) {
			assert.Equal(t, fromTask.ApprovalStatus, fromQueue.ApprovalStatus)
			assert.Equal(t, w.ritualStateCategory(viaTask.taskID), w.ritualStateCategory(viaQueue.taskID))
		})
	})

	t.Run("when a submitter decides their own submission holding the review permission", func(t *testing.T) {
		// FR-019 / spec edge case: permitted, but recorded. Self-approval is visible in the
		// audit trail rather than prevented invisibly, and notifies nobody because actor
		// exclusion still applies.
		w := newTestWorld(t)
		owner := w.withOwner()
		proj := w.newReviewQueueProject(owner, owner, "Self Decide", "SD")
		sub := w.submitTextEvidence(owner, proj.taskID, proj.requirementID, "my own evidence")

		before := len(w.listNotifications(owner, false))
		decided := w.approveEvidence(owner, sub.Id, "")

		t.Run("the decision is recorded against them and is visible in the audit trail", func(t *testing.T) {
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, decided.ApprovalStatus)
			assert.Equal(t, owner.ID.String(), decided.ReviewedByEmployeeId)
			require.NotNil(t, decided.ReviewedAt)

			after := w.waitForNotificationCountStable(owner, false, 500*time.Millisecond, 5*time.Second)
			assert.Equal(t, before, len(after),
				"a reviewer approving their own submission notifies nobody")
		})
	})
}

// ---------------------------------------------------------------------------
// TestEvidenceReviewQueueUrgency — what is actually outstanding (US5)
// ---------------------------------------------------------------------------

func TestEvidenceReviewQueueUrgency(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	reviewer := w.withOwner()
	submitter := w.withEmployee()

	onTime := w.newReviewQueueProject(reviewer, submitter, "On Time", "OT")
	late := w.newLateableReviewQueueProject(reviewer, submitter, "Late", "LT")

	// The on-time submission is deliberately the OLDER of the two. Ordered by age alone it
	// would come first; the late bucket has to override that.
	onTimeSub := w.submitTextEvidence(submitter, onTime.taskID, onTime.requirementID, "submitted on time")
	lateSub := w.submitTextEvidence(submitter, late.taskID, late.requirementID, "submitted late")
	base := time.Now().Add(-8 * time.Hour).UTC().Truncate(time.Second)
	w.setSubmissionServerTimestamp(onTimeSub.Id, base)
	w.setSubmissionServerTimestamp(lateSub.Id, base.Add(4*time.Hour))

	w.setRitualDeadline(late.taskID, time.Now().Add(-2*time.Hour))
	w.reconcileOrganizationAt(reviewer, time.Now())

	t.Run("when a pending submission's instance is overdue", func(t *testing.T) {
		require.Equal(t, "overdue", w.ritualStateCategory(late.taskID),
			"fixture precondition: the instance is overdue")
		resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})

		t.Run("the entry is marked late and sorts above entries that are not late", func(t *testing.T) {
			// FR-005, US5-1.
			lateEntry := reviewQueueEntry(resp, lateSub.Id)
			onTimeEntry := reviewQueueEntry(resp, onTimeSub.Id)
			require.NotNil(t, lateEntry)
			require.NotNil(t, onTimeEntry)

			assert.Equal(t, rpcv1.ReviewUrgency_REVIEW_URGENCY_LATE, lateEntry.Urgency)
			assert.Equal(t, "overdue", lateEntry.InstanceStateCategory)
			assert.Equal(t, rpcv1.ReviewUrgency_REVIEW_URGENCY_NORMAL, onTimeEntry.Urgency)

			ids := reviewQueueSubmissionIDs(resp)
			assert.Less(t, reviewQueuePosition(ids, lateSub.Id), reviewQueuePosition(ids, onTimeSub.Id),
				"the late entry sorts first even though it is the newer submission")
		})
	})

	t.Run("when a pending submission's instance has become missed", func(t *testing.T) {
		// US5-2: missed is terminal for the instance, but the submitter is still waiting
		// on an answer. Hiding the row would leave a permanently pending submission
		// invisible to everyone.
		missed := w.newLateableReviewQueueProject(reviewer, submitter, "Missed", "MS")
		missedSub := w.submitTextEvidence(submitter, missed.taskID, missed.requirementID, "instance already missed")
		w.setRitualDeadline(missed.taskID, time.Now().Add(-96*time.Hour))
		w.reconcileOrganizationAt(reviewer, time.Now())
		require.Equal(t, "missed", w.ritualStateCategory(missed.taskID),
			"fixture precondition: the instance is missed")

		t.Run("the entry still appears, marked as belonging to a missed instance", func(t *testing.T) {
			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			entry := reviewQueueEntry(resp, missedSub.Id)
			require.NotNil(t, entry, "a missed instance's pending submission is still outstanding")
			assert.Equal(t, "missed", entry.InstanceStateCategory)
			assert.Equal(t, rpcv1.ReviewUrgency_REVIEW_URGENCY_LATE, entry.Urgency)
		})
	})

	t.Run("when a submission's task is deleted or detached from its ritual", func(t *testing.T) {
		// US5-3: neither is work anyone is still waiting on.
		deleted := w.newReviewQueueProject(reviewer, submitter, "Deleted", "DL")
		detached := w.newReviewQueueProject(reviewer, submitter, "Detached", "DT")
		deletedSub := w.submitTextEvidence(submitter, deleted.taskID, deleted.requirementID, "task about to be deleted")
		detachedSub := w.submitTextEvidence(submitter, detached.taskID, detached.requirementID, "task about to be detached")

		require.Contains(t,
			reviewQueueSubmissionIDs(w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})),
			deletedSub.Id, "fixture precondition: both are listed to begin with")

		w.softDeleteTaskDirect(deleted.taskID)
		w.detachRitualInstanceFromSweep(detached.taskID)

		t.Run("the entry does not appear", func(t *testing.T) {
			ids := reviewQueueSubmissionIDs(w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100}))
			assert.NotContains(t, ids, deletedSub.Id)
			assert.NotContains(t, ids, detachedSub.Id)
		})
	})

	t.Run("when a submission's ritual definition has been archived", func(t *testing.T) {
		// Spec edge case: archiving stops new instances; it does not retract the answer a
		// submitter is still owed on the instances that already ran.
		archived := w.newReviewQueueProject(reviewer, submitter, "Archived", "AR")
		archivedSub := w.submitTextEvidence(submitter, archived.taskID, archived.requirementID, "definition about to be archived")
		_, err := w.archiveRitualDefinition(reviewer, archived.definitionID, true)
		require.NoError(t, err)

		t.Run("the entry still appears", func(t *testing.T) {
			resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{PageSize: 100})
			entry := reviewQueueEntry(resp, archivedSub.Id)
			require.NotNil(t, entry, "an archived definition does not retire outstanding submissions")
			assert.Equal(t, "Archived Ritual", entry.RitualName)
		})
	})
}

// softDeleteTaskDirect soft-deletes a ritual instance. DeleteTask on a ritual instance is
// not the same operation, and the queue's predicate reads is_deleted directly.
func (w *testWorld) softDeleteTaskDirect(taskID string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.task SET is_deleted = TRUE WHERE id = $1`,
		dbuuid.MustParse(taskID))
	require.NoError(w.t, err)
}

// reviewQueuePosition reports where a submission sits in the returned order, or -1.
// Ordering assertions read better as a comparison of positions than as a loop per test.
func reviewQueuePosition(ids []string, id string) int {
	for i, candidate := range ids {
		if candidate == id {
			return i
		}
	}
	return -1
}

// ---------------------------------------------------------------------------
// SC-005: the queue stays usable at the backlog it is meant for
// ---------------------------------------------------------------------------

// newReviewQueueProjectsBulk builds n ritual projects the reviewer owns, generating ritual
// instances once at the end rather than per project.
//
// newReviewQueueProject calls GenerateRitualInstances itself, which sweeps every definition
// in the organization — doing that 50 times is quadratic and would make this test measure
// the arrangement rather than the query. Surplus instances are also left attached here,
// because the queue lists submissions: an instance that never receives one cannot appear.
func (w *testWorld) newReviewQueueProjectsBulk(owner testUser, n int, keyPrefix string) []reviewQueueProject {
	w.t.Helper()

	type pending struct {
		projectID     string
		definitionID  string
		requirementID string
	}

	staged := make([]pending, 0, n)
	for i := 0; i < n; i++ {
		name := fmt.Sprintf("%s Load %d", keyPrefix, i)
		proj := w.createProjectWithMode(owner, name, uniqueProjectKey(keyPrefix),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

		def := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
			owner, proj.ID, name+" Ritual", dailyRecurrenceRule(), 8,
			[]string{owner.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{{
				Name:          "Gate note",
				EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
				IsRequired:    true,
				ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
			}},
		)
		require.NotEmpty(w.t, def.EvidenceRequirements)
		staged = append(staged, pending{proj.ID, def.Id, def.EvidenceRequirements[0].Id})
	}

	w.generateRitualInstances(owner)

	projects := make([]reviewQueueProject, 0, n)
	for _, s := range staged {
		instances := w.listTasksWithKind(owner, s.projectID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		require.NotEmpty(w.t, instances, "expected each definition to generate an instance")
		projects = append(projects, reviewQueueProject{
			projectID:     s.projectID,
			definitionID:  s.definitionID,
			requirementID: s.requirementID,
			taskID:        instances[0].Id,
		})
	}

	return projects
}

// percentile returns the p'th percentile of durations, nearest-rank. With 20 samples p95 is
// the 19th, so one slow outlier is tolerated and two are not — which is the point of
// measuring a percentile rather than a mean.
func percentile(samples []time.Duration, p float64) time.Duration {
	sorted := append([]time.Duration(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	rank := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	if rank < 0 {
		rank = 0
	}
	if rank >= len(sorted) {
		rank = len(sorted) - 1
	}
	return sorted[rank]
}

// TestEvidenceReviewQueuePerformance is SC-005: a reviewer holding 500 pending submissions
// across 50 projects gets their first page in under 2 s, and the badge count returns
// without paying for the entries.
//
// It is a real assertion rather than a benchmark because the failure it guards against is a
// regression in the query plan — a lost index, a join that stops being composite, a count
// that stops being bounded — and those should break the build, not a chart someone reads
// later. The threshold is generous on purpose: it is a usability floor, not a target, so it
// does not flake on a loaded CI box while still catching a plan that went quadratic.
func TestEvidenceReviewQueuePerformance(t *testing.T) {
	if testing.Short() {
		t.Skip("SC-005 seeds 50 projects; skipped under -short")
	}

	t.Parallel()
	w := newTestWorld(t)
	reviewer := w.withOwner()
	submitter := w.withEmployee()

	const projectCount = 50
	const perProject = 10 // 50 × 10 = the 500 pending submissions SC-005 names

	projects := w.newReviewQueueProjectsBulk(reviewer, projectCount, "PERF")

	base := time.Now().Add(-30 * 24 * time.Hour).UTC().Truncate(time.Second)
	for i, p := range projects {
		w.addProjectMember(reviewer, p.projectID, submitter.ID,
			rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.seedPendingSubmissions(reviewer.OrgID, p, submitter, perProject,
			base.Add(time.Duration(i)*time.Hour))
	}

	t.Run("when a reviewer holds 500 pending submissions across 50 projects", func(t *testing.T) {
		// One warm-up outside the measurement so the first page is not paying for
		// connection setup and plan caching that a real reviewer's session already did.
		first := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{})
		require.Len(t, first.Entries, 25, "the default page is 25 entries")
		require.NotEmpty(t, first.NextCursor, "500 pending submissions must not fit one page")

		t.Run("the first page returns in under 2 s at p95", func(t *testing.T) {
			// SC-005.
			samples := make([]time.Duration, 0, 20)
			for i := 0; i < 20; i++ {
				started := time.Now()
				resp := w.listEvidenceReviewQueue(reviewer, &rpcv1.ListEvidenceReviewQueueRequest{})
				samples = append(samples, time.Since(started))
				require.Len(t, resp.Entries, 25)
			}

			p95 := percentile(samples, 95)
			assert.Less(t, p95, 2*time.Second,
				"first queue page p95 was %s over %d samples", p95, len(samples))
			t.Logf("ListEvidenceReviewQueue first page: p50=%s p95=%s", percentile(samples, 50), p95)
		})

		t.Run("the badge count returns independently of the entries", func(t *testing.T) {
			// SC-005: the badge is rendered on a screen that is not the queue, so it must
			// not be paid for by fetching a page. The count is bounded at 100, which is
			// what makes an unbounded backlog cost the same as a small one.
			samples := make([]time.Duration, 0, 20)
			var last *rpcv1.GetEvidenceReviewQueueCountResponse
			for i := 0; i < 20; i++ {
				started := time.Now()
				last = w.getEvidenceReviewQueueCount(reviewer, nil)
				samples = append(samples, time.Since(started))
			}

			require.NotNil(t, last)
			assert.True(t, last.IsCapped, "500 pending submissions must report the count as capped")
			assert.Equal(t, int32(100), last.PendingCount, "the count is bounded at 100")
			assert.True(t, last.CanReview)

			p95 := percentile(samples, 95)
			assert.Less(t, p95, 2*time.Second,
				"badge count p95 was %s over %d samples", p95, len(samples))
			t.Logf("GetEvidenceReviewQueueCount: p50=%s p95=%s", percentile(samples, 50), p95)
		})

		t.Run("paging to the end of the backlog neither duplicates nor skips an entry", func(t *testing.T) {
			// The cursor has to stay total across 500 rows, not just across one boundary.
			seen := map[string]bool{}
			cursor := ""
			pages := 0
			for {
				msg := &rpcv1.ListEvidenceReviewQueueRequest{}
				if cursor != "" {
					msg.Cursor = &cursor
				}
				resp := w.listEvidenceReviewQueue(reviewer, msg)
				for _, entry := range resp.Entries {
					require.False(t, seen[entry.EvidenceSubmissionId],
						"submission %s returned on two pages", entry.EvidenceSubmissionId)
					seen[entry.EvidenceSubmissionId] = true
				}
				pages++
				require.Less(t, pages, 40, "paging did not terminate")
				if resp.NextCursor == nil || *resp.NextCursor == "" {
					break
				}
				cursor = *resp.NextCursor
			}

			assert.Equal(t, projectCount*perProject, len(seen),
				"every seeded submission should be reachable by paging exactly once")
		})
	})
}
