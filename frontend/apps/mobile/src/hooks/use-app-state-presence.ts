import { useContext, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { updatePresenceStatus } from "apis";
import { AuthContext } from "@/hooks/use-auth";
import { queryClient } from "@/lib/query-client";
import { useNotificationStream } from "@/providers/notification-stream-provider";

export function useAppStatePresence(): void {
  const lastSentRef = useRef<{
    status: "online" | "away";
    channelId: string | null;
    connectionId: string | null;
  } | null>(null);
  const auth = useContext(AuthContext);
  const { connectionId, activeChannelId } = useNotificationStream();

  useEffect(() => {
    if (!auth?.employeeId || !connectionId) {
      return;
    }

    let isCancelled = false;

    const syncPresence = async (target: "online" | "away", force = false) => {
      const normalizedChannelId = target === "away" ? null : activeChannelId;
      const lastPayload = lastSentRef.current;

      if (
        !force &&
        lastPayload?.status === target &&
        lastPayload.channelId === normalizedChannelId &&
        lastPayload.connectionId === connectionId
      ) {
        return;
      }

      try {
        const result = await updatePresenceStatus({
          status: target === "away" ? "idle" : "online",
          activeChannelId: normalizedChannelId,
          lastInteractionAt: new Date(),
          connectionId,
        });

        if (isCancelled) {
          return;
        }

        lastSentRef.current = {
          status: target,
          channelId: normalizedChannelId,
          connectionId,
        };

        queryClient.setQueryData(["presence", auth.employeeId], {
          employeeId: auth.employeeId,
          status: result.status,
          activeChannelId: result.activeChannelId,
          lastInteractionAt: result.updatedAt,
          lastHeartbeat: result.updatedAt,
        });
      } catch {
        // Ignore presence update failures; the next app-state change or stream
        // event will retry naturally.
      }
    };

    void syncPresence(AppState.currentState === "active" ? "online" : "away");

    const sub = AppState.addEventListener("change", (nextState) => {
      const target = nextState === "active" ? "online" : "away";
      void syncPresence(target, true);
    });

    return () => {
      isCancelled = true;
      sub.remove();
    };
  }, [activeChannelId, auth?.employeeId, connectionId]);
}
