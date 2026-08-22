package notification

import (
	"context"
	"fmt"
	"log/slog"
	"net/netip"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// registerConnection registers an active SSE connection in the registry.
// Queries employee's department membership and denormalizes it for fast lookups.
func (s *NotificationService) registerConnection(
	ctx context.Context,
	employeeID dbuuid.UUID,
	connectionID dbuuid.UUID,
	orgID dbuuid.UUID,
	userAgent string,
	ipAddress string,
) error {
	// Query employee's department membership
	deptMembers, err := s.Queries.GetEmployeeDepartments(ctx, s.AdminPool, &database.GetEmployeeDepartmentsParams{
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("failed to query employee departments: %w", err)
	}

	// Extract department IDs - GetEmployeeDepartments returns []dbuuid.UUID directly
	departmentIDs := deptMembers

	// Parse IP address
	var ipAddr *netip.Addr
	if ipAddress != "" {
		parsed, err := netip.ParseAddr(ipAddress)
		if err == nil {
			ipAddr = &parsed
		}
	}

	// Insert active connection with denormalized department_ids
	err = s.Queries.InsertActiveConnection(ctx, s.AdminPool, &database.InsertActiveConnectionParams{
		EmployeeID:     employeeID,
		InstanceID:     s.InstanceID,
		ConnectionID:   connectionID,
		OrganizationID: orgID,
		DepartmentIds:  departmentIDs,
		UserAgent:      stringToNullText(userAgent),
		IpAddress:      ipAddr,
		// A new connection gets a full responsive window before its first ping is due.
		LastPongAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		return fmt.Errorf("failed to insert active connection: %w", err)
	}

	return nil
}

// unregisterConnection removes a connection from the registry.
func (s *NotificationService) unregisterConnection(
	ctx context.Context,
	employeeID dbuuid.UUID,
	connectionID dbuuid.UUID,
	organizationID dbuuid.UUID,
) error {
	err := s.Queries.RemoveActiveConnection(ctx, s.AdminPool, &database.RemoveActiveConnectionParams{
		OrganizationID: organizationID,
		EmployeeID:     employeeID,
		ConnectionID:   connectionID,
	})
	if err != nil {
		return fmt.Errorf("failed to remove active connection: %w", err)
	}
	return nil
}

// startCleanupWorker starts the presence janitor: a single DELETE sweep per
// organization, every minute, removing connections that have not pongged within the
// removal window.
//
// This replaces the old mark-then-sweep pair. `connection_status` is gone, so there is
// nothing left to mark: responsive versus unresponsive is derived from last_pong_at at
// read time, and it becomes true the instant the window elapses rather than whenever a
// marker job last ran.
func (s *NotificationService) startCleanupWorker(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			orgIDs, err := s.Queries.ListOrganizationsWithActiveConnections(ctx, s.AdminPool)
			if err != nil {
				slog.ErrorContext(ctx, "failed to enumerate organizations for cleanup", "error", err)
				continue
			}

			for _, orgID := range orgIDs {
				removed, err := s.Queries.DeleteExpiredConnections(ctx, s.AdminPool, &database.DeleteExpiredConnectionsParams{
					OrganizationID:       orgID,
					RemovalWindowSeconds: RemovalWindowSeconds,
				})
				if err != nil {
					slog.ErrorContext(ctx, "failed to delete expired connections",
						"organization_id", orgID.String(),
						"error", err,
					)
					continue
				}

				if removed > 0 {
					// FR-025: janitor removals per organization.
					slog.InfoContext(ctx, "removed expired connections",
						"function", "startCleanupWorker",
						"organization_id", orgID.String(),
						"removed_count", removed,
						"removal_window_seconds", RemovalWindowSeconds,
					)
				}
			}
		}
	}
}

// cleanupInstanceConnections removes all connections for the current instance on startup.
// This handles the case where the backend was restarted (new PID) and old connections
// are still in the database from the previous process.
func (s *NotificationService) cleanupInstanceConnections(ctx context.Context) error {
	slog.DebugContext(ctx, "cleanupInstanceConnections called",
		"function", "cleanupInstanceConnections",
		"instanceID", s.InstanceID,
	)

	// Query to delete all connections for this instance
	query := `
		DELETE FROM notification.active_connection 
		WHERE instance_id = $1
	`

	result, err := s.AdminPool.Exec(ctx, query, s.InstanceID)
	if err != nil {
		return fmt.Errorf("failed to delete instance connections: %w", err)
	}

	rowsAffected := result.RowsAffected()
	slog.InfoContext(ctx, "cleaned up stale instance connections",
		"instanceID", s.InstanceID,
		"deletedCount", rowsAffected,
	)

	return nil
}

func (s *NotificationService) cleanupInstanceListener(ctx context.Context) error {
	const query = `
		DELETE FROM notification.active_listener
		WHERE instance_id = $1
	`

	if _, err := s.AdminPool.Exec(ctx, query, s.InstanceID); err != nil {
		return fmt.Errorf("failed to delete instance listener: %w", err)
	}

	return nil
}

func (s *NotificationService) removeActiveListener(ctx context.Context) error {
	const query = `
		DELETE FROM notification.active_listener
		WHERE instance_id = $1
	`

	if _, err := s.AdminPool.Exec(ctx, query, s.InstanceID); err != nil {
		return fmt.Errorf("failed to remove active listener: %w", err)
	}

	return nil
}

// reRegisterActiveConnections re-inserts DB rows for all in-memory SSE connections.
// Called after listener reconnect to recover from UNLOGGED table data loss
// (PostgreSQL truncates UNLOGGED tables after crash/recovery).
func (s *NotificationService) reRegisterActiveConnections(ctx context.Context) {
	s.connMutex.RLock()
	connections := make([]*SSEConnection, 0, len(s.activeConnections))
	for _, conn := range s.activeConnections {
		connections = append(connections, conn)
	}
	s.connMutex.RUnlock()

	if len(connections) == 0 {
		return
	}

	slog.InfoContext(ctx, "re-registering active connections after DB recovery",
		"count", len(connections),
		"instanceID", s.InstanceID,
	)

	restored := 0
	for _, conn := range connections {
		// Re-query department membership so routing stays accurate
		deptIDs, err := s.Queries.GetEmployeeDepartments(ctx, s.AdminPool, &database.GetEmployeeDepartmentsParams{
			EmployeeID:     conn.EmployeeID,
			OrganizationID: conn.OrganizationID,
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to query departments during re-registration",
				"error", err, "employeeID", conn.EmployeeID.String())
			// Use empty slice — better than losing the connection entirely
			deptIDs = nil
		}

		err = s.Queries.InsertActiveConnection(ctx, s.AdminPool, &database.InsertActiveConnectionParams{
			EmployeeID:     conn.EmployeeID,
			InstanceID:     s.InstanceID,
			ConnectionID:   conn.ConnectionID,
			OrganizationID: conn.OrganizationID,
			DepartmentIds:  deptIDs,
			LastPongAt:     pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to re-register connection",
				"error", err,
				"employeeID", conn.EmployeeID.String(),
				"connectionID", conn.ConnectionID.String(),
			)
			continue
		}
		restored++
	}

	slog.InfoContext(ctx, "re-registered active connections",
		"restored", restored,
		"total", len(connections),
		"instanceID", s.InstanceID,
	)
}
