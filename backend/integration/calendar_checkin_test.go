package integration

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestOperationalCheckIn validates US7: compliance check-in, evidence, and audit trail.
func TestOperationalCheckIn(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	technician := w.withEmployee()

	// Create a shift event in the past that requires check-in and evidence.
	pastStart := time.Now().Add(-2 * time.Hour)
	pastEnd := time.Now().Add(-1 * time.Hour)

	createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
		Title:               "Night Shift",
		EventType:           "shift",
		Visibility:          "team",
		StartTime:           timestamppb.New(pastStart),
		EndTime:             timestamppb.New(pastEnd),
		RequiresCheckIn:     true,
		RequiresEvidence:    true,
		RequiredAttendeeIds: []string{technician.ID.String()},
	})
	createReq.Header().Set("Authorization", "Bearer "+owner.Token)
	createResp, err := w.cal.CreateEvent(context.Background(), createReq)
	require.NoError(t, err)
	event := createResp.Msg.Event

	t.Run("technician can check in to a shift event", func(t *testing.T) {
		checkInReq := connect.NewRequest(&rpcv1.CheckInToEventRequest{
			EventId: event.Id,
		})
		checkInReq.Header().Set("Authorization", "Bearer "+technician.Token)
		checkInResp, err := w.cal.CheckInToEvent(context.Background(), checkInReq)
		require.NoError(t, err)
		require.NotNil(t, checkInResp.Msg.CheckIn)
		assert.Equal(t, event.Id, checkInResp.Msg.CheckIn.EventId)
		assert.Equal(t, technician.ID.String(), checkInResp.Msg.CheckIn.EmployeeId)
		assert.NotNil(t, checkInResp.Msg.CheckIn.CheckedInAt)
	})

	t.Run("technician can submit evidence after check-in", func(t *testing.T) {
		// Check-in was already done in the previous subtest; go straight to evidence.

		// Submit evidence (file IDs would normally come from the file service)
		evidenceReq := connect.NewRequest(&rpcv1.SubmitCheckInEvidenceRequest{
			EventId: event.Id,
			FileIds: []string{}, // Empty is acceptable; the system accepts the submission
		})
		evidenceReq.Header().Set("Authorization", "Bearer "+technician.Token)
		evidenceResp, err := w.cal.SubmitCheckInEvidence(context.Background(), evidenceReq)
		require.NoError(t, err)
		require.NotNil(t, evidenceResp.Msg.CheckIn)
		assert.NotNil(t, evidenceResp.Msg.CheckIn.SubmittedAt, "submitted_at should be set after evidence submission")
	})

	t.Run("audit trail is created for compliance events", func(t *testing.T) {
		auditReq := connect.NewRequest(&rpcv1.ListAuditEntriesRequest{
			EventId: event.Id,
			Limit:   10,
		})
		auditReq.Header().Set("Authorization", "Bearer "+owner.Token)
		auditResp, err := w.cal.ListAuditEntries(context.Background(), auditReq)
		require.NoError(t, err)
		assert.NotEmpty(t, auditResp.Msg.Entries, "compliance event should have audit entries")
	})

	t.Run("late check-in is flagged", func(t *testing.T) {
		// Create another past shift event
		veryPast := time.Now().Add(-4 * time.Hour)
		veryPastEnd := time.Now().Add(-3 * time.Hour)
		lateReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Early Shift",
			EventType:           "shift",
			Visibility:          "team",
			StartTime:           timestamppb.New(veryPast),
			EndTime:             timestamppb.New(veryPastEnd),
			RequiresCheckIn:     true,
			RequiredAttendeeIds: []string{technician.ID.String()},
		})
		lateReq.Header().Set("Authorization", "Bearer "+owner.Token)
		lateResp, err := w.cal.CreateEvent(context.Background(), lateReq)
		require.NoError(t, err)
		lateEvent := lateResp.Msg.Event

		// Check in now (well after the event ended)
		checkInReq := connect.NewRequest(&rpcv1.CheckInToEventRequest{
			EventId: lateEvent.Id,
		})
		checkInReq.Header().Set("Authorization", "Bearer "+technician.Token)
		checkInResp, err := w.cal.CheckInToEvent(context.Background(), checkInReq)
		require.NoError(t, err)
		assert.True(t, checkInResp.Msg.CheckIn.IsLate, "check-in after event should be flagged as late")
	})
}
