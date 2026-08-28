#!/usr/bin/env bash
# Deploy (or update) the stack.
#
#   deploy/scripts/deploy.sh                      # all profiles
#   PROFILES="voice backup" deploy/scripts/deploy.sh
#   PROFILES="" deploy/scripts/deploy.sh          # core only
#
# Profiles not listed are REMOVED from the fleet (--prune). That is how you opt out
# of, say, our observability stack in favour of your own.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
require_env RELEASE_TAG WEB_TAG WEB_DOMAIN API_DOMAIN MEDIA_DOMAIN POSTGRES_PASSWORD DATABASE_URL \
	R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_ENDPOINT
swarm_active || die "this machine is not a swarm manager — run deploy/scripts/bootstrap.sh"

render_configs
build_stack_args
info "profiles: core ${PROFILES-voice processing backup observability}"
info "release:  ${RELEASE_TAG} (web ${WEB_TAG})   configs: ${CONFIG_VERSION}   secrets: ${SECRET_VERSION}"

FIRST_INSTALL=false
docker service inspect "${STACK_NAME}_postgres" >/dev/null 2>&1 || FIRST_INSTALL=true

if [ "$FIRST_INSTALL" = true ]; then
	# The schema has to exist before the backend connects, so the first pass brings up
	# the database only. Every later deploy migrates against the running cluster.
	info "first install — starting the database before anything talks to it"
	BACKEND_REPLICAS=0 WEB_REPLICAS=0 \
		stack_deploy --resolve-image=changed --with-registry-auth \
			"${STACK_ARGS[@]}" "$STACK_NAME"
fi

wait_for_service "${STACK_NAME}_postgres"
"$DEPLOY_DIR/scripts/migrate.sh" up

info "deploying"
stack_deploy --prune --resolve-image=changed --with-registry-auth \
	"${STACK_ARGS[@]}" "$STACK_NAME"

wait_for_service "${STACK_NAME}_backend"

# Alerts are created through OpenObserve's API, so they need it running. Only on the
# first install: re-running is harmless but noisy, and the command is in the README.
if [ "$FIRST_INSTALL" = true ] && profile_enabled observability; then
	"$DEPLOY_DIR/scripts/provision-openobserve.sh" || \
		echo "WARNING: alert provisioning failed — run deploy/scripts/provision-openobserve.sh by hand"
fi

"$DEPLOY_DIR/scripts/smoke-test.sh" || die "deploy finished but the smoke test failed — check 'docker stack ps ${STACK_NAME}'"
info "done"
