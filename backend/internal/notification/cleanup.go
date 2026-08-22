package notification

import (
	"context"
	"log/slog"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/txn"
)

// StartCleanupRoutine starts a background goroutine that periodically removes stale
// LISTEN registrations.
//
// System-scope justification:
// This routine scans all instances' listener registrations for cleanup. Uses
// context.Background() for system maintenance operations that should continue
// independent of user requests.
//
// Connections are NOT swept here: notification.active_connection is owned by the
// presence janitor in registry.go, which removes rows only once they are silent past
// RemovalWindowSeconds. Deleting them on a shorter timetable would tear down
// connections that are merely unresponsive and still due to recover.
//
// Parameters:
//   - ctx: Context for lifecycle management (cancellation signal)
//   - interval: Cleanup check interval (recommended: 30 seconds)
//
// The goroutine exits when ctx is cancelled.
func (s *NotificationService) StartCleanupRoutine(ctx context.Context, interval time.Duration) {
	slog.InfoContext(ctx, "starting cleanup routine",
		"function", "StartCleanupRoutine",
		"interval", interval.String())

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run cleanup immediately on start
	s.cleanupStaleListeners(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.InfoContext(ctx, "cleanup routine stopped",
				"function", "StartCleanupRoutine",
				"reason", "context cancelled")
			return

		case <-ticker.C:
			s.cleanupStaleListeners(ctx)
		}
	}
}

// cleanupStaleListeners removes LISTEN registrations whose owning instance stopped
// heartbeating. Uses AdminPool for cross-instance cleanup with direct SQL.
func (s *NotificationService) cleanupStaleListeners(ctx context.Context) {
	slog.DebugContext(ctx, "running stale listener cleanup",
		"function", "cleanupStaleListeners")

	staleThreshold := 60 * time.Second
	staleBefore := time.Now().Add(-staleThreshold)

	err := txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		const listenerQuery = `
			DELETE FROM notification.active_listener
			WHERE last_heartbeat < $1
		`

		listenerResult, err := tx.Exec(ctx, listenerQuery, timestamptzFromTime(staleBefore))
		if err != nil {
			slog.ErrorContext(ctx, "failed to execute stale listener cleanup",
				"function", "cleanupStaleListeners",
				"error", err)
			return err
		}

		if deleted := listenerResult.RowsAffected(); deleted > 0 {
			slog.InfoContext(ctx, "stale listeners cleaned up",
				"function", "cleanupStaleListeners",
				"deletedCount", deleted,
				"staleThreshold", staleThreshold.String())
		}

		return nil
	})

	if err != nil {
		if isExpectedShutdownError(ctx, err) {
			slog.InfoContext(ctx, "stale listener cleanup stopped during shutdown",
				"function", "cleanupStaleListeners",
				"reason", err)
			return
		}
		slog.ErrorContext(ctx, "cleanup transaction failed",
			"function", "cleanupStaleListeners",
			"error", err)
	}
}

// CleanupStalePushTokens removes push tokens that haven't been used in 90+ days
// across all organizations.
// Uses AdminPool for cross-organization cleanup with direct SQL.
func (s *NotificationService) CleanupStalePushTokens(ctx context.Context) {
	slog.DebugContext(ctx, "running stale push token cleanup",
		"function", "CleanupStalePushTokens")

	// Define stale threshold: tokens with last_used_at older than 90 days
	staleThreshold := 90 * 24 * time.Hour
	staleBefore := time.Now().Add(-staleThreshold)

	// Use AdminPool for system-scope operation: scan all organizations
	// Justification: System maintenance requires cross-tenant access
	err := txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		// Direct SQL query for cross-organization cleanup
		// Deletes invalid tokens OR tokens not used in 90+ days
		query := `
			DELETE FROM notification.push_token
			WHERE is_valid = false
			   OR last_used_at < $1
		`

		result, err := tx.Exec(ctx, query, timestamptzFromTime(staleBefore))
		if err != nil {
			slog.ErrorContext(ctx, "failed to execute stale push token cleanup",
				"function", "CleanupStalePushTokens",
				"error", err)
			return err
		}

		deletedCount := result.RowsAffected()
		if deletedCount > 0 {
			slog.InfoContext(ctx, "stale push tokens cleaned up",
				"function", "CleanupStalePushTokens",
				"deletedCount", deletedCount,
				"staleThreshold", staleThreshold.String())
		}

		return nil
	})

	if err != nil {
		if isExpectedShutdownError(ctx, err) {
			slog.InfoContext(ctx, "push token cleanup stopped during shutdown",
				"function", "CleanupStalePushTokens",
				"reason", err)
			return
		}
		slog.ErrorContext(ctx, "push token cleanup transaction failed",
			"function", "CleanupStalePushTokens",
			"error", err)
	}
}

// StartCleanupWorker starts both listener and push token cleanup routines.
// Runs stale listener cleanup every 30 seconds, push token cleanup every 24 hours.
// Connection removal belongs to the presence janitor in registry.go.
func (s *NotificationService) StartCleanupWorker(ctx context.Context) {
	slog.InfoContext(ctx, "starting cleanup worker",
		"function", "StartCleanupWorker")

	// Start stale listener cleanup (every 30 seconds)
	go s.StartCleanupRoutine(ctx, 30*time.Second)

	// Start push token cleanup (every 24 hours)
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()

		// Run cleanup immediately on start
		s.CleanupStalePushTokens(ctx)

		for {
			select {
			case <-ctx.Done():
				slog.InfoContext(ctx, "push token cleanup stopped",
					"function", "StartCleanupWorker",
					"reason", "context cancelled")
				return

			case <-ticker.C:
				s.CleanupStalePushTokens(ctx)
			}
		}
	}()

	slog.InfoContext(ctx, "cleanup workers started",
		"function", "StartCleanupWorker",
		"listenerCleanupInterval", "30s",
		"pushTokenCleanupInterval", "24h")
}
