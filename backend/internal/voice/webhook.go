package voice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	lkauth "github.com/livekit/protocol/auth"
	lklivekit "github.com/livekit/protocol/livekit"
	lkwebhook "github.com/livekit/protocol/webhook"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
)

func NewLiveKitWebhookHandler(logic *Logic, adminPool database.AdminDatabaseConnector, config Config) http.Handler {
	provider := lkauth.NewSimpleKeyProvider(config.LiveKitAPIKey, config.LiveKitAPISecret)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		event, err := lkwebhook.ReceiveWebhookEvent(r, provider)
		if err != nil {
			slog.WarnContext(r.Context(), "rejected livekit webhook", "error", err)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		if err := txn.WithTxn(r.Context(), adminPool, func(ctx context.Context, tx database.DBTX) error {
			return logic.ReconcileLiveKitWebhook(ctx, tx, event)
		}); err != nil {
			if errors.Is(err, ErrCallNotFound) {
				slog.WarnContext(r.Context(), "ignored livekit webhook for unknown voice call", "event_type", event.GetEvent(), "error", err)
				w.WriteHeader(http.StatusAccepted)
				return
			}
			slog.ErrorContext(r.Context(), "failed to process livekit webhook", "event_type", event.GetEvent(), "error", err)
			http.Error(w, "webhook processing failed", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})
}

func (l *Logic) ReconcileLiveKitWebhook(ctx context.Context, tx database.DBTX, event *lklivekit.WebhookEvent) error {
	if event == nil {
		return nil
	}
	switch event.GetEvent() {
	case lkwebhook.EventParticipantJoined:
		return l.reconcileLiveKitParticipantJoined(ctx, tx, event)
	case lkwebhook.EventParticipantLeft, lkwebhook.EventParticipantConnectionAborted:
		return l.reconcileLiveKitParticipantLeft(ctx, tx, event)
	case lkwebhook.EventRoomFinished:
		return l.reconcileLiveKitRoomFinished(ctx, tx, event)
	case lkwebhook.EventEgressStarted:
		return l.reconcileLiveKitEgressStarted(ctx, tx, event)
	case lkwebhook.EventEgressEnded:
		return l.reconcileLiveKitEgressEnded(ctx, tx, event)
	default:
		return nil
	}
}

func (l *Logic) reconcileLiveKitParticipantJoined(ctx context.Context, tx database.DBTX, event *lklivekit.WebhookEvent) error {
	call, err := l.callForWebhookEvent(ctx, tx, event)
	if err != nil {
		return err
	}
	participantInfo := event.GetParticipant()
	if participantInfo == nil || participantInfo.GetIdentity() == "" {
		return fmt.Errorf("livekit participant_joined missing participant identity")
	}
	participant, err := l.Queries.GetVoiceCallParticipantByIdentity(ctx, tx, &database.GetVoiceCallParticipantByIdentityParams{OrganizationID: call.OrganizationID, LivekitIdentity: participantInfo.GetIdentity()})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrCallNotFound
	}
	if err != nil {
		return fmt.Errorf("get voice participant by livekit identity: %w", err)
	}
	now := webhookTimestamp(event)
	if _, err := l.Queries.UpdateVoiceCallParticipantState(ctx, tx, &database.UpdateVoiceCallParticipantStateParams{
		State:          ParticipantStateJoined,
		JoinedAt:       now,
		LastSeenAt:     now,
		UpdatedAt:      now,
		OrganizationID: call.OrganizationID,
		ParticipantID:  participant.ID,
	}); err != nil {
		return fmt.Errorf("mark livekit participant joined: %w", err)
	}
	if call.State == CallStateRinging && participant.EmployeeID != call.InitiatorEmployeeID {
		answeredCall, err := l.Queries.MarkVoiceCallAnswered(ctx, tx, &database.MarkVoiceCallAnsweredParams{AnsweredAt: now, OrganizationID: call.OrganizationID, CallSessionID: call.ID})
		if err != nil {
			return fmt.Errorf("mark webhook voice call answered: %w", err)
		}
		call = answeredCall
	}
	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return err
	}
	l.publishVoiceCallEvent(ctx, tx, call.OrganizationID, notification.NotificationTypeVoiceCallUpdated, "participant_joined", session, map[string]string{"employeeId": participant.EmployeeID.String()})
	return nil
}

func (l *Logic) reconcileLiveKitParticipantLeft(ctx context.Context, tx database.DBTX, event *lklivekit.WebhookEvent) error {
	call, err := l.callForWebhookEvent(ctx, tx, event)
	if err != nil {
		return err
	}
	if call.State == CallStateEnded {
		return nil
	}
	participantInfo := event.GetParticipant()
	if participantInfo == nil || participantInfo.GetIdentity() == "" {
		return fmt.Errorf("livekit participant_left missing participant identity")
	}
	participant, err := l.Queries.GetVoiceCallParticipantByIdentity(ctx, tx, &database.GetVoiceCallParticipantByIdentityParams{OrganizationID: call.OrganizationID, LivekitIdentity: participantInfo.GetIdentity()})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrCallNotFound
	}
	if err != nil {
		return fmt.Errorf("get voice participant by livekit identity: %w", err)
	}
	now := webhookTimestamp(event)
	state := ParticipantStateLeft
	if event.GetEvent() == lkwebhook.EventParticipantConnectionAborted {
		state = ParticipantStateDisconnected
	}
	if _, err := l.Queries.UpdateVoiceCallParticipantState(ctx, tx, &database.UpdateVoiceCallParticipantStateParams{
		State:            state,
		LeftAt:           now,
		LastSeenAt:       now,
		DisconnectReason: textFromString(participantInfo.GetDisconnectReason().String()),
		UpdatedAt:        now,
		OrganizationID:   call.OrganizationID,
		ParticipantID:    participant.ID,
	}); err != nil {
		return fmt.Errorf("mark livekit participant left: %w", err)
	}

	activeCount, err := l.Queries.CountActiveVoiceCallParticipants(ctx, tx, &database.CountActiveVoiceCallParticipantsParams{OrganizationID: call.OrganizationID, CallSessionID: call.ID})
	if err != nil {
		return fmt.Errorf("count active voice participants after webhook leave: %w", err)
	}
	if activeCount == 0 {
		endedCall, err := l.finishCallFromWebhook(ctx, tx, call, inferWebhookOutcome(call))
		if err != nil {
			return err
		}
		session, err := l.callToProto(ctx, tx, endedCall)
		if err != nil {
			return err
		}
		l.publishVoiceCallEvent(ctx, tx, call.OrganizationID, notification.NotificationTypeVoiceCallEnded, "ended", session, map[string]string{"employeeId": participant.EmployeeID.String(), "outcome": textOrEmpty(endedCall.Outcome)})
		return nil
	}
	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return err
	}
	l.publishVoiceCallEvent(ctx, tx, call.OrganizationID, notification.NotificationTypeVoiceCallUpdated, "participant_left", session, map[string]string{"employeeId": participant.EmployeeID.String()})
	return nil
}

func (l *Logic) reconcileLiveKitRoomFinished(ctx context.Context, tx database.DBTX, event *lklivekit.WebhookEvent) error {
	call, err := l.callForWebhookEvent(ctx, tx, event)
	if err != nil {
		return err
	}
	if call.State == CallStateEnded {
		return nil
	}
	endedCall, err := l.finishCallFromWebhook(ctx, tx, call, inferWebhookOutcome(call))
	if err != nil {
		return err
	}
	session, err := l.callToProto(ctx, tx, endedCall)
	if err != nil {
		return err
	}
	l.publishVoiceCallEvent(ctx, tx, call.OrganizationID, notification.NotificationTypeVoiceCallEnded, "ended", session, map[string]string{"outcome": textOrEmpty(endedCall.Outcome)})
	return nil
}

func (l *Logic) reconcileLiveKitEgressStarted(ctx context.Context, tx database.DBTX, event *lklivekit.WebhookEvent) error {
	call, err := l.callForWebhookEvent(ctx, tx, event)
	if err != nil {
		return err
	}
	egressInfo := event.GetEgressInfo()
	if egressInfo == nil || egressInfo.GetEgressId() == "" {
		return fmt.Errorf("livekit egress_started missing egress id")
	}
	_, err = l.UpsertCallArtifact(ctx, tx, call.OrganizationID, call.ID, ArtifactTypeRecording, ArtifactStatusProcessing, ArtifactUpdate{
		Provider:      ArtifactProviderLiveKitEgress,
		ProviderJobID: egressInfo.GetEgressId(),
	})
	if err != nil {
		return err
	}
	l.PublishCallRecordRefresh(ctx, tx, call.OrganizationID, call, "recording_processing")
	return nil
}

func (l *Logic) reconcileLiveKitEgressEnded(ctx context.Context, tx database.DBTX, event *lklivekit.WebhookEvent) error {
	call, err := l.callForWebhookEvent(ctx, tx, event)
	if err != nil {
		return err
	}
	egressInfo := event.GetEgressInfo()
	if egressInfo == nil || egressInfo.GetEgressId() == "" {
		return fmt.Errorf("livekit egress_ended missing egress id")
	}
	status := ArtifactStatusFailed
	update := ArtifactUpdate{
		Provider:      ArtifactProviderLiveKitEgress,
		ProviderJobID: egressInfo.GetEgressId(),
		ErrorCode:     strconv.Itoa(int(egressInfo.GetErrorCode())),
		ErrorMessage:  strings.TrimSpace(egressInfo.GetError() + " " + egressInfo.GetDetails()),
	}
	if egressInfo.GetStatus() == lklivekit.EgressStatus_EGRESS_COMPLETE {
		status = ArtifactStatusUnavailable
		if len(egressInfo.GetFileResults()) > 0 {
			fileInfo := egressInfo.GetFileResults()[0]
			update = ArtifactUpdateFromEgressFile(fileInfo.GetFilename(), fileInfo.GetLocation(), fileInfo.GetDuration(), fileInfo.GetSize())
			update.ProviderJobID = egressInfo.GetEgressId()
			if update.FileID.Valid {
				status = ArtifactStatusReady
			}
		}
	}
	_, err = l.UpsertCallArtifact(ctx, tx, call.OrganizationID, call.ID, ArtifactTypeRecording, status, update)
	if err != nil {
		return err
	}
	l.PublishCallRecordRefresh(ctx, tx, call.OrganizationID, call, "recording_updated")
	// Trigger async transcription once the recording file is confirmed ready.
	if status == ArtifactStatusReady && update.FileID.Valid && l.TranscriptionWorker != nil {
		l.TranscriptionWorker.TriggerAsync(call.OrganizationID, call.ID, dbuuid.NullUUIDToUUID(update.FileID))
	}
	return nil
}

func (l *Logic) callForWebhookEvent(ctx context.Context, tx database.DBTX, event *lklivekit.WebhookEvent) (*database.VoiceCallSession, error) {
	roomName := ""
	if room := event.GetRoom(); room != nil {
		roomName = room.GetName()
	}
	if roomName == "" && event.GetEgressInfo() != nil {
		roomName = event.GetEgressInfo().GetRoomName()
	}
	if roomName == "" {
		return nil, fmt.Errorf("livekit webhook missing room name")
	}
	orgID, err := organizationIDFromLiveKitRoomName(roomName)
	if err != nil {
		return nil, err
	}
	call, err := l.Queries.GetVoiceCallSessionByLiveKitRoom(ctx, tx, &database.GetVoiceCallSessionByLiveKitRoomParams{OrganizationID: orgID, LivekitRoomName: roomName})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCallNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get voice call by livekit room: %w", err)
	}
	return call, nil
}

func (l *Logic) finishCallFromWebhook(ctx context.Context, tx database.DBTX, call *database.VoiceCallSession, outcome string) (*database.VoiceCallSession, error) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	endedCall, err := l.Queries.EndVoiceCallSession(ctx, tx, &database.EndVoiceCallSessionParams{
		Outcome:           pgtype.Text{String: outcome, Valid: true},
		EndedAt:           now,
		EndedByEmployeeID: dbuuid.NullUUID{},
		EndedReason:       pgtype.Text{String: "livekit_room_finished", Valid: true},
		OrganizationID:    call.OrganizationID,
		CallSessionID:     call.ID,
	})
	if err != nil {
		return nil, fmt.Errorf("finish voice call from webhook: %w", err)
	}
	// A room finishing is a terminal path like any other, so the phones have to be told
	// here too — this is the path that ends a call nobody answered from the app.
	// LiveKit told us the room closed; no handset acted, so nothing is excluded.
	l.emitTerminalCallWake(ctx, tx, call.OrganizationID, endedCall, terminalWakeEventForOutcome(outcome), "")
	if err := l.acknowledgeVoiceCallNotificationsForCall(ctx, tx, call.OrganizationID, call.ID); err != nil {
		return nil, err
	}
	if err := l.announceVoiceCallEnded(ctx, tx, call.OrganizationID, call.InitiatorEmployeeID, call.ChannelID, call.ID, outcome); err != nil {
		return nil, err
	}
	return endedCall, nil
}

func inferWebhookOutcome(call *database.VoiceCallSession) string {
	if call.AnsweredAt.Valid || call.State == CallStateActive {
		return CallOutcomeCompleted
	}
	return CallOutcomeMissed
}

func webhookTimestamp(event *lklivekit.WebhookEvent) pgtype.Timestamptz {
	if event.GetCreatedAt() > 0 {
		return pgtype.Timestamptz{Time: time.Unix(event.GetCreatedAt(), 0), Valid: true}
	}
	return pgtype.Timestamptz{Time: time.Now(), Valid: true}
}

func organizationIDFromLiveKitRoomName(roomName string) (dbuuid.UUID, error) {
	parts := strings.Split(roomName, "_")
	if len(parts) < 3 || parts[0] != "voice" {
		return dbuuid.UUID{}, fmt.Errorf("invalid livekit voice room name")
	}
	return parseCompactUUID(parts[1])
}

func parseCompactUUID(value string) (dbuuid.UUID, error) {
	if len(value) != 32 {
		return dbuuid.UUID{}, fmt.Errorf("invalid compact uuid")
	}
	return dbuuid.Parse(fmt.Sprintf("%s-%s-%s-%s-%s", value[0:8], value[8:12], value[12:16], value[16:20], value[20:32]))
}
