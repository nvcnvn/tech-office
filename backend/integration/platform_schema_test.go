package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPlatformSchemaLayout guards the property that feature 062 established: every named
// storage area in the database holds something.
//
// Thirteen schemas were created ahead of features that were never built (crm, finance,
// hiring, payroll and friends). They held nothing for the life of the project, so anybody
// reading the schema list saw a system twice the size of the one that exists. Dropping
// them was a one-time act; this test is what stops the next empty one from lasting a year.
//
// A schema is created by a migration, so a violation here is caught before it merges
// rather than by someone querying pg_namespace out of curiosity.
func TestPlatformSchemaLayout(t *testing.T) {
	t.Parallel()

	t.Run("no schema in the database is empty", func(t *testing.T) {
		// pg_catalog, pg_toast and the other pg_* schemas are PostgreSQL's own, and
		// public holds the migration runner's bookkeeping rather than application data.
		rows, err := globalDB.Query(context.Background(), `
			SELECT n.nspname
			FROM   pg_namespace n
			WHERE  n.nspname NOT LIKE 'pg\_%'
			  AND  n.nspname NOT IN ('information_schema', 'public')
			  AND  NOT EXISTS (
			         SELECT 1 FROM pg_class c
			         WHERE c.relnamespace = n.oid
			       )
			ORDER BY n.nspname
		`)
		require.NoError(t, err)
		defer rows.Close()

		var empty []string
		for rows.Next() {
			var name string
			require.NoError(t, rows.Scan(&name))
			empty = append(empty, name)
		}
		require.NoError(t, rows.Err())

		assert.Empty(t, empty,
			"every schema must hold at least one object; an empty one names a feature that does not exist, so either build it or drop the schema")
	})
}
