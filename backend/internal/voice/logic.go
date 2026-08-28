package voice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/converter"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type ChannelAuthorizer interface {
	AuthorizeVoiceChannel(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) error

	// DirectMessageCounterpart returns the other person in a direct conversation,
	// or ok=false when the channel is not one. Used to apply the block guard to
	// calls placed in a direct conversation (Feature 036, FR-020).
	DirectMessageCounterpart(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) (dbuuid.UUID, bool, error)
}

// ContactGuard answers whether direct contact between two people is refused
// because one has blocked the other.
//
// Declared here rather than imported so internal/voice keeps no dependency on
// internal/compliance; the compliance logic satisfies it structurally. Group calls
// in shared channels are deliberately untouched: blocking is scoped to direct
// contact because this is a closed workplace tool (research.md R8).
type ContactGuard interface {
	IsDirectContactBlocked(ctx context.Context, tx database.DBTX, orgID, a, b dbuuid.UUID) (bool, error)
}

type MediaClient interface {
	EnsureRoom(ctx context.Context, opts RoomOptions) error
	MintJoinCredentials(ctx context.Context, opts JoinTokenOptions) (*JoinCredentials, error)
	StartRoomRecording(ctx context.Context, opts RecordingOptions) (*RecordingStart, error)
}

type NotificationPublisher interface {
	PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error)
}

type ChatAnnouncer interface {
	AnnounceVoiceCallStarted(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID) error
	AnnounceVoiceCallEnded(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID, outcome string) error
	CreateVoiceMessage(ctx context.Context, tx database.DBTX, orgID, senderID, channelID, voiceMessageID, fileID dbuuid.UUID, durationMs int64, mimeType string, waveformPeaks []float32, sizeBytes int64) (dbuuid.UUID, error)
}

type Logic struct {
	Queries               *database.Queries
	Config                Config
	ChannelAuthorizer     ChannelAuthorizer
	MediaClient           MediaClient
	FileLogic             files.FileLogic
	NotificationPublisher NotificationPublisher
	ChatAnnouncer         ChatAnnouncer
	TranscriptionWorker   *TranscriptionWorker

	// ContactGuard may be nil where the compliance domain is not wired; a nil
	// guard means no block is enforced, never a panic.
	ContactGuard ContactGuard

	// CallWakeDispatcher may be nil, in which case calls still ring through the
	// notification path this feature demoted to tier B — never a panic.
	CallWakeDispatcher CallWakeDispatcher

	// AdminPool backs reads that happen outside any request transaction: the ring
	// timeout sweep, and the liveness check the call wake sender makes before waking a
	// device.
	AdminPool database.AdminDatabaseConnector
}

func NewLogic(queries *database.Queries, channelAuthorizer ChannelAuthorizer, mediaClient MediaClient, config Config) *Logic {
	return &Logic{
		Queries:           queries,
		Config:            config,
		ChannelAuthorizer: channelAuthorizer,
		MediaClient:       mediaClient,
	}
}

func (l *Logic) StartVoiceCall(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID, requestRecording bool) (*rpcv1.VoiceCallSession, *rpcv1.VoiceJoinCredentials, error) {
	if err := l.authorize(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, nil, err
	}
	if err := l.ensureDirectCallAllowed(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, nil, err
	}
	if _, err := l.Queries.GetActiveVoiceCallForChannel(ctx, tx, &database.GetActiveVoiceCallForChannelParams{OrganizationID: orgID, ChannelID: channelID}); err == nil {
		return nil, nil, ErrCallAlreadyActive
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, fmt.Errorf("check active voice call: %w", err)
	}

	// In a direct conversation the callee is known before the call exists, so busy and
	// unreachable are decided here rather than after 45 seconds of ringing. Both are
	// evaluated after the authorization and block guards above: a refused call must
	// never reach a device, and must not leak whether that device could be reached.
	if err := l.ensureDirectCalleeAvailable(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, nil, err
	}

	roomName := makeLiveKitRoomName(orgID, channelID)
	recordingPolicy := "not_allowed"
	if requestRecording {
		recordingPolicy = "allowed"
	}
	// The deadline is written with the row rather than in a second statement: a ringing
	// call with no deadline is a call that rings forever, which is the bug this column
	// exists to prevent.
	ringDeadlineAt := pgtype.Timestamptz{Time: ringDeadline(time.Now().UTC()), Valid: true}
	call, err := l.Queries.CreateVoiceCallSession(ctx, tx, &database.CreateVoiceCallSessionParams{
		OrganizationID:      orgID,
		ChannelID:           channelID,
		InitiatorEmployeeID: employeeID,
		LivekitRoomName:     roomName,
		State:               CallStateRinging,
		RecordingPolicy:     recordingPolicy,
		RecordingStatus:     ArtifactStatusUnavailable,
		TranscriptStatus:    ArtifactStatusUnavailable,
		RingDeadlineAt:      ringDeadlineAt,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, nil, ErrCallAlreadyActive
		}
		return nil, nil, fmt.Errorf("create voice call session: %w", err)
	}

	if err := l.MediaClient.EnsureRoom(ctx, RoomOptions{
		OrganizationID: orgID,
		ChannelID:      channelID,
		CallID:         call.ID,
		RoomName:       call.LivekitRoomName,
	}); err != nil {
		return nil, nil, fmt.Errorf("%w: %v", ErrMediaProviderUnavailable, err)
	}
	if requestRecording {
		l.startCallRecording(ctx, tx, orgID, call)
	}

	participant, err := l.upsertParticipant(ctx, tx, orgID, call.ID, employeeID, dbuuid.NullUUID{}, "initiator", ParticipantStateJoined)
	if err != nil {
		return nil, nil, err
	}
	credentials, err := l.credentials(ctx, call, participant)
	if err != nil {
		return nil, nil, err
	}
	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return nil, nil, err
	}
	if err := l.announceVoiceCallStarted(ctx, tx, orgID, employeeID, channelID, call.ID); err != nil {
		return nil, nil, err
	}
	l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallStarted, "started", session, nil)

	// For direct-message channels, automatically send an incoming-call ring alert
	// to the other participant so they receive a ringing notification without
	// needing an explicit InviteToVoiceCall call.
	if channel, chErr := l.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	}); chErr == nil && channel.ChannelType == "direct_message" {
		if partners, pErr := l.Queries.GetDirectMessageParticipants(ctx, tx, &database.GetDirectMessageParticipantsParams{
			ChannelID:      channelID,
			OrganizationID: orgID,
			EmployeeID:     employeeID,
		}); pErr == nil {
			for _, partner := range partners {
				invitation, invErr := l.createPendingInvitation(ctx, tx, orgID, call.ID, employeeID, partner.ID)
				if invErr != nil {
					slog.WarnContext(ctx, "failed to create DM auto-invite", "error", invErr, "invitee_id", partner.ID)
					continue
				}
				if _, upsertErr := l.upsertParticipant(ctx, tx, orgID, call.ID, partner.ID, dbuuid.UUIDToNullUUID(employeeID), "participant", ParticipantStateInvited); upsertErr != nil {
					slog.WarnContext(ctx, "failed to upsert invited DM participant", "error", upsertErr, "invitee_id", partner.ID)
					continue
				}
				l.publishInviteNotification(ctx, tx, orgID, call, invitation)
			}
		}
	}

	return session, credentials, nil
}

func (l *Logic) GetActiveVoiceCall(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) (*rpcv1.VoiceCallSession, bool, error) {
	if err := l.authorize(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, false, err
	}
	call, err := l.Queries.GetActiveVoiceCallForChannel(ctx, tx, &database.GetActiveVoiceCallForChannelParams{OrganizationID: orgID, ChannelID: channelID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get active voice call: %w", err)
	}
	session, err := l.callToProto(ctx, tx, call)
	return session, true, err
}

func (l *Logic) JoinVoiceCall(ctx context.Context, tx database.DBTX, orgID, employeeID, callID dbuuid.UUID, actingDeviceIdentifier string) (*rpcv1.VoiceCallSession, *rpcv1.VoiceJoinCredentials, error) {
	call, err := l.getLiveCall(ctx, tx, orgID, callID)
	if err != nil {
		return nil, nil, err
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, call.ChannelID); err != nil {
		return nil, nil, err
	}

	activeCount, err := l.Queries.CountActiveVoiceCallParticipants(ctx, tx, &database.CountActiveVoiceCallParticipantsParams{OrganizationID: orgID, CallSessionID: call.ID})
	if err != nil {
		return nil, nil, fmt.Errorf("count voice participants: %w", err)
	}
	if int(activeCount) >= l.Config.MaxParticipants {
		if existing, err := l.Queries.GetVoiceCallParticipant(ctx, tx, &database.GetVoiceCallParticipantParams{OrganizationID: orgID, CallSessionID: call.ID, EmployeeID: employeeID}); err != nil || IsTerminalParticipantState(existing.State) {
			return nil, nil, ErrParticipantLimitExceeded
		}
	}

	participant, err := l.upsertParticipant(ctx, tx, orgID, call.ID, employeeID, dbuuid.NullUUID{}, "participant", ParticipantStateJoined)
	if err != nil {
		return nil, nil, err
	}
	if call.State == CallStateRinging && employeeID != call.InitiatorEmployeeID {
		now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
		call, err = l.Queries.MarkVoiceCallAnswered(ctx, tx, &database.MarkVoiceCallAnsweredParams{AnsweredAt: now, OrganizationID: orgID, CallSessionID: call.ID})
		if err != nil {
			return nil, nil, fmt.Errorf("mark voice call answered: %w", err)
		}
		// Stop the ring on this person's other phones. The device that answered names
		// itself so it is excluded: on iOS every call wake is reported to CallKit as a
		// new incoming call, so sending one back to the answering handset would ring it
		// again (FR-004).
		l.emitTerminalCallWake(ctx, tx, orgID, call, notification.CallWakeEventAnsweredElsewhere, actingDeviceIdentifier)
	}

	credentials, err := l.credentials(ctx, call, participant)
	if err != nil {
		return nil, nil, err
	}
	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return nil, nil, err
	}
	l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallUpdated, "joined", session, map[string]string{"employeeId": employeeID.String()})
	return session, credentials, nil
}

func (l *Logic) LeaveVoiceCall(ctx context.Context, tx database.DBTX, orgID, employeeID, callID dbuuid.UUID, actingDeviceIdentifier string) (*rpcv1.VoiceCallSession, error) {
	call, err := l.getCall(ctx, tx, orgID, callID)
	if err != nil {
		return nil, err
	}
	if call.State == CallStateEnded {
		return l.callToProto(ctx, tx, call)
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, call.ChannelID); err != nil {
		return nil, err
	}

	participant, err := l.Queries.GetVoiceCallParticipant(ctx, tx, &database.GetVoiceCallParticipantParams{OrganizationID: orgID, CallSessionID: call.ID, EmployeeID: employeeID})
	if errors.Is(err, pgx.ErrNoRows) {
		return l.callToProto(ctx, tx, call)
	}
	if err != nil {
		return nil, fmt.Errorf("get voice participant: %w", err)
	}
	if !IsTerminalParticipantState(participant.State) {
		now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
		if _, err := l.Queries.UpdateVoiceCallParticipantState(ctx, tx, &database.UpdateVoiceCallParticipantStateParams{
			State:            ParticipantStateLeft,
			LeftAt:           now,
			LastSeenAt:       now,
			UpdatedAt:        now,
			OrganizationID:   orgID,
			ParticipantID:    participant.ID,
			DisconnectReason: pgtype.Text{String: "left", Valid: true},
		}); err != nil {
			return nil, fmt.Errorf("mark voice participant left: %w", err)
		}
	}

	endedByLeave := false
	endedOutcome := ""
	directMessageCall, err := l.isDirectMessageCall(ctx, tx, orgID, call)
	if err != nil {
		return nil, err
	}
	if directMessageCall && (call.AnsweredAt.Valid || call.State == CallStateActive) {
		endedOutcome = CallOutcomeCompleted
		call, err = l.endCall(ctx, tx, orgID, call, employeeID, endedOutcome, "direct_participant_left", actingDeviceIdentifier)
		if err != nil {
			return nil, err
		}
		endedByLeave = true
	} else {
		remaining, err := l.Queries.CountActiveVoiceCallParticipants(ctx, tx, &database.CountActiveVoiceCallParticipantsParams{OrganizationID: orgID, CallSessionID: call.ID})
		if err != nil {
			return nil, fmt.Errorf("count remaining voice participants: %w", err)
		}
		if remaining == 0 {
			endedOutcome = endOutcomeFor(call)
			call, err = l.endCall(ctx, tx, orgID, call, employeeID, endedOutcome, "final_participant_left", actingDeviceIdentifier)
			if err != nil {
				return nil, err
			}
			endedByLeave = true
		}
	}
	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return nil, err
	}
	if endedByLeave {
		if endedOutcome == "" {
			endedOutcome = textOrEmpty(call.Outcome)
		}
		if err := l.acknowledgeVoiceCallNotificationsForCall(ctx, tx, orgID, call.ID); err != nil {
			return nil, err
		}
		if err := l.announceVoiceCallEnded(ctx, tx, orgID, employeeID, call.ChannelID, call.ID, endedOutcome); err != nil {
			return nil, err
		}
		l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallEnded, "ended", session, map[string]string{"employeeId": employeeID.String(), "outcome": endedOutcome})
	} else {
		l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallUpdated, "left", session, map[string]string{"employeeId": employeeID.String()})
	}
	return session, nil
}

func (l *Logic) EndVoiceCall(ctx context.Context, tx database.DBTX, orgID, employeeID, callID dbuuid.UUID, actingDeviceIdentifier string) (*rpcv1.VoiceCallSession, error) {
	call, err := l.getCall(ctx, tx, orgID, callID)
	if err != nil {
		return nil, err
	}
	if call.State == CallStateEnded {
		return l.callToProto(ctx, tx, call)
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, call.ChannelID); err != nil {
		return nil, err
	}
	endedOutcome := endOutcomeFor(call)
	call, err = l.endCall(ctx, tx, orgID, call, employeeID, endedOutcome, "ended_by_user", actingDeviceIdentifier)
	if err != nil {
		return nil, err
	}
	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return nil, err
	}
	if err := l.acknowledgeVoiceCallNotificationsForCall(ctx, tx, orgID, call.ID); err != nil {
		return nil, err
	}
	if err := l.announceVoiceCallEnded(ctx, tx, orgID, employeeID, call.ChannelID, call.ID, endedOutcome); err != nil {
		return nil, err
	}
	l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallEnded, "ended", session, map[string]string{"employeeId": employeeID.String(), "outcome": endedOutcome})
	return session, nil
}

func (l *Logic) InviteToVoiceCall(ctx context.Context, tx database.DBTX, orgID, employeeID, callID dbuuid.UUID, inviteeIDs []dbuuid.UUID) (*rpcv1.VoiceCallSession, []*rpcv1.VoiceCallInvitation, error) {
	call, err := l.getLiveCall(ctx, tx, orgID, callID)
	if err != nil {
		return nil, nil, err
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, call.ChannelID); err != nil {
		return nil, nil, err
	}

	invitations := make([]*rpcv1.VoiceCallInvitation, 0, len(inviteeIDs))
	invitedEmployeeIDs := make([]string, 0, len(inviteeIDs))
	for _, inviteeID := range inviteeIDs {
		if inviteeID == employeeID {
			return nil, nil, ErrAccessDenied
		}
		if err := l.authorize(ctx, tx, orgID, inviteeID, call.ChannelID); err != nil {
			return nil, nil, err
		}
		existingParticipant, err := l.Queries.GetVoiceCallParticipant(ctx, tx, &database.GetVoiceCallParticipantParams{OrganizationID: orgID, CallSessionID: call.ID, EmployeeID: inviteeID})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, fmt.Errorf("get voice participant: %w", err)
		}
		if err == nil && !IsTerminalParticipantState(existingParticipant.State) && existingParticipant.State != ParticipantStateInvited {
			continue
		}

		invitation, err := l.createPendingInvitation(ctx, tx, orgID, call.ID, employeeID, inviteeID)
		if err != nil {
			return nil, nil, err
		}
		if _, err := l.upsertParticipant(ctx, tx, orgID, call.ID, inviteeID, dbuuid.UUIDToNullUUID(employeeID), "participant", ParticipantStateInvited); err != nil {
			return nil, nil, err
		}
		l.publishInviteNotification(ctx, tx, orgID, call, invitation)
		invitations = append(invitations, invitationToProto(invitation))
		invitedEmployeeIDs = append(invitedEmployeeIDs, inviteeID.String())
	}

	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return nil, nil, err
	}
	l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallUpdated, "invited", session, map[string]string{"employeeIds": strings.Join(invitedEmployeeIDs, ",")})
	return session, invitations, nil
}

func (l *Logic) RespondToVoiceCallInvite(ctx context.Context, tx database.DBTX, orgID, employeeID, invitationID dbuuid.UUID, response rpcv1.VoiceInviteResponse, actingDeviceIdentifier string) (*rpcv1.VoiceCallInvitation, *rpcv1.VoiceJoinCredentials, error) {
	invitation, err := l.Queries.GetVoiceCallInvitation(ctx, tx, &database.GetVoiceCallInvitationParams{OrganizationID: orgID, InvitationID: invitationID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrInviteNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("get voice invitation: %w", err)
	}
	if invitation.InviteeEmployeeID != employeeID {
		return nil, nil, ErrAccessDenied
	}
	if invitation.Status != InvitationStatusPending {
		return nil, nil, ErrInviteAlreadyResponded
	}
	call, err := l.getLiveCall(ctx, tx, orgID, invitation.CallSessionID)
	if err != nil {
		return nil, nil, err
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, call.ChannelID); err != nil {
		return nil, nil, err
	}

	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	if invitation.ExpiresAt.Valid && !now.Time.Before(invitation.ExpiresAt.Time) {
		expiredInvitation, err := l.Queries.UpdateVoiceCallInvitationStatus(ctx, tx, &database.UpdateVoiceCallInvitationStatusParams{
			Status:         InvitationStatusExpired,
			RespondedAt:    now,
			OrganizationID: orgID,
			InvitationID:   invitation.ID,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("expire voice invitation: %w", err)
		}
		if err := l.expireDirectVoiceInvite(ctx, tx, orgID, employeeID, call, invitation, actingDeviceIdentifier); err != nil {
			return nil, nil, err
		}
		return invitationToProto(expiredInvitation), nil, nil
	}

	switch response {
	case rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_ACCEPT:
		updatedInvitation, credentials, err := l.acceptVoiceInvite(ctx, tx, orgID, employeeID, call, invitation, now, actingDeviceIdentifier)
		if err != nil {
			return nil, nil, err
		}
		// Acknowledge the persistent voice_call_incoming notification so it is
		// not replayed as a stale popup on the next SSE reconnect.
		_ = l.Queries.AcknowledgeVoiceCallInvitationNotification(ctx, tx, &database.AcknowledgeVoiceCallInvitationNotificationParams{
			AcknowledgedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
			EmployeeID:     employeeID,
			OrganizationID: orgID,
			InvitationID:   invitation.ID.String(),
		})
		eventCall, refreshErr := l.getCall(ctx, tx, orgID, call.ID)
		if refreshErr != nil {
			return nil, nil, refreshErr
		}
		session, err := l.callToProto(ctx, tx, eventCall)
		if err == nil {
			l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallUpdated, "invite_accepted", session, map[string]string{"employeeId": employeeID.String(), "invitationId": invitation.ID.String()})
		}
		return invitationToProto(updatedInvitation), credentials, err
	case rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_DECLINE:
		updatedInvitation, endedCall, err := l.declineVoiceInvite(ctx, tx, orgID, employeeID, call, invitation, now, actingDeviceIdentifier)
		if err != nil {
			return nil, nil, err
		}
		// Acknowledge the persistent voice_call_incoming notification so it is
		// not replayed as a stale popup on the next SSE reconnect.
		_ = l.Queries.AcknowledgeVoiceCallInvitationNotification(ctx, tx, &database.AcknowledgeVoiceCallInvitationNotificationParams{
			AcknowledgedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
			EmployeeID:     employeeID,
			OrganizationID: orgID,
			InvitationID:   invitation.ID.String(),
		})
		eventCall := call
		notificationType := notification.NotificationTypeVoiceCallUpdated
		action := "invite_declined"
		extra := map[string]string{"employeeId": employeeID.String(), "invitationId": invitation.ID.String()}
		if endedCall != nil {
			eventCall = endedCall
			notificationType = notification.NotificationTypeVoiceCallEnded
			action = "ended"
			extra["outcome"] = CallOutcomeDeclined
		}
		session, err := l.callToProto(ctx, tx, eventCall)
		if err == nil {
			l.publishVoiceCallEvent(ctx, tx, orgID, notificationType, action, session, extra)
		}
		return invitationToProto(updatedInvitation), nil, err
	default:
		return nil, nil, fmt.Errorf("unsupported voice invite response")
	}
}

func (l *Logic) RequestVoiceMessageUpload(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID, clientDeduplicationKey, filename, mimeType string, sizeBytes, expectedDurationMs int64) (*rpcv1.RequestVoiceMessageUploadResponse, error) {
	clientDeduplicationKey = strings.TrimSpace(clientDeduplicationKey)
	filename = strings.TrimSpace(filename)
	mimeType = strings.TrimSpace(mimeType)
	if err := l.validateVoiceMessageUpload(filename, mimeType, sizeBytes, expectedDurationMs); err != nil {
		return nil, err
	}
	if clientDeduplicationKey == "" {
		return nil, ErrInvalidUpload
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, err
	}
	if l.FileLogic == nil {
		return nil, ErrMediaProviderUnavailable
	}

	existing, err := l.Queries.GetVoiceMessageByDedupKey(ctx, tx, &database.GetVoiceMessageByDedupKeyParams{
		OrganizationID:         orgID,
		ChannelID:              channelID,
		SenderEmployeeID:       employeeID,
		ClientDeduplicationKey: clientDeduplicationKey,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		existing = nil
	} else if err != nil {
		return nil, fmt.Errorf("get voice message by dedup key: %w", err)
	}
	if err == nil {
		if existing.MimeType != mimeType || existing.SizeBytes != sizeBytes {
			return nil, ErrVoiceMessageIdempotencyConflict
		}
		if existing.Status == VoiceMessageStatusPosted || existing.Status == VoiceMessageStatusCancelled {
			return &rpcv1.RequestVoiceMessageUploadResponse{
				VoiceMessageId: existing.ID.String(),
				FileId:         nullUUIDString(existing.FileID),
			}, nil
		}
	}

	channel, err := l.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{OrganizationID: orgID, ID: channelID})
	if err != nil {
		return nil, fmt.Errorf("get voice message channel: %w", err)
	}
	accessScope := files.AccessScopePublic
	if channel.IsPrivate {
		accessScope = files.AccessScopePrivate
	}

	upload, err := l.FileLogic.RequestUpload(ctx, tx, files.RequestUploadParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		Filename:       filename,
		MimeType:       mimeType,
		SizeBytes:      sizeBytes,
		UploadContext:  files.UploadContextChat,
	})
	if err != nil {
		return nil, fmt.Errorf("request voice message file upload: %w", err)
	}
	if err := l.FileLogic.CreateAccessRule(ctx, tx, files.CreateAccessRuleParams{
		OrganizationID: orgID,
		FileID:         upload.FileID,
		ContextType:    files.ContextTypeChatChannel,
		ContextID:      channelID,
		AccessScope:    accessScope,
	}); err != nil {
		return nil, fmt.Errorf("create voice message file access rule: %w", err)
	}

	var voiceMessage *database.VoiceVoiceMessage
	if existing != nil {
		voiceMessage, err = l.Queries.AttachVoiceMessageFile(ctx, tx, &database.AttachVoiceMessageFileParams{
			FileID:         dbuuid.UUIDToNullUUID(upload.FileID),
			UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
			OrganizationID: orgID,
			VoiceMessageID: existing.ID,
		})
		if err != nil {
			return nil, fmt.Errorf("attach voice message file: %w", err)
		}
	} else {
		voiceMessage, err = l.Queries.CreateVoiceMessageUpload(ctx, tx, &database.CreateVoiceMessageUploadParams{
			OrganizationID:         orgID,
			ChannelID:              channelID,
			SenderEmployeeID:       employeeID,
			ClientDeduplicationKey: clientDeduplicationKey,
			Status:                 VoiceMessageStatusUploading,
			FileID:                 dbuuid.UUIDToNullUUID(upload.FileID),
			MimeType:               mimeType,
			Codec:                  codecForMIMEType(mimeType),
			SizeBytes:              sizeBytes,
		})
		if err != nil {
			return nil, fmt.Errorf("create voice message upload: %w", err)
		}
	}

	return &rpcv1.RequestVoiceMessageUploadResponse{
		VoiceMessageId: voiceMessage.ID.String(),
		FileId:         upload.FileID.String(),
		UploadUrl:      upload.UploadURL,
		ExpiresAt:      timestamppb.New(upload.ExpiresAt),
	}, nil
}

func (l *Logic) ConfirmVoiceMessageUpload(ctx context.Context, tx database.DBTX, orgID, employeeID, voiceMessageID, fileID dbuuid.UUID, clientDeduplicationKey string, durationMs int64, waveformPeaks []float32) (*rpcv1.VoiceMessage, error) {
	clientDeduplicationKey = strings.TrimSpace(clientDeduplicationKey)
	if durationMs <= 0 || durationMs > MaxVoiceMessageDurationMs || clientDeduplicationKey == "" {
		return nil, ErrInvalidUpload
	}
	voiceMessage, err := l.Queries.GetVoiceMessage(ctx, tx, &database.GetVoiceMessageParams{OrganizationID: orgID, VoiceMessageID: voiceMessageID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUploadNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get voice message: %w", err)
	}
	if voiceMessage.SenderEmployeeID != employeeID || voiceMessage.ClientDeduplicationKey != clientDeduplicationKey {
		return nil, ErrAccessDenied
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, voiceMessage.ChannelID); err != nil {
		return nil, err
	}
	if voiceMessage.Status == VoiceMessageStatusPosted {
		return voiceMessageToProto(voiceMessage), nil
	}
	if voiceMessage.Status == VoiceMessageStatusCancelled {
		return nil, ErrVoiceMessageFinalized
	}
	if voiceMessage.FileID.Valid && dbuuid.UUID(voiceMessage.FileID.UUID) != fileID {
		return nil, ErrVoiceMessageIdempotencyConflict
	}
	if l.FileLogic == nil || l.ChatAnnouncer == nil {
		return nil, ErrMediaProviderUnavailable
	}

	metadata, err := l.FileLogic.ConfirmUpload(ctx, tx, files.ConfirmUploadParams{OrganizationID: orgID, EmployeeID: employeeID, FileID: fileID})
	if err != nil {
		return nil, fmt.Errorf("confirm voice message file upload: %w", err)
	}
	if !IsAllowedVoiceMessageMIMEType(metadata.MimeType) || metadata.SizeBytes <= 0 || metadata.SizeBytes > MaxVoiceMessageSizeBytes {
		return nil, ErrUnsupportedMimeType
	}

	messageID, err := l.ChatAnnouncer.CreateVoiceMessage(ctx, tx, orgID, employeeID, voiceMessage.ChannelID, voiceMessage.ID, fileID, durationMs, metadata.MimeType, waveformPeaks, metadata.SizeBytes)
	if err != nil {
		return nil, err
	}
	waveformJSON, err := json.Marshal(waveformPeaks)
	if err != nil {
		return nil, fmt.Errorf("marshal waveform peaks: %w", err)
	}
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	confirmed, err := l.Queries.ConfirmVoiceMessage(ctx, tx, &database.ConfirmVoiceMessageParams{
		MessageID:      dbuuid.UUIDToNullUUID(messageID),
		FileID:         dbuuid.UUIDToNullUUID(fileID),
		DurationMs:     pgtype.Int8{Int64: durationMs, Valid: true},
		WaveformPeaks:  waveformJSON,
		PostedAt:       now,
		OrganizationID: orgID,
		VoiceMessageID: voiceMessage.ID,
	})
	if err != nil {
		return nil, fmt.Errorf("confirm voice message: %w", err)
	}
	return voiceMessageToProto(confirmed), nil
}

func (l *Logic) CancelVoiceMessage(ctx context.Context, tx database.DBTX, orgID, employeeID, voiceMessageID dbuuid.UUID) (*rpcv1.VoiceMessage, error) {
	voiceMessage, err := l.Queries.GetVoiceMessage(ctx, tx, &database.GetVoiceMessageParams{OrganizationID: orgID, VoiceMessageID: voiceMessageID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUploadNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get voice message: %w", err)
	}
	if voiceMessage.SenderEmployeeID != employeeID {
		return nil, ErrAccessDenied
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, voiceMessage.ChannelID); err != nil {
		return nil, err
	}
	if voiceMessage.Status == VoiceMessageStatusPosted || voiceMessage.Status == VoiceMessageStatusCancelled {
		return voiceMessageToProto(voiceMessage), nil
	}
	cancelled, err := l.Queries.CancelVoiceMessageUpload(ctx, tx, &database.CancelVoiceMessageUploadParams{
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		OrganizationID: orgID,
		VoiceMessageID: voiceMessage.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrVoiceMessageFinalized
	}
	if err != nil {
		return nil, fmt.Errorf("cancel voice message upload: %w", err)
	}
	return voiceMessageToProto(cancelled), nil
}

func (l *Logic) ListCallRecords(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID, cursor string, limit int32) ([]*rpcv1.VoiceCallRecord, string, error) {
	if err := l.authorize(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, "", err
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	var cursorStartedAt pgtype.Timestamptz
	if strings.TrimSpace(cursor) != "" {
		parsed, err := time.Parse(time.RFC3339Nano, cursor)
		if err != nil {
			return nil, "", fmt.Errorf("invalid call record cursor: %w", err)
		}
		cursorStartedAt = pgtype.Timestamptz{Time: parsed, Valid: true}
	}

	calls, err := l.Queries.ListCompletedVoiceCallSessionsForChannel(ctx, tx, &database.ListCompletedVoiceCallSessionsForChannelParams{
		OrganizationID:  orgID,
		ChannelID:       channelID,
		CursorStartedAt: cursorStartedAt,
		PageLimit:       limit + 1,
	})
	if err != nil {
		return nil, "", fmt.Errorf("list voice call records: %w", err)
	}

	nextCursor := ""
	if len(calls) > int(limit) {
		nextCursor = calls[limit-1].StartedAt.Time.UTC().Format(time.RFC3339Nano)
		calls = calls[:limit]
	}
	records := make([]*rpcv1.VoiceCallRecord, 0, len(calls))
	for _, call := range calls {
		record, err := l.callRecordToProto(ctx, tx, call)
		if err != nil {
			return nil, "", err
		}
		records = append(records, record)
	}
	return records, nextCursor, nil
}

func (l *Logic) GetCallRecord(ctx context.Context, tx database.DBTX, orgID, employeeID, callID dbuuid.UUID) (*rpcv1.VoiceCallRecord, error) {
	call, err := l.getCall(ctx, tx, orgID, callID)
	if err != nil {
		return nil, err
	}
	if err := l.authorize(ctx, tx, orgID, employeeID, call.ChannelID); err != nil {
		return nil, err
	}
	return l.callRecordToProto(ctx, tx, call)
}

func (l *Logic) validateVoiceMessageUpload(filename, mimeType string, sizeBytes, expectedDurationMs int64) error {
	if filename == "" || mimeType == "" || sizeBytes <= 0 || expectedDurationMs <= 0 {
		return ErrInvalidUpload
	}
	if sizeBytes > MaxVoiceMessageSizeBytes || expectedDurationMs > MaxVoiceMessageDurationMs {
		return ErrInvalidUpload
	}
	if !IsAllowedVoiceMessageMIMEType(mimeType) {
		return ErrUnsupportedMimeType
	}
	return nil
}

func (l *Logic) authorize(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) error {
	if l.ChannelAuthorizer == nil {
		return ErrAccessDenied
	}
	if err := l.ChannelAuthorizer.AuthorizeVoiceChannel(ctx, tx, orgID, employeeID, channelID); err != nil {
		return fmt.Errorf("%w: %v", ErrAccessDenied, err)
	}
	return nil
}

func (l *Logic) getCall(ctx context.Context, tx database.DBTX, orgID, callID dbuuid.UUID) (*database.VoiceCallSession, error) {
	call, err := l.Queries.GetVoiceCallSession(ctx, tx, &database.GetVoiceCallSessionParams{OrganizationID: orgID, CallSessionID: callID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCallNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get voice call: %w", err)
	}
	return call, nil
}

func (l *Logic) getLiveCall(ctx context.Context, tx database.DBTX, orgID, callID dbuuid.UUID) (*database.VoiceCallSession, error) {
	call, err := l.getCall(ctx, tx, orgID, callID)
	if err != nil {
		return nil, err
	}
	if call.State == CallStateEnded {
		return nil, ErrCallEnded
	}
	return call, nil
}

func (l *Logic) isDirectMessageCall(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, call *database.VoiceCallSession) (bool, error) {
	channel, err := l.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             call.ChannelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return false, fmt.Errorf("get voice call channel: %w", err)
	}
	return channel.ChannelType == "direct_message", nil
}

func (l *Logic) upsertParticipant(ctx context.Context, tx database.DBTX, orgID, callID, employeeID dbuuid.UUID, invitedBy dbuuid.NullUUID, role, state string) (*database.VoiceCallParticipant, error) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	participant, err := l.Queries.UpsertVoiceCallParticipant(ctx, tx, &database.UpsertVoiceCallParticipantParams{
		OrganizationID:      orgID,
		CallSessionID:       callID,
		EmployeeID:          employeeID,
		InvitedByEmployeeID: invitedBy,
		Role:                role,
		State:               state,
		LivekitIdentity:     makeLiveKitIdentity(callID, employeeID),
		JoinedAt:            now,
		LastSeenAt:          now,
		UpdatedAt:           now,
	})
	if err != nil {
		return nil, fmt.Errorf("upsert voice participant: %w", err)
	}
	return participant, nil
}

func (l *Logic) createPendingInvitation(ctx context.Context, tx database.DBTX, orgID, callID, inviterID, inviteeID dbuuid.UUID) (*database.VoiceCallInvitation, error) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	if existing, err := l.findPendingInvitation(ctx, tx, orgID, callID, inviteeID, now); err == nil && existing != nil {
		return existing, nil
	} else if err != nil {
		return nil, err
	}

	invitation, err := l.Queries.CreateVoiceCallInvitation(ctx, tx, &database.CreateVoiceCallInvitationParams{
		OrganizationID:    orgID,
		CallSessionID:     callID,
		InviterEmployeeID: inviterID,
		InviteeEmployeeID: inviteeID,
		NotificationID:    dbuuid.NullUUID{},
		ExpiresAt:         pgtype.Timestamptz{Time: now.Time.Add(DefaultInvitationTTL), Valid: true},
	})
	if err != nil {
		if isUniqueViolation(err) {
			return l.findPendingInvitation(ctx, tx, orgID, callID, inviteeID, now)
		}
		return nil, fmt.Errorf("create voice invitation: %w", err)
	}
	return invitation, nil
}

func (l *Logic) findPendingInvitation(ctx context.Context, tx database.DBTX, orgID, callID, inviteeID dbuuid.UUID, now pgtype.Timestamptz) (*database.VoiceCallInvitation, error) {
	pending, err := l.Queries.ListPendingVoiceCallInvitationsForEmployee(ctx, tx, &database.ListPendingVoiceCallInvitationsForEmployeeParams{
		OrganizationID:    orgID,
		InviteeEmployeeID: inviteeID,
		NowAt:             now,
	})
	if err != nil {
		return nil, fmt.Errorf("list pending voice invitations: %w", err)
	}
	for _, invitation := range pending {
		if invitation.CallSessionID == callID {
			return invitation, nil
		}
	}
	return nil, nil
}

func (l *Logic) acceptVoiceInvite(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, call *database.VoiceCallSession, invitation *database.VoiceCallInvitation, now pgtype.Timestamptz, actingDeviceIdentifier string) (*database.VoiceCallInvitation, *rpcv1.VoiceJoinCredentials, error) {
	activeCount, err := l.Queries.CountActiveVoiceCallParticipants(ctx, tx, &database.CountActiveVoiceCallParticipantsParams{OrganizationID: orgID, CallSessionID: call.ID})
	if err != nil {
		return nil, nil, fmt.Errorf("count voice participants: %w", err)
	}
	if int(activeCount) >= l.Config.MaxParticipants {
		if existing, err := l.Queries.GetVoiceCallParticipant(ctx, tx, &database.GetVoiceCallParticipantParams{OrganizationID: orgID, CallSessionID: call.ID, EmployeeID: employeeID}); err != nil || IsTerminalParticipantState(existing.State) {
			return nil, nil, ErrParticipantLimitExceeded
		}
	}

	updatedInvitation, err := l.Queries.UpdateVoiceCallInvitationStatus(ctx, tx, &database.UpdateVoiceCallInvitationStatusParams{
		Status:         InvitationStatusAccepted,
		RespondedAt:    now,
		OrganizationID: orgID,
		InvitationID:   invitation.ID,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("accept voice invitation: %w", err)
	}
	participant, err := l.upsertParticipant(ctx, tx, orgID, call.ID, employeeID, dbuuid.UUIDToNullUUID(invitation.InviterEmployeeID), "participant", ParticipantStateJoined)
	if err != nil {
		return nil, nil, err
	}
	if call.State == CallStateRinging && employeeID != call.InitiatorEmployeeID {
		answered, err := l.Queries.MarkVoiceCallAnswered(ctx, tx, &database.MarkVoiceCallAnsweredParams{AnsweredAt: now, OrganizationID: orgID, CallSessionID: call.ID})
		if err != nil {
			return nil, nil, fmt.Errorf("mark voice call answered: %w", err)
		}
		l.emitTerminalCallWake(ctx, tx, orgID, answered, notification.CallWakeEventAnsweredElsewhere, actingDeviceIdentifier)
	}
	credentials, err := l.credentials(ctx, call, participant)
	if err != nil {
		return nil, nil, err
	}
	return updatedInvitation, credentials, nil
}

func (l *Logic) declineVoiceInvite(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, call *database.VoiceCallSession, invitation *database.VoiceCallInvitation, now pgtype.Timestamptz, actingDeviceIdentifier string) (*database.VoiceCallInvitation, *database.VoiceCallSession, error) {
	updatedInvitation, err := l.Queries.UpdateVoiceCallInvitationStatus(ctx, tx, &database.UpdateVoiceCallInvitationStatusParams{
		Status:         InvitationStatusDeclined,
		RespondedAt:    now,
		OrganizationID: orgID,
		InvitationID:   invitation.ID,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("decline voice invitation: %w", err)
	}
	participant, err := l.Queries.GetVoiceCallParticipant(ctx, tx, &database.GetVoiceCallParticipantParams{OrganizationID: orgID, CallSessionID: call.ID, EmployeeID: employeeID})
	if errors.Is(err, pgx.ErrNoRows) {
		participant, err = l.upsertParticipant(ctx, tx, orgID, call.ID, employeeID, dbuuid.UUIDToNullUUID(invitation.InviterEmployeeID), "participant", ParticipantStateInvited)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("get voice participant: %w", err)
	}
	if _, err := l.Queries.UpdateVoiceCallParticipantState(ctx, tx, &database.UpdateVoiceCallParticipantStateParams{
		State:            ParticipantStateDeclined,
		LeftAt:           now,
		LastSeenAt:       now,
		UpdatedAt:        now,
		OrganizationID:   orgID,
		ParticipantID:    participant.ID,
		DisconnectReason: pgtype.Text{String: "invite_declined", Valid: true},
	}); err != nil {
		return nil, nil, fmt.Errorf("mark voice invitation declined: %w", err)
	}
	directMessageCall, err := l.isDirectMessageCall(ctx, tx, orgID, call)
	if err != nil {
		return nil, nil, err
	}
	if directMessageCall && call.State == CallStateRinging && employeeID != call.InitiatorEmployeeID {
		endedCall, err := l.endCall(ctx, tx, orgID, call, employeeID, CallOutcomeDeclined, "direct_invite_declined", actingDeviceIdentifier)
		if err != nil {
			return nil, nil, err
		}
		if err := l.acknowledgeVoiceCallNotificationsForCall(ctx, tx, orgID, call.ID); err != nil {
			return nil, nil, err
		}
		if err := l.announceVoiceCallEnded(ctx, tx, orgID, employeeID, call.ChannelID, call.ID, CallOutcomeDeclined); err != nil {
			return nil, nil, err
		}
		return updatedInvitation, endedCall, nil
	}
	return updatedInvitation, nil, nil
}

func (l *Logic) expireDirectVoiceInvite(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, call *database.VoiceCallSession, invitation *database.VoiceCallInvitation, actingDeviceIdentifier string) error {
	directMessageCall, err := l.isDirectMessageCall(ctx, tx, orgID, call)
	if err != nil {
		return err
	}
	if !directMessageCall || call.State != CallStateRinging || employeeID == call.InitiatorEmployeeID {
		return nil
	}
	endedCall, err := l.endCall(ctx, tx, orgID, call, employeeID, CallOutcomeMissed, "direct_invite_expired", actingDeviceIdentifier)
	if err != nil {
		return err
	}
	if err := l.acknowledgeVoiceCallNotificationsForCall(ctx, tx, orgID, call.ID); err != nil {
		return err
	}
	if err := l.announceVoiceCallEnded(ctx, tx, orgID, employeeID, call.ChannelID, call.ID, CallOutcomeMissed); err != nil {
		return err
	}
	session, err := l.callToProto(ctx, tx, endedCall)
	if err == nil {
		l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallEnded, "ended", session, map[string]string{"employeeId": employeeID.String(), "invitationId": invitation.ID.String(), "outcome": CallOutcomeMissed})
	}
	return nil
}

func (l *Logic) credentials(ctx context.Context, call *database.VoiceCallSession, participant *database.VoiceCallParticipant) (*rpcv1.VoiceJoinCredentials, error) {
	credentials, err := l.MediaClient.MintJoinCredentials(ctx, JoinTokenOptions{
		EmployeeID: participant.EmployeeID,
		RoomName:   call.LivekitRoomName,
		Identity:   participant.LivekitIdentity,
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrMediaProviderUnavailable, err)
	}
	return &rpcv1.VoiceJoinCredentials{
		LivekitUrl:   credentials.LiveKitURL,
		LivekitToken: credentials.Token,
		RoomName:     credentials.RoomName,
		ExpiresAt:    timestamppb.New(credentials.ExpiresAt),
	}, nil
}

func (l *Logic) endCall(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, call *database.VoiceCallSession, endedBy dbuuid.UUID, outcome, reason, actingDeviceIdentifier string) (*database.VoiceCallSession, error) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	endedCall, err := l.Queries.EndVoiceCallSession(ctx, tx, &database.EndVoiceCallSessionParams{
		Outcome:           pgtype.Text{String: outcome, Valid: true},
		EndedAt:           now,
		EndedByEmployeeID: dbuuid.UUIDToNullUUID(endedBy),
		EndedReason:       pgtype.Text{String: reason, Valid: true},
		OrganizationID:    orgID,
		CallSessionID:     call.ID,
	})
	if err != nil {
		return nil, fmt.Errorf("end voice call: %w", err)
	}
	// Every path that ends a call routes through here, which is exactly why the
	// terminal wake lives here and not at each caller: a new way to end a call cannot
	// forget to stop the phones (FR-013, SC-005).
	l.emitTerminalCallWake(ctx, tx, orgID, endedCall, terminalWakeEventForOutcome(outcome), actingDeviceIdentifier)
	return endedCall, nil
}

func (l *Logic) callToProto(ctx context.Context, tx database.DBTX, call *database.VoiceCallSession) (*rpcv1.VoiceCallSession, error) {
	participants, err := l.Queries.ListVoiceCallParticipants(ctx, tx, &database.ListVoiceCallParticipantsParams{OrganizationID: call.OrganizationID, CallSessionID: call.ID})
	if err != nil {
		return nil, fmt.Errorf("list voice participants: %w", err)
	}
	protoParticipants := make([]*rpcv1.VoiceCallParticipant, 0, len(participants))
	for _, participant := range participants {
		protoParticipants = append(protoParticipants, participantToProto(participant))
	}
	return &rpcv1.VoiceCallSession{
		Id:                  call.ID.String(),
		ChannelId:           call.ChannelID.String(),
		InitiatorEmployeeId: call.InitiatorEmployeeID.String(),
		State:               callStateToProto(call.State),
		Outcome:             callOutcomeToProto(call.Outcome),
		Participants:        protoParticipants,
		RecordingPermitted:  call.RecordingPolicy != "not_allowed",
		StartedAt:           timestampOrNil(call.StartedAt),
		EndedAt:             timestampOrNil(call.EndedAt),
	}, nil
}

func (l *Logic) callRecordToProto(ctx context.Context, tx database.DBTX, call *database.VoiceCallSession) (*rpcv1.VoiceCallRecord, error) {
	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return nil, err
	}
	artifacts, err := l.Queries.ListVoiceCallArtifacts(ctx, tx, &database.ListVoiceCallArtifactsParams{OrganizationID: call.OrganizationID, CallSessionID: call.ID})
	if err != nil {
		return nil, fmt.Errorf("list voice call artifacts: %w", err)
	}
	protoArtifacts := make([]*rpcv1.VoiceCallArtifact, 0, len(artifacts))
	for _, artifact := range artifacts {
		protoArtifacts = append(protoArtifacts, artifactToProto(artifact))
	}
	return &rpcv1.VoiceCallRecord{Call: session, Artifacts: protoArtifacts}, nil
}

func artifactToProto(artifact *database.VoiceCallArtifact) *rpcv1.VoiceCallArtifact {
	if artifact == nil {
		return nil
	}
	return &rpcv1.VoiceCallArtifact{
		Id:         artifact.ID.String(),
		Type:       artifactTypeToProto(artifact.ArtifactType),
		Status:     artifactStatusToProto(artifact.Status),
		FileId:     nullUUIDString(artifact.FileID),
		MimeType:   textOrEmpty(artifact.MimeType),
		DurationMs: int64OrZero(artifact.DurationMs),
	}
}

func participantToProto(participant *database.VoiceCallParticipant) *rpcv1.VoiceCallParticipant {
	return &rpcv1.VoiceCallParticipant{
		EmployeeId: participant.EmployeeID.String(),
		State:      participantStateToProto(participant.State),
		JoinedAt:   timestampOrNil(participant.JoinedAt),
		LeftAt:     timestampOrNil(participant.LeftAt),
	}
}

func invitationToProto(invitation *database.VoiceCallInvitation) *rpcv1.VoiceCallInvitation {
	return &rpcv1.VoiceCallInvitation{
		Id:                invitation.ID.String(),
		CallId:            invitation.CallSessionID.String(),
		InviteeEmployeeId: invitation.InviteeEmployeeID.String(),
		Status:            invitationStatusToProto(invitation.Status),
		ExpiresAt:         timestampOrNil(invitation.ExpiresAt),
	}
}

func voiceMessageToProto(message *database.VoiceVoiceMessage) *rpcv1.VoiceMessage {
	if message == nil {
		return nil
	}
	waveformPeaks := make([]float32, 0)
	if len(message.WaveformPeaks) > 0 {
		var decoded []float32
		if err := json.Unmarshal(message.WaveformPeaks, &decoded); err == nil {
			waveformPeaks = decoded
		}
	}
	return &rpcv1.VoiceMessage{
		Id:               message.ID.String(),
		ChannelId:        message.ChannelID.String(),
		MessageId:        nullUUIDString(message.MessageID),
		FileId:           nullUUIDString(message.FileID),
		SenderEmployeeId: message.SenderEmployeeID.String(),
		Status:           voiceMessageStatusToProto(message.Status),
		DurationMs:       int64OrZero(message.DurationMs),
		MimeType:         message.MimeType,
		WaveformPeaks:    waveformPeaks,
	}
}

func voiceMessageStatusToProto(status string) rpcv1.VoiceMessageStatus {
	switch status {
	case VoiceMessageStatusRequested:
		return rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_REQUESTED
	case VoiceMessageStatusUploading:
		return rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_UPLOADING
	case VoiceMessageStatusPosted:
		return rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_POSTED
	case VoiceMessageStatusFailed:
		return rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_FAILED
	case VoiceMessageStatusCancelled:
		return rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_CANCELLED
	default:
		return rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_UNSPECIFIED
	}
}

func nullUUIDString(value dbuuid.NullUUID) string {
	if !value.Valid {
		return ""
	}
	return value.UUID.String()
}

func int64OrZero(value pgtype.Int8) int64 {
	if !value.Valid {
		return 0
	}
	return value.Int64
}

func textOrEmpty(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func artifactTypeToProto(artifactType string) rpcv1.VoiceArtifactType {
	switch artifactType {
	case ArtifactTypeRecording:
		return rpcv1.VoiceArtifactType_VOICE_ARTIFACT_TYPE_RECORDING
	case ArtifactTypeTranscript:
		return rpcv1.VoiceArtifactType_VOICE_ARTIFACT_TYPE_TRANSCRIPT
	default:
		return rpcv1.VoiceArtifactType_VOICE_ARTIFACT_TYPE_UNSPECIFIED
	}
}

func artifactStatusToProto(status string) rpcv1.VoiceArtifactStatus {
	switch status {
	case ArtifactStatusPending:
		return rpcv1.VoiceArtifactStatus_VOICE_ARTIFACT_STATUS_PENDING
	case ArtifactStatusProcessing:
		return rpcv1.VoiceArtifactStatus_VOICE_ARTIFACT_STATUS_PROCESSING
	case ArtifactStatusReady:
		return rpcv1.VoiceArtifactStatus_VOICE_ARTIFACT_STATUS_READY
	case ArtifactStatusUnavailable:
		return rpcv1.VoiceArtifactStatus_VOICE_ARTIFACT_STATUS_UNAVAILABLE
	case ArtifactStatusFailed:
		return rpcv1.VoiceArtifactStatus_VOICE_ARTIFACT_STATUS_FAILED
	default:
		return rpcv1.VoiceArtifactStatus_VOICE_ARTIFACT_STATUS_UNSPECIFIED
	}
}

func codecForMIMEType(mimeType string) pgtype.Text {
	switch mimeType {
	case MIMETypeAudioWebM, MIMETypeAudioOgg:
		return pgtype.Text{String: AudioCodecOpus, Valid: true}
	case MIMETypeAudioMP4, MIMETypeAudioMPEG:
		return pgtype.Text{String: AudioCodecAAC, Valid: true}
	default:
		return pgtype.Text{}
	}
}

func callStateToProto(state string) rpcv1.VoiceCallState {
	switch state {
	case CallStateRinging:
		return rpcv1.VoiceCallState_VOICE_CALL_STATE_RINGING
	case CallStateActive:
		return rpcv1.VoiceCallState_VOICE_CALL_STATE_ACTIVE
	case CallStateEnding:
		return rpcv1.VoiceCallState_VOICE_CALL_STATE_ENDING
	case CallStateEnded:
		return rpcv1.VoiceCallState_VOICE_CALL_STATE_ENDED
	default:
		return rpcv1.VoiceCallState_VOICE_CALL_STATE_UNSPECIFIED
	}
}

func callOutcomeToProto(outcome pgtype.Text) rpcv1.VoiceCallOutcome {
	if !outcome.Valid {
		return rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_UNSPECIFIED
	}
	switch outcome.String {
	case CallOutcomeAnswered:
		return rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_ANSWERED
	case CallOutcomeMissed:
		return rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_MISSED
	case CallOutcomeDeclined:
		return rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_DECLINED
	case CallOutcomeCancelled:
		return rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_CANCELLED
	case CallOutcomeCompleted:
		return rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_COMPLETED
	default:
		return rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_UNSPECIFIED
	}
}

func participantStateToProto(state string) rpcv1.VoiceCallParticipantState {
	switch state {
	case ParticipantStateInvited:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_INVITED
	case ParticipantStateRinging:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_RINGING
	case ParticipantStateJoining:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_JOINING
	case ParticipantStateJoined:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_JOINED
	case ParticipantStateDisconnected:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_DISCONNECTED
	case ParticipantStateLeft:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_LEFT
	case ParticipantStateDeclined:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_DECLINED
	case ParticipantStateRemoved:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_REMOVED
	default:
		return rpcv1.VoiceCallParticipantState_VOICE_CALL_PARTICIPANT_STATE_UNSPECIFIED
	}
}

func invitationStatusToProto(status string) rpcv1.VoiceInvitationStatus {
	switch status {
	case InvitationStatusPending:
		return rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_PENDING
	case InvitationStatusAccepted:
		return rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_ACCEPTED
	case InvitationStatusDeclined:
		return rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_DECLINED
	case InvitationStatusExpired:
		return rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_EXPIRED
	case InvitationStatusRevoked:
		return rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_REVOKED
	default:
		return rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_UNSPECIFIED
	}
}

func (l *Logic) announceVoiceCallStarted(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID) error {
	if l.ChatAnnouncer == nil {
		return nil
	}
	if err := l.ChatAnnouncer.AnnounceVoiceCallStarted(ctx, tx, orgID, actorID, channelID, callID); err != nil {
		return fmt.Errorf("announce voice call started: %w", err)
	}
	return nil
}

func (l *Logic) announceVoiceCallEnded(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID, outcome string) error {
	if l.ChatAnnouncer == nil {
		return nil
	}
	if err := l.ChatAnnouncer.AnnounceVoiceCallEnded(ctx, tx, orgID, actorID, channelID, callID, outcome); err != nil {
		return fmt.Errorf("announce voice call ended: %w", err)
	}
	return nil
}

func (l *Logic) acknowledgeVoiceCallNotificationsForCall(ctx context.Context, tx database.DBTX, orgID, callID dbuuid.UUID) error {
	if err := l.Queries.AcknowledgeVoiceCallNotificationsForCall(ctx, tx, &database.AcknowledgeVoiceCallNotificationsForCallParams{
		AcknowledgedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		OrganizationID: orgID,
		CallID:         callID.String(),
	}); err != nil {
		slog.WarnContext(ctx, "failed to acknowledge voice call notifications", "error", err, "call_id", callID.String())
		return fmt.Errorf("acknowledge voice call notifications: %w", err)
	}
	return nil
}

func (l *Logic) publishVoiceCallEvent(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, notificationType, action string, session *rpcv1.VoiceCallSession, extra map[string]string) {
	if l.NotificationPublisher == nil || session == nil {
		return
	}
	actionData := map[string]string{
		"action":           action,
		"channelId":        session.ChannelId,
		"callId":           session.Id,
		"state":            session.State.String(),
		"participantCount": strconv.Itoa(len(session.Participants)),
	}
	for key, value := range extra {
		actionData[key] = value
	}
	l.publishVoiceCallChannelEvent(ctx, tx, orgID, notificationType, session, actionData)
	l.publishVoiceCallParticipantEvent(ctx, tx, orgID, notificationType, session, actionData)
}

func (l *Logic) publishVoiceCallChannelEvent(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, notificationType string, session *rpcv1.VoiceCallSession, actionData map[string]string) {
	if _, err := l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		OrganizationId:   converter.UUIDToProto(orgID),
		Recipients:       &rpcv1.NotificationRecipients{EmployeeIds: []string{}},
		SourceDomain:     notification.SourceDomainChat,
		NotificationType: notificationType,
		ActionCategory:   notificationType,
		ActionData:       actionData,
		Title:            "Voice call",
		Message:          "",
		Priority:         int32(notification.PrioritySilent),
		ActiveChannelId:  session.ChannelId,
		PolicyKey:        notification.PolicyKeyChatVoiceCallLive,
		DeliveryClass:    notification.DeliveryClassLiveOnly,
		SourceCategory:   notification.SourceCategorySystem,
	}); err != nil {
		slog.WarnContext(ctx, "failed to publish voice call live event", "error", err, "notification_type", notificationType, "call_id", session.Id)
	}
}

func (l *Logic) publishVoiceCallParticipantEvent(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, notificationType string, session *rpcv1.VoiceCallSession, actionData map[string]string) {
	employeeIDs := make([]string, 0, len(session.Participants))
	seen := make(map[string]struct{}, len(session.Participants))
	for _, participant := range session.Participants {
		employeeID := participant.GetEmployeeId()
		if employeeID == "" {
			continue
		}
		if _, ok := seen[employeeID]; ok {
			continue
		}
		seen[employeeID] = struct{}{}
		employeeIDs = append(employeeIDs, employeeID)
	}
	if len(employeeIDs) == 0 {
		return
	}
	if _, err := l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		OrganizationId:   converter.UUIDToProto(orgID),
		Recipients:       &rpcv1.NotificationRecipients{EmployeeIds: employeeIDs},
		SourceDomain:     notification.SourceDomainChat,
		NotificationType: notificationType,
		ActionCategory:   notificationType,
		ActionData:       actionData,
		Title:            "Voice call",
		Message:          "",
		Priority:         int32(notification.PrioritySilent),
		PolicyKey:        notification.PolicyKeyChatVoiceCallLive,
		DeliveryClass:    notification.DeliveryClassLiveOnly,
		SourceCategory:   notification.SourceCategorySystem,
	}); err != nil {
		slog.WarnContext(ctx, "failed to publish voice call participant live event", "error", err, "notification_type", notificationType, "call_id", session.Id)
	}
}

func (l *Logic) publishInviteNotification(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, call *database.VoiceCallSession, invitation *database.VoiceCallInvitation) {
	if l.NotificationPublisher == nil || call == nil || invitation == nil {
		return
	}
	channelName := "conversation"
	channelType := "chat"
	if channel, err := l.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             call.ChannelID,
		OrganizationID: orgID,
	}); err == nil {
		channelName = voiceNotificationChannelName(channel)
		if strings.TrimSpace(channel.ChannelType) != "" {
			channelType = channel.ChannelType
		}
	} else {
		slog.WarnContext(ctx, "failed to resolve voice invite channel metadata", "error", err, "channel_id", call.ChannelID.String())
	}
	callerName := l.voiceNotificationEmployeeName(ctx, tx, orgID, invitation.InviterEmployeeID)
	// The workspace name is the second and last human-readable string a lock screen is
	// allowed to show (FR-008): who is calling, and from which workspace. Nothing about
	// the conversation goes into a call wake.
	workspaceName := l.voiceNotificationWorkspaceName(ctx, tx, orgID)
	alreadyInAnotherCall := "false"
	if count, err := l.Queries.CountOtherActiveVoiceCallsForEmployee(ctx, tx, &database.CountOtherActiveVoiceCallsForEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     invitation.InviteeEmployeeID,
		CallSessionID:  call.ID,
	}); err == nil && count > 0 {
		alreadyInAnotherCall = "true"
	}
	if _, err := l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		OrganizationId: converter.UUIDToProto(orgID),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{invitation.InviteeEmployeeID.String()},
		},
		SourceDomain:     notification.SourceDomainChat,
		NotificationType: notification.NotificationTypeVoiceCallIncoming,
		ActionCategory:   notification.NotificationTypeVoiceCallIncoming,
		ActionData: map[string]string{
			"action":               "invite",
			"channelId":            call.ChannelID.String(),
			"channelName":          channelName,
			"channelType":          channelType,
			"callId":               call.ID.String(),
			"invitationId":         invitation.ID.String(),
			"inviterId":            invitation.InviterEmployeeID.String(),
			"initiatorEmployeeId":  call.InitiatorEmployeeID.String(),
			"senderEmployeeId":     invitation.InviterEmployeeID.String(),
			"senderName":           callerName,
			"alreadyInAnotherCall": alreadyInAnotherCall,
			// The call wake payload is built from action_data alone, so the device can
			// ring without a round trip to the server first — which is what keeps the
			// ring inside Android's 5-second budget on a cold start.
			"workspaceName": workspaceName,
			"callStartedAt": call.StartedAt.Time.UTC().Format(time.RFC3339),
			"ringExpiresAt": ringDeadlineText(call),
			"callWakeEvent": notification.CallWakeEventIncoming,
		},
		Title:          fmt.Sprintf("%s is calling", callerName),
		Message:        fmt.Sprintf("In %s", channelName),
		Priority:       int32(notification.PriorityAlways),
		PolicyKey:      notification.PolicyKeyChatVoiceCallIncoming,
		DeliveryClass:  notification.DeliveryClassPersistent,
		SourceCategory: notification.SourceCategorySystem,
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       notification.SourceDomainChat,
			ResourceType: "channel",
			ResourceId:   call.ChannelID.String(),
			SecondaryId:  invitation.ID.String(),
			Action:       "join_voice_call",
		},
	}); err != nil {
		slog.WarnContext(ctx, "failed to publish voice invite notification", "error", err, "invitation_id", invitation.ID.String())
	}
}

func voiceNotificationChannelName(channel *database.ChatChannel) string {
	if channel == nil {
		return "conversation"
	}
	if name := strings.TrimSpace(channel.DisplayName); name != "" {
		return name
	}
	if slug := strings.TrimSpace(channel.TitleSlug); slug != "" {
		return slug
	}
	return "conversation"
}

func (l *Logic) voiceNotificationEmployeeName(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) string {
	employee, err := l.Queries.GetEmployeeByID(ctx, tx, &database.GetEmployeeByIDParams{
		ID:             employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to resolve voice invite caller metadata", "error", err, "employee_id", employeeID.String())
		return "Someone"
	}

	name := strings.TrimSpace(strings.Join([]string{employee.GivenName, employee.FamilyName}, " "))
	if name != "" {
		return name
	}
	if email := strings.TrimSpace(employee.Email); email != "" {
		return email
	}
	return "Someone"
}

func timestampOrNil(value pgtype.Timestamptz) *timestamppb.Timestamp {
	if !value.Valid {
		return nil
	}
	return timestamppb.New(value.Time)
}

func endOutcomeFor(call *database.VoiceCallSession) string {
	if call.AnsweredAt.Valid || call.State == CallStateActive {
		return CallOutcomeCompleted
	}
	return CallOutcomeCancelled
}

func makeLiveKitRoomName(orgID, channelID dbuuid.UUID) string {
	return fmt.Sprintf("voice_%s_%s_%s", compactUUID(orgID), compactUUID(channelID), compactUUID(dbuuid.Must()))
}

func makeLiveKitIdentity(callID, employeeID dbuuid.UUID) string {
	return fmt.Sprintf("voice_%s_%s", compactUUID(callID), compactUUID(employeeID))
}

func compactUUID(id dbuuid.UUID) string {
	return strings.ReplaceAll(id.String(), "-", "")
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ensureDirectCallAllowed refuses a call placed in a direct conversation when
// either person has blocked the other (FR-020).
//
// It applies only to direct conversations. A call in a shared workplace channel is
// left alone, which is the agreed scope: hiding a colleague in a shared channel
// would let someone silently conceal instructions addressed to them.
func (l *Logic) ensureDirectCallAllowed(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) error {
	if l.ContactGuard == nil || l.ChannelAuthorizer == nil {
		return nil
	}
	counterpart, isDirect, err := l.ChannelAuthorizer.DirectMessageCounterpart(ctx, tx, orgID, employeeID, channelID)
	if err != nil {
		return fmt.Errorf("resolve direct conversation counterpart: %w", err)
	}
	if !isDirect {
		return nil
	}
	blocked, err := l.ContactGuard.IsDirectContactBlocked(ctx, tx, orgID, employeeID, counterpart)
	if err != nil {
		return fmt.Errorf("check direct contact block: %w", err)
	}
	if blocked {
		return ErrDirectContactBlocked
	}
	return nil
}

// ensureDirectCalleeAvailable refuses a direct call the callee cannot take, before the
// call session exists.
//
// Two outcomes, both of which the caller has to be able to tell apart from a call that
// simply went unanswered:
//
//   - busy: the callee is already on a workspace call. Ringing them would either
//     interrupt that call or ring a phone nobody can pick up (FR-015).
//   - unreachable: no device of theirs can be woken at all. Ending here rather than
//     ringing out for the full 45 seconds is what keeps a caller from re-dialling a
//     phone that was never going to ring (FR-006, SC-006).
//
// It applies to direct conversations only. In a shared channel there is no single
// callee to be busy or unreachable, and a call there is an open invitation rather than
// a ring at one person.
func (l *Logic) ensureDirectCalleeAvailable(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) error {
	if l.ChannelAuthorizer == nil {
		return nil
	}
	counterpart, isDirect, err := l.ChannelAuthorizer.DirectMessageCounterpart(ctx, tx, orgID, employeeID, channelID)
	if err != nil {
		return fmt.Errorf("resolve direct conversation counterpart: %w", err)
	}
	if !isDirect {
		return nil
	}

	activeCalls, err := l.Queries.CountOtherActiveVoiceCallsForEmployee(ctx, tx, &database.CountOtherActiveVoiceCallsForEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     counterpart,
		// No call to exclude: the one being placed does not exist yet.
		CallSessionID: dbuuid.UUID{},
	})
	if err != nil {
		return fmt.Errorf("count callee active voice calls: %w", err)
	}
	if activeCalls > 0 {
		return ErrCalleeBusy
	}

	// A missing dispatcher means the native tier is not wired at all; every device
	// still receives the tier-B ring, so refusing the call here would be wrong.
	if l.CallWakeDispatcher == nil {
		return nil
	}
	reachable, err := l.CallWakeDispatcher.HasCallWakeTarget(ctx, tx, orgID, counterpart)
	if err != nil {
		// Fail open. A reachability check that errors must not stop a call from being
		// placed: ringing a phone that turns out to be unreachable costs 45 seconds,
		// while refusing a call that would have connected costs the conversation.
		slog.WarnContext(ctx, "failed to check whether the callee can be woken - placing the call anyway",
			"error", err, "callee_employee_id", counterpart.String())
		return nil
	}
	if !reachable {
		return ErrCalleeUnreachable
	}
	return nil
}

// voiceNotificationWorkspaceName resolves the organization's display name for a call
// wake. It falls back to a neutral word rather than an identifier: a lock screen that
// shows a UUID is worse than one that says "Workspace".
func (l *Logic) voiceNotificationWorkspaceName(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID) string {
	org, err := l.Queries.GetOrganizationByID(ctx, tx, orgID)
	if err != nil {
		slog.WarnContext(ctx, "failed to resolve workspace name for call wake", "error", err, "organization_id", orgID.String())
		return "Workspace"
	}
	if name := strings.TrimSpace(org.CompanyName); name != "" {
		return name
	}
	return "Workspace"
}

// ringDeadlineText renders the call's ring deadline for the wake payload. A call row
// written before this feature has none; the empty string tells the device to rely on
// the terminal wake instead of a local expiry.
func ringDeadlineText(call *database.VoiceCallSession) string {
	if call == nil || !call.RingDeadlineAt.Valid {
		return ""
	}
	return call.RingDeadlineAt.Time.UTC().Format(time.RFC3339)
}
