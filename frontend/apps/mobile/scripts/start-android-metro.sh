#!/usr/bin/env bash
#
# Start Metro for an Android dev client (physical device or emulator).
#
# Unlike the iOS script, this does NOT use the Mac's LAN IP. It forwards ports
# over USB with `adb reverse`, so the device reaches Metro and the backend on its
# own localhost. That works on a physical device and an emulator alike, needs no
# LAN connectivity, and never triggers a macOS firewall prompt.
#
# Prerequisites: backend on :18080 (`make voice-dev-backend` or `air`) and a
# device visible to `adb devices`.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METRO_PORT="${RCT_METRO_PORT:-18082}"
API_PORT="${TECH_OFFICE_API_PORT:-18080}"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. Install Android platform-tools and add it to PATH." >&2
  echo "  (with Android Studio: \$ANDROID_HOME/platform-tools)" >&2
  exit 1
fi

devices="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
if [[ -z "$devices" ]]; then
  echo "No authorised Android device or emulator found." >&2
  adb devices -l >&2
  echo >&2
  echo "On a physical device: enable Developer options -> USB debugging, then" >&2
  echo "accept the 'Allow USB debugging?' prompt. A device shown as" >&2
  echo "'unauthorized' means that prompt has not been accepted yet." >&2
  exit 1
fi

# Reverse both ports on every attached device: Metro so the app can load JS, and
# the API so fetches to http://localhost:18080 reach the backend on this machine.
while read -r serial; do
  [[ -z "$serial" ]] && continue
  adb -s "$serial" reverse "tcp:${METRO_PORT}" "tcp:${METRO_PORT}" >/dev/null
  adb -s "$serial" reverse "tcp:${API_PORT}" "tcp:${API_PORT}" >/dev/null
  echo "Forwarded ports ${METRO_PORT} and ${API_PORT} to $serial"
done <<<"$devices"

export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-http://localhost:${API_PORT}}"

if ! curl -sf -o /dev/null --max-time 3 "http://localhost:${API_PORT}/healthz"; then
  echo
  echo "WARNING: no backend answering on http://localhost:${API_PORT}/healthz" >&2
  echo "Start it with 'make voice-dev-backend' (deps first: 'make infra-up')." >&2
  echo "Metro will still start, but sign-in will hang until the backend is up." >&2
  echo
fi

echo "Starting Metro for Android dev client on http://localhost:${METRO_PORT}"
echo "Backend API: ${EXPO_PUBLIC_API_URL}"

cd "$ROOT_DIR"
exec pnpm exec expo start --port "$METRO_PORT" --dev-client "$@"
