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
} from "./platform";

const storage: StorageAdapter = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};

// Web uses localStorage as a fallback for secure storage
const secureStorage: SecureStorageAdapter = {
  getItemAsync: async (key) => localStorage.getItem(key),
  setItemAsync: async (key, value) => localStorage.setItem(key, value),
  deleteItemAsync: async (key) => localStorage.removeItem(key),
};

const visibility: VisibilityAdapter = {
  isVisible: () => document.visibilityState === "visible",
  onVisibilityChange: (cb) => {
    const handler = () => cb(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
};

const theme: ThemeAdapter = {
  getColorScheme: () => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  },
  onColorSchemeChange: (cb) => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => cb(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  },
};

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
    }),
};

const eventSource: EventSourceFactory = {
  create(url: string): EventSourceLike {
    return new EventSource(url) as unknown as EventSourceLike;
  },
};

export function createWebAdapter(): PlatformAdapter {
  return { storage, secureStorage, visibility, theme, transport, eventSource };
}
