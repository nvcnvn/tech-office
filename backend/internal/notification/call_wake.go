package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"firebase.google.com/go/messaging"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// The call wake dispatcher turns one call event into one wake per device, on the
// transport that device can actually be woken by.
//
// Two transports, because no single one reaches both platforms on a locked, force-quit
// phone: a direct APNs VoIP push on iOS (Firebase will not carry apns-push-type: voip),
// and a high-priority data-only FCM message on Android. A device that can run neither
// falls back to today's already-shipped high-priority ring — tier B — which is why
// covering the last ~20% of devices costs a routing decision rather than a second
// implementation.
//
// The dispatcher owns the tier decision for the whole call, which is what guarantees a
// device is never served both tiers for the same event.
//
// It refuses to emit anything but a live call event. On iOS that is not hygiene: a VoIP
// push that does not result in a call reported to CallKit terminates the app.

// callWakeSendBuffer bounds the queue between the dispatcher and its background sender.
// A full buffer means the providers are far behind; wakes are dropped with an audit row
// rather than blocking a request or a worker tick, because a call wake that arrives
// after its ring deadline is worse than none.
const callWakeSendBuffer = 256

// CallWakePayload is what one call event says, independent of transport.
//
// Only CallerDisplayName and WorkspaceName are human-readable: the lock screen shows
// who is calling and which workspace, and nothing about the conversation (FR-008).
// Terminal events carry the identity fields only.
//
// MUST align with the CallWakePayload type in frontend/packages/apis/src/push-tokens.ts.
type CallWakePayload struct {
	Event          string `json:"event"`
	CallID         string `json:"callId"`
	OrganizationID string `json:"organizationId"`
	Sequence       int64  `json:"sequence"`
	ChannelID      string `json:"channelId,omitempty"`
	// InvitationID lets a device decline through the invitation path rather than
	// ending the call, so a native decline produces the same records a in-app decline
	// does (FR-020). Incoming wakes only.
	InvitationID      string `json:"invitationId,omitempty"`
	CallerDisplayName string `json:"callerDisplayName,omitempty"`
	CallerEmployeeID  string `json:"callerEmployeeId,omitempty"`
	WorkspaceName     string `json:"workspaceName,omitempty"`
	// RingExpiresAt lets a device woken late decide not to ring at all, and bounds the
	// call UI if the terminal wake is lost. RFC 3339.
	RingExpiresAt string `json:"ringExpiresAt,omitempty"`
	// StartedAt is when the call was placed, so the OS call UI can show a correct
	// duration on a device that was woken late. RFC 3339.
	StartedAt string `json:"startedAt,omitempty"`
}

// The wire envelope below is dictated by the client's native module, which parses the
// push and reports the call to the OS *before JavaScript is running*. That native
// parsing is the entire reason a locked, force-quit phone rings at all, so the envelope
// is not ours to choose: every wake — terminal ones included — is shaped as an incoming
// call event, and the client decides from the metadata whether to ring or to end.
//
// On iOS that shape is also a survival requirement. A VoIP push whose payload the
// module cannot parse is reported to CallKit as a *failed* call to avoid the app being
// terminated, which the user sees as a phantom missed call. Sending the shape the
// module expects is what keeps that from happening on every cancel.
//
// This deviates from the flat payload in
// specs/037-native-call-wakeup/contracts/call-wake-payloads.md, which was written before
// the client module was chosen. The field *meanings* are unchanged; only their nesting
// differs, and our fields ride in the module's opaque metadata pass-through.
type callWakeEnvelope struct {
	IncomingCall callWakeIncomingCall `json:"incomingCall"`
}

type callWakeIncomingCall struct {
	// EventID dedups a repeated push. One per wake, not per call.
	EventID string `json:"eventId"`
	// ServerCallID is our call id. The OS assigns its own separate call UUID.
	ServerCallID string `json:"serverCallId"`
	// HasVideo is always false: video is out of scope for this feature, and the module
	// requires the field.
	HasVideo  bool              `json:"hasVideo"`
	StartedAt string            `json:"startedAt,omitempty"`
	Caller    callWakeCaller    `json:"caller"`
	Metadata  map[string]string `json:"metadata"`
}

type callWakeCaller struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName,omitempty"`
}

// callWakeEventKey is the metadata key the client reads to decide whether this wake
// rings a phone or stops one. Mirrored by the mobile client's native-call layer.
const callWakeEventKey = "event"

// toEnvelope maps the logical payload onto the module's wire format.
func (p *CallWakePayload) toEnvelope(eventID string) callWakeEnvelope {
	metadata := map[string]string{
		callWakeEventKey: p.Event,
		"organizationId": p.OrganizationID,
		"sequence":       strconv.FormatInt(p.Sequence, 10),
	}
	if p.ChannelID != "" {
		metadata["channelId"] = p.ChannelID
	}
	if p.InvitationID != "" {
		metadata["invitationId"] = p.InvitationID
	}
	if p.WorkspaceName != "" {
		metadata["workspaceName"] = p.WorkspaceName
	}
	if p.RingExpiresAt != "" {
		metadata["ringExpiresAt"] = p.RingExpiresAt
	}
	return callWakeEnvelope{
		IncomingCall: callWakeIncomingCall{
			EventID:      eventID,
			ServerCallID: p.CallID,
			HasVideo:     false,
			StartedAt:    p.StartedAt,
			Caller: callWakeCaller{
				// A terminal wake names no caller — there is nothing left to display —
				// but the module requires an id, so the call itself stands in.
				ID:          callWakeCallerID(p),
				DisplayName: p.CallerDisplayName,
			},
			Metadata: metadata,
		},
	}
}

func callWakeCallerID(p *CallWakePayload) string {
	if p.CallerEmployeeID != "" {
		return p.CallerEmployeeID
	}
	return p.CallID
}

// CallWakeRequest is one call event for one person, to be fanned out across their
// devices.
type CallWakeRequest struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	// RecipientID anchors the delivery audit. Every wake for a call — incoming and
	// terminal alike — reuses the incoming call notification's recipient row.
	RecipientID dbuuid.UUID
	Event       string
	CallID      dbuuid.UUID
	ChannelID   dbuuid.UUID
	// CallStartedAt is the origin for Sequence. Sequences are milliseconds since the
	// call started, so they increase per call without a shared counter and stay
	// comparable across the instances that emit them.
	CallStartedAt     time.Time
	RingExpiresAt     time.Time
	CallerDisplayName string
	CallerEmployeeID  dbuuid.UUID
	WorkspaceName     string
	// ExcludeDeviceIdentifier names a device that must not be sent this wake, because it
	// is the one that caused the event. The client module reports every call wake to
	// CallKit as a new incoming call before JavaScript runs, so a terminal wake sent
	// back to the handset that just answered or declined rings it a second time.
	ExcludeDeviceIdentifier string
	// InvitationID is the pending invite this wake rings for. Carried so a device that
	// declines from the lock screen can answer the invitation instead of ending the
	// call, which is what makes a native decline record a decline rather than a cancel.
	InvitationID dbuuid.UUID
}

// CallWakeResult reports what the dispatcher decided, so a caller can turn "nobody
// could be woken" into an immediate unreachable verdict rather than a 45-second ring.
type CallWakeResult struct {
	// DevicesTargeted counts devices that were handed to a transport, on either tier.
	DevicesTargeted int
	// NativeTierDevices counts the subset served the native tier. The share of these
	// across all wakes is the measurement behind the epic's ~80% target.
	NativeTierDevices int
}

// CallWakeDispatcher fans a call event out to a person's devices.
//
// internal/voice depends on this interface and never on APNs, Firebase or Telecom
// (Constitution IV).
type CallWakeDispatcher interface {
	// HasCallWakeTarget reports whether this person has any device that could be woken
	// for a call. It reads only, so a caller can ask inside its own transaction before
	// deciding to ring (FR-006, SC-006).
	HasCallWakeTarget(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (bool, error)

	// DispatchCallWake resolves the person's devices, chooses a tier for each, records
	// one delivery attempt per device, and hands the sends to a background sender.
	//
	// Provider I/O deliberately does not happen on the caller's goroutine: it would sit
	// inside the caller's transaction, which is the stall this notification pipeline was
	// restructured to avoid.
	DispatchCallWake(ctx context.Context, tx database.DBTX, req *CallWakeRequest) (*CallWakeResult, error)
}

// CallLivenessChecker answers whether a call is still live.
//
// The background sender asks before every send. It closes the window where a caller's
// transaction rolls back after the dispatcher queued a wake — without the check, a
// device would ring for a call that never existed and then wait out the full ring
// deadline for a terminal wake that is never coming.
type CallLivenessChecker interface {
	IsCallLive(ctx context.Context, orgID, callID dbuuid.UUID) (bool, error)
}

type callWakeDispatcher struct {
	queries   *database.Queries
	adminPool database.AdminDatabaseConnector
	voipSSend APNsVoIPSender
	fcmClient *messaging.Client
	// pushLogic serves tier B: today's high-priority alert ring, unchanged.
	pushLogic  PushLogic
	liveness   CallLivenessChecker
	instanceID string

	sends chan callWakeSend
}

// callWakeSend is one resolved wake, ready to leave the building. It carries no
// database handles: everything the sender needs was resolved while the caller's
// transaction was open.
type callWakeSend struct {
	orgID       dbuuid.UUID
	employeeID  dbuuid.UUID
	recipientID dbuuid.UUID
	callID      dbuuid.UUID
	tokenID     dbuuid.UUID
	deviceID    string
	tokenType   string
	token       string
	tier        string
	event       string
	// eventID dedups this one wake on the device. Generated per wake, not per call.
	eventID    string
	payload    *CallWakePayload
	expiration time.Time
}

const (
	callWakeTierNative   = "native"
	callWakeTierFallback = "fallback"
)

// NewCallWakeDispatcher builds the dispatcher and starts its background sender.
//
// voipSender and fcmClient may each be nil; a device whose transport is unconfigured
// falls to tier B and says so in its audit row, rather than the ring failing.
func NewCallWakeDispatcher(
	ctx context.Context,
	queries *database.Queries,
	adminPool database.AdminDatabaseConnector,
	voipSender APNsVoIPSender,
	fcmClient *messaging.Client,
	pushLogic PushLogic,
	liveness CallLivenessChecker,
	instanceID string,
) CallWakeDispatcher {
	d := &callWakeDispatcher{
		queries:    queries,
		adminPool:  adminPool,
		voipSSend:  voipSender,
		fcmClient:  fcmClient,
		pushLogic:  pushLogic,
		liveness:   liveness,
		instanceID: instanceID,
		sends:      make(chan callWakeSend, callWakeSendBuffer),
	}
	go d.runSender(ctx)
	return d
}

func (d *callWakeDispatcher) HasCallWakeTarget(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (bool, error) {
	tokens, err := d.queries.GetEmployeeCallWakeTokens(ctx, tx, &database.GetEmployeeCallWakeTokensParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		return false, fmt.Errorf("failed to resolve call wake targets: %w", err)
	}
	if len(tokens) > 0 {
		return true, nil
	}

	// A push token is not the only way to reach someone. Somebody sitting in front of an
	// open browser is reachable over their live connection even with no device
	// registered, and refusing the call would be plainly wrong to both parties.
	// "Unreachable" has to mean nothing at all can reach them (FR-006), not "no phone".
	connections, err := d.queries.GetEmployeeActiveConnections(ctx, tx, &database.GetEmployeeActiveConnectionsParams{
		OrganizationID:          orgID,
		EmployeeID:              employeeID,
		ResponsiveWindowSeconds: ResponsiveWindowSeconds,
	})
	if err != nil {
		return false, fmt.Errorf("failed to check live connections for call reachability: %w", err)
	}
	return len(connections) > 0, nil
}

func (d *callWakeDispatcher) DispatchCallWake(ctx context.Context, tx database.DBTX, req *CallWakeRequest) (*CallWakeResult, error) {
	if req == nil {
		return nil, fmt.Errorf("call wake request required")
	}
	// FR-003, and on iOS a survival requirement: this transport carries live call
	// events and nothing else. Refusing here rather than at the provider means a
	// mis-wired caller fails loudly instead of getting the app terminated in the field.
	if !IsValidCallWakeEvent(req.Event) {
		return nil, fmt.Errorf("refusing to dispatch a call wake for %q: only live call events may use this transport", req.Event)
	}

	now := time.Now().UTC()
	attemptedAt := pgtype.Timestamptz{Time: now, Valid: true}

	tokens, err := d.queries.GetEmployeeCallWakeTokens(ctx, tx, &database.GetEmployeeCallWakeTokensParams{
		OrganizationID: req.OrganizationID,
		EmployeeID:     req.EmployeeID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to resolve call wake targets: %w", err)
	}

	if len(tokens) == 0 {
		if err := d.recordAttempt(ctx, tx, req, dbuuid.UUID{}, "", "skipped", FallbackReasonNoCallWakeTarget, attemptedAt, nil); err != nil {
			return nil, err
		}
		slog.InfoContext(ctx, "call wake had no target device",
			"call_id", req.CallID.String(),
			"employee_id", req.EmployeeID.String(),
			"event", req.Event,
		)
		return &CallWakeResult{}, nil
	}

	payload := &CallWakePayload{
		Event:          req.Event,
		CallID:         req.CallID.String(),
		OrganizationID: req.OrganizationID.String(),
		Sequence:       callWakeSequence(req.CallStartedAt, now),
	}
	// Only the incoming wake describes the call. Terminal events say what happened and
	// to which call, and nothing a lock screen could render.
	if req.Event == CallWakeEventIncoming {
		payload.ChannelID = req.ChannelID.String()
		if req.InvitationID != (dbuuid.UUID{}) {
			payload.InvitationID = req.InvitationID.String()
		}
		payload.CallerDisplayName = req.CallerDisplayName
		payload.CallerEmployeeID = req.CallerEmployeeID.String()
		payload.WorkspaceName = req.WorkspaceName
		if !req.RingExpiresAt.IsZero() {
			payload.RingExpiresAt = req.RingExpiresAt.UTC().Format(time.RFC3339)
		}
		if !req.CallStartedAt.IsZero() {
			payload.StartedAt = req.CallStartedAt.UTC().Format(time.RFC3339)
		}
	}

	result := &CallWakeResult{}
	for _, device := range groupCallWakeDevices(tokens) {
		send, reason := d.planDevice(device, req, payload)
		if send == nil {
			if err := d.recordAttempt(ctx, tx, req, device.tokenID(), device.deviceIdentifier, "skipped", reason, attemptedAt, map[string]string{
				"event":            req.Event,
				"deviceIdentifier": device.deviceIdentifier,
			}); err != nil {
				return nil, err
			}
			continue
		}

		result.DevicesTargeted++
		if send.tier == callWakeTierNative {
			result.NativeTierDevices++
		}
		if err := d.recordAttempt(ctx, tx, req, send.tokenID, send.deviceID, "queued", reason, attemptedAt, map[string]string{
			"event":            req.Event,
			"deviceIdentifier": send.deviceID,
			"tier":             send.tier,
			"tokenType":        send.tokenType,
			"sequence":         strconv.FormatInt(payload.Sequence, 10),
		}); err != nil {
			return nil, err
		}

		select {
		case d.sends <- *send:
		default:
			// The sender is saturated. Say so in the audit rather than blocking a
			// request or a worker tick behind a provider that is already behind.
			slog.ErrorContext(ctx, "call wake send buffer is full - dropping wake",
				"call_id", req.CallID.String(),
				"device_identifier", send.deviceID,
				"event", req.Event,
			)
			if err := d.recordAttempt(ctx, tx, req, send.tokenID, send.deviceID, "failed", FallbackReasonDeliveryError, attemptedAt, map[string]string{
				"event": req.Event,
				"error": "call_wake_send_buffer_full",
			}); err != nil {
				return nil, err
			}
			result.DevicesTargeted--
			if send.tier == callWakeTierNative {
				result.NativeTierDevices--
			}
		}
	}

	slog.InfoContext(ctx, "call wake dispatched",
		"call_id", req.CallID.String(),
		"employee_id", req.EmployeeID.String(),
		"event", req.Event,
		"sequence", payload.Sequence,
		"devices_targeted", result.DevicesTargeted,
		"native_tier_devices", result.NativeTierDevices,
	)

	return result, nil
}

// callWakeDevice is one physical device: the rows sharing a device_identifier.
type callWakeDevice struct {
	deviceIdentifier  string
	platform          string
	nativeCallCapable bool
	fcm               *database.GetEmployeeCallWakeTokensRow
	voip              *database.GetEmployeeCallWakeTokensRow
}

func (d callWakeDevice) tokenID() dbuuid.UUID {
	if d.voip != nil {
		return d.voip.TokenID
	}
	if d.fcm != nil {
		return d.fcm.TokenID
	}
	return dbuuid.UUID{}
}

// groupCallWakeDevices collapses token rows into devices. Fanning out per device rather
// than per token is what lets the audit say "her iPhone rang and her Android tablet did
// not", and is why both of a device's tokens share one device_identifier.
func groupCallWakeDevices(rows []*database.GetEmployeeCallWakeTokensRow) []callWakeDevice {
	order := make([]string, 0, len(rows))
	byDevice := make(map[string]*callWakeDevice, len(rows))

	for _, row := range rows {
		device, ok := byDevice[row.DeviceIdentifier]
		if !ok {
			device = &callWakeDevice{deviceIdentifier: row.DeviceIdentifier}
			byDevice[row.DeviceIdentifier] = device
			order = append(order, row.DeviceIdentifier)
		}
		var metadata pushTokenMetadata
		if err := json.Unmarshal(row.TokenMetadata, &metadata); err == nil {
			if metadata.Platform != "" {
				device.platform = metadata.Platform
			}
			// Any row for the device asserting capability is enough: the client sets it
			// per registration and both of a device's rows are written by the same build.
			device.nativeCallCapable = device.nativeCallCapable || metadata.NativeCallCapable
		}
		switch row.TokenType {
		case PushTokenTypeAPNSVoIP:
			device.voip = row
		case PushTokenTypeFCM:
			device.fcm = row
		}
	}

	devices := make([]callWakeDevice, 0, len(order))
	for _, id := range order {
		devices = append(devices, *byDevice[id])
	}
	return devices
}

// planDevice picks exactly one transport for one device, or none.
//
// Tier A is a VoIP push on iOS and a data-only high-priority FCM message on Android.
// Everything else is tier B: today's alert ring, which the fallback path sends through
// PushLogic exactly as it does now. A device is never planned onto both.
func (d *callWakeDispatcher) planDevice(device callWakeDevice, req *CallWakeRequest, payload *CallWakePayload) (*callWakeSend, string) {
	// The handset that answered, declined or hung up has already closed its own call and
	// must not be told again: the iOS client module reports every call wake to CallKit as
	// a new incoming call before JavaScript runs, so this wake would ring it a second
	// time. Recorded as a skip rather than dropped silently, so the guarantee of one row
	// per device per event still holds.
	if req.ExcludeDeviceIdentifier != "" && device.deviceIdentifier == req.ExcludeDeviceIdentifier {
		return nil, FallbackReasonActingDeviceExcluded
	}

	base := callWakeSend{
		orgID:       req.OrganizationID,
		employeeID:  req.EmployeeID,
		recipientID: req.RecipientID,
		callID:      req.CallID,
		deviceID:    device.deviceIdentifier,
		event:       req.Event,
		eventID:     dbuuid.Must().String(),
		payload:     payload,
		expiration:  req.RingExpiresAt,
	}

	if device.nativeCallCapable {
		if device.voip != nil && d.voipSSend != nil {
			base.tokenID = device.voip.TokenID
			base.tokenType = PushTokenTypeAPNSVoIP
			base.token = device.voip.FcmToken
			base.tier = callWakeTierNative
			return &base, ""
		}
		// Android carries the native tier over its FCM token; what makes it the native
		// tier is the data-only high-priority payload shape, not a separate token.
		if device.platform == "android" && device.fcm != nil && d.fcmClient != nil {
			base.tokenID = device.fcm.TokenID
			base.tokenType = PushTokenTypeFCM
			base.token = device.fcm.FcmToken
			base.tier = callWakeTierNative
			return &base, ""
		}
	}

	if device.fcm != nil {
		base.tokenID = device.fcm.TokenID
		base.tokenType = PushTokenTypeFCM
		base.token = device.fcm.FcmToken
		base.tier = callWakeTierFallback
		return &base, FallbackReasonNativeTierUnavailable
	}

	return nil, FallbackReasonNoCallWakeTarget
}

// callWakeSequence numbers the events of one call.
//
// Milliseconds since the call started: monotonic within a call, needs no shared counter,
// and stays comparable across the instances that emit the events, which are seconds
// apart in practice. The client applies the highest sequence it has seen for a callId
// and ignores the rest, which is what makes a wake that arrives out of order — or twice
// — unable to resurrect a call that is already over.
func callWakeSequence(callStartedAt, now time.Time) int64 {
	if callStartedAt.IsZero() {
		return now.UnixMilli()
	}
	elapsed := now.Sub(callStartedAt).Milliseconds()
	if elapsed < 0 {
		return 0
	}
	return elapsed
}

func (d *callWakeDispatcher) recordAttempt(
	ctx context.Context,
	tx database.DBTX,
	req *CallWakeRequest,
	tokenID dbuuid.UUID,
	deviceIdentifier string,
	status string,
	reason string,
	attemptedAt pgtype.Timestamptz,
	metadata map[string]string,
) error {
	if metadata == nil {
		metadata = map[string]string{"event": req.Event}
	}
	if tokenID != (dbuuid.UUID{}) {
		metadata["tokenId"] = tokenID.String()
	}
	if deviceIdentifier != "" {
		metadata["deviceIdentifier"] = deviceIdentifier
	}
	return d.insertAttempt(ctx, tx, req.OrganizationID, req.RecipientID, status, reason, attemptedAt, metadata)
}

func (d *callWakeDispatcher) insertAttempt(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	recipientID dbuuid.UUID,
	status string,
	reason string,
	attemptedAt pgtype.Timestamptz,
	metadata map[string]string,
) error {
	reasonText := pgtype.Text{Valid: false}
	if reason != "" {
		reasonText = pgtype.Text{String: reason, Valid: true}
	}
	instanceID := pgtype.Text{Valid: false}
	if d.instanceID != "" {
		instanceID = pgtype.Text{String: d.instanceID, Valid: true}
	}
	metadataJSON := []byte("{}")
	if len(metadata) > 0 {
		encoded, err := json.Marshal(metadata)
		if err != nil {
			return err
		}
		metadataJSON = encoded
	}
	return d.queries.InsertDeliveryAttempt(ctx, tx, &database.InsertDeliveryAttemptParams{
		OrganizationID:          orgID,
		NotificationRecipientID: recipientID,
		Channel:                 DeliveryChannelCallWake,
		AttemptStatus:           status,
		Reason:                  reasonText,
		AttemptedAt:             attemptedAt,
		InstanceID:              instanceID,
		Metadata:                metadataJSON,
	})
}

// runSender drains the queue. One goroutine, because the ordering it preserves per call
// is worth more than the parallelism it gives up: call volumes are small and each send
// is bounded at 3 seconds.
func (d *callWakeDispatcher) runSender(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			slog.InfoContext(ctx, "stopping call wake sender")
			return
		case send := <-d.sends:
			d.deliver(ctx, send)
		}
	}
}

func (d *callWakeDispatcher) deliver(ctx context.Context, send callWakeSend) {
	now := pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}

	// The caller's transaction may have rolled back after this wake was queued. Ringing
	// a phone for a call that does not exist leaves it ringing until its deadline, so
	// confirm the call is still live before waking anything. Terminal events are exempt:
	// their whole purpose is to reach a device about a call that is already over.
	if send.event == CallWakeEventIncoming && d.liveness != nil {
		live, err := d.liveness.IsCallLive(ctx, send.orgID, send.callID)
		if err != nil {
			slog.WarnContext(ctx, "failed to confirm call is live before waking a device",
				"error", err, "call_id", send.callID.String())
		} else if !live {
			d.recordSendOutcome(ctx, send, "skipped", FallbackReasonCallAlreadyEnded, now, nil)
			return
		}
	}

	var err error
	switch {
	case send.tier == callWakeTierNative && send.tokenType == PushTokenTypeAPNSVoIP:
		err = d.sendVoIP(ctx, send)
	case send.tier == callWakeTierNative:
		err = d.sendAndroidData(ctx, send)
	default:
		err = d.sendFallbackRing(ctx, send)
	}

	if err != nil {
		slog.ErrorContext(ctx, "call wake send failed",
			"error", err,
			"call_id", send.callID.String(),
			"device_identifier", send.deviceID,
			"tier", send.tier,
			"event", send.event,
		)
		d.recordSendOutcome(ctx, send, "failed", FallbackReasonDeliveryError, now, map[string]string{"error": err.Error()})
		return
	}

	d.recordSendOutcome(ctx, send, "sent", callWakeSentReason(send.tier), now, nil)
}

func callWakeSentReason(tier string) string {
	if tier == callWakeTierFallback {
		return FallbackReasonNativeTierUnavailable
	}
	return ""
}

func (d *callWakeDispatcher) sendVoIP(ctx context.Context, send callWakeSend) error {
	body, err := marshalCallWakePayload(send.payload, send.eventID)
	if err != nil {
		return err
	}
	// The collapse ID is the call: a superseded wake replaces its predecessor in APNs'
	// queue instead of arriving behind it. The expiration is the ring deadline, so a
	// stale wake is dropped by Apple rather than by the app.
	err = d.voipSSend.SendVoIP(ctx, send.token, body, send.callID.String(), send.expiration)
	if err == nil {
		return nil
	}
	if isAPNsUnregistered(err) {
		d.invalidateToken(ctx, send)
	}
	return err
}

func (d *callWakeDispatcher) sendAndroidData(ctx context.Context, send callWakeSend) error {
	data, err := callWakeDataMap(send.payload, send.eventID)
	if err != nil {
		return err
	}

	// Data-only, deliberately: a notification message lets the system draw a tray
	// notification and may not run the app's handler on a killed app, while a data-only
	// high-priority message always dispatches to the messaging service — which is what
	// earns the temporary Doze allowlist and the background foreground-service-start
	// exemption the Telecom call needs.
	ttl := time.Until(send.expiration)
	if ttl <= 0 {
		ttl = time.Second
	}
	message := &messaging.Message{
		Token: send.token,
		Data:  data,
		Android: &messaging.AndroidConfig{
			Priority: "high",
			TTL:      &ttl,
		},
	}

	if _, err := d.fcmClient.Send(ctx, message); err != nil {
		if messaging.IsRegistrationTokenNotRegistered(err) {
			d.invalidateToken(ctx, send)
		}
		return err
	}
	return nil
}

// sendFallbackRing serves tier B: the high-priority alert ring this app already shipped,
// unchanged. A device here gets the older experience, never both tiers.
func (d *callWakeDispatcher) sendFallbackRing(ctx context.Context, send callWakeSend) error {
	if d.pushLogic == nil {
		return fmt.Errorf("push delivery is not configured")
	}
	// Only the incoming event has anything to say on the fallback tier: tier B has no
	// OS call object to tear down, so a terminal event has nothing to do there.
	if send.event != CallWakeEventIncoming {
		return nil
	}
	data := map[string]string{
		"notificationType": NotificationTypeVoiceCallIncoming,
		"callId":           send.payload.CallID,
		"channelId":        send.payload.ChannelID,
	}
	title := fmt.Sprintf("%s is calling", send.payload.CallerDisplayName)
	if send.payload.CallerDisplayName == "" {
		title = "Incoming call"
	}
	return d.pushLogic.SendPushNotification(ctx, send.employeeID, send.orgID, &PushNotificationPayload{
		Title:    title,
		Body:     send.payload.WorkspaceName,
		Data:     data,
		Priority: "high",
	})
}

// callWakeDataMap renders the wake as an FCM data message.
//
// FCM data values are strings only, so the event is JSON-encoded into one value under
// the key the client's messaging service reads. messageType is what routes the message
// to that service instead of to the ordinary notification handler.
func callWakeDataMap(payload *CallWakePayload, eventID string) (map[string]string, error) {
	encoded, err := json.Marshal(payload.toEnvelope(eventID).IncomingCall)
	if err != nil {
		return nil, fmt.Errorf("failed to encode call wake payload: %w", err)
	}
	return map[string]string{
		"messageType":  "incomingCall",
		"incomingCall": string(encoded),
	}, nil
}

func (d *callWakeDispatcher) invalidateToken(ctx context.Context, send callWakeSend) {
	if d.pushLogic == nil {
		return
	}
	if err := d.pushLogic.MarkTokenInvalid(ctx, d.adminPool, send.tokenID, send.orgID); err != nil {
		slog.WarnContext(ctx, "failed to mark unregistered call wake token invalid",
			"error", err, "token_id", send.tokenID.String())
	}
}

func (d *callWakeDispatcher) recordSendOutcome(
	ctx context.Context,
	send callWakeSend,
	status string,
	reason string,
	attemptedAt pgtype.Timestamptz,
	extra map[string]string,
) {
	metadata := map[string]string{
		"event":            send.event,
		"deviceIdentifier": send.deviceID,
		"tier":             send.tier,
		"tokenType":        send.tokenType,
		"tokenId":          send.tokenID.String(),
		"sequence":         strconv.FormatInt(send.payload.Sequence, 10),
	}
	for key, value := range extra {
		metadata[key] = value
	}
	if err := d.insertAttempt(ctx, d.adminPool, send.orgID, send.recipientID, status, reason, attemptedAt, metadata); err != nil {
		slog.WarnContext(ctx, "failed to record call wake delivery attempt",
			"error", err, "call_id", send.callID.String(), "device_identifier", send.deviceID)
	}
}
