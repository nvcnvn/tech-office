#!/usr/bin/env bash

set -euo pipefail

host_ip="${TECH_OFFICE_HOST_IP:-127.0.0.1}"
livekit_url="${LIVEKIT_URL:-ws://localhost:7880}"
public_livekit_url="${PUBLIC_LIVEKIT_URL:-ws://${host_ip}:7880}"

printf 'export TECH_OFFICE_HOST_IP=%q\n' "$host_ip"
printf 'export LIVEKIT_URL=%q\n' "$livekit_url"
printf 'export PUBLIC_LIVEKIT_URL=%q\n' "$public_livekit_url"