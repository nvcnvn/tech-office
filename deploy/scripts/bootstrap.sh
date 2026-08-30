#!/usr/bin/env bash
# One-time preparation of a fleet: swarm, node labels, secrets, generated credentials.
# Safe to re-run — it never overwrites a secret that already exists.
#
#   deploy/scripts/bootstrap.sh [--advertise-addr <internal-ip>]
#
# Run it on the machine that will be the swarm manager.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

ADVERTISE=""
while [ $# -gt 0 ]; do
	case "$1" in
		--advertise-addr) ADVERTISE="$2"; shift 2 ;;
		*) die "unknown argument $1" ;;
	esac
done

[ -f "$DEPLOY_DIR/.env" ] || die "copy deploy/.env.example to deploy/.env and fill it in first"
load_env

# --- Swarm -------------------------------------------------------------------
if ! swarm_active; then
	info "initialising swarm"
	docker swarm init ${ADVERTISE:+--advertise-addr "$ADVERTISE"}
	echo
	echo "Add the other machines (1-7 total) with:"
	docker swarm join-token worker | sed -n '3p'
	echo
fi

# --- Node labels -------------------------------------------------------------
# Placement is by label, never by hostname, so moving a role between machines is a
# label change and a redeploy.
NODE_COUNT="$(docker node ls -q | wc -l | tr -d ' ')"
if [ "$NODE_COUNT" = "1" ]; then
	SELF="$(docker node ls --format '{{.ID}}')"
	info "single-node fleet — putting every role on this machine"
	docker node update \
		--label-add techoffice.edge=true \
		--label-add techoffice.db=true \
		--label-add techoffice.app=true \
		--label-add techoffice.voice=true \
		--label-add techoffice.processing=true \
		--label-add techoffice.obs=true \
		"$SELF" >/dev/null
else
	info "fleet has ${NODE_COUNT} nodes — assign roles with deploy/scripts/label-node.sh"
	docker node ls
	echo
	echo "Every role below must be on exactly one node, except 'app' which should be on"
	echo "as many as you want backend/web replicas spread across:"
	echo "  edge db app voice processing obs"
	echo "  e.g. deploy/scripts/label-node.sh node-1 edge app"
fi

# --- Secrets -----------------------------------------------------------------
mkdir -p "$DEPLOY_DIR/secrets"
chmod 700 "$DEPLOY_DIR/secrets"

keep() { [ -s "$1" ] && { info "keeping existing $(basename "$1")"; return 0; } || return 1; }

# JWT signing key. PKCS#1, because that is what backend/internal/iam/jwt.go parses.
# Replacing this key invalidates every issued session token.
if ! keep "$DEPLOY_DIR/secrets/jwt-private.pem"; then
	info "generating JWT signing key"
	openssl genrsa -traditional -out "$DEPLOY_DIR/secrets/jwt-private.pem" 2048 2>/dev/null \
		|| openssl genrsa -out "$DEPLOY_DIR/secrets/jwt-private.pem" 2048 2>/dev/null
	grep -q 'BEGIN RSA PRIVATE KEY' "$DEPLOY_DIR/secrets/jwt-private.pem" \
		|| die "generated key is not PKCS#1; convert it with: openssl rsa -traditional -in ... -out ..."
fi

# Optional credential files. Placeholders keep the swarm secret mounts valid; the
# scripts detect them and leave the corresponding feature switched off.
for f in fcm.json apns.p8 tls.crt tls.key tls2.crt tls2.key; do
	[ -s "$DEPLOY_DIR/secrets/$f" ] || echo "PLACEHOLDER — replace with the real $f" >"$DEPLOY_DIR/secrets/$f"
done
if [ "$TLS_MODE" = "file" ]; then
	grep -q PLACEHOLDER "$DEPLOY_DIR/secrets/tls.crt" \
		&& die "TLS_MODE=file but deploy/secrets/tls.crt is still a placeholder"
fi

# Generated passwords are written back into .env so the operator can read them once
# and store them properly.
gen_into_env() {
	local key="$1" value
	if grep -qE "^${key}=[^[:space:]#]" "$DEPLOY_DIR/.env"; then return 0; fi
	value="$(openssl rand -base64 36 | tr -d '/+=' | cut -c1-40)"
	if grep -qE "^${key}=" "$DEPLOY_DIR/.env"; then
		sed -i.bak "s|^${key}=.*|${key}=${value}|" "$DEPLOY_DIR/.env" && rm -f "$DEPLOY_DIR/.env.bak"
	else
		echo "${key}=${value}" >>"$DEPLOY_DIR/.env"
	fi
	info "generated ${key}"
}
gen_into_env POSTGRES_PASSWORD
gen_into_env LIVEKIT_API_SECRET
gen_into_env BACKUP_CIPHER_PASS
gen_into_env OBSERVE_ROOT_PASSWORD
load_env

# DATABASE_URL has to agree with the password that was just generated.
NEW_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable"
if [ "${DATABASE_URL}" != "$NEW_URL" ]; then
	sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=${NEW_URL}|" "$DEPLOY_DIR/.env" && rm -f "$DEPLOY_DIR/.env.bak"
	info "rewrote DATABASE_URL to match POSTGRES_PASSWORD"
	load_env
fi

# R2 is checked here because the backend exits at startup without it, which otherwise
# shows up as a crash-looping service long after bootstrap said it was finished.
require_env POSTGRES_PASSWORD BACKUP_S3_BUCKET BACKUP_S3_KEY BACKUP_S3_KEY_SECRET \
	BACKUP_CIPHER_PASS LIVEKIT_API_SECRET WEB_DOMAIN API_DOMAIN MEDIA_DOMAIN \
	R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_ENDPOINT

# --- pgBackRest configuration ------------------------------------------------
# Holds the object-storage credentials and the backup encryption passphrase, so it
# is a secret rather than a config.
cat >"$DEPLOY_DIR/secrets/pgbackrest.conf" <<EOF
[global]
repo1-type=s3
repo1-path=/techoffice
repo1-s3-bucket=${BACKUP_S3_BUCKET}
repo1-s3-endpoint=$(echo "${BACKUP_S3_ENDPOINT}" | sed 's#^https\?://##')
repo1-s3-region=${BACKUP_S3_REGION}
repo1-s3-uri-style=${BACKUP_S3_URI_STYLE}
repo1-s3-key=${BACKUP_S3_KEY}
repo1-s3-key-secret=${BACKUP_S3_KEY_SECRET}

# Client-side encryption: the bucket operator cannot read these backups, and neither
# can you without BACKUP_CIPHER_PASS. Store it outside this fleet.
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=${BACKUP_CIPHER_PASS}

repo1-retention-full=${BACKUP_RETENTION_FULL}
# Bundling packs small files into larger objects — many fewer S3 requests.
repo1-bundle=y
compress-type=zst
compress-level=3
process-max=4
start-fast=y
log-level-console=info
log-level-file=off
# Shared with the postgres container so archive-push and backup cannot race.
lock-path=/var/lib/pgbackrest-lock
spool-path=/var/lib/pgbackrest-lock/spool

[techoffice]
pg1-path=/var/lib/postgresql/data/pgdata
pg1-socket-path=/var/run/postgresql
pg1-port=5432
EOF
chmod 600 "$DEPLOY_DIR/secrets/pgbackrest.conf"
info "wrote deploy/secrets/pgbackrest.conf"

render_configs
info "rendered configuration (config version ${CONFIG_VERSION})"

cat <<EOF

Bootstrap complete.

  Secrets live in deploy/secrets/ (mode 700). They are NOT in git — back them up
  somewhere else, especially:
    jwt-private.pem      losing it logs every user out
    BACKUP_CIPHER_PASS   losing it makes every backup unreadable

  Next:
    1. install real deploy/secrets/fcm.json and deploy/secrets/apns.p8 if you want push
    2. deploy/scripts/build-images.sh
    3. deploy/scripts/deploy.sh
EOF
