#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=./resolve-ip.sh
source "$(dirname "${BASH_SOURCE[0]}")/resolve-ip.sh"

IOS_DIR="$ROOT_DIR/ios"
WORKSPACE_PATH="$IOS_DIR/TechOffice.xcworkspace"
SCHEME_NAME="TechOffice"
APP_URL_SCHEME="${APP_URL_SCHEME:-techoffice}"
USER_APP_BUNDLE_ID="${APP_BUNDLE_ID:-}"
APP_BUNDLE_ID="${USER_APP_BUNDLE_ID:-com.devguards.TechOffice}"
CONFIGURATION="${CONFIGURATION:-Debug}"
METRO_PORT="${RCT_METRO_PORT:-18082}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$IOS_DIR/build/device}"
USER_DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-}"
DEVELOPMENT_TEAM="$USER_DEVELOPMENT_TEAM"
ALLOW_PROFILE_FALLBACK="${ALLOW_PROFILE_FALLBACK:-0}"
PROFILE_TEAM_ID=""
PROFILE_BUNDLE_ID=""
PROFILE_NAME=""
PROJECT_TEAM=""

DEVICE_SELECTOR="${IOS_DEVICE_NAME:-iPhone}"
INSTALL_APP=1
LAUNCH_APP=1
DRY_RUN=0

usage() {
  cat <<EOF
Usage: ./scripts/ios-device-build.sh [options]

Builds the iOS app for a physical device with automatic provisioning updates,
then installs and launches it with Xcode's device tools.

Options:
  --device <name-or-udid>  Physical device name or UDID. Default: ${DEVICE_SELECTOR}
  --configuration <name>  Xcode configuration to build. Default: ${CONFIGURATION}
  --embedded              Build a self-contained Release app with embedded JS bundle.
  --no-install            Build only.
  --no-launch             Build and install, but do not launch.
  --dry-run               Print the resolved commands without running them.
  -h, --help              Show this help message.

Environment:
  CONFIGURATION           Xcode configuration. Default: ${CONFIGURATION}
  RCT_METRO_PORT          Metro port compiled into the debug app. Default: ${METRO_PORT}
  METRO_HOST              Optional explicit Metro host to bake into Debug device builds.
  DERIVED_DATA_PATH       Derived data output directory. Default: ${DERIVED_DATA_PATH}
  APP_BUNDLE_ID           Bundle identifier to launch. Default: ${APP_BUNDLE_ID}
  APP_URL_SCHEME          URL scheme used for Expo dev-client payload launches. Default: ${APP_URL_SCHEME}
  DEVELOPMENT_TEAM        Apple team ID used for automatic signing. Auto-detected if omitted.
  ALLOW_PROFILE_FALLBACK  Set to 1 to allow automatic fallback to another installed provisioning profile.

Examples:
  pnpm ios:device
  pnpm ios:device -- --device "iPhone SE"
  pnpm ios:device -- --embedded
  pnpm ios:device -- --device 00008030-000275820E47802E --no-launch
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --device)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --device" >&2
        exit 1
      fi
      DEVICE_SELECTOR="$2"
      shift 2
      ;;
    --configuration)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --configuration" >&2
        exit 1
      fi
      CONFIGURATION="$2"
      shift 2
      ;;
    --embedded)
      CONFIGURATION="Release"
      shift
      ;;
    --no-install)
      INSTALL_APP=0
      LAUNCH_APP=0
      shift
      ;;
    --no-launch)
      LAUNCH_APP=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# Resolve Metro host for Debug builds (not needed for embedded Release builds)
METRO_HOST_OVERRIDE=""
if [[ "$CONFIGURATION" == "Debug" ]]; then
  METRO_HOST_OVERRIDE="${METRO_HOST:-${REACT_NATIVE_PACKAGER_HOSTNAME:-}}"
fi

if [[ ! -d "$WORKSPACE_PATH" ]]; then
  echo "Missing Xcode workspace at $WORKSPACE_PATH" >&2
  exit 1
fi

resolve_device_id() {
  local selector="$1"

  if [[ "$selector" =~ ^[0-9A-Fa-f-]{20,}$ ]]; then
    printf '%s\n' "$selector"
    return 0
  fi

  python3 - "$selector" <<'PY'
import json
import re
import subprocess
import sys

selector = sys.argv[1].strip().lower()


def load_xcdevice_devices():
    try:
        output = subprocess.check_output(
            ["xcrun", "xcdevice", "list"],
            stderr=subprocess.STDOUT,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        print(exc.output, file=sys.stderr)
        return None

    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        return None

    physical_devices = []
    for item in payload:
        if item.get("simulator"):
            continue
        if not item.get("available", False):
            continue

        name = item.get("name", "")
        model_name = item.get("modelName", "")
        os_version = item.get("operatingSystemVersion", "")
        identifier = item.get("identifier", "")
        interface = item.get("interface", "")
        status = item.get("platform", "")
        haystack = " ".join(
            value
            for value in [name, model_name, os_version, identifier, interface, status]
            if value
        ).lower()

        physical_devices.append(
            {
                "name": name,
                "model": model_name,
                "os": os_version,
                "identifier": identifier,
                "haystack": haystack,
            }
        )

    return physical_devices


def load_xctrace_devices():
    try:
        output = subprocess.check_output(
            ["xcrun", "xctrace", "list", "devices"],
            stderr=subprocess.STDOUT,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        print(exc.output, file=sys.stderr)
        return []

    physical_devices = []
    in_devices_section = False
    pattern = re.compile(r"^(?P<name>.+?) \((?P<os>[^()]*)\) \((?P<udid>[0-9A-Fa-f-]{20,})\)(?: \((?P<extra>[^()]*)\))?$")

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line == "== Devices ==":
            in_devices_section = True
            continue
        if line.startswith("=="):
            in_devices_section = False
            continue
        if not in_devices_section:
            continue

        match = pattern.match(line)
        if not match:
            continue

        name = match.group("name")
        os_version = match.group("os")
        identifier = match.group("udid")
        extra = match.group("extra") or ""
        haystack = f"{name} {os_version} {identifier} {extra}".lower()
        physical_devices.append(
            {
                "name": name,
                "model": "",
                "os": os_version,
                "identifier": identifier,
                "haystack": haystack,
            }
        )

    return physical_devices


devices = load_xcdevice_devices()
if not devices:
  devices = load_xctrace_devices()

matches = [device for device in devices if selector in device["haystack"]]

if len(matches) == 1:
    print(matches[0]["identifier"])
    sys.exit(0)

if len(matches) == 0:
    print(f"No connected physical device matched '{sys.argv[1]}'.", file=sys.stderr)
else:
    print(f"Multiple physical devices matched '{sys.argv[1]}'.", file=sys.stderr)

if devices:
    print("Available physical devices:", file=sys.stderr)
    for device in devices:
        model_suffix = f" {device['model']}" if device["model"] else ""
        print(
            f"  - {device['name']}{model_suffix} ({device['os']}) [{device['identifier']}]",
            file=sys.stderr,
        )
else:
    print("No physical devices were reported by xcdevice or xctrace.", file=sys.stderr)

sys.exit(1)
PY
}

resolve_development_team() {
  if [[ -n "$DEVELOPMENT_TEAM" ]]; then
  printf '%s\n' "$DEVELOPMENT_TEAM"
  return 0
  fi

  PROJECT_TEAM="$(xcodebuild -workspace "$WORKSPACE_PATH" -scheme "$SCHEME_NAME" -showBuildSettings 2>/dev/null | awk -F' = ' '/ DEVELOPMENT_TEAM = / {print $2; exit}')"
  if [[ -n "$PROJECT_TEAM" ]]; then
  printf '%s\n' "$PROJECT_TEAM"
  return 0
  fi

  if [[ -n "$PROFILE_TEAM_ID" ]]; then
  printf '%s\n' "$PROFILE_TEAM_ID"
  return 0
  fi

  python3 - <<'PY'
import re
import subprocess
import sys

try:
  output = subprocess.check_output(
    ["security", "find-identity", "-v", "-p", "codesigning"],
    stderr=subprocess.STDOUT,
    text=True,
  )
except subprocess.CalledProcessError as exc:
  print(exc.output, file=sys.stderr)
  sys.exit(1)

matches = re.findall(r'Apple Development: .* \(([A-Z0-9]{10})\)', output)
if not matches:
  print(
    "No Apple Development signing identity was found. Set DEVELOPMENT_TEAM explicitly.",
    file=sys.stderr,
  )
  sys.exit(1)

print(matches[0])
PY
}

resolve_local_profiles() {
  python3 - "$APP_BUNDLE_ID" <<'PY'
import os
import plistlib
import subprocess
import sys
from pathlib import Path

target_bundle = sys.argv[1]
profiles_dir = Path.home() / "Library/MobileDevice/Provisioning Profiles"

if not profiles_dir.exists():
  sys.exit(0)

profiles = []
for profile_path in sorted(profiles_dir.glob("*.mobileprovision")):
  try:
    payload = subprocess.check_output(
      ["security", "cms", "-D", "-i", str(profile_path)],
      stderr=subprocess.DEVNULL,
    )
    plist = plistlib.loads(payload)
  except Exception:
    continue

  team_ids = plist.get("TeamIdentifier") or []
  app_identifier = ((plist.get("Entitlements") or {}).get("application-identifier"))
  if not team_ids or not app_identifier or "." not in app_identifier:
    continue

  team_id = team_ids[0]
  _, bundle_id = app_identifier.split(".", 1)
  is_wildcard = bundle_id == "*"

  profiles.append({
    "team_id": team_id,
    "bundle_id": bundle_id,
    "name": plist.get("Name", profile_path.name),
    "is_wildcard": is_wildcard,
  })

if not profiles:
  sys.exit(0)

exact_match = next(
  (
    profile
    for profile in profiles
    if not profile["is_wildcard"] and profile["bundle_id"] == target_bundle
  ),
  None,
)

selected = None
if exact_match is None:
  preferred_prefixes = ("com.devguards.", "com.")
  for prefix in preferred_prefixes:
    selected = next(
      (
        profile
        for profile in profiles
        if not profile["is_wildcard"] and profile["bundle_id"].startswith(prefix)
      ),
      None,
    )
    if selected is not None:
      break

if selected is None:
  selected = next((profile for profile in profiles if not profile["is_wildcard"]), None)

if selected is None:
  selected = profiles[0]

if exact_match is not None:
  print(f'exact\t{exact_match["team_id"]}\t{exact_match["bundle_id"]}\t{exact_match["name"]}')

print(f'fallback\t{selected["team_id"]}\t{selected["bundle_id"]}\t{selected["name"]}')
PY
}

PROFILE_LINES="$(resolve_local_profiles || true)"
if [[ -n "$PROFILE_LINES" ]]; then
  while IFS=$'\t' read -r profile_kind profile_team profile_bundle profile_name; do
    if [[ "$profile_kind" == "exact" ]]; then
      PROFILE_TEAM_ID="$profile_team"
      PROFILE_BUNDLE_ID="$profile_bundle"
      PROFILE_NAME="$profile_name"
    elif [[ "$profile_kind" == "fallback" && -z "$PROFILE_NAME" ]]; then
      PROFILE_TEAM_ID="$profile_team"
      PROFILE_BUNDLE_ID="$profile_bundle"
      PROFILE_NAME="$profile_name"
    fi
  done <<< "$PROFILE_LINES"
fi

if [[ -z "$USER_DEVELOPMENT_TEAM" && -n "$PROFILE_TEAM_ID" ]]; then
  DEVELOPMENT_TEAM="$PROFILE_TEAM_ID"
fi

if [[ "$ALLOW_PROFILE_FALLBACK" == "1" && -z "$USER_APP_BUNDLE_ID" && -z "$USER_DEVELOPMENT_TEAM" ]]; then
  if [[ -n "$PROFILE_BUNDLE_ID" && "$PROFILE_BUNDLE_ID" != "$APP_BUNDLE_ID" ]]; then
    echo "Using installed provisioning profile '$PROFILE_NAME' for local device build override." >&2
    echo "Overriding bundle ID to $PROFILE_BUNDLE_ID and team to $PROFILE_TEAM_ID." >&2
    APP_BUNDLE_ID="$PROFILE_BUNDLE_ID"
    DEVELOPMENT_TEAM="$PROFILE_TEAM_ID"
  fi
fi

if [[ -z "$USER_DEVELOPMENT_TEAM" ]]; then
  PROJECT_TEAM="$(xcodebuild -workspace "$WORKSPACE_PATH" -scheme "$SCHEME_NAME" -showBuildSettings 2>/dev/null | awk -F' = ' '/ DEVELOPMENT_TEAM = / {print $2; exit}')"
fi

if [[ -n "$PROFILE_NAME" && "$PROFILE_BUNDLE_ID" != "$APP_BUNDLE_ID" && "$ALLOW_PROFILE_FALLBACK" != "1" && -z "$USER_APP_BUNDLE_ID" && -z "$USER_DEVELOPMENT_TEAM" && -z "$PROJECT_TEAM" ]]; then
  echo "No installed provisioning profile matches $APP_BUNDLE_ID." >&2
  echo "Closest local profile is '$PROFILE_NAME' for $PROFILE_BUNDLE_ID (team $PROFILE_TEAM_ID)." >&2
  echo "Either set APP_BUNDLE_ID/DEVELOPMENT_TEAM to a provisioned app ID, or rerun with ALLOW_PROFILE_FALLBACK=1 for a local-only override." >&2
  exit 1
fi

DEVICE_ID="$(resolve_device_id "$DEVICE_SELECTOR")"
TEAM_ID="$(resolve_development_team)"
APP_PATH="$DERIVED_DATA_PATH/Build/Products/${CONFIGURATION}-iphoneos/TechOffice.app"

XCODEBUILD_COMMAND=(
  xcodebuild
  -workspace "$WORKSPACE_PATH"
  -scheme "$SCHEME_NAME"
  -configuration "$CONFIGURATION"
  -destination "id=$DEVICE_ID"
  -derivedDataPath "$DERIVED_DATA_PATH"
  -allowProvisioningUpdates
  -allowProvisioningDeviceRegistration
  DEVELOPMENT_TEAM="$TEAM_ID"
  CODE_SIGN_STYLE=Automatic
  PRODUCT_BUNDLE_IDENTIFIER="$APP_BUNDLE_ID"
  build
)

INSTALL_COMMAND=(
  xcrun
  devicectl
  device
  install
  app
  --device "$DEVICE_ID"
  "$APP_PATH"
)

echo "Resolved device: $DEVICE_SELECTOR ($DEVICE_ID)"
echo "Using RCT_METRO_PORT=$METRO_PORT"
if [[ -n "$METRO_HOST_OVERRIDE" ]]; then
echo "Using METRO_HOST=$METRO_HOST_OVERRIDE"
echo "Using EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL"
fi
echo "Using DEVELOPMENT_TEAM=$TEAM_ID"
echo "Using CONFIGURATION=$CONFIGURATION"

if [[ "$DRY_RUN" -eq 1 ]]; then
  if [[ -n "$METRO_HOST_OVERRIDE" ]]; then
    printf 'EXPO_PUBLIC_API_URL=%q REACT_NATIVE_PACKAGER_HOSTNAME=%q METRO_HOST=%q ' "$EXPO_PUBLIC_API_URL" "$METRO_HOST_OVERRIDE" "$METRO_HOST_OVERRIDE"
  fi
  printf 'RCT_METRO_PORT=%q ' "$METRO_PORT"
  printf '%q ' "${XCODEBUILD_COMMAND[@]}"
  printf '\n'
  if [[ "$INSTALL_APP" -eq 1 ]]; then
    printf '%q ' "${INSTALL_COMMAND[@]}"
    printf '\n'
  fi
  exit 0
fi

if [[ -n "$METRO_HOST_OVERRIDE" ]]; then
  EXPO_PUBLIC_API_URL="$EXPO_PUBLIC_API_URL" \
  REACT_NATIVE_PACKAGER_HOSTNAME="$METRO_HOST_OVERRIDE" \
  METRO_HOST="$METRO_HOST_OVERRIDE" \
  RCT_METRO_PORT="$METRO_PORT" \
  "${XCODEBUILD_COMMAND[@]}"
else
  RCT_METRO_PORT="$METRO_PORT" "${XCODEBUILD_COMMAND[@]}"
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "Expected built app at $APP_PATH, but it was not found." >&2
  exit 1
fi

if [[ "$CONFIGURATION" == "Debug" && -n "$METRO_HOST_OVERRIDE" ]]; then
  printf '%s\n' "$METRO_HOST_OVERRIDE" > "$APP_PATH/ip.txt"
fi

LAUNCH_COMMAND=(
  xcrun
  devicectl
  device
  process
  launch
  --device "$DEVICE_ID"
)

if [[ "$CONFIGURATION" == "Debug" && -f "$APP_PATH/ip.txt" ]]; then
  PAYLOAD_HOST="$(tr -d '[:space:]' < "$APP_PATH/ip.txt")"
  if [[ -n "$PAYLOAD_HOST" ]]; then
    PAYLOAD_URL="$(python3 - "$APP_URL_SCHEME" "$PAYLOAD_HOST" "$METRO_PORT" <<'PY'
import sys
from urllib.parse import quote

scheme, host, port = sys.argv[1:4]
bundle_url = f"http://{host}:{port}"
print(f"{scheme}://expo-development-client/?url={quote(bundle_url, safe='')}")
PY
)"
    LAUNCH_COMMAND+=(--payload-url "$PAYLOAD_URL")
  fi
fi

LAUNCH_COMMAND+=("$APP_BUNDLE_ID")

if [[ "$INSTALL_APP" -eq 1 ]]; then
  "${INSTALL_COMMAND[@]}"
fi

if [[ "$LAUNCH_APP" -eq 1 ]]; then
  "${LAUNCH_COMMAND[@]}" || {
    echo "Launch failed. If the device is locked, unlock it and open TechOffice manually." >&2
    exit 1
  }
fi

if [[ "$CONFIGURATION" == "Debug" ]]; then
  echo "Debug app is installed. Start Metro with: pnpm start"
else
  echo "Embedded app is installed. Metro is not required for launch."
fi