package notification

import (
	"context"
	"log/slog"
	"time"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/txn"
)

// StartCleanupRoutine starts a background goroutine that periodically cleans up stale connections and push tokens.
//
// System-scope justification:
// This routine scans all organizations' stale connections and push tokens for cleanup.
// Uses context.Background() for system maintenance operations that should continue
// independent of user requests.
//
// Cleanup operations:
//   - Stale active_connection records (last_heartbeat > 60s ago)
//   - Stale push tokens (last_used_at > 90 days ago, optional in this implementation)
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
	s.cleanupStaleConnections(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.InfoContext(ctx, "cleanup routine stopped",
				"function", "StartCleanupRoutine",
				"reason", "context cancelled")
			return

		case <-ticker.C:
			s.cleanupStaleConnections(ctx)
		}
	}
}

// cleanupStaleConnections removes stale connections (last_heartbeat > 60 seconds ago)
// across all organizations.
// Uses AdminPool for cross-organization cleanup with direct SQL.
func (s *NotificationService) cleanupStaleConnections(ctx context.Context) {
	slog.DebugContext(ctx, "running stale connection cleanup",
		"function", "cleanupStaleConnections")

	// Define stale threshold: connections with last_heartbeat older than 60 seconds
	staleThreshold := 60 * time.Second
	staleBefore := time.Now().Add(-staleThreshold)

	// Use AdminPool for system-scope operation: scan all organizations
	// Justification: System maintenance requires cross-tenant access
	err := txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		// Direct SQL query for cross-organization cleanup
		// This is intentionally not using organization_id filter for system-wide cleanup
		query := `
			DELETE FROM notification.active_connection
			WHERE last_heartbeat < $1
		`

		result, err := tx.Exec(ctx, query, timestamptzFromTime(staleBefore))
		if err != nil {
			slog.ErrorContext(ctx, "failed to execute stale connection cleanup",
				"function", "cleanupStaleConnections",
				"error", err)
			return err
		}

		deletedCount := result.RowsAffected()
		if deletedCount > 0 {
			slog.InfoContext(ctx, "stale connections cleaned up",
				"function", "cleanupStaleConnections",
				"deletedCount", deletedCount,
				"staleThreshold", staleThreshold.String())
		}

		listenerQuery := `
			DELETE FROM notification.active_listener
			WHERE last_heartbeat < $1
		`

		listenerResult, err := tx.Exec(ctx, listenerQuery, timestamptzFromTime(staleBefore))
		if err != nil {
			slog.ErrorContext(ctx, "failed to execute stale listener cleanup",
				"function", "cleanupStaleConnections",
				"error", err)
			return err
		}

		listenerDeletedCount := listenerResult.RowsAffected()
		if listenerDeletedCount > 0 {
			slog.InfoContext(ctx, "stale listeners cleaned up",
				"function", "cleanupStaleConnections",
				"deletedCount", listenerDeletedCount,
				"staleThreshold", staleThreshold.String())
		}

		return nil
	})

	if err != nil {
		if isExpectedShutdownError(ctx, err) {
			slog.InfoContext(ctx, "stale connection cleanup stopped during shutdown",
				"function", "cleanupStaleConnections",
				"reason", err)
			return
		}
		slog.ErrorContext(ctx, "cleanup transaction failed",
			"function", "cleanupStaleConnections",
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

// StartCleanupWorker starts both connection and push token cleanup routines
// Runs stale connection cleanup every 30 seconds, push token cleanup every 24 hours
func (s *NotificationService) StartCleanupWorker(ctx context.Context) {
	slog.InfoContext(ctx, "starting cleanup worker",
		"function", "StartCleanupWorker")

	// Start stale connection cleanup (every 30 seconds)
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
		"connectionCleanupInterval", "30s",
		"pushTokenCleanupInterval", "24h")
}
