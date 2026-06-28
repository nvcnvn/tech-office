/**
 * Root Layout
 *
 * Sets up providers (Auth, React Query, SSE stream) and routes to either the
 * auth flow or the authenticated app depending on auth state.
 *
 * T11.4 — App icon badge count synced with unread notification count
 * T11.5 — Splash screen with expo-splash-screen animated transition
 * T11.6 — OTA update check via expo-updates
 */

import React, { useEffect } from "react";
import { Appearance } from "react-native";
import { Stack } from "expo-router/stack";
import { usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { parseCanonicalResourceLink } from "@tech-office/links";
import { queryClient, setupQueryPersistence } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { setPendingPostSignInRedirect } from "@/lib/auth-redirect-handoff";
import { getCanonicalInAppRoute } from "@/lib/canonical-links";
import { buildWebUrl, WEB_BASE_URL, WEB_HOSTNAME } from "@/lib/constants";
import { NotificationStreamProvider } from "@/providers/notification-stream-provider";
import { MMKV } from "react-native-mmkv";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Updates from "expo-updates";
import { getUnreadCount } from "apis";

// Keep the splash screen visible until we explicitly hide it (T11.5)
SplashScreen.preventAutoHideAsync();

// Apply persisted theme preference on startup (T8.5)
const settingsStorage = new MMKV({ id: "app-settings" });
const storedTheme = settingsStorage.getString("color_scheme");
if (storedTheme === "dark" || storedTheme === "light") {
  Appearance.setColorScheme(storedTheme);
}

function QueryPersistenceSetup({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const unsub = setupQueryPersistence();
    return () => unsub();
  }, []);
  return <>{children}</>;
}

/** T11.4 — Sync app icon badge count with server unread count */
function BadgeSync() {
  const { isAuthenticated } = useAuth();
  const { data } = useQuery({
    queryKey: ["unread-count"],
    queryFn: () => getUnreadCount(),
    refetchInterval: 60_000,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    const count = (data as any)?.unreadCount ?? 0;
    Notifications.setBadgeCountAsync(count).catch(() => {
      // Ignore — permission not granted yet or platform unsupported
    });
  }, [data]);

  return null;
}

/** T11.6 — OTA update check on startup */
async function checkForOtaUpdate() {
  try {
    if (!Updates.isEnabled) return;
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // Non-fatal — continue with current bundle
  }
}

function DevRouteLogger() {
  const pathname = usePathname();

  useEffect(() => {
    if (__DEV__) {
      console.log("[route] pathname", pathname);
    }
  }, [pathname]);

  return null;
}

function decodeHexPayload(encoded: string): string | null {
  if (!encoded || encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
    return null;
  }

  let decoded = "";
  for (let index = 0; index < encoded.length; index += 2) {
    decoded += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16));
  }
  return decoded;
}

function normalizeCanonicalOpenUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "techoffice:") {
      return raw;
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (url.hostname === WEB_HOSTNAME && segments[0] === "canonical-link") {
      return decodeHexPayload(segments[1] ?? "");
    }

    if (url.hostname === "canonical-link") {
      return decodeHexPayload(segments[0] ?? "");
    }

    if (url.hostname === WEB_HOSTNAME) {
      return buildWebUrl(`${url.pathname}${url.search}`);
    }

    const path = url.pathname && url.pathname !== "/" ? url.pathname : `/${url.hostname}`;
    return buildWebUrl(`${path}${url.search}`);
  } catch {
    return raw.replace(/^techoffice:\/\//, WEB_BASE_URL);
  }
}

function CanonicalUrlListener() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const normalized = normalizeCanonicalOpenUrl(url);
      const target = normalized ? parseCanonicalResourceLink(normalized) : null;
      if (!normalized || !target) {
        return;
      }

      if (!auth.isAuthenticated) {
        setPendingPostSignInRedirect(normalized, target.tenantKey);
        router.replace("/canonical-signin");
        return;
      }

      void getCanonicalInAppRoute(normalized).then((route) => {
        router.replace(route ?? "/(app)/(chat)");
      });
    });

    return () => subscription.remove();
  }, [auth.isAuthenticated, router]);

  return null;
}

export default function RootLayout() {
  useEffect(() => {
    // T11.6 — Check for OTA update then hide splash
    checkForOtaUpdate().finally(() => {
      // T11.5 — Hide splash after providers are ready
      SplashScreen.hideAsync();
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <QueryPersistenceSetup>
        <AuthProvider>
          <NotificationStreamProvider>
            <BadgeSync />
            <CanonicalUrlListener />
            <DevRouteLogger />
            <StatusBar style="auto" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="canonical-signin" />
              <Stack.Screen name="canonical-link/[encoded]" />
              <Stack.Screen name="link-status" />
              <Stack.Screen name="link-handoff" />
              <Stack.Screen name="o/[tenantKey]/r/[resourceType]/[resourceId]" />
              <Stack.Screen name="[...path]" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
              <Stack.Screen name="(shared)" />
            </Stack>
          </NotificationStreamProvider>
        </AuthProvider>
      </QueryPersistenceSetup>
    </QueryClientProvider>
  );
}

