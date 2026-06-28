package notification

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
)

func isExpectedShutdownError(ctx context.Context, err error) bool {
	if err == nil {
		return false
	}

	// Only treat as expected shutdown when the context is actually canceled.
	// Connection errors (conn closed, etc.) should NOT be treated as shutdown
	// — they indicate a broken connection that needs reconnection.
	if ctx != nil && ctx.Err() != nil {
		return true
	}

	return errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded)
}

// isConnectionError returns true if the error indicates a broken database connection
// that may be recoverable via reconnection.
func isConnectionError(err error) bool {
	if err == nil {
		return false
	}

	// Check for PostgreSQL-level errors via SQLSTATE codes (structured check).
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch {
		// Class 57 — Operator Intervention (includes crash recovery, restart, etc.)
		case pgerrcode.IsOperatorIntervention(pgErr.Code):
			return true
		// Class 08 — Connection Exception
		case pgerrcode.IsConnectionException(pgErr.Code):
			return true
		}
	}

	// Fallback: transport-level errors that don't produce a PgError
	// (e.g. the connection was already torn down before PG could reply).
	msg := err.Error()
	return strings.Contains(msg, "closed pool") ||
		strings.Contains(msg, "conn closed") ||
		strings.Contains(msg, "use of closed network connection") ||
		strings.Contains(msg, "broken pipe") ||
		strings.Contains(msg, "connection reset")
}
