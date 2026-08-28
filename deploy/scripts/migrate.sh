#!/usr/bin/env bash
# Run database migrations as a one-shot container on the overlay network.
#
#   deploy/scripts/migrate.sh [up|down|status]
#
# Swarm has no job primitive that stack files can express, and the migration runner
# already takes a Postgres advisory lock, so running it once from the manager is both
# simpler and safe against a concurrent deploy.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
CMD="${1:-up}"
IMAGE="${REGISTRY:+$REGISTRY/}tech-office-backend-migrate:${RELEASE_TAG}"

info "migrations: ${CMD}"
docker run --rm \
	--network techoffice_internal \
	-e DATABASE_URL="${DATABASE_URL}" \
	"$IMAGE" "$CMD"
