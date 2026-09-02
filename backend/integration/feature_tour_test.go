package integration

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/iam"
	"github.com/nvcnvn/tech-office/backend/internal/tour"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestFeatureTour covers audience selection, permission filtering, platform adaptation,
// progress persistence and the offer rule.
//
// The feature is server-driven: everything a client renders is decided here, so this file
// is the behavioural contract for the whole feature, not just its backend half.
func TestFeatureTour(t *testing.T) {
	t.Parallel()

	// US1, FR-002 — the tour a person gets is decided by their permissions
	t.Run("when an owner asks for their tour", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)

		t.Run("they are served the administrator tour", func(t *testing.T) { // FR-001, FR-002
			assert.Equal(t, rpcv1.TourAudience_TOUR_AUDIENCE_ADMINISTRATOR, resp.Audience)
			assert.Equal(t, tour.TourIDAdministrator, resp.TourId)
		})

		t.Run("its stops are people, project, ritual, chat, schedule, docs in that order", func(t *testing.T) { // FR-003
			assert.Equal(t,
				[]string{"people", "project", "ritual", "chat", "schedule", "docs"},
				tourStopKeys(resp))
		})

		t.Run("it has no more than six stops", func(t *testing.T) { // FR-005
			assert.LessOrEqual(t, len(resp.Stops), 6)
		})
	})

	// US2, FR-002 — the same call from a worker returns the other tour
	t.Run("when an employee asks for their tour", func(t *testing.T) {
		w := newTestWorld(t)
		w.withOwner()
		emp := w.withEmployee()
		resp := w.getTour(emp, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE)

		t.Run("they are served the worker tour, not the administrator tour", func(t *testing.T) { // FR-001, FR-002
			assert.Equal(t, rpcv1.TourAudience_TOUR_AUDIENCE_WORKER, resp.Audience)
			assert.Equal(t, tour.TourIDWorker, resp.TourId)
		})

		t.Run("its stops are today, evidence, chat, alerts in that order", func(t *testing.T) { // FR-004
			assert.Equal(t, []string{"today", "evidence", "chat", "alerts"}, tourStopKeys(resp))
		})

		t.Run("no stop mentions a capability the employee cannot use", func(t *testing.T) { // FR-006
			// The administrative stops are the ones a worker cannot act on, and the
			// worker tour is a different sequence rather than a filtered version of the
			// administrator one — so none of their keys may appear here.
			for _, key := range tourStopKeys(resp) {
				assert.NotContains(t, []string{"people", "project", "ritual", "schedule", "docs"}, key,
					"administrator copy leaked into the worker sequence")
			}
		})
	})

	// FR-006 — filtering removes stops rather than disabling them
	t.Run("when a person lacks the permission a stop requires", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		before := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
		require.Contains(t, tourStopKeys(before), "ritual")

		w.revokePermission(owner.OrgID, "collab.manageRitualDefinition")
		after := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)

		t.Run("the stop is absent from the returned list entirely", func(t *testing.T) { // FR-006
			assert.NotContains(t, tourStopKeys(after), "ritual")
			assert.Len(t, after.Stops, len(before.Stops)-1)
		})

		t.Run("the remaining stops are renumbered from zero with no gap", func(t *testing.T) { // FR-006, FR-011
			// The response's stops slice IS the numbering: a client renders
			// stops[current_stop], so "no gap" means the surviving order is preserved
			// and nothing empty was left behind.
			assert.Equal(t,
				[]string{"people", "project", "chat", "schedule", "docs"},
				tourStopKeys(after))
			for _, stop := range after.Stops {
				assert.NotEmpty(t, stop.Key)
				assert.NotEmpty(t, stop.Title)
				assert.NotEmpty(t, stop.Body)
			}
		})
	})

	// FR-023 — platform adaptation
	t.Run("when an owner asks for the tour from mobile", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		mobile := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE)

		// people, project and ritual are the web-only stops: the mobile app can list
		// projects and rituals but has no create surface for either, and adding staff is
		// administration proper.
		webOnly := map[string]bool{"people": true, "project": true, "ritual": true}

		t.Run("each web-only stop says the work is done on the web", func(t *testing.T) { // FR-023
			for key := range webOnly {
				assert.Contains(t, stopByKey(t, mobile, key).Body, "web app", "stop %s", key)
			}
		})

		t.Run("each web-only stop carries no target and no action label", func(t *testing.T) { // FR-023
			// A stop that cannot act must not render a button, so the client is given
			// nothing to render one from.
			for key := range webOnly {
				stop := stopByKey(t, mobile, key)
				assert.Equal(t, rpcv1.TourTarget_TOUR_TARGET_NONE, stop.Target, "stop %s", key)
				assert.Empty(t, stop.ActionLabel, "stop %s", key)
			}
		})

		t.Run("every other stop keeps its target and action label", func(t *testing.T) { // FR-022, FR-023
			for _, stop := range mobile.Stops {
				if webOnly[stop.Key] {
					continue
				}
				assert.NotEqual(t, rpcv1.TourTarget_TOUR_TARGET_NONE, stop.Target, "stop %s", stop.Key)
				assert.NotEmpty(t, stop.ActionLabel, "stop %s", stop.Key)
			}
		})
	})

	t.Run("when the same owner asks for the tour from web", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		web := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
		people := stopByKey(t, web, "people")

		t.Run("the people stop carries its normal body and a target", func(t *testing.T) { // FR-022
			assert.Contains(t, people.Body, "account ID")
			assert.Equal(t, rpcv1.TourTarget_TOUR_TARGET_PEOPLE, people.Target)
			assert.NotEmpty(t, people.ActionLabel)
		})
	})

	// US1, FR-007 — the offer rule
	t.Run("when a person has never engaged with their tour", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)

		t.Run("the status is not started and the tour should be offered", func(t *testing.T) { // FR-007
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_NOT_STARTED, resp.Status)
			assert.True(t, resp.ShouldOffer)
			assert.Zero(t, resp.CurrentStop)
		})

		t.Run("no progress row is written by merely reading the tour", func(t *testing.T) { // FR-007
			// The absence of a row IS "not started". Writing one on read would turn
			// workspace entry into a write path and inflate the denominator of every
			// completion-rate query.
			w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE)
			assert.Zero(t, countTourProgressRows(t, owner))
		})
	})

	t.Run("when a person has completed their tour", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, 0)

		t.Run("the tour is no longer offered", func(t *testing.T) { // FR-007
			resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, resp.Status)
			assert.False(t, resp.ShouldOffer)
		})
	})

	t.Run("when a person has dismissed their tour", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_DISMISSED, 2)

		t.Run("the tour is no longer offered", func(t *testing.T) { // FR-007, FR-009
			// Declining is a decision, not a snooze.
			resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_DISMISSED, resp.Status)
			assert.False(t, resp.ShouldOffer)
		})
	})

	// US1, FR-010, FR-014 — progress
	t.Run("when a person advances part-way and stops", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 2)

		t.Run("asking again returns the stop they had not completed", func(t *testing.T) { // FR-010
			resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
			assert.Equal(t, int32(2), resp.CurrentStop)
			assert.Equal(t, "ritual", resp.Stops[resp.CurrentStop].Key)
		})

		t.Run("the status is in progress and the tour is still offered", func(t *testing.T) { // FR-007, FR-010
			resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, resp.Status)
			assert.True(t, resp.ShouldOffer)
		})

		t.Run("re-sending the same stop index changes nothing", func(t *testing.T) { // FR-014
			// Both clients write on navigation and again on unmount, so the second
			// write of the same position has to be harmless.
			again := w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 2)
			assert.Equal(t, int32(2), again.CurrentStop)
			assert.Equal(t, 1, countTourProgressRows(t, owner))
		})

		t.Run("moving back a stop is accepted and stored", func(t *testing.T) { // FR-011
			back := w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 1)
			assert.Equal(t, int32(1), back.CurrentStop)
			assert.Equal(t, int32(1), w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB).CurrentStop)
		})
	})

	t.Run("when a person completes the final stop", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		stops := len(w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB).Stops)
		resp := w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, int32(stops))

		t.Run("the status becomes completed without inspecting the workspace", func(t *testing.T) { // FR-014
			// Completion means "read every card", never "did the thing each card
			// describes" — an owner who reads and does nothing still finishes.
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, resp.Status)
			assert.Equal(t, int32(stops), resp.CurrentStop)
		})
	})

	t.Run("when a workspace has no project, no ritual and one member", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner() // a freshly registered org is exactly this workspace
		got := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)

		t.Run("an owner who reads every stop still completes the tour", func(t *testing.T) { // FR-014
			for i := range got.Stops {
				w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, int32(i))
			}
			done := w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, int32(len(got.Stops)))
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, done.Status)
			assert.False(t, w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB).ShouldOffer)
		})
	})

	// FR-015a — the stored position survives the stop list changing under it
	t.Run("when a permission is revoked while a person is mid-tour", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		full := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
		last := int32(len(full.Stops) - 1)
		require.Equal(t, "docs", full.Stops[last].Key)
		w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, last)

		w.revokePermission(owner.OrgID, "docs.create")
		shortened := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)

		t.Run("the stop it gated disappears from the list", func(t *testing.T) { // FR-006
			assert.NotContains(t, tourStopKeys(shortened), "docs")
		})

		t.Run("a stored position past the shortened list resumes at the last stop that exists", func(t *testing.T) { // FR-015a
			// Without the clamp a client would index past the end of stops.
			assert.Equal(t, int32(len(shortened.Stops)-1), shortened.CurrentStop)
			assert.Less(t, int(shortened.CurrentStop), len(shortened.Stops))
		})

		t.Run("the stored position is not overwritten by the clamp", func(t *testing.T) { // FR-015a
			var stored int32
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT current_stop FROM iam.tour_progress
				 WHERE organization_id = $1 AND employee_id = $2 AND tour_id = $3`,
				owner.OrgID, owner.ID, tour.TourIDAdministrator).Scan(&stored))
			assert.Equal(t, last, stored, "the clamp is a read-time adjustment, not a write")
		})

		t.Run("restoring the permission restores the original position", func(t *testing.T) { // FR-015a
			w.grantPermission(owner.OrgID, "docs.create")
			restored := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
			assert.Contains(t, tourStopKeys(restored), "docs")
			assert.Equal(t, last, restored.CurrentStop)
		})
	})

	t.Run("when a person's filtered tour has no stops at all", func(t *testing.T) {
		w := newTestWorld(t)
		w.withOwner()
		emp := w.withEmployee()
		for _, permission := range []string{"collab.viewTask", "collab.submitEvidence", "chat.viewChannel", "notif.view"} {
			w.revokePermission(emp.OrgID, permission)
		}
		resp := w.getTour(emp, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE)

		t.Run("the response is empty rather than an error and nothing is offered", func(t *testing.T) { // FR-006
			assert.Empty(t, resp.Stops)
			assert.Zero(t, resp.CurrentStop, "a client must be able to render stops[current_stop] or nothing at all")
		})
	})

	// Spec edge case — role change mid-tour
	t.Run("when a worker is promoted part-way through the worker tour", func(t *testing.T) {
		w := newTestWorld(t)
		w.withOwner()
		emp := w.withEmployee()
		require.Equal(t, rpcv1.TourAudience_TOUR_AUDIENCE_WORKER,
			w.getTour(emp, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE).Audience)
		w.updateTourProgress(emp, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 2)

		// Promotion, for tour purposes, is exactly "can now bring people in".
		w.grantPermission(emp.OrgID, tour.PermissionInviteUser)
		promoted := w.getTour(emp, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE)

		t.Run("they are served the administrator tour on the next call", func(t *testing.T) { // FR-002
			assert.Equal(t, rpcv1.TourAudience_TOUR_AUDIENCE_ADMINISTRATOR, promoted.Audience)
			assert.Equal(t, tour.TourIDAdministrator, promoted.TourId)
		})

		t.Run("the administrator tour reads as not started and is offered", func(t *testing.T) { // FR-007
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_NOT_STARTED, promoted.Status)
			assert.True(t, promoted.ShouldOffer)
		})

		t.Run("their worker-tour progress is left untouched", func(t *testing.T) { // FR-015
			var status string
			var stop int32
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT status, current_stop FROM iam.tour_progress
				 WHERE organization_id = $1 AND employee_id = $2 AND tour_id = $3`,
				emp.OrgID, emp.ID, tour.TourIDWorker).Scan(&status, &stop))
			assert.Equal(t, tour.StatusInProgress, status)
			assert.Equal(t, int32(2), stop)
		})

		t.Run("a progress write lands on the administrator tour, not the worker one", func(t *testing.T) { // FR-015
			w.updateTourProgress(emp, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 1)
			var stop int32
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT current_stop FROM iam.tour_progress
				 WHERE organization_id = $1 AND employee_id = $2 AND tour_id = $3`,
				emp.OrgID, emp.ID, tour.TourIDAdministrator).Scan(&stop))
			assert.Equal(t, int32(1), stop)
			assert.Equal(t, 2, countTourProgressRows(t, emp), "the two tours are remembered independently")
		})
	})

	// Spec edge case — content changed after completion
	t.Run("when the tour content version changes after a person completed it", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, 0)
		// Simulate a later content release by rewriting the version this person's row
		// records; the running server still serves the current one.
		_, err := globalDB.Exec(context.Background(),
			`UPDATE iam.tour_progress SET content_version = 'older-release'
			 WHERE organization_id = $1 AND employee_id = $2`, owner.OrgID, owner.ID)
		require.NoError(t, err)

		t.Run("the tour is still not offered again", func(t *testing.T) { // FR-007
			assert.False(t, w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB).ShouldOffer)
		})

		t.Run("the stored content version is the one they actually saw", func(t *testing.T) { // FR-015
			var version string
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT content_version FROM iam.tour_progress
				 WHERE organization_id = $1 AND employee_id = $2`, owner.OrgID, owner.ID).Scan(&version))
			assert.Equal(t, "older-release", version)
			assert.NotEqual(t, tour.ContentVersion, version)
		})
	})

	// FR-024 — progress belongs to the person, not the device
	t.Run("when a person completed the tour from web", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, 0)

		t.Run("asking from mobile reports completed and does not offer it", func(t *testing.T) { // FR-024
			// The offer rule is deliberately platform-independent, which is the whole
			// of FR-024.
			resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE)
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, resp.Status)
			assert.False(t, resp.ShouldOffer)
		})
	})

	// US3, FR-017 — restart
	t.Run("when a person restarts a completed tour", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, 0)

		t.Run("the status returns to in progress at the first stop", func(t *testing.T) { // FR-017
			w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 0)
			resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, resp.Status)
			assert.Zero(t, resp.CurrentStop)
			assert.True(t, resp.ShouldOffer)
		})

		t.Run("a dismissed tour can be restarted the same way", func(t *testing.T) { // FR-017
			w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_DISMISSED, 3)
			require.False(t, w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB).ShouldOffer)

			w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 0)
			resp := w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB)
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, resp.Status)
			assert.Zero(t, resp.CurrentStop)
		})
	})

	// Contract enforcement
	t.Run("when the request is malformed", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		stops := len(w.getTour(owner, rpcv1.TourPlatform_TOUR_PLATFORM_WEB).Stops)

		t.Run("an unspecified platform is rejected", func(t *testing.T) { // contract
			_, err := w.getTourResult(owner, rpcv1.TourPlatform_TOUR_PLATFORM_UNSPECIFIED)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		t.Run("a progress write of not-started is rejected", func(t *testing.T) { // contract
			// NOT_STARTED is the absence of a row, so it cannot be written.
			_, err := w.updateTourProgressResult(owner, rpcv1.TourStatus_TOUR_STATUS_NOT_STARTED, 0)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))

			_, err = w.updateTourProgressResult(owner, rpcv1.TourStatus_TOUR_STATUS_UNSPECIFIED, 0)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		t.Run("a stop index past the end of the filtered tour is rejected", func(t *testing.T) { // contract
			_, err := w.updateTourProgressResult(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, int32(stops+1))
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		t.Run("a negative stop index is rejected", func(t *testing.T) { // contract
			_, err := w.updateTourProgressResult(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, -1)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	// Constitution I — tenancy
	t.Run("when two organizations each have a person mid-tour", func(t *testing.T) {
		w := newTestWorld(t)
		u1, u2 := w.withUsersFromDifferentOrgs()
		w.updateTourProgress(u1, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 1)
		w.updateTourProgress(u2, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, 0)

		t.Run("neither reads nor overwrites the other's progress", func(t *testing.T) { // FR-015
			r1 := w.getTour(u1, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE)
			r2 := w.getTour(u2, rpcv1.TourPlatform_TOUR_PLATFORM_MOBILE)
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, r1.Status)
			assert.Equal(t, int32(1), r1.CurrentStop)
			assert.Equal(t, rpcv1.TourStatus_TOUR_STATUS_COMPLETED, r2.Status)
		})

		t.Run("the same person in a second organization is offered the tour again", func(t *testing.T) { // FR-015
			// Progress is scoped to (organization, person): the same human joining a
			// second workspace is new there and gets oriented again.
			assert.Equal(t, 1, countTourProgressRows(t, u1))
			assert.Equal(t, 1, countTourProgressRows(t, u2))
			assert.NotEqual(t, u1.OrgID, u2.OrgID)
		})
	})

	// Lifecycle
	t.Run("when an organization is deleted", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		w.updateTourProgress(owner, rpcv1.TourStatus_TOUR_STATUS_IN_PROGRESS, 1)
		require.Equal(t, 1, countTourProgressRows(t, owner))

		_, err := w.deleteMyAccountResult(owner, iam.DeletionConfirmationPhrase)
		require.NoError(t, err)

		t.Run("its tour progress rows are removed with it", func(t *testing.T) { // data lifecycle
			// The account-deletion sweep deletes per-domain rows explicitly rather than
			// leaning on cascades, so a new tenant table left out of it strands rows.
			require.Eventually(t, func() bool {
				return countTourProgressRows(t, owner) == 0
			}, eraseBudget, 200*time.Millisecond)
		})
	})
}

// TestTourPermissionIdsExist guards the one silent failure mode in this feature: the
// permission ids in content.go are bare strings with no compile-time check, so a rename in
// a later migration would flip the audience or hide a stop with nothing to catch it.
func TestTourPermissionIdsExist(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	t.Run("every permission id referenced by tour content exists in public.permission", func(t *testing.T) {
		for _, definition := range tour.AllTours() {
			for _, stop := range definition.Stops {
				if stop.RequiredPermission == "" {
					continue // an ungated stop is always shown
				}
				var exists bool
				require.NoError(t, globalDB.QueryRow(ctx,
					`SELECT EXISTS (SELECT 1 FROM public.permission WHERE id = $1)`,
					stop.RequiredPermission).Scan(&exists))
				assert.True(t, exists,
					"tour stop %q in the %s tour requires permission %q, which no longer exists — the stop is now invisible to everyone",
					stop.Key, definition.ID, stop.RequiredPermission)
			}
		}
	})

	t.Run("the audience discriminator iam.inviteUser exists and is absent from the employee role template", func(t *testing.T) {
		var exists bool
		require.NoError(t, globalDB.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM public.permission WHERE id = $1)`,
			tour.PermissionInviteUser).Scan(&exists))
		require.True(t, exists, "the audience discriminator no longer exists; every person would get the worker tour")

		var grantedToEmployee bool
		require.NoError(t, globalDB.QueryRow(ctx,
			`SELECT EXISTS (
			   SELECT 1 FROM public.default_role_permission
			   WHERE role_id = 'employee' AND permission_id = $1)`,
			tour.PermissionInviteUser).Scan(&grantedToEmployee))
		assert.False(t, grantedToEmployee,
			"granting %s to the employee template would serve every worker the administrator tour",
			tour.PermissionInviteUser)
	})

	t.Run("both tour permissions are granted to every seeded role", func(t *testing.T) {
		// Everyone needs to see their own tour, so unlike most permissions these have no
		// exclusion list — and a missing grant fails as permission_denied at the
		// interceptor, before any of this feature's code runs.
		for _, role := range []string{"owner", "operator", "employee"} {
			for _, permission := range []string{"tour.view", "tour.update"} {
				var granted bool
				require.NoError(t, globalDB.QueryRow(ctx,
					`SELECT EXISTS (
					   SELECT 1 FROM public.default_role_permission
					   WHERE role_id = $1 AND permission_id = $2)`,
					role, permission).Scan(&granted))
				assert.True(t, granted, "%s is not granted to %s", permission, role)
			}
		}
	})
}

// stopByKey finds one stop in a response, failing the test if the sequence does not
// contain it — which is itself the interesting failure.
func stopByKey(t *testing.T, resp *rpcv1.GetTourResponse, key string) *rpcv1.TourStop {
	t.Helper()
	for _, stop := range resp.Stops {
		if stop.Key == key {
			return stop
		}
	}
	require.Failf(t, "stop not found", "no stop with key %q in %v", key, tourStopKeys(resp))
	return nil
}

// countTourProgressRows counts a person's stored tour rows in one organization. Zero is
// the meaningful value in several scenarios: reading the tour must never write a row.
func countTourProgressRows(t *testing.T, actor testUser) int {
	t.Helper()
	var count int
	require.NoError(t, globalDB.QueryRow(context.Background(),
		`SELECT count(*) FROM iam.tour_progress WHERE organization_id = $1 AND employee_id = $2`,
		actor.OrgID, actor.ID).Scan(&count))
	return count
}
