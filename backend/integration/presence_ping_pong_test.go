package integration

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// responsiveWindow and removalWindow mirror the Go constants so scenarios read in the
// units the protocol is specified in.
const (
	responsiveWindow = notification.ResponsiveWindowSeconds * time.Second
	removalWindow    = notification.RemovalWindowSeconds * time.Second
)

// TestPresencePingPong is the behavioral contract for the presence ping-pong protocol.
//
// Source: specs/033-presence-ping-pong/contracts/integration-scenarios.md
//
// Scenarios marked (clock) move last_pong_at directly through the admin pool via
// setConnectionLastPongAt rather than sleeping: a scenario that genuinely waited out
// the 90-second removal window would blow the whole suite's time budget on its own.
func TestPresencePingPong(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	w.withOwner()
	colleague := w.withEmployee()

	// ── User Story 1: notifications reach a colleague whose app went away silently ──

	// FR-012, FR-013, FR-014: routing follows responsiveness
	t.Run("when a notification is generated for an employee", func(t *testing.T) {
		t.Run("with a responsive connection it is delivered live and no fallback is queued", func(t *testing.T) {
			responsive := w.withEmployee()
			connID := w.establishSSE(responsive)
			w.sendPong(responsive, pongRequest{
				ConnectionID: connID,
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			})

			notifID := w.publishPersistentNotification(responsive.ID, "responsive recipient")
			status, reason, _ := w.queryFallbackState(w.recipientRowID(notifID, responsive.ID))

			// Queued for the rescue window because the recipient is reachable live —
			// never routed as unreachable.
			assert.Equal(t, "queued", status)
			assert.Equal(t, notification.FallbackReasonRecipientOnline, reason)
		})

		t.Run("with only an unresponsive connection it is routed to push fallback", func(t *testing.T) {
			gone := w.withEmployee()
			connID := dbuuid.MustParse(w.establishSSE(gone))
			w.sendPong(gone, pongRequest{
				ConnectionID: connID.String(),
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			})
			// The device stopped answering: the row still exists but is past the
			// responsive window. This is the sleeping-laptop case.
			w.setConnectionLastPongAt(connID, responsiveWindow+5*time.Second)

			notifID := w.publishPersistentNotification(gone.ID, "unresponsive recipient")
			_, reason, dueAt := w.queryFallbackState(w.recipientRowID(notifID, gone.ID))

			// The contract is the due time, not the status: the row is handed to the
			// rescue push worker due immediately, where a reachable recipient's row is
			// due a rescue window later. Asserting on fallback_status instead would be
			// racing that worker's next tick.
			assert.WithinDuration(t, time.Now(), dueAt.Time, 5*time.Second,
				"an unreachable recipient must not wait out the rescue window")
			assert.Equal(t, notification.FallbackReasonConnectionUnresponsive, reason)
		})

		t.Run("the fallback reason records connection_unresponsive, not a policy skip", func(t *testing.T) {
			gone := w.withEmployee()
			connID := dbuuid.MustParse(w.establishSSE(gone))
			w.sendPong(gone, pongRequest{
				ConnectionID: connID.String(),
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			})
			w.setConnectionLastPongAt(connID, responsiveWindow+5*time.Second)

			notifID := w.publishPersistentNotification(gone.ID, "unresponsive reason")
			reasons := w.deliveryAttemptReasons(w.recipientRowID(notifID, gone.ID))

			assert.Contains(t, reasons, notification.FallbackReasonConnectionUnresponsive,
				"the decision must be auditable as 'we could not reach them live'")
			assert.NotContains(t, reasons, notification.FallbackReasonRecipientOnline)
		})

		t.Run("with no connection at all it is routed to push fallback", func(t *testing.T) {
			absent := w.withEmployee()

			notifID := w.publishPersistentNotification(absent.ID, "no connection")
			_, _, dueAt := w.queryFallbackState(w.recipientRowID(notifID, absent.ID))
			reasons := w.deliveryAttemptReasons(w.recipientRowID(notifID, absent.ID))

			assert.WithinDuration(t, time.Now(), dueAt.Time, 5*time.Second,
				"an absent recipient must not wait out the rescue window either")
			assert.Contains(t, reasons, notification.FallbackReasonConnectionUnresponsive)
		})
	})

	// FR-016: exactly one delivery decision per recipient per notification
	t.Run("when a notification is routed at the responsiveness boundary", func(t *testing.T) {
		t.Run("it is never both delivered live and queued for unsuppressed fallback", func(t *testing.T) {
			// Just inside the window on one run and just outside on the next; whichever
			// side the boundary falls on, exactly one decision must be recorded.
			for _, age := range []time.Duration{responsiveWindow - 10*time.Second, responsiveWindow + 10*time.Second} {
				boundary := w.withEmployee()
				connID := dbuuid.MustParse(w.establishSSE(boundary))
				w.sendPong(boundary, pongRequest{
					ConnectionID: connID.String(),
					Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				})
				w.setConnectionLastPongAt(connID, age)

				notifID := w.publishPersistentNotification(boundary.ID, "boundary")
				recipientRow := w.recipientRowID(notifID, boundary.ID)
				status, _, _ := w.queryFallbackState(recipientRow)
				reasons := w.deliveryAttemptReasons(recipientRow)

				treatedAsLive := status == "queued" && contains(reasons, notification.FallbackReasonRecipientOnline)
				treatedAsUnreachable := contains(reasons, notification.FallbackReasonConnectionUnresponsive)

				assert.False(t, treatedAsLive && treatedAsUnreachable,
					"age %s produced two contradictory decisions", age)
				assert.True(t, treatedAsLive || treatedAsUnreachable,
					"age %s produced no decision at all (status=%s reasons=%v)", age, status, reasons)
			}
		})
	})

	// FR-011: aggregation across devices
	t.Run("when an employee has two connections and only one answers", func(t *testing.T) {
		twoDevices := w.withEmployee()
		answering := dbuuid.MustParse(w.establishSSE(twoDevices))
		dozing := dbuuid.MustParse(w.establishSSE(twoDevices))

		w.sendPong(twoDevices, pongRequest{
			ConnectionID: answering.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})
		// The phone in a pocket: still registered, no longer answering.
		w.setConnectionLastPongAt(dozing, responsiveWindow+5*time.Second)

		t.Run("the employee still counts as present", func(t *testing.T) {
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				w.getPresence(colleague, twoDevices.ID).Status)
		})

		t.Run("live delivery targets only the answering connection", func(t *testing.T) {
			live := w.responsiveConnectionIDs(twoDevices.ID)
			assert.Contains(t, live, answering)
			assert.NotContains(t, live, dozing)
		})

		t.Run("no push fallback is queued for the employee", func(t *testing.T) {
			notifID := w.publishPersistentNotification(twoDevices.ID, "one device answering")
			recipientRow := w.recipientRowID(notifID, twoDevices.ID)

			assert.NotContains(t, w.deliveryAttemptReasons(recipientRow),
				notification.FallbackReasonConnectionUnresponsive,
				"one responsive device is enough to reach the person live")
		})
	})

	// ── User Story 2: teammates see an accurate presence indicator ──

	// FR-007, FR-008: the derived liveness state machine
	t.Run("when a connection stops answering", func(t *testing.T) {
		fading := w.withEmployee()
		connID := dbuuid.MustParse(w.establishSSE(fading))
		w.sendPong(fading, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})

		t.Run("it reads as present up to the responsive window", func(t *testing.T) {
			w.setConnectionLastPongAt(connID, responsiveWindow-10*time.Second)

			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				w.getPresence(colleague, fading.ID).Status)
		})

		t.Run("it reads as offline past the responsive window", func(t *testing.T) {
			w.setConnectionLastPongAt(connID, responsiveWindow+10*time.Second)

			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
				w.getPresence(colleague, fading.ID).Status)
		})

		t.Run("its row is deleted past the removal window", func(t *testing.T) {
			// Unresponsive but inside the removal window: the row survives, because a
			// pong before removal must still be able to restore it.
			w.setConnectionLastPongAt(connID, removalWindow-10*time.Second)
			w.deleteExpiredConnections()
			require.True(t, w.connectionExists(connID),
				"a connection inside the removal window must not be swept")

			w.setConnectionLastPongAt(connID, removalWindow+10*time.Second)
			w.deleteExpiredConnections()
			assert.False(t, w.connectionExists(connID))
		})
	})

	// FR-009: recovery without re-authentication
	t.Run("when an unresponsive connection answers again before removal", func(t *testing.T) {
		recovering := w.withEmployee()
		connID := dbuuid.MustParse(w.establishSSE(recovering))
		w.sendPong(recovering, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})
		// Past the responsive window but well short of removal.
		w.setConnectionLastPongAt(connID, responsiveWindow+10*time.Second)
		require.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
			w.getPresence(colleague, recovering.ID).Status)

		directive := w.sendPong(recovering, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})

		t.Run("it is restored to present", func(t *testing.T) {
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				w.getPresence(colleague, recovering.ID).Status)
		})

		t.Run("the client is not asked to reconnect", func(t *testing.T) {
			assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_ACK, directive,
				"the removal window is deliberately past the responsive window so a "+
					"recovering client finds its row intact")
		})
	})

	// FR-010: a removed connection is never resurrected
	t.Run("when a pong arrives for a connection that was already removed", func(t *testing.T) {
		vanished := w.withEmployee()
		connID := dbuuid.MustParse(w.establishSSE(vanished))
		w.sendPong(vanished, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})
		w.setConnectionLastPongAt(connID, removalWindow+10*time.Second)
		w.deleteExpiredConnections()
		require.False(t, w.connectionExists(connID))

		directive := w.sendPong(vanished, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})

		t.Run("it returns the reconnect directive", func(t *testing.T) {
			assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_RECONNECT, directive)
		})

		t.Run("it does not recreate the connection row", func(t *testing.T) {
			// The batched statement is an UPDATE, never an upsert, which is what makes
			// resurrection impossible rather than merely unlikely.
			assert.False(t, w.connectionExists(connID))
		})
	})

	// FR-011: most-available status wins
	t.Run("when an employee is present on two connections with different states", func(t *testing.T) {
		t.Run("the aggregated presence reports the most available state", func(t *testing.T) {
			multi := w.withEmployee()
			laptop := w.establishSSE(multi)
			phone := w.establishSSE(multi)

			w.sendPong(multi, pongRequest{ConnectionID: phone, Status: rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE})
			w.sendPong(multi, pongRequest{ConnectionID: laptop, Status: rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE})

			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				w.getPresence(colleague, multi.ID).Status)
		})
	})

	// FR-015, FR-020: visibility affects display, never routing
	t.Run("when an employee has chosen to appear offline", func(t *testing.T) {
		hidden := w.withEmployee()
		connID := dbuuid.MustParse(w.establishSSE(hidden))
		w.setPresenceVisibility(hidden, rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE, "", "")
		w.sendPong(hidden, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})

		t.Run("viewers see them as offline while they are answering pings", func(t *testing.T) {
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
				w.getPresence(colleague, hidden.ID).Status)
		})

		t.Run("their notifications are still treated as live-deliverable", func(t *testing.T) {
			// Visibility is applied on the read path only, after aggregation, so it
			// never reaches routing.
			notifID := w.publishPersistentNotification(hidden.ID, "hidden but reachable")
			recipientRow := w.recipientRowID(notifID, hidden.ID)

			assert.NotContains(t, w.deliveryAttemptReasons(recipientRow),
				notification.FallbackReasonConnectionUnresponsive)
		})

		t.Run("going unresponsive still routes their notifications to push fallback", func(t *testing.T) {
			w.setConnectionLastPongAt(connID, responsiveWindow+10*time.Second)

			notifID := w.publishPersistentNotification(hidden.ID, "hidden and gone")
			recipientRow := w.recipientRowID(notifID, hidden.ID)

			assert.Contains(t, w.deliveryAttemptReasons(recipientRow),
				notification.FallbackReasonConnectionUnresponsive)
		})
	})

	// ── User Story 3: state and context reported through the pong ──

	// FR-002, FR-018: the pong carries everything the removed endpoint carried
	t.Run("when a pong reports a new active channel", func(t *testing.T) {
		viewer := w.withEmployee()
		connID := dbuuid.MustParse(w.establishSSE(viewer))
		channelID := w.createChannel(viewer, uniqueSlug("pong-context"), false)

		w.sendPong(viewer, pongRequest{
			ConnectionID:    connID.String(),
			Status:          rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			ActiveChannelID: channelID,
		})

		t.Run("the connection's active context is updated", func(t *testing.T) {
			_, storedChannel, _ := w.connectionRow(connID)
			assert.Equal(t, channelID, storedChannel)
			assert.Equal(t, channelID, w.getPresence(viewer, viewer.ID).ActiveChannelId)
		})

		t.Run("live notifications for the viewed channel are suppressed as already seen", func(t *testing.T) {
			notifID := w.publishNotificationForChannel(viewer.ID, "already looking at it", channelID)
			recipientRow := w.recipientRowID(notifID, viewer.ID)
			_, reason, _ := w.queryFallbackState(recipientRow)

			assert.NotEqual(t, notification.FallbackReasonConnectionUnresponsive, reason,
				"someone reading the channel does not need a push about it")
			assert.NotContains(t, w.deliveryAttemptReasons(recipientRow),
				notification.FallbackReasonConnectionUnresponsive)
		})
	})

	t.Run("when a pong reports each supported status", func(t *testing.T) {
		t.Run("online, online_hidden, idle, in_meeting and offline are all accepted", func(t *testing.T) {
			stated := w.withEmployee()
			connID := dbuuid.MustParse(w.establishSSE(stated))

			for _, status := range []rpcv1.PresenceStatus{
				rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN,
				rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE,
				rpcv1.PresenceStatus_PRESENCE_STATUS_IN_MEETING,
				rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
			} {
				directive, err := w.sendPongErr(stated, pongRequest{
					ConnectionID: connID.String(),
					Status:       status,
				})
				require.NoError(t, err, "status %s must be accepted", status)
				require.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_ACK, directive)

				stored, _, _ := w.connectionRow(connID)
				assert.Equal(t, notification.PresenceStatusFromProto(status), stored)
			}
		})

		t.Run("an unspecified status is rejected as invalid argument", func(t *testing.T) {
			stated := w.withEmployee()
			connID := w.establishSSE(stated)

			_, err := w.sendPongErr(stated, pongRequest{
				ConnectionID: connID,
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_UNSPECIFIED,
			})

			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err),
				"the client must state what it is")
		})
	})

	// FR-004: unsolicited pongs take effect immediately
	t.Run("when a client sends an unsolicited pong between pings", func(t *testing.T) {
		t.Run("the new state is visible without waiting for the next ping", func(t *testing.T) {
			restless := w.withEmployee()
			connID := w.establishSSE(restless)

			w.sendPong(restless, pongRequest{
				ConnectionID: connID,
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			})
			// No ping id: this is a state change reported on the client's own initiative.
			w.sendPong(restless, pongRequest{
				ConnectionID: connID,
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE,
			})

			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE,
				w.getPresence(colleague, restless.ID).Status)
		})
	})

	// FR-005: clean departure
	t.Run("when a client sends a departing pong", func(t *testing.T) {
		leaving := w.withEmployee()
		connID := dbuuid.MustParse(w.establishSSE(leaving))
		w.sendPong(leaving, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})
		require.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			w.getPresence(colleague, leaving.ID).Status)

		w.sendPong(leaving, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
			Departing:    true,
		})

		t.Run("the connection is removed immediately", func(t *testing.T) {
			assert.False(t, w.connectionExists(connID))
		})

		t.Run("the employee reads as offline without waiting out the window", func(t *testing.T) {
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
				w.getPresence(colleague, leaving.ID).Status)
		})
	})

	// FR-006, FR-022, FR-023: ownership and tenancy
	t.Run("when a pong references a connection the caller does not own", func(t *testing.T) {
		victim := w.withEmployee()
		impostor := w.withEmployee()
		victimConn := dbuuid.MustParse(w.establishSSE(victim))
		w.sendPong(victim, pongRequest{
			ConnectionID: victimConn.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})
		beforeStatus, _, _ := w.connectionRow(victimConn)

		stolen := w.sendPong(impostor, pongRequest{
			ConnectionID: victimConn.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
		})

		t.Run("another employee's connection is not modified", func(t *testing.T) {
			afterStatus, _, _ := w.connectionRow(victimConn)
			assert.Equal(t, beforeStatus, afterStatus)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				w.getPresence(colleague, victim.ID).Status)
		})

		t.Run("the response is indistinguishable from an unknown connection", func(t *testing.T) {
			unknown := w.sendPong(impostor, pongRequest{
				ConnectionID: dbuuid.Must().String(),
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			})
			// Identical by design: a caller cannot probe for connection ids belonging
			// to other employees.
			assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_RECONNECT, stolen)
			assert.Equal(t, unknown, stolen)
		})

		t.Run("a connection in another organization is not modified", func(t *testing.T) {
			outsiderA, outsiderB := w.withUsersFromDifferentOrgs()
			foreignConn := dbuuid.MustParse(w.establishSSE(outsiderA))
			w.sendPong(outsiderA, pongRequest{
				ConnectionID: foreignConn.String(),
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			})
			before, _, _ := w.connectionRow(foreignConn)

			directive := w.sendPong(outsiderB, pongRequest{
				ConnectionID: foreignConn.String(),
				Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
			})

			after, _, _ := w.connectionRow(foreignConn)
			assert.Equal(t, before, after)
			assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_RECONNECT, directive)
		})
	})

	// FR-006: malformed input
	t.Run("when a pong is malformed", func(t *testing.T) {
		malformed := w.withEmployee()

		t.Run("a missing connection id is rejected as invalid argument", func(t *testing.T) {
			_, err := w.sendPongErr(malformed, pongRequest{
				Status: rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			})

			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		t.Run("an unparseable active channel id is rejected as invalid argument", func(t *testing.T) {
			_, err := w.sendPongErr(malformed, pongRequest{
				ConnectionID:    w.establishSSE(malformed),
				Status:          rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				ActiveChannelID: "not-a-uuid",
			})

			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	// Edge case: client clock disagreement (spec Edge Cases, research R6)
	t.Run("when a pong carries an implausible last interaction time", func(t *testing.T) {
		skewed := w.withEmployee()
		connID := dbuuid.MustParse(w.establishSSE(skewed))

		w.sendPong(skewed, pongRequest{
			ConnectionID:      connID.String(),
			Status:            rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			LastInteractionAt: timestamppb.New(time.Now().Add(72 * time.Hour)),
		})

		t.Run("a far-future interaction time is clamped to the server's clock", func(t *testing.T) {
			_, _, lastInteraction := w.connectionRow(connID)

			assert.False(t, lastInteraction.After(time.Now().Add(time.Minute)),
				"a device clock hours ahead must not be written through verbatim")
		})

		t.Run("liveness is unaffected by the client-supplied time", func(t *testing.T) {
			// last_pong_at is the database's own clock, so a forged interaction time
			// cannot buy a connection extra life.
			assert.Less(t, w.connectionLastPongAge(connID), 30*time.Second)

			w.setConnectionLastPongAt(connID, responsiveWindow+10*time.Second)
			w.sendPong(skewed, pongRequest{
				ConnectionID:      connID.String(),
				Status:            rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
				LastInteractionAt: timestamppb.New(time.Now().Add(-48 * time.Hour)),
			})

			assert.Less(t, w.connectionLastPongAge(connID), 30*time.Second,
				"an ancient interaction time must not backdate liveness either")
		})
	})

	// ── User Story 4: the old endpoint is gone ──

	// FR-017
	t.Run("when a caller invokes the removed presence update endpoint", func(t *testing.T) {
		stale := w.withEmployee()
		connID := dbuuid.MustParse(w.establishSSE(stale))
		w.sendPong(stale, pongRequest{
			ConnectionID: connID.String(),
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})
		before, _, _ := w.connectionRow(connID)

		code, err := w.callRemovedUpdatePresenceStatus(stale, connID.String())

		t.Run("the call fails as unimplemented", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodeUnimplemented, code,
				"the method is gone from the published contract, not merely deprecated")
		})

		t.Run("no presence record is modified", func(t *testing.T) {
			after, _, _ := w.connectionRow(connID)
			assert.Equal(t, before, after)
		})
	})

	// FR-020: read surfaces keep working unchanged
	t.Run("when presence is read after the protocol change", func(t *testing.T) {
		// withUsersFromDifferentOrgs above re-pointed the world at a new organization,
		// so this group needs a viewer from the current one rather than the outer
		// colleague.
		readable := w.withEmployee()
		viewer := w.withEmployee()
		connID := w.establishSSE(readable)
		w.sendPong(readable, pongRequest{
			ConnectionID: connID,
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})

		t.Run("single employee lookup returns the same shape as before", func(t *testing.T) {
			p := w.getPresence(viewer, readable.ID)

			require.NotNil(t, p)
			assert.Equal(t, readable.ID.String(), p.EmployeeId)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, p.Status)
			// The proto field keeps its name and number; last_pong_at fills it now.
			require.NotNil(t, p.LastHeartbeat)
			assert.WithinDuration(t, time.Now(), p.LastHeartbeat.AsTime(), time.Minute)
		})

		t.Run("batch lookup returns the same shape as before", func(t *testing.T) {
			batch := w.getBatchPresence(viewer, readable.ID, viewer.ID)

			require.Len(t, batch, 2)
			byID := make(map[string]*rpcv1.EmployeePresence, len(batch))
			for _, p := range batch {
				byID[p.EmployeeId] = p
			}
			require.Contains(t, byID, readable.ID.String())
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, byID[readable.ID.String()].Status)
		})

		t.Run("presence visibility settings still apply to both", func(t *testing.T) {
			w.setPresenceVisibility(readable, rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE, "", "")

			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
				w.getPresence(viewer, readable.ID).Status)

			batch := w.getBatchPresence(viewer, readable.ID)
			require.Len(t, batch, 1)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE, batch[0].Status)
		})
	})

	// ── Protocol mechanics: batching and multi-instance behavior ──

	// FR-026, and the batcher design (research R3)
	t.Run("when many pongs arrive at once", func(t *testing.T) {
		t.Run("every pong receives its own directive", func(t *testing.T) {
			burst := w.withEmployee()
			const connections = 12

			connIDs := make([]string, connections)
			for i := range connIDs {
				connIDs[i] = w.establishSSE(burst)
			}

			directives := w.sendPongsConcurrently(burst, connIDs)

			require.Len(t, directives, connections)
			for i, directive := range directives {
				assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_ACK, directive,
					"connection %d was not resolved from its own flush result", i)
			}
		})

		t.Run("pongs for several organizations are recorded correctly", func(t *testing.T) {
			// The batch is grouped by organization before it reaches SQL, so each
			// statement stays shard-local (Constitution I).
			orgAUser, orgBUser := w.withUsersFromDifferentOrgs()
			connA := dbuuid.MustParse(w.establishSSE(orgAUser))
			connB := dbuuid.MustParse(w.establishSSE(orgBUser))

			results := w.sendPongsConcurrentlyForUsers([]pongCall{
				{Actor: orgAUser, Request: pongRequest{ConnectionID: connA.String(), Status: rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE}},
				{Actor: orgBUser, Request: pongRequest{ConnectionID: connB.String(), Status: rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE}},
			})

			require.Len(t, results, 2)
			assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_ACK, results[0])
			assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_ACK, results[1])

			statusA, _, _ := w.connectionRow(connA)
			statusB, _, _ := w.connectionRow(connB)
			assert.Equal(t, notification.PresenceStatusIdle, statusA)
			assert.Equal(t, notification.PresenceStatusOnline, statusB)
		})

		t.Run("a pong for a removed connection in a mixed batch still returns reconnect", func(t *testing.T) {
			mixed := w.withEmployee()
			liveConn := w.establishSSE(mixed)
			deadConn := dbuuid.Must().String()

			results := w.sendPongsConcurrentlyForUsers([]pongCall{
				{Actor: mixed, Request: pongRequest{ConnectionID: liveConn, Status: rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE}},
				{Actor: mixed, Request: pongRequest{ConnectionID: deadConn, Status: rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE}},
			})

			require.Len(t, results, 2)
			assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_ACK, results[0])
			assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_RECONNECT, results[1],
				"each waiter is resolved from the RETURNING set, not from the batch as a whole")
		})
	})

	// FR-024: connections outliving their owner or their instance
	t.Run("when the instance that owned a connection is gone", func(t *testing.T) {
		orphaned := w.withEmployee()
		orphanViewer := w.withEmployee()
		// No instance is running under this id: nothing will ever announce its death.
		connID := w.insertStaleConnection(orphaned.ID, 5*time.Second, "instance-that-no-longer-exists")

		t.Run("the connection expires on the same timetable as any other silent connection", func(t *testing.T) {
			w.setConnectionLastPongAt(connID, responsiveWindow+10*time.Second)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
				w.getPresence(orphanViewer, orphaned.ID).Status)

			w.setConnectionLastPongAt(connID, removalWindow+10*time.Second)
			w.deleteExpiredConnections()
			assert.False(t, w.connectionExists(connID))
		})

		t.Run("no client announcement is required to clear it", func(t *testing.T) {
			// The row above was never departed from and never pongged for; silence
			// alone was enough.
			assert.False(t, w.connectionExists(connID))
		})
	})
}

func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}

// The two scenarios below are top-level tests rather than subtests of
// TestPresencePingPong because each has to wait out real PingIntervalSeconds
// challenges from the server. Nested as subtests they ran one after the other and
// made this file the critical path of the whole package; as parallel top-level tests
// their waits overlap with each other and with every other test.

// FR-001, FR-002: the server challenges and the client answers
func TestPresencePingChallenge(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	stream, connIDStr, cancel := w.openNotificationStream(owner, 3*notification.PingIntervalSeconds*time.Second)
	defer cancel()
	connID := dbuuid.MustParse(connIDStr)

	first := w.awaitPingEvent(stream)
	second := w.awaitPingEvent(stream)

	t.Run("it receives ping events on the stream", func(t *testing.T) {
		require.NotNil(t, first)
		assert.Equal(t, notification.EventTypePing, first.EventType)
	})

	t.Run("each ping carries the connection id and a unique event id", func(t *testing.T) {
		assert.Equal(t, connIDStr, first.ConnectionId)
		assert.Equal(t, connIDStr, second.ConnectionId)
		assert.NotEmpty(t, first.EventId)
		assert.NotEqual(t, first.EventId, second.EventId,
			"the event id IS the ping id and must be unique per challenge")
	})

	t.Run("answering a ping records the pong and returns ACK", func(t *testing.T) {
		w.setConnectionLastPongAt(connID, 30*time.Second)

		directive := w.sendPong(owner, pongRequest{
			ConnectionID: connIDStr,
			PingID:       second.EventId,
			Status:       rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
		})

		assert.Equal(t, rpcv1.PongDirective_PONG_DIRECTIVE_ACK, directive)
		assert.Less(t, w.connectionLastPongAge(connID), 5*time.Second,
			"the pong must advance liveness to the database's own clock")
	})
}

// FR-003: liveness comes only from pongs — the regression guard for the original defect
func TestPresenceLivenessComesOnlyFromPong(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	w.withOwner()
	colleague := w.withEmployee()

	silent := w.withEmployee()
	stream, connIDStr, cancel := w.openNotificationStream(silent, 3*notification.PingIntervalSeconds*time.Second)
	defer cancel()
	connID := dbuuid.MustParse(connIDStr)

	t.Run("the server does not advance the connection's liveness on its own", func(t *testing.T) {
		// Age the row, then let the server send a ping while the client stays
		// silent. If anything server-side still refreshed liveness — the deleted
		// heartbeat write, or the re-registration it triggered — the age would
		// reset here. That reset was the original defect.
		w.setConnectionLastPongAt(connID, 30*time.Second)
		w.awaitPingEvent(stream)

		assert.Greater(t, w.connectionLastPongAge(connID), 25*time.Second,
			"liveness must only ever be advanced by a received pong")
	})

	t.Run("the connection stops counting as present once the window elapses", func(t *testing.T) {
		w.setConnectionLastPongAt(connID, responsiveWindow+5*time.Second)

		assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
			w.getPresence(colleague, silent.ID).Status)
	})
}
