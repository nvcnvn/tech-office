/**
 * useSSE — Server-Sent Events hook for React Native
 *
 * Uses react-native-sse under the hood (via the mobile platform adapter).
 * Reconnects automatically on error with exponential backoff.
 */

import { useEffect, useRef, useCallback, useContext } from "react";
import { AppState } from "react-native";
import { API_BASE_URL } from "@/lib/constants";
import { AuthContext } from "@/hooks/use-auth";

export interface SSEOptions {
  /** Called when a named event is received */
  onEvent: (type: string, data: string) => void;
  /** Called on connection error */
  onError?: (err: Event) => void;
  /** Pause the connection when the app is in the background */
  pauseInBackground?: boolean;
}

export function useSSE({ onEvent, onError, pauseInBackground = true }: SSEOptions) {
  const esRef = useRef<any>(null);
  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const auth = useContext(AuthContext);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const token = auth?.token;
    if (!token) return; // Not authenticated yet

    const url = `${API_BASE_URL}/api/notifications/stream?token=${encodeURIComponent(token)}`;

    const RNEventSource =
      require("react-native-sse").default as typeof import("react-native-sse").default;
    const es = new RNEventSource(url);
    esRef.current = es;

    // Listen for all events — react-native-sse routes named events too
    (es as any).addEventListener("message", (event: any) => {
      backoffRef.current = 1000; // reset on success
      onEventRef.current("message", event.data ?? "");
    });

    // Named events — iterate common ones (notification stream uses typed events)
    const namedEvents = [
      "notification",
      "notification_read",
      "chat_message",
      "chat_reaction",
      "chat_typing",
      "task_update",
      "task_assigned",
      "task_status_changed",
      "presence",
      "ping",
    ];
    for (const eventName of namedEvents) {
      (es as any).addEventListener(eventName, (event: any) => {
        backoffRef.current = 1000;
        onEventRef.current(eventName, event.data ?? "");
      });
    }

    (es as any).addEventListener("error", (event: any) => {
      onErrorRef.current?.(event);
      es.close();
      esRef.current = null;

      // Exponential backoff reconnect
      if (mountedRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, 30000);
          connect();
        }, backoffRef.current);
      }
    });
  }, [auth?.token]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

    if (pauseInBackground) {
      appStateSub = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          if (!esRef.current) {
            connect();
          }
        } else {
          // Background — close to save battery
          if (esRef.current) {
            esRef.current.close();
            esRef.current = null;
          }
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
          }
        }
      });
    }

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      appStateSub?.remove();
    };
  }, [connect, pauseInBackground]);
}
