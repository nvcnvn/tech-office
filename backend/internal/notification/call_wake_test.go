package notification

import "testing"

// The incoming wake has to carry the invitation, because that is what lets a phone
// declining from its lock screen decline the *invitation* rather than end the call. The
// two are not interchangeable: ending records the call as cancelled, as though the
// caller had hung up, and tells the caller nothing about having been declined.
func TestCallWakeEnvelopeCarriesInvitationForIncomingOnly(t *testing.T) {
	incoming := (&CallWakePayload{
		Event:        CallWakeEventIncoming,
		CallID:       "call-1",
		InvitationID: "invite-1",
		ChannelID:    "channel-1",
	}).toEnvelope("event-1")

	if got := incoming.IncomingCall.Metadata["invitationId"]; got != "invite-1" {
		t.Fatalf("incoming wake metadata invitationId = %q, want %q", got, "invite-1")
	}

	// Terminal wakes name no invitation: there is nothing left to respond to, and the
	// device ends the call it already has.
	terminal := (&CallWakePayload{
		Event:  CallWakeEventCancelled,
		CallID: "call-1",
	}).toEnvelope("event-2")

	if _, present := terminal.IncomingCall.Metadata["invitationId"]; present {
		t.Fatal("terminal wake metadata must not carry an invitationId")
	}
}
