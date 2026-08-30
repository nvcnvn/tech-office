package files

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

var (
	// ErrConversionNotFound is returned when PDF conversion record doesn't exist
	ErrConversionNotFound = errors.New("PDF conversion not found")
)

// PDFConversion represents PDF conversion metadata
type PDFConversion struct {
	ID                   dbuuid.UUID
	OrganizationID       dbuuid.UUID
	OriginalFileID       dbuuid.UUID
	PDFStorageKey        string
	PDFSizeBytes         int64
	ConversionStatus     string
	ConversionError      string
	ConversionDurationMs int32
}

// PDFLogic defines business logic for PDF conversion operations
// All methods are pool-agnostic and accept tx database.DBTX parameter
type PDFLogic interface {
	// GetPDFConversionStatus retrieves conversion status for a file
	GetPDFConversionStatus(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID) (*PDFConversion, error)

	// CreatePDFConversion creates a new PDF conversion record
	CreatePDFConversion(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID, pdfStorageKey string, pdfSize int64, status string) (*PDFConversion, error)

	// UpdateConversionStatus updates the conversion status and metadata
	UpdateConversionStatus(ctx context.Context, tx database.DBTX, orgID, conversionID dbuuid.UUID, status string, errorMsg string, durationMs int32, pdfSizeBytes int64) (*PDFConversion, error)

	// IsConvertible checks if a file type is eligible for PDF conversion
	IsConvertible(mimeType string) bool

	// GetPDFDownloadUrl generates a presigned URL for downloading the converted PDF
	GetPDFDownloadUrl(ctx context.Context, storageKey string) (string, error)
}

// pdfLogic implements PDFLogic interface
type pdfLogic struct {
	queries  *database.Queries
	r2Client *R2Client
}

// NewPDFLogic creates a new PDFLogic instance
func NewPDFLogic(queries *database.Queries, r2Client *R2Client) PDFLogic {
	return &pdfLogic{
		queries:  queries,
		r2Client: r2Client,
	}
}

// GetPDFConversionStatus retrieves conversion status for a file
func (l *pdfLogic) GetPDFConversionStatus(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID) (*PDFConversion, error) {
	slog.DebugContext(ctx, "PDFLogic.GetPDFConversionStatus",
		"organization_id", orgID,
		"file_id", fileID)

	conversion, err := l.queries.GetPDFConversion(ctx, tx, &database.GetPDFConversionParams{
		OrganizationID: orgID,
		OriginalFileID: fileID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.DebugContext(ctx, "PDF conversion not found",
				"file_id", fileID)
			return nil, ErrConversionNotFound
		}
		slog.ErrorContext(ctx, "failed to get PDF conversion",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("failed to get PDF conversion: %w", err)
	}

	result := &PDFConversion{
		ID:               conversion.ID,
		OrganizationID:   conversion.OrganizationID,
		OriginalFileID:   conversion.OriginalFileID,
		PDFStorageKey:    conversion.PdfStorageKey,
		PDFSizeBytes:     conversion.PdfSizeBytes,
		ConversionStatus: conversion.ConversionStatus,
	}

	// Handle nullable fields
	if conversion.ConversionError.Valid {
		result.ConversionError = conversion.ConversionError.String
	}
	if conversion.ConversionDurationMs.Valid {
		result.ConversionDurationMs = conversion.ConversionDurationMs.Int32
	}

	return result, nil
}

// CreatePDFConversion creates a new PDF conversion record
func (l *pdfLogic) CreatePDFConversion(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID, pdfStorageKey string, pdfSize int64, status string) (*PDFConversion, error) {
	if strings.TrimSpace(status) == "" {
		status = ConversionStatusPending
	}

	slog.DebugContext(ctx, "PDFLogic.CreatePDFConversion",
		"organization_id", orgID,
		"original_file_id", fileID,
		"pdf_storage_key", pdfStorageKey,
		"pdf_size_bytes", pdfSize,
		"status", status)

	conversion, err := l.queries.InsertPDFConversion(ctx, tx, &database.InsertPDFConversionParams{
		OrganizationID:   orgID,
		OriginalFileID:   fileID,
		PdfStorageKey:    pdfStorageKey,
		PdfSizeBytes:     pdfSize,
		ConversionStatus: status,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create PDF conversion",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("failed to create PDF conversion: %w", err)
	}

	slog.InfoContext(ctx, "PDF conversion record created",
		"conversion_id", conversion.ID,
		"file_id", fileID,
		"status", status)

	return &PDFConversion{
		ID:               conversion.ID,
		OrganizationID:   conversion.OrganizationID,
		OriginalFileID:   conversion.OriginalFileID,
		PDFStorageKey:    conversion.PdfStorageKey,
		PDFSizeBytes:     conversion.PdfSizeBytes,
		ConversionStatus: conversion.ConversionStatus,
	}, nil
}

// UpdateConversionStatus updates the conversion status and metadata
func (l *pdfLogic) UpdateConversionStatus(ctx context.Context, tx database.DBTX, orgID, conversionID dbuuid.UUID, status string, errorMsg string, durationMs int32, pdfSizeBytes int64) (*PDFConversion, error) {
	slog.DebugContext(ctx, "PDFLogic.UpdateConversionStatus",
		"organization_id", orgID,
		"conversion_id", conversionID,
		"status", status,
		"pdf_size_bytes", pdfSizeBytes,
		"duration_ms", durationMs)

	// Prepare nullable fields
	var conversionError pgtype.Text
	if errorMsg != "" {
		conversionError = pgtype.Text{String: errorMsg, Valid: true}
	}

	var conversionDuration pgtype.Int4
	if durationMs > 0 {
		conversionDuration = pgtype.Int4{Int32: durationMs, Valid: true}
	}

	var pdfSize pgtype.Int8
	if pdfSizeBytes > 0 {
		pdfSize = pgtype.Int8{Int64: pdfSizeBytes, Valid: true}
	}

	// Update conversion status
	err := l.queries.UpdatePDFConversionStatus(ctx, tx, &database.UpdatePDFConversionStatusParams{
		OrganizationID:       orgID,
		ID:                   conversionID,
		ConversionStatus:     status,
		PdfSizeBytes:         pdfSize,
		ConversionError:      conversionError,
		ConversionDurationMs: conversionDuration,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update PDF conversion status",
			"error", err,
			"conversion_id", conversionID)
		return nil, fmt.Errorf("failed to update conversion status: %w", err)
	}

	// Retrieve updated conversion
	conversion, err := l.queries.GetPDFConversionByID(ctx, tx, &database.GetPDFConversionByIDParams{
		OrganizationID: orgID,
		ID:             conversionID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get updated conversion",
			"error", err,
			"conversion_id", conversionID)
		return nil, fmt.Errorf("failed to get updated conversion: %w", err)
	}

	slog.InfoContext(ctx, "PDF conversion status updated",
		"conversion_id", conversionID,
		"status", status)

	result := &PDFConversion{
		ID:               conversion.ID,
		OrganizationID:   conversion.OrganizationID,
		OriginalFileID:   conversion.OriginalFileID,
		PDFStorageKey:    conversion.PdfStorageKey,
		PDFSizeBytes:     conversion.PdfSizeBytes,
		ConversionStatus: conversion.ConversionStatus,
	}

	if conversion.ConversionError.Valid {
		result.ConversionError = conversion.ConversionError.String
	}
	if conversion.ConversionDurationMs.Valid {
		result.ConversionDurationMs = conversion.ConversionDurationMs.Int32
	}

	return result, nil
}

// IsConvertible checks if a file type is eligible for PDF conversion
// Eligible types: Microsoft Office docs (.docx, .xlsx, .pptx), OpenDocument (.odt, .ods, .odp)
// Ineligible: PDFs (already PDF), images, videos, plain text
func (l *pdfLogic) IsConvertible(mimeType string) bool {
	// Normalize MIME type to lowercase
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))

	// Microsoft Office formats (Office Open XML)
	convertibleTypes := []string{
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",   // .docx
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         // .xlsx
		"application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx

		// Legacy Microsoft Office formats
		"application/msword",            // .doc
		"application/vnd.ms-excel",      // .xls
		"application/vnd.ms-powerpoint", // .ppt

		// OpenDocument formats
		"application/vnd.oasis.opendocument.text",         // .odt
		"application/vnd.oasis.opendocument.spreadsheet",  // .ods
		"application/vnd.oasis.opendocument.presentation", // .odp
	}

	for _, eligible := range convertibleTypes {
		if mimeType == eligible {
			slog.Debug("IsConvertible: file type is eligible for PDF conversion",
				"mime_type", mimeType)
			return true
		}
	}

	slog.Debug("IsConvertible: file type not eligible for PDF conversion",
		"mime_type", mimeType)
	return false
}

// GetPDFDownloadUrl generates a presigned URL for downloading the converted PDF
func (l *pdfLogic) GetPDFDownloadUrl(ctx context.Context, storageKey string) (string, error) {
	url, _, err := l.r2Client.GenerateDownloadURL(ctx, storageKey, 1*time.Hour)
	if err != nil {
		return "", err
	}
	return url, nil
}
