#!/usr/bin/env bash
# Restore drill. Proves the backups in object storage are actually restorable,
# without touching the live database.
#
#   deploy/scripts/verify-restore.sh
#
# It restores the latest backup into a throwaway volume, starts a scratch PostgreSQL
# on it, runs sanity queries, and deletes everything. Run it on any node that can
# reach the bucket — weekly, and after any change to the backup configuration.
# An untested backup is not a backup.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
IMAGE="${REGISTRY:+$REGISTRY/}tech-office-postgres:${RELEASE_TAG}"
VOL="techoffice_restore_drill_$$"
NAME="techoffice-restore-drill-$$"

cleanup() {
	docker rm -f "$NAME" >/dev/null 2>&1 || true
	docker volume rm "$VOL" >/dev/null 2>&1 || true
	[ -n "${PGBR_CONF_DIR:-}" ] && rm -rf "$PGBR_CONF_DIR"
}
trap cleanup EXIT

info "restoring the latest backup into a scratch volume"
docker volume create "$VOL" >/dev/null
# A fresh named volume is root-owned, and the restore below runs as postgres. Same
# trap as the pgbackrest lock and metrics volumes in the backup stack.
docker run --rm -v "$VOL:/v" "$IMAGE" chown postgres:postgres /v >/dev/null
# Deliberately no --spool-path here: pgBackRest carries it into the restore_command
# it writes into postgresql.auto.conf, where archive-get rejects it as invalid without
# archive-async — failing recovery after the restore itself has already succeeded.
CONF="$(stage_pgbackrest_conf)"
docker run --rm --user postgres \
	-v "$VOL:/var/lib/postgresql/data" \
	-v "$CONF:/etc/pgbackrest/pgbackrest.conf:ro" \
	"$IMAGE" \
	pgbackrest --stanza=techoffice --pg1-path=/var/lib/postgresql/data/pgdata \
		--lock-path=/tmp \
		--type=immediate --target-action=promote restore

info "starting the restored cluster"
# max_connections and max_worker_processes must be at least what the primary ran with
# (core.yml), or recovery aborts with "insufficient parameter settings". Keep these in
# step with core.yml if you change the primary's.
#
# The config has to be here too: recovery runs restore_command, which is
# `pgbackrest archive-get`, and without it that cannot find the repository — the
# restore succeeds and then the cluster fails to reach a consistent state.
docker run -d --name "$NAME" \
	-v "$VOL:/var/lib/postgresql/data" \
	-v "$CONF:/etc/pgbackrest/pgbackrest.conf:ro" \
	-e PGDATA=/var/lib/postgresql/data/pgdata \
	"$IMAGE" \
	postgres -c shared_preload_libraries=pg_textsearch,pg_stat_statements \
		-c archive_mode=off -c listen_addresses=127.0.0.1 \
		-c max_connections="${PG_MAX_CONNECTIONS}" -c max_worker_processes=12 >/dev/null

for _ in $(seq 1 60); do
	docker exec "$NAME" pg_isready -q -h 127.0.0.1 && break
	sleep 5
done
docker exec "$NAME" pg_isready -q -h 127.0.0.1 || {
	docker logs --tail 50 "$NAME"; die "the restored cluster never finished recovery"
}

info "checking the restored data"
q() { docker exec "$NAME" psql -h 127.0.0.1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atqc "$1"; }

failed=0
expect_positive() {
	local label="$1" value
	value="$(q "$2" 2>&1 || echo error)"
	if [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -gt 0 ]; then
		echo "  ok   ${label}: ${value}"
	else
		echo "  FAIL ${label}: ${value}"
		failed=1
	fi
}

expect_positive "schema version"        "SELECT version FROM public.schema_migrations"
expect_positive "employees"             "SELECT count(*) FROM organization.employee"
expect_positive "permission catalogue"  "SELECT count(*) FROM public.permission"
expect_positive "organizations"         "SELECT count(*) FROM public.organization"
echo "  info recovered to: $(q 'SELECT pg_last_wal_replay_lsn()' 2>/dev/null || echo n/a)"

if [ "$failed" -eq 0 ]; then
	info "RESTORE DRILL PASSED — the backup in ${BACKUP_S3_BUCKET} is restorable"
else
	die "RESTORE DRILL FAILED — fix this before you need it"
fi
