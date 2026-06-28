/**
 * Auth context and provider
 *
 * Manages authentication state, token storage, and org switching.
 * Tokens are stored in expo-secure-store (Keychain/Keystore).
 */

import React, { createContext, useState, useEffect, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import { configureRPC } from "apis";
import { configurePlatform } from "apis";
import { onAuthFailure } from "apis";
import { createMobileAdapter } from "@/lib/platform-adapter";
import { API_BASE_URL } from "@/lib/constants";
import { clearPersistedQueryCache, queryClient } from "@/lib/query-client";

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
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(TOKEN_EXPIRES_KEY);
    await SecureStore.deleteItemAsync(ORG_ID_KEY);
    await SecureStore.deleteItemAsync(EMPLOYEE_ID_KEY);
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
      setState({
        isLoading: false,
        isAuthenticated: false,
        token: null,
        organizationId: null,
        employeeId: null,
        authErrorMessage: event.message,
      });
    });
  }, [clearStoredAuth, resetAuthenticatedAppState]);

  const loadStoredAuth = async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      const expiresAt = await SecureStore.getItemAsync(TOKEN_EXPIRES_KEY);
      const orgId = await SecureStore.getItemAsync(ORG_ID_KEY);
      const employeeId = await SecureStore.getItemAsync(EMPLOYEE_ID_KEY);

      if (token && expiresAt) {
        const now = Math.floor(Date.now() / 1000);
        if (parseInt(expiresAt, 10) > now + 60) {
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
      await SecureStore.setItemAsync(TOKEN_KEY, params.token);
      await SecureStore.setItemAsync(
        TOKEN_EXPIRES_KEY,
        String(params.expiresAt)
      );
      await SecureStore.setItemAsync(ORG_ID_KEY, params.organizationId);
      await SecureStore.setItemAsync(EMPLOYEE_ID_KEY, params.employeeId);

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
    await clearStoredAuth();
    resetAuthenticatedAppState();

    setState({
      isLoading: false,
      isAuthenticated: false,
      token: null,
      organizationId: null,
      employeeId: null,
      authErrorMessage: null,
    });
  }, [clearStoredAuth, resetAuthenticatedAppState]);

  const switchOrganization = useCallback(
    async (orgId: string) => {
      await SecureStore.setItemAsync(ORG_ID_KEY, orgId);
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
