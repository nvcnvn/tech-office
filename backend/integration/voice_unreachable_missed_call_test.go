package integration

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/chat"
	"github.com/nvcnvn/tech-office/backend/internal/voice"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Unreachable callee still gets a missed call (Feature 052).
//
// A direct call to someone with no wakeable device is refused outright rather than left
// ringing. Until this feature the refusal left no trace at all: the caller was told, and
// the person who could not be reached never learned anyone had tried. These scenarios are
// the contract for the record that now gets written instead.
//
// A callee is made unreachable simply by not registering a call-wake device for them,
// which is the same arrangement native_call_wakeup_test.go uses.

func TestUnreachableCalleeStillGetsAMissedCall(t *testing.T) {
	t.Parallel()

	t.Run("when a direct call is refused because the callee cannot be reached", func(t *testing.T) {
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee() // deliberately registers no device
		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id
		wakesBefore := w.callWakeAttemptCount()

		err := w.startVoiceCallError(caller, channelID)

		t.Run("the caller is still refused immediately", func(t *testing.T) {
			// FR-005, SC-003: the bookkeeping must not convert the refusal into
			// something else, and must not make the caller wait out a ring.
			require.Error(t, err, "a call to someone with no device must be refused")
			assert.Contains(t, err.Error(), "cannot be reached")
		})

		records := w.unreachableCallRecordRows(channelID)

		t.Run("a completed call record is written naming the caller and the conversation", func(t *testing.T) {
			// FR-001
			require.Len(t, records, 1, "the refused attempt must leave exactly one record")
			assert.Equal(t, caller.ID, records[0].InitiatorEmployeeID, "the record names who tried")
			assert.Equal(t, channelID, records[0].ChannelID, "the record names the conversation")
		})

		t.Run("the record is missed, with no answer time and no participant", func(t *testing.T) {
			// FR-002, US3.2
			require.Len(t, records, 1)
			assert.Equal(t, voice.CallStateEnded, records[0].State, "the record is finished from the moment it is written")
			assert.Equal(t, voice.CallOutcomeMissed, records[0].Outcome)
			assert.Equal(t, voice.EndedReasonCalleeUnreachable, records[0].EndedReason)
			assert.Nil(t, records[0].AnsweredAt, "nobody answered")
			assert.Nil(t, records[0].RingDeadlineAt, "it never rang, so the sweep must never claim it")
			assert.Equal(t, 0, w.callParticipantCount(records[0].ID), "nobody was invited, rung or connected")
		})

		messages := w.voiceSystemMessages(callee, channelID, chat.SystemEventTypeVoiceCallMissed)

		t.Run("a missed-call system message appears in the direct conversation", func(t *testing.T) {
			// FR-003
			require.Len(t, messages, 1, "the callee's conversation must carry the attempt")
			assert.Equal(t, "Voice call missed", messages[0].GetMessageText())
		})

		t.Run("the message is the same kind the ring-timeout sweep writes", func(t *testing.T) {
			// FR-003: one entry kind for both kinds of missed call, so the conversation
			// reads the same whether the phone rang out or never rang.
			require.Len(t, messages, 1)
			assert.Equal(t, chat.MessageKindSystem, messages[0].GetMessageKind())
			assert.Equal(t, chat.SystemEventTypeVoiceCallMissed, messages[0].GetSystemEventType())
		})

		t.Run("the conversation counts as unread for the callee", func(t *testing.T) {
			// FR-008, SC-002: the whole point is that the callee finds it on their own,
			// without the caller doing anything else.
			assert.GreaterOrEqual(t, w.channelUnreadCount(callee, channelID), int32(1))
		})

		t.Run("no media room is created and no join credentials are issued", func(t *testing.T) {
			// FR-006
			assert.Empty(t, w.liveKitRoomsFor(channelID), "no room may exist for a call that never happened")
		})

		t.Run("the recorded call cannot be joined", func(t *testing.T) {
			// FR-006, SC-004
			require.Len(t, records, 1)
			assert.Error(t, w.joinVoiceCallError(callee, records[0].ID), "an ended record must not be joinable")
			assert.Error(t, w.joinVoiceCallError(caller, records[0].ID))
		})

		t.Run("no device is rung, woken, or pushed to", func(t *testing.T) {
			// FR-007
			assert.Equal(t, wakesBefore, w.callWakeAttemptCount(), "a refused call must wake nothing")
		})
	})

	t.Run("when the call request fails for the caller", func(t *testing.T) {
		// FR-004 is the load-bearing requirement: the refusal is an error, and the
		// request transaction rolls back with it. The record therefore has to be written
		// in a transaction of its own, and this is what proves it was.
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id

		require.Error(t, w.startVoiceCallError(caller, channelID))

		t.Run("the record and the message are both durably stored", func(t *testing.T) {
			// FR-004, SC-001: read back from the database, not from the response the
			// caller never got.
			records := w.unreachableCallRecordRows(channelID)
			require.Len(t, records, 1, "the record must survive the failing request")
			assert.Len(t, w.voiceSystemMessages(callee, channelID, chat.SystemEventTypeVoiceCallMissed), 1,
				"the conversation entry must survive the failing request")
		})

		t.Run("neither is written without the other", func(t *testing.T) {
			// FR-004: both writes share one transaction, so the counts move together.
			records := w.unreachableCallRecordRows(channelID)
			messages := w.voiceSystemMessages(callee, channelID, chat.SystemEventTypeVoiceCallMissed)
			require.Len(t, records, len(messages), "a record without an entry, or an entry without a record, is the failure this asserts against")
			for _, message := range messages {
				assert.Contains(t, message.GetMetadataJson(), records[0].ID,
					"the entry must name the record it came from")
			}
		})
	})

	t.Run("when the same caller is refused three times", func(t *testing.T) {
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id

		for range 3 {
			require.Error(t, w.startVoiceCallError(caller, channelID))
		}

		t.Run("three separate records and three separate messages are written", func(t *testing.T) {
			// FR-011, US1.4: three attempts are three attempts, not one collapsed entry.
			assert.Len(t, w.unreachableCallRecordRows(channelID), 3)
			assert.Len(t, w.voiceSystemMessages(callee, channelID, chat.SystemEventTypeVoiceCallMissed), 3)
		})

		t.Run("each carries its own attempt time", func(t *testing.T) {
			// US1.4: the callee should be able to see when each attempt was made.
			records := w.unreachableCallRecordRows(channelID)
			require.Len(t, records, 3)
			seen := map[string]struct{}{}
			for _, record := range records {
				seen[record.ID] = struct{}{}
				assert.False(t, record.StartedAt.IsZero())
			}
			assert.Len(t, seen, 3, "each attempt is its own record")
		})
	})

	t.Run("when two calls to the same unreachable person are placed simultaneously", func(t *testing.T) {
		// Two attempts at once must not contend: an 'ended' row is outside the partial
		// unique index that keeps one live call per channel, so neither can be lost to
		// the other (FR-011).
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id

		errs := make([]error, 2)
		var wg sync.WaitGroup
		for i := range errs {
			wg.Add(1)
			go func() {
				defer wg.Done()
				errs[i] = w.startVoiceCallError(caller, channelID)
			}()
		}
		wg.Wait()

		t.Run("each attempt is refused", func(t *testing.T) {
			// FR-005
			for _, err := range errs {
				require.Error(t, err)
				assert.Contains(t, err.Error(), "cannot be reached")
			}
		})

		t.Run("each produces exactly one record with a matching conversation entry", func(t *testing.T) {
			// FR-011
			assert.Len(t, w.unreachableCallRecordRows(channelID), 2)
			assert.Len(t, w.voiceSystemMessages(callee, channelID, chat.SystemEventTypeVoiceCallMissed), 2)
		})
	})

	t.Run("when a direct call is refused because the two people have blocked each other", func(t *testing.T) {
		// FR-010, SC-005. The guard order is what makes this structural: the block check
		// runs before the reachability check, so a blocked pair can never reach the code
		// that writes a record — and a record would tell the blocked caller their target
		// exists and is reachable.
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id
		w.blockPerson(callee, caller.ID)

		require.Error(t, w.startVoiceCallError(caller, channelID))

		t.Run("no call record is written", func(t *testing.T) {
			assert.Empty(t, w.unreachableCallRecordRows(channelID))
		})

		t.Run("no conversation entry is written for either side", func(t *testing.T) {
			assert.Empty(t, w.voiceSystemMessages(callee, channelID, chat.SystemEventTypeVoiceCallMissed))
			assert.Empty(t, w.voiceSystemMessages(caller, channelID, chat.SystemEventTypeVoiceCallMissed))
		})
	})

	t.Run("when a direct call is refused because the callee is busy", func(t *testing.T) {
		// Assumption 1: busy is a different refusal with a different meaning. The callee
		// is at their device and will see the call in their own UI; a record would be a
		// second, duplicate signal.
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		other := w.withEmployee()
		w.registerCallWakeDevice(callee, "device-busy-052", "ios", true)

		firstChannelID := w.createOrGetDirectMessage(other, callee.ID.String()).Channel.Id
		firstCall, _ := w.startVoiceCall(other, firstChannelID)
		w.joinVoiceCall(callee, firstCall.Id)

		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id
		err := w.startVoiceCallError(caller, channelID)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "already on a call")

		t.Run("no record and no conversation entry are written", func(t *testing.T) {
			assert.Empty(t, w.unreachableCallRecordRows(channelID))
			assert.Empty(t, w.voiceSystemMessages(callee, channelID, chat.SystemEventTypeVoiceCallMissed))
		})

		w.endVoiceCall(other, firstCall.Id)
	})

	t.Run("when the callee can be reached", func(t *testing.T) {
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		w.registerCallWakeDevice(callee, "device-reachable-052", "android", true)
		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id

		t.Run("the call rings as an ordinary call and produces no unreachable record", func(t *testing.T) {
			call, credentials := w.startVoiceCall(caller, channelID)
			require.NotNil(t, credentials, "a reachable callee gets a real call with real credentials")
			state, _, ringDeadline := w.callSessionRow(call.Id)
			assert.Equal(t, voice.CallStateRinging, state)
			assert.NotNil(t, ringDeadline, "an ordinary call rings, so it carries a deadline")
			assert.Empty(t, w.unreachableCallRecordRows(channelID))

			w.endVoiceCall(caller, call.Id)
		})
	})

	t.Run("when a call is placed in a shared channel", func(t *testing.T) {
		// The reachability check applies only to direct conversations, where the callee
		// is known before the call exists. In a shared channel there is no single callee
		// to be unreachable.
		w := newTestWorld(t)
		caller := w.withOwner()
		member := w.withEmployee() // no device, and it must not matter
		channelID := w.createChannel(caller, "voice-shared-052", false)
		w.inviteToChannel(caller, channelID, member.ID)

		t.Run("no unreachable record can be produced", func(t *testing.T) {
			call, _ := w.startVoiceCall(caller, channelID)
			assert.Empty(t, w.unreachableCallRecordRows(channelID))
			w.endVoiceCall(caller, call.Id)
		})
	})

	t.Run("when a call was recorded as unreachable", func(t *testing.T) {
		// FR-014, SC-004: an 'ended' row sits outside idx_voice_call_active_per_channel,
		// so the bookkeeping cannot wedge the conversation shut.
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id
		require.Error(t, w.startVoiceCallError(caller, channelID))
		require.Len(t, w.unreachableCallRecordRows(channelID), 1)

		t.Run("the conversation reports no active call", func(t *testing.T) {
			_, hasActive := w.getActiveVoiceCall(caller, channelID)
			assert.False(t, hasActive, "a record of an attempt is not a call in progress")
		})

		t.Run("a subsequent call in the same conversation starts normally", func(t *testing.T) {
			w.registerCallWakeDevice(callee, "device-next-052", "android", true)
			call, credentials := w.startVoiceCall(caller, channelID)
			require.NotNil(t, credentials)
			state, _, _ := w.callSessionRow(call.Id)
			assert.Equal(t, voice.CallStateRinging, state)
			w.endVoiceCall(caller, call.Id)
		})
	})

	t.Run("when the conversation's call history is read", func(t *testing.T) {
		// US3, FR-009, SC-006. Two missed calls that mean different things: one rang a
		// phone nobody picked up, one never reached a phone at all. The reader has to be
		// able to tell them apart, which is what puts ended_reason on the wire.
		w := newTestWorld(t)
		caller := w.withOwner()
		callee := w.withEmployee()
		channelID := w.createOrGetDirectMessage(caller, callee.ID.String()).Channel.Id

		// A call that rang out: the callee has a device, so the call rings, and its
		// deadline is moved into the past rather than waiting out the real 45 seconds.
		w.registerCallWakeDevice(callee, "device-history-052", "android", true)
		rangOut, _ := w.startVoiceCall(caller, channelID)
		w.expireCallRingDeadline(rangOut.Id)
		require.Eventually(t, func() bool {
			state, outcome, _ := w.callSessionRow(rangOut.Id)
			return state == voice.CallStateEnded && outcome == voice.CallOutcomeMissed
		}, 15*time.Second, 250*time.Millisecond, "the sweep should have ended the ringing call as missed")

		// A call that never reached a device: the same callee, with every device gone.
		w.removeCallWakeDevices(callee)
		require.Error(t, w.startVoiceCallError(caller, channelID))
		unreachableRecords := w.unreachableCallRecordRows(channelID)
		require.Len(t, unreachableRecords, 1)

		history := map[string]*rpcv1.VoiceCallSession{}
		for _, record := range w.listCallRecords(caller, channelID) {
			history[record.GetCall().GetId()] = record.GetCall()
		}

		t.Run("a call that rang out and one that never reached a device are both missed", func(t *testing.T) {
			// US3.1: the outcome is deliberately the same. Both were missed.
			require.Contains(t, history, rangOut.Id)
			require.Contains(t, history, unreachableRecords[0].ID)
			assert.Equal(t, rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_MISSED, history[rangOut.Id].GetOutcome())
			assert.Equal(t, rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_MISSED, history[unreachableRecords[0].ID].GetOutcome())
		})

		t.Run("each carries a distinct recorded reason", func(t *testing.T) {
			// FR-009, SC-006
			require.Contains(t, history, rangOut.Id)
			require.Contains(t, history, unreachableRecords[0].ID)
			assert.Equal(t, voice.EndedReasonRingTimeout, history[rangOut.Id].GetEndedReason())
			assert.Equal(t, voice.EndedReasonCalleeUnreachable, history[unreachableRecords[0].ID].GetEndedReason())
		})

		t.Run("the unreachable record shows no answer time and no duration", func(t *testing.T) {
			// US3.2: nothing about it should read as a conversation that took place.
			record := history[unreachableRecords[0].ID]
			require.NotNil(t, record)
			require.NotNil(t, record.GetStartedAt())
			require.NotNil(t, record.GetEndedAt())
			assert.Zero(t, record.GetEndedAt().AsTime().Sub(record.GetStartedAt().AsTime()),
				"a call that never happened has no duration")
			assert.Empty(t, record.GetParticipants(), "nobody was ever in it")
		})
	})
}

// ---------------------------------------------------------------------------
// Assert: unreachable call records
// ---------------------------------------------------------------------------

// unreachableCallRecord is the shape of the row this feature writes, read straight from
// the database because the caller's request failed and returned nothing to assert on.
type unreachableCallRecord struct {
	ID                  string
	ChannelID           string
	InitiatorEmployeeID dbuuid.UUID
	State               string
	Outcome             string
	EndedReason         string
	StartedAt           time.Time
	AnsweredAt          *time.Time
	EndedAt             *time.Time
	RingDeadlineAt      *time.Time
}

func (w *testWorld) unreachableCallRecordRows(channelID string) []unreachableCallRecord {
	w.t.Helper()
	channelUUID, err := dbuuid.Parse(channelID)
	require.NoError(w.t, err)
	rows, err := globalDB.Query(context.Background(),
		`SELECT id, initiator_employee_id, state, COALESCE(outcome, ''), COALESCE(ended_reason, ''),
		        started_at, answered_at, ended_at, ring_deadline_at
		   FROM voice.call_session
		  WHERE organization_id = $1 AND channel_id = $2 AND ended_reason = $3
		  ORDER BY started_at, id`,
		w.OrgID, channelUUID, voice.EndedReasonCalleeUnreachable)
	require.NoError(w.t, err)
	defer rows.Close()

	records := []unreachableCallRecord{}
	for rows.Next() {
		var id dbuuid.UUID
		record := unreachableCallRecord{ChannelID: channelID}
		require.NoError(w.t, rows.Scan(&id, &record.InitiatorEmployeeID, &record.State, &record.Outcome,
			&record.EndedReason, &record.StartedAt, &record.AnsweredAt, &record.EndedAt, &record.RingDeadlineAt))
		record.ID = id.String()
		records = append(records, record)
	}
	require.NoError(w.t, rows.Err())
	return records
}

func (w *testWorld) callParticipantCount(callID string) int {
	w.t.Helper()
	callUUID, err := dbuuid.Parse(callID)
	require.NoError(w.t, err)
	var count int
	require.NoError(w.t, globalDB.QueryRow(context.Background(),
		`SELECT count(*) FROM voice.call_participant
		  WHERE organization_id = $1 AND call_session_id = $2`,
		w.OrgID, callUUID).Scan(&count))
	return count
}

// liveKitRoomsFor names every room reserved for a channel's calls. A refused call must
// reserve none: no room name means no room was ever asked for.
func (w *testWorld) liveKitRoomsFor(channelID string) []string {
	w.t.Helper()
	channelUUID, err := dbuuid.Parse(channelID)
	require.NoError(w.t, err)
	rows, err := globalDB.Query(context.Background(),
		`SELECT livekit_room_name FROM voice.call_session
		  WHERE organization_id = $1 AND channel_id = $2 AND ended_reason IS DISTINCT FROM $3`,
		w.OrgID, channelUUID, voice.EndedReasonCalleeUnreachable)
	require.NoError(w.t, err)
	defer rows.Close()
	names := []string{}
	for rows.Next() {
		var name string
		require.NoError(w.t, rows.Scan(&name))
		names = append(names, name)
	}
	require.NoError(w.t, rows.Err())
	return names
}

// voiceSystemMessages reads the conversation as the given member sees it and keeps only
// the system entries of one event type.
func (w *testWorld) voiceSystemMessages(actor testUser, channelID, systemEventType string) []*rpcv1.Message {
	w.t.Helper()
	matches := []*rpcv1.Message{}
	for _, message := range w.listMessages(actor, channelID) {
		if message.GetSystemEventType() == systemEventType {
			matches = append(matches, message)
		}
	}
	return matches
}

// removeCallWakeDevices takes away every device that could be woken for a call, turning a
// reachable person into an unreachable one inside a single scenario.
func (w *testWorld) removeCallWakeDevices(actor testUser) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`DELETE FROM notification.push_token WHERE organization_id = $1 AND employee_id = $2`,
		w.OrgID, actor.ID)
	require.NoError(w.t, err)
}
