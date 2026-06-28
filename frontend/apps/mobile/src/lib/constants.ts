/**
 * API configuration constants.
 *
 * Real devices cannot reach a backend running on their own localhost, so in
 * development we infer the Mac host from the active Metro/dev-server URL.
 */

import { NativeModules, Platform } from "react-native";
import * as Constants from "expo-constants";

const DEFAULT_API_PORT = "18080";
const LOOPBACK_IOS = "http://localhost:18080";
const LOOPBACK_ANDROID_EMULATOR = "http://10.0.2.2:18080";
const DEFAULT_WEB_URL = "https://transformar.work";

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function getNestedString(
  value: unknown,
  path: readonly string[]
): string | null {
  let current: unknown = value;

  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "string" && current.trim().length > 0
    ? current.trim()
    : null;
}

function parseHostCandidate(rawValue: string | null): URL | null {
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.includes("://") ? rawValue : `http://${rawValue}`;

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function getMetroHostUrl(): URL | null {
  const scriptUrl =
    typeof NativeModules?.SourceCode?.scriptURL === "string"
      ? NativeModules.SourceCode.scriptURL
      : null;

  const constantsCandidates = [
    getNestedString(Constants, ["expoConfig", "hostUri"]),
    getNestedString(Constants, ["manifest2", "extra", "expoClient", "hostUri"]),
    getNestedString(Constants, ["manifest2", "extra", "expoGo", "debuggerHost"]),
    getNestedString(Constants, ["manifest", "debuggerHost"]),
    getNestedString(Constants, ["manifest", "hostUri"]),
    getNestedString(Constants, ["experienceUrl"]),
  ];

  for (const candidate of [scriptUrl, ...constantsCandidates]) {
    const parsed = parseHostCandidate(candidate);
    if (parsed?.hostname) {
      return parsed;
    }
  }

  return null;
}

function getLocalDevFallback(): string {
  return Platform.OS === "android" ? LOOPBACK_ANDROID_EMULATOR : LOOPBACK_IOS;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function resolveApiBaseUrl(): string {
  const explicitApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicitApiUrl) {
    return normalizeBaseUrl(explicitApiUrl);
  }

  const metroHostUrl = getMetroHostUrl();
  if (metroHostUrl && !isLoopbackHost(metroHostUrl.hostname)) {
    return `${metroHostUrl.protocol}//${metroHostUrl.hostname}:${DEFAULT_API_PORT}`;
  }

  return getLocalDevFallback();
}

export const API_BASE_URL = resolveApiBaseUrl();

function resolveWebBaseUrl(): string {
  const explicitWebUrl = process.env.EXPO_PUBLIC_WEB_URL?.trim();
  return normalizeBaseUrl(explicitWebUrl || DEFAULT_WEB_URL);
}

function resolveWebHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return new URL(DEFAULT_WEB_URL).hostname;
  }
}

export const WEB_BASE_URL = resolveWebBaseUrl();
export const WEB_HOSTNAME = resolveWebHostname(WEB_BASE_URL);

export function buildWebUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }

  return `${WEB_BASE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
