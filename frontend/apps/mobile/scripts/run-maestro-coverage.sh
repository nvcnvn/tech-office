#!/bin/zsh

setopt errexit nounset pipefail

SCRIPT_DIR=${0:A:h}
APP_DIR=${SCRIPT_DIR:h}
REPO_ROOT=${APP_DIR:h:h:h}

if (( $# > 0 )); then
  print -u2 "This runner does not accept arguments. Run a split flow directly with maestro test if needed."
  exit 2
fi

if [[ -x /opt/homebrew/Cellar/maestro/2.3.0/libexec/bin/maestro ]]; then
  MAESTRO_BIN=/opt/homebrew/Cellar/maestro/2.3.0/libexec/bin/maestro
elif command -v maestro >/dev/null 2>&1; then
  MAESTRO_BIN=$(command -v maestro)
else
  print -u2 "Maestro binary not found. Install Maestro or set MAESTRO_BIN."
  exit 1
fi

if [[ -n ${MAESTRO_BIN:-} && ! -x ${MAESTRO_BIN} ]]; then
  print -u2 "Maestro binary is not executable: ${MAESTRO_BIN}"
  exit 1
fi

cd "$REPO_ROOT"

mkdir -p tmp/maestro-screenshots frontend/apps/mobile/tmp/maestro-screenshots

env_flags=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
  # Skip keys with an empty value so a placeholder in .env cannot shadow a default set here.
  [[ "${line#*=}" == "" ]] && continue
  env_flags+=(-e "$line")
done < "$APP_DIR/.maestro/.env"

# A per-run identifier. The owner-signup flow derives a workspace address from the company
# name it types, so without this a second run would collide on the address the first
# one claimed.
if [[ -z ${MAESTRO_RUN_ID:-} ]]; then
  MAESTRO_RUN_ID=$(date +%H%M%S)
fi
env_flags+=(-e "MAESTRO_RUN_ID=$MAESTRO_RUN_ID")

# Story flows run before the coverage sweep: they exercise sign-in and onboarding from a
# fresh install, which the coverage flows then assume already works.
flows=(
  $APP_DIR/.maestro/auth/signin-known-device.yaml
  $APP_DIR/.maestro/onboarding/owner-signup.yaml
  $APP_DIR/.maestro/coverage/[0-9][0-9]-*.yaml
)
failures=0

for flow in $flows; do
  flow_name=${flow:t}
  print "\n==> Running ${flow_name}"

  if "$MAESTRO_BIN" test "${env_flags[@]}" "$flow"; then
    print "[pass] ${flow_name}"
  else
    print -u2 "[fail] ${flow_name}"
    failures=$((failures + 1))
  fi
done

if (( failures > 0 )); then
  print -u2 "\n${failures} coverage flow(s) failed."
  exit 1
fi

print "\nAll split coverage flows passed."