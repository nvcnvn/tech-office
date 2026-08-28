#!/usr/bin/env bash
# Build the images this deployment runs.
#
#   deploy/scripts/build-images.sh              # the web image (the usual case)
#   deploy/scripts/build-images.sh --all        # also backend, migrate and postgres
#   deploy/scripts/build-images.sh --tag 20260828
#
# By default only the **web** image is built. The other three are the same for every
# deployment and are published to ghcr.io by CI, so REGISTRY pulls them. The web image
# cannot work that way: Next.js bakes NEXT_PUBLIC_* in at build time, so it is specific
# to this deployment's hostnames and is built here from deploy/.env.
#
# --all builds everything from source instead, for an air-gapped fleet or a fork.
# tech-office-postgres installs its extensions from packages, so it builds quickly.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
TAG="${WEB_TAG}"
BUILD_ALL=false
PUSH=""
while [ $# -gt 0 ]; do
	case "$1" in
		--tag) TAG="$2"; shift 2 ;;
		--all) BUILD_ALL=true; shift ;;
		--push) PUSH=true; shift ;;
		--no-push) PUSH=false; shift ;;
		*) die "unknown argument $1" ;;
	esac
done
[ "$TAG" != "dev" ] || TAG="$(date -u +%Y%m%d%H%M%S)"
# Push whatever has a registry to push to, unless told otherwise.
[ -n "$PUSH" ] || { [ -n "${WEB_REGISTRY:-}" ] && PUSH=true || PUSH=false; }

PREFIX="${REGISTRY:+$REGISTRY/}"
WEB_PREFIX="${WEB_REGISTRY:+$WEB_REGISTRY/}"

# A deployment that pulls a prebuilt web image has nothing to build here.
if [ -n "${WEB_IMAGE:-}" ] && [ "$BUILD_ALL" = false ]; then
	die "WEB_IMAGE is set to ${WEB_IMAGE} — this deployment pulls its web image instead of building one. Unset it, or pass --all to build the project images."
fi

build() {
	local image="$1"; shift
	info "building ${image}"
	docker build -t "$image" "$@"
}

build "${WEB_PREFIX}tech-office-web:${TAG}" \
	--build-arg NEXT_PUBLIC_BASE_URL="https://${WEB_DOMAIN}" \
	--build-arg NEXT_PUBLIC_API_URL="https://${API_DOMAIN}" \
	--build-arg NEXT_PUBLIC_API_BASE_URL="https://${API_DOMAIN}" \
	--build-arg NEXT_PUBLIC_GOOGLE_CLIENT_ID="${NEXT_PUBLIC_GOOGLE_CLIENT_ID}" \
	--build-arg NEXT_PUBLIC_APPLE_CLIENT_ID="${NEXT_PUBLIC_APPLE_CLIENT_ID}" \
	--build-arg RELEASE_TAG="${TAG}" \
	-f "$REPO_ROOT/frontend/Dockerfile" "$REPO_ROOT/frontend"

PUSH_LIST=("${WEB_PREFIX}tech-office-web:${TAG}")

if [ "$BUILD_ALL" = true ]; then
	build "${PREFIX}tech-office-postgres:${TAG}" \
		-f "$REPO_ROOT/backend/docker/postgres.Dockerfile" "$REPO_ROOT/backend/docker"
	build "${PREFIX}tech-office-backend:${TAG}" \
		-f "$REPO_ROOT/backend/Dockerfile" "$REPO_ROOT/backend"
	build "${PREFIX}tech-office-backend-migrate:${TAG}" \
		-f "$REPO_ROOT/backend/Dockerfile.migrate" "$REPO_ROOT/backend"
	PUSH_LIST+=(
		"${PREFIX}tech-office-postgres:${TAG}"
		"${PREFIX}tech-office-backend:${TAG}"
		"${PREFIX}tech-office-backend-migrate:${TAG}"
	)
fi

if [ "$PUSH" = true ]; then
	for image in "${PUSH_LIST[@]}"; do
		case "$image" in
			*/*) info "pushing ${image}"; docker push "$image" ;;
			*) die "cannot push ${image}: no registry configured for it (WEB_REGISTRY / REGISTRY)" ;;
		esac
	done
elif [ "$(docker node ls -q 2>/dev/null | wc -l | tr -d ' ')" != "1" ]; then
	echo
	echo "WARNING: nothing was pushed, but this fleet has more than one node. Images"
	echo "built here are invisible to the other nodes and their tasks will fail to"
	echo "start. Set WEB_REGISTRY to a registry you can push to."
fi

sed -i.bak "s|^WEB_TAG=.*|WEB_TAG=${TAG}|" "$DEPLOY_DIR/.env" && rm -f "$DEPLOY_DIR/.env.bak"
info "WEB_TAG=${TAG} written to deploy/.env"
if [ "$BUILD_ALL" = true ]; then
	sed -i.bak "s|^RELEASE_TAG=.*|RELEASE_TAG=${TAG}|" "$DEPLOY_DIR/.env" && rm -f "$DEPLOY_DIR/.env.bak"
	info "RELEASE_TAG=${TAG} written to deploy/.env (the project images were built here too)"
fi
info "now run deploy/scripts/deploy.sh"
