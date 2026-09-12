/**
 * React wrapper around the pure SSO availability rule.
 *
 * This file is separate from `sso-availability.ts` only because it imports
 * `react-native`, whose Flow-typed entry point Node cannot parse — keeping the
 * decision table in a module with no runtime React or Expo import is what lets
 * `sso-availability.check.ts` walk it with `node --experimental-strip-types`.
 *
 * Everything asynchronous is here: one `isAvailableAsync()` per mount, and the
 * development-only diagnostic. The diagnostic's wording is written inline
 * inside the `if (__DEV__)` block rather than returned from the pure function,
 * because that is what lets Metro drop it from a release bundle: a sentence
 * built anywhere else would ship in every APK naming the configuration value
 * it was looking for, even though nothing would ever log it (FR-011).
 */

import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";

import {
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  resolveSSOAvailability,
  type SSOAvailability,
} from "./sso-availability";

function googleClientIdForPlatform(): string | undefined {
  if (Platform.OS === "ios") return GOOGLE_IOS_CLIENT_ID;
  if (Platform.OS === "android") return GOOGLE_ANDROID_CLIENT_ID;
  return undefined;
}

export function useSSOAvailability(): SSOAvailability {
  const [appleAvailable, setAppleAvailable] = useState<boolean | null>(
    // Only iOS has an answer to wait for; everywhere else the question is
    // settled the moment the screen mounts.
    Platform.OS === "ios" ? null : false
  );

  useEffect(() => {
    if (Platform.OS !== "ios") return;

    let active = true;
    void AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (active) setAppleAvailable(available);
      })
      .catch(() => {
        // A device that cannot answer is a device that cannot sign in with
        // Apple. Hiding the button is the same outcome as answering false.
        if (active) setAppleAvailable(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const availability = resolveSSOAvailability({
    platform: Platform.OS,
    googleClientId: googleClientIdForPlatform(),
    appleAvailable,
  });

  // Once per mount, not once per render and not once per process: an engineer
  // who navigates away and back should see the line again. A module-level flag
  // would hide it from exactly that person.
  const warned = useRef(false);
  // `gaps` is a fresh array on every render, so the effect keys off its content.
  const gapKey = availability.gaps.join(",");
  useEffect(() => {
    if (__DEV__) {
      if (gapKey === "" || warned.current) return;
      warned.current = true;
      // console.warn, not console.error: a missing client identifier is a
      // configuration gap, not a crash, and should not raise the red box.
      console.warn(
        gapKey
          .split(",")
          .map((gap) => {
            if (gap === "google-android-client-id-missing") {
              return "Google sign-in is hidden on Android because EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID is not set in the app environment.";
            }
            if (gap === "google-ios-client-id-missing") {
              return "Google sign-in is hidden on iOS because GOOGLE_IOS_CLIENT_ID is empty in src/lib/sso-availability.ts.";
            }
            if (gap === "apple-unavailable-on-device") {
              return "Sign in with Apple is unavailable on this device, so the Apple button is hidden. Check that the Sign In with Apple capability is in the entitlements and that the device is signed in to iCloud.";
            }
            // A gap added to SSOGap without a line here; say so rather than
            // mislabel it as one of the above.
            return `A sign-in provider is hidden (${gap}) and nobody wrote a diagnostic for it.`;
          })
          .join(" ")
      );
    }
  }, [gapKey]);

  return availability;
}
