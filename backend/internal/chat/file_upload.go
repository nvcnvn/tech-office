package chat

import (
	"context"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// RequestChannelFileUpload generates presigned R2 upload URL for chat attachment.
// SECURITY: Verifies channel membership and derives access scope from channel privacy.
// ARCHITECTURE: Domain-owned upload flow - ChatService owns the security boundary.
func (s *ChatServiceConnect) RequestChannelFileUpload(
	ctx context.Context,
	req *connect.Request[rpcv1.RequestChannelFileUploadRequest],
) (*connect.Response[rpcv1.RequestChannelFileUploadResponse], error) {
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

	// Parse channel ID
	channelID, err := uuid.Parse(req.Msg.ChannelId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid channel ID: %w", err))
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

	slog.DebugContext(ctx, "RequestChannelFileUpload RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"channel_id", channelID,
		"filename", req.Msg.Filename,
		"size_bytes", req.Msg.SizeBytes)

	// SECURITY: Verify channel membership and generate upload URL in single transaction
	var uploadResult *files.UploadURLResult
	var derivedAccessScope string
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// CRITICAL: Verify channel exists and user is member
		_, txErr := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			OrganizationID: orgID,
			ChannelID:      dbuuid.UUID(channelID),
			EmployeeID:     employeeID,
		})
		if txErr != nil {
			if txErr == pgx.ErrNoRows {
				return connect.NewError(connect.CodePermissionDenied,
					fmt.Errorf("you are not a member of this channel"))
			}
			return txErr
		}

		// Get channel to determine access scope
		channel, txErr := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
			OrganizationID: orgID,
			ID:             dbuuid.UUID(channelID),
		})
		if txErr != nil {
			return txErr
		}

		// SECURITY: Derive access scope from channel properties (server-side, not client-controlled)
		if channel.IsPrivate {
			derivedAccessScope = files.AccessScopePrivate
		} else {
			derivedAccessScope = files.AccessScopePublic
		}

		slog.DebugContext(ctx, "channel membership verified",
			"channel_id", channelID,
			"is_private", channel.IsPrivate,
			"derived_access_scope", derivedAccessScope)

		// Generate upload URL via FileLogic (internal call, not RPC)
		// This avoids circular dependency: Chat → FileLogic (not File → Chat → File)
		result, txErr := s.FileLogic.RequestUpload(ctx, tx, files.RequestUploadParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			Filename:       req.Msg.Filename,
			MimeType:       req.Msg.MimeType,
			SizeBytes:      req.Msg.SizeBytes,
			UploadContext:  files.UploadContextChat,
		})
		if txErr != nil {
			return txErr
		}
		uploadResult = result

		// Create access rule linking file to channel
		txErr = s.FileLogic.CreateAccessRule(ctx, tx, files.CreateAccessRuleParams{
			OrganizationID: orgID,
			FileID:         result.FileID,
			ContextType:    files.ContextTypeChatChannel,
			ContextID:      dbuuid.UUID(channelID),
			AccessScope:    derivedAccessScope,
		})
		if txErr != nil {
			return txErr
		}

		return nil
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to request channel file upload", "error", err)
		// Return the error directly if it's already a connect.Error (preserves CodePermissionDenied)
		if connectErr, ok := err.(*connect.Error); ok {
			return nil, connectErr
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("request upload: %w", err))
	}

	slog.InfoContext(ctx, "channel file upload URL generated",
		"file_id", uploadResult.FileID,
		"channel_id", channelID,
		"access_scope", derivedAccessScope,
		"expires_at", uploadResult.ExpiresAt)

	return connect.NewResponse(&rpcv1.RequestChannelFileUploadResponse{
		FileId:    uploadResult.FileID.String(),
		UploadUrl: uploadResult.UploadURL,
		ExpiresAt: timestamppb.New(uploadResult.ExpiresAt),
	}), nil
}

// ConfirmChannelFileUpload finalizes upload after client uploads to R2.
// SECURITY: Verifies channel membership again to prevent race conditions.
// ARCHITECTURE: Triggers async workflows for validation, PDF conversion, indexing.
func (s *ChatServiceConnect) ConfirmChannelFileUpload(
	ctx context.Context,
	req *connect.Request[rpcv1.ConfirmChannelFileUploadRequest],
) (*connect.Response[rpcv1.ConfirmChannelFileUploadResponse], error) {
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
	channelID, err := uuid.Parse(req.Msg.ChannelId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid channel ID: %w", err))
	}

	fileID, err := uuid.Parse(req.Msg.FileId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file ID: %w", err))
	}

	slog.DebugContext(ctx, "ConfirmChannelFileUpload RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"channel_id", channelID,
		"file_id", fileID)

	// SECURITY: Verify channel membership again and confirm upload in single transaction
	// Enqueue post-processing workflow in same transaction for atomicity
	var fileMetadata *files.FileMetadata
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		// CRITICAL: Verify channel membership again (prevent race condition)
		_, txErr := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			OrganizationID: orgID,
			ChannelID:      dbuuid.UUID(channelID),
			EmployeeID:     employeeID,
		})
		if txErr != nil {
			if txErr == pgx.ErrNoRows {
				return connect.NewError(connect.CodePermissionDenied,
					fmt.Errorf("you are not a member of this channel"))
			}
			return txErr
		}

		// Confirm upload via FileLogic
		metadata, txErr := s.FileLogic.ConfirmUpload(ctx, tx, files.ConfirmUploadParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			FileID:         dbuuid.UUID(fileID),
		})
		if txErr != nil {
			return txErr
		}
		fileMetadata = metadata

		// Trigger async workflows for file post-processing (PDF conversion, content indexing)
		// Enqueue within same transaction for atomicity (workflow runs after commit)
		if s.PostProcess != nil {
			pgxTx, ok := tx.(pgx.Tx)
			if !ok {
				return fmt.Errorf("internal error: expected pgx.Tx for workflow enqueue")
			}

			_, enqueueErr := flows.BeginTx(ctx, s.FlowsClient, pgxTx, s.PostProcess, &files.FilePostProcessingWorkflowInput{
				OrganizationID: orgID,
				FileID:         dbuuid.UUID(fileID),
				StorageKey:     metadata.StorageKey,
				MimeType:       metadata.MimeType,
			})
			if enqueueErr != nil {
				slog.WarnContext(ctx, "failed to enqueue post-processing workflow",
					"error", enqueueErr,
					"file_id", fileID)
				// Don't fail the upload - post-processing is optional enhancement
				// User can manually trigger conversion later via TriggerPDFConversion RPC
			} else {
				slog.InfoContext(ctx, "post-processing workflow enqueued",
					"file_id", fileID,
					"mime_type", metadata.MimeType)
			}
		}

		return nil
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to confirm channel file upload", "error", err)
		// Return the error directly if it's already a connect.Error
		if connectErr, ok := err.(*connect.Error); ok {
			return nil, connectErr
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("confirm upload: %w", err))
	}

	slog.InfoContext(ctx, "channel file upload confirmed",
		"file_id", fileID,
		"channel_id", channelID,
		"filename", fileMetadata.Filename,
		"size_bytes", fileMetadata.SizeBytes)

	return connect.NewResponse(&rpcv1.ConfirmChannelFileUploadResponse{
		File: &rpcv1.FileMetadata{
			Id:                   fileMetadata.ID.String(),
			OriginalFilename:     fileMetadata.Filename,
			StorageKey:           fileMetadata.StorageKey,
			SizeBytes:            fileMetadata.SizeBytes,
			MimeType:             fileMetadata.MimeType,
			ValidationStatus:     fileMetadata.ValidationStatus,
			ValidationMessage:    "", // Not yet validated
			DetectedMimeType:     "", // Not yet validated
			UploadContext:        fileMetadata.UploadContext,
			UploadedByEmployeeId: fileMetadata.UploadedBy.String(),
			IsDeleted:            false,
			UpdatedAt:            timestamppb.New(fileMetadata.UpdatedAt),
		},
	}), nil
}
