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

	export REGISTRY="${REGISTRY:-}"
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

	if [ -n "${ALERT_SLACK_WEBHOOK_URL:-}" ]; then
		render "$DEPLOY_DIR/config/alertmanager/alertmanager.slack.yml.in" \
			"$DEPLOY_DIR/config/alertmanager/alertmanager.yml"
	else
		cp "$DEPLOY_DIR/config/alertmanager/alertmanager.null.yml.in" \
			"$DEPLOY_DIR/config/alertmanager/alertmanager.yml"
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
stack_args() {
	local files=("$DEPLOY_DIR/stacks/core.yml") p
	for p in ${PROFILES:-voice processing backup observability}; do
		case "$p" in
			core) ;;
			voice|processing|backup|observability|registry)
				files+=("$DEPLOY_DIR/stacks/$p.yml") ;;
			*) die "unknown profile '$p'" ;;
		esac
	done
	printf -- '-c\n%s\n' "${files[@]}"
}

swarm_active() {
	[ "$(docker info --format '{{.Swarm.LocalState}}' 2>/dev/null)" = "active" ]
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
