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

// ExtractContentInput contains input for content extraction
type ExtractContentInput struct {
	OrganizationID dbuuid.UUID `json:"organization_id"`
	FileID         dbuuid.UUID `json:"file_id"`
	StorageKey     string      `json:"storage_key"`
	MimeType       string      `json:"mime_type"`
}

// ExtractContentOutput contains content extraction result
type ExtractContentOutput struct {
	Skipped          bool   `json:"skipped"`
	Reason           string `json:"reason,omitempty"`
	ExtractedText    string `json:"extracted_text,omitempty"`
	ExtractionMethod string `json:"extraction_method,omitempty"`
}

// FilePostProcessingServices holds dependencies for post-processing workflow
type FilePostProcessingServices struct {
	Queries         *database.Queries
	AdminPool       database.AdminDatabaseConnector
	R2Client        *R2Client
	PDFLogic        PDFLogic
	GotenbergClient *GotenbergClient
	// TODO: Add ContentExtractor when implemented
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
			// Check if content extraction is supported for this MIME type
			// Supported: text/plain, PDFs, office documents (DOCX, XLSX, PPTX)
			supportedTypes := map[string]string{
				"text/plain":      ExtractionMethodPlainText,
				"application/pdf": ExtractionMethodPDFParser,
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   ExtractionMethodOfficeParser,
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         ExtractionMethodOfficeParser,
				"application/vnd.openxmlformats-officedocument.presentationml.presentation": ExtractionMethodOfficeParser,
			}

			extractionMethod, supported := supportedTypes[input.MimeType]
			if !supported {
				slog.DebugContext(ctx, "content extraction not supported for MIME type",
					"mime_type", input.MimeType,
					"file_id", input.FileID)
				return &ExtractContentOutput{
					Skipped: true,
					Reason:  fmt.Sprintf("Content extraction not supported for %s", input.MimeType),
				}, nil
			}

			slog.InfoContext(ctx, "content extraction requested",
				"file_id", input.FileID,
				"mime_type", input.MimeType,
				"extraction_method", extractionMethod)

			// TODO: Implement actual content extraction
			// 1. Download file from R2
			// 2. Extract text based on MIME type:
			//    - text/plain: Read directly
			//    - PDF: Use PDF parser library
			//    - Office: Use office document parser
			// 3. Store extracted text in file_content_index table
			// 4. Update indexing status

			return &ExtractContentOutput{
				Skipped:       true,
				Reason:        "Content extraction pending implementation",
				ExtractedText: "",
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
	pdfConverted := false
	contentIndexed := false
	processingStatus := "completed"

	// Step 1: PDF Conversion (async, non-blocking)
	pdfResult, err := flows.Execute(ctx, wf, "convert-file-to-pdf/v1", w.steps.ConvertFileToPDF, &ConvertFileToPDFInput{
		OrganizationID: input.OrganizationID,
		FileID:         input.FileID,
		StorageKey:     input.StorageKey,
		MimeType:       input.MimeType,
	}, w.steps.ConvertFileToPDFRetry)
	if err != nil {
		slog.ErrorContext(ctx, "PDF conversion failed",
			"error", err,
			"file_id", input.FileID)
		processingStatus = "partial"
	} else if pdfResult != nil && !pdfResult.Skipped {
		pdfConverted = true
		slog.InfoContext(ctx, "PDF conversion completed",
			"file_id", input.FileID,
			"pdf_storage_key", pdfResult.PDFStorageKey)
	}

	// Step 2: Content Extraction (async, non-blocking)
	contentResult, err := flows.Execute(ctx, wf, "extract-file-content/v1", w.steps.ExtractContent, &ExtractContentInput{
		OrganizationID: input.OrganizationID,
		FileID:         input.FileID,
		StorageKey:     input.StorageKey,
		MimeType:       input.MimeType,
	}, w.steps.ExtractContentRetry)
	if err != nil {
		slog.ErrorContext(ctx, "content extraction failed",
			"error", err,
			"file_id", input.FileID)
		processingStatus = "partial"
	} else if contentResult != nil && !contentResult.Skipped {
		contentIndexed = true
		slog.InfoContext(ctx, "content extraction completed",
			"file_id", input.FileID,
			"extraction_method", contentResult.ExtractionMethod)
	}

	if !pdfConverted && !contentIndexed {
		processingStatus = "failed"
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
