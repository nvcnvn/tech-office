#!/usr/bin/env bash
# Post-deploy check: is anything crash-looping, and do the three public endpoints
# actually answer over TLS?
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
failed=0

info "swarm tasks"
if docker stack ps "$STACK_NAME" --filter "desired-state=running" \
	--format '{{.Name}} {{.CurrentState}} {{.Error}}' | grep -Ei 'reject|failed' ; then
	echo "  ^ tasks above are not healthy"
	failed=1
fi

check() {
	local name="$1" url="$2" expect="$3"
	local code
	# curl already prints 000 when it never got a response, so no `|| echo 000` here —
	# that appended a second 000 and made every failure read as "000000".
	code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null)" || true
	if [ "$code" = "$expect" ]; then
		echo "  ok   ${name} (${url}) -> ${code}"
	else
		echo "  FAIL ${name} (${url}) -> ${code}, expected ${expect}"
		failed=1
	fi
}

info "public endpoints"
check "api health" "https://${API_DOMAIN}/healthz" 200
check "web"        "https://${WEB_DOMAIN}/" 200
# LiveKit answers its signalling root with 200 once it is up.
profile_enabled voice && check "livekit" "https://${MEDIA_DOMAIN}/" 200

exit $failed
