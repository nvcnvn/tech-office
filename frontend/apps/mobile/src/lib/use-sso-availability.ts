/**
 * React wrapper around the pure SSO availability rule.
 *
 * This file is separate from `sso-availability.ts` only because it imports
 * `react-native`, whose Flow-typed entry point Node cannot parse — keeping the
 * decision table in a module with no runtime React or Expo import is what lets
 * `sso-availability.check.ts` walk it with `node --experimental-strip-types`.
 *
 * Everything asynchronous is here: one `isAvailableAsync()` per mount, and the
 * development-only diagnostic the pure function produced as data.
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
  // who navigates away and back should see the line again.
  const warned = useRef(false);
  const { diagnostic } = availability;
  useEffect(() => {
    if (!__DEV__ || diagnostic === null || warned.current) return;
    warned.current = true;
    // console.warn, not console.error: a missing client identifier is a
    // configuration gap, not a crash, and should not raise the red box.
    console.warn(diagnostic);
  }, [diagnostic]);

  return availability;
}
