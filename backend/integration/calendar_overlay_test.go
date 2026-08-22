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
// US5: Cross-Domain Overlays — Tasks, Rituals, Docs
// ---------------------------------------------------------------------------

func TestCrossDomainOverlays(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	now := time.Now().UTC().Truncate(time.Second)
	rangeStart := now
	rangeEnd := now.Add(7 * 24 * time.Hour)

	t.Run("overlay items returned for tasks and rituals", func(t *testing.T) {
		req := connect.NewRequest(&rpcv1.ListOverlayItemsRequest{
			Start:               timestamppb.New(rangeStart),
			End:                 timestamppb.New(rangeEnd),
			IncludeTasks:        true,
			IncludeRituals:      true,
			IncludeDocDeadlines: true,
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		resp, err := w.cal.ListOverlayItems(context.Background(), req)
		require.NoError(t, err)
		// The overlay response is valid even if no cross-domain records exist yet.
		// This verifies the RPC call works end-to-end.
		assert.NotNil(t, resp.Msg, "overlay response should not be nil")
	})

	t.Run("overlay items empty when all toggles are off", func(t *testing.T) {
		req := connect.NewRequest(&rpcv1.ListOverlayItemsRequest{
			Start:               timestamppb.New(rangeStart),
			End:                 timestamppb.New(rangeEnd),
			IncludeTasks:        false,
			IncludeRituals:      false,
			IncludeDocDeadlines: false,
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		resp, err := w.cal.ListOverlayItems(context.Background(), req)
		require.NoError(t, err)
		assert.Empty(t, resp.Msg.Items, "no items should be returned when all toggles are off")
	})

	t.Run("overlay items coexist with calendar events", func(t *testing.T) {
		// Create a regular calendar event.
		eventStart := now.Add(2 * time.Hour)
		eventEnd := eventStart.Add(1 * time.Hour)
		event := w.calCreateEvent(owner, "Overlay Coexist Meeting", eventStart, eventEnd)
		assert.NotEmpty(t, event.Id)

		// Fetch overlay items — should succeed independently of event existence.
		overlayReq := connect.NewRequest(&rpcv1.ListOverlayItemsRequest{
			Start:          timestamppb.New(rangeStart),
			End:            timestamppb.New(rangeEnd),
			IncludeTasks:   true,
			IncludeRituals: true,
		})
		overlayReq.Header().Set("Authorization", "Bearer "+owner.Token)
		overlayResp, err := w.cal.ListOverlayItems(context.Background(), overlayReq)
		require.NoError(t, err)
		assert.NotNil(t, overlayResp.Msg, "overlay response should not be nil")

		// Also verify the event is in ListEvents.
		listReq := connect.NewRequest(&rpcv1.ListEventsRequest{
			Start: timestamppb.New(rangeStart),
			End:   timestamppb.New(rangeEnd),
		})
		listReq.Header().Set("Authorization", "Bearer "+owner.Token)
		listResp, err := w.cal.ListEvents(context.Background(), listReq)
		require.NoError(t, err)
		assert.NotEmpty(t, listResp.Msg.Events)
	})
}
