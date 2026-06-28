package files

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

var (
	// ErrContentIndexNotFound is returned when content index record doesn't exist
	ErrContentIndexNotFound = errors.New("content index not found")
)

// ContentIndex represents file content index metadata
type ContentIndex struct {
	ID                 dbuuid.UUID
	OrganizationID     dbuuid.UUID
	FileID             dbuuid.UUID
	ExtractedText      string
	ExtractionMethod   string
	IndexingStatus     string
	IndexingError      string
	IndexingDurationMs int32
}

// IndexLogic defines business logic for content indexing operations
// All methods are pool-agnostic and accept tx database.DBTX parameter
type IndexLogic interface {
	// GetContentIndexStatus retrieves indexing status for a file
	GetContentIndexStatus(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID) (*ContentIndex, error)

	// CreateContentIndex creates a new content index record
	CreateContentIndex(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID, extractedText, extractionMethod, status string) (*ContentIndex, error)

	// UpdateIndexStatus updates the indexing status and metadata
	UpdateIndexStatus(ctx context.Context, tx database.DBTX, orgID, indexID dbuuid.UUID, status string, errorMsg string, durationMs int32) (*ContentIndex, error)

	// IsIndexable checks if a file type is eligible for content indexing
	IsIndexable(mimeType string) bool
}

// indexLogic implements IndexLogic interface
type indexLogic struct {
	queries *database.Queries
}

// NewIndexLogic creates a new IndexLogic instance
func NewIndexLogic(queries *database.Queries) IndexLogic {
	return &indexLogic{
		queries: queries,
	}
}

// GetContentIndexStatus retrieves indexing status for a file
func (l *indexLogic) GetContentIndexStatus(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID) (*ContentIndex, error) {
	slog.DebugContext(ctx, "IndexLogic.GetContentIndexStatus",
		"organization_id", orgID,
		"file_id", fileID)

	index, err := l.queries.GetFileContentIndex(ctx, tx, &database.GetFileContentIndexParams{
		OrganizationID: orgID,
		FileID:         fileID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.DebugContext(ctx, "content index not found",
				"file_id", fileID)
			return nil, ErrContentIndexNotFound
		}
		slog.ErrorContext(ctx, "failed to get content index",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("failed to get content index: %w", err)
	}

	result := &ContentIndex{
		ID:               index.ID,
		OrganizationID:   index.OrganizationID,
		FileID:           index.FileID,
		ExtractedText:    index.ExtractedText,
		ExtractionMethod: index.ExtractionMethod,
		IndexingStatus:   index.IndexingStatus,
	}

	// Handle nullable fields
	if index.IndexingError.Valid {
		result.IndexingError = index.IndexingError.String
	}
	if index.IndexingDurationMs.Valid {
		result.IndexingDurationMs = index.IndexingDurationMs.Int32
	}

	return result, nil
}

// CreateContentIndex creates a new content index record
func (l *indexLogic) CreateContentIndex(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID, extractedText, extractionMethod, status string) (*ContentIndex, error) {
	slog.DebugContext(ctx, "IndexLogic.CreateContentIndex",
		"organization_id", orgID,
		"file_id", fileID,
		"extraction_method", extractionMethod,
		"status", status,
		"text_length", len(extractedText))

	index, err := l.queries.InsertFileContentIndex(ctx, tx, &database.InsertFileContentIndexParams{
		OrganizationID:   orgID,
		FileID:           fileID,
		ExtractedText:    extractedText,
		ExtractionMethod: extractionMethod,
		IndexingStatus:   status,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create content index",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("failed to create content index: %w", err)
	}

	slog.InfoContext(ctx, "content index record created",
		"index_id", index.ID,
		"file_id", fileID,
		"status", status)

	return &ContentIndex{
		ID:               index.ID,
		OrganizationID:   index.OrganizationID,
		FileID:           index.FileID,
		ExtractedText:    index.ExtractedText,
		ExtractionMethod: index.ExtractionMethod,
		IndexingStatus:   index.IndexingStatus,
	}, nil
}

// UpdateIndexStatus updates the indexing status and metadata
func (l *indexLogic) UpdateIndexStatus(ctx context.Context, tx database.DBTX, orgID, indexID dbuuid.UUID, status string, errorMsg string, durationMs int32) (*ContentIndex, error) {
	slog.DebugContext(ctx, "IndexLogic.UpdateIndexStatus",
		"organization_id", orgID,
		"index_id", indexID,
		"status", status,
		"duration_ms", durationMs)

	// Prepare nullable fields
	var indexingError pgtype.Text
	if errorMsg != "" {
		indexingError = pgtype.Text{String: errorMsg, Valid: true}
	}

	var indexingDuration pgtype.Int4
	if durationMs > 0 {
		indexingDuration = pgtype.Int4{Int32: durationMs, Valid: true}
	}

	// Update indexing status
	err := l.queries.UpdateContentIndexStatus(ctx, tx, &database.UpdateContentIndexStatusParams{
		OrganizationID:     orgID,
		ID:                 indexID,
		IndexingStatus:     status,
		IndexingError:      indexingError,
		IndexingDurationMs: indexingDuration,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update indexing status",
			"error", err,
			"index_id", indexID)
		return nil, fmt.Errorf("failed to update indexing status: %w", err)
	}

	// Retrieve updated index
	index, err := l.queries.GetFileContentIndexByID(ctx, tx, &database.GetFileContentIndexByIDParams{
		OrganizationID: orgID,
		ID:             indexID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get updated content index",
			"error", err,
			"index_id", indexID)
		return nil, fmt.Errorf("failed to get updated content index: %w", err)
	}

	slog.InfoContext(ctx, "content index status updated",
		"index_id", indexID,
		"status", status)

	result := &ContentIndex{
		ID:               index.ID,
		OrganizationID:   index.OrganizationID,
		FileID:           index.FileID,
		ExtractedText:    index.ExtractedText,
		ExtractionMethod: index.ExtractionMethod,
		IndexingStatus:   index.IndexingStatus,
	}

	if index.IndexingError.Valid {
		result.IndexingError = index.IndexingError.String
	}
	if index.IndexingDurationMs.Valid {
		result.IndexingDurationMs = index.IndexingDurationMs.Int32
	}

	return result, nil
}

// IsIndexable checks if a file type is eligible for content indexing
// Eligible types: office docs, PDFs, plain text
// Ineligible: images, videos, audio, archives
func (l *indexLogic) IsIndexable(mimeType string) bool {
	// Normalize MIME type to lowercase
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))

	// Indexable document types
	indexableTypes := []string{
		// Plain text
		"text/plain",
		"text/markdown",
		"text/csv",
		"text/html",
		"text/xml",
		"application/json",
		"application/xml",

		// PDF
		"application/pdf",

		// Microsoft Office (Office Open XML)
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",   // .docx
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",         // .xlsx
		"application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx

		// Legacy Microsoft Office
		"application/msword",            // .doc
		"application/vnd.ms-excel",      // .xls
		"application/vnd.ms-powerpoint", // .ppt

		// OpenDocument
		"application/vnd.oasis.opendocument.text",         // .odt
		"application/vnd.oasis.opendocument.spreadsheet",  // .ods
		"application/vnd.oasis.opendocument.presentation", // .odp
	}

	for _, eligible := range indexableTypes {
		if mimeType == eligible {
			slog.Debug("IsIndexable: file type is eligible for content indexing",
				"mime_type", mimeType)
			return true
		}
	}

	slog.Debug("IsIndexable: file type not eligible for content indexing",
		"mime_type", mimeType)
	return false
}
