import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNotificationStream } from "@/providers/notification-stream-provider";

/**
 * Keeps focused surfaces aligned with the notification stream lifecycle.
 *
 * Each active screen does a single reconciliation fetch whenever the stream
 * enters a reconnect window, then starts interval polling only if the provider
 * marks the connection as degraded after the grace timeout.
 */
export function useStreamRecoveryRefresh(
  refetch: () => Promise<unknown>,
  {
    intervalMs,
    enabled = true,
    requireFocus = true,
  }: {
    intervalMs: number;
    enabled?: boolean;
    requireFocus?: boolean;
  },
) {
  const { reconnectGeneration, shouldUseFallbackPolling } = useNotificationStream();
  const [isFocused, setIsFocused] = useState(!requireFocus);
  const lastHandledGenerationRef = useRef<number | null>(null);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useFocusEffect(
    useCallback(() => {
      if (!requireFocus) {
        return undefined;
      }

      setIsFocused(true);
      return () => {
        setIsFocused(false);
      };
    }, [requireFocus]),
  );

  const isActive = enabled && isFocused;

  useEffect(() => {
    if (!isActive) {
      return;
    }

    if (lastHandledGenerationRef.current == null) {
      lastHandledGenerationRef.current = reconnectGeneration;
      return;
    }

    if (lastHandledGenerationRef.current === reconnectGeneration) {
      return;
    }

    lastHandledGenerationRef.current = reconnectGeneration;
    void refetchRef.current();
  }, [isActive, reconnectGeneration]);

  useEffect(() => {
    if (!isActive || !shouldUseFallbackPolling) {
      return;
    }

    void refetchRef.current();
    const timer = setInterval(() => {
      void refetchRef.current();
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }, [intervalMs, isActive, shouldUseFallbackPolling]);

  return {
    shouldUseFallbackPolling,
  };
}
