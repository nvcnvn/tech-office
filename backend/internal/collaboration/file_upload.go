package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// RequestTaskFileUpload generates presigned R2 upload URL for task attachment.
// SECURITY: Verifies project membership and derives access scope from project visibility.
// ARCHITECTURE: Domain-owned upload flow - CollaborationService owns the security boundary.
func (s *CollaborationServiceConnect) RequestTaskFileUpload(
	ctx context.Context,
	req *connect.Request[rpcv1.RequestTaskFileUploadRequest],
) (*connect.Response[rpcv1.RequestTaskFileUploadResponse], error) {
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

	// Parse task ID
	taskID, err := dbuuid.Parse(req.Msg.TaskId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid task ID: %w", err))
	}

	// Validate upload parameters
	if req.Msg.Filename == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("filename is required"))
	}
	if req.Msg.MimeType == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("mime_type is required"))
	}
	if req.Msg.SizeBytes <= 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("size_bytes must be positive"))
	}

	slog.DebugContext(ctx, "RequestTaskFileUpload RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"task_id", taskID,
		"filename", req.Msg.Filename,
		"size_bytes", req.Msg.SizeBytes)

	// SECURITY: Verify project membership and generate upload URL in single transaction
	var uploadResult *files.UploadURLResult
	var derivedAccessScope string
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Get task to find project
		task, txErr := s.Queries.GetTask(ctx, tx, &database.GetTaskParams{
			OrganizationID: orgID,
			ID:             taskID,
		})
		if txErr != nil {
			if txErr == pgx.ErrNoRows {
				return connect.NewError(connect.CodeNotFound, fmt.Errorf("task not found"))
			}
			return txErr
		}

		// Get project to verify membership and determine access scope
		project, txErr := s.Queries.GetProject(ctx, tx, &database.GetProjectParams{
			OrganizationID: orgID,
			ID:             task.ProjectID,
		})
		if txErr != nil {
			return txErr
		}

		// CRITICAL: Verify project membership
		// For public projects, all org members can upload
		// For private projects, check explicit membership
		if project.Visibility == ProjectVisibilityPrivate {
			_, txErr = s.Queries.GetProjectMembership(ctx, tx, &database.GetProjectMembershipParams{
				OrganizationID: orgID,
				ProjectID:      project.ID,
				EmployeeID:     employeeID,
			})
			if txErr != nil {
				if txErr == pgx.ErrNoRows {
					return connect.NewError(connect.CodePermissionDenied,
						fmt.Errorf("you are not a member of this project"))
				}
				return txErr
			}
		}

		// SECURITY: Derive access scope from project visibility (server-side, not client-controlled)
		if project.Visibility == ProjectVisibilityPrivate {
			derivedAccessScope = files.AccessScopePrivate
		} else {
			derivedAccessScope = files.AccessScopePublic
		}

		slog.DebugContext(ctx, "project membership verified",
			"task_id", taskID,
			"project_id", project.ID,
			"visibility", project.Visibility,
			"derived_access_scope", derivedAccessScope)

		// Generate upload URL via FileLogic (internal call, not RPC)
		result, txErr := s.FileLogic.RequestUpload(ctx, tx, files.RequestUploadParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			Filename:       req.Msg.Filename,
			MimeType:       req.Msg.MimeType,
			SizeBytes:      req.Msg.SizeBytes,
			UploadContext:  files.UploadContextProject,
		})
		if txErr != nil {
			return txErr
		}
		uploadResult = result

		// Create access rule linking file to task's project
		txErr = s.FileLogic.CreateAccessRule(ctx, tx, files.CreateAccessRuleParams{
			OrganizationID: orgID,
			FileID:         result.FileID,
			ContextType:    files.ContextTypeProject,
			ContextID:      task.ProjectID,
			AccessScope:    derivedAccessScope,
		})
		if txErr != nil {
			return txErr
		}

		return nil
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to request task file upload", "error", err)
		// Return the error directly if it's already a connect.Error (preserves CodePermissionDenied)
		if connectErr, ok := err.(*connect.Error); ok {
			return nil, connectErr
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("request upload: %w", err))
	}

	slog.InfoContext(ctx, "task file upload URL generated",
		"file_id", uploadResult.FileID,
		"task_id", taskID,
		"access_scope", derivedAccessScope,
		"expires_at", uploadResult.ExpiresAt)

	return connect.NewResponse(&rpcv1.RequestTaskFileUploadResponse{
		FileId:    uploadResult.FileID.String(),
		UploadUrl: uploadResult.UploadURL,
		ExpiresAt: timestamppb.New(uploadResult.ExpiresAt),
	}), nil
}

// ConfirmTaskFileUpload finalizes upload after client uploads to R2.
// SECURITY: Verifies project membership again to prevent race conditions.
// ARCHITECTURE: Adds file to task's file_ids array and triggers async workflows.
func (s *CollaborationServiceConnect) ConfirmTaskFileUpload(
	ctx context.Context,
	req *connect.Request[rpcv1.ConfirmTaskFileUploadRequest],
) (*connect.Response[rpcv1.ConfirmTaskFileUploadResponse], error) {
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

	// Parse parameters
	taskID, err := dbuuid.Parse(req.Msg.TaskId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid task ID: %w", err))
	}

	fileID, err := dbuuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "ConfirmTaskFileUpload RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"task_id", taskID,
		"file_id", fileID)

	// SECURITY: Verify project membership again and confirm upload in single transaction
	var fileMetadata *files.FileMetadata
	var updatedTask *database.CollaborationTask
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Get task to find project
		task, txErr := s.Queries.GetTask(ctx, tx, &database.GetTaskParams{
			OrganizationID: orgID,
			ID:             taskID,
		})
		if txErr != nil {
			if txErr == pgx.ErrNoRows {
				return connect.NewError(connect.CodeNotFound, fmt.Errorf("task not found"))
			}
			return txErr
		}

		// Get project to verify membership
		project, txErr := s.Queries.GetProject(ctx, tx, &database.GetProjectParams{
			OrganizationID: orgID,
			ID:             task.ProjectID,
		})
		if txErr != nil {
			return txErr
		}

		// CRITICAL: Verify project membership again (prevent race condition)
		if project.Visibility == ProjectVisibilityPrivate {
			_, txErr = s.Queries.GetProjectMembership(ctx, tx, &database.GetProjectMembershipParams{
				OrganizationID: orgID,
				ProjectID:      project.ID,
				EmployeeID:     employeeID,
			})
			if txErr != nil {
				if txErr == pgx.ErrNoRows {
					return connect.NewError(connect.CodePermissionDenied,
						fmt.Errorf("you are not a member of this project"))
				}
				return txErr
			}
		}

		// Confirm upload via FileLogic
		metadata, txErr := s.FileLogic.ConfirmUpload(ctx, tx, files.ConfirmUploadParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			FileID:         fileID,
		})
		if txErr != nil {
			return txErr
		}
		fileMetadata = metadata

		// Append file to task's file_ids array
		now := time.Now()
		resultTask, txErr := s.Queries.AppendTaskFileID(ctx, tx, &database.AppendTaskFileIDParams{
			OrganizationID: orgID,
			TaskID:         taskID,
			FileID:         fileID,
			UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		})
		if txErr != nil {
			return txErr
		}
		updatedTask = resultTask

		// Trigger async workflows for file post-processing (PDF conversion, content indexing)
		if s.PostProcess != nil {
			pgxTx, ok := tx.(pgx.Tx)
			if !ok {
				return fmt.Errorf("internal error: expected pgx.Tx for workflow enqueue")
			}

			_, enqueueErr := flows.BeginTx(ctx, s.FlowsClient, pgxTx, s.PostProcess, &files.FilePostProcessingWorkflowInput{
				OrganizationID: orgID,
				FileID:         fileID,
				StorageKey:     metadata.StorageKey,
				MimeType:       metadata.MimeType,
			})
			if enqueueErr != nil {
				slog.WarnContext(ctx, "failed to enqueue post-processing workflow",
					"error", enqueueErr,
					"file_id", fileID)
				// Don't fail the upload - post-processing is optional enhancement
			} else {
				slog.InfoContext(ctx, "post-processing workflow enqueued",
					"file_id", fileID,
					"mime_type", metadata.MimeType)
			}
		}

		return nil
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to confirm task file upload", "error", err)
		// Return the error directly if it's already a connect.Error
		if connectErr, ok := err.(*connect.Error); ok {
			return nil, connectErr
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("confirm upload: %w", err))
	}

	slog.InfoContext(ctx, "task file upload confirmed",
		"file_id", fileID,
		"task_id", taskID,
		"filename", fileMetadata.Filename,
		"size_bytes", fileMetadata.SizeBytes,
		"total_file_ids", len(updatedTask.FileIds))

	// Convert file_ids to strings for response
	fileIDs := make([]string, len(updatedTask.FileIds))
	for i, fid := range updatedTask.FileIds {
		fileIDs[i] = fid.String()
	}

	return connect.NewResponse(&rpcv1.ConfirmTaskFileUploadResponse{
		File: &rpcv1.FileMetadata{
			Id:                   fileMetadata.ID.String(),
			OriginalFilename:     fileMetadata.Filename,
			StorageKey:           fileMetadata.StorageKey,
			SizeBytes:            fileMetadata.SizeBytes,
			MimeType:             fileMetadata.MimeType,
			ValidationStatus:     fileMetadata.ValidationStatus,
			ValidationMessage:    "",
			DetectedMimeType:     "",
			UploadContext:        fileMetadata.UploadContext,
			UploadedByEmployeeId: fileMetadata.UploadedBy.String(),
			IsDeleted:            false,
			UpdatedAt:            timestamppb.New(fileMetadata.UpdatedAt),
		},
		Task: &rpcv1.Task{
			Id:      updatedTask.ID.String(),
			FileIds: fileIDs,
		},
	}), nil
}

// RequestEvidenceFileUpload generates a presigned R2 upload URL for an evidence file.
// SECURITY: Verifies task existence, evidence requirement validity, and derives access
// scope from project visibility (server-side). Private project evidence is marked private.
// ARCHITECTURE: The caller must subsequently call ConfirmEvidenceFileUpload, then
// SubmitEvidence with the confirmed file_id to create the evidence_submission record.
func (s *CollaborationServiceConnect) RequestEvidenceFileUpload(
	ctx context.Context,
	req *connect.Request[rpcv1.RequestEvidenceFileUploadRequest],
) (*connect.Response[rpcv1.RequestEvidenceFileUploadResponse], error) {
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

	taskID, err := dbuuid.Parse(req.Msg.TaskId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid task_id: %w", err))
	}

	evidenceRequirementID, err := dbuuid.Parse(req.Msg.EvidenceRequirementId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid evidence_requirement_id: %w", err))
	}

	if req.Msg.FileName == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("file_name is required"))
	}
	if req.Msg.ContentType == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("content_type is required"))
	}
	if req.Msg.FileSizeBytes <= 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("file_size_bytes must be positive"))
	}

	slog.DebugContext(ctx, "RequestEvidenceFileUpload RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"task_id", taskID,
		"evidence_requirement_id", evidenceRequirementID,
		"file_name", req.Msg.FileName,
		"file_size_bytes", req.Msg.FileSizeBytes)

	var uploadResult *files.UploadURLResult
	var derivedAccessScope string
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Verify task exists
		task, txErr := s.Queries.GetTask(ctx, tx, &database.GetTaskParams{
			OrganizationID: orgID,
			ID:             taskID,
		})
		if txErr != nil {
			if txErr == pgx.ErrNoRows {
				return connect.NewError(connect.CodeNotFound, fmt.Errorf("task not found"))
			}
			return txErr
		}

		// Get project to verify membership and determine access scope
		project, txErr := s.Queries.GetProject(ctx, tx, &database.GetProjectParams{
			OrganizationID: orgID,
			ID:             task.ProjectID,
		})
		if txErr != nil {
			return txErr
		}

		// CRITICAL: Enforce project membership for private projects
		if project.Visibility == ProjectVisibilityPrivate {
			_, txErr = s.Queries.GetProjectMembership(ctx, tx, &database.GetProjectMembershipParams{
				OrganizationID: orgID,
				ProjectID:      project.ID,
				EmployeeID:     employeeID,
			})
			if txErr != nil {
				if txErr == pgx.ErrNoRows {
					return connect.NewError(connect.CodePermissionDenied,
						fmt.Errorf("you are not a member of this project"))
				}
				return txErr
			}
		}

		// Validate evidence requirement exists in this organisation
		_, txErr = s.Queries.GetEvidenceRequirement(ctx, tx, &database.GetEvidenceRequirementParams{
			OrganizationID: orgID,
			ID:             evidenceRequirementID,
		})
		if txErr != nil {
			if txErr == pgx.ErrNoRows {
				return connect.NewError(connect.CodeNotFound, fmt.Errorf("evidence requirement not found"))
			}
			return txErr
		}

		// SECURITY: Derive access scope server-side from project visibility
		if project.Visibility == ProjectVisibilityPrivate {
			derivedAccessScope = files.AccessScopePrivate
		} else {
			derivedAccessScope = files.AccessScopePublic
		}

		result, txErr := s.FileLogic.RequestUpload(ctx, tx, files.RequestUploadParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			Filename:       req.Msg.FileName,
			MimeType:       req.Msg.ContentType,
			SizeBytes:      req.Msg.FileSizeBytes,
			UploadContext:  files.UploadContextProject,
		})
		if txErr != nil {
			return txErr
		}
		uploadResult = result

		// Create access rule linking evidence file to its project
		txErr = s.FileLogic.CreateAccessRule(ctx, tx, files.CreateAccessRuleParams{
			OrganizationID: orgID,
			FileID:         result.FileID,
			ContextType:    files.ContextTypeProject,
			ContextID:      task.ProjectID,
			AccessScope:    derivedAccessScope,
		})
		if txErr != nil {
			return txErr
		}

		return nil
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to request evidence file upload", "error", err)
		if connectErr, ok := err.(*connect.Error); ok {
			return nil, connectErr
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("request evidence upload: %w", err))
	}

	slog.InfoContext(ctx, "evidence file upload URL generated",
		"file_id", uploadResult.FileID,
		"task_id", taskID,
		"evidence_requirement_id", evidenceRequirementID,
		"access_scope", derivedAccessScope,
		"expires_at", uploadResult.ExpiresAt)

	return connect.NewResponse(&rpcv1.RequestEvidenceFileUploadResponse{
		FileId:    uploadResult.FileID.String(),
		UploadUrl: uploadResult.UploadURL,
	}), nil
}

// ConfirmEvidenceFileUpload marks an evidence file as successfully uploaded to R2.
// SECURITY: Re-verifies project membership to prevent race conditions.
// ARCHITECTURE: After confirmation, the caller should invoke SubmitEvidence with the
// returned file_id and the original evidence_requirement_id to create the
// evidence_submission record.
func (s *CollaborationServiceConnect) ConfirmEvidenceFileUpload(
	ctx context.Context,
	req *connect.Request[rpcv1.ConfirmEvidenceFileUploadRequest],
) (*connect.Response[rpcv1.ConfirmEvidenceFileUploadResponse], error) {
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
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file_id: %w", err))
	}

	taskID, err := dbuuid.Parse(req.Msg.TaskId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid task_id: %w", err))
	}

	slog.DebugContext(ctx, "ConfirmEvidenceFileUpload RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"task_id", taskID,
		"file_id", fileID)

	var confirmedFileID dbuuid.UUID
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// Verify task exists
		task, txErr := s.Queries.GetTask(ctx, tx, &database.GetTaskParams{
			OrganizationID: orgID,
			ID:             taskID,
		})
		if txErr != nil {
			if txErr == pgx.ErrNoRows {
				return connect.NewError(connect.CodeNotFound, fmt.Errorf("task not found"))
			}
			return txErr
		}

		// Get project to re-verify membership (prevent race condition)
		project, txErr := s.Queries.GetProject(ctx, tx, &database.GetProjectParams{
			OrganizationID: orgID,
			ID:             task.ProjectID,
		})
		if txErr != nil {
			return txErr
		}

		// CRITICAL: Re-verify project membership
		if project.Visibility == ProjectVisibilityPrivate {
			_, txErr = s.Queries.GetProjectMembership(ctx, tx, &database.GetProjectMembershipParams{
				OrganizationID: orgID,
				ProjectID:      project.ID,
				EmployeeID:     employeeID,
			})
			if txErr != nil {
				if txErr == pgx.ErrNoRows {
					return connect.NewError(connect.CodePermissionDenied,
						fmt.Errorf("you are not a member of this project"))
				}
				return txErr
			}
		}

		metadata, txErr := s.FileLogic.ConfirmUpload(ctx, tx, files.ConfirmUploadParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			FileID:         fileID,
		})
		if txErr != nil {
			return txErr
		}
		confirmedFileID = metadata.ID

		return nil
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to confirm evidence file upload", "error", err)
		if connectErr, ok := err.(*connect.Error); ok {
			return nil, connectErr
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("confirm evidence upload: %w", err))
	}

	slog.InfoContext(ctx, "evidence file upload confirmed",
		"file_id", confirmedFileID,
		"task_id", taskID)

	return connect.NewResponse(&rpcv1.ConfirmEvidenceFileUploadResponse{
		FileId: confirmedFileID.String(),
	}), nil
}
