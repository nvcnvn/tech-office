package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AddProjectMember adds a new member to a project
func (l *logicImpl) AddProjectMember(
	ctx context.Context,
	tx database.DBTX,
	orgID, invitedByID dbuuid.UUID,
	projectID, employeeID dbuuid.UUID,
	role string,
) (*rpcv1.ProjectMember, error) {
	slog.DebugContext(ctx, "AddProjectMember",
		"projectID", projectID,
		"employeeID", employeeID,
		"role", role,
	)

	// Validate role
	if !IsValidProjectMemberRole(role) {
		return nil, ErrInvalidMemberRole
	}

	now := time.Now()

	// Check if project exists and get its visibility
	project, err := l.Queries.GetProject(ctx, tx, &database.GetProjectParams{
		OrganizationID: orgID,
		ID:             projectID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrProjectNotFound
		}
		return nil, fmt.Errorf("failed to get project: %w", err)
	}

	// For private projects, only project admins/owners may invite new members
	if project.Visibility != ProjectVisibilityPublic {
		inviterRole, roleErr := l.GetProjectMemberRole(ctx, tx, orgID, projectID, invitedByID)
		if roleErr != nil || (inviterRole != ProjectMemberRoleOwner && inviterRole != ProjectMemberRoleAdmin) {
			return nil, ErrAccessDenied
		}
	}

	// Check if already a member
	existing, err := l.Queries.GetProjectMembership(ctx, tx, &database.GetProjectMembershipParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     employeeID,
	})
	if err == nil {
		// Already a member, return existing
		return projectMemberToProto(existing), nil
	}
	if err != pgx.ErrNoRows {
		return nil, fmt.Errorf("failed to check existing membership: %w", err)
	}

	// Create membership
	member, err := l.Queries.CreateProjectMembership(ctx, tx, &database.CreateProjectMembershipParams{
		ID:                     dbuuid.Must(),
		OrganizationID:         orgID,
		ProjectID:              projectID,
		EmployeeID:             employeeID,
		Role:                   role,
		NotificationPreference: NotificationPreferenceAll,
		InvitedByEmployeeID:    dbuuid.UUIDToNullUUID(invitedByID),
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create project member",
			"error", err,
		)
		return nil, fmt.Errorf("failed to add project member: %w", err)
	}

	// Increment member count
	err = l.Queries.IncrementProjectMemberCount(ctx, tx, &database.IncrementProjectMemberCountParams{
		OrganizationID: orgID,
		ID:             projectID,
		MemberCount:    1,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to increment member count",
			"error", err,
		)
	}

	slog.InfoContext(ctx, "project member added successfully",
		"projectID", projectID,
		"employeeID", employeeID,
		"role", role,
	)

	return projectMemberToProto(member), nil
}

// RemoveProjectMember removes a member from a project
func (l *logicImpl) RemoveProjectMember(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	projectID, employeeID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "RemoveProjectMember",
		"projectID", projectID,
		"employeeID", employeeID,
	)

	now := time.Now()

	// Get membership to check role
	member, err := l.Queries.GetProjectMembership(ctx, tx, &database.GetProjectMembershipParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrMemberNotFound
		}
		return fmt.Errorf("failed to get member: %w", err)
	}

	// Prevent removing last owner - count owners by listing members and filtering
	if member.Role == ProjectMemberRoleOwner {
		members, err := l.Queries.ListProjectMembers(ctx, tx, &database.ListProjectMembersParams{
			OrganizationID: orgID,
			ProjectID:      projectID,
		})
		if err != nil {
			return fmt.Errorf("failed to list members: %w", err)
		}
		ownerCount := 0
		for _, m := range members {
			if m.Role == ProjectMemberRoleOwner {
				ownerCount++
			}
		}
		if ownerCount <= 1 {
			return ErrLastOwner
		}
	}

	// Delete membership
	err = l.Queries.DeleteProjectMembership(ctx, tx, &database.DeleteProjectMembershipParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete project member",
			"error", err,
		)
		return fmt.Errorf("failed to remove project member: %w", err)
	}

	// Decrement member count (using increment with -1)
	err = l.Queries.IncrementProjectMemberCount(ctx, tx, &database.IncrementProjectMemberCountParams{
		OrganizationID: orgID,
		ID:             projectID,
		MemberCount:    -1,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to decrement member count",
			"error", err,
		)
	}

	slog.InfoContext(ctx, "project member removed successfully",
		"projectID", projectID,
		"employeeID", employeeID,
	)

	return nil
}

// UpdateProjectMemberRole updates a member's role in a project
func (l *logicImpl) UpdateProjectMemberRole(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	projectID, employeeID dbuuid.UUID,
	newRole string,
) (*rpcv1.ProjectMember, error) {
	slog.DebugContext(ctx, "UpdateProjectMemberRole",
		"projectID", projectID,
		"employeeID", employeeID,
		"newRole", newRole,
	)

	// Validate role
	if !IsValidProjectMemberRole(newRole) {
		return nil, ErrInvalidMemberRole
	}

	now := time.Now()

	// Get current membership
	member, err := l.Queries.GetProjectMembership(ctx, tx, &database.GetProjectMembershipParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrMemberNotFound
		}
		return nil, fmt.Errorf("failed to get member: %w", err)
	}

	// Prevent demoting last owner
	if member.Role == ProjectMemberRoleOwner && newRole != ProjectMemberRoleOwner {
		members, err := l.Queries.ListProjectMembers(ctx, tx, &database.ListProjectMembersParams{
			OrganizationID: orgID,
			ProjectID:      projectID,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to list members: %w", err)
		}
		ownerCount := 0
		for _, m := range members {
			if m.Role == ProjectMemberRoleOwner {
				ownerCount++
			}
		}
		if ownerCount <= 1 {
			return nil, ErrLastOwner
		}
	}

	// Update role
	updated, err := l.Queries.UpdateProjectMembershipRole(ctx, tx, &database.UpdateProjectMembershipRoleParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     employeeID,
		Role:           newRole,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update project member role",
			"error", err,
		)
		return nil, fmt.Errorf("failed to update member role: %w", err)
	}

	slog.InfoContext(ctx, "project member role updated successfully",
		"projectID", projectID,
		"employeeID", employeeID,
		"newRole", newRole,
	)

	return projectMemberToProto(updated), nil
}

// ListProjectMembers lists all members of a project
func (l *logicImpl) ListProjectMembers(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
) ([]*rpcv1.ProjectMember, error) {
	slog.DebugContext(ctx, "ListProjectMembers",
		"projectID", projectID,
	)

	dbMembers, err := l.Queries.ListProjectMembers(ctx, tx, &database.ListProjectMembersParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list members: %w", err)
	}

	members := make([]*rpcv1.ProjectMember, len(dbMembers))
	for i, m := range dbMembers {
		members[i] = projectMemberToProto(m)
	}

	return members, nil
}

// GetProjectMemberRole gets a member's role in a project
func (l *logicImpl) GetProjectMemberRole(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID, employeeID dbuuid.UUID,
) (string, error) {
	slog.DebugContext(ctx, "GetProjectMemberRole",
		"projectID", projectID,
		"employeeID", employeeID,
	)

	role, err := l.Queries.GetProjectMemberRole(ctx, tx, &database.GetProjectMemberRoleParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", ErrMemberNotFound
		}
		return "", fmt.Errorf("failed to get member role: %w", err)
	}

	return role, nil
}

// CheckProjectAccess checks if an employee has access to a project
func (l *logicImpl) CheckProjectAccess(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID, employeeID dbuuid.UUID,
	requiredRoles []string,
) (bool, error) {
	slog.DebugContext(ctx, "CheckProjectAccess",
		"projectID", projectID,
		"employeeID", employeeID,
		"requiredRoles", requiredRoles,
	)

	// Get project first
	project, err := l.Queries.GetProject(ctx, tx, &database.GetProjectParams{
		OrganizationID: orgID,
		ID:             projectID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("failed to get project: %w", err)
	}

	// Public projects are viewable by all when no specific roles required
	if project.Visibility == ProjectVisibilityPublic && len(requiredRoles) == 0 {
		return true, nil
	}

	// Check membership
	member, err := l.Queries.GetProjectMembership(ctx, tx, &database.GetProjectMembershipParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("failed to get member: %w", err)
	}

	// If no specific roles required, membership is sufficient
	if len(requiredRoles) == 0 {
		return true, nil
	}

	// Check if member's role is in required roles
	for _, reqRole := range requiredRoles {
		if hasRequiredRole(member.Role, reqRole) {
			return true, nil
		}
	}

	return false, nil
}

// UpdateProjectMemberNotificationPreference updates notification preference
func (l *logicImpl) UpdateProjectMemberNotificationPreference(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID, employeeID dbuuid.UUID,
	preference string,
) error {
	slog.DebugContext(ctx, "UpdateProjectMemberNotificationPreference",
		"projectID", projectID,
		"employeeID", employeeID,
		"preference", preference,
	)

	// Validate preference
	if !IsValidNotificationPreference(preference) {
		return fmt.Errorf("invalid notification preference: %s", preference)
	}

	now := time.Now()

	_, err := l.Queries.UpdateProjectMembershipNotificationPref(ctx, tx, &database.UpdateProjectMembershipNotificationPrefParams{
		OrganizationID:         orgID,
		ProjectID:              projectID,
		EmployeeID:             employeeID,
		NotificationPreference: preference,
		UpdatedAt:              pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update notification preference",
			"error", err,
		)
		return fmt.Errorf("failed to update notification preference: %w", err)
	}

	return nil
}

// ============================================================================
// Helper Functions
// ============================================================================

func projectMemberToProto(m *database.CollaborationProjectMembership) *rpcv1.ProjectMember {
	member := &rpcv1.ProjectMember{
		EmployeeId:             m.EmployeeID.String(),
		Role:                   stringToRoleProto(m.Role),
		NotificationPreference: stringToNotificationPreferenceProto(m.NotificationPreference),
		JoinedAt:               timestamppb.New(m.JoinedAt.Time),
	}

	if m.InvitedByEmployeeID.Valid {
		s := m.InvitedByEmployeeID.UUID.String()
		member.InvitedByEmployeeId = &s
	}

	return member
}

func stringToNotificationPreferenceProto(s string) rpcv1.NotificationPreference {
	switch s {
	case NotificationPreferenceAll:
		return rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_ALL
	case NotificationPreferenceMentions:
		return rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MENTIONS
	case NotificationPreferenceMuted:
		return rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MUTED
	default:
		return rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_UNSPECIFIED
	}
}

// hasRequiredRole checks if the actual role meets or exceeds the required role
func hasRequiredRole(actualRole, requiredRole string) bool {
	roleHierarchy := map[string]int{
		ProjectMemberRoleViewer: 1,
		ProjectMemberRoleMember: 2,
		ProjectMemberRoleAdmin:  3,
		ProjectMemberRoleOwner:  4,
	}

	actualLevel, ok1 := roleHierarchy[actualRole]
	requiredLevel, ok2 := roleHierarchy[requiredRole]

	if !ok1 || !ok2 {
		return false
	}

	return actualLevel >= requiredLevel
}
