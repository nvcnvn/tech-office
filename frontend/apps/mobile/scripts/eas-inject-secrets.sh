#!/usr/bin/env bash
# EAS Build Pre-install Hook — inject Firebase credential files from EAS Secrets.
#
# Required EAS Secrets (set via `eas secret:push` or the Expo dashboard):
#   FIREBASE_IOS_PLIST   — base64-encoded GoogleService-Info.plist (iOS)
#   FIREBASE_ANDROID_JSON — base64-encoded google-services.json (Android)
#
# The script creates these files at the mobile project root. When native
# projects are checked in, Xcode consumes ios/TechOffice/GoogleService-Info.plist
# directly, so keep the managed and native locations in sync here as well.
#
# In local development, copy the files manually — they are gitignored.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

log()  { echo "› [eas-inject-secrets] $*"; }
warn() { echo "⚠ [eas-inject-secrets] $*" >&2; }

# ── iOS: GoogleService-Info.plist ─────────────────────────────────────────────
PLIST_PATH="${PROJECT_ROOT}/GoogleService-Info.plist"
PLIST_SCRIPT_PATH="${SCRIPT_DIR}/GoogleService-Info.plist"
IOS_PLIST_PATH="${PROJECT_ROOT}/ios/TechOffice/GoogleService-Info.plist"
echo "Injecting Firebase credentials into ${PLIST_PATH} and ${PLIST_SCRIPT_PATH} (iOS) and ${IOS_PLIST_PATH} (native iOS)"

if [[ -n "${FIREBASE_IOS_PLIST:-}" ]]; then
  log "FIREBASE_IOS_PLIST secret found — writing ${PLIST_PATH}"
  echo "${FIREBASE_IOS_PLIST}" | base64 -d > "${PLIST_PATH}"
  log "iOS plist written (${#FIREBASE_IOS_PLIST} base64 chars)"
elif [[ -f "${PLIST_PATH}" ]]; then
  log "No FIREBASE_IOS_PLIST secret; using ${PLIST_PATH}"
elif [[ -f "${PLIST_SCRIPT_PATH}" ]]; then
  log "No plist at project root; copying local scripts/ fallback from ${PLIST_SCRIPT_PATH}"
  cp "${PLIST_SCRIPT_PATH}" "${PLIST_PATH}"
  log "iOS plist copied from scripts/ fallback"
else
  warn "Missing FIREBASE_IOS_PLIST secret, no plist at project root, and no local scripts/ fallback."
  warn "The iOS build will fail without it."
  warn "→ Run: eas secret:push --scope project --env-file .env.secrets"
  exit 1
fi

mkdir -p "$(dirname "${IOS_PLIST_PATH}")"
cp "${PLIST_PATH}" "${IOS_PLIST_PATH}"
log "iOS plist synced to ${IOS_PLIST_PATH}"

# ── Android: google-services.json ─────────────────────────────────────────────
JSON_PATH="${PROJECT_ROOT}/google-services.json"
JSON_SCRIPT_PATH="${SCRIPT_DIR}/google-services.json"

if [[ -n "${FIREBASE_ANDROID_JSON:-}" ]]; then
  log "FIREBASE_ANDROID_JSON secret found — writing ${JSON_PATH}"
  echo "${FIREBASE_ANDROID_JSON}" | base64 -d > "${JSON_PATH}"
  log "Android json written (${#FIREBASE_ANDROID_JSON} base64 chars)"
elif [[ -f "${JSON_PATH}" ]]; then
  log "No FIREBASE_ANDROID_JSON secret; using ${JSON_PATH}"
elif [[ -f "${JSON_SCRIPT_PATH}" ]]; then
  log "No json at project root; copying committed fallback from ${JSON_SCRIPT_PATH}"
  cp "${JSON_SCRIPT_PATH}" "${JSON_PATH}"
  log "Android json copied from scripts/ fallback"
else
  warn "Missing FIREBASE_ANDROID_JSON secret, no json at project root, and no scripts/ fallback."
  warn "Android build will fail without it."
  exit 1
fi

log "Done – Firebase credentials injected."
