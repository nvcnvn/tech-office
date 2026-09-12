package files

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"path/filepath"
	"strings"
	"time"

	"github.com/nvcnvn/flows"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// FilePostProcessingWorkflowInput contains input for post-processing workflow
type FilePostProcessingWorkflowInput struct {
	OrganizationID dbuuid.UUID `json:"organization_id"`
	FileID         dbuuid.UUID `json:"file_id"`
	StorageKey     string      `json:"storage_key"`
	MimeType       string      `json:"mime_type"`
}

// FilePostProcessingWorkflowOutput contains post-processing result
type FilePostProcessingWorkflowOutput struct {
	PDFConverted     bool   `json:"pdf_converted"`
	ContentIndexed   bool   `json:"content_indexed"`
	ProcessingStatus string `json:"processing_status"` // completed, partial, failed
}

// ConvertFileToPDFInput contains input for PDF conversion
type ConvertFileToPDFInput struct {
	OrganizationID dbuuid.UUID `json:"organization_id"`
	FileID         dbuuid.UUID `json:"file_id"`
	StorageKey     string      `json:"storage_key"`
	MimeType       string      `json:"mime_type"`
}

// ConvertFileToPDFOutput contains PDF conversion result
type ConvertFileToPDFOutput struct {
	Skipped       bool   `json:"skipped"`
	Reason        string `json:"reason,omitempty"`
	PDFStorageKey string `json:"pdf_storage_key,omitempty"`
}

// ExtractContentInput contains input for content extraction.
//
// PDFStorageKey carries step 1's output into step 2 so an office document is read from
// the PDF the workflow has already produced, rather than looked up again. MimeType is
// what the client declared at upload; the step re-reads the detected type and prefers it.
type ExtractContentInput struct {
	OrganizationID dbuuid.UUID `json:"organization_id"`
	FileID         dbuuid.UUID `json:"file_id"`
	StorageKey     string      `json:"storage_key"`
	MimeType       string      `json:"mime_type"`
	PDFStorageKey  string      `json:"pdf_storage_key,omitempty"`
}

// ExtractContentOutput contains content extraction result
type ExtractContentOutput struct {
	Skipped          bool   `json:"skipped"`
	Failed           bool   `json:"failed,omitempty"`
	Reason           string `json:"reason,omitempty"`
	TextLength       int    `json:"text_length,omitempty"`
	Truncated        bool   `json:"truncated,omitempty"`
	ExtractionMethod string `json:"extraction_method,omitempty"`
}

// FilePostProcessingServices holds dependencies for post-processing workflow
type FilePostProcessingServices struct {
	Queries         *database.Queries
	AdminPool       database.AdminDatabaseConnector
	R2Client        *R2Client
	PDFLogic        PDFLogic
	GotenbergClient *GotenbergClient
	IndexLogic      IndexLogic
}

func filenameForMimeType(mimeType string) string {
	mt := strings.ToLower(strings.TrimSpace(mimeType))
	switch mt {
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return "document.docx"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return "document.xlsx"
	case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return "document.pptx"
	case "application/msword":
		return "document.doc"
	case "application/vnd.ms-excel":
		return "document.xls"
	case "application/vnd.ms-powerpoint":
		return "document.ppt"
	case "application/vnd.oasis.opendocument.text":
		return "document.odt"
	case "application/vnd.oasis.opendocument.spreadsheet":
		return "document.ods"
	case "application/vnd.oasis.opendocument.presentation":
		return "document.odp"
	default:
		return "document"
	}
}

func postProcessRetryPolicy() flows.RetryPolicy {
	return flows.RetryPolicy{
		MaxRetries: 2,
		Backoff: func(attempt int) int {
			if attempt < 0 {
				attempt = 0
			}
			d := time.Duration(float64(2*time.Second) * math.Pow(2.0, float64(attempt)))
			if d > 30*time.Second {
				d = 30 * time.Second
			}
			return int(d.Milliseconds())
		},
	}
}

// FilePostProcessingSteps holds step functions for post-processing.
type FilePostProcessingSteps struct {
	ConvertFileToPDF flows.Step[ConvertFileToPDFInput, ConvertFileToPDFOutput]
	ExtractContent   flows.Step[ExtractContentInput, ExtractContentOutput]

	ConvertFileToPDFRetry flows.RetryPolicy
	ExtractContentRetry   flows.RetryPolicy
}

// NewFilePostProcessingSteps creates post-processing steps.
func NewFilePostProcessingSteps(svc *FilePostProcessingServices) *FilePostProcessingSteps {
	retry := postProcessRetryPolicy()

	return &FilePostProcessingSteps{
		ConvertFileToPDF: func(ctx context.Context, input *ConvertFileToPDFInput) (*ConvertFileToPDFOutput, error) {
			if svc.GotenbergClient == nil {
				return nil, fmt.Errorf("gotenberg client not configured")
			}
			if svc.AdminPool == nil {
				return nil, fmt.Errorf("admin pool not configured")
			}
			if svc.PDFLogic == nil {
				return nil, fmt.Errorf("pdf logic not configured")
			}
			if svc.R2Client == nil {
				return nil, fmt.Errorf("r2 client not configured")
			}

			// 1. Check if file type is convertible
			if !svc.PDFLogic.IsConvertible(input.MimeType) {
				slog.DebugContext(ctx, "file type not convertible to PDF",
					"mime_type", input.MimeType,
					"file_id", input.FileID)
				return &ConvertFileToPDFOutput{
					Skipped: true,
					Reason:  fmt.Sprintf("File type %s not convertible to PDF", input.MimeType),
				}, nil
			}

			pdfStorageKey := fmt.Sprintf("org-%s/conversions/%s.pdf", input.OrganizationID.String(), input.FileID.String())

			// 2. Ensure conversion record exists.
			conversion, err := svc.PDFLogic.GetPDFConversionStatus(ctx, svc.AdminPool, input.OrganizationID, input.FileID)
			if err != nil {
				if err != ErrConversionNotFound {
					return nil, err
				}
				conversion, err = svc.PDFLogic.CreatePDFConversion(ctx, svc.AdminPool, input.OrganizationID, input.FileID, pdfStorageKey, 0, ConversionStatusPending)
				if err != nil {
					return nil, err
				}
			}

			if conversion.ConversionStatus == ConversionStatusCompleted {
				return &ConvertFileToPDFOutput{
					Skipped:       false,
					Reason:        "already converted",
					PDFStorageKey: conversion.PDFStorageKey,
				}, nil
			}

			start := time.Now()
			_, _ = svc.PDFLogic.UpdateConversionStatus(ctx, svc.AdminPool, input.OrganizationID, conversion.ID, ConversionStatusInProgress, "", 0, 0)

			slog.InfoContext(ctx, "PDF conversion requested",
				"file_id", input.FileID,
				"storage_key", input.StorageKey,
				"pdf_storage_key", pdfStorageKey)

			// 3. Download file from R2 (stream)
			src, err := svc.R2Client.GetReader(ctx, input.StorageKey)
			if err != nil {
				durationMs := int32(time.Since(start).Milliseconds())
				_, _ = svc.PDFLogic.UpdateConversionStatus(ctx, svc.AdminPool, input.OrganizationID, conversion.ID, ConversionStatusFailed, err.Error(), durationMs, 0)
				return nil, fmt.Errorf("failed to get source from R2: %w", err)
			}
			defer src.Close()

			filename := filenameForMimeType(input.MimeType)
			if ext := filepath.Ext(filename); ext == "" {
				// Fallback: try to preserve a hint from the original storage key.
				if kext := filepath.Ext(input.StorageKey); kext != "" {
					filename = filename + kext
				}
			}

			// 4. Convert via Gotenberg
			pdfBody, _, err := svc.GotenbergClient.ConvertLibreOfficeToPDF(ctx, filename, src)
			if err != nil {
				durationMs := int32(time.Since(start).Milliseconds())
				_, _ = svc.PDFLogic.UpdateConversionStatus(ctx, svc.AdminPool, input.OrganizationID, conversion.ID, ConversionStatusFailed, err.Error(), durationMs, 0)
				return nil, err
			}
			defer pdfBody.Close()

			// 5. Upload converted PDF to R2
			pdfSize, err := svc.R2Client.PutObject(ctx, pdfStorageKey, "application/pdf", pdfBody)
			if err != nil {
				durationMs := int32(time.Since(start).Milliseconds())
				_, _ = svc.PDFLogic.UpdateConversionStatus(ctx, svc.AdminPool, input.OrganizationID, conversion.ID, ConversionStatusFailed, err.Error(), durationMs, 0)
				return nil, fmt.Errorf("failed to upload PDF to R2: %w", err)
			}

			durationMs := int32(time.Since(start).Milliseconds())
			_, err = svc.PDFLogic.UpdateConversionStatus(ctx, svc.AdminPool, input.OrganizationID, conversion.ID, ConversionStatusCompleted, "", durationMs, pdfSize)
			if err != nil {
				return nil, err
			}

			// 6. Increment quota usage for converted PDF
			err = svc.Queries.IncrementQuotaUsage(ctx, svc.AdminPool, &database.IncrementQuotaUsageParams{
				OrganizationID:    input.OrganizationID,
				CurrentUsageBytes: pdfSize,
			})
			if err != nil {
				slog.ErrorContext(ctx, "failed to increment quota for PDF conversion",
					"error", err,
					"file_id", input.FileID,
					"pdf_size", pdfSize)
				// Don't fail the conversion, just log the error
			} else {
				slog.InfoContext(ctx, "incremented quota for converted PDF",
					"file_id", input.FileID,
					"pdf_size_bytes", pdfSize)
			}

			return &ConvertFileToPDFOutput{
				Skipped:       false,
				Reason:        "converted",
				PDFStorageKey: pdfStorageKey,
			}, nil
		},

		ExtractContent: func(ctx context.Context, input *ExtractContentInput) (*ExtractContentOutput, error) {
			if svc.AdminPool == nil || svc.Queries == nil || svc.R2Client == nil || svc.IndexLogic == nil {
				return nil, fmt.Errorf("content extraction dependencies not configured")
			}

			file, err := svc.Queries.GetFileByID(ctx, svc.AdminPool, &database.GetFileByIDParams{
				OrganizationID: input.OrganizationID,
				ID:             input.FileID,
			})
			if err != nil {
				return nil, fmt.Errorf("load file metadata: %w", err)
			}

			// FR-006: the client's claim about a file's type does not decide how it is read.
			// Detection runs in a concurrent workflow, so wait for it to settle rather than
			// racing it; on timeout fall back to the declared type, which is still better
			// than failing a file because a scanner was slow.
			file = awaitDetectedType(ctx, svc, file)
			mimeType := file.MimeType
			if file.DetectedMimeType.Valid && file.DetectedMimeType.String != "" {
				mimeType = file.DetectedMimeType.String
			}

			method := svc.IndexLogic.ExtractionMethodFor(mimeType)
			if method == "" {
				// Not a type whose text we read. This is the designed outcome for every
				// image, video and archive in the system — debug, not error (SC-007).
				//
				// Any pending row written from a wrong declared type is deleted, so the
				// status derives to "not content-indexed" rather than sitting at "queued"
				// for a file nothing will ever pick up.
				if delErr := svc.Queries.DeleteFileContentIndex(ctx, svc.AdminPool, &database.DeleteFileContentIndexParams{
					OrganizationID: input.OrganizationID,
					FileID:         input.FileID,
				}); delErr != nil {
					return nil, fmt.Errorf("clear stale content index: %w", delErr)
				}
				slog.DebugContext(ctx, "content extraction skipped",
					"file_id", input.FileID,
					"mime_type", mimeType)
				return &ExtractContentOutput{
					Skipped: true,
					Reason:  fmt.Sprintf("%s is not a content-indexed file type", mimeType),
				}, nil
			}

			slog.InfoContext(ctx, "content extraction started",
				"file_id", input.FileID,
				"mime_type", mimeType,
				"extraction_method", method)

			if _, err := svc.IndexLogic.UpsertContentIndex(ctx, svc.AdminPool, input.OrganizationID, input.FileID,
				"", method, IndexingStatusInProgress, "", 0); err != nil {
				return nil, fmt.Errorf("mark indexing in progress: %w", err)
			}

			start := time.Now()
			extractCtx, cancel := context.WithTimeout(ctx, ExtractionTimeout)
			text, err := extractText(extractCtx, svc, method, input)
			cancel()
			durationMs := int32(time.Since(start).Milliseconds())

			if err != nil {
				// The full error goes to the log, where an operator can read it. Only the
				// short mapped reason is stored, where a tenant can (FR-018).
				reason := callerSafeReason(err)
				slog.ErrorContext(ctx, "content extraction failed",
					"error", err,
					"file_id", input.FileID,
					"mime_type", mimeType,
					"extraction_method", method,
					"stored_reason", reason)
				if _, upErr := svc.IndexLogic.UpsertContentIndex(ctx, svc.AdminPool, input.OrganizationID, input.FileID,
					"", method, IndexingStatusFailed, reason, durationMs); upErr != nil {
					return nil, fmt.Errorf("record extraction failure: %w", upErr)
				}
				// Recorded, not returned as an error: a failed extraction is a terminal
				// outcome the status RPC reports, not a reason to retry the whole workflow
				// and overwrite the reason with the same one.
				return &ExtractContentOutput{
					Failed:           true,
					Reason:           reason,
					ExtractionMethod: method,
				}, nil
			}

			text = collapseWhitespace(text)
			text, truncated := truncateToBytes(text, MaxExtractedTextBytes)

			// An empty result is a legitimate completion, not a failure: an empty document,
			// a blank page, or a scan with no selectable text. Success also writes an empty
			// reason, which clears any reason a previous failed attempt left behind.
			if _, err := svc.IndexLogic.UpsertContentIndex(ctx, svc.AdminPool, input.OrganizationID, input.FileID,
				text, method, IndexingStatusCompleted, "", durationMs); err != nil {
				return nil, fmt.Errorf("store extracted text: %w", err)
			}

			slog.InfoContext(ctx, "content extraction completed",
				"file_id", input.FileID,
				"extraction_method", method,
				"text_length", len(text),
				"truncated", truncated,
				"duration_ms", durationMs)

			return &ExtractContentOutput{
				TextLength:       len(text),
				Truncated:        truncated,
				ExtractionMethod: method,
			}, nil
		},

		ConvertFileToPDFRetry: retry,
		ExtractContentRetry:   retry,
	}
}

// FilePostProcessingWorkflows holds post-processing workflows
type FilePostProcessingWorkflows struct {
	FilePostProcessing flows.Workflow[FilePostProcessingWorkflowInput, FilePostProcessingWorkflowOutput]
}

type filePostProcessingWorkflow struct {
	steps *FilePostProcessingSteps
}

func (w *filePostProcessingWorkflow) Name() string {
	// Keeping existing workflow name for compatibility with current wiring.
	return WorkflowNamePDFConversion
}

func (w *filePostProcessingWorkflow) Run(ctx context.Context, wf *flows.Context, input *FilePostProcessingWorkflowInput) (*FilePostProcessingWorkflowOutput, error) {
	// Each step lands in exactly one bucket. "Skipped" is not a bad outcome: a JPEG is
	// neither convertible to PDF nor content-indexed, and a job that reports that as a
	// failure is crying wolf on every image upload in the system (FR-019, SC-007).
	okCount, failedCount := 0, 0
	record := func(failed bool) {
		if failed {
			failedCount++
		} else {
			okCount++
		}
	}

	// Step 1: PDF Conversion (async, non-blocking)
	pdfConverted := false
	pdfStorageKey := ""
	pdfResult, err := flows.Execute(ctx, wf, "convert-file-to-pdf/v1", w.steps.ConvertFileToPDF, &ConvertFileToPDFInput{
		OrganizationID: input.OrganizationID,
		FileID:         input.FileID,
		StorageKey:     input.StorageKey,
		MimeType:       input.MimeType,
	}, w.steps.ConvertFileToPDFRetry)
	switch {
	case err != nil:
		slog.ErrorContext(ctx, "PDF conversion failed",
			"error", err,
			"file_id", input.FileID)
		record(true)
	case pdfResult == nil || pdfResult.Skipped:
		record(false)
	default:
		pdfConverted = true
		pdfStorageKey = pdfResult.PDFStorageKey
		record(false)
		slog.InfoContext(ctx, "PDF conversion completed",
			"file_id", input.FileID,
			"pdf_storage_key", pdfResult.PDFStorageKey)
	}

	// Step 2: Content Extraction. It receives step 1's converted PDF directly, which is
	// how an office document gets read without a second conversion or a second lookup.
	contentIndexed := false
	contentResult, err := flows.Execute(ctx, wf, "extract-file-content/v1", w.steps.ExtractContent, &ExtractContentInput{
		OrganizationID: input.OrganizationID,
		FileID:         input.FileID,
		StorageKey:     input.StorageKey,
		MimeType:       input.MimeType,
		PDFStorageKey:  pdfStorageKey,
	}, w.steps.ExtractContentRetry)
	switch {
	case err != nil:
		slog.ErrorContext(ctx, "content extraction step failed",
			"error", err,
			"file_id", input.FileID)
		record(true)
	case contentResult == nil:
		record(true)
	case contentResult.Failed:
		// Recorded against the file and reported by the status RPC; the job is partial,
		// not silently fine.
		record(true)
	case contentResult.Skipped:
		record(false)
	default:
		contentIndexed = true
		record(false)
	}

	processingStatus := "completed"
	switch {
	case failedCount > 0 && okCount == 0:
		processingStatus = "failed"
	case failedCount > 0:
		processingStatus = "partial"
	}

	return &FilePostProcessingWorkflowOutput{
		PDFConverted:     pdfConverted,
		ContentIndexed:   contentIndexed,
		ProcessingStatus: processingStatus,
	}, nil
}

// NewFilePostProcessingWorkflows creates post-processing workflows.
func NewFilePostProcessingWorkflows(steps *FilePostProcessingSteps) *FilePostProcessingWorkflows {
	return &FilePostProcessingWorkflows{
		FilePostProcessing: &filePostProcessingWorkflow{steps: steps},
	}
}
