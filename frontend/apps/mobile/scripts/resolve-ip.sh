#!/usr/bin/env bash
# Shared IP resolution for mobile dev scripts.
# Source this file then read $METRO_HOST and $EXPO_PUBLIC_API_URL.
#
# Both variables can be overridden before sourcing:
#   METRO_HOST=192.168.1.100
#   EXPO_PUBLIC_API_URL=http://10.0.0.5:18080
#   source ./scripts/resolve-ip.sh

resolve_ip() {
  # 1. Explicit override
  if [[ -n "${METRO_HOST:-}" ]]; then
    return 0
  fi

  # 2. Active network interface (macOS)
  local iface
  iface="$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  if [[ -n "$iface" ]]; then
    local ip
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [[ -n "$ip" ]]; then
      METRO_HOST="$ip"
      return 0
    fi
  fi

  # 3. Python UDP trick (cross-platform fallback)
  if command -v python3 >/dev/null 2>&1; then
    local ip
    ip="$(python3 - <<'PY'
import socket

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8", 80))
    print(s.getsockname()[0])
finally:
    s.close()
PY
)"
    if [[ -n "$ip" ]]; then
      METRO_HOST="$ip"
      return 0
    fi
  fi

  echo "Unable to determine LAN IP. Set METRO_HOST explicitly." >&2
  return 1
}

resolve_ip

# Default backend API URL using the same host, port 18080
: "${EXPO_PUBLIC_API_URL:=http://${METRO_HOST}:18080}"

export METRO_HOST
export EXPO_PUBLIC_API_URL