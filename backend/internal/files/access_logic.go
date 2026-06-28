package files

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

var (
	// ErrAccessDenied is returned when file access is denied
	ErrAccessDenied = errors.New("access denied")
)

// AccessCheckResult contains the result of file access check
type AccessCheckResult struct {
	HasAccess    bool
	DenialReason string
	AccessRule   *database.FilesFileAccessRule
}

// AccessLogic defines business logic for file access control
// All methods are pool-agnostic and accept tx database.DBTX parameter
type AccessLogic interface {
	// SetFileAccessRule creates or updates file access rule
	SetFileAccessRule(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID, contextType string, contextID dbuuid.UUID, accessScope string) (*database.FilesFileAccessRule, error)

	// CheckFileAccess verifies if employee has access to file
	CheckFileAccess(ctx context.Context, tx database.DBTX, orgID, employeeID, fileID dbuuid.UUID) (*AccessCheckResult, error)

	// GetFilesByContext returns all files in a specific context
	GetFilesByContext(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, contextType string, contextID dbuuid.UUID, limit int32, offset int32) ([]*database.FilesFileMetadatum, error)
}

// accessLogic implements AccessLogic interface
type accessLogic struct {
	queries *database.Queries
}

// NewAccessLogic creates a new AccessLogic instance
func NewAccessLogic(queries *database.Queries) AccessLogic {
	return &accessLogic{
		queries: queries,
	}
}

// SetFileAccessRule creates or updates a file access rule
func (l *accessLogic) SetFileAccessRule(ctx context.Context, tx database.DBTX, orgID, fileID dbuuid.UUID, contextType string, contextID dbuuid.UUID, accessScope string) (*database.FilesFileAccessRule, error) {
	slog.DebugContext(ctx, "AccessLogic.SetFileAccessRule",
		"organization_id", orgID,
		"file_id", fileID,
		"context_type", contextType,
		"context_id", contextID,
		"access_scope", accessScope)

	// Verify file exists
	_, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
		OrganizationID: orgID,
		ID:             fileID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get file",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("file not found: %w", err)
	}

	// Insert or update access rule
	rule, err := l.queries.InsertFileAccessRule(ctx, tx, &database.InsertFileAccessRuleParams{
		OrganizationID: orgID,
		FileID:         fileID,
		ContextType:    contextType,
		ContextID:      contextID,
		AccessScope:    accessScope,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to insert file access rule",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("failed to create access rule: %w", err)
	}

	slog.InfoContext(ctx, "file access rule created/updated",
		"file_id", fileID,
		"context_type", contextType,
		"access_scope", accessScope)

	return rule, nil
}

// CheckFileAccess verifies if employee has access to file based on access rules
func (l *accessLogic) CheckFileAccess(ctx context.Context, tx database.DBTX, orgID, employeeID, fileID dbuuid.UUID) (*AccessCheckResult, error) {
	slog.DebugContext(ctx, "AccessLogic.CheckFileAccess",
		"organization_id", orgID,
		"employee_id", employeeID,
		"file_id", fileID)

	// Get file metadata
	file, err := l.queries.GetFileByID(ctx, tx, &database.GetFileByIDParams{
		OrganizationID: orgID,
		ID:             fileID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get file metadata",
			"error", err,
			"file_id", fileID)
		return &AccessCheckResult{
			HasAccess:    false,
			DenialReason: "File not found",
		}, nil
	}

	// Always allow if employee is the file uploader
	if file.UploadedByEmployeeID == employeeID {
		slog.DebugContext(ctx, "access granted: user is file uploader",
			"employee_id", employeeID,
			"file_id", fileID)
		return &AccessCheckResult{
			HasAccess:    true,
			DenialReason: "",
		}, nil
	}

	// Get file access rule
	accessRule, err := l.queries.GetFileAccessRule(ctx, tx, &database.GetFileAccessRuleParams{
		OrganizationID: orgID,
		FileID:         fileID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No access rule = deny access (files without context shouldn't be accessible except to uploader)
			slog.WarnContext(ctx, "access denied: no access rule found",
				"employee_id", employeeID,
				"file_id", fileID)
			return &AccessCheckResult{
				HasAccess:    false,
				DenialReason: "File has no access rule",
			}, nil
		}
		slog.ErrorContext(ctx, "failed to get file access rule",
			"error", err,
			"file_id", fileID)
		return nil, fmt.Errorf("failed to check file access: %w", err)
	}

	// Check access based on access scope
	switch accessRule.AccessScope {
	case AccessScopePublic:
		// Public: All organization members can access
		slog.DebugContext(ctx, "access granted: file is public",
			"employee_id", employeeID,
			"file_id", fileID)
		return &AccessCheckResult{
			HasAccess:  true,
			AccessRule: accessRule,
		}, nil

	case AccessScopePrivate:
		// Private: Check context-specific membership
		hasAccess, reason, err := l.checkContextMembership(ctx, tx, orgID, employeeID, accessRule.ContextType, accessRule.ContextID)
		if err != nil {
			return nil, err
		}
		return &AccessCheckResult{
			HasAccess:    hasAccess,
			DenialReason: reason,
			AccessRule:   accessRule,
		}, nil

	case AccessScopeDepartment:
		// Department: Check if employee is in same department
		// TODO: Implement department membership check
		slog.WarnContext(ctx, "department scope not yet implemented",
			"employee_id", employeeID,
			"file_id", fileID)
		return &AccessCheckResult{
			HasAccess:    false,
			DenialReason: "Department access scope not yet implemented",
			AccessRule:   accessRule,
		}, nil

	default:
		slog.WarnContext(ctx, "unknown access scope",
			"access_scope", accessRule.AccessScope,
			"file_id", fileID)
		return &AccessCheckResult{
			HasAccess:    false,
			DenialReason: fmt.Sprintf("Unknown access scope: %s", accessRule.AccessScope),
			AccessRule:   accessRule,
		}, nil
	}
}

// checkContextMembership verifies if employee is member of the specified context
func (l *accessLogic) checkContextMembership(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, contextType string, contextID dbuuid.UUID) (bool, string, error) {
	switch contextType {
	case ContextTypeChatChannel:
		// Check chat channel membership
		_, err := l.queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			OrganizationID: orgID,
			ChannelID:      contextID,
			EmployeeID:     employeeID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				slog.DebugContext(ctx, "access denied: not a channel member",
					"employee_id", employeeID,
					"channel_id", contextID)
				return false, "You are not a member of this channel", nil
			}
			slog.ErrorContext(ctx, "failed to check channel membership",
				"error", err,
				"channel_id", contextID)
			return false, "", fmt.Errorf("failed to check channel membership: %w", err)
		}
		return true, "", nil

	case ContextTypeDepartmentDocs:
		// Check department membership
		// Query employee's current department and verify it matches the context department
		membership, err := l.queries.GetEmployeeDepartment(ctx, tx, &database.GetEmployeeDepartmentParams{
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				slog.DebugContext(ctx, "access denied: employee not in any department",
					"employee_id", employeeID,
					"department_id", contextID)
				return false, "You are not a member of this department", nil
			}
			slog.ErrorContext(ctx, "failed to check department membership",
				"error", err,
				"department_id", contextID)
			return false, "", fmt.Errorf("failed to check department membership: %w", err)
		}
		// Verify employee is in the specific department
		if membership.DepartmentID != contextID {
			slog.DebugContext(ctx, "access denied: employee in different department",
				"employee_id", employeeID,
				"employee_department_id", membership.DepartmentID,
				"required_department_id", contextID)
			return false, "You are not a member of this department", nil
		}
		return true, "", nil

	case ContextTypeProject, ContextTypeCalendarEvent, ContextTypeSupportTicket, ContextTypeCRMDeal:
		// Future contexts - deny access for now
		slog.WarnContext(ctx, "context type not yet implemented",
			"context_type", contextType)
		return false, fmt.Sprintf("Context type %s not yet implemented", contextType), nil

	default:
		slog.WarnContext(ctx, "unknown context type",
			"context_type", contextType)
		return false, fmt.Sprintf("Unknown context type: %s", contextType), nil
	}
}

// GetFilesByContext returns all files in a specific context
func (l *accessLogic) GetFilesByContext(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, contextType string, contextID dbuuid.UUID, limit int32, offset int32) ([]*database.FilesFileMetadatum, error) {
	slog.DebugContext(ctx, "AccessLogic.GetFilesByContext",
		"organization_id", orgID,
		"context_type", contextType,
		"context_id", contextID,
		"limit", limit,
		"offset", offset)

	files, err := l.queries.GetFilesByContext(ctx, tx, &database.GetFilesByContextParams{
		OrganizationID: orgID,
		ContextType:    contextType,
		ContextID:      contextID,
		Limit:          limit,
		Offset:         offset,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get files by context",
			"error", err,
			"context_type", contextType,
			"context_id", contextID)
		return nil, fmt.Errorf("failed to get files by context: %w", err)
	}

	slog.DebugContext(ctx, "files retrieved by context",
		"context_type", contextType,
		"context_id", contextID,
		"count", len(files))

	return files, nil
}
