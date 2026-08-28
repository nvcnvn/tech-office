#!/usr/bin/env bash
# Take a backup immediately, outside the schedule. Run on the db node.
#   deploy/scripts/backup-now.sh [full|diff|incr]     (default: full)
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
TYPE="${1:-full}"
CID="$(docker ps -q -f "name=${STACK_NAME}_pgbackup" | head -1)"
[ -n "$CID" ] || die "the pgbackup container is not running on this machine — run this on the db node"

info "taking a ${TYPE} backup"
docker exec "$CID" pgbackrest --stanza=techoffice --type="$TYPE" backup
docker exec "$CID" pgbackrest --stanza=techoffice info
