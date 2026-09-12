#!/usr/bin/env node
/**
 * Store manifest check (Feature 036, FR-026/FR-029/FR-030).
 *
 * Both stores treat a declared-but-unused permission, and a permission string that
 * reads like a framework default, as a submission finding. A one-time cleanup
 * regresses the first time somebody adds a library — SYSTEM_ALERT_WINDOW arrived
 * that way — so this runs in CI and fails the build.
 *
 * It checks the Expo config, and additionally the generated native manifests when
 * `expo prebuild` has produced them, since a transitive Android permission only
 * becomes visible after the merge.
 *
 * Usage:  node scripts/check-store-manifest.js
 */

const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../../..");

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

// ---------------------------------------------------------------------------
// The allowed sets. Adding an entry here means the app genuinely uses it AND
// docs/compliance/permission-justifications.md explains why to a reviewer.
// ---------------------------------------------------------------------------

const ALLOWED_IOS_KEYS = new Set([
  "NSMicrophoneUsageDescription",
  "NSCameraUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSLocationWhenInUseUsageDescription",
]);

const ALLOWED_ANDROID_PERMISSIONS = new Set([
  "android.permission.RECORD_AUDIO",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
]);

// Permissions the OS or a build tool always adds and that carry no user-facing
// prompt. Listing them keeps the check about the permissions people are asked for.
const ANDROID_PERMISSIONS_IGNORED = new Set([
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VIDEO",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "com.google.android.c2dm.permission.RECEIVE",
]);

const REQUIRED_ANDROID_PERMISSIONS = ["android.permission.POST_NOTIFICATIONS"];

const BLOCKED_ANDROID_PERMISSIONS = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
];

const FORBIDDEN_IOS_KEYS = [
  // The app only ever calls requestForegroundPermissionsAsync. Declaring an
  // "always" key asks for something it never uses (FR-001).
  "NSLocationAlwaysUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  // There is no biometric sign-in anywhere in the app: the only secure-store
  // call configures at-rest key protection and never requests authentication
  // (FR-002).
  "NSFaceIDUsageDescription",
  // Development-only; must not reach a production manifest (FR-003).
  "NSLocalNetworkUsageDescription",
  "NSBonjourServices",
];

// Phrases that reveal a string was never written for the person reading it.
const DEVELOPMENT_ONLY_PHRASES = [
  "development server",
  "debugging",
  "localhost",
  "metro",
  "test",
  "todo",
  "lorem",
];

// Internal vocabulary a reviewer cannot parse. "ritual" is this product's word for
// a recurring task; nobody outside the team knows that.
const INTERNAL_VOCABULARY = ["ritual", "employee_id", "rpc", "tenant"];

const MIN_PERMISSION_STRING_LENGTH = 40;

// ---------------------------------------------------------------------------
// The compliance-prose vocabulary (Feature 054, FR-016/FR-017/FR-018).
//
// Feature 053 stopped the app *asking* for a Face ID permission it never used and
// left the prose a reviewer actually reads still promising the feature. A
// capability named in a document pasted into a store console is a claim, and a
// reviewer who goes looking for it and cannot find it has found a discrepancy by
// following our own instructions.
//
// Each term is mapped to the declaration that would make naming it a true claim.
// "Declared" is `ALLOWED_IOS_KEYS ∪ ALLOWED_ANDROID_PERMISSIONS` — the sets above —
// rather than a second list, because a second list of what the app declares is the
// failure mode this rule exists to catch, one layer up.
//
// The terms are compound where the bare word would be ambiguous. "location",
// "camera", "photos", "microphone" and "notifications" are absent because they are
// declared and would pass trivially; "calendar" and "contacts" are absent because
// they are this product's own feature words.
// ---------------------------------------------------------------------------

const CAPABILITY_TERMS = [
  ["face id", "NSFaceIDUsageDescription"],
  ["touch id", "NSFaceIDUsageDescription"],
  ["biometric", "android.permission.USE_BIOMETRIC"],
  ["fingerprint", "android.permission.USE_FINGERPRINT"],
  ["background location", "NSLocationAlwaysUsageDescription"],
  ["always-on location", "NSLocationAlwaysAndWhenInUseUsageDescription"],
  ["bluetooth", "android.permission.BLUETOOTH_CONNECT"],
  ["healthkit", "NSHealthShareUsageDescription"],
  ["speech recognition", "NSSpeechRecognitionUsageDescription"],
  ["motion and fitness", "NSMotionUsageDescription"],
  ["nfc", "NFCReaderUsageDescription"],
  ["contact list", "NSContactsUsageDescription"],
  ["address book", "NSContactsUsageDescription"],
];

// Recording an absence is the opposite of promising a feature, so each document
// declares the sections where it may name a capability the app does not have. This
// is the whole exemption mechanism: a term outside these sections whose declaration
// is not in the allowed set fails the build.
//
// Deliberately not negation detection ("no", "not", "never" in the sentence). That
// is a natural-language heuristic pretending to be a build rule, and it fails open
// in the dangerous direction — "Face ID sign-in requires no additional setup" would
// pass it while being exactly the false promise this guards against.
const RECORDED_ABSENCE_SECTIONS = {
  "permission-justifications.md": ["Permissions deliberately blocked", "Keys deliberately absent"],
  "data-collection-inventory.md": ["Not collected"],
  "reviewer-notes.md": ["Not requested"],
  "age-rating-answers.md": ["Capabilities the app does not have"],
};

/**
 * 1-based line numbers of every line inside one of `headings` in `content`.
 *
 * A section opens at its heading line and closes at the next heading of the same or
 * shallower level, or at end of file. A deeper sub-heading does not close it, so a
 * `#### NSFaceIDUsageDescription` under `### Keys deliberately absent` stays exempt.
 * Headings are matched case-insensitively after trimming.
 */
function recordedAbsenceLines(content, headings) {
  const wanted = new Set(headings.map((heading) => heading.trim().toLowerCase()));
  const exempt = new Set();
  let openLevel = 0;

  content.split("\n").forEach((line, index) => {
    const heading = /^(#{1,6})\s+(.*?)$/.exec(line.trim());
    if (heading) {
      const level = heading[1].length;
      if (openLevel > 0 && level <= openLevel) openLevel = 0;
      if (wanted.has(heading[2].toLowerCase())) openLevel = level;
    }
    if (openLevel > 0) exempt.add(index + 1);
  });

  return exempt;
}

module.exports = { CAPABILITY_TERMS, RECORDED_ABSENCE_SECTIONS, recordedAbsenceLines };

// Everything below runs the gate. `check-compliance-prose.check.js` requires this
// file for the region parser above and must not trigger a full run by doing so.
if (require.main !== module) return;

// ---------------------------------------------------------------------------
// 1. Expo config
// ---------------------------------------------------------------------------

const appJson = JSON.parse(fs.readFileSync(path.join(appRoot, "app.json"), "utf8"));
const expo = appJson.expo;

const infoPlist = expo.ios?.infoPlist ?? {};

for (const key of FORBIDDEN_IOS_KEYS) {
  if (key in infoPlist) {
    fail(`app.json declares ${key}, which must not ship. See FR-001/FR-002/FR-003.`);
  }
}

for (const [key, value] of Object.entries(infoPlist)) {
  if (!key.endsWith("UsageDescription")) continue;
  if (!ALLOWED_IOS_KEYS.has(key)) {
    fail(`app.json declares an unexpected iOS permission ${key}. Add it to ALLOWED_IOS_KEYS and to docs/compliance/permission-justifications.md, or remove it.`);
    continue;
  }
  checkPermissionString(`app.json ios.infoPlist.${key}`, value);
}

for (const key of ALLOWED_IOS_KEYS) {
  if (!(key in infoPlist)) {
    fail(`app.json is missing ${key}; every permission the app requests must explain itself.`);
  }
}

if (infoPlist.ITSAppUsesNonExemptEncryption !== false) {
  fail("app.json must set ios.infoPlist.ITSAppUsesNonExemptEncryption to false; otherwise every build asks the export-compliance question again.");
}

const androidPermissions = expo.android?.permissions ?? [];
for (const permission of androidPermissions) {
  if (!ALLOWED_ANDROID_PERMISSIONS.has(permission)) {
    fail(`app.json declares an unexpected Android permission ${permission}. Add it to ALLOWED_ANDROID_PERMISSIONS and to docs/compliance/permission-justifications.md, or remove it.`);
  }
}
for (const permission of REQUIRED_ANDROID_PERMISSIONS) {
  if (!androidPermissions.includes(permission)) {
    fail(`app.json is missing ${permission}. Without it push is silently dropped on every Android 13+ device (FR-028).`);
  }
}

const blocked = expo.android?.blockedPermissions ?? [];
for (const permission of BLOCKED_ANDROID_PERMISSIONS) {
  if (!blocked.includes(permission)) {
    fail(`app.json must block ${permission}: it arrives transitively and nothing in the app uses it (FR-026).`);
  }
}

// Plugin-supplied permission strings are the ones most likely to be left at a
// framework default, because nobody sees them until a device prompts.
for (const plugin of expo.plugins ?? []) {
  if (!Array.isArray(plugin)) continue;
  const [name, options] = plugin;
  if (!options || typeof options !== "object") continue;
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === "string" && /Permission$/.test(key)) {
      checkPermissionString(`app.json plugin ${name}.${key}`, value);
    }
  }
  if (name === "expo-location") {
    if (options.isAndroidBackgroundLocationEnabled || options.isIosBackgroundLocationEnabled) {
      fail("expo-location must not enable background location: the app only calls requestForegroundPermissionsAsync (FR-027).");
    }
  }
}

// A forbidden key can re-enter the build without ever appearing in
// ios.infoPlist: @expo/config-plugins deletes a permission key only when the
// plugin option is strictly `false`, and otherwise falls back to
// `option || existingPlistValue || libraryDefault`. A missing option is
// therefore as bad as a string one — it restores the library's own default
// text. These three switches are what keep FR-001 and FR-002 true at the
// source rather than only in the committed tree.
const REQUIRED_FALSE_PLUGIN_OPTIONS = [
  ["expo-secure-store", "faceIDPermission", "NSFaceIDUsageDescription"],
  ["expo-location", "locationAlwaysPermission", "NSLocationAlwaysUsageDescription"],
  ["expo-location", "locationAlwaysAndWhenInUsePermission", "NSLocationAlwaysAndWhenInUseUsageDescription"],
];

for (const [pluginName, option, key] of REQUIRED_FALSE_PLUGIN_OPTIONS) {
  const entry = (expo.plugins ?? []).find((p) => (Array.isArray(p) ? p[0] : p) === pluginName);
  const options = Array.isArray(entry) ? entry[1] : undefined;
  if (!options || options[option] !== false) {
    fail(`app.json plugin ${pluginName} must set ${option} to false; any other value — including leaving it out — makes the build declare ${key}, which must not ship. See FR-001/FR-002.`);
  }
}

function checkPermissionString(where, value) {
  if (typeof value !== "string") {
    fail(`${where} is not a string.`);
    return;
  }
  const lower = value.toLowerCase();
  for (const phrase of DEVELOPMENT_ONLY_PHRASES) {
    if (lower.includes(phrase)) {
      fail(`${where} contains the development-only phrase "${phrase}": ${JSON.stringify(value)}`);
    }
  }
  for (const word of INTERNAL_VOCABULARY) {
    if (lower.includes(word)) {
      fail(`${where} uses internal vocabulary "${word}", which a reviewer cannot parse: ${JSON.stringify(value)}`);
    }
  }
  if (value.length < MIN_PERMISSION_STRING_LENGTH) {
    fail(`${where} is shorter than ${MIN_PERMISSION_STRING_LENGTH} characters, so it cannot be naming the feature it enables: ${JSON.stringify(value)}`);
  }
  if (!/tech office/i.test(value)) {
    fail(`${where} should name the app so the prompt reads as a sentence: ${JSON.stringify(value)}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Generated native manifests, when prebuild has produced them.
//
// This is where a transitive Android permission becomes visible, so a green run
// without these files is weaker than one with them — say so rather than implying
// full coverage.
// ---------------------------------------------------------------------------

const androidManifestPath = path.join(appRoot, "android/app/src/main/AndroidManifest.xml");
if (fs.existsSync(androidManifestPath)) {
  const manifest = fs.readFileSync(androidManifestPath, "utf8");
  const declared = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  const removed = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"[^>]*tools:node="remove"/g)].map((m) => m[1]);

  for (const permission of declared) {
    if (removed.includes(permission)) continue;
    if (ALLOWED_ANDROID_PERMISSIONS.has(permission)) continue;
    if (ANDROID_PERMISSIONS_IGNORED.has(permission)) continue;
    fail(`AndroidManifest.xml declares ${permission}, which is in neither the allowed nor the ignored set. If a dependency added it, block it in app.json (FR-026).`);
  }
  for (const permission of BLOCKED_ANDROID_PERMISSIONS) {
    if (declared.includes(permission) && !removed.includes(permission)) {
      fail(`AndroidManifest.xml still declares ${permission} despite blockedPermissions.`);
    }
  }
  for (const permission of REQUIRED_ANDROID_PERMISSIONS) {
    if (!declared.includes(permission)) {
      fail(`AndroidManifest.xml is missing ${permission} (FR-028).`);
    }
  }
} else {
  notes.push("AndroidManifest.xml not found — run `npx expo prebuild --platform android` for the full check. Transitive permissions are only visible after prebuild.");
}

const infoPlistPath = path.join(appRoot, "ios/TechOffice/Info.plist");
if (fs.existsSync(infoPlistPath)) {
  const plist = fs.readFileSync(infoPlistPath, "utf8");
  for (const key of FORBIDDEN_IOS_KEYS) {
    if (plist.includes(`<key>${key}</key>`)) {
      fail(`Info.plist declares ${key}, which must not ship (FR-001/FR-002/FR-003).`);
    }
  }
  if (!plist.includes("<key>ITSAppUsesNonExemptEncryption</key>")) {
    fail("Info.plist is missing ITSAppUsesNonExemptEncryption.");
  }
  // The committed plist is where a framework default actually lives — a
  // placeholder like "Allow $(PRODUCT_NAME) to access your location" never
  // appears in app.json, so checking only the Expo config missed it. The
  // generated top-level dictionary is flat, so a regex over <key>/<string>
  // pairs is enough and keeps this script dependency-free. Keys whose value is
  // not a <string> (NSBonjourServices is an <array>) are covered by the
  // forbidden-key check above.
  for (const [, key, value] of plist.matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)) {
    if (!key.endsWith("UsageDescription")) continue;
    if (!ALLOWED_IOS_KEYS.has(key)) {
      fail(`Info.plist declares an unexpected iOS permission ${key}. Add it to ALLOWED_IOS_KEYS and to docs/compliance/permission-justifications.md, or remove it.`);
      continue;
    }
    checkPermissionString(`Info.plist ${key}`, value);
  }
} else {
  notes.push("Info.plist not found — run `npx expo prebuild --platform ios` for the full check.");
}

// ---------------------------------------------------------------------------
// 3. Every allowed permission has a written justification (FR-030).
// ---------------------------------------------------------------------------

const justificationsPath = path.join(repoRoot, "docs/compliance/permission-justifications.md");
if (!fs.existsSync(justificationsPath)) {
  fail("docs/compliance/permission-justifications.md is missing; every permission needs a justification a reviewer can read (FR-030).");
} else {
  const doc = fs.readFileSync(justificationsPath, "utf8");
  for (const key of ALLOWED_IOS_KEYS) {
    if (!doc.includes(key)) {
      fail(`docs/compliance/permission-justifications.md does not mention ${key}. The manifest and the document must agree (FR-030).`);
    }
  }
  for (const permission of ALLOWED_ANDROID_PERMISSIONS) {
    if (!doc.includes(permission)) {
      fail(`docs/compliance/permission-justifications.md does not mention ${permission}. The manifest and the document must agree (FR-030).`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. No compliance document names a capability the app does not declare
//    (Feature 054, FR-016/FR-017/FR-018).
// ---------------------------------------------------------------------------

const complianceDir = path.join(repoRoot, "docs/compliance");
const declared = new Set([...ALLOWED_IOS_KEYS, ...ALLOWED_ANDROID_PERMISSIONS]);

// Read the directory rather than a hard-coded list, so a fifth compliance document
// is covered the day it is added.
for (const file of fs.readdirSync(complianceDir).filter((name) => name.endsWith(".md")).sort()) {
  const headings = RECORDED_ABSENCE_SECTIONS[file] ?? [];
  const content = fs.readFileSync(path.join(complianceDir, file), "utf8");
  const exempt = recordedAbsenceLines(content, headings);
  const wayOut = headings.length > 0 ? headings.join(", ") : "none declared for this file";

  content.split("\n").forEach((line, index) => {
    const lower = line.toLowerCase();
    for (const [term, declaration] of CAPABILITY_TERMS) {
      if (!lower.includes(term)) continue;
      if (declared.has(declaration)) continue;
      if (exempt.has(index + 1)) continue;
      fail(
        `docs/compliance/${file}:${index + 1}: "${term}" names a capability the app does not declare ` +
          `(${declaration} is not in the allowed set). Either the app must declare it, or the sentence ` +
          `must move into a recorded-absence section (${wayOut}).`
      );
    }
  });
}

// ---------------------------------------------------------------------------

for (const note of notes) {
  console.log(`note: ${note}`);
}

if (failures.length > 0) {
  console.error(`\nstore manifest check FAILED (${failures.length} problem${failures.length === 1 ? "" : "s"}):\n`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("store manifest check passed");
