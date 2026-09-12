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
	UpdatedAt          time.Time
}

// IndexLogic defines business logic for content indexing operations
// All methods are pool-agnostic and accept tx database.DBTX parameter
type IndexLogic interface {
	// GetContentIndexStatus retrieves indexing status for a file
	GetContentIndexStatus(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID) (*ContentIndex, error)

	// UpsertContentIndex writes the current state of a file's content index. One row
	// per file: a retry replaces the stored result rather than adding a second one, and
	// an empty errorMsg on success clears a previous failure's reason.
	UpsertContentIndex(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID, extractedText, extractionMethod, status, errorMsg string, durationMs int32) (*ContentIndex, error)

	// IsIndexable checks if a file type is eligible for content indexing
	IsIndexable(mimeType string) bool

	// ExtractionMethodFor names how a file type's text is read, or "" when the type is
	// not content-indexed. It is the same table IsIndexable answers from.
	ExtractionMethodFor(mimeType string) string
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
		UpdatedAt:        index.UpdatedAt.Time,
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

// UpsertContentIndex writes the current state of a file's content index.
func (l *indexLogic) UpsertContentIndex(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID, extractedText, extractionMethod, status, errorMsg string, durationMs int32) (*ContentIndex, error) {
	slog.DebugContext(ctx, "IndexLogic.UpsertContentIndex",
		"organization_id", orgID,
		"file_id", fileID,
		"extraction_method", extractionMethod,
		"status", status,
		"text_length", len(extractedText))

	// An empty reason writes NULL, which is how a later success clears a previous
	// failure's reason: the upsert passes this through EXCLUDED, never COALESCE.
	var indexingError pgtype.Text
	if errorMsg != "" {
		indexingError = pgtype.Text{String: errorMsg, Valid: true}
	}

	var indexingDuration pgtype.Int4
	if durationMs > 0 {
		indexingDuration = pgtype.Int4{Int32: durationMs, Valid: true}
	}

	index, err := l.queries.UpsertFileContentIndex(ctx, tx, &database.UpsertFileContentIndexParams{
		OrganizationID:     orgID,
		FileID:             fileID,
		ExtractedText:      extractedText,
		ExtractionMethod:   extractionMethod,
		IndexingStatus:     status,
		IndexingError:      indexingError,
		IndexingDurationMs: indexingDuration,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to upsert content index",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("failed to upsert content index: %w", err)
	}

	result := &ContentIndex{
		ID:               index.ID,
		OrganizationID:   index.OrganizationID,
		FileID:           index.FileID,
		ExtractedText:    index.ExtractedText,
		ExtractionMethod: index.ExtractionMethod,
		IndexingStatus:   index.IndexingStatus,
		UpdatedAt:        index.UpdatedAt.Time,
	}
	if index.IndexingError.Valid {
		result.IndexingError = index.IndexingError.String
	}
	if index.IndexingDurationMs.Valid {
		result.IndexingDurationMs = index.IndexingDurationMs.Int32
	}

	return result, nil
}

// indexableTypes maps every content-indexed MIME type to the method used to read it.
// Absence from this table is what "not content-indexed" means: images, video, audio and
// archives are not here, and neither is anything the system cannot turn into text.
//
// Office types are read via the PDF that Gotenberg produced in step 1 of the same
// post-processing workflow — office_parser names the file that was read, not the route.
var indexableTypes = map[string]string{
	// Plain text
	"text/plain":       ExtractionMethodPlainText,
	"text/markdown":    ExtractionMethodPlainText,
	"text/csv":         ExtractionMethodPlainText,
	"text/html":        ExtractionMethodPlainText,
	"text/xml":         ExtractionMethodPlainText,
	"application/json": ExtractionMethodPlainText,
	"application/xml":  ExtractionMethodPlainText,

	// PDF
	"application/pdf": ExtractionMethodPDFParser,

	// Microsoft Office (Office Open XML)
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   ExtractionMethodOfficeParser, // .docx
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         ExtractionMethodOfficeParser, // .xlsx
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": ExtractionMethodOfficeParser, // .pptx

	// Legacy Microsoft Office
	"application/msword":            ExtractionMethodOfficeParser, // .doc
	"application/vnd.ms-excel":      ExtractionMethodOfficeParser, // .xls
	"application/vnd.ms-powerpoint": ExtractionMethodOfficeParser, // .ppt

	// OpenDocument
	"application/vnd.oasis.opendocument.text":         ExtractionMethodOfficeParser, // .odt
	"application/vnd.oasis.opendocument.spreadsheet":  ExtractionMethodOfficeParser, // .ods
	"application/vnd.oasis.opendocument.presentation": ExtractionMethodOfficeParser, // .odp
}

// ExtractionMethodFor names how a file type's text is read, or "" when it is not read.
func (l *indexLogic) ExtractionMethodFor(mimeType string) string {
	return indexableTypes[strings.ToLower(strings.TrimSpace(mimeType))]
}

// IsIndexable checks if a file type is eligible for content indexing.
// Eligible: office documents, PDFs, plain text. Ineligible: images, video, audio,
// archives — anything absent from indexableTypes.
func (l *indexLogic) IsIndexable(mimeType string) bool {
	return l.ExtractionMethodFor(mimeType) != ""
}
