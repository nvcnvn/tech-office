package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
)

// transcriptUploader is the subset of files.R2Client used to upload transcript files.
type transcriptUploader interface {
	PutObject(ctx context.Context, storageKey, contentType string, body io.Reader) (int64, error)
}

// TranscriptionWorker transcribes completed voice-call recordings using an
// OpenAI Whisper-compatible API and stores the resulting WebVTT file in R2.
type TranscriptionWorker struct {
	AdminPool database.AdminDatabaseConnector
	MainR2    transcriptUploader
	Logic     *Logic
	Config    Config
}

// TriggerAsync starts transcription in a background goroutine.
// It is a no-op when transcription is disabled or the API key is empty.
func (w *TranscriptionWorker) TriggerAsync(orgID, callID, recordingFileID dbuuid.UUID) {
	if !w.Config.TranscriptionEnabled || strings.TrimSpace(w.Config.WhisperAPIKey) == "" {
		return
	}
	go w.run(orgID, callID, recordingFileID)
}

func (w *TranscriptionWorker) run(orgID, callID, recordingFileID dbuuid.UUID) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	log := slog.With("org_id", orgID, "call_id", callID, "recording_file_id", recordingFileID)

	// Mark transcript as pending so the UI shows a progress indicator.
	if err := txn.WithTxn(ctx, w.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		call, fErr := w.Logic.Queries.GetVoiceCallSession(ctx, tx, &database.GetVoiceCallSessionParams{
			OrganizationID: orgID,
			CallSessionID:  callID,
		})
		if fErr != nil {
			return fmt.Errorf("get call session: %w", fErr)
		}
		_, fErr = w.Logic.UpsertCallArtifact(ctx, tx, orgID, callID, ArtifactTypeTranscript, ArtifactStatusPending, ArtifactUpdate{
			Provider: ArtifactProviderTranscriptionWorker,
		})
		if fErr != nil {
			return fErr
		}
		w.Logic.PublishCallRecordRefresh(ctx, tx, orgID, call, "transcript_pending")
		return nil
	}); err != nil {
		log.ErrorContext(ctx, "transcription: failed to mark pending", "error", err)
		return
	}

	// Build the recording storage key from the well-known convention.
	recordingKey := path.Join(
		strings.Trim(w.Config.RecordingPrefix, "/"),
		orgID.String(),
		callID.String(),
		recordingFileID.String()+".ogg",
	)

	// Download recording audio from the recording bucket.
	audioData, err := w.downloadRecording(ctx, recordingKey)
	if err != nil {
		log.ErrorContext(ctx, "transcription: download failed", "key", recordingKey, "error", err)
		w.failTranscript(ctx, log, orgID, callID, "download_failed", err.Error())
		return
	}

	// Transcribe via the Whisper API.
	vttText, err := whisperTranscribe(ctx, w.Config, audioData)
	if err != nil {
		log.ErrorContext(ctx, "transcription: Whisper API error", "error", err)
		w.failTranscript(ctx, log, orgID, callID, "transcription_failed", err.Error())
		return
	}

	// Upload the WebVTT transcript to the main R2 bucket.
	transcriptFileID := dbuuid.Must()
	transcriptKey := path.Join(
		"org-"+orgID.String(),
		"voice-transcripts",
		callID.String(),
		transcriptFileID.String()+".vtt",
	)
	transcriptBytes := []byte(vttText)
	if _, err := w.MainR2.PutObject(ctx, transcriptKey, "text/vtt", bytes.NewReader(transcriptBytes)); err != nil {
		log.ErrorContext(ctx, "transcription: upload failed", "error", err)
		w.failTranscript(ctx, log, orgID, callID, "upload_failed", err.Error())
		return
	}

	// Persist file metadata and update the artifact in one transaction.
	if err := txn.WithTxn(ctx, w.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		call, fErr := w.Logic.Queries.GetVoiceCallSession(ctx, tx, &database.GetVoiceCallSessionParams{
			OrganizationID: orgID,
			CallSessionID:  callID,
		})
		if fErr != nil {
			return fmt.Errorf("get call session: %w", fErr)
		}
		if _, fErr = w.Logic.Queries.CreateFileMetadata(ctx, tx, &database.CreateFileMetadataParams{
			ID:                   transcriptFileID,
			OrganizationID:       orgID,
			OriginalFilename:     "transcript.vtt",
			StorageKey:           transcriptKey,
			SizeBytes:            int64(len(transcriptBytes)),
			MimeType:             "text/vtt",
			UploadContext:        "voice_transcript",
			UploadedByEmployeeID: call.InitiatorEmployeeID,
		}); fErr != nil {
			return fmt.Errorf("create transcript file metadata: %w", fErr)
		}
		_, fErr = w.Logic.UpsertCallArtifact(ctx, tx, orgID, callID, ArtifactTypeTranscript, ArtifactStatusReady,
			TranscriptArtifactUpdate(transcriptFileID, "text/vtt", int64(len(transcriptBytes))))
		if fErr != nil {
			return fErr
		}
		w.Logic.PublishCallRecordRefresh(ctx, tx, orgID, call, "transcript_updated")
		return nil
	}); err != nil {
		log.ErrorContext(ctx, "transcription: persist failed", "error", err)
		w.failTranscript(ctx, log, orgID, callID, "persist_failed", err.Error())
		return
	}

	log.InfoContext(ctx, "transcription: completed", "transcript_file_id", transcriptFileID)
}

func (w *TranscriptionWorker) failTranscript(ctx context.Context, log *slog.Logger, orgID, callID dbuuid.UUID, errCode, errMsg string) {
	if err := txn.WithTxn(ctx, w.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		call, fErr := w.Logic.Queries.GetVoiceCallSession(ctx, tx, &database.GetVoiceCallSessionParams{
			OrganizationID: orgID,
			CallSessionID:  callID,
		})
		if fErr != nil {
			return fErr
		}
		_, fErr = w.Logic.UpsertCallArtifact(ctx, tx, orgID, callID, ArtifactTypeTranscript, ArtifactStatusFailed, ArtifactUpdate{
			Provider:     ArtifactProviderTranscriptionWorker,
			ErrorCode:    errCode,
			ErrorMessage: errMsg,
		})
		if fErr != nil {
			return fErr
		}
		w.Logic.PublishCallRecordRefresh(ctx, tx, orgID, call, "transcript_failed")
		return nil
	}); err != nil {
		log.ErrorContext(ctx, "transcription: failed to record failure", "error", err)
	}
}

// downloadRecording fetches the OGG recording from the configured recording bucket.
func (w *TranscriptionWorker) downloadRecording(ctx context.Context, storageKey string) ([]byte, error) {
	customResolver := aws.EndpointResolverWithOptionsFunc(
		func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL:               w.Config.RecordingEndpoint,
				SigningRegion:     "auto",
				HostnameImmutable: true,
			}, nil
		},
	)
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion("auto"),
		awsconfig.WithEndpointResolverWithOptions(customResolver),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(
				w.Config.RecordingAccessKeyID,
				w.Config.RecordingSecretAccessKey,
				"",
			),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("configure recording R2 client: %w", err)
	}
	s3Client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	})
	result, err := s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(w.Config.RecordingBucket),
		Key:    aws.String(storageKey),
	})
	if err != nil {
		return nil, fmt.Errorf("get recording from R2 (%s): %w", storageKey, err)
	}
	defer result.Body.Close()
	// 200 MB safety cap — Whisper API also rejects files larger than 25 MB.
	const maxSize = 200 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(result.Body, maxSize))
	if err != nil {
		return nil, fmt.Errorf("read recording body: %w", err)
	}
	return data, nil
}

// whisperTranscribe sends audio to the Whisper API and returns a WebVTT string.
func whisperTranscribe(ctx context.Context, cfg Config, audioData []byte) (string, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)

	// The "file" field must carry a recognised audio filename so the API
	// can infer the codec.  OGG is accepted by the Whisper endpoint.
	fh := make(textproto.MIMEHeader)
	fh.Set("Content-Disposition", `form-data; name="file"; filename="recording.ogg"`)
	fh.Set("Content-Type", "audio/ogg")
	fw, err := mw.CreatePart(fh)
	if err != nil {
		return "", fmt.Errorf("whisper: create file part: %w", err)
	}
	if _, err := fw.Write(audioData); err != nil {
		return "", fmt.Errorf("whisper: write audio data: %w", err)
	}
	if err := mw.WriteField("model", cfg.WhisperModel); err != nil {
		return "", fmt.Errorf("whisper: write model field: %w", err)
	}
	if err := mw.WriteField("response_format", "vtt"); err != nil {
		return "", fmt.Errorf("whisper: write response_format field: %w", err)
	}
	if lang := strings.TrimSpace(cfg.WhisperLanguage); lang != "" {
		if err := mw.WriteField("language", lang); err != nil {
			return "", fmt.Errorf("whisper: write language field: %w", err)
		}
	}
	mw.Close()

	apiURL := strings.TrimRight(cfg.WhisperAPIURL, "/") + "/audio/transcriptions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, &body)
	if err != nil {
		return "", fmt.Errorf("whisper: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+cfg.WhisperAPIKey)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	httpClient := &http.Client{Timeout: 10 * time.Minute}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("whisper: request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return "", fmt.Errorf("whisper: read response body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var apiErr struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(respBody, &apiErr) == nil && apiErr.Error.Message != "" {
			return "", fmt.Errorf("whisper: API error %d: %s", resp.StatusCode, apiErr.Error.Message)
		}
		return "", fmt.Errorf("whisper: unexpected status %d", resp.StatusCode)
	}

	return string(respBody), nil
}
