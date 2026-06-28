package dbcrud

import (
	"context"
	"fmt"
	"strings"

	"github.com/nvcnvn/tech-office/backend/database"
)

type Structure interface {
	TableName() string
	Fields() ([]string, []any)
	FieldsMap() map[string]any
}

// Create inserts a new record into the database and returns the created record.
// The function takes a context, a database transaction, and a Structure representing the data to be inserted.
func Create(ctx context.Context, tx database.DBTX, req Structure) error {
	// Get the table name and fields from the request
	tableName := req.TableName()
	fieldNames, fieldValues := req.Fields()

	// Build the SQL query
	// INSERT INTO table_name (field1, field2, ...) VALUES ($1, $2, ...) RETURNING (field1, field2, ...)
	query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) RETURNING %s",
		tableName,
		strings.Join(fieldNames, ", "),
		placeholders(len(fieldNames)),
		strings.Join(fieldNames, ", "),
	)

	// Execute the query
	return tx.QueryRow(ctx, query, fieldValues...).Scan(fieldValues...)
}

func placeholders(n int) string {
	ps := make([]string, n)
	for i := range ps {
		ps[i] = fmt.Sprintf("$%d", i+1)
	}
	return strings.Join(ps, ", ")
}
