package files

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/h2non/filetype"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/flows"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// FileValidationWorkflowInput contains the input parameters for file validation workflow
type FileValidationWorkflowInput struct {
	OrganizationID   dbuuid.UUID `json:"organization_id"`
	FileID           dbuuid.UUID `json:"file_id"`
	StorageKey       string      `json:"storage_key"`
	DeclaredMimeType string      `json:"declared_mime_type"`
}

// FileValidationWorkflowOutput contains the validation result
type FileValidationWorkflowOutput struct {
	ValidationStatus  string `json:"validation_status"`
	ValidationMessage string `json:"validation_message,omitempty"`
	DetectedMimeType  string `json:"detected_mime_type,omitempty"`
}

// FileValidationServices holds shared dependencies for file validation workflow
type FileValidationServices struct {
	Queries      *database.Queries
	AdminPool    database.AdminDatabaseConnector
	R2Client     *R2Client
	ClamAVClient *ClamAVClient
	PDFLogic     PDFLogic
}

func retryPolicyFromAttempts(maxAttempts int, initial time.Duration, factor float64, maxInterval time.Duration) flows.RetryPolicy {
	maxRetries := maxAttempts - 1
	if maxRetries < 0 {
		maxRetries = 0
	}

	// flows.RetryPolicy.Backoff is expressed in milliseconds.
	// attempt is the retry attempt index starting at 0.
	return flows.RetryPolicy{
		MaxRetries: maxRetries,
		Backoff: func(attempt int) int {
			if attempt < 0 {
				attempt = 0
			}
			d := time.Duration(float64(initial) * math.Pow(factor, float64(attempt)))
			if d > maxInterval {
				d = maxInterval
			}
			if d < 0 {
				d = 0
			}
			return int(d.Milliseconds())
		},
	}
}

// ValidateFileTypeInput contains input for file type validation
type ValidateFileTypeInput struct {
	StorageKey       string `json:"storage_key"`
	DeclaredMimeType string `json:"declared_mime_type"`
}

// ValidateFileTypeOutput contains the validation result
type ValidateFileTypeOutput struct {
	DetectedMimeType  string `json:"detected_mime_type"`
	ValidationStatus  string `json:"validation_status"`
	ValidationMessage string `json:"validation_message"`
}

// UpdateValidationStatusInput contains input for updating validation status
type UpdateValidationStatusInput struct {
	OrganizationID    dbuuid.UUID `json:"organization_id"`
	FileID            dbuuid.UUID `json:"file_id"`
	ValidationStatus  string      `json:"validation_status"`
	ValidationMessage string      `json:"validation_message"`
	DetectedMimeType  string      `json:"detected_mime_type"`
}

// UpdateValidationStatusOutput contains the result of updating validation status
type UpdateValidationStatusOutput struct {
	Success bool `json:"success"`
}

// ScanFileInput contains input for virus scanning
type ScanFileInput struct {
	StorageKey string `json:"storage_key"`
}

// ScanFileOutput contains virus scanning result
type ScanFileOutput struct {
	IsClean   bool   `json:"is_clean"`
	VirusName string `json:"virus_name"`
}

// FileValidationSteps holds step functions for file validation workflow.
// In flows@v0.0.2, steps are plain functions executed via flows.Execute.
type FileValidationSteps struct {
	ValidateFileType       flows.Step[ValidateFileTypeInput, ValidateFileTypeOutput]
	UpdateValidationStatus flows.Step[UpdateValidationStatusInput, UpdateValidationStatusOutput]
	ScanFile               flows.Step[ScanFileInput, ScanFileOutput]

	ValidateFileTypeRetry       flows.RetryPolicy
	UpdateValidationStatusRetry flows.RetryPolicy
	ScanFileRetry               flows.RetryPolicy
}

// NewFileValidationSteps creates step functions with injected dependencies via closures.
func NewFileValidationSteps(svc *FileValidationServices) *FileValidationSteps {
	retry := retryPolicyFromAttempts(3, 1*time.Second, 2.0, 10*time.Second)

	return &FileValidationSteps{
		ValidateFileType: func(ctx context.Context, input *ValidateFileTypeInput) (*ValidateFileTypeOutput, error) {
			// Download file header from R2 (first 8KB for magic byte detection)
			header, err := svc.R2Client.ReadRange(ctx, input.StorageKey, 0, 8192)
			if err != nil {
				slog.ErrorContext(ctx, "failed to read file header from R2",
					"error", err,
					"storage_key", input.StorageKey)
				return nil, fmt.Errorf("failed to read file header: %w", err)
			}

			// Detect file type using filetype library
			detectedType, err := filetype.Match(header)
			if err != nil || detectedType == filetype.Unknown {
				slog.WarnContext(ctx, "unable to detect file type", "error", err)
				return &ValidateFileTypeOutput{
					ValidationStatus:  ValidationStatusWarning,
					ValidationMessage: "Unable to verify file type",
				}, nil
			}

			detectedMimeType := detectedType.MIME.Value
			validationStatus := ValidationStatusVerified
			validationMessage := ""

			if detectedMimeType != input.DeclaredMimeType {
				validationStatus = ValidationStatusWarning
				validationMessage = fmt.Sprintf("File type mismatch: declared %s, detected %s",
					input.DeclaredMimeType, detectedMimeType)
				slog.WarnContext(ctx, "file type mismatch detected",
					"declared", input.DeclaredMimeType,
					"detected", detectedMimeType)
			}

			return &ValidateFileTypeOutput{
				DetectedMimeType:  detectedMimeType,
				ValidationStatus:  validationStatus,
				ValidationMessage: validationMessage,
			}, nil
		},
		UpdateValidationStatus: func(ctx context.Context, input *UpdateValidationStatusInput) (*UpdateValidationStatusOutput, error) {
			err := svc.Queries.UpdateFileValidation(ctx, svc.AdminPool, &database.UpdateFileValidationParams{
				OrganizationID:   input.OrganizationID,
				ID:               input.FileID,
				ValidationStatus: pgtype.Text{String: input.ValidationStatus, Valid: true},
				ValidationMessage: pgtype.Text{
					String: input.ValidationMessage,
					Valid:  input.ValidationMessage != "",
				},
				DetectedMimeType: pgtype.Text{
					String: input.DetectedMimeType,
					Valid:  input.DetectedMimeType != "",
				},
			})
			if err != nil {
				slog.ErrorContext(ctx, "failed to update validation status", "error", err)
				return nil, err
			}
			return &UpdateValidationStatusOutput{Success: true}, nil
		},
		ScanFile: func(ctx context.Context, input *ScanFileInput) (*ScanFileOutput, error) {
			// Stream file from R2
			reader, err := svc.R2Client.GetReader(ctx, input.StorageKey)
			if err != nil {
				return nil, fmt.Errorf("failed to get reader from R2: %w", err)
			}
			defer reader.Close()

			// Scan stream
			isClean, virusName, err := svc.ClamAVClient.ScanStream(ctx, reader)
			if err != nil {
				return nil, fmt.Errorf("scan failed: %w", err)
			}

			return &ScanFileOutput{
				IsClean:   isClean,
				VirusName: virusName,
			}, nil
		},

		ValidateFileTypeRetry:       retry,
		UpdateValidationStatusRetry: retry,
		ScanFileRetry:               retry,
	}
}

// FileValidationWorkflows holds workflows for file validation
type FileValidationWorkflows struct {
	FileValidation flows.Workflow[FileValidationWorkflowInput, FileValidationWorkflowOutput]
}

type fileValidationWorkflow struct {
	steps *FileValidationSteps
}

func (w *fileValidationWorkflow) Name() string {
	return WorkflowNameFileValidation
}

func (w *fileValidationWorkflow) Run(ctx context.Context, wf *flows.Context, input *FileValidationWorkflowInput) (*FileValidationWorkflowOutput, error) {
	// Step 1: Validate file type using magic bytes (includes download)
	validateResult, err := flows.Execute(ctx, wf, "validate-file-type/v1", w.steps.ValidateFileType, &ValidateFileTypeInput{
		StorageKey:       input.StorageKey,
		DeclaredMimeType: input.DeclaredMimeType,
	}, w.steps.ValidateFileTypeRetry)
	if err != nil {
		finalStatus := ValidationStatusFailed
		finalMessage := fmt.Sprintf("Unable to validate file: %v", err)
		_, _ = flows.Execute(ctx, wf, "update-validation-status/v1", w.steps.UpdateValidationStatus, &UpdateValidationStatusInput{
			OrganizationID:    input.OrganizationID,
			FileID:            input.FileID,
			ValidationStatus:  finalStatus,
			ValidationMessage: finalMessage,
			DetectedMimeType:  "",
		}, w.steps.UpdateValidationStatusRetry)
		return nil, fmt.Errorf("validate file type failed: %w", err)
	}

	// Track validation status and results
	finalStatus := validateResult.ValidationStatus
	finalMessage := validateResult.ValidationMessage
	finalMimeType := validateResult.DetectedMimeType

	// Step 2: Virus Scan (critical security check)
	// Scan all files regardless of validation status to ensure safety
	if finalStatus != ValidationStatusFailed {
		scanResult, scanErr := flows.Execute(ctx, wf, "scan-file/v1", w.steps.ScanFile, &ScanFileInput{
			StorageKey: input.StorageKey,
		}, w.steps.ScanFileRetry)
		if scanErr != nil {
			// Scanning failure is a critical error - fail validation
			slog.ErrorContext(ctx, "virus scan failed", "error", scanErr)
			finalStatus = ValidationStatusFailed
			finalMessage = fmt.Sprintf("Virus scan failed: %v", scanErr)
		} else if !scanResult.IsClean {
			// Virus detected - mark as dangerous
			finalStatus = ValidationStatusDangerous
			finalMessage = fmt.Sprintf("Virus detected: %s", scanResult.VirusName)
			slog.WarnContext(ctx, "virus detected in file",
				"virus_name", scanResult.VirusName,
				"storage_key", input.StorageKey)
		}
	}

	// Step 3: Update database with final validation result
	_, err = flows.Execute(ctx, wf, "update-validation-status/v1", w.steps.UpdateValidationStatus, &UpdateValidationStatusInput{
		OrganizationID:    input.OrganizationID,
		FileID:            input.FileID,
		ValidationStatus:  finalStatus,
		ValidationMessage: finalMessage,
		DetectedMimeType:  finalMimeType,
	}, w.steps.UpdateValidationStatusRetry)
	if err != nil {
		return nil, fmt.Errorf("update validation status failed: %w", err)
	}

	slog.InfoContext(ctx, "file validation completed",
		"file_id", input.FileID,
		"validation_status", finalStatus,
		"detected_mime", finalMimeType)

	return &FileValidationWorkflowOutput{
		ValidationStatus:  finalStatus,
		ValidationMessage: finalMessage,
		DetectedMimeType:  finalMimeType,
	}, nil
}

// NewFileValidationWorkflows creates workflows with injected steps.
// This workflow focuses ONLY on validation: magic byte detection + virus scanning.
func NewFileValidationWorkflows(steps *FileValidationSteps) *FileValidationWorkflows {
	return &FileValidationWorkflows{
		FileValidation: &fileValidationWorkflow{steps: steps},
	}
}
