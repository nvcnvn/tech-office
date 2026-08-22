/**
 * App-state presence
 *
 * The notification stream provider owns presence now: it answers the server's pings and
 * reports foreground/background transitions through an unsolicited pong, using the
 * connection id it already holds.
 *
 * This hook is what remains — keeping the local presence cache in step with the app
 * state so the user's own indicator updates immediately, without a round trip. It no
 * longer calls a presence endpoint of its own, and no longer needs the lastSentRef
 * dedup that a separate write path required.
 */

import { useContext, useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { AuthContext } from "@/hooks/use-auth";
import { queryClient } from "@/lib/query-client";
import { useNotificationStream } from "@/providers/notification-stream-provider";

export function useAppStatePresence(): void {
  const auth = useContext(AuthContext);
  const { connectionId, activeChannelId } = useNotificationStream();

  useEffect(() => {
    const employeeId = auth?.employeeId;
    if (!employeeId || !connectionId) {
      return;
    }

    const applyLocalPresence = (state: AppStateStatus) => {
      const active = state === "active";
      queryClient.setQueryData(["presence", employeeId], {
        employeeId,
        status: active ? "online" : "idle",
        activeChannelId: active ? activeChannelId : null,
        lastInteractionAt: new Date(),
        lastHeartbeat: new Date(),
      });
    };

    applyLocalPresence(AppState.currentState);

    const sub = AppState.addEventListener("change", applyLocalPresence);
    return () => sub.remove();
  }, [activeChannelId, auth?.employeeId, connectionId]);
}
