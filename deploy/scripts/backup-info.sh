#!/usr/bin/env bash
# What is in the backup repository, and how old is it. Run on the db node.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
CID="$(docker ps -q -f "name=${STACK_NAME}_pgbackup" | head -1)"
[ -n "$CID" ] || die "the pgbackup container is not running on this machine — run this on the db node"
# -u postgres: the container starts as root to fix volume ownership and drops
# privileges itself, so an exec would otherwise land as root — which pgBackRest
# refuses for `info`.
docker exec -u postgres "$CID" pgbackrest --stanza=techoffice info
