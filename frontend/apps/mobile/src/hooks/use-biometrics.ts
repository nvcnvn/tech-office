/**
 * useBiometrics — biometric authentication hook
 *
 * Wraps expo-local-authentication to check availability and
 * prompt biometric authentication (Face ID / fingerprint).
 */

import { useState, useEffect, useCallback } from "react";
import * as LocalAuthentication from "expo-local-authentication";

export interface BiometricsState {
  isAvailable: boolean;
  biometricType: "face" | "fingerprint" | "none";
  isAuthenticating: boolean;
}

export function useBiometrics() {
  const [state, setState] = useState<BiometricsState>({
    isAvailable: false,
    biometricType: "none",
    isAuthenticating: false,
  });

  useEffect(() => {
    (async () => {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!compatible || !enrolled) {
        return;
      }
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const biometricType = types.includes(
        LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
      )
        ? "face"
        : "fingerprint";
      setState((prev) => ({ ...prev, isAvailable: true, biometricType }));
    })();
  }, []);

  const authenticate = useCallback(
    async (promptMessage = "Authenticate to continue"): Promise<boolean> => {
      if (!state.isAvailable) return false;
      setState((prev) => ({ ...prev, isAuthenticating: true }));
      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage,
          cancelLabel: "Cancel",
          disableDeviceFallback: false,
        });
        return result.success;
      } finally {
        setState((prev) => ({ ...prev, isAuthenticating: false }));
      }
    },
    [state.isAvailable]
  );

  return { ...state, authenticate };
}
