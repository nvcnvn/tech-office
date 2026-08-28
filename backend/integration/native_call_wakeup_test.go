package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	"github.com/nvcnvn/tech-office/backend/internal/voice"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Native call wakeup (Feature 037).
//
// What these tests can and cannot prove is worth stating up front. They cover what the
// *backend decided*: which devices it chose to wake, on which tier, what it recorded, and
// what it refused to send. They cannot cover the behaviour the feature is actually for —
// a locked, force-quit phone ringing on its lock screen — because no emulator and no
// Maestro flow can demonstrate that. That is the manual device matrix in
// specs/037-native-call-wakeup/quickstart.md section C, and it gates release.
//
// The push providers are not configured in this environment, so sends fail at the
// provider. That is deliberate: the assertions below are about the decision and its
// audit trail, not about Apple's or Google's availability.

func TestNativeCallWakeupDispatch(t *testing.T) {
	w := newTestWorld(t)
	caller := w.withOwner()
	callee := w.withEmployee()
	dm := w.createOrGetDirectMessage(caller, callee.ID.String())

	t.Run("a call wakes every registered device once", func(t *testing.T) {
		// Arrange: the callee carries two devices — an iPhone that can be woken
		// natively and an Android tablet that cannot.
		w.registerCallWakeDevice(callee, "device-iphone", "ios", true)
		w.registerCallWakeDevice(callee, "device-tablet", "android", false)

		// Act
		call, _ := w.startVoiceCall(caller, dm.Channel.Id)

		// Assert: one audit row per device, each naming the device it was for.
		attempts := w.waitForCallWakeAttempts(call.Id, 2)
		require.GreaterOrEqual(t, len(attempts), 2, "expected one call wake row per device")

		devices := map[string]bool{}
		for _, attempt := range attempts {
			if attempt.Event == notification.CallWakeEventIncoming {
				devices[attempt.DeviceIdentifier] = true
			}
		}
		assert.True(t, devices["device-iphone"], "the iPhone should have been woken")
		assert.True(t, devices["device-tablet"], "the tablet should have been woken")

		w.endVoiceCall(caller, call.Id)
	})

	t.Run("the tier is recorded per device, and never both for one device", func(t *testing.T) {
		// The share of native-tier rows is the measurement behind the epic's ~80%
		// target, so the tier has to be readable per device rather than inferred.
		call, _ := w.startVoiceCall(caller, dm.Channel.Id)
		attempts := w.waitForCallWakeAttempts(call.Id, 2)

		tiersByDevice := map[string]map[string]bool{}
		for _, attempt := range attempts {
			if attempt.Event != notification.CallWakeEventIncoming || attempt.Tier == "" {
				continue
			}
			if tiersByDevice[attempt.DeviceIdentifier] == nil {
				tiersByDevice[attempt.DeviceIdentifier] = map[string]bool{}
			}
			tiersByDevice[attempt.DeviceIdentifier][attempt.Tier] = true
		}

		for device, tiers := range tiersByDevice {
			assert.Len(t, tiers, 1, "device %s was served more than one tier for the same call", device)
		}
		assert.Contains(t, tiersByDevice["device-tablet"], "fallback",
			"a device that cannot run the native tier must fall back, not be dropped")

		w.endVoiceCall(caller, call.Id)
	})

	t.Run("a live SSE connection does not cancel the ring", func(t *testing.T) {
		// FR-002. An open browser tab is not a reason for a phone to stay silent: the
		// person may be nowhere near it. This is the rule that distinguishes a call wake
		// from every other push, which an SSE receipt is allowed to cancel.
		w.establishSSE(callee)

		call, _ := w.startVoiceCall(caller, dm.Channel.Id)
		attempts := w.waitForCallWakeAttempts(call.Id, 1)

		require.NotEmpty(t, attempts, "the wake must be dispatched even with a live connection")
		for _, attempt := range attempts {
			assert.NotEqual(t, notification.FallbackReasonSSEReceiptConfirmed, attempt.Reason,
				"an SSE receipt must never cancel a call wake")
		}

		w.endVoiceCall(caller, call.Id)
	})

	t.Run("a call rings through do-not-disturb and a muted conversation", func(t *testing.T) {
		// FR-016. This is the one requirement that deliberately overrides a user
		// preference, so a regression here is silent: calls would simply stop arriving
		// for anyone who had ever muted anything.
		w.updateChannelNotificationPreference(callee, dm.Channel.Id, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MUTED)

		call, _ := w.startVoiceCall(caller, dm.Channel.Id)
		attempts := w.waitForCallWakeAttempts(call.Id, 1)

		require.NotEmpty(t, attempts, "a muted conversation must not silence a call")
		for _, attempt := range attempts {
			assert.NotEqual(t, notification.FallbackReasonSuppressedByPreference, attempt.Reason,
				"suppressed_by_preference must never appear on a call wake row")
		}

		w.endVoiceCall(caller, call.Id)
	})
}

func TestNativeCallWakeupTerminalEvents(t *testing.T) {
	w := newTestWorld(t)
	caller := w.withOwner()
	callee := w.withEmployee()
	dm := w.createOrGetDirectMessage(caller, callee.ID.String())
	w.registerCallWakeDevice(callee, "device-phone", "ios", true)

	t.Run("cancelling before answer reaches the devices that were rung", func(t *testing.T) {
		// The zero-orphan requirement, at its simplest: a device that was told to ring
		// must be told to stop, or it rings for the full deadline with no way for the
		// user to dismiss it from inside the app.
		call, _ := w.startVoiceCall(caller, dm.Channel.Id)
		w.waitForCallWakeAttempts(call.Id, 1)

		w.endVoiceCall(caller, call.Id)

		attempts := w.waitForCallWakeAttempts(call.Id, 2)
		var terminal []callWakeAttempt
		for _, attempt := range attempts {
			if attempt.Event != "" && attempt.Event != notification.CallWakeEventIncoming {
				terminal = append(terminal, attempt)
			}
		}
		require.NotEmpty(t, terminal, "a cancelled call must send a terminal wake")
		for _, attempt := range terminal {
			assert.True(t, notification.IsTerminalCallWakeEvent(attempt.Event),
				"unexpected event %q on a terminal wake", attempt.Event)
			assert.Equal(t, "device-phone", attempt.DeviceIdentifier,
				"the terminal wake must reach exactly the device that was rung")
		}
	})

	t.Run("the handset that declined is not woken again by its own decline", func(t *testing.T) {
		// The phone that just declined has already closed its own call. Sending it the
		// resulting terminal wake rings it a second time, because the iOS client module
		// reports every call wake to CallKit as a new incoming call before JavaScript
		// runs — there is no client-side way to ignore it. The person's *other* devices
		// still have to be stopped, so the exclusion is per device, not per person.
		w.registerCallWakeDevice(callee, "device-tablet", "ios", true)

		call, _ := w.startVoiceCall(caller, dm.Channel.Id)
		w.waitForCallWakeAttempts(call.Id, 2)
		incoming := w.waitForVoiceIncomingNotificationForCall(callee, call.Id, 5*time.Second)
		invitationID := incoming.GetActionData()["invitationId"]
		require.NotEmpty(t, invitationID)

		w.respondToVoiceCallInviteFromDevice(callee, invitationID,
			rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_DECLINE, "device-phone")

		attempts := w.waitForCallWakeAttempts(call.Id, 3)
		byDevice := map[string][]callWakeAttempt{}
		for _, attempt := range attempts {
			if attempt.Event == "" || attempt.Event == notification.CallWakeEventIncoming {
				continue
			}
			byDevice[attempt.DeviceIdentifier] = append(byDevice[attempt.DeviceIdentifier], attempt)
		}

		require.NotEmpty(t, byDevice["device-tablet"],
			"the person's other device must still be told to stop ringing")
		for _, attempt := range byDevice["device-phone"] {
			assert.Equal(t, notification.FallbackReasonActingDeviceExcluded, attempt.Reason,
				"the declining handset must be recorded as excluded, not sent a wake that rings it again")
		}
	})

	t.Run("the ring deadline is set while ringing and cleared when the call ends", func(t *testing.T) {
		// Nothing bounded a ringing call before this feature; the deadline column is
		// what the sweep claims on, so its absence is a call that rings forever.
		call, _ := w.startVoiceCall(caller, dm.Channel.Id)

		state, _, deadline := w.callSessionRow(call.Id)
		require.Equal(t, voice.CallStateRinging, state)
		require.NotNil(t, deadline, "a ringing call must carry a ring deadline")
		assert.WithinDuration(t, time.Now().Add(voice.RingTimeout), *deadline, 10*time.Second,
			"the deadline should be the ring timeout away, not an arbitrary value")

		w.endVoiceCall(caller, call.Id)

		state, _, deadline = w.callSessionRow(call.Id)
		assert.Equal(t, voice.CallStateEnded, state)
		assert.Nil(t, deadline, "the deadline must be cleared once the call is no longer ringing")
	})

	t.Run("an unanswered call rings out, ends missed, and stops the phones", func(t *testing.T) {
		// US1 scenario 5 and SC-006. Exercised by moving the deadline into the past
		// rather than waiting out the real 45 seconds.
		call, _ := w.startVoiceCall(caller, dm.Channel.Id)
		w.waitForCallWakeAttempts(call.Id, 1)

		w.expireCallRingDeadline(call.Id)

		require.Eventually(t, func() bool {
			state, outcome, _ := w.callSessionRow(call.Id)
			return state == voice.CallStateEnded && outcome == voice.CallOutcomeMissed
		}, 15*time.Second, 250*time.Millisecond, "the sweep should have ended the call as missed")

		attempts := w.waitForCallWakeAttempts(call.Id, 2)
		sawTerminal := false
		for _, attempt := range attempts {
			if notification.IsTerminalCallWakeEvent(attempt.Event) {
				sawTerminal = true
			}
		}
		assert.True(t, sawTerminal, "ringing out must stop the devices, not just end the call record")
	})

	t.Run("a call that rang out is recorded like any other missed call", func(t *testing.T) {
		// FR-020: the conversation must not be able to tell how the call was presented.
		// A call swept by the ring timeout and one LiveKit reported missed have to leave
		// the same trace, or missed-call history depends on which code path fired.
		call, _ := w.startVoiceCall(caller, dm.Channel.Id)
		w.expireCallRingDeadline(call.Id)

		require.Eventually(t, func() bool {
			state, outcome, _ := w.callSessionRow(call.Id)
			return state == voice.CallStateEnded && outcome == voice.CallOutcomeMissed
		}, 15*time.Second, 250*time.Millisecond)

		records := w.listCallRecords(caller, dm.Channel.Id)
		var found bool
		for _, record := range records {
			if record.GetCall().GetId() == call.Id {
				found = true
				break
			}
		}
		assert.True(t, found, "a call that rang out must appear in the conversation's call records")
	})
}

func TestNativeCallWakeupRefusals(t *testing.T) {
	t.Run("a blocked direct call wakes nothing at all", func(t *testing.T) {
		// FR-018. The block guard runs before the transport, so a refused call must
		// leave zero call wake rows — not a wake that was sent and then regretted.
		w := newTestWorld(t)
		blocker := w.withOwner()
		blocked := w.withEmployee()
		dm := w.createOrGetDirectMessage(blocker, blocked.ID.String())
		w.registerCallWakeDevice(blocker, "device-blocker", "ios", true)

		w.blockPerson(blocker, blocked.ID)

		err := w.startVoiceCallError(blocked, dm.Channel.Id)
		require.Error(t, err, "a blocked direct call must be refused")

		// No call exists, so nothing could have been woken. Counted across the whole
		// organisation rather than by call id, since the call was never created.
		assert.Zero(t, w.callWakeAttemptCount(), "a refused call must not have woken any device")
	})

	t.Run("a callee already on a call is reported busy", func(t *testing.T) {
		// FR-015 and the caller-facing half of US3: "busy" and "did not answer" are
		// different outcomes and the caller has to be able to tell them apart.
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		other := w.withEmployee()
		w.registerCallWakeDevice(callee, "device-busy", "ios", true)

		firstDM := w.createOrGetDirectMessage(other, callee.ID.String())
		firstCall, _ := w.startVoiceCall(other, firstDM.Channel.Id)
		w.joinVoiceCall(callee, firstCall.Id)

		secondDM := w.createOrGetDirectMessage(caller, callee.ID.String())
		err := w.startVoiceCallError(caller, secondDM.Channel.Id)
		require.Error(t, err, "calling someone already on a call must be refused")
		assert.Contains(t, err.Error(), "already on a call")

		// The first call is untouched: a second caller must not be able to interrupt it.
		state, _, _ := w.callSessionRow(firstCall.Id)
		assert.NotEqual(t, voice.CallStateEnded, state, "the in-progress call must not be interrupted")
	})

	t.Run("a callee with no wakeable device is unreachable, not left ringing", func(t *testing.T) {
		// FR-006 and SC-006. Ending immediately is the point: a caller who waits out a
		// 45-second ring for a phone that was never going to ring will just re-dial.
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee() // deliberately registers no device
		dm := w.createOrGetDirectMessage(caller, callee.ID.String())

		err := w.startVoiceCallError(caller, dm.Channel.Id)
		require.Error(t, err, "a call to someone with no device must not ring out")
		assert.Contains(t, err.Error(), "cannot be reached")
	})
}

func TestNativeCallWakeTransportIsCallsOnly(t *testing.T) {
	// FR-003, and on iOS a survival requirement rather than hygiene: a VoIP push that
	// does not result in a call reported to CallKit terminates the app. The dispatcher
	// refuses anything that is not a live call event, so a mis-wired caller fails loudly
	// here instead of getting the app killed in the field.
	t.Run("the dispatcher refuses a non-call event kind", func(t *testing.T) {
		for _, event := range []string{"message", "task_assigned", "", "INCOMING", "ring"} {
			assert.False(t, notification.IsValidCallWakeEvent(event),
				"%q must not be dispatchable on the call wake transport", event)
		}
	})

	t.Run("every valid event kind has a defined terminal disposition", func(t *testing.T) {
		// Each kind must map to something the client can act on, because "report the
		// call, then act" has to end in either a ring or a close — never a return.
		valid := []string{
			notification.CallWakeEventIncoming,
			notification.CallWakeEventCancelled,
			notification.CallWakeEventAnsweredElsewhere,
			notification.CallWakeEventDeclinedElsewhere,
			notification.CallWakeEventEnded,
		}
		for _, event := range valid {
			require.True(t, notification.IsValidCallWakeEvent(event))
		}
		assert.False(t, notification.IsTerminalCallWakeEvent(notification.CallWakeEventIncoming),
			"incoming is the only kind that rings rather than closes")
		for _, event := range valid[1:] {
			assert.True(t, notification.IsTerminalCallWakeEvent(event),
				"%s must close the OS call", event)
		}
	})
}

func TestNativeCallWakeupConcurrentSweep(t *testing.T) {
	// Constitution XI. The sweep runs on every instance, so two of them must not both
	// end the same call — that would publish the missed-call chat message twice and send
	// two terminal wakes. The claim and the end are one UPDATE precisely so the row lock
	// settles it.
	w := newTestWorld(t)
	caller := w.withOwner()
	callee := w.withEmployee()
	dm := w.createOrGetDirectMessage(caller, callee.ID.String())
	w.registerCallWakeDevice(callee, "device-sweep", "ios", true)

	call, _ := w.startVoiceCall(caller, dm.Channel.Id)
	w.expireCallRingDeadline(call.Id)

	// Two claims racing on the same expired call, the way two instances would.
	type claimResult struct{ rows int }
	results := make(chan claimResult, 2)
	for range 2 {
		go func() {
			var claimed int
			err := globalDB.QueryRow(context.Background(),
				`WITH claimed AS (
				   UPDATE voice.call_session AS target
				      SET state = 'ended', outcome = 'missed', ended_at = now(),
				          ended_reason = 'ring_timeout', ring_deadline_at = NULL, updated_at = now()
				    WHERE target.organization_id = $1
				      AND target.id IN (
				          SELECT expired.id FROM voice.call_session AS expired
				           WHERE expired.organization_id = $1
				             AND expired.id = $2
				             AND expired.state = 'ringing'
				             AND expired.ring_deadline_at IS NOT NULL
				             AND expired.ring_deadline_at <= now()
				           FOR UPDATE SKIP LOCKED
				      )
				  RETURNING target.id
				 )
				 SELECT count(*) FROM claimed`,
				w.OrgID, dbuuid.MustParse(call.Id)).Scan(&claimed)
			if err != nil {
				claimed = -1
			}
			results <- claimResult{rows: claimed}
		}()
	}

	total := 0
	for range 2 {
		result := <-results
		require.GreaterOrEqual(t, result.rows, 0, "a concurrent claim must not error")
		total += result.rows
	}

	// The real worker may also have claimed it first, in which case neither racer sees
	// it. What must never happen is two claimers both getting the row.
	assert.LessOrEqual(t, total, 1, "the same expired call was ended more than once")

	state, outcome, _ := w.callSessionRow(call.Id)
	assert.Equal(t, voice.CallStateEnded, state)
	assert.Equal(t, voice.CallOutcomeMissed, outcome)
}
