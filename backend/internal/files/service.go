package files

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// FileValidationInput contains input for starting file validation workflow
type FileValidationInput struct {
	OrganizationID   dbuuid.UUID
	FileID           dbuuid.UUID
	StorageKey       string
	DeclaredMimeType string
}

// FileServiceServer implements the FileService RPC interface
type FileServiceServer struct {
	TenantPool database.TenantDatabaseConnector
	AdminPool  database.AdminDatabaseConnector

	// Logic layers (business operations, pool-agnostic)
	logic       FileLogic
	accessLogic AccessLogic
	pdfLogic    PDFLogic
	indexLogic  IndexLogic
	searchLogic SearchLogic

	// Infrastructure
	queries      *database.Queries
	instanceID   string
	clamAVClient *ClamAVClient
	flowsClient  flows.Client
	postProcess  flows.Workflow[FilePostProcessingWorkflowInput, FilePostProcessingWorkflowOutput]
}

// NewService creates a new FileServiceServer
func NewService(
	tenantPool database.TenantDatabaseConnector,
	adminPool database.AdminDatabaseConnector,
	logic FileLogic,
	accessLogic AccessLogic,
	pdfLogic PDFLogic,
	indexLogic IndexLogic,
	searchLogic SearchLogic,
	queries *database.Queries,
	instanceID string,
	clamAVClient *ClamAVClient,
	flowsClient flows.Client,
	postProcess flows.Workflow[FilePostProcessingWorkflowInput, FilePostProcessingWorkflowOutput],
) rpcv1connect.FileServiceHandler {
	return &FileServiceServer{
		TenantPool:   tenantPool,
		AdminPool:    adminPool,
		logic:        logic,
		accessLogic:  accessLogic,
		pdfLogic:     pdfLogic,
		indexLogic:   indexLogic,
		searchLogic:  searchLogic,
		queries:      queries,
		instanceID:   instanceID,
		clamAVClient: clamAVClient,
		flowsClient:  flowsClient,
		postProcess:  postProcess,
	}
}

// GetDownloadUrl generates presigned URL for file download from R2
func (s *FileServiceServer) GetDownloadUrl(
	ctx context.Context,
	req *connect.Request[rpcv1.GetDownloadUrlRequest],
) (*connect.Response[rpcv1.GetDownloadUrlResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	fileID, err := uuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	slog.DebugContext(ctx, "GetDownloadUrl RPC called",
		"file_id", fileID.String(),
		"organization_id", orgID,
		"employee_id", employeeID)

	var result *GetDownloadUrlResult
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		res, txErr := s.logic.GetDownloadUrl(ctx, tx, GetDownloadUrlParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			FileID:         dbuuid.UUID(fileID),
		})
		if txErr != nil {
			return txErr
		}
		result = res
		return nil
	})

	if err != nil {
		if err == ErrFileNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file not found"))
		}
		// Logic layer returns generic access denied error if applicable, which we can propagate or map
		slog.ErrorContext(ctx, "failed to get download url", "error", err)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	response := &rpcv1.GetDownloadUrlResponse{
		DownloadUrl: result.DownloadUrl,
		IsDeleted:   result.IsDeleted,
	}
	if !result.ExpiresAt.IsZero() {
		response.ExpiresAt = timestamppb.New(result.ExpiresAt)
	}

	if result.IsDeleted && result.DeletionInfo != nil {
		response.DeletionInfo = &rpcv1.FileDeletionInfo{
			DeletedAt:             timestamppb.New(result.DeletionInfo.DeletedAt),
			DeletedByEmployeeId:   result.DeletionInfo.DeletedByEmployeeID.String(),
			DeletedByEmployeeName: result.DeletionInfo.DeletedByEmployeeName,
			DeletionReason:        result.DeletionInfo.DeletionReason,
		}
	}

	return connect.NewResponse(response), nil
}

// GetFileMetadata retrieves file information without generating download URL
func (s *FileServiceServer) GetFileMetadata(
	ctx context.Context,
	req *connect.Request[rpcv1.GetFileMetadataRequest],
) (*connect.Response[rpcv1.GetFileMetadataResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	fileID, err := uuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "GetFileMetadata RPC called",
		"file_id", fileID.String(),
		"organization_id", orgID,
		"employee_id", employeeID)

	// SECURITY: Check file access and get metadata in single transaction
	var result *GetFileMetadataResult
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		res, txErr := s.logic.GetFileMetadata(ctx, tx, GetFileMetadataParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			FileID:         dbuuid.UUID(fileID),
		})
		if txErr != nil {
			return txErr
		}
		result = res
		return nil
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to get file metadata", "error", err)
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file not found or access denied"))
	}

	// Convert to proto
	protoFile := &rpcv1.FileMetadata{
		Id:                   result.File.ID.String(),
		OriginalFilename:     result.File.Filename,
		SizeBytes:            result.File.SizeBytes,
		MimeType:             result.File.MimeType,
		UploadContext:        result.File.UploadContext,
		UploadedByEmployeeId: result.File.UploadedBy.String(),
		UploadedAt:           timestamppb.New(result.File.UpdatedAt),
		IsDeleted:            result.IsDeleted,
	}

	// Include PDF conversion status (WITHOUT URL for security)
	if result.File.PDFConversionInfo != nil {
		protoFile.PdfConversionStatus = stringToProtoConversionStatus(result.File.PDFConversionInfo.Status)
	}

	response := &rpcv1.GetFileMetadataResponse{
		File:      protoFile,
		IsDeleted: result.IsDeleted,
	}

	if result.IsDeleted && result.DeletionInfo != nil {
		response.DeletionInfo = &rpcv1.FileDeletionInfo{
			DeletedAt:             timestamppb.New(result.DeletionInfo.DeletedAt),
			DeletedByEmployeeId:   result.DeletionInfo.DeletedByEmployeeID.String(),
			DeletedByEmployeeName: result.DeletionInfo.DeletedByEmployeeName,
			DeletionReason:        result.DeletionInfo.DeletionReason,
		}
	}

	return connect.NewResponse(response), nil
}

// GetFileMetadataBatch retrieves multiple file metadata in a single request
// SECURITY: Only returns files the user has access to (silently filters unauthorized files)
func (s *FileServiceServer) GetFileMetadataBatch(
	ctx context.Context,
	req *connect.Request[rpcv1.GetFileMetadataBatchRequest],
) (*connect.Response[rpcv1.GetFileMetadataBatchResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	// Validate and parse file IDs
	if len(req.Msg.FileIds) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("file_ids cannot be empty"))
	}
	if len(req.Msg.FileIds) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("maximum 100 file IDs allowed"))
	}

	fileIDs := make([]dbuuid.UUID, 0, len(req.Msg.FileIds))
	for _, idStr := range req.Msg.FileIds {
		fileID, err := uuid.Parse(idStr)
		if err != nil {
			slog.WarnContext(ctx, "invalid file ID in batch request", "file_id", idStr, "error", err)
			continue // Skip invalid IDs instead of failing the entire request
		}
		fileIDs = append(fileIDs, dbuuid.UUID(fileID))
	}

	if len(fileIDs) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("no valid file IDs provided"))
	}

	slog.DebugContext(ctx, "GetFileMetadataBatch RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"requested_count", len(fileIDs))

	// SECURITY: Fetch files and check access for each in single transaction
	var result *GetFileMetadataBatchResult
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		res, txErr := s.logic.GetFileMetadataBatch(ctx, tx, GetFileMetadataBatchParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			FileIDs:        fileIDs,
		})
		if txErr != nil {
			return txErr
		}
		result = res
		return nil
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get file metadata batch", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get metadata batch"))
	}

	// Build response
	response := &rpcv1.GetFileMetadataBatchResponse{
		Files:        make([]*rpcv1.FileMetadata, len(result.Files)),
		DeletionInfo: make(map[string]*rpcv1.FileDeletionInfo),
	}

	for i, file := range result.Files {
		protoFile := &rpcv1.FileMetadata{
			Id:                   file.ID.String(),
			OriginalFilename:     file.Filename,
			SizeBytes:            file.SizeBytes,
			MimeType:             file.MimeType,
			UploadContext:        file.UploadContext,
			UploadedByEmployeeId: file.UploadedBy.String(),
			UploadedAt:           timestamppb.New(file.UpdatedAt),
			IsDeleted:            false, // Default, will be updated below
		}

		// Include PDF conversion status (WITHOUT URL for security)
		if file.PDFConversionInfo != nil {
			protoFile.PdfConversionStatus = stringToProtoConversionStatus(file.PDFConversionInfo.Status)
		}

		// If deletion info exists, set IsDeleted = true
		if _, ok := result.DeletionInfo[file.ID.String()]; ok {
			protoFile.IsDeleted = true
		}

		response.Files[i] = protoFile
	}

	for id, info := range result.DeletionInfo {
		response.DeletionInfo[id] = &rpcv1.FileDeletionInfo{
			DeletedAt:             timestamppb.New(info.DeletedAt),
			DeletedByEmployeeId:   info.DeletedByEmployeeID.String(),
			DeletedByEmployeeName: info.DeletedByEmployeeName,
			DeletionReason:        info.DeletionReason,
		}
	}

	slog.DebugContext(ctx, "batch file metadata retrieved",
		"requested_count", len(req.Msg.FileIds))

	return connect.NewResponse(response), nil
}

// ListFiles returns paginated list of files (owner/operator only)
func (s *FileServiceServer) ListFiles(
	ctx context.Context,
	req *connect.Request[rpcv1.ListFilesRequest],
) (*connect.Response[rpcv1.ListFilesResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	// Validate and set defaults
	pageSize := req.Msg.PageSize
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}
	page := req.Msg.Page
	if page <= 0 {
		page = 1
	}

	sortBy := req.Msg.SortBy
	if sortBy == "" {
		sortBy = "updated_at"
	}
	sortOrder := req.Msg.SortOrder
	if sortOrder == "" {
		sortOrder = "desc"
	}

	offset := (page - 1) * pageSize

	slog.DebugContext(ctx, "ListFiles RPC called",
		"organization_id", orgID,
		"upload_context", req.Msg.UploadContext,
		"sort_by", sortBy,
		"sort_order", sortOrder,
		"page", page,
		"page_size", pageSize)

	// Query files via logic
	var files []*database.FilesFileMetadatum
	var totalCount int64
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		files, totalCount, txErr = s.logic.ListFiles(ctx, tx, ListFilesParams{
			OrganizationID: orgID,
			UploadContext:  req.Msg.UploadContext,
			SortBy:         sortBy,
			SortOrder:      sortOrder,
			Limit:          pageSize,
			Offset:         offset,
		})
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list files", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("list files: %w", err))
	}

	// Convert to proto
	protoFiles := make([]*rpcv1.FileMetadata, len(files))
	for i, file := range files {
		protoFiles[i] = &rpcv1.FileMetadata{
			Id:                   file.ID.String(),
			OriginalFilename:     file.OriginalFilename,
			SizeBytes:            file.SizeBytes,
			MimeType:             file.MimeType,
			UploadContext:        file.UploadContext,
			UploadedByEmployeeId: file.UploadedByEmployeeID.String(),
			UploadedAt:           timestamppb.New(file.UpdatedAt.Time),
			IsDeleted:            file.IsDeleted,
		}
	}

	return connect.NewResponse(&rpcv1.ListFilesResponse{
		Files:      protoFiles,
		TotalCount: int32(totalCount),
		Page:       page,
		PageSize:   pageSize,
	}), nil
}

// DeleteFile soft-deletes file and removes from R2 (owner/operator only)
func (s *FileServiceServer) DeleteFile(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteFileRequest],
) (*connect.Response[rpcv1.DeleteFileResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	fileID, err := uuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "DeleteFile RPC called",
		"file_id", fileID.String(),
		"organization_id", orgID,
		"employee_id", employeeID,
		"reason", req.Msg.DeletionReason)

	// Call logic
	var reclaimedBytes int64
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		reclaimedBytes, txErr = s.logic.DeleteFile(ctx, tx, orgID, dbuuid.UUID(fileID), employeeID, req.Msg.DeletionReason)
		return txErr
	})

	if err != nil {
		if err == ErrFileNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		slog.ErrorContext(ctx, "failed to delete file", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("delete file: %w", err))
	}

	slog.InfoContext(ctx, "file deleted successfully",
		"file_id", fileID.String(),
		"reclaimed_bytes", reclaimedBytes)

	return connect.NewResponse(&rpcv1.DeleteFileResponse{
		Success:        true,
		ReclaimedBytes: reclaimedBytes,
	}), nil
}

// BatchDeleteFiles deletes multiple files with shared reason (owner/operator only)
func (s *FileServiceServer) BatchDeleteFiles(
	ctx context.Context,
	req *connect.Request[rpcv1.BatchDeleteFilesRequest],
) (*connect.Response[rpcv1.BatchDeleteFilesResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	// Validate batch size
	if len(req.Msg.FileIds) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("no file IDs provided"))
	}
	if len(req.Msg.FileIds) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("cannot delete more than 100 files at once"))
	}

	slog.DebugContext(ctx, "BatchDeleteFiles RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"file_count", len(req.Msg.FileIds),
		"reason", req.Msg.DeletionReason)

	// Process batch deletion via logic
	var result *BatchDeleteResult
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		res, txErr := s.logic.BatchDeleteFiles(ctx, tx, orgID, employeeID, req.Msg.FileIds, req.Msg.DeletionReason)
		result = res
		return txErr
	})

	if err != nil {
		slog.ErrorContext(ctx, "batch delete transaction failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("batch delete: %w", err))
	}

	slog.InfoContext(ctx, "batch delete completed",
		"deleted_count", result.DeletedCount,
		"failed_count", len(result.FailedFileIDs),
		"reclaimed_bytes", result.ReclaimedBytes)

	return connect.NewResponse(&rpcv1.BatchDeleteFilesResponse{
		DeletedCount:   result.DeletedCount,
		ReclaimedBytes: result.ReclaimedBytes,
		FailedFileIds:  result.FailedFileIDs,
	}), nil
}

// GetQuota returns organization storage quota and usage
func (s *FileServiceServer) GetQuota(
	ctx context.Context,
	req *connect.Request[rpcv1.GetQuotaRequest],
) (*connect.Response[rpcv1.GetQuotaResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	slog.DebugContext(ctx, "GetQuota RPC called", "organization_id", orgID)

	// Get or create quota
	var quota *database.FilesFileQuotum
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		quota, txErr = s.queries.GetOrCreateQuota(ctx, tx, &database.GetOrCreateQuotaParams{
			OrganizationID: orgID,
			UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get quota", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("get quota: %w", err))
	}

	// Calculate usage percentage
	var usagePercentage float64
	var isQuotaExceeded bool
	if quota.QuotaBytes.Valid {
		usagePercentage = (float64(quota.CurrentUsageBytes) / float64(quota.QuotaBytes.Int64)) * 100
		isQuotaExceeded = quota.CurrentUsageBytes >= quota.QuotaBytes.Int64
	} else {
		usagePercentage = -1 // Unlimited
	}

	// Build proto response
	protoQuota := &rpcv1.QuotaInfo{
		MaxFileSizeBytes:  quota.MaxFileSizeBytes,
		CurrentUsageBytes: quota.CurrentUsageBytes,
		UsagePercentage:   usagePercentage,
		IsQuotaExceeded:   isQuotaExceeded,
	}
	if quota.QuotaBytes.Valid {
		protoQuota.QuotaBytes = &quota.QuotaBytes.Int64
	}

	return connect.NewResponse(&rpcv1.GetQuotaResponse{
		Quota: protoQuota,
	}), nil
}

// UpdateQuota modifies organization storage limits (owner/operator only)
func (s *FileServiceServer) UpdateQuota(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateQuotaRequest],
) (*connect.Response[rpcv1.UpdateQuotaResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	slog.DebugContext(ctx, "UpdateQuota RPC called",
		"organization_id", orgID,
		"quota_bytes", req.Msg.QuotaBytes,
		"max_file_size_bytes", req.Msg.MaxFileSizeBytes)

	// Validate request
	if req.Msg.MaxFileSizeBytes != nil && *req.Msg.MaxFileSizeBytes <= 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("max_file_size_bytes must be positive"))
	}

	// Update quota limits
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		params := &database.UpdateQuotaLimitsParams{
			OrganizationID: orgID,
		}
		if req.Msg.QuotaBytes != nil {
			quotaBytes := pgtype.Int8{Int64: *req.Msg.QuotaBytes, Valid: true}
			params.QuotaBytes = quotaBytes
		}
		if req.Msg.MaxFileSizeBytes != nil {
			maxFileSize := pgtype.Int8{Int64: *req.Msg.MaxFileSizeBytes, Valid: true}
			params.MaxFileSizeBytes = maxFileSize
		}
		return s.queries.UpdateQuotaLimits(ctx, tx, params)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update quota", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("update quota: %w", err))
	}

	// Get updated quota
	var quota *database.FilesFileQuotum
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		quota, txErr = s.queries.GetQuota(ctx, tx, orgID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get updated quota", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("get updated quota: %w", err))
	}

	// Calculate usage percentage
	var usagePercentage float64
	var isQuotaExceeded bool
	if quota.QuotaBytes.Valid {
		usagePercentage = (float64(quota.CurrentUsageBytes) / float64(quota.QuotaBytes.Int64)) * 100
		isQuotaExceeded = quota.CurrentUsageBytes >= quota.QuotaBytes.Int64
	} else {
		usagePercentage = -1
	}

	// Build proto response
	protoQuota := &rpcv1.QuotaInfo{
		MaxFileSizeBytes:  quota.MaxFileSizeBytes,
		CurrentUsageBytes: quota.CurrentUsageBytes,
		UsagePercentage:   usagePercentage,
		IsQuotaExceeded:   isQuotaExceeded,
	}
	if quota.QuotaBytes.Valid {
		protoQuota.QuotaBytes = &quota.QuotaBytes.Int64
	}

	slog.InfoContext(ctx, "quota updated successfully", "organization_id", orgID)

	return connect.NewResponse(&rpcv1.UpdateQuotaResponse{
		Quota: protoQuota,
	}), nil
}

// ============================================================================
// Feature 015: File Storage Security and Access Improvement
// New RPC handlers for validation, access control, search, PDF conversion, indexing
// ============================================================================

// ValidateFile performs file type validation using magic byte detection
func (s *FileServiceServer) ValidateFile(
	ctx context.Context,
	req *connect.Request[rpcv1.ValidateFileRequest],
) (*connect.Response[rpcv1.ValidateFileResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	fileID, err := dbuuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "ValidateFile RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"file_id", fileID)

	// Validate via logic
	var validationResult *rpcv1.FileValidationResult
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		res, txErr := s.logic.ValidateFile(ctx, tx, orgID, employeeID, fileID)
		validationResult = res
		return txErr
	})

	if err != nil {
		if err == ErrFileNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file not found"))
		}
		slog.ErrorContext(ctx, "failed to validate file", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("validate file: %w", err))
	}

	slog.InfoContext(ctx, "file validation completed",
		"file_id", fileID,
		"status", validationResult.Status)

	return connect.NewResponse(&rpcv1.ValidateFileResponse{
		ValidationResult: validationResult,
	}), nil
}

// SetFileAccessRule creates or updates file access control rules
func (s *FileServiceServer) SetFileAccessRule(
	ctx context.Context,
	req *connect.Request[rpcv1.SetFileAccessRuleRequest],
) (*connect.Response[rpcv1.SetFileAccessRuleResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	_, err = dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	// Parse request parameters
	fileID, err := dbuuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	contextID, err := dbuuid.Parse(req.Msg.ContextId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid context ID: %w", err))
	}

	// Convert proto enums to string constants
	contextType := protoContextTypeToString(req.Msg.ContextType)
	if contextType == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid context type"))
	}

	accessScope := protoAccessScopeToString(req.Msg.AccessScope)
	if accessScope == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid access scope"))
	}

	slog.DebugContext(ctx, "SetFileAccessRule RPC called",
		"organization_id", orgID,
		"file_id", fileID,
		"context_type", contextType,
		"access_scope", accessScope)

	// Create access logic if not initialized
	if s.logic == nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("service not properly initialized"))
	}

	// TODO: Verify file exists and user is uploader or org admin
	// For now, just create the access rule

	var rule *database.FilesFileAccessRule
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Create access logic instance (temporary - should be injected)

		accessRule, txErr := s.accessLogic.SetFileAccessRule(ctx, tx, orgID, fileID, contextType, contextID, accessScope)
		rule = accessRule
		return txErr
	})

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file not found"))
		}
		slog.ErrorContext(ctx, "failed to set file access rule", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("set access rule: %w", err))
	}

	slog.InfoContext(ctx, "file access rule created",
		"file_id", fileID,
		"context_type", contextType,
		"access_scope", accessScope)

	return connect.NewResponse(&rpcv1.SetFileAccessRuleResponse{
		AccessRule: &rpcv1.FileAccessRule{
			Id:          rule.ID.String(),
			FileId:      rule.FileID.String(),
			ContextType: stringToProtoContextType(rule.ContextType),
			ContextId:   rule.ContextID.String(),
			AccessScope: stringToProtoAccessScope(rule.AccessScope),
			UpdatedAt:   timestamppb.New(rule.UpdatedAt.Time),
		},
	}), nil
}

// CheckFileAccess verifies if current user can access a specific file
func (s *FileServiceServer) CheckFileAccess(
	ctx context.Context,
	req *connect.Request[rpcv1.CheckFileAccessRequest],
) (*connect.Response[rpcv1.CheckFileAccessResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	fileID, err := dbuuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "CheckFileAccess RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"file_id", fileID)

	var result *AccessCheckResult
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Create access logic instance (temporary - should be injected)

		checkResult, txErr := s.accessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)
		result = checkResult
		return txErr
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to check file access", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("check access: %w", err))
	}

	var protoAccessRule *rpcv1.FileAccessRule
	if result.HasAccess && result.AccessRule != nil {
		protoAccessRule = &rpcv1.FileAccessRule{
			Id:          result.AccessRule.ID.String(),
			FileId:      result.AccessRule.FileID.String(),
			ContextType: stringToProtoContextType(result.AccessRule.ContextType),
			ContextId:   result.AccessRule.ContextID.String(),
			AccessScope: stringToProtoAccessScope(result.AccessRule.AccessScope),
			UpdatedAt:   timestamppb.New(result.AccessRule.UpdatedAt.Time),
		}
	}

	slog.InfoContext(ctx, "file access check completed",
		"file_id", fileID,
		"has_access", result.HasAccess)

	return connect.NewResponse(&rpcv1.CheckFileAccessResponse{
		HasAccess:    result.HasAccess,
		DenialReason: result.DenialReason,
		AccessRule:   protoAccessRule,
	}), nil
}

// SearchFiles performs full-text search across file names and indexed content
func (s *FileServiceServer) SearchFiles(
	ctx context.Context,
	req *connect.Request[rpcv1.SearchFilesRequest],
) (*connect.Response[rpcv1.SearchFilesResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	// Validate request
	if req.Msg.Query == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("query is required"))
	}

	limit := req.Msg.Limit
	if limit <= 0 {
		limit = 50 // Default
	}
	if limit > 100 {
		limit = 100 // Max
	}

	slog.DebugContext(ctx, "SearchFiles RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"query", req.Msg.Query,
		"limit", limit)

	var results []SearchResult
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Create search logic instance (temporary - should be injected)

		searchResults, txErr := s.searchLogic.SearchFiles(ctx, tx, orgID, employeeID, req.Msg.Query, limit)
		results = searchResults
		return txErr
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to search files", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("search files: %w", err))
	}

	// Convert results to proto
	protoResults := make([]*rpcv1.FileSearchResult, len(results))
	for i, result := range results {
		protoResults[i] = &rpcv1.FileSearchResult{
			FileId:             result.FileID.String(),
			Filename:           result.OriginalFilename,
			SizeBytes:          result.SizeBytes,
			MimeType:           result.MimeType,
			ValidationStatus:   rpcv1.ValidationStatus_VALIDATION_STATUS_VERIFIED, // TODO: get from file metadata
			ContextType:        stringToProtoContextType(result.ContextType),
			ContextId:          result.ContextID.String(),
			ContextDisplayName: "", // TODO: resolve display name
			RelevanceScore:     result.Score,
			Excerpt:            "", // TODO: extract excerpt from content
		}
	}

	hasMore := len(results) >= int(limit)
	totalCount := len(results) // Simplified - actual total would require separate count query

	slog.InfoContext(ctx, "file search completed",
		"result_count", len(results),
		"has_more", hasMore)

	return connect.NewResponse(&rpcv1.SearchFilesResponse{
		Results:    protoResults,
		TotalCount: int32(totalCount),
		HasMore:    hasMore,
	}), nil
}

// GetPDFConversionStatus checks PDF conversion status for an office document
func (s *FileServiceServer) GetPDFConversionStatus(
	ctx context.Context,
	req *connect.Request[rpcv1.GetPDFConversionStatusRequest],
) (*connect.Response[rpcv1.GetPDFConversionStatusResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	fileID, err := dbuuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "GetPDFConversionStatus RPC called",
		"organization_id", orgID,
		"file_id", fileID)

	// Extract employee ID for access check
	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	var conversion *PDFConversion
	var fileMetadata *database.FilesFileMetadatum
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Get file metadata first
		meta, txErr := s.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
			OrganizationID: orgID,
			ID:             fileID,
		})
		if txErr != nil {
			return txErr
		}
		fileMetadata = meta

		// SECURITY: Check file access before exposing PDF URL
		accessResult, txErr := s.logic.(*fileLogic).accessLogic.CheckFileAccess(ctx, tx, orgID, employeeID, fileID)
		if txErr != nil {
			return txErr
		}
		if !accessResult.HasAccess {
			return fmt.Errorf("access denied: %s", accessResult.DenialReason)
		}

		// Get conversion status after access check
		conv, txErr := s.pdfLogic.GetPDFConversionStatus(ctx, tx, orgID, fileID)
		if txErr != nil && !errors.Is(txErr, ErrConversionNotFound) {
			return txErr
		}
		conversion = conv
		return nil
	})

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file not found"))
		}
		slog.ErrorContext(ctx, "failed to get PDF conversion status", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("get conversion status: %w", err))
	}

	// Check if file is convertible
	isConvertible := s.pdfLogic.IsConvertible(fileMetadata.MimeType)

	var conversionInfo *rpcv1.PDFConversionInfo

	if conversion != nil {
		// Conversion exists
		var pdfUrl string
		if conversion.ConversionStatus == ConversionStatusCompleted {
			// Generate presigned URL for PDF
			url, urlErr := s.pdfLogic.GetPDFDownloadUrl(ctx, conversion.PDFStorageKey)
			if urlErr != nil {
				slog.WarnContext(ctx, "failed to generate PDF download URL", "error", urlErr)
			} else {
				pdfUrl = url
			}
		}

		var protoStatus rpcv1.ConversionStatus
		switch conversion.ConversionStatus {
		case ConversionStatusPending:
			protoStatus = rpcv1.ConversionStatus_CONVERSION_STATUS_PENDING
		case ConversionStatusInProgress:
			protoStatus = rpcv1.ConversionStatus_CONVERSION_STATUS_IN_PROGRESS
		case ConversionStatusCompleted:
			protoStatus = rpcv1.ConversionStatus_CONVERSION_STATUS_COMPLETED
		case ConversionStatusFailed:
			protoStatus = rpcv1.ConversionStatus_CONVERSION_STATUS_FAILED
		default:
			protoStatus = rpcv1.ConversionStatus_CONVERSION_STATUS_UNSPECIFIED
		}

		conversionInfo = &rpcv1.PDFConversionInfo{
			ConversionId:   conversion.ID.String(),
			OriginalFileId: fileID.String(),
			Status:         protoStatus,
			PdfDownloadUrl: pdfUrl,
			PdfSizeBytes:   conversion.PDFSizeBytes,
			ErrorMessage:   conversion.ConversionError,
			DurationMs:     conversion.ConversionDurationMs,
			UpdatedAt:      nil, // No timestamp in PDFConversion struct
		}
	} else {
		// No conversion record
		conversionInfo = &rpcv1.PDFConversionInfo{
			ConversionId:   "",
			OriginalFileId: fileID.String(),
			Status:         rpcv1.ConversionStatus_CONVERSION_STATUS_UNSPECIFIED,
		}
	}

	slog.InfoContext(ctx, "PDF conversion status retrieved",
		"file_id", fileID,
		"status", conversionInfo.Status,
		"is_convertible", isConvertible)

	return connect.NewResponse(&rpcv1.GetPDFConversionStatusResponse{
		ConversionInfo: conversionInfo,
	}), nil
}

// TriggerPDFConversion manually triggers PDF conversion for an office document
func (s *FileServiceServer) TriggerPDFConversion(
	ctx context.Context,
	req *connect.Request[rpcv1.TriggerPDFConversionRequest],
) (*connect.Response[rpcv1.TriggerPDFConversionResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found"))
	}
	_, err = dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	fileID, err := dbuuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "TriggerPDFConversion RPC called",
		"organization_id", orgID,
		"file_id", fileID)

	var conversionInfo *rpcv1.PDFConversionInfo
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Get file metadata to check if convertible
		fileMetadata, txErr := s.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
			OrganizationID: orgID,
			ID:             fileID,
		})
		if txErr != nil {
			return txErr
		}

		// Check if file is convertible
		if !s.pdfLogic.IsConvertible(fileMetadata.MimeType) {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("file type not convertible to PDF"))
		}

		// Size guardrail (tests expect large files to be rejected)
		if fileMetadata.SizeBytes > 50*1024*1024 {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("file too large for conversion"))
		}

		// Create or reuse conversion record to pending status
		storageKey := fmt.Sprintf("org-%s/conversions/%s.pdf", orgID.String(), fileID.String())
		conversion, txErr := s.pdfLogic.GetPDFConversionStatus(ctx, tx, orgID, fileID)
		if txErr != nil {
			if txErr != ErrConversionNotFound {
				return txErr
			}
			conversion, txErr = s.pdfLogic.CreatePDFConversion(ctx, tx, orgID, fileID, storageKey, 0, ConversionStatusPending)
			if txErr != nil {
				return txErr
			}
		}

		conversionInfo = &rpcv1.PDFConversionInfo{
			ConversionId:   conversion.ID.String(),
			OriginalFileId: fileID.String(),
			Status:         rpcv1.ConversionStatus_CONVERSION_STATUS_PENDING,
		}

		pgxTx, ok := tx.(pgx.Tx)
		if !ok {
			return fmt.Errorf("internal error: expected pgx.Tx for workflow enqueue")
		}
		if s.postProcess == nil {
			return fmt.Errorf("postprocessing workflow not configured")
		}

		_, enqueueErr := flows.BeginTx(ctx, s.flowsClient, pgxTx, s.postProcess, &FilePostProcessingWorkflowInput{
			OrganizationID: orgID,
			FileID:         fileID,
			StorageKey:     fileMetadata.StorageKey,
			MimeType:       fileMetadata.MimeType,
		})
		if enqueueErr != nil {
			return fmt.Errorf("failed to enqueue postprocessing workflow: %w", enqueueErr)
		}

		return nil
	})

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("file not found"))
		}
		slog.ErrorContext(ctx, "failed to trigger PDF conversion", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("trigger conversion: %w", err))
	}

	slog.InfoContext(ctx, "PDF conversion triggered",
		"file_id", fileID)

	return connect.NewResponse(&rpcv1.TriggerPDFConversionResponse{
		ConversionInfo: conversionInfo,
	}), nil
}

// GetContentIndexStatus checks content extraction and indexing status
func (s *FileServiceServer) GetContentIndexStatus(
	ctx context.Context,
	req *connect.Request[rpcv1.GetContentIndexStatusRequest],
) (*connect.Response[rpcv1.GetContentIndexStatusResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	fileID, err := dbuuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "GetContentIndexStatus RPC called",
		"organization_id", orgID,
		"file_id", fileID)

	var indexStatus *ContentIndex
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Create index logic instance (temporary - should be injected)

		status, txErr := s.indexLogic.GetContentIndexStatus(ctx, tx, orgID, fileID)
		indexStatus = status
		return txErr
	})

	var indexInfo *rpcv1.ContentIndexInfo

	if err != nil {
		if err == pgx.ErrNoRows {
			// No index record exists
			indexInfo = &rpcv1.ContentIndexInfo{
				IndexId:          "",
				FileId:           fileID.String(),
				Status:           rpcv1.IndexingStatus_INDEXING_STATUS_UNSPECIFIED,
				ExtractionMethod: rpcv1.ExtractionMethod_EXTRACTION_METHOD_UNSPECIFIED,
			}

			return connect.NewResponse(&rpcv1.GetContentIndexStatusResponse{
				IndexInfo: indexInfo,
			}), nil
		}
		slog.ErrorContext(ctx, "failed to get content index status", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("get index status: %w", err))
	}

	// Convert status to proto enum
	var protoStatus rpcv1.IndexingStatus
	switch indexStatus.IndexingStatus {
	case IndexingStatusPending:
		protoStatus = rpcv1.IndexingStatus_INDEXING_STATUS_PENDING
	case IndexingStatusInProgress:
		protoStatus = rpcv1.IndexingStatus_INDEXING_STATUS_IN_PROGRESS
	case IndexingStatusCompleted:
		protoStatus = rpcv1.IndexingStatus_INDEXING_STATUS_COMPLETED
	case IndexingStatusFailed:
		protoStatus = rpcv1.IndexingStatus_INDEXING_STATUS_FAILED
	default:
		protoStatus = rpcv1.IndexingStatus_INDEXING_STATUS_UNSPECIFIED
	}

	// Convert extraction method to proto enum
	var protoMethod rpcv1.ExtractionMethod
	switch indexStatus.ExtractionMethod {
	case ExtractionMethodOfficeParser:
		protoMethod = rpcv1.ExtractionMethod_EXTRACTION_METHOD_OFFICE_PARSER
	case ExtractionMethodPDFParser:
		protoMethod = rpcv1.ExtractionMethod_EXTRACTION_METHOD_PDF_PARSER
	case ExtractionMethodImageOCR:
		protoMethod = rpcv1.ExtractionMethod_EXTRACTION_METHOD_IMAGE_OCR
	case ExtractionMethodPlainText:
		protoMethod = rpcv1.ExtractionMethod_EXTRACTION_METHOD_PLAIN_TEXT
	default:
		protoMethod = rpcv1.ExtractionMethod_EXTRACTION_METHOD_UNSPECIFIED
	}

	indexInfo = &rpcv1.ContentIndexInfo{
		IndexId:          indexStatus.ID.String(),
		FileId:           fileID.String(),
		Status:           protoStatus,
		ExtractionMethod: protoMethod,
		ErrorMessage:     indexStatus.IndexingError,
		DurationMs:       indexStatus.IndexingDurationMs,
		TextLength:       int32(len(indexStatus.ExtractedText)),
		UpdatedAt:        nil, // No timestamp in ContentIndex struct
	}

	slog.InfoContext(ctx, "content index status retrieved",
		"file_id", fileID,
		"status", protoStatus)

	return connect.NewResponse(&rpcv1.GetContentIndexStatusResponse{
		IndexInfo: indexInfo,
	}), nil
}

// Helper functions to convert between proto enums and string constants

func protoContextTypeToString(contextType rpcv1.FileContextType) string {
	switch contextType {
	case rpcv1.FileContextType_FILE_CONTEXT_TYPE_CHAT_CHANNEL:
		return ContextTypeChatChannel
	case rpcv1.FileContextType_FILE_CONTEXT_TYPE_PROJECT:
		return ContextTypeProject
	case rpcv1.FileContextType_FILE_CONTEXT_TYPE_DEPARTMENT_DOCS:
		return ContextTypeDepartmentDocs
	case rpcv1.FileContextType_FILE_CONTEXT_TYPE_CALENDAR_EVENT:
		return ContextTypeCalendarEvent
	case rpcv1.FileContextType_FILE_CONTEXT_TYPE_SUPPORT_TICKET:
		return ContextTypeSupportTicket
	case rpcv1.FileContextType_FILE_CONTEXT_TYPE_CRM_DEAL:
		return ContextTypeCRMDeal
	default:
		return ""
	}
}

func stringToProtoContextType(contextType string) rpcv1.FileContextType {
	switch contextType {
	case ContextTypeChatChannel:
		return rpcv1.FileContextType_FILE_CONTEXT_TYPE_CHAT_CHANNEL
	case ContextTypeProject:
		return rpcv1.FileContextType_FILE_CONTEXT_TYPE_PROJECT
	case ContextTypeDepartmentDocs:
		return rpcv1.FileContextType_FILE_CONTEXT_TYPE_DEPARTMENT_DOCS
	case ContextTypeCalendarEvent:
		return rpcv1.FileContextType_FILE_CONTEXT_TYPE_CALENDAR_EVENT
	case ContextTypeSupportTicket:
		return rpcv1.FileContextType_FILE_CONTEXT_TYPE_SUPPORT_TICKET
	case ContextTypeCRMDeal:
		return rpcv1.FileContextType_FILE_CONTEXT_TYPE_CRM_DEAL
	default:
		return rpcv1.FileContextType_FILE_CONTEXT_TYPE_UNSPECIFIED
	}
}

func protoAccessScopeToString(scope rpcv1.FileAccessScope) string {
	switch scope {
	case rpcv1.FileAccessScope_FILE_ACCESS_SCOPE_PUBLIC:
		return AccessScopePublic
	case rpcv1.FileAccessScope_FILE_ACCESS_SCOPE_PRIVATE:
		return AccessScopePrivate
	case rpcv1.FileAccessScope_FILE_ACCESS_SCOPE_DEPARTMENT:
		return AccessScopeDepartment
	default:
		return ""
	}
}

func stringToProtoAccessScope(scope string) rpcv1.FileAccessScope {
	switch scope {
	case AccessScopePublic:
		return rpcv1.FileAccessScope_FILE_ACCESS_SCOPE_PUBLIC
	case AccessScopePrivate:
		return rpcv1.FileAccessScope_FILE_ACCESS_SCOPE_PRIVATE
	case AccessScopeDepartment:
		return rpcv1.FileAccessScope_FILE_ACCESS_SCOPE_DEPARTMENT
	default:
		return rpcv1.FileAccessScope_FILE_ACCESS_SCOPE_UNSPECIFIED
	}
}

func stringToProtoConversionStatus(status string) rpcv1.ConversionStatus {
	switch status {
	case ConversionStatusPending:
		return rpcv1.ConversionStatus_CONVERSION_STATUS_PENDING
	case ConversionStatusInProgress:
		return rpcv1.ConversionStatus_CONVERSION_STATUS_IN_PROGRESS
	case ConversionStatusCompleted:
		return rpcv1.ConversionStatus_CONVERSION_STATUS_COMPLETED
	case ConversionStatusFailed:
		return rpcv1.ConversionStatus_CONVERSION_STATUS_FAILED
	default:
		return rpcv1.ConversionStatus_CONVERSION_STATUS_UNSPECIFIED
	}
}
