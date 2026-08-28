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
}
trap cleanup EXIT

info "restoring the latest backup into a scratch volume"
docker volume create "$VOL" >/dev/null
docker run --rm --user postgres \
	-v "$VOL:/var/lib/postgresql/data" \
	-v "$DEPLOY_DIR/secrets/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro" \
	"$IMAGE" \
	pgbackrest --stanza=techoffice --pg1-path=/var/lib/postgresql/data/pgdata \
		--lock-path=/tmp --spool-path=/tmp \
		--type=immediate --target-action=promote restore

info "starting the restored cluster"
docker run -d --name "$NAME" \
	-v "$VOL:/var/lib/postgresql/data" \
	-e PGDATA=/var/lib/postgresql/data/pgdata \
	"$IMAGE" \
	postgres -c shared_preload_libraries=citus,pg_textsearch,pg_stat_statements \
		-c archive_mode=off -c listen_addresses=127.0.0.1 >/dev/null

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
expect_positive "citus shards"          "SELECT count(*) FROM pg_dist_shard"
expect_positive "permission catalogue"  "SELECT count(*) FROM public.permission"
expect_positive "organizations"         "SELECT count(*) FROM public.organization"
echo "  info recovered to: $(q 'SELECT pg_last_wal_replay_lsn()' 2>/dev/null || echo n/a)"

if [ "$failed" -eq 0 ]; then
	info "RESTORE DRILL PASSED — the backup in ${BACKUP_S3_BUCKET} is restorable"
else
	die "RESTORE DRILL FAILED — fix this before you need it"
fi
