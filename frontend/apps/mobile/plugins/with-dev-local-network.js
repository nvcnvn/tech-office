const { withInfoPlist } = require("expo/config-plugins");

/**
 * Adds the iOS local-network keys ONLY when EXPO_LOCAL_DEV_NETWORK=1.
 *
 * NSLocalNetworkUsageDescription and NSBonjourServices exist solely so a debug
 * build can reach a Metro server on the LAN. Shipping them means the App Store
 * listing declares local-network access the released app never uses, and the
 * string a reviewer sees says "local development server while debugging" — a
 * finding on both counts (FR-029).
 *
 * Developers running a dev client on a physical device over the LAN export
 * EXPO_LOCAL_DEV_NETWORK=1 before `expo prebuild`. Production builds set nothing,
 * so the keys are absent and scripts/check-store-manifest.js stays green.
 */
const withDevLocalNetwork = (config) => {
  if (process.env.EXPO_LOCAL_DEV_NETWORK !== "1") {
    return config;
  }

  return withInfoPlist(config, (modConfig) => {
    modConfig.modResults.NSLocalNetworkUsageDescription =
      "Tech Office connects to a local development server while debugging.";
    modConfig.modResults.NSBonjourServices = ["_http._tcp"];
    return modConfig;
  });
};

module.exports = withDevLocalNetwork;
