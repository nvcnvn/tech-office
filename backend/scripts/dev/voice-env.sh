#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd "${script_dir}/../.." && pwd)"

host_ip="${TECH_OFFICE_HOST_IP:-127.0.0.1}"
livekit_url="${LIVEKIT_URL:-ws://localhost:7880}"
public_livekit_url="${PUBLIC_LIVEKIT_URL:-ws://${host_ip}:7880}"

printf 'export TECH_OFFICE_HOST_IP=%q\n' "$host_ip"
printf 'export LIVEKIT_URL=%q\n' "$livekit_url"
printf 'export PUBLIC_LIVEKIT_URL=%q\n' "$public_livekit_url"

# APNs VoIP credential for native call wakeup.
#
# Emitted only when a key is actually present, because a *partial* credential fails
# startup by design — see backend/docs/APNS-VOIP-SETUP.md. With no key the server still
# runs and every iOS device rings on the tier-B path, which is what lets someone without
# an Apple account work on this repo.
#
# Sandbox by default: a development build's PushKit token is a sandbox token, and the
# production gateway rejects it with BadDeviceToken.
apns_key="${APNS_VOIP_KEY_PATH:-}"
if [[ -z "$apns_key" ]]; then
	# Any .p8 dropped in backend/secrets/. Keys are gitignored repo-wide (*.p8).
	apns_key="$(find "${backend_dir}/secrets" -maxdepth 1 -name 'AuthKey_*.p8' 2>/dev/null | sort | head -1)"
fi

if [[ -n "$apns_key" && -f "$apns_key" ]]; then
	# The key ID is the ten characters Apple puts in the filename, so the one value most
	# easily mistyped is derived rather than restated.
	apns_key_id="${APNS_VOIP_KEY_ID:-$(basename "$apns_key" .p8)}"
	apns_key_id="${apns_key_id#AuthKey_}"

	printf 'export APNS_VOIP_KEY_PATH=%q\n' "$apns_key"
	printf 'export APNS_VOIP_KEY_ID=%q\n' "$apns_key_id"
	printf 'export APNS_VOIP_TEAM_ID=%q\n' "${APNS_VOIP_TEAM_ID:-352TFKTTP2}"
	printf 'export APNS_VOIP_TOPIC=%q\n' "${APNS_VOIP_TOPIC:-com.devguards.TechOffice.voip}"
	printf 'export APNS_VOIP_USE_SANDBOX=%q\n' "${APNS_VOIP_USE_SANDBOX:-true}"
fi
