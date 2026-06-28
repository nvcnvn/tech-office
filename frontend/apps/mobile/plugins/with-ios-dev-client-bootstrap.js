const fs = require("fs");
const path = require("path");
const { IOSConfig, WarningAggregator, withDangerousMod } = require("expo/config-plugins");

const metroHostBuildPhaseId = "D41D8CD98F00B204E9800998";
const metroHostBuildPhase = [
  `\t\t${metroHostBuildPhaseId} /* Write Metro Host */ = {`,
  "\t\t\tisa = PBXShellScriptBuildPhase;",
  "\t\t\talwaysOutOfDate = 1;",
  "\t\t\tbuildActionMask = 2147483647;",
  "\t\t\tfiles = (",
  "\t\t\t);",
  "\t\t\tinputPaths = (",
  "\t\t\t);",
  "\t\t\tname = \"Write Metro Host\";",
  "\t\t\toutputPaths = (",
  "\t\t\t\t\"${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/ip.txt\",",
  "\t\t\t);",
  "\t\t\trunOnlyForDeploymentPostprocessing = 0;",
  "\t\t\tshellPath = /bin/sh;",
  "\t\t\tshellScript = \"if [ \\\"$CONFIGURATION\\\" = \\\"Debug\\\" ]; then\\n  HOST=\\\"${METRO_HOST:-${REACT_NATIVE_PACKAGER_HOSTNAME:-}}\\\"\\n  if [ -z \\\"$HOST\\\" ]; then\\n    IFACE=$(route get default 2>/dev/null | awk '/interface:/{print $2; exit}')\\n    if [ -n \\\"$IFACE\\\" ]; then\\n      HOST=$(ipconfig getifaddr \\\"$IFACE\\\" 2>/dev/null || true)\\n    fi\\n  fi\\n  if [ -n \\\"$HOST\\\" ]; then\\n    mkdir -p \\\"${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}\\\"\\n    printf '%s' \\\"$HOST\\\" > \\\"${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/ip.txt\\\"\\n  fi\\nfi\\n\";",
  "\t\t\tshowEnvVarsInLog = 0;",
  "\t\t};",
].join("\n");

function patchProjectForMetroHost(contents) {
  if (!contents.includes(`${metroHostBuildPhaseId} /* Write Metro Host */`)) {
    contents = contents.replace(
      "\t\tB70545BD2FDCE1DDA76B61DC /* [Expo] Configure project */,\n",
      `\t\tB70545BD2FDCE1DDA76B61DC /* [Expo] Configure project */,\n\t\t${metroHostBuildPhaseId} /* Write Metro Host */,\n`,
    );

    contents = contents.replace(
      "/* End PBXShellScriptBuildPhase section */",
      `${metroHostBuildPhase}\n/* End PBXShellScriptBuildPhase section */`,
    );
  }

  return contents;
}

function patchAppDelegate(contents) {
  const classMarker = "class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {";
  const iosBlockMatcher = /#if os\(iOS\) \|\| os\(tvOS\)[\s\S]*?#endif\n\n\s*return (?:super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)|true)/m;
  const firebaseMarker = "// @react-native-firebase/app-didFinishLaunchingWithOptions";
  const firebaseInvocation = "FirebaseApp.configure()";
  const bundledMetroHostHelper = `  private func bundledMetroHost() -> String? {\n    guard let path = Bundle.main.path(forResource: "ip", ofType: "txt") else {\n      return nil\n    }\n\n    do {\n      let value = try String(contentsOfFile: path, encoding: .utf8)\n        .trimmingCharacters(in: .whitespacesAndNewlines)\n      return value.isEmpty ? nil : value\n    } catch {\n      return nil\n    }\n  }\n`;
  const firebaseBlock = contents.includes(firebaseMarker) || contents.includes(firebaseInvocation)
    ? `    ${firebaseMarker}\n${firebaseInvocation}\n`
    : "";

  contents = contents.replace(
    iosBlockMatcher,
    `#if os(iOS) || os(tvOS)\n    window = UIWindow(frame: UIScreen.main.bounds)\n${firebaseBlock}    let didFinish = super.application(application, didFinishLaunchingWithOptions: launchOptions)\n    factory.startReactNative(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions)\n    return didFinish\n#endif\n\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`
  );

  if (!contents.includes("override func sourceURL(for bridge: RCTBridge) -> URL?")) {
    contents = contents.replace(
      classMarker,
      `${classMarker}\n  // Extension point for config-plugins\n\n  override func sourceURL(for bridge: RCTBridge) -> URL? {\n    bridge.bundleURL ?? bundleURL()\n  }\n`
    );
  }

  if (!contents.includes("private func bundledMetroHost() -> String?")) {
    contents = contents.replace(
      `${classMarker}\n  // Extension point for config-plugins\n`,
      `${classMarker}\n  // Extension point for config-plugins\n${bundledMetroHostHelper}\n`
    );
  }

  contents = contents.replace(
    /override func sourceURL\(for bridge: RCTBridge\) -> URL\? \{\n\s*bundleURL\(\)\n\s*\}/m,
    `override func sourceURL(for bridge: RCTBridge) -> URL? {\n    bridge.bundleURL ?? bundleURL()\n  }`
  );

  contents = contents.replace(
    /override func bundleURL\(\) -> URL\? \{[\s\S]*?#endif\n  \}/m,
    `override func bundleURL() -> URL? {\n#if DEBUG\n    if let host = bundledMetroHost() {\n      return URL(string: "http://\\(host):18082/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true&hot=false&lazy=true&transform.engine=hermes&unstable_transformProfile=hermes-stable")\n    }\n\n    if let providedURL = RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry") {\n      return providedURL\n    }\n\n    return nil\n#else\n    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")\n#endif\n  }`
  );

  return contents;
}

function patchPodfile(contents) {
  const modularHeadersBlock = "  pod 'FirebaseCoreInternal', :modular_headers => true\n  pod 'GoogleUtilities', :modular_headers => true\n";
  const e2eExcludedModulesBlock = "  e2e_excluded_expo_modules = ENV['EXPO_E2E_STANDALONE'] == '1' ? [\n    'expo-dev-client',\n    'expo-dev-launcher',\n    'expo-dev-menu',\n    'expo-dev-menu-interface'\n  ] : []\n\n";
  const e2eExcludeBlock = "\n  if ENV['EXPO_E2E_STANDALONE'] == '1'\n    config_command += [\n      '--exclude',\n      'expo-dev-client',\n      'expo-dev-launcher',\n      'expo-dev-menu',\n      'expo-dev-menu-interface'\n    ]\n  end\n";

  if (!contents.includes("e2e_excluded_expo_modules")) {
    contents = contents.replace(
      "  use_expo_modules!\n",
      `${e2eExcludedModulesBlock}  use_expo_modules!(exclude: e2e_excluded_expo_modules)\n`
    );
  }

  if (!contents.includes("FirebaseCoreInternal") && !contents.includes("GoogleUtilities")) {
    contents = contents.replace(
      /  use_expo_modules!(?:\(exclude: e2e_excluded_expo_modules\))?\n/,
      (match) => `${match}${modularHeadersBlock}`
    );
  }

  if (!contents.includes("EXPO_E2E_STANDALONE")) {
    contents = contents.replace(
      "\n  config = use_native_modules!(config_command)\n",
      `${e2eExcludeBlock}\n  config = use_native_modules!(config_command)\n`
    );
  }

  return contents;
}

const withIosDevClientBootstrap = (config) => {
  config = withDangerousMod(config, ["ios", async (modConfig) => {
    const fileInfo = IOSConfig.Paths.getAppDelegate(modConfig.modRequest.projectRoot);
    if (fileInfo.language !== "swift") {
      WarningAggregator.addWarningIOS(
        "with-ios-dev-client-bootstrap",
        "Only Swift AppDelegate.swift is supported for dev-client bootstrap patching.",
      );
      return modConfig;
    }

    const newContents = patchAppDelegate(fileInfo.contents);
    await fs.promises.writeFile(fileInfo.path, newContents);
    return modConfig;
  }]);

  config = withDangerousMod(config, ["ios", async (modConfig) => {
    const podfilePath = path.join(modConfig.modRequest.projectRoot, "ios", "Podfile");
    const contents = await fs.promises.readFile(podfilePath, "utf8");
    const newContents = patchPodfile(contents);
    await fs.promises.writeFile(podfilePath, newContents);
    return modConfig;
  }]);

  config = withDangerousMod(config, ["ios", async (modConfig) => {
    const projectPath = path.join(modConfig.modRequest.projectRoot, "ios", "TechOffice.xcodeproj", "project.pbxproj");
    const contents = await fs.promises.readFile(projectPath, "utf8");
    const newContents = patchProjectForMetroHost(contents);
    await fs.promises.writeFile(projectPath, newContents);
    return modConfig;
  }]);

  return config;
};

module.exports = withIosDevClientBootstrap;