import { useState, useCallback } from "react";

/**
 * Tracks user-initiated pull-to-refresh so that `RefreshControl` only
 * shows the spinner when the user explicitly pulls, not during background
 * refetches (which on iOS + headerLargeTitle render as a stuck, non-animated icon).
 */
export function useManualRefresh(refetch: () => Promise<unknown>) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  }, [refetch]);

  return { isRefreshing, onRefresh };
}
