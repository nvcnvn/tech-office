package voice

import (
	"context"
	"log/slog"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
)

// CallWakeDispatcher wakes a person's devices for a live call event.
//
// Declared here rather than imported as a concrete type so internal/voice keeps no
// knowledge of APNs, Firebase or Telecom: this domain decides *that* a call event
// happened, and internal/notification decides how a device learns about it
// (Constitution IV). The notification package's dispatcher satisfies it structurally.
type CallWakeDispatcher interface {
	HasCallWakeTarget(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (bool, error)
	DispatchCallWake(ctx context.Context, tx database.DBTX, req *notification.CallWakeRequest) (*notification.CallWakeResult, error)
}

// emitTerminalCallWake stops every device that is ringing or in this call.
//
// This is the zero-orphan requirement as one function: every path that ends a call —
// caller cancel, decline, remote hang-up, ring timeout, join failure — routes through
// here, so there is no terminal path that forgets to tell the phones. A device left
// showing an incoming call for a call that is over is the worst failure this feature
// has, because the user cannot dismiss it from inside the app.
//
// actingDeviceIdentifier names the handset that caused the ending, when a client told us
// which one it was, and is excluded from the fan-out. That exclusion is not tidiness: on
// iOS the client module reports *every* call wake to CallKit as a new incoming call
// before JavaScript runs, so a wake sent to the phone that just declined rings it again.
// The device that acted has already closed its own call and needs no telling.
//
// It is best-effort by design: a call has already ended by the time this runs, and
// failing the caller's RPC because a push could not be queued would trade a stuck
// screen for a stuck call.
func (l *Logic) emitTerminalCallWake(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, call *database.VoiceCallSession, event, actingDeviceIdentifier string) {
	if l.CallWakeDispatcher == nil || call == nil {
		return
	}
	if !notification.IsTerminalCallWakeEvent(event) {
		slog.ErrorContext(ctx, "refusing to emit a non-terminal event as a terminal call wake",
			"event", event, "call_id", call.ID.String())
		return
	}

	targets, err := l.Queries.ListCallWakeTargetsForCall(ctx, tx, &database.ListCallWakeTargetsForCallParams{
		OrganizationID: orgID,
		CallID:         call.ID.String(),
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to resolve call wake targets for terminal event",
			"error", err, "call_id", call.ID.String(), "event", event)
		return
	}

	// The caller is named on a terminal wake too, even though nothing about the call is
	// left to display. The client module reports every wake to the OS as a new incoming
	// call before JavaScript runs, so a terminal wake always flashes a call on screen for
	// the moment it takes the client to end it. Named, that flash reads as the call that
	// just ended; unnamed, the OS falls back to the handle — the call's own UUID — and the
	// user sees a stranger calling them at the moment they hang up.
	callerName := l.voiceNotificationEmployeeName(ctx, tx, orgID, call.InitiatorEmployeeID)

	for _, target := range targets {
		if _, err := l.CallWakeDispatcher.DispatchCallWake(ctx, tx, &notification.CallWakeRequest{
			OrganizationID:          orgID,
			EmployeeID:              target.EmployeeID,
			RecipientID:             target.RecipientID,
			Event:                   event,
			CallID:                  call.ID,
			CallStartedAt:           call.StartedAt.Time,
			CallerDisplayName:       callerName,
			CallerEmployeeID:        call.InitiatorEmployeeID,
			ExcludeDeviceIdentifier: actingDeviceIdentifier,
		}); err != nil {
			slog.WarnContext(ctx, "failed to dispatch terminal call wake",
				"error", err, "call_id", call.ID.String(), "event", event,
				"employee_id", target.EmployeeID.String())
		}
	}
}

// terminalWakeEventForOutcome maps how a call ended to what the devices are told.
//
// The kinds are not interchangeable: each becomes a different end reason on the OS call
// object, and that is what the user sees in their phone's own call history.
func terminalWakeEventForOutcome(outcome string) string {
	switch outcome {
	case CallOutcomeCancelled:
		return notification.CallWakeEventCancelled
	case CallOutcomeDeclined:
		return notification.CallWakeEventDeclinedElsewhere
	case CallOutcomeAnswered:
		return notification.CallWakeEventAnsweredElsewhere
	default:
		// Missed, completed, and anything else: the call is simply over.
		return notification.CallWakeEventEnded
	}
}

// ringDeadline is when an unanswered call started now would stop ringing.
func ringDeadline(startedAt time.Time) time.Time {
	return startedAt.Add(RingTimeout)
}

// IsCallLive reports whether a call is still ringing or connected.
//
// The call wake dispatcher asks this on its own connection, outside any request
// transaction, immediately before waking a device — see CallLivenessChecker in
// internal/notification.
func (l *Logic) IsCallLive(ctx context.Context, orgID, callID dbuuid.UUID) (bool, error) {
	if l.AdminPool == nil {
		// Without an admin connection there is nothing to check against. Report live:
		// suppressing a real ring is worse than the narrow rolled-back-transaction
		// case this check exists to catch.
		return true, nil
	}
	call, err := l.Queries.GetVoiceCallSession(ctx, l.AdminPool, &database.GetVoiceCallSessionParams{
		OrganizationID: orgID,
		CallSessionID:  callID,
	})
	if err != nil {
		return false, err
	}
	return IsActiveCallState(call.State), nil
}
