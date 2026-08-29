const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

/**
 * expo-notifications and @react-native-firebase/messaging both declare the
 * `default_notification_color` meta-data, which collides at manifest merge time.
 * Mark ours as the winner with tools:replace.
 *
 * Everything else Firebase needs (AppDelegate init, GoogleService-Info.plist,
 * google-services.json, the google-services Gradle plugin) is handled by the
 * official `@react-native-firebase/app` config plugin.
 */
const withFirebaseNotificationColor = (config) => {
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

module.exports = withFirebaseNotificationColor;
