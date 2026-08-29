const { withMainApplication } = require("expo/config-plugins");

/**
 * `@livekit/react-native` requires `LiveKitReactNative.setup()` to run in
 * `Application.onCreate` before React Native initialises: it builds the WebRTC
 * audio device module and the audio-record samples dispatcher that the native
 * module reads later. Without it, answering a call throws
 * `IllegalStateException: audioRecordSamplesDispatcher is not initialized!`.
 *
 * The upstream `@livekit/react-native-expo-plugin` only writes manifest
 * meta-data and expects the SDK to self-initialise, which 2.10.2 does not do,
 * so we patch MainApplication.kt ourselves.
 */
const IMPORTS = [
	"import com.livekit.reactnative.LiveKitReactNative",
	"import com.livekit.reactnative.audio.AudioType",
];
const SETUP_CALL = "    LiveKitReactNative.setup(this, AudioType.CommunicationAudioType())";

const withLiveKitAndroidSetup = (config) => {
	return withMainApplication(config, (modConfig) => {
		if (modConfig.modResults.language !== "kt") {
			throw new Error("with-livekit-android-setup expects a Kotlin MainApplication");
		}

		let contents = modConfig.modResults.contents;

		for (const line of IMPORTS) {
			if (!contents.includes(line)) {
				contents = contents.replace("import android.app.Application", `import android.app.Application\n${line}`);
			}
		}

		// Must precede loadReactNative: WebRTCModuleOptions is read when the
		// WebRTC native module is constructed during RN startup.
		if (!contents.includes("LiveKitReactNative.setup")) {
			contents = contents.replace("    loadReactNative(this)", `${SETUP_CALL}\n    loadReactNative(this)`);
		}

		if (!contents.includes("LiveKitReactNative.setup")) {
			throw new Error("with-livekit-android-setup could not find loadReactNative(this) in MainApplication.kt");
		}

		modConfig.modResults.contents = contents;
		return modConfig;
	});
};

module.exports = withLiveKitAndroidSetup;
