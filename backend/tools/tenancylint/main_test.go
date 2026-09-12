package main

import (
	"os"
	"strings"
	"testing"
)

// tenant tables for the cases below; anything absent is treated as global.
var testTables = map[string]*tableInfo{
	"chat.message":                        {tenant: true},
	"chat.channel_membership":             {tenant: true},
	"collaboration.task":                  {tenant: true},
	"collaboration.task_assignee":         {tenant: true},
	"notification.notification":           {tenant: true},
	"notification.notification_recipient": {tenant: true},
	"iam.user":                            {tenant: false},
	"iam.identity":                        {tenant: true},
}

func TestCheckStatement(t *testing.T) {
	cases := []struct {
		name string
		sql  string
		ok   bool
	}{
		{"single table pinned", `SELECT * FROM chat.message WHERE organization_id = $1`, true},
		{"single table unpinned", `SELECT * FROM chat.message WHERE id = $1`, false},

		{"join colocated and pinned", `
			SELECT * FROM collaboration.task t
			JOIN collaboration.task_assignee ta ON ta.organization_id = t.organization_id AND ta.task_id = t.id
			WHERE t.organization_id = $1`, true},
		{"join missing the org_id predicate", `
			SELECT * FROM collaboration.task t
			JOIN collaboration.task_assignee ta ON ta.task_id = t.id
			WHERE t.organization_id = $1`, false},

		// Regression: the pin was seen before the union, so it landed on a union-find
		// root that stopped representing the component once the join was merged in.
		{"pin recorded before the join is merged", `
			SELECT COUNT(*) FROM chat.message m
			JOIN chat.channel_membership cm ON (cm.organization_id, cm.channel_id) = (m.organization_id, m.channel_id)
			WHERE cm.organization_id = $3`, true},

		// Regression: a DML target relation is a typed RangeVar field, so libpg_query
		// emits it unwrapped and the generic "RangeVar" walk never visited it.
		{"UPDATE ... FROM with the target aliased", `
			UPDATE notification.notification_recipient nr SET read_status = true
			FROM notification.notification n
			WHERE nr.organization_id = n.organization_id AND nr.notification_id = n.id
			  AND nr.organization_id = $2`, true},
		{"UPDATE unpinned", `UPDATE notification.notification SET title = $2 WHERE id = $1`, false},
		{"DELETE pinned", `DELETE FROM chat.message WHERE organization_id = $1 AND id = $2`, true},

		{"sqlc.arg counts as a parameter", `SELECT * FROM chat.message WHERE organization_id = sqlc.arg('organization_id')::uuid`, true},
		{"@name counts as a parameter", `SELECT * FROM chat.message WHERE organization_id = @organization_id`, true},

		{"INSERT listing organization_id", `INSERT INTO chat.message (id, organization_id, body) VALUES ($1, $2, $3)`, true},
		{"INSERT omitting organization_id", `INSERT INTO chat.message (id, body) VALUES ($1, $2)`, false},

		{"global tables only", `SELECT * FROM iam.user WHERE email = $1`, true},
		{"tenant joined to a global table still needs its pin", `
			SELECT * FROM iam.identity i JOIN iam.user u ON u.id = i.user_id WHERE u.email = $1`, false},

		// A chain a=b, b=c pins c through b, and a CTE carrying its own filter is its
		// own component rather than a violation.
		{"transitive org_id chain", `
			SELECT * FROM collaboration.task t
			JOIN collaboration.task_assignee ta ON ta.organization_id = t.organization_id
			JOIN chat.message m ON m.organization_id = ta.organization_id
			WHERE t.organization_id = $1`, true},
		{"CTE pinned separately from the outer query", `
			WITH recent AS (SELECT id FROM chat.message WHERE organization_id = $1)
			SELECT * FROM collaboration.task t WHERE t.organization_id = $1 AND t.id IN (SELECT id FROM recent)`, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tree, err := parse(c.sql)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			msg := checkStatement(tree, testTables)
			if c.ok && msg != "" {
				t.Errorf("expected clean, got finding: %s", msg)
			}
			if !c.ok && msg == "" {
				t.Error("expected a finding, got clean")
			}
		})
	}
}

func TestSplitQueriesCarriesExemption(t *testing.T) {
	qs := splitQueries(`
-- name: Plain :one
SELECT 1;

-- lint:cross-tenant scheduler sweep
-- name: Exempt :many
SELECT 2;
`)
	if len(qs) != 2 {
		t.Fatalf("got %d queries, want 2", len(qs))
	}
	if qs[0].name != "Plain" || qs[0].exempt {
		t.Errorf("first query: %+v", qs[0])
	}
	if qs[1].name != "Exempt" || !qs[1].exempt {
		t.Errorf("second query: %+v", qs[1])
	}
}

// TestForeignKeySetNullTenantColumn covers rule set-null-tenant-column: a composite
// foreign key on a tenant table may not null the whole key, and may not name the tenant
// column among the columns it does null. Each case is DDL rather than a hand-built
// tableInfo, so the parse and the rule are exercised together — the parse is where this
// rule can silently stop working, because it depends on pg_dump emitting the column list.
func TestForeignKeySetNullTenantColumn(t *testing.T) {
	const parent = `CREATE TABLE chat.message (organization_id uuid NOT NULL, id uuid NOT NULL);
`
	cases := []struct {
		name string
		ddl  string
		want bool // want a finding
	}{
		{
			name: "composite SET NULL with no column list nulls the tenant column",
			ddl: `CREATE TABLE collaboration.task (organization_id uuid NOT NULL, source_message_id uuid);
			      ALTER TABLE collaboration.task ADD CONSTRAINT fk_task_source_message
			          FOREIGN KEY (organization_id, source_message_id)
			          REFERENCES chat.message(organization_id, id) ON DELETE SET NULL;`,
			want: true,
		},
		{
			name: "composite SET NULL naming only the pointer is the fix",
			ddl: `CREATE TABLE collaboration.task (organization_id uuid NOT NULL, source_message_id uuid);
			      ALTER TABLE collaboration.task ADD CONSTRAINT fk_task_source_message
			          FOREIGN KEY (organization_id, source_message_id)
			          REFERENCES chat.message(organization_id, id) ON DELETE SET NULL (source_message_id);`,
			want: false,
		},
		{
			name: "a column list that names the tenant column is the defect itself",
			ddl: `CREATE TABLE collaboration.task (organization_id uuid NOT NULL, source_message_id uuid);
			      ALTER TABLE collaboration.task ADD CONSTRAINT fk_task_source_message
			          FOREIGN KEY (organization_id, source_message_id)
			          REFERENCES chat.message(organization_id, id)
			          ON DELETE SET NULL (organization_id, source_message_id);`,
			want: true,
		},
		{
			name: "single-column SET NULL on a global table",
			ddl: `CREATE TABLE flows.step (id uuid NOT NULL, message_id uuid);
			      ALTER TABLE flows.step ADD CONSTRAINT fk_step_message
			          FOREIGN KEY (message_id) REFERENCES chat.message(id) ON DELETE SET NULL;`,
			want: false,
		},
		{
			name: "single-column SET NULL on a tenant table has no tenant column to null",
			ddl: `CREATE TABLE collaboration.task (organization_id uuid NOT NULL, source_message_id uuid);
			      ALTER TABLE collaboration.task ADD CONSTRAINT fk_task_source_message
			          FOREIGN KEY (source_message_id) REFERENCES chat.message(id) ON DELETE SET NULL;`,
			want: false,
		},
		{
			name: "composite SET DEFAULT fails the same way, since the tenant column has none",
			ddl: `CREATE TABLE collaboration.task (organization_id uuid NOT NULL, source_message_id uuid);
			      ALTER TABLE collaboration.task ADD CONSTRAINT fk_task_source_message
			          FOREIGN KEY (organization_id, source_message_id)
			          REFERENCES chat.message(organization_id, id) ON DELETE SET DEFAULT;`,
			want: true,
		},
		{
			name: "composite CASCADE is out of the rule's scope",
			ddl: `CREATE TABLE voice.voice_message (organization_id uuid NOT NULL, message_id uuid);
			      ALTER TABLE voice.voice_message ADD CONSTRAINT fk_voice_message_message
			          FOREIGN KEY (organization_id, message_id)
			          REFERENCES chat.message(organization_id, id) ON DELETE CASCADE;`,
			want: false,
		},
		{
			name: "composite RESTRICT is out of the rule's scope",
			ddl: `CREATE TABLE collaboration.task (organization_id uuid NOT NULL, channel_id uuid);
			      ALTER TABLE collaboration.task ADD CONSTRAINT fk_task_channel
			          FOREIGN KEY (organization_id, channel_id)
			          REFERENCES chat.channel(organization_id, id) ON DELETE RESTRICT;`,
			want: false,
		},
		{
			name: "an inline table constraint is read the same as an ALTER TABLE one",
			ddl: `CREATE TABLE collaboration.task (
			          organization_id uuid NOT NULL,
			          source_message_id uuid,
			          CONSTRAINT fk_task_source_message FOREIGN KEY (organization_id, source_message_id)
			              REFERENCES chat.message(organization_id, id) ON DELETE SET NULL);`,
			want: true,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tables, err := collectSchema(parent + c.ddl)
			if err != nil {
				t.Fatalf("collectSchema: %v", err)
			}
			got := checkForeignKeys("schema.sql", tables)
			if c.want && len(got) == 0 {
				t.Fatal("expected a finding, got clean")
			}
			if !c.want && len(got) != 0 {
				t.Fatalf("expected clean, got: %s", got[0].msg)
			}
			if c.want {
				if got[0].rule != "set-null-tenant-column" {
					t.Errorf("rule = %q", got[0].rule)
				}
				// The message has to name the constraint and state the fix, or the
				// person who hits it in CI has to go and read this file.
				for _, want := range []string{"fk_task_source_message", orgCol, "ON DELETE SET"} {
					if !strings.Contains(got[0].msg, want) {
						t.Errorf("message %q does not mention %q", got[0].msg, want)
					}
				}
			}
		})
	}
}

// TestRealSchemaHasNoSetNullTenantColumn is the one case that guards the property rather
// than the rule: the generated snapshot this linter ships against must be clean. It also
// proves pg_dump round-trips the column list — if it did not, every fixed constraint
// would show up here as a finding.
func TestRealSchemaHasNoSetNullTenantColumn(t *testing.T) {
	src, err := os.ReadFile("../../database/scripts/schema.sql")
	if err != nil {
		t.Fatalf("reading the generated snapshot: %v", err)
	}
	tables, err := collectSchema(string(src))
	if err != nil {
		t.Fatalf("collectSchema: %v", err)
	}
	for _, f := range checkForeignKeys("database/scripts/schema.sql", tables) {
		t.Errorf("%s", f.msg)
	}
}
