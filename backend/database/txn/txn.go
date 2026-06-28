package txn

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/nvcnvn/tech-office/backend/database"
)

type TransactionStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// WithTxn executes a function within a database transaction.
// The transaction is automatically rolled back if the function returns an error or panics.
func WithTxn(ctx context.Context, db TransactionStarter, fn func(context.Context, database.DBTX) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	// Ensure cleanup happens even if function panics
	defer func() {
		if p := recover(); p != nil {
			tx.Rollback(ctx) // Best effort rollback on panic
			panic(p)         // Re-raise the panic
		}
	}()

	err = fn(ctx, tx)
	if err != nil {
		// Attempt rollback, but preserve original error
		if rbErr := tx.Rollback(ctx); rbErr != nil {
			return fmt.Errorf("transaction failed: %w (rollback also failed: %v)", err, rbErr)
		}
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
