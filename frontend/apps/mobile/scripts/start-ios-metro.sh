#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_PORT="${RCT_METRO_PORT:-18082}"

# shellcheck source=./resolve-ip.sh
source "$(dirname "${BASH_SOURCE[0]}")/resolve-ip.sh"

echo "Starting Metro for iOS dev client on http://${METRO_HOST}:${DEFAULT_PORT}"
echo "Backend API: ${EXPO_PUBLIC_API_URL}"

cd "$ROOT_DIR"
EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" REACT_NATIVE_PACKAGER_HOSTNAME="$METRO_HOST" pnpm exec expo start --port "$DEFAULT_PORT" --dev-client "$@"
