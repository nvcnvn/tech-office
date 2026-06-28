/**
 * Platform Adapter Interface
 *
 * Abstracts platform-specific APIs (localStorage, EventSource, visibility, etc.)
 * so that `packages/apis` can be used from both web and React Native.
 *
 * Usage:
 *   import { configurePlatform, getPlatform } from './platform';
 *   configurePlatform(webAdapter);   // called once at app startup
 *   const adapter = getPlatform();
 */

// ── Storage (synchronous key-value, e.g. localStorage / mmkv) ──

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ── Secure Storage (for tokens — Keychain / Keystore / localStorage fallback) ──

export interface SecureStorageAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

// ── Visibility (tab focus / app foreground) ──

export interface VisibilityAdapter {
  /** Returns true when the app/tab is in the foreground */
  isVisible(): boolean;
  /** Subscribe to visibility changes. Returns an unsubscribe fn. */
  onVisibilityChange(callback: (visible: boolean) => void): () => void;
}

// ── Theme ──

export interface ThemeAdapter {
  getColorScheme(): "light" | "dark";
  onColorSchemeChange?(
    callback: (scheme: "light" | "dark") => void
  ): () => void;
}

// ── EventSource (SSE) ──

/** Minimal event shape used by the SSE stream consumer. */
export interface SSEEvent {
  data: string;
}

/** Browser-like EventSource interface, just the subset we use. */
export interface EventSourceLike {
  onmessage: ((event: SSEEvent) => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, listener: (event: SSEEvent) => void): void;
  close(): void;
}

export interface EventSourceFactory {
  create(url: string): EventSourceLike;
}

// ── Transport factory for ConnectRPC ──

import type { Transport } from "@connectrpc/connect";

export interface TransportFactory {
  createTransport(baseUrl: string, getToken: () => Promise<string | null>): Transport;
}

// ── Aggregate adapter ──

export interface PlatformAdapter {
  storage: StorageAdapter;
  secureStorage: SecureStorageAdapter;
  visibility: VisibilityAdapter;
  theme: ThemeAdapter;
  transport: TransportFactory;
  eventSource: EventSourceFactory;
}

// ── Singleton ──

let _platform: PlatformAdapter | null = null;

export function configurePlatform(adapter: PlatformAdapter): void {
  _platform = adapter;
}

export function getPlatform(): PlatformAdapter {
  if (!_platform) {
    throw new Error(
      "[platform] No platform adapter configured. Call configurePlatform() at app startup."
    );
  }
  return _platform;
}

export function hasPlatform(): boolean {
  return _platform !== null;
}
