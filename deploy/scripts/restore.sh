#!/usr/bin/env bash
# DESTRUCTIVE: replace the live database with a backup. Run on the db node.
#
#   deploy/scripts/restore.sh latest
#   deploy/scripts/restore.sh "2026-08-28 14:30:00+00"     # point in time
#
# The application is stopped for the duration. A point-in-time restore replays WAL
# from object storage up to the timestamp you give and discards everything after it.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
TARGET="${1:-}"
[ -n "$TARGET" ] || die "usage: restore.sh latest|'<timestamp>'"
docker volume inspect "${STACK_NAME}_pgdata" >/dev/null 2>&1 \
	|| die "${STACK_NAME}_pgdata is not on this machine — run this on the db node"

cat <<EOF

  This REPLACES the contents of ${STACK_NAME}_pgdata.
  Target:   ${TARGET}
  Downtime: the whole application, until the restore and WAL replay finish.

EOF
read -r -p "Type the word RESTORE to continue: " confirm
[ "$confirm" = "RESTORE" ] || die "aborted"

RESTORE_ARGS=(--stanza=techoffice --delta)
if [ "$TARGET" != "latest" ]; then
	RESTORE_ARGS+=(--type=time --target="$TARGET" --target-action=promote)
else
	RESTORE_ARGS+=(--type=immediate --target-action=promote)
fi

info "stopping the application"
for svc in backend web pgbackup; do
	docker service scale --detach=false "${STACK_NAME}_${svc}=0" >/dev/null 2>&1 || true
done
info "stopping postgres"
docker service scale --detach=false "${STACK_NAME}_postgres=0" >/dev/null

# --delta compares what is on disk against the backup manifest and only rewrites what
# differs, so this is far quicker than wiping the volume first.
info "restoring"
docker run --rm --user postgres \
	-v "${STACK_NAME}_pgdata:/var/lib/postgresql/data" \
	-v "$DEPLOY_DIR/secrets/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro" \
	"${REGISTRY:+$REGISTRY/}tech-office-postgres:${RELEASE_TAG}" \
	pgbackrest "${RESTORE_ARGS[@]}" --lock-path=/tmp --spool-path=/tmp restore

info "starting postgres — it replays WAL before accepting connections"
docker service scale --detach=false "${STACK_NAME}_postgres=1" >/dev/null
wait_for_service "${STACK_NAME}_postgres" 900

info "starting the application"
docker service scale --detach=false \
	"${STACK_NAME}_backend=${BACKEND_REPLICAS}" \
	"${STACK_NAME}_web=${WEB_REPLICAS}" >/dev/null
profile_enabled backup && docker service scale --detach=false "${STACK_NAME}_pgbackup=1" >/dev/null

cat <<EOF

Restore complete. Two things still need you:

  1. A restored cluster starts a new timeline. Take a fresh full backup now:
       deploy/scripts/backup-now.sh full
  2. Object storage (files, recordings) was NOT rolled back. Files uploaded after
     ${TARGET} still exist in the bucket but the database no longer references them.
EOF
