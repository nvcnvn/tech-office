#!/usr/bin/env bash
# Create the alert set (and its notification destination) in OpenObserve.
#
#   deploy/scripts/provision-openobserve.sh
#
# Idempotent: alerts, the template and the destination are all upserted by name, so
# an edited definition takes effect on the next run. Everything it posts is also in
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

describe_create() { case "$1" in 200|201) echo "ok" ;; *) echo "HTTP $1" ;; esac; }
status() { tail -1 <<<"$1"; }
body() { sed '$d' <<<"$1"; }

# Emit {"name":"techoffice","body":"<arg, JSON-escaped>"} without hand-rolling escapes.
json_template() {
	if command -v python3 >/dev/null; then
		python3 -c 'import json,sys; print(json.dumps({"name":"techoffice","body":sys.argv[1]}))' "$1"
	elif command -v jq >/dev/null; then
		jq -nc --arg b "$1" '{name:"techoffice", body:$b}'
	else
		die "need jq or python3 to build the alert template"
	fi
}

info "waiting for OpenObserve"
for _ in $(seq 1 60); do
	[ "$(status "$(: | oo GET /healthz)")" = "200" ] && break
	sleep 5
done
[ "$(status "$(: | oo GET /healthz)")" = "200" ] || die "OpenObserve is not answering on the overlay network"

# --- Notification destination ------------------------------------------------
if [ -n "${OBSERVE_ALERT_WEBHOOK_URL:-}" ]; then
	info "creating alert template and destination"
	# The request body a destination sends is provider-specific: Slack and Google Chat
	# want {"text": ...}, Discord {"content": ...}, Telegram {"chat_id": ..., "text": ...}.
	# OBSERVE_ALERT_TEMPLATE_BODY carries it, defaulting to the Slack shape. It is JSON
	# embedded in a JSON string, so it is escaped here rather than by hand in .env.
	# Not ${VAR:-default}: the default is full of braces, and the first unescaped '}'
	# would close the expansion.
	if [ -n "${OBSERVE_ALERT_TEMPLATE_BODY:-}" ]; then
		TEMPLATE_BODY="$OBSERVE_ALERT_TEMPLATE_BODY"
	else
		TEMPLATE_BODY='{"text":"[{alert_name}] {stream_name} — {alert_start_time}"}'
	fi
	# POST creates; on a re-run the name already exists, so PUT the new body over it.
	# Without the PUT an edited template or webhook URL would never take effect.
	out=$(json_template "$TEMPLATE_BODY" | oo POST "/api/${OBSERVE_ORG}/alerts/templates")
	case "$(status "$out")" in
		400|409) out=$(json_template "$TEMPLATE_BODY" | oo PUT "/api/${OBSERVE_ORG}/alerts/templates/techoffice") ;;
	esac
	# 400 here is OpenObserve's duplicate-name response, not a failure: this script is
	# meant to be safe to re-run.
	echo "  template: $(describe_create "$(status "$out")")"
	dest_json() {
		cat <<-JSON
		{"name":"techoffice-alerts","url":"${OBSERVE_ALERT_WEBHOOK_URL}","method":"post","template":"techoffice","skip_tls_verify":false}
		JSON
	}
	out=$(dest_json | oo POST "/api/${OBSERVE_ORG}/alerts/destinations")
	case "$(status "$out")" in
		400|409) out=$(dest_json | oo PUT "/api/${OBSERVE_ORG}/alerts/destinations/techoffice-alerts") ;;
	esac
	echo "  destination: $(describe_create "$(status "$out")")"
else
	# OpenObserve rejects an alert with no destination ("Alert destination or
	# workflows is required"), so there is no UI-only mode to fall back to. Failing
	# here beats posting every alert and watching each one 400.
	die "OBSERVE_ALERT_WEBHOOK_URL is empty. OpenObserve requires a notification
destination on every alert, so the alert set cannot be created without one. Put a
Slack incoming webhook — or any endpoint that accepts a JSON POST — in deploy/.env
and re-run this script. An alert nobody is paged for is not worth creating."
fi

# --- Alerts ------------------------------------------------------------------
# One JSON object per line. jq or python3 — whichever this machine happens to have.
# Sets .destinations on the way past. Doing this in the JSON layer rather than with a
# sed on the serialised text matters: jq -c emits "destinations":[] and python3 emits
# "destinations": [] — one space apart — so a text substitution silently matches on
# some machines and not others, and the alerts it misses are rejected as having no
# destination.
DEST_NAME="techoffice-alerts"
split_alerts() {
	if command -v jq >/dev/null; then
		jq -c --arg d "$DEST_NAME" '.[] | .destinations = [$d]' "$ALERTS"
	elif command -v python3 >/dev/null; then
		python3 -c 'import json,sys
alerts = json.load(open(sys.argv[1]))
for a in alerts:
    a["destinations"] = [sys.argv[2]]
    print(json.dumps(a))' "$ALERTS" "$DEST_NAME"
	else
		die "need jq or python3 to split ${ALERTS}; alternatively paste that file into the OpenObserve UI (Alerts → Import)"
	fi
}

# The alerts API moved to a /v2 prefix; try that first and fall back.
ALERT_PATH="/api/v2/${OBSERVE_ORG}/alerts"
probe=$(status "$(: | oo GET "$ALERT_PATH")")
[ "$probe" = "404" ] && ALERT_PATH="/api/${OBSERVE_ORG}/alerts"
info "posting alerts to ${ALERT_PATH}"

# Contrary to the "duplicate names are rejected" assumption this script was written
# with, the v2 API happily creates a second alert with the same name: three deploys
# had left four copies of every alert, each one paging separately, and an edited
# definition in alerts.json never reached the ones already there. So look up what
# exists by name and PUT over it, deleting any surplus copies. The v1 list has no
# alert_id to address, so that path still just POSTs.
existing_alerts() { # name<TAB>alert_id per line
	local out
	out=$(: | oo GET "$ALERT_PATH")
	[ "$(status "$out")" = "200" ] || return 0
	if command -v jq >/dev/null; then
		body "$out" | jq -r '.list[]? | "\(.name)\t\(.alert_id)"'
	else
		body "$out" | python3 -c 'import json,sys
for a in json.load(sys.stdin).get("list", []):
    print(a["name"] + "\t" + a["alert_id"])'
	fi
}
EXISTING=$(existing_alerts)

failed=0
while IFS= read -r alert; do
	name=$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' <<<"$alert")
	ids=$(awk -F'\t' -v n="$name" '$1 == n {print $2}' <<<"$EXISTING")
	if [ -n "$ids" ]; then
		out=$(oo PUT "${ALERT_PATH}/$(head -1 <<<"$ids")" <<<"$alert")
		verb="updated"
		dupes=0
		for extra in $(tail -n +2 <<<"$ids"); do
			: | oo DELETE "${ALERT_PATH}/${extra}" >/dev/null
			dupes=$((dupes + 1))
		done
		[ "$dupes" -gt 0 ] && verb="updated (removed ${dupes} duplicate$([ "$dupes" -gt 1 ] && echo s))"
	else
		out=$(oo POST "$ALERT_PATH" <<<"$alert")
		verb="created"
	fi
	code=$(status "$out")
	case "$code" in
		200|201) echo "  ok     ${name} — ${verb}" ;;
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
