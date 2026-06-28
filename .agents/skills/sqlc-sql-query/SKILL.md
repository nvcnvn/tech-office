---
name: sqlc-sql-query
description: "Write sqlc-annotated SQL queries for PostgreSQL that generate type-safe Go code. Use when creating, modifying, or troubleshooting .query.sql files, query annotations (:one, :many, :exec, etc.), named parameters (@param), sqlc macros (sqlc.arg, sqlc.narg, sqlc.embed), type casting for strong typing, partial updates with COALESCE, cursor pagination, array parameters, RETURNING clauses, batch operations (:copyfrom), and overrides in sqlc.yaml."
---

# sqlc SQL Query Writing Guide

This skill covers writing sqlc-annotated PostgreSQL queries that generate clean, type-safe Go code. **This project uses PostgreSQL with pgx/v5.**

## Query Annotation Format

Every query MUST have a name comment in this exact format:

```sql
-- name: <MethodName> <command>
```

### Available Commands

| Command | Returns | Use When |
|---------|---------|----------|
| `:one` | Single struct/value + error | SELECT expecting exactly one row, INSERT/UPDATE with RETURNING |
| `:many` | Slice of structs + error | SELECT returning multiple rows |
| `:exec` | error only | INSERT/UPDATE/DELETE when you don't need returned data |
| `:execrows` | int64 (affected rows) + error | DELETE/UPDATE when you need the count of affected rows |
| `:execresult` | sql.Result + error | When you need both last-insert-id and rows-affected |
| `:copyfrom` | int64 + error | Bulk INSERT using PostgreSQL COPY protocol (pgx only) |
| `:batchexec` | Batch object | Batch DELETE/UPDATE operations (pgx only) |
| `:batchone` | Batch object | Batch INSERT with RETURNING (pgx only) |
| `:batchmany` | Batch object | Batch SELECT returning multiple rows per query (pgx only) |

## Named Parameters — ALWAYS Prefer `@name` Over `$N`

**CRITICAL RULE**: Use `@column_name` named parameters instead of positional `$1`, `$2` whenever possible. This produces readable Go code with meaningful field names in the Params struct.

### `@param` — Named parameter shorthand

The `@` operator is a shortcut for `sqlc.arg()`. Use it for all non-nullable parameters:

```sql
-- GOOD: Named parameters — Go struct fields have meaningful names
-- name: GetTaskReporter :one
SELECT t.reporter_employee_id AS employee_id
FROM collaboration.task t
WHERE t.organization_id = @organization_id
  AND t.id = @task_id
  AND t.is_deleted = false;

-- BAD: Positional parameters — Go struct fields get generic names
-- name: GetTaskReporter :one
SELECT t.reporter_employee_id AS employee_id
FROM collaboration.task t
WHERE t.organization_id = $1
  AND t.id = $2
  AND t.is_deleted = false;
```

### `sqlc.arg('name')` — Verbose named parameter

Equivalent to `@name`. Use when you need to explicitly cast inline:

```sql
-- name: SearchChannels :many
SELECT * FROM chat.channel
WHERE organization_id = sqlc.arg('organization_id')
  AND title_slug ILIKE sqlc.arg('query')::text
LIMIT sqlc.arg('limit')::int;
```

### `sqlc.narg('name')` — Nullable named parameter

Forces the generated Go field to be nullable (pointer or pgtype). Use for **optional** filter parameters and **partial updates**:

```sql
-- name: UpdateProject :one
UPDATE collaboration.project
SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    visibility = COALESCE(sqlc.narg('visibility'), visibility),
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;
```

**There is no `@` equivalent for nullable args** — you must use `sqlc.narg('name')`.

### When to mix `$N` and `@name`

You CAN mix positional and named parameters, but prefer all-named for clarity. The only practical reason to use `$N` is when the same parameter is used once and the position is obvious (e.g., a simple single-param query):

```sql
-- Acceptable for trivial single-param queries
-- name: DeleteAuthor :exec
DELETE FROM authors WHERE id = $1;

-- But prefer named for multi-param queries
-- name: DeleteAuthor :exec
DELETE FROM authors
WHERE id = @id AND organization_id = @organization_id;
```

## Type Casting for Strong Typing

**CRITICAL RULE**: Always cast expressions so sqlc generates strongly-typed Go code instead of `interface{}`.

### Cast subquery results to concrete types

```sql
-- GOOD: Cast to uuid[] — Go gets []dbuuid.UUID
(
    SELECT COALESCE(array_agg(DISTINCT replies.author_employee_id ORDER BY replies.author_employee_id), ARRAY[]::uuid[])
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
)::uuid[] AS thread_participant_ids,

-- BAD: No cast — Go gets interface{} or pgtype.Array
(
    SELECT COALESCE(array_agg(DISTINCT replies.author_employee_id), '{}')
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
) AS thread_participant_ids,
```

### Cast empty array literals

```sql
-- GOOD: Typed empty array
ARRAY[]::uuid[]
ARRAY[]::text[]

-- BAD: Untyped — sqlc can't infer the Go type
'{}'
ARRAY[]
```

### Cast nullable parameters in WHERE clauses

```sql
-- GOOD: Cast tells sqlc the parameter type
AND (sqlc.narg('cursor')::uuid IS NULL OR p.id < sqlc.narg('cursor'))
AND (sqlc.narg('context_ids')::uuid[] IS NULL OR far.context_id = ANY(sqlc.narg('context_ids')::uuid[]))
AND sqlc.narg('sort_by')::text = 'size'

-- BAD: No cast — sqlc may infer wrong type
AND (sqlc.narg('cursor') IS NULL OR p.id < sqlc.narg('cursor'))
```

### Cast aggregation results

```sql
-- GOOD: Explicit return type
SELECT instance_id, array_agg(employee_id)::uuid[] AS employee_ids
FROM notification.active_connection
GROUP BY instance_id;

-- Cast count to specific int type if needed
SELECT count(*)::int AS total_count FROM authors;
```

## Common Query Patterns

### SELECT — Retrieving Rows

**Single row:**
```sql
-- name: GetProject :one
SELECT * FROM collaboration.project
WHERE organization_id = @organization_id AND id = @id;
```

**Multiple rows with cursor pagination (UUID v7):**
```sql
-- name: ListProjects :many
SELECT p.* FROM collaboration.project p
WHERE p.organization_id = @organization_id
  AND (sqlc.narg('include_archived')::boolean IS TRUE OR p.is_archived = FALSE)
  AND (sqlc.narg('cursor')::uuid IS NULL OR p.id < sqlc.narg('cursor'))
ORDER BY p.updated_at DESC, p.id DESC
LIMIT @page_limit;
```

**Passing a slice/array parameter (PostgreSQL ANY):**
```sql
-- name: ListAuthorsByIDs :many
SELECT * FROM authors
WHERE id = ANY(@ids::uuid[]);

-- name: ValidateEmployeesExist :many
SELECT e.id FROM organization.employee e
WHERE e.organization_id = @organization_id
  AND e.id = ANY(@employee_ids::uuid[]);
```

### INSERT — Creating Rows

**Simple insert (no return):**
```sql
-- name: CreateAuthor :exec
INSERT INTO authors (name, bio) VALUES (@name, @bio);
```

**Insert with RETURNING (get the created row back):**
```sql
-- name: CreateProject :one
INSERT INTO collaboration.project (
    id, organization_id, name, key, description, visibility, owner_employee_id
) VALUES (
    @id, @organization_id, @name, @key, @description, @visibility, @owner_employee_id
)
RETURNING *;
```

**Upsert with ON CONFLICT:**
```sql
-- name: UpsertResourceSubscription :one
INSERT INTO notification.resource_subscription (
    organization_id, employee_id, resource_domain, resource_id,
    subscription_state, preference_level, updated_at
) VALUES (
    @organization_id, @employee_id, @resource_domain, @resource_id,
    @subscription_state, @preference_level, @updated_at
)
ON CONFLICT (organization_id, employee_id, resource_domain, resource_id)
DO UPDATE SET
    subscription_state = EXCLUDED.subscription_state,
    preference_level = EXCLUDED.preference_level,
    updated_at = @updated_at
RETURNING *;
```

**Bulk insert with COPY protocol:**
```sql
-- name: CreateNotificationRecipientsBatch :copyfrom
INSERT INTO notification.notification_recipient (
    notification_id, employee_id, organization_id, recipient_type, target_department_ids
) VALUES (
    $1, $2, $3, $4, $5
);
```

> Note: `:copyfrom` requires `$N` positional parameters, not named params. It generates a method accepting a slice of params structs.

### UPDATE — Modifying Rows

**Partial update with COALESCE + sqlc.narg (update only provided fields):**
```sql
-- name: UpdateProject :one
UPDATE collaboration.project
SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    visibility = COALESCE(sqlc.narg('visibility'), visibility),
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;
```

This pattern generates nullable fields in the Go Params struct. Pass `nil` to skip updating a field, or a value to update it.

**Full update:**
```sql
-- name: UpdateAuthor :exec
UPDATE authors SET bio = @bio
WHERE id = @id;
```

**Increment/counter update:**
```sql
-- name: IncrementProjectTaskNumber :one
UPDATE collaboration.project
SET next_task_number = next_task_number + 1, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING key, next_task_number;
```

**Array manipulation:**
```sql
-- name: AppendTaskFileID :one
UPDATE collaboration.task
SET file_ids = array_append(file_ids, @file_id::uuid), updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @task_id
RETURNING *;
```

### DELETE — Removing Rows

**Simple delete:**
```sql
-- name: DeletePersonalPreference :exec
DELETE FROM notification.personal_preference
WHERE organization_id = @organization_id AND employee_id = @employee_id;
```

**Delete with affected row count:**
```sql
-- name: CleanupStaleConnections :execrows
DELETE FROM notification.active_connection
WHERE organization_id = @organization_id
  AND last_heartbeat < @cutoff_time;
```

### COUNT — Counting Rows

```sql
-- name: CountAuthors :one
SELECT count(*) FROM authors;

-- name: CountAuthorsByTown :many
SELECT hometown, count(*) FROM authors
GROUP BY 1 ORDER BY 1;
```

## Macros

### `sqlc.embed(table)` — Embed Model Structs

Use when JOINing tables and you want nested Go structs instead of flat fields:

```sql
-- name: GetMessageWithChannel :one
SELECT
  sqlc.embed(m),
  c.title_slug AS channel_slug,
  c.display_name AS channel_display_name
FROM chat.message m
JOIN chat.channel c ON c.id = m.channel_id AND c.organization_id = m.organization_id
WHERE m.id = @message_id AND m.organization_id = @organization_id;
```

Generated Go:
```go
type GetMessageWithChannelRow struct {
    Message            Message  // embedded struct
    ChannelSlug        string
    ChannelDisplayName string
}
```

### `sqlc.slice('name')` — Dynamic IN Clause (MySQL/SQLite only)

**Not needed for PostgreSQL** — use `ANY(@param::type[])` instead.

## Optional Filter Pattern

The `IS NULL OR` pattern lets callers skip filters by passing nil:

```sql
-- name: ListFiles :many
SELECT * FROM files.file_metadata
WHERE organization_id = @organization_id
  AND (sqlc.narg('context')::text IS NULL OR upload_context = sqlc.narg('context'))
  AND (sqlc.narg('context_ids')::uuid[] IS NULL OR context_id = ANY(sqlc.narg('context_ids')::uuid[]))
  AND is_deleted = FALSE
ORDER BY updated_at DESC
LIMIT @page_limit OFFSET @page_offset;
```

When the Go caller passes `nil` for `Context`, the filter is skipped entirely.

## Dynamic Sort Pattern

Use `CASE WHEN` with `sqlc.narg` for sortable columns:

```sql
ORDER BY
  CASE WHEN sqlc.narg('sort_by') = 'size' AND sqlc.narg('sort_order') = 'asc' THEN size_bytes END ASC,
  CASE WHEN sqlc.narg('sort_by') = 'size' AND sqlc.narg('sort_order') = 'desc' THEN size_bytes END DESC,
  CASE WHEN (sqlc.narg('sort_by') IS NULL OR sqlc.narg('sort_by') = 'updated_at')
    AND (sqlc.narg('sort_order') IS NULL OR sqlc.narg('sort_order') = 'desc') THEN updated_at END DESC
```

## Transactions

sqlc generates a `WithTx` method. Use it to run multiple queries in a transaction:

```go
tx, err := pool.Begin(ctx)
if err != nil {
    return err
}
defer tx.Rollback(ctx)

qtx := queries.WithTx(tx)
project, err := qtx.CreateProject(ctx, db, params)
if err != nil {
    return err
}
err = qtx.IncrementProjectTaskCount(ctx, db, ...)
if err != nil {
    return err
}
return tx.Commit(ctx)
```

With pgx/v5, prepared statements are handled implicitly — no special sqlc config needed.

## DDL / Schema

sqlc parses `CREATE TABLE`, `ALTER TABLE`, and migration files to understand the schema. This project uses a single schema file:

```yaml
schema:
  - ./database/scripts/schema.sql
```

sqlc supports migration tools (goose, golang-migrate, dbmate, etc.) by ignoring down-migration blocks.

## Struct Configuration

Structs are auto-generated from table definitions. Key behaviors:

- Table `authors` → struct `Author` (auto-singularized)
- Column `created_at` → field `CreatedAt` (underscore → CamelCase)
- Nullable columns → pgtype nullable types (e.g., `pgtype.Text`, `pgtype.UUID`)
- JSON tags are emitted (`emit_json_tags: true` in config)
- `id` field with UUID type → `dbuuid.UUID` (per project overrides)
- Nullable UUID → `dbuuid.NullUUID` (per project overrides)

### Embedding Structs

Use `sqlc.embed(table_alias)` in SELECT to nest model structs:

```sql
SELECT sqlc.embed(students), sqlc.embed(test_scores)
FROM students
JOIN test_scores ON test_scores.student_id = students.id;
```

Generates:
```go
type Row struct {
    Student   Student
    TestScore TestScore
}
```

## Overriding Types

Configure in `sqlc.yaml` under `overrides`:

```yaml
overrides:
  - db_type: "uuid"
    go_type:
      import: "github.com/nvcnvn/tech-office/backend/database/dbuuid"
      type: "UUID"
  - db_type: "uuid"
    nullable: true
    go_type:
      import: "github.com/nvcnvn/tech-office/backend/database/dbuuid"
      type: "NullUUID"
```

Override by column name for specific tables:
```yaml
overrides:
  - column: "books.data"
    go_type:
      import: "example.com/db/dto"
      package: "dto"
      type: "BookData"
      pointer: true
```

### go_type map keys

| Key | Purpose |
|-----|---------|
| `import` | Go import path |
| `package` | Package name (if import path doesn't end with it) |
| `type` | Type name without package prefix |
| `pointer` | Use `*Type` instead of `Type` |
| `slice` | Use `[]Type` instead of `Type` |

## Renaming Fields

Override generated struct field names in `sqlc.yaml`:

```yaml
rename:
  spotify_url: "SpotifyURL"
  id: "ID"
```

Rename table struct names:
```yaml
rename:
  author: Writer
  book_publisher: Publisher
```

## PostgreSQL Data Types → Go Types

| PostgreSQL | Go (pgx/v5) | Go (nullable, pgx/v5) |
|------------|-------------|----------------------|
| `serial`, `integer` | `int32` | `pgtype.Int4` |
| `bigserial`, `bigint` | `int64` | `pgtype.Int8` |
| `text`, `varchar` | `string` | `pgtype.Text` |
| `boolean` | `bool` | `pgtype.Bool` |
| `timestamp`, `timestamptz` | `pgtype.Timestamp`/`pgtype.Timestamptz` | same |
| `uuid` | `dbuuid.UUID` (project override) | `dbuuid.NullUUID` |
| `jsonb` | `[]byte` | `[]byte` |
| `text[]` | `[]string` | `[]string` |
| `uuid[]` | `[]dbuuid.UUID` | `[]dbuuid.UUID` |
| `enum` type | Generated string alias | same |

## Project-Specific Config

This project's `sqlc.yaml` uses:
- **Engine**: `postgresql`
- **SQL package**: `pgx/v5`
- **emit_json_tags**: `true`
- **emit_result_struct_pointers**: `true` — result structs are returned as pointers
- **emit_params_struct_pointers**: `true` — param structs are passed as pointers
- **emit_methods_with_db_argument**: `true` — generated methods take a `db DBTX` argument
- **UUID override**: All `uuid` columns map to `dbuuid.UUID` / `dbuuid.NullUUID`
- **Code generation plugin**: Custom fork `sqlc-gen-go-crud`

## Quick Checklist for Writing Queries

1. **Name comment**: `-- name: MethodName :command` on the line before the query
2. **Named params**: Use `@param_name` for non-nullable, `sqlc.narg('param_name')` for nullable/optional
3. **Type cast**: Cast subqueries, empty arrays, and nullable params (e.g., `::uuid[]`, `::text`, `::boolean`)
4. **COALESCE pattern**: For partial updates: `SET col = COALESCE(sqlc.narg('col'), col)`
5. **Cursor pagination**: `AND (sqlc.narg('cursor')::uuid IS NULL OR id < sqlc.narg('cursor'))`
6. **Array params**: Use `ANY(@ids::uuid[])` not `IN ($1, $2, ...)`
7. **RETURNING**: Use `:one` with `RETURNING *` for INSERT/UPDATE when you need the result
8. **Embed**: Use `sqlc.embed(table)` for JOINs to get nested Go structs
9. **Bulk insert**: Use `:copyfrom` with positional `$N` params for high-performance batch inserts
10. **Row count**: Use `:execrows` when you need the number of affected rows