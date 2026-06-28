/**
 * React Query client configuration for mobile — T2.6
 *
 * Adds MMKV-based persistence so cached data survives app restarts.
 * Uses the synchronous MMKV storage adapter via a custom persister.
 */

import { QueryClient } from "@tanstack/react-query";
import { MMKV } from "react-native-mmkv";

// ── MMKV instance for query cache ────────────────────────────────────────────
// Separate MMKV instance from the platform adapter to avoid key collisions.
export const queryStorage = new MMKV({ id: "rq-cache" });

const CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE";
const MAX_AGE_MS = 1000 * 60 * 60 * 24; // 24 hours

function isPersistableQueryKey(queryKey: readonly unknown[]) {
  const [rootKey] = queryKey;

  // Presence is real-time state. Restoring it as fresh data after an app
  // restart makes users appear offline until a later refetch or stream event.
  return rootKey !== "presence";
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      refetchOnWindowFocus: false, // Use AppState instead
      gcTime: MAX_AGE_MS,
    },
  },
});

export function clearPersistedQueryCache() {
  queryStorage.delete(CACHE_KEY);
}

/**
 * Persist the React Query cache to MMKV storage.
 * Call this after the queryClient is rendered.
 *
 * Follows the manual persistence pattern for React Query v5:
 * https://tanstack.com/query/v5/docs/framework/react/plugins/persistQueryClient
 */
export function setupQueryPersistence() {
  // Restore cache from MMKV on startup
  try {
    const raw = queryStorage.getString(CACHE_KEY);
    if (raw) {
      const cache = JSON.parse(raw) as {
        timestamp: number;
        clientState: unknown;
      };
      if (Date.now() - cache.timestamp < MAX_AGE_MS) {
        queryClient.setQueryData;
        // Hydrate individual query entries to avoid setState-before-mount issues
        if (
          cache.clientState &&
          typeof cache.clientState === "object" &&
          "queries" in (cache.clientState as object)
        ) {
          const state = cache.clientState as {
            queries: Array<{ queryKey: unknown[]; state: unknown }>;
          };
          state.queries.forEach(({ queryKey, state: qState }) => {
            if (!isPersistableQueryKey(queryKey)) {
              return;
            }
            queryClient.setQueryData(queryKey, (qState as any)?.data);
          });
        }
      }
    }
  } catch {
    // Corrupted cache — ignore and start fresh
    clearPersistedQueryCache();
  }

  // Subscribe to cache changes and persist them
  const unsubscribe = queryClient.getQueryCache().subscribe(() => {
    try {
      const queries = queryClient
        .getQueryCache()
        .getAll()
        .filter(
          (q) =>
            q.state.status === "success" &&
            isPersistableQueryKey(q.queryKey),
        )
        .map((q) => ({
          queryKey: q.queryKey,
          state: { data: q.state.data },
        }));

      queryStorage.set(
        CACHE_KEY,
        JSON.stringify({ timestamp: Date.now(), clientState: { queries } })
      );
    } catch {
      // Storage full or other error — skip silently
    }
  });

  return unsubscribe;
}
