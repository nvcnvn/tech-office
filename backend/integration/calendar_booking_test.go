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

// ---------------------------------------------------------------------------
// US6: Scheduling Assistant & Booking Links
// ---------------------------------------------------------------------------

func TestSchedulingAssistant(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	member := w.withEmployee()

	now := time.Now().UTC().Truncate(time.Second)

	t.Run("set and get working hours", func(t *testing.T) {
		hours := make([]*rpcv1.WorkingHours, 0, 5)
		for _, day := range []int32{1, 2, 3, 4, 5} { // Mon-Fri
			hours = append(hours, &rpcv1.WorkingHours{
				DayOfWeek:    day,
				StartTime:    "09:00",
				EndTime:      "17:00",
				IsWorkingDay: true,
				Timezone:     "Asia/Ho_Chi_Minh",
			})
		}

		setReq := connect.NewRequest(&rpcv1.SetWorkingHoursRequest{
			WorkingHours: hours,
		})
		setReq.Header().Set("Authorization", "Bearer "+owner.Token)
		setResp, err := w.cal.SetWorkingHours(context.Background(), setReq)
		require.NoError(t, err)
		assert.Len(t, setResp.Msg.WorkingHours, 5)

		getReq := connect.NewRequest(&rpcv1.GetWorkingHoursRequest{})
		getReq.Header().Set("Authorization", "Bearer "+owner.Token)
		getResp, err := w.cal.GetWorkingHours(context.Background(), getReq)
		require.NoError(t, err)
		assert.Len(t, getResp.Msg.WorkingHours, 5)
		assert.Equal(t, "09:00", getResp.Msg.WorkingHours[0].StartTime)
	})

	t.Run("suggest conflict-free slots", func(t *testing.T) {
		// Create some events to block time.
		start := now.Add(24 * time.Hour).Truncate(time.Hour)
		end := start.Add(1 * time.Hour)
		w.calCreateEvent(owner, "Blocker", start, end)

		suggestReq := connect.NewRequest(&rpcv1.SuggestSlotsRequest{
			EmployeeIds:     []string{owner.ID.String(), member.ID.String()},
			DurationMinutes: 30,
			SearchFrom:      timestamppb.New(now),
			SearchUntil:     timestamppb.New(now.Add(7 * 24 * time.Hour)),
			MaxSuggestions:  5,
		})
		suggestReq.Header().Set("Authorization", "Bearer "+owner.Token)
		suggestResp, err := w.cal.SuggestSlots(context.Background(), suggestReq)
		require.NoError(t, err)
		assert.NotEmpty(t, suggestResp.Msg.SuggestedSlots, "should find at least one free slot")
		for _, slot := range suggestResp.Msg.SuggestedSlots {
			assert.True(t, slot.IsFree, "suggested slot should be free")
			duration := slot.End.AsTime().Sub(slot.Start.AsTime())
			assert.Equal(t, 30*time.Minute, duration, "slot should be 30 minutes")
		}
	})

	t.Run("get free/busy for multiple employees", func(t *testing.T) {
		start := now.Add(48 * time.Hour).Truncate(time.Hour)
		end := start.Add(1 * time.Hour)
		w.calCreateEvent(owner, "Owner Busy", start, end)

		fbReq := connect.NewRequest(&rpcv1.GetFreeBusyRequest{
			EmployeeIds: []string{owner.ID.String(), member.ID.String()},
			Start:       timestamppb.New(now.Add(47 * time.Hour)),
			End:         timestamppb.New(now.Add(50 * time.Hour)),
		})
		fbReq.Header().Set("Authorization", "Bearer "+owner.Token)
		fbResp, err := w.cal.GetFreeBusy(context.Background(), fbReq)
		require.NoError(t, err)
		assert.Len(t, fbResp.Msg.FreeBusy, 2, "should have free/busy for both employees")
	})
}

func TestBookingLinks(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	member := w.withEmployee()

	t.Run("create booking link and get by token", func(t *testing.T) {
		createReq := connect.NewRequest(&rpcv1.CreateBookingLinkRequest{
			Title:           "30-minute 1:1",
			DurationMinutes: 30,
			ValidFrom:       "2025-01-01",
			ValidUntil:      "2025-12-31",
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateBookingLink(context.Background(), createReq)
		require.NoError(t, err)
		require.NotNil(t, createResp.Msg.BookingLink)
		assert.NotEmpty(t, createResp.Msg.ShareUrl, "should have a share URL")
		token := createResp.Msg.BookingLink.Token
		assert.NotEmpty(t, token)

		// Get by token
		getReq := connect.NewRequest(&rpcv1.GetBookingLinkByTokenRequest{
			Token: token,
		})
		getReq.Header().Set("Authorization", "Bearer "+member.Token)
		getResp, err := w.cal.GetBookingLinkByToken(context.Background(), getReq)
		require.NoError(t, err)
		assert.Equal(t, "30-minute 1:1", getResp.Msg.BookingLink.Title)
	})

	t.Run("claim booking slot creates event", func(t *testing.T) {
		createReq := connect.NewRequest(&rpcv1.CreateBookingLinkRequest{
			Title:           "Quick Chat",
			DurationMinutes: 15,
			ValidFrom:       "2025-01-01",
			ValidUntil:      "2025-12-31",
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateBookingLink(context.Background(), createReq)
		require.NoError(t, err)
		token := createResp.Msg.BookingLink.Token

		// Claim a slot
		slotStart := time.Now().Add(48 * time.Hour).Truncate(time.Hour)
		claimReq := connect.NewRequest(&rpcv1.ClaimBookingSlotRequest{
			Token:     token,
			SlotStart: timestamppb.New(slotStart),
		})
		claimReq.Header().Set("Authorization", "Bearer "+member.Token)
		claimResp, err := w.cal.ClaimBookingSlot(context.Background(), claimReq)
		require.NoError(t, err)
		require.NotNil(t, claimResp.Msg.Event, "claiming a slot should create an event")
		assert.Equal(t, "Quick Chat", claimResp.Msg.Event.Title)
	})
}
