package notification

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// EmployeePresence aggregates the latest presence signal for an employee.
type EmployeePresence struct {
	EmployeeID        dbuuid.UUID
	OrganizationID    dbuuid.UUID
	Status            string
	ActiveChannelID   dbuuid.NullUUID
	LastInteractionAt pgtype.Timestamptz
	LastHeartbeat     pgtype.Timestamptz
	Visibility        *database.NotificationPresenceVisibility
}

// UpdatePresenceParams groups UpdatePresenceStatus inputs for clarity.
type UpdatePresenceParams struct {
	OrganizationID             dbuuid.UUID
	EmployeeID                 dbuuid.UUID
	ConnectionID               dbuuid.UUID
	Status                     string
	ActiveChannelID            dbuuid.NullUUID
	LastInteractionAt          pgtype.Timestamptz
	RequestedInstanceID        string
	RequireConnectionOwnership bool
}

var ErrConnectionNotFound = errors.New("active connection not found for employee")

// PresenceLogic encapsulates presence-related business rules.
type PresenceLogic interface {
	UpdatePresenceStatus(ctx context.Context, tx database.DBTX, params *UpdatePresenceParams) (*EmployeePresence, error)
	GetEmployeePresence(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (*EmployeePresence, error)
	GetBatchEmployeePresence(ctx context.Context, tx database.DBTX, employeeIDs []dbuuid.UUID, organizationID dbuuid.UUID, viewerID dbuuid.UUID) ([]*EmployeePresence, error)
	GetEmployeeActiveConnections(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) ([]*database.GetEmployeeActiveConnectionsRow, error)
	CleanupStaleConnections(ctx context.Context, tx database.DBTX, organizationID dbuuid.UUID, staleBefore time.Time) (int64, error)
}

type presenceLogicImpl struct {
	queries     *database.Queries
	visibility  VisibilityLogic
	nowSupplier func() time.Time
}

// NewPresenceLogic constructs a PresenceLogic implementation.
func NewPresenceLogic(queries *database.Queries, visibility VisibilityLogic) PresenceLogic {
	return &presenceLogicImpl{
		queries:     queries,
		visibility:  visibility,
		nowSupplier: time.Now,
	}
}

func (l *presenceLogicImpl) UpdatePresenceStatus(ctx context.Context, tx database.DBTX, params *UpdatePresenceParams) (*EmployeePresence, error) {
	if params == nil {
		return nil, fmt.Errorf("update presence params required")
	}
	if !IsValidPresenceStatus(params.Status) {
		return nil, fmt.Errorf("invalid presence status: %s", params.Status)
	}

	heartbeat := timestamptzFromTime(l.nowSupplier())
	lastInteraction := params.LastInteractionAt
	if !lastInteraction.Valid {
		lastInteraction = heartbeat
	}

	instanceID := params.RequestedInstanceID
	if params.RequireConnectionOwnership {
		if params.ConnectionID == (dbuuid.UUID{}) {
			return nil, fmt.Errorf("connection ID required for ownership validation")
		}

		row, err := l.queries.GetActiveConnectionByID(ctx, tx, &database.GetActiveConnectionByIDParams{
			OrganizationID: params.OrganizationID,
			EmployeeID:     params.EmployeeID,
			ConnectionID:   params.ConnectionID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrConnectionNotFound
			}
			return nil, fmt.Errorf("failed to verify active connection: %w", err)
		}

		// Preserve the instance that owns the SSE stream.
		instanceID = row.InstanceID
	}

	if instanceID == "" {
		instanceID = "transient"
	}

	slog.DebugContext(ctx, "updating presence status",
		"function", "PresenceLogic.UpdatePresenceStatus",
		"employee_id", params.EmployeeID.String(),
		"organization_id", params.OrganizationID.String(),
		"status", params.Status,
		"connection_id", params.ConnectionID.String(),
		"instance_id", instanceID,
	)

	err := l.queries.UpdatePresenceStatus(ctx, tx, &database.UpdatePresenceStatusParams{
		OrganizationID:    params.OrganizationID,
		EmployeeID:        params.EmployeeID,
		ConnectionID:      params.ConnectionID,
		InstanceID:        instanceID,
		PresenceStatus:    params.Status,
		ActiveChannelID:   params.ActiveChannelID,
		LastInteractionAt: lastInteraction,
		LastHeartbeat:     heartbeat,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update presence status",
			"function", "PresenceLogic.UpdatePresenceStatus",
			"error", err,
		)
		return nil, fmt.Errorf("failed to update presence status: %w", err)
	}

	presence, err := l.GetEmployeePresence(ctx, tx, params.EmployeeID, params.OrganizationID)
	if err != nil {
		return nil, err
	}
	if presence == nil {
		return nil, fmt.Errorf("presence record not found for employee %s", params.EmployeeID)
	}
	return presence, nil
}

func (l *presenceLogicImpl) GetEmployeePresence(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (*EmployeePresence, error) {
	presences, err := l.fetchPresences(ctx, tx, []dbuuid.UUID{employeeID}, organizationID)
	if err != nil {
		return nil, err
	}
	presence, ok := presences[employeeID]
	if !ok {
		vis, err := l.getPresenceVisibility(ctx, tx, employeeID, organizationID)
		if err != nil {
			return nil, err
		}
		presence = l.newOfflinePresence(employeeID, organizationID, vis)
	}
	return presence, nil
}

func (l *presenceLogicImpl) GetBatchEmployeePresence(ctx context.Context, tx database.DBTX, employeeIDs []dbuuid.UUID, organizationID dbuuid.UUID, viewerID dbuuid.UUID) ([]*EmployeePresence, error) {
	if len(employeeIDs) == 0 {
		return []*EmployeePresence{}, nil
	}

	presences, err := l.fetchPresences(ctx, tx, employeeIDs, organizationID)
	if err != nil {
		return nil, err
	}

	results := make([]*EmployeePresence, 0, len(employeeIDs))
	for _, employeeID := range employeeIDs {
		presence, ok := presences[employeeID]
		if !ok {
			vis, err := l.getPresenceVisibility(ctx, tx, employeeID, organizationID)
			if err != nil {
				return nil, err
			}
			presence = l.newOfflinePresence(employeeID, organizationID, vis)
		}
		results = append(results, presence)
	}

	if l.visibility == nil {
		return results, nil
	}

	filtered, err := l.visibility.FilterVisiblePresence(ctx, tx, results, viewerID, organizationID)
	if err != nil {
		return nil, err
	}
	return filtered, nil
}

func (l *presenceLogicImpl) GetEmployeeActiveConnections(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) ([]*database.GetEmployeeActiveConnectionsRow, error) {
	rows, err := l.queries.GetEmployeeActiveConnections(ctx, tx, &database.GetEmployeeActiveConnectionsParams{
		OrganizationID: organizationID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch active connections: %w", err)
	}
	return rows, nil
}

func (l *presenceLogicImpl) CleanupStaleConnections(ctx context.Context, tx database.DBTX, organizationID dbuuid.UUID, staleBefore time.Time) (int64, error) {
	threshold := timestamptzFromTime(staleBefore)
	count, err := l.queries.CleanupStaleConnections(ctx, tx, &database.CleanupStaleConnectionsParams{
		OrganizationID: organizationID,
		LastHeartbeat:  threshold,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to cleanup stale connections: %w", err)
	}
	if count > 0 {
		slog.InfoContext(ctx, "removed stale connections",
			"function", "PresenceLogic.CleanupStaleConnections",
			"organization_id", organizationID.String(),
			"removed_count", count,
		)
	}
	return count, nil
}

func (l *presenceLogicImpl) fetchPresences(ctx context.Context, tx database.DBTX, employeeIDs []dbuuid.UUID, organizationID dbuuid.UUID) (map[dbuuid.UUID]*EmployeePresence, error) {
	rows, err := l.queries.GetEmployeeVisiblePresence(ctx, tx, &database.GetEmployeeVisiblePresenceParams{
		OrganizationID: organizationID,
		Column2:        employeeIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch presence rows: %w", err)
	}

	presences := make(map[dbuuid.UUID]*EmployeePresence, len(employeeIDs))
	for _, row := range rows {
		presence := presences[row.EmployeeID]
		currentVisibility := visibilityFromRow(row)
		if presence == nil {
			presences[row.EmployeeID] = &EmployeePresence{
				EmployeeID:        row.EmployeeID,
				OrganizationID:    row.OrganizationID,
				Status:            row.PresenceStatus,
				ActiveChannelID:   row.ActiveChannelID,
				LastInteractionAt: row.LastInteractionAt,
				LastHeartbeat:     row.LastHeartbeat,
				Visibility:        currentVisibility,
			}
			continue
		}

		// Merge by picking strongest status and most recent activity timestamps.
		if PresenceStatusRank(row.PresenceStatus) > PresenceStatusRank(presence.Status) ||
			(PresenceStatusRank(row.PresenceStatus) == PresenceStatusRank(presence.Status) &&
				newerTimestamptz(row.LastHeartbeat, presence.LastHeartbeat)) {
			presence.Status = row.PresenceStatus
			presence.ActiveChannelID = row.ActiveChannelID
		}

		if newerTimestamptz(row.LastInteractionAt, presence.LastInteractionAt) {
			presence.LastInteractionAt = row.LastInteractionAt
		}
		if newerTimestamptz(row.LastHeartbeat, presence.LastHeartbeat) {
			presence.LastHeartbeat = row.LastHeartbeat
		}
		if presence.Visibility == nil && currentVisibility != nil {
			presence.Visibility = currentVisibility
		}
	}
	return presences, nil
}

func (l *presenceLogicImpl) getPresenceVisibility(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (*database.NotificationPresenceVisibility, error) {
	vis, err := l.queries.GetPresenceVisibility(ctx, tx, &database.GetPresenceVisibilityParams{
		OrganizationID: organizationID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to fetch presence visibility: %w", err)
	}
	return vis, nil
}

func (l *presenceLogicImpl) newOfflinePresence(employeeID, organizationID dbuuid.UUID, vis *database.NotificationPresenceVisibility) *EmployeePresence {
	visibility := vis
	if visibility == nil {
		visibility = defaultVisibility(organizationID, employeeID)
	}
	return &EmployeePresence{
		EmployeeID:        employeeID,
		OrganizationID:    organizationID,
		Status:            PresenceStatusOffline,
		ActiveChannelID:   dbuuid.NullUUID{},
		LastInteractionAt: pgtype.Timestamptz{},
		LastHeartbeat:     pgtype.Timestamptz{},
		Visibility:        visibility,
	}
}

func visibilityFromRow(row *database.GetEmployeeVisiblePresenceRow) *database.NotificationPresenceVisibility {
	if !row.VisibilityMode.Valid && !row.CustomStatusText.Valid && !row.CustomStatusEmoji.Valid && !row.UpdatedAt.Valid {
		return nil
	}

	mode := VisibilityModeEveryone
	if row.VisibilityMode.Valid && row.VisibilityMode.String != "" {
		mode = row.VisibilityMode.String
	}

	vis := &database.NotificationPresenceVisibility{
		OrganizationID:    row.OrganizationID,
		EmployeeID:        row.EmployeeID,
		VisibilityMode:    mode,
		CustomStatusText:  row.CustomStatusText,
		CustomStatusEmoji: row.CustomStatusEmoji,
		UpdatedAt:         row.UpdatedAt,
	}
	return vis
}

func defaultVisibility(organizationID, employeeID dbuuid.UUID) *database.NotificationPresenceVisibility {
	return &database.NotificationPresenceVisibility{
		OrganizationID: organizationID,
		EmployeeID:     employeeID,
		VisibilityMode: VisibilityModeEveryone,
	}
}

func timestamptzFromTime(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t.UTC(), Valid: true}
}

func newerTimestamptz(candidate, current pgtype.Timestamptz) bool {
	if !candidate.Valid {
		return false
	}
	if !current.Valid {
		return true
	}
	return candidate.Time.After(current.Time)
}
