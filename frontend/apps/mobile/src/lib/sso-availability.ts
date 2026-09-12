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
 * What an engineer needs to be told is returned as `gaps` — machine-readable
 * tokens, not prose. The wording lives inside the hook's `if (__DEV__)` block
 * so that Metro strips it from a release bundle entirely (FR-011): a sentence
 * built out here would sit in every shipped APK naming the configuration it
 * was looking for, whether or not anything ever logged it.
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

/** A reason a provider is not being offered, for the development console. */
export type SSOGap =
  | "google-ios-client-id-missing"
  | "google-android-client-id-missing"
  | "apple-unavailable-on-device";

export interface SSOAvailability {
  /** Render the Continue with Google button. */
  google: boolean;
  /** Render the Apple button. */
  apple: boolean;
  /** `google || apple` — gates the divider and the whole alternatives card. */
  any: boolean;
  /** Every input is known. False only while the Apple answer is outstanding. */
  resolved: boolean;
  /** Why anything is missing, in the order it should be reported. Empty when
   *  nothing is. The hook turns these into a development-only console line. */
  gaps: readonly SSOGap[];
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
  const gaps: SSOGap[] = [];

  let google = false;
  let apple = false;
  let resolved = true;

  if (platform === "ios") {
    google = googleConfigured;
    // Not-yet-known renders nothing: an Apple button that appears and is then
    // pulled away is the flash FR-005 forbids.
    apple = appleAvailable === true;
    resolved = appleAvailable !== null;

    if (!googleConfigured) gaps.push("google-ios-client-id-missing");
    if (appleAvailable === false) gaps.push("apple-unavailable-on-device");
  } else if (platform === "android") {
    google = googleConfigured;

    if (!googleConfigured) gaps.push("google-android-client-id-missing");
  }
  // Every other platform — web included — is a target for neither provider.
  // Nothing renders, and nothing is missing, so there is nothing to report.

  return {
    google,
    apple,
    any: google || apple,
    resolved,
    gaps,
  };
}
