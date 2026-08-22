package integration

import (
	"context"
	"fmt"
	"os"
	"testing"
)

// TestMain deletes the organisations this run created, once the run is over.
//
// Each test registers its own organisation for isolation, which is what makes the
// package safe to run in parallel — but nothing used to remove them. At roughly 150
// organisations per run the database grew without bound, and the suite slowed down in
// step with it: at 4,800 leftover organisations the serial run took 535s instead of
// 316s and the parallel run 366s instead of 53s, with the added latency pushing
// timing-sensitive presence and PDF-conversion tests into failure. Cleaning up keeps a
// developer's repeated runs as fast as their first.
//
// Only organisations registered by this process are removed, tracked in registeredOrgs,
// so a developer's own data and any run happening concurrently are both left alone. Set
// TECH_OFFICE_KEEP_TEST_DATA=1 to retain the data when debugging a failure.
func TestMain(m *testing.M) {
	code := m.Run()
	if os.Getenv("TECH_OFFICE_KEEP_TEST_DATA") == "" {
		if err := purgeRegisteredOrgs(); err != nil {
			// A cleanup failure must not turn a green run red — report and move on.
			fmt.Fprintf(os.Stderr, "integration: test-data cleanup failed: %v\n", err)
		}
	}
	os.Exit(code)
}

// purgeRegisteredOrgs removes every organisation registered during this run, together
// with its org-scoped rows.
//
// FK triggers are suspended for the delete: organisation subtrees are removed whole, so
// referential integrity holds across the statement, but not every foreign key to
// public.organization is ON DELETE CASCADE — ritual_definition is one that is not — and
// without this the deletes would have to be ordered topologically by hand.
//
// The set of tables is discovered from the catalogue rather than listed, so a new
// tenant-scoped table starts being cleaned up without anyone remembering to add it here.
func purgeRegisteredOrgs() error {
	orgs := takeRegisteredOrgs()
	if len(orgs) == 0 {
		return nil
	}

	ctx := context.Background()
	tx, err := globalDB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin cleanup transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Organisation subtrees are deleted whole, so referential integrity holds across the
	// transaction — but not every foreign key to public.organization is ON DELETE
	// CASCADE (ritual_definition is one that is not), so without this the deletes would
	// have to be ordered topologically by hand. SET LOCAL reverts on commit.
	if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
		return fmt.Errorf("suspend fk triggers: %w", err)
	}

	// The table set is discovered from the catalogue rather than listed, so a new
	// tenant-scoped table starts being cleaned up without anyone remembering to add it.
	rows, err := tx.Query(ctx, `
		SELECT c.table_schema, c.table_name
		  FROM information_schema.columns c
		  JOIN information_schema.tables t
		    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		 WHERE c.column_name  = 'organization_id'
		   AND t.table_type   = 'BASE TABLE'
		   AND c.table_schema NOT IN ('pg_catalog', 'information_schema')`)
	if err != nil {
		return fmt.Errorf("list org-scoped tables: %w", err)
	}
	type table struct{ schema, name string }
	var tables []table
	for rows.Next() {
		var t table
		if err := rows.Scan(&t.schema, &t.name); err != nil {
			rows.Close()
			return fmt.Errorf("scan table name: %w", err)
		}
		tables = append(tables, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("list org-scoped tables: %w", err)
	}

	for _, t := range tables {
		stmt := fmt.Sprintf(`DELETE FROM %q.%q WHERE organization_id = ANY($1)`, t.schema, t.name)
		if _, err := tx.Exec(ctx, stmt, orgs); err != nil {
			return fmt.Errorf("purge %s.%s: %w", t.schema, t.name, err)
		}
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM public.organization WHERE id = ANY($1)`, orgs); err != nil {
		return fmt.Errorf("purge organizations: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit cleanup: %w", err)
	}

	fmt.Fprintf(os.Stderr, "integration: cleaned up %d test organisations\n", len(orgs))
	return nil
}
