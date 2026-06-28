package files

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

var (
	// ErrQuotaExceeded is returned when upload would exceed organization quota
	ErrQuotaExceeded = errors.New("storage quota exceeded")

	// ErrFileTooLarge is returned when file exceeds max size limit
	ErrFileTooLarge = errors.New("file size exceeds maximum allowed")

	// ErrInvalidMimeType is returned when MIME type is invalid
	ErrInvalidMimeType = errors.New("invalid MIME type")

	// ErrFileNotFound is returned when file doesn't exist
	ErrFileNotFound = errors.New("file not found")
)

// FileLogic implements business logic for file storage operations
// All methods are pool-agnostic and accept tx database.DBTX parameter
type FileLogic interface {
	// RequestUpload validates upload request and generates presigned URL
	RequestUpload(ctx context.Context, tx database.DBTX, params RequestUploadParams) (*UploadURLResult, error)

	// ConfirmUpload confirms upload completion and triggers validation workflow
	ConfirmUpload(ctx context.Context, tx database.DBTX, params ConfirmUploadParams) (*FileMetadata, error)

	// RecordDeletion soft-deletes file, creates audit log, and decrements quota
	RecordDeletion(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, fileID dbuuid.UUID, employeeID dbuuid.UUID, reason string) (int64, error)

	// DeleteFile soft-deletes file and removes from R2 asynchronously
	DeleteFile(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, fileID dbuuid.UUID, employeeID dbuuid.UUID, reason string) (int64, error)

	// BatchDeleteFiles deletes multiple files and removes from R2 asynchronously
	BatchDeleteFiles(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeID dbuuid.UUID, fileIDs []string, reason string) (*BatchDeleteResult, error)

	// ValidateFile performs file type validation using magic byte detection
	ValidateFile(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeID dbuuid.UUID, fileID dbuuid.UUID) (*rpcv1.FileValidationResult, error) // Depending on rpcv1? Better to return domain struct

	// GetDownloadUrl generates presigned download URL with access check
	GetDownloadUrl(ctx context.Context, tx database.DBTX, params GetDownloadUrlParams) (*GetDownloadUrlResult, error)

	// GetFileMetadata retrieves file metadata with access check
	GetFileMetadata(ctx context.Context, tx database.DBTX, params GetFileMetadataParams) (*GetFileMetadataResult, error)

	// GetFileMetadataBatch retrieves multiple file metadata with access check
	GetFileMetadataBatch(ctx context.Context, tx database.DBTX, params GetFileMetadataBatchParams) (*GetFileMetadataBatchResult, error)

	// ListFiles returns paginated list of files based on context
	ListFiles(ctx context.Context, tx database.DBTX, params ListFilesParams) ([]*database.FilesFileMetadatum, int64, error)

	// CreateAccessRule creates file access rule linking file to its context
	CreateAccessRule(ctx context.Context, tx database.DBTX, params CreateAccessRuleParams) error
}

// RequestUploadParams contains parameters for RequestUpload
type RequestUploadParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	Filename       string
	SizeBytes      int64
	MimeType       string
	UploadContext  string
}

// GetDownloadUrlParams contains parameters for GetDownloadUrl
type GetDownloadUrlParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	FileID         dbuuid.UUID
}

// GetDownloadUrlResult contains result for GetDownloadUrl
type GetDownloadUrlResult struct {
	DownloadUrl  string
	ExpiresAt    time.Time
	IsDeleted    bool
	DeletionInfo *FileDeletionInfo
}

// FileDeletionInfo contains info about file deletion
type FileDeletionInfo struct {
	DeletedAt             time.Time
	DeletedByEmployeeID   dbuuid.UUID
	DeletedByEmployeeName string
	DeletionReason        string
}

// PDFConversionInfo contains info about PDF conversion for office documents
// Note: PDFDownloadURL and PDFExpiresAt are ONLY set in GetPDFConversionStatus (with access check)
// NOT set in GetFileMetadata/GetFileMetadataBatch to prevent presigned URL exposure
type PDFConversionInfo struct {
	Status         string    // "pending", "in_progress", "completed", "failed"
	PDFDownloadURL string    // Presigned URL for converted PDF (ONLY in GetPDFConversionStatus)
	PDFExpiresAt   time.Time // Expiration time for presigned URL (ONLY in GetPDFConversionStatus)
	Error          string    // Error message if failed
	DurationMs     int       // Conversion duration in milliseconds
	PDFStorageKey  string    // R2 storage key for converted PDF (internal use)
}

// GetFileMetadataParams contains parameters for GetFileMetadata
type GetFileMetadataParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	FileID         dbuuid.UUID
}

// GetFileMetadataResult contains result for GetFileMetadata
type GetFileMetadataResult struct {
	File         *FileMetadata
	IsDeleted    bool
	DeletionInfo *FileDeletionInfo
}

// GetFileMetadataBatchParams contains parameters for GetFileMetadataBatch
type GetFileMetadataBatchParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	FileIDs        []dbuuid.UUID
}

// GetFileMetadataBatchResult contains result for GetFileMetadataBatch
type GetFileMetadataBatchResult struct {
	Files        []*FileMetadata
	DeletionInfo map[string]*FileDeletionInfo
}

// ListFilesParams contains parameters for ListFiles
type ListFilesParams struct {
	OrganizationID dbuuid.UUID
	UploadContext  string
	SortBy         string // "updated_at", "size_bytes", "original_filename"
	SortOrder      string // "asc", "desc"
	Limit          int32
	Offset         int32
}

// RecordUploadParams contains parameters for RecordUpload
type RecordUploadParams struct {
	FileID               dbuuid.UUID
	OrganizationID       dbuuid.UUID
	OriginalFilename     string
	StorageKey           string
	SizeBytes            int64
	MimeType             string
	UploadContext        string
	UploadedByEmployeeID dbuuid.UUID
}

// GenerateUploadURLParams contains parameters for generating a file upload URL (Feature 015)
type GenerateUploadURLParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	Filename       string
	MimeType       string
	SizeBytes      int64
	UploadContext  string // "chat", "avatar", "docs", "project"
}

// UploadURLResult contains the generated upload URL and metadata (Feature 015)
type UploadURLResult struct {
	FileID     dbuuid.UUID
	UploadURL  string
	ExpiresAt  time.Time
	StorageKey string
}

// ConfirmUploadParams contains parameters for confirming a file upload (Feature 015)
type ConfirmUploadParams struct {
	OrganizationID dbuuid.UUID
	EmployeeID     dbuuid.UUID
	FileID         dbuuid.UUID
}

// FileMetadata represents file metadata after upload confirmation (Feature 015)
type FileMetadata struct {
	ID                dbuuid.UUID
	OrganizationID    dbuuid.UUID
	Filename          string
	StorageKey        string
	SizeBytes         int64
	MimeType          string
	UploadContext     string
	UploadedBy        dbuuid.UUID
	ValidationStatus  string
	UpdatedAt         time.Time
	PDFConversionInfo *PDFConversionInfo // Optional: PDF conversion status for office docs
}

// BatchDeleteResult contains results of batch deletion
type BatchDeleteResult struct {
	DeletedCount   int32
	ReclaimedBytes int64
	FailedFileIDs  []string
}

// CreateAccessRuleParams contains parameters for creating a file access rule (Feature 015)
type CreateAccessRuleParams struct {
	OrganizationID dbuuid.UUID
	FileID         dbuuid.UUID
	ContextType    string // "chat_channel", "department_docs", etc.
	ContextID      dbuuid.UUID
	AccessScope    string // "public", "private", "department"
}

// fileLogic implements FileLogic interface
type fileLogic struct {
	queries                *database.Queries
	r2Client               *R2Client
	flowsClient            flows.Client
	fileValidationWorkflow *FileValidationWorkflows
	accessLogic            AccessLogic
}

// NewLogic creates a new FileLogic instance
func NewLogic(
	queries *database.Queries,
	r2Client *R2Client,
	flowsClient flows.Client,
	fileValidationWorkflow *FileValidationWorkflows,
	accessLogic AccessLogic,
) FileLogic {
	return &fileLogic{
		queries:                queries,
		r2Client:               r2Client,
		flowsClient:            flowsClient,
		fileValidationWorkflow: fileValidationWorkflow,
		accessLogic:            accessLogic,
	}
}

// ValidateUploadRequest validates file upload parameters
func (l *fileLogic) ValidateUploadRequest(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, filename string, sizeBytes int64, mimeType string, uploadContext string) error {
	slog.DebugContext(ctx, "FileLogic.ValidateUploadRequest",
		"organization_id", orgID,
		"filename", filename,
		"size_bytes", sizeBytes,
		"mime_type", mimeType,
		"upload_context", uploadContext)

	// Validate upload context
	if !IsValidUploadContext(uploadContext) {
		slog.WarnContext(ctx, "invalid upload context",
			"upload_context", uploadContext,
			"valid_contexts", ValidUploadContexts())
		return fmt.Errorf("invalid upload_context: %s", uploadContext)
	}

	// Validate MIME type format (basic check)
	if mimeType == "" {
		return ErrInvalidMimeType
	}

	// Get or create quota for organization
	quota, err := l.queries.GetOrCreateQuota(ctx, tx, &database.GetOrCreateQuotaParams{
		OrganizationID: orgID,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get quota",
			"error", err,
			"organization_id", orgID)
		return fmt.Errorf("failed to get quota: %w", err)
	}

	// Check file size against per-file limit
	if sizeBytes > quota.MaxFileSizeBytes {
		slog.WarnContext(ctx, "file exceeds max size",
			"file_size", sizeBytes,
			"max_file_size", quota.MaxFileSizeBytes)
		return ErrFileTooLarge
	}

	// Check if upload would exceed quota (NULL quota_bytes = unlimited)
	if quota.QuotaBytes.Valid {
		if quota.CurrentUsageBytes+sizeBytes > quota.QuotaBytes.Int64 {
			slog.WarnContext(ctx, "upload would exceed quota",
				"current_usage", quota.CurrentUsageBytes,
				"file_size", sizeBytes,
				"quota_limit", quota.QuotaBytes.Int64)
			return ErrQuotaExceeded
		}
	}

	return nil
}

// isConvertibleMimeType checks if a MIME type is eligible for PDF conversion
func isConvertibleMimeType(mimeType string) bool {
	convertibleTypes := map[string]bool{
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document":   true, // .docx
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true, // .xlsx
		"application/vnd.openxmlformats-officedocument.presentationml.presentation": true, // .pptx
		"application/msword":            true, // .doc
		"application/vnd.ms-excel":      true, // .xls
		"application/vnd.ms-powerpoint": true, // .ppt
	}
	return convertibleTypes[mimeType]
}

// GenerateStorageKey creates R2 object key
func (l *fileLogic) GenerateStorageKey(orgID dbuuid.UUID, uploadContext string, fileID dbuuid.UUID) string {
	// Format: org-{orgID}/{uploadContext}/{fileID}
	return fmt.Sprintf("org-%s/%s/%s", orgID.String(), uploadContext, fileID.String())
}

// CheckQuota validates and locks quota row for atomic update
func (l *fileLogic) CheckQuota(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, fileSize int64) (*database.FilesFileQuotum, error) {
	slog.DebugContext(ctx, "FileLogic.CheckQuota",
		"organization_id", orgID,
		"file_size", fileSize)

	// Lock quota row for update
	quota, err := l.queries.GetQuotaForUpdate(ctx, tx, orgID)
	if err != nil {
		slog.ErrorContext(ctx, "failed to lock quota",
			"error", err,
			"organization_id", orgID)
		return nil, fmt.Errorf("failed to lock quota: %w", err)
	}

	// Validate quota limit (NULL = unlimited)
	if quota.QuotaBytes.Valid {
		if quota.CurrentUsageBytes+fileSize > quota.QuotaBytes.Int64 {
			return nil, ErrQuotaExceeded
		}
	}

	return quota, nil
}

// RecordUpload stores file metadata and increments quota
func (l *fileLogic) RecordUpload(ctx context.Context, tx database.DBTX, params RecordUploadParams) (*database.FilesFileMetadatum, error) {
	slog.DebugContext(ctx, "FileLogic.RecordUpload",
		"file_id", params.FileID,
		"organization_id", params.OrganizationID,
		"size_bytes", params.SizeBytes,
		"upload_context", params.UploadContext)

	// Create file metadata
	file, err := l.queries.CreateFileMetadata(ctx, tx, &database.CreateFileMetadataParams{
		ID:                   params.FileID,
		OrganizationID:       params.OrganizationID,
		OriginalFilename:     params.OriginalFilename,
		StorageKey:           params.StorageKey,
		SizeBytes:            params.SizeBytes,
		MimeType:             params.MimeType,
		UploadContext:        params.UploadContext,
		UploadedByEmployeeID: params.UploadedByEmployeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create file metadata",
			"error", err,
			"file_id", params.FileID)
		return nil, fmt.Errorf("failed to create file metadata: %w", err)
	}

	// Increment quota usage
	err = l.queries.IncrementQuotaUsage(ctx, tx, &database.IncrementQuotaUsageParams{
		OrganizationID:    params.OrganizationID,
		CurrentUsageBytes: params.SizeBytes,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to increment quota usage",
			"error", err,
			"organization_id", params.OrganizationID,
			"size_bytes", params.SizeBytes)
		return nil, fmt.Errorf("failed to increment quota: %w", err)
	}

	slog.InfoContext(ctx, "file upload recorded",
		"file_id", params.FileID,
		"organization_id", params.OrganizationID,
		"size_bytes", params.SizeBytes)

	return file, nil
}

// RecordDeletion soft-deletes file, creates audit log, and decrements quota
func (l *fileLogic) RecordDeletion(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, fileID dbuuid.UUID, employeeID dbuuid.UUID, reason string) (int64, error) {
	slog.DebugContext(ctx, "FileLogic.RecordDeletion",
		"organization_id", orgID,
		"file_id", fileID,
		"deleted_by_employee_id", employeeID,
		"reason", reason)

	// Get file size before deletion
	sizeBytes, err := l.queries.GetFileSizeByID(ctx, tx, &database.GetFileSizeByIDParams{
		OrganizationID: orgID,
		ID:             fileID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get file size",
			"error", err,
			"file_id", fileID)
		return 0, ErrFileNotFound
	}

	// Get file metadata for deletion log
	file, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
		OrganizationID: orgID,
		ID:             fileID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get file metadata",
			"error", err,
			"file_id", fileID)
		return 0, ErrFileNotFound
	}

	// Soft delete file
	err = l.queries.SoftDeleteFile(ctx, tx, &database.SoftDeleteFileParams{
		OrganizationID: orgID,
		ID:             fileID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to soft delete file",
			"error", err,
			"file_id", fileID)
		return 0, fmt.Errorf("failed to soft delete file: %w", err)
	}

	// Create deletion log
	var deletionReasonNullable pgtype.Text
	if reason != "" {
		deletionReasonNullable = pgtype.Text{
			String: reason,
			Valid:  true,
		}
	}

	_, err = l.queries.CreateDeletionLog(ctx, tx, &database.CreateDeletionLogParams{
		OrganizationID:      orgID,
		FileID:              fileID,
		OriginalFilename:    file.OriginalFilename,
		DeletedByEmployeeID: employeeID,
		DeletionReason:      deletionReasonNullable,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create deletion log",
			"error", err,
			"file_id", fileID)
		return 0, fmt.Errorf("failed to create deletion log: %w", err)
	}

	// Decrement quota usage for original file
	err = l.queries.DecrementQuotaUsage(ctx, tx, &database.DecrementQuotaUsageParams{
		OrganizationID:    orgID,
		CurrentUsageBytes: sizeBytes,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to decrement quota usage",
			"error", err,
			"organization_id", orgID,
			"size_bytes", sizeBytes)
		return 0, fmt.Errorf("failed to decrement quota: %w", err)
	}

	reclaimedBytes := sizeBytes

	// Check if PDF conversion exists and delete it
	pdfConversion, err := l.queries.GetPDFConversion(ctx, tx, &database.GetPDFConversionParams{
		OrganizationID: orgID,
		OriginalFileID: fileID,
	})
	if err == nil {
		// PDF conversion exists, delete it from database and decrement quota
		slog.InfoContext(ctx, "deleting PDF conversion",
			"file_id", fileID,
			"pdf_storage_key", pdfConversion.PdfStorageKey,
			"pdf_size_bytes", pdfConversion.PdfSizeBytes)

		// Decrement quota for PDF size
		err = l.queries.DecrementQuotaUsage(ctx, tx, &database.DecrementQuotaUsageParams{
			OrganizationID:    orgID,
			CurrentUsageBytes: pdfConversion.PdfSizeBytes,
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to decrement quota for PDF",
				"error", err,
				"pdf_size", pdfConversion.PdfSizeBytes)
			// Don't fail deletion, continue
		} else {
			reclaimedBytes += pdfConversion.PdfSizeBytes
		}

		// Delete PDF conversion record
		err = l.queries.DeletePDFConversion(ctx, tx, &database.DeletePDFConversionParams{
			OrganizationID: orgID,
			OriginalFileID: fileID,
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to delete PDF conversion record",
				"error", err,
				"file_id", fileID)
			// Don't fail deletion, continue
		}

		// Delete PDF from R2 asynchronously
		pdfStorageKey := pdfConversion.PdfStorageKey
		go func() {
			deleteCtx := context.Background()
			if err := l.r2Client.DeleteObject(deleteCtx, pdfStorageKey); err != nil {
				slog.ErrorContext(deleteCtx, "failed to delete PDF from R2",
					"error", err,
					"storage_key", pdfStorageKey,
					"file_id", fileID)
			} else {
				slog.InfoContext(deleteCtx, "deleted PDF from R2",
					"storage_key", pdfStorageKey,
					"file_id", fileID)
			}
		}()
	} else if !errors.Is(err, pgx.ErrNoRows) {
		// Log error but don't fail deletion
		slog.ErrorContext(ctx, "failed to check for PDF conversion",
			"error", err,
			"file_id", fileID)
	}

	// Check if content index exists and delete it
	_, err = l.queries.GetFileContentIndex(ctx, tx, &database.GetFileContentIndexParams{
		OrganizationID: orgID,
		FileID:         fileID,
	})
	if err == nil {
		// Content index exists, delete it
		err = l.queries.DeleteFileContentIndex(ctx, tx, &database.DeleteFileContentIndexParams{
			OrganizationID: orgID,
			FileID:         fileID,
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to delete content index",
				"error", err,
				"file_id", fileID)
			// Don't fail deletion, continue
		} else {
			slog.InfoContext(ctx, "deleted content index",
				"file_id", fileID)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		// Log error but don't fail deletion
		slog.ErrorContext(ctx, "failed to check for content index",
			"error", err,
			"file_id", fileID)
	}

	slog.InfoContext(ctx, "file deletion recorded",
		"file_id", fileID,
		"organization_id", orgID,
		"reclaimed_bytes", reclaimedBytes)

	return reclaimedBytes, nil
}

// GenerateUploadURL generates a presigned R2 upload URL for a new file (Feature 015)
// Called by domain services after context verification (e.g., ChatService verifies channel membership)
// NO auth extraction or context verification - trusts the caller (domain service)
func (l *fileLogic) GenerateUploadURL(ctx context.Context, tx database.DBTX, r2Client *R2Client, params GenerateUploadURLParams) (*UploadURLResult, error) {
	slog.DebugContext(ctx, "FileLogic.GenerateUploadURL",
		"organization_id", params.OrganizationID,
		"employee_id", params.EmployeeID,
		"filename", params.Filename,
		"upload_context", params.UploadContext)

	// Validate upload context
	if !IsValidUploadContext(params.UploadContext) {
		return nil, fmt.Errorf("invalid upload context: %s", params.UploadContext)
	}

	// Generate UUID v7 for file ID
	fileID := dbuuid.Must()

	// Construct storage key: org-{orgID}/{uploadContext}/{fileID}
	storageKey := l.GenerateStorageKey(params.OrganizationID, params.UploadContext, dbuuid.UUID(fileID))

	// Generate presigned R2 upload URL (15 min expiration)
	uploadURL, expiresAt, err := r2Client.GeneratePresignedUploadURL(ctx, storageKey, params.MimeType, 15*time.Minute)
	if err != nil {
		slog.ErrorContext(ctx, "failed to generate presigned upload URL",
			"error", err,
			"storage_key", storageKey)
		return nil, fmt.Errorf("failed to generate upload URL: %w", err)
	}

	// Insert file_metadata row with status='pending'
	_, err = l.queries.CreateFileMetadata(ctx, tx, &database.CreateFileMetadataParams{
		ID:                   fileID,
		OrganizationID:       params.OrganizationID,
		OriginalFilename:     params.Filename,
		StorageKey:           storageKey,
		SizeBytes:            params.SizeBytes,
		MimeType:             params.MimeType,
		UploadContext:        params.UploadContext,
		UploadedByEmployeeID: params.EmployeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to insert file metadata",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("failed to create file metadata: %w", err)
	}

	slog.InfoContext(ctx, "generated upload URL for file",
		"file_id", fileID,
		"storage_key", storageKey,
		"expires_at", expiresAt)

	return &UploadURLResult{
		FileID:     fileID,
		UploadURL:  uploadURL,
		ExpiresAt:  expiresAt,
		StorageKey: storageKey,
	}, nil
}

// RequestUpload validates upload request and generates presigned URL
func (l *fileLogic) RequestUpload(ctx context.Context, tx database.DBTX, params RequestUploadParams) (*UploadURLResult, error) {
	slog.DebugContext(ctx, "FileLogic.RequestUpload",
		"organization_id", params.OrganizationID,
		"employee_id", params.EmployeeID,
		"filename", params.Filename,
		"size_bytes", params.SizeBytes,
		"upload_context", params.UploadContext)

	// Validate upload context
	if !IsValidUploadContext(params.UploadContext) {
		slog.WarnContext(ctx, "invalid upload context",
			"upload_context", params.UploadContext,
			"valid_contexts", ValidUploadContexts())
		return nil, fmt.Errorf("invalid upload_context: %s", params.UploadContext)
	}

	// Validate MIME type format (basic check)
	if params.MimeType == "" {
		return nil, ErrInvalidMimeType
	}

	// Get or create quota for organization
	quota, err := l.queries.GetOrCreateQuota(ctx, tx, &database.GetOrCreateQuotaParams{
		OrganizationID: params.OrganizationID,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get quota", "error", err, "organization_id", params.OrganizationID)
		return nil, fmt.Errorf("failed to get quota: %w", err)
	}

	// Check file size against per-file limit
	if params.SizeBytes > quota.MaxFileSizeBytes {
		slog.WarnContext(ctx, "file exceeds max size", "file_size", params.SizeBytes, "max_file_size", quota.MaxFileSizeBytes)
		return nil, ErrFileTooLarge
	}

	// Check if upload would exceed quota (NULL quota_bytes = unlimited)
	if quota.QuotaBytes.Valid {
		if quota.CurrentUsageBytes+params.SizeBytes > quota.QuotaBytes.Int64 {
			slog.WarnContext(ctx, "upload would exceed quota", "current_usage", quota.CurrentUsageBytes, "file_size", params.SizeBytes, "quota_limit", quota.QuotaBytes.Int64)
			return nil, ErrQuotaExceeded
		}
	}

	// Generate UUID v7 for file ID
	fileID := dbuuid.Must()

	// Construct storage key
	storageKey := l.GenerateStorageKey(params.OrganizationID, params.UploadContext, dbuuid.UUID(fileID))

	// Generate presigned R2 upload URL (15 min expiration)
	uploadURL, expiresAt, err := l.r2Client.GeneratePresignedUploadURL(ctx, storageKey, params.MimeType, 15*time.Minute)
	if err != nil {
		slog.ErrorContext(ctx, "failed to generate presigned URL", "error", err)
		return nil, fmt.Errorf("generate upload URL: %w", err)
	}

	// Insert file_metadata row with status='pending'
	_, err = l.queries.CreateFileMetadata(ctx, tx, &database.CreateFileMetadataParams{
		ID:                   fileID,
		OrganizationID:       params.OrganizationID,
		OriginalFilename:     params.Filename,
		StorageKey:           storageKey,
		SizeBytes:            params.SizeBytes,
		MimeType:             params.MimeType,
		UploadContext:        params.UploadContext,
		UploadedByEmployeeID: params.EmployeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create file metadata", "error", err, "file_id", fileID)
		return nil, fmt.Errorf("failed to create file metadata: %w", err)
	}

	slog.InfoContext(ctx, "generated upload URL", "file_id", fileID, "storage_key", storageKey, "expires_at", expiresAt)

	return &UploadURLResult{
		FileID:     fileID,
		UploadURL:  uploadURL,
		ExpiresAt:  expiresAt,
		StorageKey: storageKey,
	}, nil
}

// ConfirmUpload confirms that a file upload has completed successfully
// Updates file status, increments organization quota, and triggers validation
func (l *fileLogic) ConfirmUpload(ctx context.Context, tx database.DBTX, params ConfirmUploadParams) (*FileMetadata, error) {
	slog.DebugContext(ctx, "FileLogic.ConfirmUpload",
		"organization_id", params.OrganizationID,
		"employee_id", params.EmployeeID,
		"file_id", params.FileID)

	// Query file_metadata
	file, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
		OrganizationID: params.OrganizationID,
		ID:             params.FileID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get file metadata", "error", err, "file_id", params.FileID)
		return nil, fmt.Errorf("file not found: %w", err)
	}

	// Verify file uploader matches employeeID
	if file.UploadedByEmployeeID != params.EmployeeID {
		slog.WarnContext(ctx, "confirm upload unauthorized", "uploader", file.UploadedByEmployeeID, "requester", params.EmployeeID)
		return nil, fmt.Errorf("unauthorized")
	}

	// Increment quota usage
	err = l.queries.IncrementQuotaUsage(ctx, tx, &database.IncrementQuotaUsageParams{
		OrganizationID:    params.OrganizationID,
		CurrentUsageBytes: file.SizeBytes,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update file quota", "error", err)
		return nil, fmt.Errorf("failed to update quota: %w", err)
	}

	// Enqueue validation workflow inside the current transaction (ACID-friendly).
	// Note: flows@v0.0.2 does not require WithTenantID; sharding is derived from workflow name.
	_, enqueueErr := flows.BeginTx(ctx, l.flowsClient, tx, l.fileValidationWorkflow.FileValidation, &FileValidationWorkflowInput{
		OrganizationID:   params.OrganizationID,
		FileID:           params.FileID,
		StorageKey:       file.StorageKey,
		DeclaredMimeType: file.MimeType,
	})
	if enqueueErr != nil {
		return nil, fmt.Errorf("failed to enqueue validation workflow: %w", enqueueErr)
	}

	slog.InfoContext(ctx, "file upload confirmed", "file_id", params.FileID)

	return &FileMetadata{
		ID:               file.ID,
		OrganizationID:   file.OrganizationID,
		Filename:         file.OriginalFilename,
		StorageKey:       file.StorageKey,
		SizeBytes:        file.SizeBytes,
		MimeType:         file.MimeType,
		UploadContext:    file.UploadContext,
		UploadedBy:       file.UploadedByEmployeeID,
		ValidationStatus: file.ValidationStatus.String,
		UpdatedAt:        file.UpdatedAt.Time,
	}, nil
}

// GetDownloadUrl generates presigned download URL with access check
func (l *fileLogic) GetDownloadUrl(ctx context.Context, tx database.DBTX, params GetDownloadUrlParams) (*GetDownloadUrlResult, error) {
	// Get file metadata
	file, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
		OrganizationID: params.OrganizationID,
		ID:             params.FileID,
	})
	if err != nil {
		return nil, ErrFileNotFound
	}

	// Check access logic
	accessResult, err := l.accessLogic.CheckFileAccess(ctx, tx, params.OrganizationID, params.EmployeeID, params.FileID)
	if err != nil {
		return nil, err
	}
	if !accessResult.HasAccess {
		return nil, fmt.Errorf("access denied: %s", accessResult.DenialReason)
	}

	// Check if deleted
	if file.IsDeleted {
		deletionLog, err := l.queries.GetDeletionLogWithDeleterName(ctx, tx, &database.GetDeletionLogWithDeleterNameParams{
			OrganizationID: params.OrganizationID,
			FileID:         params.FileID,
		})
		info := &FileDeletionInfo{}
		if err == nil {
			info.DeletedAt = deletionLog.DeletedAt.Time
			info.DeletedByEmployeeID = deletionLog.DeletedByEmployeeID
			if name, ok := deletionLog.DeleterName.(string); ok {
				info.DeletedByEmployeeName = name
			}
			info.DeletionReason = deletionLog.DeletionReason.String
		}
		return &GetDownloadUrlResult{
			IsDeleted:    true,
			DeletionInfo: info,
		}, nil
	}

	// Generate URL
	downloadURL, expiresAt, err := l.r2Client.GeneratePresignedDownloadURL(ctx, file.StorageKey, 1*time.Hour)
	if err != nil {
		return nil, err
	}

	return &GetDownloadUrlResult{
		DownloadUrl: downloadURL,
		ExpiresAt:   expiresAt,
		IsDeleted:   false,
	}, nil
}

// GetFileMetadata retrieves file metadata with access check
func (l *fileLogic) GetFileMetadata(ctx context.Context, tx database.DBTX, params GetFileMetadataParams) (*GetFileMetadataResult, error) {
	// Get file metadata
	file, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
		OrganizationID: params.OrganizationID,
		ID:             params.FileID,
	})
	if err != nil {
		return nil, ErrFileNotFound
	}

	// Check access logic
	result, err := l.accessLogic.CheckFileAccess(ctx, tx, params.OrganizationID, params.EmployeeID, params.FileID)
	if err != nil {
		return nil, err
	}
	if !result.HasAccess {
		return nil, fmt.Errorf("access denied: %s", result.DenialReason)
	}

	res := &GetFileMetadataResult{
		File: &FileMetadata{
			ID:               file.ID,
			OrganizationID:   file.OrganizationID,
			Filename:         file.OriginalFilename,
			StorageKey:       file.StorageKey,
			SizeBytes:        file.SizeBytes,
			MimeType:         file.MimeType,
			UploadContext:    file.UploadContext,
			UploadedBy:       file.UploadedByEmployeeID,
			ValidationStatus: file.ValidationStatus.String,
			UpdatedAt:        file.UpdatedAt.Time,
		},
		IsDeleted: file.IsDeleted,
	}

	// Check for PDF conversion info for office documents
	if err := l.enrichFileMetadataWithConversion(ctx, tx, res.File, params.OrganizationID); err != nil {
		slog.WarnContext(ctx, "failed to enrich file with conversion info",
			"file_id", params.FileID,
			"error", err)
	}

	if file.IsDeleted {
		deletionLog, err := l.queries.GetDeletionLogWithDeleterName(ctx, tx, &database.GetDeletionLogWithDeleterNameParams{
			OrganizationID: params.OrganizationID,
			FileID:         params.FileID,
		})
		if err == nil {
			res.DeletionInfo = &FileDeletionInfo{
				DeletedAt:             deletionLog.DeletedAt.Time,
				DeletedByEmployeeID:   deletionLog.DeletedByEmployeeID,
				DeletedByEmployeeName: deletionLog.DeleterName.(string),
				DeletionReason:        deletionLog.DeletionReason.String,
			}
		}
	}

	return res, nil
}

// enrichFileMetadataWithConversion adds PDF conversion info to FileMetadata if applicable
func (l *fileLogic) enrichFileMetadataWithConversion(ctx context.Context, tx database.DBTX, file *FileMetadata, orgID dbuuid.UUID) error {
	// Only check for convertible MIME types to avoid unnecessary DB query
	if !isConvertibleMimeType(file.MimeType) {
		return nil
	}

	conversionRow, err := l.queries.GetPDFConversion(ctx, tx, &database.GetPDFConversionParams{
		OrganizationID: orgID,
		OriginalFileID: file.ID,
	})
	if err != nil {
		// No conversion exists - this is fine
		return nil
	}

	// Conversion exists, include status info (WITHOUT presigned URL for security)
	conversionInfo := &PDFConversionInfo{
		Status:        conversionRow.ConversionStatus,
		DurationMs:    int(conversionRow.ConversionDurationMs.Int32),
		PDFStorageKey: conversionRow.PdfStorageKey, // Store key for later URL generation
	}
	if conversionRow.ConversionError.Valid {
		conversionInfo.Error = conversionRow.ConversionError.String
	}
	// Note: Do NOT generate presigned URL here to prevent exposure in metadata responses
	// URL generation happens in GetPDFConversionStatus with access check
	file.PDFConversionInfo = conversionInfo
	return nil
}

// GetFileMetadataBatch retrieves multiple file metadata with access check
func (l *fileLogic) GetFileMetadataBatch(ctx context.Context, tx database.DBTX, params GetFileMetadataBatchParams) (*GetFileMetadataBatchResult, error) {
	// Fetch all requested files
	files, err := l.queries.GetFilesByIDs(ctx, tx, &database.GetFilesByIDsParams{
		OrganizationID: params.OrganizationID,
		Column2:        params.FileIDs,
	})
	if err != nil {
		return nil, err
	}

	accessibleFiles := make([]*FileMetadata, 0, len(files))
	deletedFileIDs := make([]dbuuid.UUID, 0)

	// Check access
	for _, file := range files {
		result, err := l.accessLogic.CheckFileAccess(ctx, tx, params.OrganizationID, params.EmployeeID, file.ID)
		if err != nil {
			continue // Skip on error
		}
		if result.HasAccess {
			accessibleFiles = append(accessibleFiles, &FileMetadata{
				ID:               file.ID,
				OrganizationID:   file.OrganizationID,
				Filename:         file.OriginalFilename,
				StorageKey:       file.StorageKey,
				SizeBytes:        file.SizeBytes,
				MimeType:         file.MimeType,
				UploadContext:    file.UploadContext,
				UploadedBy:       file.UploadedByEmployeeID,
				ValidationStatus: file.ValidationStatus.String,
				UpdatedAt:        file.UpdatedAt.Time,
			})
			if file.IsDeleted {
				deletedFileIDs = append(deletedFileIDs, file.ID)
			}
		}
	}

	// Enrich files with PDF conversion info
	for _, fileMetadata := range accessibleFiles {
		if err := l.enrichFileMetadataWithConversion(ctx, tx, fileMetadata, params.OrganizationID); err != nil {
			slog.WarnContext(ctx, "failed to enrich file with conversion info",
				"file_id", fileMetadata.ID,
				"error", err)
			// Continue with other files
		}
	}

	// Fetch deletion info
	deletionInfo := make(map[string]*FileDeletionInfo)
	if len(deletedFileIDs) > 0 {
		for _, fileID := range deletedFileIDs {
			log, err := l.queries.GetDeletionLogWithDeleterName(ctx, tx, &database.GetDeletionLogWithDeleterNameParams{
				OrganizationID: params.OrganizationID,
				FileID:         fileID,
			})
			if err == nil {
				deletionInfo[fileID.String()] = &FileDeletionInfo{
					DeletedAt:             log.DeletedAt.Time,
					DeletedByEmployeeID:   log.DeletedByEmployeeID,
					DeletedByEmployeeName: log.DeleterName.(string),
					DeletionReason:        log.DeletionReason.String,
				}
			}
		}
	}

	return &GetFileMetadataBatchResult{
		Files:        accessibleFiles,
		DeletionInfo: deletionInfo,
	}, nil
}

// ListFiles returns paginated list of files based on context
func (l *fileLogic) ListFiles(ctx context.Context, tx database.DBTX, params ListFilesParams) ([]*database.FilesFileMetadatum, int64, error) {
	// Filter by context
	contextFilter := pgtype.Text{}
	if params.UploadContext != "" {
		contextFilter.String = params.UploadContext
		contextFilter.Valid = true
	}
	sortByFilter := pgtype.Text{String: params.SortBy, Valid: true}
	sortOrderFilter := pgtype.Text{String: params.SortOrder, Valid: true}

	files, err := l.queries.ListFilesByContext(ctx, tx, &database.ListFilesByContextParams{
		OrganizationID: params.OrganizationID,
		Context:        contextFilter,
		SortBy:         sortByFilter,
		SortOrder:      sortOrderFilter,
		Limit:          params.Limit,
		Offset:         params.Offset,
	})
	if err != nil {
		return nil, 0, err
	}

	// Count total
	totalCount, err := l.queries.CountFilesByContext(ctx, tx, &database.CountFilesByContextParams{
		OrganizationID: params.OrganizationID,
		Context:        contextFilter,
	})
	if err != nil {
		return nil, 0, err
	}

	return files, totalCount, nil
}

// CreateAccessRule creates file access rule linking the file to its context
func (l *fileLogic) CreateAccessRule(ctx context.Context, tx database.DBTX, params CreateAccessRuleParams) error {
	slog.DebugContext(ctx, "FileLogic.CreateAccessRule",
		"organization_id", params.OrganizationID,
		"file_id", params.FileID,
		"context_type", params.ContextType,
		"context_id", params.ContextID,
		"access_scope", params.AccessScope)

	// Insert file_access_rule row linking file to context
	_, err := l.queries.InsertFileAccessRule(ctx, tx, &database.InsertFileAccessRuleParams{
		OrganizationID: params.OrganizationID,
		FileID:         params.FileID,
		ContextType:    params.ContextType,
		ContextID:      params.ContextID,
		AccessScope:    params.AccessScope,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to insert file access rule",
			"error", err,
			"file_id", params.FileID,
			"context_type", params.ContextType)
		return fmt.Errorf("failed to create access rule: %w", err)
	}

	slog.InfoContext(ctx, "file access rule created",
		"file_id", params.FileID,
		"context_type", params.ContextType,
		"context_id", params.ContextID,
		"access_scope", params.AccessScope)

	return nil
}

// DeleteFile soft-deletes file and removes from R2 asynchronously
func (l *fileLogic) DeleteFile(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, fileID dbuuid.UUID, employeeID dbuuid.UUID, reason string) (int64, error) {
	// Get file for storage key before deletion
	var storageKey string
	var reclaimedBytes int64

	// Get file metadata
	file, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
		OrganizationID: orgID,
		ID:             fileID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, ErrFileNotFound
		}
		return 0, fmt.Errorf("failed to get file: %w", err)
	}
	storageKey = file.StorageKey

	// Record deletion (calling existing RecordDeletion logic)
	reclaimedBytes, err = l.RecordDeletion(ctx, tx, orgID, fileID, employeeID, reason)
	if err != nil {
		return 0, err
	}

	// Delete from R2 asynchronously
	go func() {
		deleteCtx := context.Background()
		if err := l.r2Client.DeleteObject(deleteCtx, storageKey); err != nil {
			slog.ErrorContext(deleteCtx, "failed to delete object from R2",
				"error", err,
				"storage_key", storageKey,
				"file_id", fileID)
		}
	}()

	return reclaimedBytes, nil
}

// BatchDeleteFiles deletes multiple files and removes from R2 asynchronously
func (l *fileLogic) BatchDeleteFiles(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeID dbuuid.UUID, fileIDs []string, reason string) (*BatchDeleteResult, error) {
	var deletedCount int32
	var totalReclaimedBytes int64
	var failedFileIDs []string
	storageKeys := make([]string, 0)

	for _, fileIDStr := range fileIDs {
		fileID, parseErr := uuid.Parse(fileIDStr)
		if parseErr != nil {
			failedFileIDs = append(failedFileIDs, fileIDStr)
			continue
		}

		// Get file metadata for storage key
		file, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
			OrganizationID: orgID,
			ID:             dbuuid.UUID(fileID),
		})
		if err != nil {
			failedFileIDs = append(failedFileIDs, fileIDStr)
			continue
		}

		// Record deletion
		reclaimedBytes, err := l.RecordDeletion(ctx, tx, orgID, dbuuid.UUID(fileID), employeeID, reason)
		if err != nil {
			failedFileIDs = append(failedFileIDs, fileIDStr)
			continue
		}

		// Only add to storageKeys if DB deletion succeeded
		storageKeys = append(storageKeys, file.StorageKey)
		deletedCount++
		totalReclaimedBytes += reclaimedBytes
	}

	// Delete from R2 asynchronously
	go func() {
		deleteCtx := context.Background()
		for _, storageKey := range storageKeys {
			if err := l.r2Client.DeleteObject(deleteCtx, storageKey); err != nil {
				slog.ErrorContext(deleteCtx, "failed to delete object from R2",
					"error", err,
					"storage_key", storageKey)
			}
		}
	}()

	return &BatchDeleteResult{
		DeletedCount:   deletedCount,
		ReclaimedBytes: totalReclaimedBytes,
		FailedFileIDs:  failedFileIDs,
	}, nil
}

// ValidateFile performs file type validation using magic byte detection
func (l *fileLogic) ValidateFile(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, employeeID dbuuid.UUID, fileID dbuuid.UUID) (*rpcv1.FileValidationResult, error) {
	// Get file metadata
	file, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
		OrganizationID: orgID,
		ID:             fileID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrFileNotFound
		}
		return nil, fmt.Errorf("failed to get file: %w", err)
	}

	// Perform validation using magic byte detection
	result, err := ValidateFileType(ctx, l.r2Client, file.StorageKey, file.MimeType)
	if err != nil {
		return nil, err
	}

	// Update validation status in database
	err = l.queries.UpdateFileValidation(ctx, tx, &database.UpdateFileValidationParams{
		OrganizationID:   orgID,
		ID:               fileID,
		ValidationStatus: pgtype.Text{String: result.Status, Valid: true},
		ValidationMessage: pgtype.Text{
			String: result.Message,
			Valid:  result.Message != "",
		},
		DetectedMimeType: pgtype.Text{
			String: result.DetectedMimeType,
			Valid:  result.DetectedMimeType != "",
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update validation status: %w", err)
	}

	// Convert validation status to proto enum
	var protoStatus rpcv1.ValidationStatus
	switch result.Status {
	case ValidationStatusVerified:
		protoStatus = rpcv1.ValidationStatus_VALIDATION_STATUS_VERIFIED
	case ValidationStatusWarning:
		protoStatus = rpcv1.ValidationStatus_VALIDATION_STATUS_WARNING
	case ValidationStatusFailed:
		protoStatus = rpcv1.ValidationStatus_VALIDATION_STATUS_FAILED
	case ValidationStatusSkipped:
		protoStatus = rpcv1.ValidationStatus_VALIDATION_STATUS_SKIPPED
	case ValidationStatusPending:
		protoStatus = rpcv1.ValidationStatus_VALIDATION_STATUS_UNSPECIFIED
	default:
		protoStatus = rpcv1.ValidationStatus_VALIDATION_STATUS_UNSPECIFIED
	}

	return &rpcv1.FileValidationResult{
		Status:           protoStatus,
		Message:          result.Message,
		DeclaredMimeType: result.DeclaredMimeType,
		DetectedMimeType: result.DetectedMimeType,
	}, nil
}
