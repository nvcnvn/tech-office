# Shared helpers for the deployment scripts. Sourced, not executed.
# shellcheck shell=bash

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
STACK_NAME="${STACK_NAME:-techoffice}"

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

sha256() {
	if command -v sha256sum >/dev/null; then sha256sum | cut -c1-12
	else shasum -a 256 | cut -c1-12; fi
}

load_env() {
	[ -f "$DEPLOY_DIR/.env" ] || die "$DEPLOY_DIR/.env not found. Copy .env.example and fill it in."
	set -a
	# shellcheck disable=SC1091
	. "$DEPLOY_DIR/.env"
	set +a
	derive_env
}

require_env() {
	local missing=()
	for v in "$@"; do [ -n "${!v:-}" ] || missing+=("$v"); done
	[ ${#missing[@]} -eq 0 ] || die "missing required settings in deploy/.env: ${missing[*]}"
}

# Values the stack files need that are computed rather than configured.
derive_env() {
	# Push credentials are optional; the backend disables the provider when the path
	# is empty, so the path is only set when a real key file was installed.
	if [ -s "$DEPLOY_DIR/secrets/fcm.json" ] && ! grep -q PLACEHOLDER "$DEPLOY_DIR/secrets/fcm.json" 2>/dev/null; then
		export FCM_CREDENTIALS_PATH=/run/secrets/fcm.json
	else
		export FCM_CREDENTIALS_PATH=""
	fi
	if [ -s "$DEPLOY_DIR/secrets/apns.p8" ] && ! grep -q PLACEHOLDER "$DEPLOY_DIR/secrets/apns.p8" 2>/dev/null; then
		export APNS_VOIP_KEY_PATH=/run/secrets/apns.p8
	else
		export APNS_VOIP_KEY_PATH=""
	fi

	# Media transport: one muxed UDP port on the overlay, or a real UDP range on the
	# voice node's own network stack. The second is what LiveKit prefers for scale;
	# the first is one firewall rule.
	case "${LIVEKIT_TRANSPORT:-mux}" in
		mux)
			export LIVEKIT_SIGNAL_URL="http://livekit:7880"
			export LIVEKIT_BACKEND_URL="ws://livekit:7880"
			;;
		host)
			[ -n "${LIVEKIT_HOST:-}" ] || die "LIVEKIT_TRANSPORT=host needs LIVEKIT_HOST (the voice node's internal IP) in deploy/.env"
			export LIVEKIT_SIGNAL_URL="http://${LIVEKIT_HOST}:7880"
			export LIVEKIT_BACKEND_URL="ws://${LIVEKIT_HOST}:7880"
			;;
		*) die "LIVEKIT_TRANSPORT must be 'mux' or 'host', got '${LIVEKIT_TRANSPORT}'" ;;
	esac

	if [ -n "${LIVEKIT_NODE_IP:-}" ]; then
		export LIVEKIT_USE_EXTERNAL_IP=false
	else
		export LIVEKIT_USE_EXTERNAL_IP=true
	fi

	case "${TLS_MODE:-acme}" in
		acme) export TLS_ROUTER_OPTIONS="certResolver: le" ;;
		file) export TLS_ROUTER_OPTIONS="options: default" ;;
		*) die "TLS_MODE must be 'acme' or 'file', got '${TLS_MODE:-}'" ;;
	esac

	# Compose interpolation has no ${VAR:+alt}, so the registry prefix (with its
	# trailing slash, or nothing at all) is computed here instead of in the YAML.
	# The OTLP exporter authenticates to OpenObserve with HTTP basic auth, which the
	# collector config carries pre-encoded.
	export OBSERVE_AUTH_B64="$(printf '%s:%s' "${OBSERVE_ROOT_EMAIL:-}" "${OBSERVE_ROOT_PASSWORD:-}" | base64 | tr -d '\n')"

	export REGISTRY="${REGISTRY:-}"
	export IMAGE_PREFIX="${REGISTRY:+$REGISTRY/}"
	# The web image is built per-deployment (Next.js bakes the public URLs in), so it
	# does not come from the project's registry — it goes wherever you can push.
	export WEB_IMAGE_PREFIX="${WEB_REGISTRY:+$WEB_REGISTRY/}"
	# WEB_IMAGE overrides the lot for a deployment that publishes its own web image.
	export WEB_IMAGE_REF="${WEB_IMAGE:-${WEB_IMAGE_PREFIX}tech-office-web}:${WEB_TAG}"
}

# ${VAR} substitution without depending on envsubst (not installed on a minimal
# host) and without eval (routes.yml contains backticks, which eval would execute).
render() {
	local src="$1" dst="$2" line var out=""
	while IFS= read -r line || [ -n "$line" ]; do
		while [[ "$line" =~ \$\{([A-Za-z_][A-Za-z0-9_]*)\} ]]; do
			var="${BASH_REMATCH[1]}"
			line="${line//\$\{$var\}/${!var-}}"
		done
		out+="$line"$'\n'
	done <"$src"
	printf '%s' "$out" >"$dst"
}

render_configs() {
	local tmpl
	while IFS= read -r tmpl; do
		render "$tmpl" "${tmpl%.tmpl}"
	done < <(find "$DEPLOY_DIR/config" -name '*.tmpl')

	# The two files whose *shape* changes with configuration, not just their values.
	render "$DEPLOY_DIR/config/livekit/livekit.$( [ "${LIVEKIT_TRANSPORT:-mux}" = host ] && echo hostnet || echo mux ).yaml.in" \
		"$DEPLOY_DIR/config/livekit/livekit.yaml"

	if [ "$TLS_MODE" = "file" ]; then
		cat >"$DEPLOY_DIR/config/traefik/dynamic/tls.yml" <<-EOF
		# Operator-supplied certificate (TLS_MODE=file).
		tls:
		  stores:
		    default:
		      defaultCertificate:
		        certFile: /run/secrets/tls.crt
		        keyFile: /run/secrets/tls.key
		EOF
	else
		printf '# Certificates come from the ACME resolver (TLS_MODE=acme).\ntls: {}\n' \
			>"$DEPLOY_DIR/config/traefik/dynamic/tls.yml"
	fi

	# Swarm configs and secrets are immutable, so their names carry a content hash:
	# editing a config file gives it a new name, which rolls the services using it.
	CONFIG_VERSION="$(cat_tree "$DEPLOY_DIR/config" | sha256)"
	SECRET_VERSION="$(cat_tree "$DEPLOY_DIR/secrets" | sha256)"
	export CONFIG_VERSION SECRET_VERSION
}

cat_tree() {
	find "$1" -type f ! -name '*.tmpl' ! -name '*.in' -print0 | sort -z | xargs -0 cat
}

# PROFILES selects which stack files are deployed. core is always included; anything
# not listed is removed from the swarm on the next deploy (--prune).
# Sets the global STACK_ARGS array (no mapfile: this has to work on bash 3 too).
build_stack_args() {
	STACK_ARGS=(-c "$DEPLOY_DIR/stacks/core.yml")
	local p
	for p in ${PROFILES-voice processing backup observability}; do
		case "$p" in
			core) ;;
			voice)
				# One knob, two stack shapes — see LIVEKIT_TRANSPORT in .env.
				if [ "${LIVEKIT_TRANSPORT:-mux}" = host ]; then
					STACK_ARGS+=(-c "$DEPLOY_DIR/stacks/voice-hostnet.yml")
				else
					STACK_ARGS+=(-c "$DEPLOY_DIR/stacks/voice.yml")
				fi ;;
			processing|backup|observability|registry)
				STACK_ARGS+=(-c "$DEPLOY_DIR/stacks/$p.yml") ;;
			*) die "unknown profile '$p'" ;;
		esac
	done
}

profile_enabled() {
	case " ${PROFILES-voice processing backup observability} " in *" $1 "*) return 0 ;; esac
	return 1
}

swarm_active() {
	[ "$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null)" = "active" ]
}

# `docker stack deploy --detach=false` waits for convergence with no timeout of its
# own, so one task that can never start — a port already bound on the node, an image
# no node can pull — hangs the deploy forever and prints nothing useful. Cap it and
# say which task is the problem. The spec is already in the swarm when the wait is
# cut short, so swarm keeps converging; re-running deploy.sh picks up where it left off.
stack_deploy() {
	local limit="${DEPLOY_TIMEOUT:-900}" rc=0 timeout_bin
	timeout_bin="$(command -v timeout || command -v gtimeout || true)"
	${timeout_bin:+"$timeout_bin" "$limit"} \
		docker stack deploy --detach=false "$@" || rc=$?
	[ "$rc" -eq 0 ] && return 0

	echo >&2
	echo "tasks that are not running:" >&2
	docker stack ps "$STACK_NAME" --no-trunc \
		--format '  {{.Name}}  {{.CurrentState}}  {{.Error}}' 2>/dev/null \
		| grep -v '  Running ' >&2 || true
	[ "$rc" = 124 ] && die "docker stack deploy did not converge within ${limit}s"
	die "docker stack deploy failed (exit ${rc})"
}

# Blocks until a service reports at least one running task, or fails loudly.
wait_for_service() {
	local svc="$1" timeout="${2:-300}" waited=0
	info "waiting for ${svc}"
	while [ "$waited" -lt "$timeout" ]; do
		if [ "$(docker service ps "$svc" --filter desired-state=running \
			--format '{{.CurrentState}}' 2>/dev/null | grep -c '^Running')" -ge 1 ]; then
			return 0
		fi
		sleep 5; waited=$((waited + 5))
	done
	docker service ps "$svc" --no-trunc || true
	die "${svc} did not come up within ${timeout}s"
}
