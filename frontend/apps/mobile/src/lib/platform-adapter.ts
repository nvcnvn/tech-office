/**
 * Mobile Platform Adapter
 *
 * Implements PlatformAdapter for React Native using:
 * - react-native-mmkv for fast synchronous storage
 * - expo-secure-store for token storage (Keychain/Keystore)
 * - AppState for visibility tracking
 * - Custom fetch-based SSE for streaming
 * - ConnectRPC transport via connect-web (JSON mode works in RN)
 */

import { AppState, type AppStateStatus, Appearance } from "react-native";
import { MMKV } from "react-native-mmkv";
import { getSecureItem, setSecureItem, deleteSecureItem } from "@/lib/secure-store";
import { createConnectTransport } from "@connectrpc/connect-web";
import type {
  PlatformAdapter,
  StorageAdapter,
  SecureStorageAdapter,
  VisibilityAdapter,
  ThemeAdapter,
  TransportFactory,
  EventSourceFactory,
  EventSourceLike,
} from "apis";

// ── MMKV Instance ──
const mmkv = new MMKV({ id: "tech-office" });

const storage: StorageAdapter = {
  getItem: (key) => mmkv.getString(key) ?? null,
  setItem: (key, value) => mmkv.set(key, value),
  removeItem: (key) => mmkv.delete(key),
};

// ── Secure Storage (Keychain / Keystore) ──
const secureStorage: SecureStorageAdapter = {
  getItemAsync: (key) => getSecureItem(key),
  setItemAsync: (key, value) => setSecureItem(key, value),
  deleteItemAsync: (key) => deleteSecureItem(key),
};

// ── Visibility via AppState ──
const visibility: VisibilityAdapter = {
  isVisible: () => AppState.currentState === "active",
  onVisibilityChange: (cb) => {
    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        cb(state === "active");
      }
    );
    return () => subscription.remove();
  },
};

// ── Theme via Appearance ──
const theme: ThemeAdapter = {
  getColorScheme: () =>
    Appearance.getColorScheme() === "dark" ? "dark" : "light",
  onColorSchemeChange: (cb) => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      cb(colorScheme === "dark" ? "dark" : "light");
    });
    return () => subscription.remove();
  },
};

// ── ConnectRPC Transport (JSON mode works in React Native) ──
const transport: TransportFactory = {
  createTransport: (baseUrl, getToken) =>
    createConnectTransport({
      baseUrl,
      interceptors: [
        (next) => async (req) => {
          const token = await getToken();
          if (token) {
            req.header.set("Authorization", `Bearer ${token}`);
          }
          return next(req);
        },
      ],
      useBinaryFormat: false,
      jsonOptions: { ignoreUnknownFields: true },
    }),
};

// ── SSE via react-native-sse ──
const eventSource: EventSourceFactory = {
  create(url: string): EventSourceLike {
    // Use react-native-sse for SSE support on React Native
    const RNEventSource =
      require("react-native-sse").default as typeof import("react-native-sse").default;
    const es = new RNEventSource(url);

    const wrapper: EventSourceLike = {
      onmessage: null,
      onerror: null,
      addEventListener(type: string, listener: (event: { data: string }) => void) {
        es.addEventListener(type as any, (event: any) => {
          listener({ data: event.data ?? "" });
        });
      },
      close() {
        es.close();
      },
    };

    // Forward es events to wrapper callbacks
    es.addEventListener("message", (event: any) => {
      wrapper.onmessage?.({ data: event.data ?? "" });
    });
    es.addEventListener("error", () => {
      wrapper.onerror?.();
    });

    return wrapper;
  },
};

// ── Aggregate ──
export function createMobileAdapter(): PlatformAdapter {
  return { storage, secureStorage, visibility, theme, transport, eventSource };
}
