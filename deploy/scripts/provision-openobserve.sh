#!/usr/bin/env bash
# Create the alert set (and its notification destination) in OpenObserve.
#
#   deploy/scripts/provision-openobserve.sh
#
# Idempotent-ish: OpenObserve rejects a duplicate name, which this reports as
# "exists" rather than an error. Everything it posts is also in
# deploy/config/openobserve/alerts.json, so if the API shape ever moves under us you
# can paste that file straight into the UI's alert import box instead.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

load_env
require_env OBSERVE_ROOT_EMAIL OBSERVE_ROOT_PASSWORD OBSERVE_ORG
ALERTS="$DEPLOY_DIR/config/openobserve/alerts.json"

# All HTTP happens inside the overlay network, so this works from any manager node
# regardless of which machine carries the obs label.
oo() { # method path  (body on stdin)
	docker run --rm -i --network techoffice_internal curlimages/curl:8.11.1 \
		-sS -X "$1" \
		-u "${OBSERVE_ROOT_EMAIL}:${OBSERVE_ROOT_PASSWORD}" \
		-H 'Content-Type: application/json' \
		-w '\n%{http_code}' \
		--data-binary @- "http://openobserve:5080$2" 2>/dev/null
}

status() { tail -1 <<<"$1"; }
body() { sed '$d' <<<"$1"; }

info "waiting for OpenObserve"
for _ in $(seq 1 60); do
	[ "$(status "$(: | oo GET /healthz)")" = "200" ] && break
	sleep 5
done
[ "$(status "$(: | oo GET /healthz)")" = "200" ] || die "OpenObserve is not answering on the overlay network"

# --- Notification destination ------------------------------------------------
if [ -n "${OBSERVE_ALERT_WEBHOOK_URL:-}" ]; then
	info "creating alert template and destination"
	out=$(oo POST "/api/${OBSERVE_ORG}/alerts/templates" <<-JSON
	{"name":"techoffice","body":"{\"text\":\"[{alert_name}] {stream_name} — {alert_start_time}\"}"}
	JSON
	)
	echo "  template: $(status "$out")"
	out=$(oo POST "/api/${OBSERVE_ORG}/alerts/destinations" <<-JSON
	{"name":"techoffice-alerts","url":"${OBSERVE_ALERT_WEBHOOK_URL}","method":"post","template":"techoffice","skip_tls_verify":false}
	JSON
	)
	echo "  destination: $(status "$out")"
	DEST_PATCH='s|"destinations": \[\]|"destinations": ["techoffice-alerts"]|'
else
	info "OBSERVE_ALERT_WEBHOOK_URL is empty — alerts will fire into the OpenObserve UI only"
	DEST_PATCH='s|"destinations": \[\]|"destinations": []|'
fi

# --- Alerts ------------------------------------------------------------------
# One JSON object per line. jq or python3 — whichever this machine happens to have.
split_alerts() {
	if command -v jq >/dev/null; then
		jq -c '.[]' "$ALERTS"
	elif command -v python3 >/dev/null; then
		python3 -c 'import json,sys;[print(json.dumps(a)) for a in json.load(open(sys.argv[1]))]' "$ALERTS"
	else
		die "need jq or python3 to split ${ALERTS}; alternatively paste that file into the OpenObserve UI (Alerts → Import)"
	fi
}

# The alerts API moved to a /v2 prefix; try that first and fall back.
ALERT_PATH="/api/v2/${OBSERVE_ORG}/alerts"
probe=$(status "$(: | oo GET "$ALERT_PATH")")
[ "$probe" = "404" ] && ALERT_PATH="/api/${OBSERVE_ORG}/alerts"
info "posting alerts to ${ALERT_PATH}"

failed=0
while IFS= read -r alert; do
	name=$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' <<<"$alert")
	out=$(sed "$DEST_PATCH" <<<"$alert" | oo POST "$ALERT_PATH")
	code=$(status "$out")
	case "$code" in
		200|201) echo "  ok     ${name}" ;;
		409) echo "  exists ${name}" ;;
		*) echo "  FAIL   ${name} (HTTP ${code}): $(body "$out" | head -c 200)"; failed=1 ;;
	esac
done < <(split_alerts)

if [ "$failed" -ne 0 ]; then
	cat <<-EOF

	Some alerts were rejected. The definitions are in ${ALERTS} — paste that file into
	OpenObserve → Alerts → Import, which is schema-checked interactively.
	EOF
	exit 1
fi
info "alerts provisioned"
