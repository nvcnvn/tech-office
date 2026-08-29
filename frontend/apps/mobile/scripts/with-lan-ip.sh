#!/usr/bin/env bash
#
# Run a mobile dev command with this Mac's LAN IP resolved into the environment.
#
# One host for both platforms: Metro serves on it (REACT_NATIVE_PACKAGER_HOSTNAME)
# and the app reaches the backend on it (EXPO_PUBLIC_API_URL). Android used to
# tunnel both ports over USB with `adb reverse` and point the app at localhost
# instead, so the two platforms resolved the backend differently and each failed
# in its own way. The price of unifying on the LAN IP is that the device and the
# Mac have to be on the same network.
#
# Both variables can still be overridden before invoking:
#   METRO_HOST=192.168.1.100 pnpm start
#   EXPO_PUBLIC_API_URL=http://10.0.0.5:18080 pnpm start
#
# Usage: ./scripts/with-lan-ip.sh expo start --port 18082 --dev-client

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=./resolve-ip.sh
source "$(dirname "${BASH_SOURCE[0]}")/resolve-ip.sh"

if ! curl -sf -o /dev/null --max-time 3 "${EXPO_PUBLIC_API_URL}/healthz"; then
  echo >&2
  echo "WARNING: no backend answering on ${EXPO_PUBLIC_API_URL}/healthz" >&2
  echo "Start it with 'make voice-dev-backend' (deps first: 'make infra-up')." >&2
  echo "Metro will still start, but sign-in will hang until the backend is up." >&2
  echo >&2
fi

echo "Metro host:  ${METRO_HOST}"
echo "Backend API: ${EXPO_PUBLIC_API_URL}"

cd "$ROOT_DIR"
exec env REACT_NATIVE_PACKAGER_HOSTNAME="$METRO_HOST" pnpm exec "$@"
