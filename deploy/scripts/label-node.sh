#!/usr/bin/env bash
# Assign roles to a swarm node.
#   deploy/scripts/label-node.sh <node-name-or-id> <role> [role...]
#   roles: edge db app voice processing obs
set -euo pipefail
. "$(dirname "$0")/lib.sh"

[ $# -ge 2 ] || die "usage: label-node.sh <node> <role> [role...]"
NODE="$1"; shift

args=()
for role in "$@"; do
	case "$role" in
		edge|db|app|voice|processing|obs) args+=(--label-add "techoffice.${role}=true") ;;
		*) die "unknown role '$role' (edge db app voice processing obs)" ;;
	esac
done

docker node update "${args[@]}" "$NODE" >/dev/null
info "$NODE now has: $(docker node inspect "$NODE" --format '{{range $k,$v := .Spec.Labels}}{{$k}} {{end}}')"
