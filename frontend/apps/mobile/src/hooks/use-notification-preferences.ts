/**
 * useNotificationPreferences — the person's notification preferences, read and
 * written through the server.
 *
 * These used to live on the handset: the In-App Alerts switch wrote one MMKV key
 * that no other device could see, so a person who silenced banners on their
 * phone found them back on the tablet, and a colleague signing in to the same
 * handset inherited the previous person's choice. The record now follows the
 * person.
 *
 * The write is optimistic with rollback, which is the pattern the theme toggle
 * established (`src/lib/theme.tsx`): the switch moves on the press, and a refused
 * write puts it back and says so rather than queueing silently. A mute somebody
 * believes is active and is not is worse than a refusal.
 *
 * No provider and no context. The theme needed one because 98 modules read the
 * palette; this is read by two — the foreground banner gate and the settings
 * screen.
 *
 * See specs/051-notification-preference-completeness/contracts/apis-wrapper.md.
 */

import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
  type SourceDomain,
} from "apis";

import { useAppState } from "@/hooks/use-app-state";
import { useAuth } from "@/hooks/use-auth";

/**
 * Persisted to MMKV by `setupQueryPersistence` (it persists every key except
 * `presence`) and cleared by `resetAuthenticatedAppState` on sign-out, which is
 * what stops the next person on the same handset seeing this one's settings.
 */
export const NOTIFICATION_PREFERENCES_QUERY_KEY = ["notification-preferences"] as const;

/** What a mutation sends: the whole record, never a patch. */
type StoredPreferences = Omit<NotificationPreferences, "updatedAt" | "exists">;

export interface NotificationPreferencesState {
  /** Defaults until the first successful read. Never null, so callers can always render. */
  preferences: NotificationPreferences;
  /** True until the server, or the persisted cache, has answered. */
  loading: boolean;
  /** True while a write is in flight. Disables the section's switches. */
  saving: boolean;
  isMuted(domain: SourceDomain): boolean;
  setInAppAlerts(enabled: boolean): Promise<void>;
  setDomainMuted(domain: SourceDomain, muted: boolean): Promise<void>;
}

export function useNotificationPreferences(): NotificationPreferencesState {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY,
    queryFn: getNotificationPreferences,
    // The token is read out of SecureStore asynchronously, so at frame zero there is
    // none. Firing then does not merely fail: the 401 goes through `onAuthFailure`,
    // which clears the stored session — the app signs itself out on launch. The banner
    // gate in `(app)/_layout.tsx` mounts this hook before anything else, so this guard
    // is load-bearing rather than an optimisation. Same rule the theme query follows.
    enabled: isAuthenticated,
    // Not a value worth retrying hard for; the cache paints until the next read.
    retry: 1,
    // Deliberately no staleTime. `setupQueryPersistence` re-hydrates the MMKV cache with
    // `setQueryData`, which stamps the restored value as though it had just been fetched —
    // so any staleTime at all would make a relaunched app treat a value read yesterday as
    // fresh and never revalidate. The persisted value still paints the first frame
    // (FR-022); it is just also checked against the server, which is what lets a change
    // made on another device arrive.
  });

  const preferences = data ?? DEFAULT_NOTIFICATION_PREFERENCES;

  // Refetch when the app comes forward, the way the theme preference does. Without this a
  // screen left mounted on one handset keeps showing what it read at launch, so a change
  // made on a second device is invisible until something else happens to remount — which
  // is the whole of what "the preference follows the person" is supposed to mean.
  useAppState(
    useCallback(
      (state) => {
        if (state === "active" && isAuthenticated) {
          void refetch();
        }
      },
      [isAuthenticated, refetch],
    ),
  );

  const mutation = useMutation({
    mutationFn: updateNotificationPreferences,
    onMutate: async (next: StoredPreferences) => {
      // A refetch landing mid-write would overwrite the optimistic value with the
      // record as it was before the press.
      await queryClient.cancelQueries({ queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY });
      const snapshot = queryClient.getQueryData<NotificationPreferences>(
        NOTIFICATION_PREFERENCES_QUERY_KEY,
      );
      queryClient.setQueryData<NotificationPreferences>(
        NOTIFICATION_PREFERENCES_QUERY_KEY,
        (prev) => ({ ...(prev ?? DEFAULT_NOTIFICATION_PREFERENCES), ...next }),
      );
      return { snapshot };
    },
    onError: (_error, _next, context) => {
      // `setQueryData(key, undefined)` is a no-op in React Query v5 — an updater that
      // resolves to undefined means "leave the cache alone". So a person who opens the
      // app with nothing cached, flips a mute and is refused would keep looking at a mute
      // that was never stored, which is the exact failure FR-021 exists to prevent.
      // Remove the entry instead; the screen falls back to the documented defaults and
      // the next successful read replaces them.
      if (context?.snapshot === undefined) {
        queryClient.removeQueries({ queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY });
      } else {
        queryClient.setQueryData(NOTIFICATION_PREFERENCES_QUERY_KEY, context.snapshot);
      }
      Alert.alert(
        "Couldn't save that",
        "We couldn't save that just now, so it has been put back. Check your connection and try again.",
      );
    },
    onSettled: () => {
      // The server deduplicates and sorts the mute list, so its record — not the
      // optimistic guess — is what the screen ends up showing.
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY });
    },
  });

  // Both setters read the record currently in cache and send all five fields.
  // There is no code path here that sends fewer, which is what makes a partial
  // write impossible rather than merely discouraged.
  const write = useCallback(
    async (change: Partial<StoredPreferences>) => {
      const current =
        queryClient.getQueryData<NotificationPreferences>(NOTIFICATION_PREFERENCES_QUERY_KEY) ??
        DEFAULT_NOTIFICATION_PREFERENCES;
      setSaving(true);
      try {
        await mutation.mutateAsync({
          inAppAlertsEnabled: current.inAppAlertsEnabled,
          mutedDomains: current.mutedDomains,
          dndEnabled: current.dndEnabled,
          dndStart: current.dndStart,
          dndEnd: current.dndEnd,
          ...change,
        });
      } catch {
        // Reported by onError; the caller drives a switch, not an error boundary.
      } finally {
        setSaving(false);
      }
    },
    [mutation, queryClient],
  );

  const isMuted = useCallback(
    (domain: SourceDomain) => preferences.mutedDomains.includes(domain),
    [preferences.mutedDomains],
  );

  const setInAppAlerts = useCallback(
    (enabled: boolean) => write({ inAppAlertsEnabled: enabled }),
    [write],
  );

  const setDomainMuted = useCallback(
    (domain: SourceDomain, muted: boolean) => {
      const current =
        queryClient.getQueryData<NotificationPreferences>(NOTIFICATION_PREFERENCES_QUERY_KEY) ??
        DEFAULT_NOTIFICATION_PREFERENCES;
      const mutedDomains = muted
        ? [...current.mutedDomains, domain]
        : current.mutedDomains.filter((d) => d !== domain);
      return write({ mutedDomains });
    },
    [queryClient, write],
  );

  return {
    preferences,
    // `isLoading` stays true for a disabled query, which would leave every switch
    // disabled for a signed-out person. There is nothing to wait for in that case.
    loading: isAuthenticated && isLoading,
    saving,
    isMuted,
    setInAppAlerts,
    setDomainMuted,
  };
}
