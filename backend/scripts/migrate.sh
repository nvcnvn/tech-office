#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${MIGRATIONS_OVERRIDE_DIR:-}" ]; then
	MIGRATIONS_DIR="$MIGRATIONS_OVERRIDE_DIR"
else
	MIGRATIONS_DIR="${SCRIPT_DIR}/../k8s/base/database/migrations"
fi
LOCK_KEY="684905214274285376"

# If DATABASE_URL is not set, warn and fall back to a local development DB
if [ -z "${DATABASE_URL:-}" ]; then
	echo "WARNING: DATABASE_URL is empty — using local development database." >&2
	DATABASE_URL="postgres://postgres:tech_office_password@localhost:15432/tech_office_db?search_path=public&sslmode=disable"
fi

PSQL_DATABASE_URL="${DATABASE_URL/search_path=public&/}"
PSQL_DATABASE_URL="${PSQL_DATABASE_URL/search_path=public/}"
PSQL_DATABASE_URL="${PSQL_DATABASE_URL%\?}"
COMMAND="${1:-up}"

require_psql() {
	if ! command -v psql >/dev/null 2>&1; then
		echo "ERROR: psql is required to run database migrations." >&2
		exit 1
	fi
}

psql_query() {
	psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "$1"
}

ensure_schema_migrations_table() {
	psql_query "
		SET client_min_messages TO warning;
		CREATE TABLE IF NOT EXISTS public.schema_migrations (
			version bigint NOT NULL PRIMARY KEY,
			dirty boolean NOT NULL
		);
	"
}

acquire_lock() {
	psql_query "SELECT pg_advisory_lock(${LOCK_KEY});" >/dev/null
}

release_lock() {
	psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT pg_advisory_unlock(${LOCK_KEY});" >/dev/null 2>&1 || true
}

get_schema_migration_state() {
	psql_query "
		SELECT COALESCE(
			(SELECT version::text || '|' || dirty::text FROM public.schema_migrations LIMIT 1),
			'0|f'
		);
	"
}

set_schema_migration_state() {
	local version="$1"
	local dirty="$2"

	psql_query "
		BEGIN;
		DELETE FROM public.schema_migrations;
		INSERT INTO public.schema_migrations (version, dirty)
		VALUES (${version}, ${dirty});
		COMMIT;
	"
}

print_status() {
	local migration_state current_version schema_dirty
	migration_state="$(get_schema_migration_state)"
	current_version="${migration_state%%|*}"
	schema_dirty="${migration_state#*|}"
	echo "version=${current_version} dirty=${schema_dirty}"
}

apply_up_migrations() {
	local migration_state current_version schema_dirty applied_any
	migration_state="$(get_schema_migration_state)"
	current_version="${migration_state%%|*}"
	schema_dirty="${migration_state#*|}"
	applied_any=0

	if [ -z "$current_version" ]; then
		current_version=0
	fi

	if { [ "$schema_dirty" = "t" ] || [ "$schema_dirty" = "true" ]; } && ! compgen -G "${MIGRATIONS_DIR}/${current_version}_*.up.sql" >/dev/null; then
		echo "ERROR: schema_migrations is dirty at version ${current_version}, but no matching .up.sql file exists." >&2
		exit 1
	fi

	for migration in "${MIGRATIONS_DIR}"/*.up.sql; do
		local filename version_number
		filename="$(basename "$migration")"
		version_number="${filename%%_*}"

		if [ "$schema_dirty" = "t" ] || [ "$schema_dirty" = "true" ]; then
			if [ $((10#$version_number)) -lt $((10#$current_version)) ]; then
				continue
			fi
		else
			if [ $((10#$version_number)) -le $((10#$current_version)) ]; then
				continue
			fi
		fi

		echo "Applying migration ${filename}..." >&2
		set_schema_migration_state "$((10#$version_number))" true
		if ! psql "$PSQL_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"; then
			echo "ERROR: migration ${filename} failed. schema_migrations remains dirty at version ${version_number}." >&2
			exit 1
		fi
		set_schema_migration_state "$((10#$version_number))" false
		current_version="$((10#$version_number))"
		schema_dirty=false
		applied_any=1
	done

	if [ "$applied_any" -eq 0 ]; then
		echo "no change"
	fi
}

usage() {
	echo "Usage: ./scripts/migrate.sh [up|status]" >&2
	echo "This runner is forward-only. Down migrations are not supported by the script." >&2
	exit 1
}

require_psql
ensure_schema_migrations_table
acquire_lock
trap release_lock EXIT

case "$COMMAND" in
	up)
		apply_up_migrations
		;;
	status)
		print_status
		;;
	down|force)
		echo "ERROR: ${COMMAND} is not supported. This migration workflow is forward-only." >&2
		exit 1
		;;
	*)
		usage
		;;
esac
