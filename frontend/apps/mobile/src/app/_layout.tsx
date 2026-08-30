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
import { router, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { parseCanonicalResourceLink } from "@tech-office/links";
import { queryClient, setupQueryPersistence } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { setPendingPostSignInRedirect } from "@/lib/auth-redirect-handoff";
import { getCanonicalInAppRoute } from "@/lib/canonical-links";
import { getTabLabel, getTabRootHref, withNavigationContext } from "@/lib/mobile-navigation";
import { startNativeCallIntegration } from "@/lib/voice/native-call";
import { buildWebUrl, WEB_BASE_URL, WEB_HOSTNAME } from "@/lib/constants";
import { NotificationStreamProvider } from "@/providers/notification-stream-provider";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Updates from "expo-updates";
import { getUnreadCount } from "apis";

// Keep the splash screen visible until we explicitly hide it (T11.5)
SplashScreen.preventAutoHideAsync();

// Every screen is painted from lightPalette, so the app is a light-mode app.
// Pinning the color scheme is what keeps the pieces we do not paint — Switch,
// TextInput carets, the keyboard, native pickers — from turning dark against it
// on a phone whose OS is in dark mode.
Appearance.setColorScheme("light");

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

/**
 * Registers the OS call listeners for the whole app.
 *
 * Mounted at the root rather than inside the authenticated tab layout, and deliberately
 * so. A phone woken by a call push before it can read its own credentials — the window
 * between power-on and the first unlock — still has to answer the operating system. With
 * no listener CallKit waits out its own 30-second answer timeout and the user watches
 * "Connecting…" on a call that was never going to connect; with one, the wake is reported
 * and ended at once, which is what FR-019 asks for. Whether a call can actually be joined
 * is answered by `getSession`, not by whether this component exists.
 */
function NativeCallIntegration() {
  const auth = useAuth();

  // Read through a ref so the integration starts once and is never torn down. Restarting
  // it drops what it knows about the call currently on screen, and a re-render during a
  // ringing call would do exactly that.
  const isAuthenticated = React.useRef(auth.isAuthenticated);
  useEffect(() => {
    isAuthenticated.current = auth.isAuthenticated;
  }, [auth.isAuthenticated]);

  // Started once the stored token has been read, not before. A wake that arrives while
  // auth is still loading would otherwise be told there is no session and end a call the
  // user could have answered. Waiting costs a Keychain read, and the OS buffers the
  // answer event until a listener exists.
  useEffect(() => {
    if (auth.isLoading) return;
    return startNativeCallIntegration({
      getSession: () => ({ isAuthenticated: isAuthenticated.current }),
      // A call answered from the lock screen leaves the app on whatever screen it was
      // last on. Opening the conversation behind the system call UI is what makes the
      // in-app call bar, the participants and the transcript reachable once the user
      // unlocks. The imperative router is used rather than the hook because this runs
      // from a system callback, not from a render.
      onAnswered: (_serverCallId, channelId) => {
        if (!channelId) return;
        router.push(
          withNavigationContext(`/(app)/(chat)/${channelId}`, {
            ownerTab: "chat",
            fallbackHref: getTabRootHref("chat"),
            backLabel: getTabLabel("chat"),
          }) as never,
        );
      },
    });
  }, [auth.isLoading]);

  return null;
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
            <NativeCallIntegration />
            <CanonicalUrlListener />
            <DevRouteLogger />
            {/* Every screen is hardcoded to lightPalette, so "auto" paints white
                status bar icons onto a white header whenever the OS is in dark
                mode — the clock and battery vanish. */}
            <StatusBar style="dark" />
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

