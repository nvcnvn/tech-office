// Command tenancylint verifies the multi-tenant schema discipline that keeps this
// database shardable.
//
// We do not run a sharding extension today — one Postgres node is plenty. But the
// property that would let us shard later (on Citus, PgDog, or by hand) is not the
// extension, it is the schema: every tenant table carries organization_id, every
// unique constraint leads with it, and every query pins it. That property is cheap
// to keep and expensive to retrofit, so this linter guards it in CI.
//
// Tenant tables are discovered, not configured: a table that has an organization_id
// column is a tenant table, and one that does not is global (iam.user, iam.session,
// public.permission, flows.*). Nothing to keep in sync.
//
// The query rule is one sentence:
//
//	Every tenant table in a statement must be transitively connected, through
//	organization_id equalities, to an organization_id = <parameter> predicate.
//
// That single rule covers both halves of the discipline. A table joined without
// `a.organization_id = b.organization_id` lands in its own component and fails; a
// statement with no tenant filter at all has no pinned component and fails. Chains
// (a=b, b=c) and CTEs with their own filters both pass, as they should.
//
// Genuinely cross-tenant queries — the cron scans, account deletion — are legitimate
// and are exempted in place:
//
//	-- lint:cross-tenant runs once a minute from the scheduler, org-agnostic by design
//	-- name: ListPendingRemindersGlobal :many
//
// Keeping the exemption next to the query means it shows up in review, which a
// separate allowlist file would not.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	pg "github.com/pganalyze/pg_query_go/v6"
)

const orgCol = "organization_id"

// knownUniqueGaps records unique keys that do not lead with organization_id and that we
// have decided to live with. They are not silenced — the linter prints them as deferred
// items on every run — but they do not fail the build.
//
// Each entry must say what sharding would cost and what the fix is, so the decision can
// be re-taken with the facts rather than re-derived.
var knownUniqueGaps = map[string]string{
	"iam.invitation.invitation_pkey": "invitations are resolved by token before the invitee has an org context, " +
		"so the table is read globally. To shard: widen the key to (organization_id, id).",
	"iam.invitation.invitation_token_key": "the token is the credential and must be unique across all organizations. " +
		"To shard: keep the global uniqueness by moving invitations to a global table, or accept a cross-shard scan on lookup.",
}

// deferred collects known, accepted gaps so a green run still reports them.
var deferred []string

type finding struct {
	file string
	name string
	rule string
	msg  string
}

func main() {
	schemaPath := flag.String("schema", "database/scripts/schema.sql", "generated schema snapshot to read table shapes from")
	queryGlob := flag.String("queries", "database/scripts/*.query.sql", "glob of sqlc query files to check")
	flag.Parse()

	tables, err := loadSchema(*schemaPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "tenancylint: %v\n", err)
		os.Exit(2)
	}

	var findings []finding
	findings = append(findings, checkSchema(*schemaPath, tables)...)

	files, err := filepath.Glob(*queryGlob)
	if err != nil || len(files) == 0 {
		fmt.Fprintf(os.Stderr, "tenancylint: no query files matched %q\n", *queryGlob)
		os.Exit(2)
	}
	sort.Strings(files)
	checked := 0
	for _, f := range files {
		fs, n, err := checkQueryFile(f, tables)
		if err != nil {
			fmt.Fprintf(os.Stderr, "tenancylint: %s: %v\n", f, err)
			os.Exit(2)
		}
		findings = append(findings, fs...)
		checked += n
	}

	tenant := 0
	for _, t := range tables {
		if t.tenant {
			tenant++
		}
	}
	fmt.Printf("tenancylint: %d tables (%d tenant, %d global), %d queries checked\n",
		len(tables), tenant, len(tables)-tenant, checked)

	for _, d := range deferred {
		fmt.Printf("  deferred: %s\n", d)
	}

	if len(findings) == 0 {
		fmt.Println("OK — tenancy discipline holds")
		return
	}
	for _, f := range findings {
		if f.name != "" {
			fmt.Printf("  %s: %s [%s] %s\n", f.file, f.name, f.rule, f.msg)
		} else {
			fmt.Printf("  %s [%s] %s\n", f.file, f.rule, f.msg)
		}
	}
	fmt.Printf("%d finding(s)\n", len(findings))
	os.Exit(1)
}

// ---------------------------------------------------------------- schema

type tableInfo struct {
	tenant bool
	// uniques are the PK and UNIQUE key sets declared for the table, by constraint
	// or index name. A shard key must appear in every one of them.
	uniques map[string][]string
}

func loadSchema(path string) (map[string]*tableInfo, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	tree, err := parse(string(src))
	if err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}

	tables := map[string]*tableInfo{}
	get := func(n node) *tableInfo {
		name := relName(n)
		if name == "" {
			return nil
		}
		if t, ok := tables[name]; ok {
			return t
		}
		t := &tableInfo{uniques: map[string][]string{}}
		tables[name] = t
		return t
	}

	walk(tree, func(kind string, n node) {
		switch kind {
		case "CreateStmt":
			t := get(child(n, "relation"))
			if t == nil {
				return
			}
			for _, elt := range list(n, "tableElts") {
				if col := child(elt, "ColumnDef"); col != nil {
					if str(col, "colname") == orgCol {
						t.tenant = true
					}
				}
				if c := child(elt, "Constraint"); c != nil {
					if keys := constraintKeys(c); keys != nil {
						t.uniques[str(c, "conname")+"@inline"] = keys
					}
				}
			}
		case "AlterTableStmt":
			t := get(child(n, "relation"))
			if t == nil {
				return
			}
			for _, cmd := range list(n, "cmds") {
				c := child(cmd, "AlterTableCmd")
				if c == nil {
					continue
				}
				if str(c, "subtype") == "AT_AddColumn" {
					if col := child(child(c, "def"), "ColumnDef"); col != nil && str(col, "colname") == orgCol {
						t.tenant = true
					}
				}
				if con := child(child(c, "def"), "Constraint"); con != nil {
					if keys := constraintKeys(con); keys != nil {
						t.uniques[str(con, "conname")] = keys
					}
				}
			}
		case "IndexStmt":
			if !boolean(n, "unique") {
				return
			}
			t := get(child(n, "relation"))
			if t == nil {
				return
			}
			// A partial unique index constrains only the rows it covers, so it does not
			// have to lead with the shard key the way a table-wide constraint does.
			if child(n, "whereClause") != nil {
				return
			}
			var keys []string
			for _, p := range list(n, "indexParams") {
				if e := child(p, "IndexElem"); e != nil {
					keys = append(keys, str(e, "name"))
				}
			}
			t.uniques[str(n, "idxname")] = keys
		}
	})
	return tables, nil
}

func constraintKeys(c node) []string {
	switch str(c, "contype") {
	case "CONSTR_PRIMARY", "CONSTR_UNIQUE":
	default:
		return nil
	}
	var keys []string
	for _, k := range list(c, "keys") {
		if s := child(k, "String"); s != nil {
			keys = append(keys, str(s, "sval"))
		}
	}
	return keys
}

// checkSchema enforces the constraint half of the discipline: on a tenant table every
// primary key and unique constraint must include organization_id. Sharding cannot
// enforce a uniqueness that spans shards, so a unique key without the shard key is
// the one schema mistake that is genuinely unfixable later without a data migration.
func checkSchema(path string, tables map[string]*tableInfo) []finding {
	var out []finding
	deferred = nil
	names := make([]string, 0, len(tables))
	for n := range tables {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		t := tables[name]
		if !t.tenant {
			continue
		}
		var bad []string
		for cname, keys := range t.uniques {
			if len(keys) == 0 || contains(keys, orgCol) {
				continue
			}
			bad = append(bad, cname)
		}
		sort.Strings(bad)
		for _, c := range bad {
			if why, ok := knownUniqueGaps[name+"."+c]; ok {
				deferred = append(deferred, fmt.Sprintf("%s.%s — %s", name, c, why))
				continue
			}
			out = append(out, finding{
				file: path, rule: "unique-key",
				msg: fmt.Sprintf("%s: unique key %q does not include %s (keys: %s)",
					name, c, orgCol, strings.Join(t.uniques[c], ", ")),
			})
		}
	}
	return out
}

// ---------------------------------------------------------------- queries

func checkQueryFile(path string, tables map[string]*tableInfo) ([]finding, int, error) {
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, 0, err
	}
	var out []finding
	count := 0
	for _, q := range splitQueries(string(src)) {
		if q.exempt {
			continue
		}
		count++
		tree, err := parse(q.sql)
		if err != nil {
			out = append(out, finding{path, q.name, "parse", err.Error()})
			continue
		}
		if msg := checkStatement(tree, tables); msg != "" {
			out = append(out, finding{path, q.name, "unpinned-tenant-table", msg})
		}
	}
	return out, count, nil
}

type query struct {
	name   string
	sql    string
	exempt bool
}

// splitQueries carves a sqlc query file into its `-- name:` blocks, carrying along the
// lint:cross-tenant marker from the comment block immediately above each one.
func splitQueries(src string) []query {
	var out []query
	var cur *query
	var body []string
	exemptNext := false

	flush := func() {
		if cur != nil {
			cur.sql = strings.Join(body, "\n")
			out = append(out, *cur)
		}
		cur, body = nil, nil
	}
	for _, line := range strings.Split(src, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "-- lint:cross-tenant") {
			exemptNext = true
			continue
		}
		if strings.HasPrefix(trimmed, "-- name:") {
			flush()
			fields := strings.Fields(trimmed)
			name := ""
			if len(fields) >= 3 {
				name = fields[2]
			}
			cur = &query{name: name, exempt: exemptNext}
			exemptNext = false
			continue
		}
		if cur != nil {
			body = append(body, line)
		}
	}
	flush()
	return out
}

// checkStatement applies the one query rule. It walks the whole statement flat rather
// than tracking per-select scopes: a flat walk is permissive about correlated
// subqueries (it will not flag one), which is the right trade for a guard nobody
// should have to argue with. It still catches the failure that matters — a tenant
// table with no organization_id linkage to any parameter.
func checkStatement(tree any, tables map[string]*tableInfo) string {
	// alias (or bare relation name) -> qualified table, for tenant tables only.
	scope := map[string]string{}
	add := func(rv node) {
		name := relName(rv)
		if t, ok := tables[name]; !ok || !t.tenant {
			return
		}
		scope[aliasKey(rv)] = name
	}
	walk(tree, func(kind string, n node) {
		switch kind {
		case "RangeVar":
			add(n)
		case "UpdateStmt", "DeleteStmt", "InsertStmt":
			// The target of a DML statement is a typed RangeVar field rather than a
			// generic Node, so libpg_query emits it without the "RangeVar" wrapper and
			// the walk above never sees it.
			add(child(n, "relation"))
		}
	})
	if len(scope) == 0 {
		return ""
	}

	uf := newUnionFind()
	// Pins are recorded by raw alias and resolved to components only after every
	// union is in: a component's root moves as it grows, so resolving early would
	// strand a pin on a root that no longer represents the component.
	pinned := map[string]bool{}
	pinAll := false

	// Attribute an unqualified `organization_id` to the sole tenant relation when
	// there is exactly one; with several in scope we cannot tell which it meant, so
	// we treat it as pinning everything rather than guess and cry wolf.
	sole := ""
	if len(scope) == 1 {
		for k := range scope {
			sole = k
		}
	}
	resolve := func(qual string) (string, bool) {
		if qual != "" {
			_, ok := scope[qual]
			return qual, ok
		}
		if sole != "" {
			return sole, true
		}
		return "", false
	}

	walk(tree, func(kind string, n node) {
		if kind != "A_Expr" || opName(n) != "=" {
			return
		}
		l, r := unwrap(child(n, "lexpr")), unwrap(child(n, "rexpr"))

		// (a.organization_id, a.x) = (b.organization_id, b.y)
		lrow, rrow := child(l, "RowExpr"), child(r, "RowExpr")
		if lrow != nil && rrow != nil {
			la, ra := list(lrow, "args"), list(rrow, "args")
			for i := 0; i < len(la) && i < len(ra); i++ {
				link(uf, resolve, pinned, &pinAll, unwrap(la[i]), unwrap(ra[i]))
			}
			return
		}
		link(uf, resolve, pinned, &pinAll, l, r)
	})

	if pinAll {
		return ""
	}

	// An INSERT that lists organization_id among its target columns pins its table.
	walk(tree, func(kind string, n node) {
		if kind != "InsertStmt" {
			return
		}
		key := aliasKey(child(n, "relation"))
		for _, c := range list(n, "cols") {
			if rt := child(c, "ResTarget"); rt != nil && str(rt, "name") == orgCol {
				pinned[key] = true
			}
		}
	})

	pinnedRoots := map[string]bool{}
	for alias := range pinned {
		pinnedRoots[uf.find(alias)] = true
	}

	var loose []string
	for alias, table := range scope {
		if !pinnedRoots[uf.find(alias)] {
			loose = append(loose, fmt.Sprintf("%s (as %s)", table, alias))
		}
	}
	if len(loose) == 0 {
		return ""
	}
	sort.Strings(loose)
	return strings.Join(loose, ", ") +
		" not tied to an " + orgCol + " parameter — add the filter, join on " + orgCol +
		", or mark the query `-- lint:cross-tenant <reason>`"
}

// link records one `=` between two expressions: either an organization_id edge between
// two relations, or an organization_id pinned to a query parameter.
func link(uf *unionFind, resolve func(string) (string, bool), pinned map[string]bool, pinAll *bool, l, r node) {
	lq, lIsOrg := orgRef(l)
	rq, rIsOrg := orgRef(r)

	switch {
	case lIsOrg && rIsOrg:
		a, aok := resolve(lq)
		b, bok := resolve(rq)
		if aok && bok {
			uf.union(a, b)
		}
	case lIsOrg && isParam(r):
		if a, ok := resolve(lq); ok {
			pinned[a] = true
		} else if lq == "" {
			*pinAll = true
		}
	case rIsOrg && isParam(l):
		if a, ok := resolve(rq); ok {
			pinned[a] = true
		} else if rq == "" {
			*pinAll = true
		}
	}
}

// orgRef reports whether n is a reference to an organization_id column, and with what
// qualifier ("" when written bare).
func orgRef(n node) (string, bool) {
	cr := child(n, "ColumnRef")
	if cr == nil {
		return "", false
	}
	fields := list(cr, "fields")
	if len(fields) == 0 {
		return "", false
	}
	var parts []string
	for _, f := range fields {
		if s := child(f, "String"); s != nil {
			parts = append(parts, str(s, "sval"))
		}
	}
	if len(parts) == 0 || parts[len(parts)-1] != orgCol {
		return "", false
	}
	if len(parts) == 1 {
		return "", true
	}
	return parts[len(parts)-2], true
}

// isParam reports whether n is something a caller supplies: $1, sqlc.arg()/narg(),
// the @name shorthand (which Postgres parses as the prefix operator @), or a literal.
func isParam(n node) bool {
	if n == nil {
		return false
	}
	if child(n, "ParamRef") != nil || child(n, "A_Const") != nil {
		return true
	}
	if fc := child(n, "FuncCall"); fc != nil {
		var parts []string
		for _, f := range list(fc, "funcname") {
			if s := child(f, "String"); s != nil {
				parts = append(parts, str(s, "sval"))
			}
		}
		return strings.HasPrefix(strings.Join(parts, "."), "sqlc.")
	}
	if e := child(n, "A_Expr"); e != nil {
		return opName(e) == "@"
	}
	return false
}

// unwrap strips the casts sqlc queries put on their parameters (`$1::uuid`).
func unwrap(n node) node {
	for i := 0; i < 8; i++ {
		tc := child(n, "TypeCast")
		if tc == nil {
			return n
		}
		n = child(tc, "arg")
	}
	return n
}

// ---------------------------------------------------------------- json tree helpers

type node = map[string]any

func parse(sql string) (any, error) {
	j, err := pg.ParseToJSON(sql)
	if err != nil {
		return nil, err
	}
	var tree any
	if err := json.Unmarshal([]byte(j), &tree); err != nil {
		return nil, err
	}
	return tree, nil
}

// walk visits every {"NodeType": {...}} pair in the parse tree.
func walk(v any, fn func(kind string, n node)) {
	switch t := v.(type) {
	case map[string]any:
		for k, c := range t {
			if cn, ok := c.(map[string]any); ok {
				fn(k, cn)
			}
			walk(c, fn)
		}
	case []any:
		for _, e := range t {
			walk(e, fn)
		}
	}
}

func child(n node, key string) node {
	if n == nil {
		return nil
	}
	c, _ := n[key].(map[string]any)
	return c
}

func list(n node, key string) []node {
	if n == nil {
		return nil
	}
	raw, _ := n[key].([]any)
	out := make([]node, 0, len(raw))
	for _, e := range raw {
		if m, ok := e.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func str(n node, key string) string {
	if n == nil {
		return ""
	}
	s, _ := n[key].(string)
	return s
}

func boolean(n node, key string) bool {
	if n == nil {
		return false
	}
	b, _ := n[key].(bool)
	return b
}

func opName(expr node) string {
	names := list(expr, "name")
	if len(names) == 0 {
		return ""
	}
	return str(child(names[len(names)-1], "String"), "sval")
}

// relName renders a RangeVar as schema.table, defaulting an omitted schema to public
// the way Postgres does.
func relName(rv node) string {
	if rv == nil {
		return ""
	}
	rel := str(rv, "relname")
	if rel == "" {
		return ""
	}
	schema := str(rv, "schemaname")
	if schema == "" {
		schema = "public"
	}
	return schema + "." + rel
}

// aliasKey names a relation the way the rest of the statement will refer to it.
func aliasKey(rv node) string {
	if a := str(child(rv, "alias"), "aliasname"); a != "" {
		return a
	}
	return str(rv, "relname")
}

func contains(hay []string, needle string) bool {
	for _, h := range hay {
		if h == needle {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- union-find

type unionFind struct{ parent map[string]string }

func newUnionFind() *unionFind { return &unionFind{parent: map[string]string{}} }

func (u *unionFind) find(x string) string {
	if _, ok := u.parent[x]; !ok {
		u.parent[x] = x
		return x
	}
	for u.parent[x] != x {
		u.parent[x] = u.parent[u.parent[x]]
		x = u.parent[x]
	}
	return x
}

func (u *unionFind) union(a, b string) {
	ra, rb := u.find(a), u.find(b)
	if ra != rb {
		u.parent[ra] = rb
	}
}
