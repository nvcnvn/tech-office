package voice

import (
	"context"
	"fmt"
	"mime"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
)

type ArtifactUpdate struct {
	FileID        dbuuid.NullUUID
	MimeType      string
	DurationMs    int64
	StorageBytes  int64
	Provider      string
	ProviderJobID string
	ErrorCode     string
	ErrorMessage  string
}

func (l *Logic) UpsertCallArtifact(ctx context.Context, tx database.DBTX, orgID, callID dbuuid.UUID, artifactType, status string, update ArtifactUpdate) (*database.VoiceCallArtifact, error) {
	if !IsValidArtifactType(artifactType) {
		return nil, fmt.Errorf("invalid voice artifact type %q", artifactType)
	}
	if !IsValidArtifactStatus(status) {
		return nil, fmt.Errorf("invalid voice artifact status %q", status)
	}
	if status == ArtifactStatusReady && !update.FileID.Valid {
		status = ArtifactStatusUnavailable
	}
	if status == ArtifactStatusFailed && strings.TrimSpace(update.ErrorCode) == "" {
		update.ErrorCode = "artifact_failed"
	}

	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	artifact, err := l.Queries.UpsertVoiceCallArtifact(ctx, tx, &database.UpsertVoiceCallArtifactParams{
		OrganizationID: orgID,
		CallSessionID:  callID,
		ArtifactType:   artifactType,
		Status:         status,
		FileID:         update.FileID,
		MimeType:       textFromString(update.MimeType),
		DurationMs:     int8FromInt64(update.DurationMs),
		StorageBytes:   int8FromInt64(update.StorageBytes),
		Provider:       textFromString(update.Provider),
		ProviderJobID:  textFromString(update.ProviderJobID),
		ErrorCode:      textFromString(update.ErrorCode),
		ErrorMessage:   textFromString(update.ErrorMessage),
		UpdatedAt:      now,
	})
	if err != nil {
		return nil, fmt.Errorf("upsert voice call artifact: %w", err)
	}
	if _, err := l.Queries.UpdateVoiceCallArtifactRollupStatus(ctx, tx, &database.UpdateVoiceCallArtifactRollupStatusParams{
		ArtifactType:   artifactType,
		Status:         status,
		UpdatedAt:      now,
		OrganizationID: orgID,
		CallSessionID:  callID,
	}); err != nil {
		return nil, fmt.Errorf("update voice call artifact rollup: %w", err)
	}
	return artifact, nil
}

func (l *Logic) PublishCallRecordRefresh(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, call *database.VoiceCallSession, action string) {
	session, err := l.callToProto(ctx, tx, call)
	if err != nil {
		return
	}
	l.publishVoiceCallEvent(ctx, tx, orgID, notification.NotificationTypeVoiceCallUpdated, action, session, nil)
}

func ArtifactUpdateFromEgressFile(fileName, location string, durationMs, storageBytes int64) ArtifactUpdate {
	return ArtifactUpdate{
		FileID:       fileIDFromArtifactLocation(fileName, location),
		MimeType:     mimeTypeForArtifactName(fileName, location),
		DurationMs:   durationMs,
		StorageBytes: storageBytes,
		Provider:     ArtifactProviderLiveKitEgress,
	}
}

func (l *Logic) startCallRecording(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, call *database.VoiceCallSession) {
	fileID := dbuuid.Must()
	if !l.Config.RecordingEnabled {
		_, _ = l.UpsertCallArtifact(ctx, tx, orgID, call.ID, ArtifactTypeRecording, ArtifactStatusUnavailable, ArtifactUpdate{
			FileID:       dbuuid.UUIDToNullUUID(fileID),
			MimeType:     "audio/ogg",
			Provider:     ArtifactProviderLiveKitEgress,
			ErrorCode:    "recording_disabled",
			ErrorMessage: "Voice call recording is not enabled for this deployment.",
		})
		return
	}
	recording, err := l.MediaClient.StartRoomRecording(ctx, RecordingOptions{
		OrganizationID: orgID,
		CallID:         call.ID,
		RoomName:       call.LivekitRoomName,
		FileID:         fileID,
	})
	if err != nil {
		_, _ = l.UpsertCallArtifact(ctx, tx, orgID, call.ID, ArtifactTypeRecording, ArtifactStatusFailed, ArtifactUpdate{
			FileID:       dbuuid.UUIDToNullUUID(fileID),
			MimeType:     "audio/ogg",
			Provider:     ArtifactProviderLiveKitEgress,
			ErrorCode:    "egress_start_failed",
			ErrorMessage: err.Error(),
		})
		return
	}
	_, _ = l.UpsertCallArtifact(ctx, tx, orgID, call.ID, ArtifactTypeRecording, ArtifactStatusProcessing, ArtifactUpdate{
		FileID:        dbuuid.UUIDToNullUUID(recording.FileID),
		MimeType:      "audio/ogg",
		Provider:      ArtifactProviderLiveKitEgress,
		ProviderJobID: recording.EgressID,
	})
}

func TranscriptArtifactUpdate(fileID dbuuid.UUID, mimeType string, storageBytes int64) ArtifactUpdate {
	if strings.TrimSpace(mimeType) == "" {
		mimeType = "text/vtt"
	}
	return ArtifactUpdate{
		FileID:       dbuuid.UUIDToNullUUID(fileID),
		MimeType:     mimeType,
		StorageBytes: storageBytes,
		Provider:     ArtifactProviderTranscriptionWorker,
	}
}

func textFromString(value string) pgtype.Text {
	value = strings.TrimSpace(value)
	if value == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}

func int8FromInt64(value int64) pgtype.Int8 {
	if value <= 0 {
		return pgtype.Int8{}
	}
	return pgtype.Int8{Int64: value, Valid: true}
}

func fileIDFromArtifactLocation(values ...string) dbuuid.NullUUID {
	for _, value := range values {
		candidate := strings.TrimSuffix(filepath.Base(strings.TrimSpace(value)), filepath.Ext(value))
		if id, err := dbuuid.Parse(candidate); err == nil {
			return dbuuid.UUIDToNullUUID(id)
		}
	}
	return dbuuid.NullUUID{}
}

func mimeTypeForArtifactName(values ...string) string {
	for _, value := range values {
		if ext := filepath.Ext(value); ext != "" {
			if detected := mime.TypeByExtension(ext); detected != "" {
				return detected
			}
		}
	}
	return "audio/ogg"
}
