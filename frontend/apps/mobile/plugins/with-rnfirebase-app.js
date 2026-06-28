const fs = require("fs");
const path = require("path");
const {
	AndroidConfig,
	IOSConfig,
	WarningAggregator,
	withAndroidManifest,
	withDangerousMod,
	withPlugins,
	withXcodeProject,
} = require("expo/config-plugins");

function insertBeforeFirstMatch(contents, matcher, insertion, tag) {
	if (contents.includes(insertion) || contents.includes(tag)) {
		return contents;
	}

	const match = contents.match(matcher);
	if (!match || match.index == null) {
		return contents;
	}

	const marker = `// ${tag}\n${insertion}\n`;
	return `${contents.slice(0, match.index)}${marker}${contents.slice(match.index)}`;
}

function modifySwiftAppDelegate(contents) {
	const methodInvocationBlock = "FirebaseApp.configure()";
	const methodInvocationLineMatcher =
		/(?:self\.moduleName\s*=\s*"([^"]*)")|(?:factory\.startReactNative\()/;

	if (!contents.includes("import FirebaseCore")) {
		contents = contents.replace(/import Expo/g, "import Expo\nimport FirebaseCore");
	}

	if (contents.includes(methodInvocationBlock)) {
		return contents;
	}

	if (!methodInvocationLineMatcher.test(contents)) {
		WarningAggregator.addWarningIOS(
			"@react-native-firebase/app",
			"Unable to determine correct Firebase insertion point in AppDelegate.swift. Skipping Firebase addition.",
		);
		return contents;
	}

	return insertBeforeFirstMatch(
		contents,
		methodInvocationLineMatcher,
		methodInvocationBlock,
		"@react-native-firebase/app-didFinishLaunchingWithOptions",
	);
}

const withFirebaseAppDelegate = (config) => {
	return withDangerousMod(config, ["ios", async (modConfig) => {
		const fileInfo = IOSConfig.Paths.getAppDelegate(modConfig.modRequest.projectRoot);
		if (fileInfo.language !== "swift") {
			WarningAggregator.addWarningIOS(
				"@react-native-firebase/app",
				"Only Swift AppDelegate.swift is supported by the local Firebase config plugin.",
			);
			return modConfig;
		}

		const newContents = modifySwiftAppDelegate(fileInfo.contents);
		await fs.promises.writeFile(fileInfo.path, newContents);
		return modConfig;
	}]);
};

const withIosGoogleServicesFile = (config) => {
	return withXcodeProject(config, (modConfig) => {
		if (!modConfig.ios?.googleServicesFile) {
			return modConfig;
		}

		const googleServiceFilePath = path.resolve(
			modConfig.modRequest.projectRoot,
			modConfig.ios.googleServicesFile,
		);

		if (!fs.existsSync(googleServiceFilePath)) {
			throw new Error(
				`GoogleService-Info.plist doesn't exist in ${googleServiceFilePath}. Place it there or configure the path in app.json`,
			);
		}

		fs.copyFileSync(
			googleServiceFilePath,
			path.join(IOSConfig.Paths.getSourceRoot(modConfig.modRequest.projectRoot), "GoogleService-Info.plist"),
		);

		const projectName = IOSConfig.XcodeUtils.getProjectName(modConfig.modRequest.projectRoot);
		const plistFilePath = `${projectName}/GoogleService-Info.plist`;
		if (!modConfig.modResults.hasFile(plistFilePath)) {
			modConfig.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
				filepath: plistFilePath,
				groupName: projectName,
				project: modConfig.modResults,
				isBuildFile: true,
			});
		}

		return modConfig;
	});
};

const withAndroidNotificationColorOverride = (config) => {
	return withAndroidManifest(config, (modConfig) => {
		const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
		const metaData = mainApplication["meta-data"] ?? [];
		const defaultColorMeta = metaData.find(
			(item) => item?.$?.["android:name"] === "com.google.firebase.messaging.default_notification_color",
		);

		if (defaultColorMeta?.$) {
			defaultColorMeta.$["tools:replace"] = "android:resource";
		}

		mainApplication["meta-data"] = metaData;
		return modConfig;
	});
};

function withFirebaseAppPlugin(config) {
	return withPlugins(config, [
		withFirebaseAppDelegate,
		withIosGoogleServicesFile,
		withAndroidNotificationColorOverride,
	]);
}

module.exports = withFirebaseAppPlugin;