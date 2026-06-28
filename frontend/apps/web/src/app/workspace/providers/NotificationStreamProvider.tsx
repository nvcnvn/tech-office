/**
 * NotificationStreamProvider
 * Centralized SSE connection provider for workspace features
 */

"use client";

import type { PropsWithChildren } from "react";
import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSSEConnection,
  type Notification,
  type ConnectionStatus,
} from "@tech-office/notifications";
import type { NotificationPopup } from "@/hooks/useNotificationPopup";

import { ContextRailProvider } from "./ContextRailProvider";
import {
  dispatchVoiceCallStreamEvent,
  voiceCallEventFromNotification,
  voiceCallEventKey,
} from "../voice/voiceCallEvents";

interface NotificationStreamProviderProps {
  organizationId: string;
  enabled?: boolean;
}

interface NotificationStreamContextValue {
  status: ConnectionStatus;
  error: Error | null;
  reconnect: () => void;
  subscribe: (handler: (notification: Notification) => void) => () => void;
}

const NotificationStreamContext = createContext<
  NotificationStreamContextValue | undefined
>(undefined);

let providerInstanceCounter = 0;

const getNextProviderInstanceId = () => {
  providerInstanceCounter += 1;
  return providerInstanceCounter;
};

/**
 * Provider component that maintains a single SSE connection and fan-outs events
 */
export function NotificationStreamProvider({
  organizationId,
  enabled = true,
  children,
}: PropsWithChildren<NotificationStreamProviderProps>) {
  const instanceIdRef = useRef<number>(getNextProviderInstanceId());
  const queryClient = useQueryClient();

  const instanceId = instanceIdRef.current;
  const listenersRef = useRef(new Set<(notification: Notification) => void>());
  const recentVoiceEventsRef = useRef(new Map<string, number>());
  const initialOrgIdRef = useRef(organizationId);
  const initialEnabledRef = useRef(enabled);

  const subscribe = useCallback(
    (handler: (notification: Notification) => void) => {
      console.log("[NotificationStream] listener subscribed", {
        instanceId,
        beforeCount: listenersRef.current.size,
      });
      listenersRef.current.add(handler);
      console.log("[NotificationStream] listener count changed", {
        instanceId,
        action: "add",
        count: listenersRef.current.size,
      });
      return () => {
        const removed = listenersRef.current.delete(handler);
        if (removed) {
          console.log("[NotificationStream] listener count changed", {
            instanceId,
            action: "remove",
            count: listenersRef.current.size,
          });
        }
      };
    },
    [instanceId],
  );

  const dispatchToPopup = useCallback((notification: Notification) => {
    const popupData = mapNotificationToPopup(notification);
    if (!popupData) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent<NotificationPopup>("notification-received", {
        detail: popupData,
      }),
    );
  }, []);

  const dispatchVoiceNotification = useCallback(
    (notification: Notification) => {
      const voiceEvent = voiceCallEventFromNotification(notification);
      if (!voiceEvent) {
        return;
      }

      const now = Date.now();
      const eventKey = voiceCallEventKey(voiceEvent);
      const lastSeenAt = recentVoiceEventsRef.current.get(eventKey) ?? 0;
      if (now - lastSeenAt < 750) {
        return;
      }
      recentVoiceEventsRef.current.set(eventKey, now);
      for (const [key, seenAt] of recentVoiceEventsRef.current.entries()) {
        if (now - seenAt > 30_000) {
          recentVoiceEventsRef.current.delete(key);
        }
      }

      dispatchVoiceCallStreamEvent(voiceEvent);
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
      if (voiceEvent.notificationType === "voice_call_ended") {
        queryClient.invalidateQueries({
          queryKey: ["messages", voiceEvent.channelId],
        });
      }
    },
    [queryClient],
  );

  const handleNotification = useCallback(
    (notification: Notification) => {
      dispatchVoiceNotification(notification);

      listenersRef.current.forEach((listener) => {
        try {
          listener(notification);
        } catch (err) {
          console.error("[NotificationStream] listener error", {
            instanceId,
            error: err,
          });
        }
      });

      dispatchToPopup(notification);
    },
    [dispatchToPopup, dispatchVoiceNotification, instanceId],
  );

  const { status, error, reconnect } = useSSEConnection({
    organizationId,
    enabled: enabled && Boolean(organizationId),
    onNotification: handleNotification,
    onError: (err) => {
      const errLike = err as Error & { code?: unknown; rawMessage?: unknown };
      console.error("[NotificationStream] SSE connection error", {
        instanceId,
        name: errLike?.name,
        message: errLike?.message,
        code: errLike?.code,
        rawMessage: errLike?.rawMessage,
        error: errLike,
      });
    },
  });

  useEffect(() => {
    const listenersSnapshot = listenersRef.current;
    console.log("[NotificationStream] provider mounted", {
      instanceId,
      organizationId: initialOrgIdRef.current,
      enabled: initialEnabledRef.current,
    });
    return () => {
      console.log("[NotificationStream] provider unmounted", {
        instanceId,
        listenerCount: listenersSnapshot.size,
      });
    };
  }, [instanceId]);

  useEffect(() => {
    console.log("[NotificationStream] provider props updated", {
      instanceId,
      organizationId,
      enabled,
      listenerCount: listenersRef.current.size,
    });
  }, [instanceId, organizationId, enabled]);

  useEffect(() => {
    console.log("[NotificationStream] connection status changed", {
      instanceId,
      status,
      listenerCount: listenersRef.current.size,
    });
  }, [instanceId, status]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const errLike = error as Error & { code?: unknown; rawMessage?: unknown };
    console.error("[NotificationStream] connection error observed", {
      instanceId,
      name: errLike?.name,
      message: errLike?.message,
      code: errLike?.code,
      rawMessage: errLike?.rawMessage,
      error: errLike,
    });
  }, [instanceId, error]);

  const contextValue = useMemo(
    () => ({
      status,
      error,
      reconnect,
      subscribe,
    }),
    [status, error, reconnect, subscribe],
  );

  return (
    <NotificationStreamContext.Provider value={contextValue}>
      <ContextRailProvider>{children}</ContextRailProvider>
    </NotificationStreamContext.Provider>
  );
}

/**
 * Hook to access notification stream context
 */
export function useNotificationStream(): NotificationStreamContextValue {
  const context = useContext(NotificationStreamContext);
  if (!context) {
    throw new Error(
      "useNotificationStream must be used within a NotificationStreamProvider",
    );
  }
  return context;
}

function mapNotificationToPopup(
  notification: Notification,
): NotificationPopup | null {
  // voice_call_incoming is handled by the workspace-level incoming call dialog.
  // Do not also show it as a generic notification toast.
  if (notification.notificationType === "voice_call_incoming") {
    return null;
  }

  const actionData =
    notification.actionData && typeof notification.actionData === "object"
      ? (notification.actionData as Record<string, unknown>)
      : null;

  return {
    notificationId: notification.notificationId,
    notificationRecipientId: notification.notificationRecipientId,
    title: notification.title,
    message: notification.message,
    type: notification.notificationType,
    channelId:
      typeof actionData?.channelId === "string"
        ? actionData.channelId
        : undefined,
    messageId:
      typeof actionData?.messageId === "string"
        ? actionData.messageId
        : undefined,
    employeeId:
      typeof actionData?.employeeId === "string"
        ? actionData.employeeId
        : undefined,
    timestamp: notification.createdAt,
  };
}
