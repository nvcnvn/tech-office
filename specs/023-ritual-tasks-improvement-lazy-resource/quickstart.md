# Quickstart: Ritual Tasks Improvement Feature

**Feature**: 023-ritual-tasks-improvement-lazy-resource  
**Branch**: `023-ritual-tasks-improvement-lazy-resource`

---

## Prerequisites

```bash
# Ensure you're on the right branch
git checkout 023-ritual-tasks-improvement-lazy-resource

# Start the local Docker stack (PostgreSQL + dependencies)
cd backend
docker compose up -d
```

---

## Step 1: Apply Database Migration

```bash
# Run pending migrations (golang-migrate)
cd backend
./scripts/migrate.sh up
```

This applies the migration that adds:
- `collaboration.task.detached_from_ritual BOOLEAN NOT NULL DEFAULT FALSE`
- `collaboration.ritual_definition.schedule_version INT NOT NULL DEFAULT 1`

**Verify migration applied**:

```bash
docker compose exec postgres psql -P pager -U postgres -d tech_office_db \
  -c "\d collaboration.task" | grep detached_from_ritual

docker compose exec postgres psql -P pager -U postgres -d tech_office_db \
  -c "\d collaboration.ritual_definition" | grep schedule_version
```

---

## Step 2: Regenerate sqlc Code

After modifying `backend/database/scripts/collaboration.query.sql`:

```bash
cd backend
sqlc generate
```

Commits the following generated files (do not hand-edit these):
- `backend/database/collaboration.query.sql.go`
- `backend/database/models.go` (if struct fields changed)
- `backend/database/copyfrom.go` (if bulk-insert queries added)

---

## Step 3: Regenerate Protobuf Code

After modifying `backend/rpc/v1/collaboration.proto`:

```bash
cd backend
buf generate
```

Commits the following generated files:
- `backend/rpc/v1/collaboration.pb.go`
- `backend/rpc/v1/collaborationv1connect/collaboration.connect.go`

After backend generation, rebuild frontend RPC package:

```bash
cd frontend
pnpm -w -r build
```

This picks up the new TypeScript types generated from the updated proto.

---

## Step 4: Run Integration Tests

### Run Feature-Specific Tests Only

```bash
cd backend
go test ./integration/... -run TestRitualTasksImprovement -v -count=1
```

### Run All Collaboration Integration Tests

```bash
cd backend
go test ./integration/... -run "TestRitual|TestTask" -v -count=1
```

### Run Full Integration Test Suite (Required Before Merge)

```bash
cd backend
go test ./integration/... -v -count=1 2>&1 | tail -50
```

All tests must pass (0 failures). No `t.Skip` stubs may remain.

---

## Step 5: Local Manual Verification

### Verify Lazy Resource Creation

```bash
# After running the scheduler, check that newly created ritual instances
# have NULL channel_id and description_document_id
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c "
  SELECT id, title, task_kind, channel_id, description_document_id
  FROM collaboration.task
  WHERE task_kind = 'ritual_instance'
  ORDER BY created_at DESC
  LIMIT 10;
"
```

Expected: `channel_id` = NULL, `description_document_id` = NULL for newly generated instances.

### Verify EnsureTaskResources

1. Open the task detail view in the frontend
2. Re-run the SQL above — the task row should now have non-NULL `channel_id` and `description_document_id`

### Verify Schedule Change

```bash
# Before schedule change — count future instances for a definition
RITUAL_DEF_ID="<uuid-here>"
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c "
  SELECT COUNT(*), channel_id IS NULL AS untouched
  FROM collaboration.task
  WHERE ritual_definition_id = '$RITUAL_DEF_ID'
    AND scheduled_date > CURRENT_DATE
    AND deleted_at IS NULL
  GROUP BY untouched;
"

# After schedule change — verify cleanup
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c "
  SELECT
    task_kind,
    detached_from_ritual,
    deleted_at IS NOT NULL AS soft_deleted,
    COUNT(*)
  FROM collaboration.task
  WHERE ritual_definition_id = '$RITUAL_DEF_ID'
    OR (detached_from_ritual = TRUE)
  GROUP BY 1,2,3;
"
```

---

## Common Issues

| Issue | Solution |
|-------|---------- |
| `sqlc generate` fails with "unknown column" | Check that migration was applied before running sqlc |
| `buf generate` fails | Run `buf dep update` first to sync dependencies |
| Integration tests fail with "connection refused" | Run `docker compose up -d` and wait 10s for PostgreSQL |
| `pnpm -w -r build` fails | Run `pnpm install` first from `frontend/` directory |
