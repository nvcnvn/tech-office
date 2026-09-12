/**
 * Which single-tap sign-in providers can actually complete a sign-in here.
 *
 * The rule this module owns is the one from spec 058: a provider that cannot
 * work on the running build and device is never offered as a button, so nobody
 * spends a tap discovering it is dead and no alert has to explain the app's
 * build configuration to the person holding the phone.
 *
 * `resolveSSOAvailability` is deliberately pure and free of any React or Expo
 * import — including a runtime `react-native` one, which Node cannot parse —
 * so `sso-availability.check.ts` can walk every row of the decision table
 * without a simulator. The React wrapper lives in `use-sso-availability.ts`.
 *
 * `diagnostic` is returned as data rather than logged from in here: this
 * function decides *what* an engineer needs to be told, the hook decides
 * *whether* to say it (`__DEV__`, once per mount).
 */

/** The iOS client identifier is compiled in, so it can only go missing by edit. */
export const GOOGLE_IOS_CLIENT_ID =
  "751712281610-7o8j91k1b6kqpnp6a6mt1g95sfk6h9fv.apps.googleusercontent.com";

/** The Android one comes from the environment, so it goes missing in practice. */
export const GOOGLE_ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

export interface SSOAvailabilityInput {
  /** `Platform.OS`. */
  platform: string;
  /** The client identifier for this platform, if the build has one. */
  googleClientId: string | undefined;
  /** `null` until `AppleAuthentication.isAvailableAsync()` answers. */
  appleAvailable: boolean | null;
}

export interface SSOAvailability {
  /** Render the Continue with Google button. */
  google: boolean;
  /** Render the Apple button. */
  apple: boolean;
  /** `google || apple` — gates the divider and the whole alternatives card. */
  any: boolean;
  /** Every input is known. False only while the Apple answer is outstanding. */
  resolved: boolean;
  /** Development-only line naming the missing configuration, or `null`. */
  diagnostic: string | null;
}

/**
 * An unset EAS secret can arrive as an empty string rather than as `undefined`,
 * so blank is treated the same as absent.
 */
function isPresent(clientId: string | undefined): boolean {
  return typeof clientId === "string" && clientId.trim() !== "";
}

export function resolveSSOAvailability(input: SSOAvailabilityInput): SSOAvailability {
  const { platform, googleClientId, appleAvailable } = input;
  const googleConfigured = isPresent(googleClientId);
  const notes: string[] = [];

  let google = false;
  let apple = false;
  let resolved = true;

  if (platform === "ios") {
    google = googleConfigured;
    // Not-yet-known renders nothing: an Apple button that appears and is then
    // pulled away is the flash FR-005 forbids.
    apple = appleAvailable === true;
    resolved = appleAvailable !== null;

    if (!googleConfigured) {
      notes.push(
        "Google sign-in is hidden on iOS because GOOGLE_IOS_CLIENT_ID is empty in src/lib/sso-availability.ts."
      );
    }
    if (appleAvailable === false) {
      notes.push(
        "Sign in with Apple is unavailable on this device, so the Apple button is hidden. Check that the Sign In with Apple capability is in the native entitlements and that the device is signed in to iCloud."
      );
    }
  } else if (platform === "android") {
    google = googleConfigured;

    if (!googleConfigured) {
      notes.push(
        "Google sign-in is hidden on Android because EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID is not set in the app environment."
      );
    }
  }
  // Every other platform — web included — is a target for neither provider.
  // Nothing renders, and nothing is missing, so there is nothing to report.

  return {
    google,
    apple,
    any: google || apple,
    resolved,
    diagnostic: notes.length > 0 ? notes.join(" ") : null,
  };
}
