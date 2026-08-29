const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

/**
 * Resolves the two Android manifest collisions between
 * `@react-native-firebase/messaging`, `expo-notifications` and
 * `expo-callkit-telecom`.
 *
 * Everything else Firebase needs (AppDelegate init, GoogleService-Info.plist,
 * google-services.json, the google-services Gradle plugin) is handled by the
 * official `@react-native-firebase/app` config plugin.
 */
const withFirebaseNotificationColor = (config) => {
	return withAndroidManifest(config, (modConfig) => {
		const manifest = modConfig.modResults.manifest;
		if (!manifest.$["xmlns:tools"]) {
			manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
		}

		const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);

		// 1. expo-notifications and @react-native-firebase/messaging both declare
		//    `default_notification_color`. Mark ours as the winner with tools:replace.
		const metaData = mainApplication["meta-data"] ?? [];
		const defaultColorMeta = metaData.find(
			(item) => item?.$?.["android:name"] === "com.google.firebase.messaging.default_notification_color",
		);

		if (defaultColorMeta?.$) {
			defaultColorMeta.$["tools:replace"] = "android:resource";
		}

		mainApplication["meta-data"] = metaData;

		// 2. Only one service ever receives com.google.firebase.MESSAGING_EVENT: Firebase
		//    resolves a single one and the rest are dead. Call wakes arrive as data-only
		//    messages that must reach expo-callkit-telecom's service, which is what reports
		//    the call to Telecom before JavaScript is running — the whole reason a locked,
		//    force-quit phone rings.
		//
		//    expo-callkit-telecom's own plugin removes expo-notifications' service (its
		//    service extends it and delegates non-call messages via super), but knows
		//    nothing about @react-native-firebase/messaging, whose service is merged in
		//    *first* and therefore wins. Remove it: nothing on Android uses it — the FCM
		//    token comes from expo-notifications, and RNFirebase messaging is iOS-only here.
		const rnFirebaseService = "io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService";
		mainApplication.service = (mainApplication.service ?? []).filter(
			(service) => service?.$?.["android:name"] !== rnFirebaseService,
		);
		mainApplication.service.push({
			$: { "android:name": rnFirebaseService, "tools:node": "remove" },
		});

		return modConfig;
	});
};

module.exports = withFirebaseNotificationColor;
