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
	LastPongAt        pgtype.Timestamptz
	Visibility        *database.NotificationPresenceVisibility
}

// maxInteractionBackdate bounds how far in the past a client-supplied interaction time
// may sit. Client clocks are advisory and routinely minutes off on mobile, so the value
// is clamped rather than trusted (research R6).
const maxInteractionBackdate = time.Hour

// PresenceLogic encapsulates presence-related business rules.
type PresenceLogic interface {
	// RecordPongs advances liveness for a batch of connections in ONE organization and
	// returns the connection IDs that matched. Unmatched IDs belong to connections that
	// no longer exist (or never belonged to the pongging employee) and get the reconnect
	// directive — the statement is an UPDATE, never an upsert, so a removed connection
	// is never resurrected by a late pong.
	RecordPongs(ctx context.Context, tx database.DBTX, organizationID dbuuid.UUID, records []PongRecord) ([]dbuuid.UUID, error)
	// RemoveDepartedConnections deletes connections whose clients announced a deliberate
	// teardown, instead of waiting out the responsive window.
	RemoveDepartedConnections(ctx context.Context, tx database.DBTX, organizationID dbuuid.UUID, records []PongRecord) (int64, error)
	GetEmployeePresence(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (*EmployeePresence, error)
	GetBatchEmployeePresence(ctx context.Context, tx database.DBTX, employeeIDs []dbuuid.UUID, organizationID dbuuid.UUID, viewerID dbuuid.UUID) ([]*EmployeePresence, error)
	GetEmployeeActiveConnections(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) ([]*database.GetEmployeeActiveConnectionsRow, error)
	// DeleteExpiredConnections sweeps connections silent past the removal window. It
	// replaces the old mark-then-sweep pair: liveness is derived, so there is nothing
	// left to mark.
	DeleteExpiredConnections(ctx context.Context, tx database.DBTX, organizationID dbuuid.UUID) (int64, error)
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

func (l *presenceLogicImpl) RecordPongs(ctx context.Context, tx database.DBTX, organizationID dbuuid.UUID, records []PongRecord) ([]dbuuid.UUID, error) {
	if len(records) == 0 {
		return nil, nil
	}

	now := l.nowSupplier()
	earliest := now.Add(-maxInteractionBackdate)

	connectionIDs := make([]dbuuid.UUID, len(records))
	employeeIDs := make([]dbuuid.UUID, len(records))
	statuses := make([]string, len(records))
	activeChannelIDs := make([]string, len(records))
	lastInteractions := make([]pgtype.Timestamptz, len(records))

	for i, rec := range records {
		if !IsValidPresenceStatus(rec.Status) {
			return nil, fmt.Errorf("invalid presence status: %s", rec.Status)
		}

		connectionIDs[i] = rec.ConnectionID
		employeeIDs[i] = rec.EmployeeID
		statuses[i] = rec.Status
		// Empty string carries "no channel": a uuid[] parameter cannot hold a NULL element.
		if rec.ActiveChannelID.Valid {
			activeChannelIDs[i] = dbuuid.UUID(rec.ActiveChannelID.UUID).String()
		}
		lastInteractions[i] = clampInteractionTime(rec.LastInteractionAt, earliest, now)
	}

	matched, err := l.queries.RecordPresencePongs(ctx, tx, &database.RecordPresencePongsParams{
		OrganizationID:   organizationID,
		ConnectionIds:    connectionIDs,
		EmployeeIds:      employeeIDs,
		PresenceStatuses: statuses,
		ActiveChannelIds: activeChannelIDs,
		LastInteractions: lastInteractions,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to record presence pongs: %w", err)
	}
	return matched, nil
}

func (l *presenceLogicImpl) RemoveDepartedConnections(ctx context.Context, tx database.DBTX, organizationID dbuuid.UUID, records []PongRecord) (int64, error) {
	if len(records) == 0 {
		return 0, nil
	}

	employeeIDs := make([]dbuuid.UUID, len(records))
	connectionIDs := make([]dbuuid.UUID, len(records))
	for i, rec := range records {
		employeeIDs[i] = rec.EmployeeID
		connectionIDs[i] = rec.ConnectionID
	}

	removed, err := l.queries.RemoveDepartedConnections(ctx, tx, &database.RemoveDepartedConnectionsParams{
		OrganizationID: organizationID,
		EmployeeIds:    employeeIDs,
		ConnectionIds:  connectionIDs,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to remove departed connections: %w", err)
	}
	return removed, nil
}

// clampInteractionTime keeps a client-supplied interaction time plausible. It is a
// display and idle-detection hint only — liveness is the database's own clock — so an
// implausible value is clamped rather than rejected.
func clampInteractionTime(candidate pgtype.Timestamptz, earliest, latest time.Time) pgtype.Timestamptz {
	if !candidate.Valid {
		return timestamptzFromTime(latest)
	}
	if candidate.Time.After(latest) {
		return timestamptzFromTime(latest)
	}
	if candidate.Time.Before(earliest) {
		return timestamptzFromTime(earliest)
	}
	return timestamptzFromTime(candidate.Time)
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
		OrganizationID:          organizationID,
		EmployeeID:              employeeID,
		ResponsiveWindowSeconds: ResponsiveWindowSeconds,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch active connections: %w", err)
	}
	return rows, nil
}

func (l *presenceLogicImpl) DeleteExpiredConnections(ctx context.Context, tx database.DBTX, organizationID dbuuid.UUID) (int64, error) {
	count, err := l.queries.DeleteExpiredConnections(ctx, tx, &database.DeleteExpiredConnectionsParams{
		OrganizationID:       organizationID,
		RemovalWindowSeconds: RemovalWindowSeconds,
	})
	if err != nil {
		return 0, fmt.Errorf("failed to delete expired connections: %w", err)
	}
	if count > 0 {
		// FR-025: janitor removals per organization.
		slog.InfoContext(ctx, "removed expired connections",
			"function", "PresenceLogic.DeleteExpiredConnections",
			"organization_id", organizationID.String(),
			"removed_count", count,
			"removal_window_seconds", RemovalWindowSeconds,
		)
	}
	return count, nil
}

func (l *presenceLogicImpl) fetchPresences(ctx context.Context, tx database.DBTX, employeeIDs []dbuuid.UUID, organizationID dbuuid.UUID) (map[dbuuid.UUID]*EmployeePresence, error) {
	rows, err := l.queries.GetEmployeeVisiblePresence(ctx, tx, &database.GetEmployeeVisiblePresenceParams{
		OrganizationID:          organizationID,
		EmployeeIds:             employeeIDs,
		ResponsiveWindowSeconds: ResponsiveWindowSeconds,
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
				LastPongAt:        row.LastPongAt,
				Visibility:        currentVisibility,
			}
			continue
		}

		// Every row here is already responsive — the query predicate saw to that — so
		// aggregation is: highest-ranked status wins, ties broken by the most recently
		// pongged row, and context comes from that row (data-model.md).
		if PresenceStatusRank(row.PresenceStatus) > PresenceStatusRank(presence.Status) ||
			(PresenceStatusRank(row.PresenceStatus) == PresenceStatusRank(presence.Status) &&
				newerTimestamptz(row.LastPongAt, presence.LastPongAt)) {
			presence.Status = row.PresenceStatus
			presence.ActiveChannelID = row.ActiveChannelID
		}

		if newerTimestamptz(row.LastInteractionAt, presence.LastInteractionAt) {
			presence.LastInteractionAt = row.LastInteractionAt
		}
		if newerTimestamptz(row.LastPongAt, presence.LastPongAt) {
			presence.LastPongAt = row.LastPongAt
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
		LastPongAt:        pgtype.Timestamptz{},
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
