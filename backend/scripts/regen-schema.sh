#!/bin/bash
# Regenerates backend/database/scripts/schema.sql from the migrations.
#
# schema.sql is a GENERATED, read-only snapshot: a single-file view of the schema the
# migrations actually produce, kept for humans and agents who want to read the whole
# schema at once. Do NOT hand-edit it. To change the schema, author a migration in
# backend/database/migrations/ and re-run this script.
#
# Migrations are applied to a throwaway database so the dump reflects the migrations
# alone, never whatever state the dev database has drifted into.
#
# pg_dump refuses to run against a newer server, so it is invoked inside the compose
# postgres container, where client and server versions match by construction.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT="${BACKEND_DIR}/database/scripts/schema.sql"
SCRATCH_DB="tech_office_schema_regen"
PG_PORT="${TECH_OFFICE_PG_PORT:-15432}"

compose() { docker compose --project-directory "$BACKEND_DIR" "$@"; }
scratch_psql() { compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -Atq "$@"; }

cleanup() {
	scratch_psql -c "DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

compose ps --status running --services 2>/dev/null | grep -qx postgres || {
	echo "ERROR: the compose 'postgres' service is not running. Start it with: docker compose up -d postgres" >&2
	exit 1
}

echo "Building ${SCRATCH_DB} from database/migrations ..."
cleanup
scratch_psql -c "CREATE DATABASE ${SCRATCH_DB};" >/dev/null

DATABASE_URL="postgres://postgres:tech_office_password@localhost:${PG_PORT}/${SCRATCH_DB}?sslmode=disable" \
	"${SCRIPT_DIR}/migrate.sh" up >/dev/null

# --schema-only: structure, constraints and comments; no data.
# public.schema_migrations is the migration runner's own bookkeeping, not application schema.
# The sed pass drops pg_dump's version banner and its \restrict/\unrestrict guards, which
# carry a random token and would otherwise churn the diff on every regeneration.
compose exec -T postgres pg_dump -U postgres \
	--schema-only \
	--no-owner \
	--no-privileges \
	--exclude-table=public.schema_migrations \
	"$SCRATCH_DB" \
	| sed -e '/^-- Dumped by pg_dump/d' \
	      -e '/^-- Dumped from database version/d' \
	      -e '/^\\restrict /d' \
	      -e '/^\\unrestrict /d' \
	> "$OUTPUT"

echo "Wrote database/scripts/schema.sql ($(wc -l < "$OUTPUT" | tr -d ' ') lines)"
