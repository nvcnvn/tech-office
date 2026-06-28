/**
 * OfflineBanner — T2.7
 *
 * Displays a persistent banner when the app cannot reach the API backend.
 * Uses periodic fetch pings against the API health endpoint to detect backend
 * reachability (avoids adding @react-native-community/netinfo dependency).
 *
 * Usage: Render inside the authenticated app shell so it can overlay screens.
 */

import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, AppState } from "react-native";
import { API_BASE_URL } from "@/lib/constants";

const PING_INTERVAL_MS = 10_000; // 10 seconds
const PING_TIMEOUT_MS = 5_000;
const shouldDebugConnectivity =
  __DEV__ || process.env.EXPO_PUBLIC_DEBUG_CONNECTIVITY === "true";

type ConnectivityCheckResult = {
  ok: boolean;
  url: string;
  method: "GET";
  durationMs: number;
  appState: string;
  status?: number;
  statusText?: string;
  healthStatus?: string;
  consumerStatus?: string;
  activeConnections?: number;
  reconnectCount?: number;
  lastError?: string;
  responsePreview?: string;
  timedOut?: boolean;
  errorName?: string;
  errorMessage?: string;
};

function previewText(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function parseHealthBody(body: string): Partial<ConnectivityCheckResult> {
  if (!body) {
    return {};
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      healthStatus: typeof parsed.status === "string" ? parsed.status : undefined,
      consumerStatus:
        typeof parsed.consumer_status === "string"
          ? parsed.consumer_status
          : undefined,
      activeConnections:
        typeof parsed.active_connections === "number"
          ? parsed.active_connections
          : undefined,
      reconnectCount:
        typeof parsed.reconnect_count === "number"
          ? parsed.reconnect_count
          : undefined,
      lastError: typeof parsed.last_error === "string" ? parsed.last_error : undefined,
    };
  } catch {
    return {};
  }
}

function logConnectivityCheck(
  message: string,
  result: ConnectivityCheckResult,
) {
  if (!shouldDebugConnectivity) {
    return;
  }

  console.warn(`[offline-banner] ${message} ${JSON.stringify(result)}`);
}

async function checkConnectivity(): Promise<ConnectivityCheckResult> {
  const url = `${API_BASE_URL}/healthz`;
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PING_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const responseBody = await response.text().catch(() => "");

    return {
      ok: response.ok,
      url,
      method: "GET",
      durationMs: Date.now() - startedAt,
      appState: AppState.currentState,
      status: response.status,
      statusText: response.statusText,
      responsePreview: previewText(responseBody),
      ...parseHealthBody(responseBody),
    };
  } catch (error) {
    return {
      ok: false,
      url,
      method: "GET",
      durationMs: Date.now() - startedAt,
      appState: AppState.currentState,
      timedOut,
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getBannerText(lastCheck: ConnectivityCheckResult | null): string {
  if (lastCheck?.timedOut) {
    return "Backend is not responding";
  }

  if (lastCheck?.status === 503 || lastCheck?.healthStatus === "degraded") {
    return "Backend service degraded";
  }

  return "Cannot reach backend";
}

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [lastCheck, setLastCheck] = useState<ConnectivityCheckResult | null>(null);
  const slideAnim = useRef(new Animated.Value(-48)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const checkSequenceRef = useRef(0);
  const lastOfflineRef = useRef(false);

  const runCheck = async () => {
    const checkSequence = checkSequenceRef.current + 1;
    checkSequenceRef.current = checkSequence;
    const result = await checkConnectivity();

    if (!mountedRef.current || checkSequence !== checkSequenceRef.current) {
      logConnectivityCheck("ignored stale connectivity result", result);
      return;
    }

    const nextOffline = !result.ok;
    setLastCheck(result);
    setIsOffline(nextOffline);

    if (nextOffline) {
      logConnectivityCheck("connectivity check failed", result);
    } else if (lastOfflineRef.current) {
      logConnectivityCheck("connectivity restored", result);
    }

    lastOfflineRef.current = nextOffline;
  };

  useEffect(() => {
    mountedRef.current = true;

    // Initial check
    runCheck();

    // Periodic checks
    intervalRef.current = setInterval(runCheck, PING_INTERVAL_MS);

    // Pause checks in background
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        runCheck();
        if (!intervalRef.current) {
          intervalRef.current = setInterval(runCheck, PING_INTERVAL_MS);
        }
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    });

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
      appStateSub.remove();
    };
  }, []);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: isOffline ? 0 : -48,
      useNativeDriver: true,
      tension: 80,
      friction: 10,
    }).start();
  }, [isOffline, slideAnim]);

  return (
    <Animated.View
      style={[
        styles.banner,
        { transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.text}>{getBannerText(lastCheck)}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 44,
    backgroundColor: "#991b1b",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
