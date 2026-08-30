/**
 * Auth context and provider
 *
 * Manages authentication state, token storage, and org switching.
 * Tokens are stored in expo-secure-store (Keychain/Keystore).
 */

import React, { createContext, useState, useEffect, useCallback } from "react";
import { getSecureItem, setSecureItem, deleteSecureItem } from "@/lib/secure-store";
import { configureRPC } from "apis";
import { configurePlatform } from "apis";
import { onAuthFailure } from "apis";
import { createMobileAdapter } from "@/lib/platform-adapter";
import { API_BASE_URL } from "@/lib/constants";
import { clearPersistedQueryCache, queryClient } from "@/lib/query-client";
import { clearOnboarding } from "@/lib/onboarding-progress";

const TOKEN_KEY = "tech_office_access_token";
const TOKEN_EXPIRES_KEY = "tech_office_token_expires_at";
const ORG_ID_KEY = "tech_office_org_id";
const EMPLOYEE_ID_KEY = "tech_office_employee_id";

export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  token: string | null;
  organizationId: string | null;
  employeeId: string | null;
  authErrorMessage: string | null;
}

export interface AuthContextValue extends AuthState {
  signIn: (params: {
    token: string;
    expiresAt: number;
    organizationId: string;
    employeeId: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  clearAuthError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isLoading: true,
    isAuthenticated: false,
    token: null,
    organizationId: null,
    employeeId: null,
    authErrorMessage: null,
  });

  const clearStoredAuth = useCallback(async () => {
    await deleteSecureItem(TOKEN_KEY);
    await deleteSecureItem(TOKEN_EXPIRES_KEY);
    await deleteSecureItem(ORG_ID_KEY);
    await deleteSecureItem(EMPLOYEE_ID_KEY);
  }, []);

  const resetAuthenticatedAppState = useCallback(() => {
    queryClient.clear();
    clearPersistedQueryCache();
  }, []);

  const clearAuthError = useCallback(() => {
    setState((prev) => {
      if (!prev.authErrorMessage) {
        return prev;
      }

      return { ...prev, authErrorMessage: null };
    });
  }, []);

  // Initialize platform adapter + RPC on mount
  useEffect(() => {
    configurePlatform(createMobileAdapter());
    configureRPC(API_BASE_URL);
    loadStoredAuth();
  }, []);

  useEffect(() => {
    return onAuthFailure(async (event) => {
      await clearStoredAuth();
      resetAuthenticatedAppState();
      setState((prev) => ({
        isLoading: false,
        isAuthenticated: false,
        token: null,
        organizationId: null,
        employeeId: null,
        // Only a session that was actually running can end. Signing out cancels
        // nothing the user cares about, but the queries still in flight when the
        // token disappears come back unauthenticated — reporting those as
        // "Session ended" accuses the app of failing at the moment it obeyed.
        authErrorMessage: prev.isAuthenticated ? event.message : null,
      }));
    });
  }, [clearStoredAuth, resetAuthenticatedAppState]);

  const loadStoredAuth = async () => {
    try {
      const token = await getSecureItem(TOKEN_KEY);
      const expiresAt = await getSecureItem(TOKEN_EXPIRES_KEY);
      const orgId = await getSecureItem(ORG_ID_KEY);
      const employeeId = await getSecureItem(EMPLOYEE_ID_KEY);

      if (token && expiresAt) {
        const now = Math.floor(Date.now() / 1000);
        if (parseInt(expiresAt, 10) > now + 60) {
          // Rewrite what was just read, so a phone signed in before these values were
          // stored at a lock-screen-readable accessibility level moves to one. Keychain
          // will not change that attribute on an update, only on a replace, and this
          // read has already proved the phone is unlocked enough to do it.
          //
          // Awaited, and finished before the app is told it is signed in. Replacing an
          // entry deletes it first, so for as long as this runs the token is not in the
          // Keychain; any request that reads it in that window goes out with no
          // Authorization header, comes back unauthenticated, and ends the session the
          // rewrite was meant to preserve.
          try {
            await Promise.all([
              setSecureItem(TOKEN_KEY, token),
              setSecureItem(TOKEN_EXPIRES_KEY, expiresAt),
              orgId ? setSecureItem(ORG_ID_KEY, orgId) : Promise.resolve(),
              employeeId ? setSecureItem(EMPLOYEE_ID_KEY, employeeId) : Promise.resolve(),
            ]);
          } catch {
            // Nothing to do about it here: the session still works, it just will not
            // survive a locked-screen wake until the next successful launch.
          }

          setState({
            isLoading: false,
            isAuthenticated: true,
            token,
            organizationId: orgId,
            employeeId,
            authErrorMessage: null,
          });
          return;
        }

        await clearStoredAuth();
        resetAuthenticatedAppState();
        setState({
          isLoading: false,
          isAuthenticated: false,
          token: null,
          organizationId: null,
          employeeId: null,
          authErrorMessage: "Your session expired. Please sign in again.",
        });
        return;
      }

      // Token missing or expired
      setState((prev) => ({ ...prev, isLoading: false }));
    } catch {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const signIn = useCallback(
    async (params: {
      token: string;
      expiresAt: number;
      organizationId: string;
      employeeId: string;
    }) => {
      await setSecureItem(TOKEN_KEY, params.token);
      await setSecureItem(
        TOKEN_EXPIRES_KEY,
        String(params.expiresAt)
      );
      await setSecureItem(ORG_ID_KEY, params.organizationId);
      await setSecureItem(EMPLOYEE_ID_KEY, params.employeeId);

      setState({
        isLoading: false,
        isAuthenticated: true,
        token: params.token,
        organizationId: params.organizationId,
        employeeId: params.employeeId,
        authErrorMessage: null,
      });
    },
    []
  );

  const signOut = useCallback(async () => {
    // Signed out is recorded before the token is destroyed, not after. Clearing first
    // leaves a window in which the screens are still mounted and still refetching with
    // no credential, and every one of those failures would read as a session ending.
    setState({
      isLoading: false,
      isAuthenticated: false,
      token: null,
      organizationId: null,
      employeeId: null,
      authErrorMessage: null,
    });

    await clearStoredAuth();
    resetAuthenticatedAppState();
    // Onboarding belongs to the session that started it. Leaving it set would send the
    // next person to sign in on this device into someone else's PIN step.
    clearOnboarding();
  }, [clearStoredAuth, resetAuthenticatedAppState]);

  const switchOrganization = useCallback(
    async (orgId: string) => {
      await setSecureItem(ORG_ID_KEY, orgId);
      setState((prev) => ({ ...prev, organizationId: orgId }));
    },
    []
  );

  return (
    <AuthContext
      value={{ ...state, signIn, signOut, switchOrganization, clearAuthError }}
    >
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
