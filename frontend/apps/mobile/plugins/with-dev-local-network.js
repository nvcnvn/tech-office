const { withInfoPlist } = require("expo/config-plugins");

/**
 * Owns the iOS local-network keys: present ONLY when EXPO_LOCAL_DEV_NETWORK=1.
 *
 * NSLocalNetworkUsageDescription and NSBonjourServices exist solely so a debug
 * build can reach a Metro server on the LAN. Shipping them means the App Store
 * listing declares local-network access the released app never uses, and the
 * string a reviewer sees says "local development server while debugging" — a
 * finding on both counts (FR-003).
 *
 * They are not ours to simply not-add: expo-dev-launcher's own config plugin
 * (autolinked through expo-dev-client) writes both keys unconditionally on
 * every prebuild, with its "Expo Dev Launcher uses the local network…" default
 * text, and strips them again only in a non-Debug Xcode build phase. That is
 * too late for a committed prebuild, which is the artifact EAS builds and the
 * store-manifest gate reads — so this plugin deletes them when the opt-in is
 * off. Without the delete, regenerating from app.json reintroduces both keys
 * and the committed tree stops agreeing with its own source (FR-006, FR-007).
 *
 * Developers running a dev client on a physical device over the LAN export
 * EXPO_LOCAL_DEV_NETWORK=1 before `expo prebuild`. Production builds set
 * nothing, so the keys are absent and scripts/check-store-manifest.js stays
 * green.
 */
const withDevLocalNetwork = (config) =>
  withInfoPlist(config, (modConfig) => {
    if (process.env.EXPO_LOCAL_DEV_NETWORK === "1") {
      modConfig.modResults.NSLocalNetworkUsageDescription =
        "Tech Office connects to a local development server while debugging.";
      modConfig.modResults.NSBonjourServices = ["_http._tcp"];
    } else {
      delete modConfig.modResults.NSLocalNetworkUsageDescription;
      delete modConfig.modResults.NSBonjourServices;
    }
    return modConfig;
  });

module.exports = withDevLocalNetwork;
