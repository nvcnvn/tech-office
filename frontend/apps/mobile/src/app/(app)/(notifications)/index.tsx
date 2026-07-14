/**
 * Alerts tab — notification list
 *
 * Per mobile-ui-design.md (§4.4):
 * - Simple 2-segment filter: All vs Unread
 * - Grouped by day (Today / Yesterday / Earlier)
 * - Domain icons (SF Symbols) per notification type
 * - Tap → deep-link to relevant screen
 * - Mark All Read button
 * - 72dp row height minimum
 * - Bold text for unread, normal weight for read
 * - Pull-to-refresh
 */

import React, { useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import { useRouter, Stack, useFocusEffect } from "expo-router";
import { useInfiniteQuery, useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  listNotifications,
  markAsRead,
  markAllBeforeTimestampAsRead,
  getUnreadCount,
} from "apis";
import { formatDistanceToNow, isToday, isYesterday } from "date-fns";
import * as Haptics from "expo-haptics";
import { SFIcon } from "@/components/ui/sf-icon";
import { NOTIFICATIONS_HOME_HREF, resolveNotificationPayloadHref } from "@/lib/linking";
import { withNavigationContext } from "@/lib/mobile-navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonNotifList } from "@/components/ui/skeleton";
import { createTopLevelTabHeader } from "@/components/ui/header-title-with-stream-status";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import { useStreamRecoveryRefresh } from "@/hooks/use-stream-recovery-refresh";
import { notificationStreamBehavior } from "@/lib/notification-stream-behavior";
import { stripHtml } from "@tech-office/notifications";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  border,
  spacing,
  notificationDomain,
} from "@tech-office/theme-tokens";

// ── Filter ────────────────────────────────────────────────────────────────────

type Filter = "all" | "unread";

const alertsLoadingConfig = {
  minimumGhostMs: 500,
  mockMutationDelayMs: 500,
} as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Domain SF Symbols ─────────────────────────────────────────────────────────

const DOMAIN_SF: Record<string, { icon: string; tint: string }> = {
  chat: { icon: "bubble.left.fill", tint: notificationDomain.chat.icon },
  projects: { icon: "checkmark.square.fill", tint: notificationDomain.tasks.icon },
  calendar: { icon: "calendar", tint: notificationDomain.calendar.icon },
  docs: { icon: "doc.text.fill", tint: "#7b1fa2" },
  system: { icon: "gear", tint: notificationDomain.system.icon },
  hr: { icon: "person.2.fill", tint: lightPalette.primary.main },
};

const TYPE_SF: Record<string, { icon: string; tint: string }> = {
  voice_call_incoming: { icon: "phone.fill", tint: lightPalette.success.main },
};

interface NotificationNavigationTarget {
  deepLink?: string;
  domain?: string;
  resourceType?: string;
  resourceId?: string;
  secondaryId?: string;
  action?: string;
}

interface AlertNotification {
  notificationRecipientId?: string;
  notificationId?: string;
  readStatus?: boolean;
  sourceDomain?: string;
  title?: string;
  message?: string;
  createdAt?: unknown;
  sourceDomainId?: string;
  notificationType?: string;
  payload?: {
    voiceCall?: {
      senderName?: string;
      channelName?: string;
    };
  };
  navigationTarget?: NotificationNavigationTarget;
}

interface NotificationsPage {
  notifications?: AlertNotification[];
  nextPageToken?: string;
}

interface UnreadCountResponse {
  unreadCount?: number;
}

interface NotificationPagesData {
  pages?: NotificationsPage[];
}

function parseNotificationDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "object") {
    const protoTimestamp = value as {
      seconds?: number | string;
      nanos?: number | string;
    };
    const seconds = Number(protoTimestamp.seconds ?? 0);
    const nanos = Number(protoTimestamp.nanos ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return null;
    }

    const date = new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

// ── Navigation helper ─────────────────────────────────────────────────────────

function buildHref(notification: AlertNotification): string | null {
  return resolveNotificationPayloadHref(notification);
}

function buildNotificationRowKey(
  notification: AlertNotification,
  index: number,
): string {
  return (
    notification.notificationRecipientId ??
    notification.notificationId ??
    `notification-${index}`
  );
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function notificationDisplayText(notification: AlertNotification): {
  title: string;
  message: string;
} {
  const title = trimmed(notification.title) ?? "Alert";
  const message = stripHtml(notification.message ?? "");

  if (notification.notificationType !== "voice_call_incoming") {
    return { title, message };
  }

  const senderName = trimmed(notification.payload?.voiceCall?.senderName);
  const channelName = trimmed(notification.payload?.voiceCall?.channelName);

  return {
    title: senderName ? `${senderName} is calling` : title,
    message: channelName ? `In ${channelName}` : message,
  };
}

function notificationIcon(notification: AlertNotification): { icon: string; tint: string } {
  if (notification.notificationType && TYPE_SF[notification.notificationType]) {
    return TYPE_SF[notification.notificationType];
  }

  return notification.sourceDomain
    ? (DOMAIN_SF[notification.sourceDomain] ?? DOMAIN_SF.system)
    : DOMAIN_SF.system;
}

// ── Group notifications by day ────────────────────────────────────────────────

interface NotifSection {
  title: string;
  data: AlertNotification[];
}

function groupByDay(notifications: AlertNotification[]): NotifSection[] {
  const today: AlertNotification[] = [];
  const yesterday: AlertNotification[] = [];
  const earlier: AlertNotification[] = [];

  for (const n of notifications) {
    const date = parseNotificationDate(n.createdAt);
    if (date && isToday(date)) {
      today.push(n);
    } else if (date && isYesterday(date)) {
      yesterday.push(n);
    } else {
      earlier.push(n);
    }
  }

  const sections: NotifSection[] = [];
  if (today.length > 0) sections.push({ title: "Today", data: today });
  if (yesterday.length > 0) sections.push({ title: "Yesterday", data: yesterday });
  if (earlier.length > 0) sections.push({ title: "Earlier", data: earlier });
  return sections;
}

function useAlertsGhostLoading({
  filter,
  refetchNotifications,
  refetchUnreadCount,
}: {
  filter: Filter;
  refetchNotifications: () => Promise<unknown>;
  refetchUnreadCount: () => Promise<unknown>;
}) {
  const [isGhostLoading, setIsGhostLoading] = useState(true);
  const cycleRef = useRef(0);

  const runLoadCycle = useCallback(async () => {
    const cycleId = cycleRef.current + 1;
    cycleRef.current = cycleId;
    setIsGhostLoading(true);

    try {
      await Promise.allSettled([
        sleep(alertsLoadingConfig.minimumGhostMs),
        refetchNotifications(),
        refetchUnreadCount(),
      ]);
    } finally {
      if (cycleRef.current === cycleId) {
        setIsGhostLoading(false);
      }
    }
  }, [refetchNotifications, refetchUnreadCount]);

  useFocusEffect(
    useCallback(() => {
      void runLoadCycle();
    }, [filter, runLoadCycle]),
  );

  return {
    isGhostLoading,
  };
}

// ── Main screen ───────────────────────────────────────────────────────────────

function AlertsControls({
  filter,
  unreadCount,
  onChangeFilter,
  onMarkAllRead,
  disabled,
}: {
  filter: Filter;
  unreadCount: number;
  onChangeFilter: (value: Filter) => void;
  onMarkAllRead: () => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.controlsWrap}>
      <View style={styles.controlsRow}>
        <View style={styles.segmentRow}>
          {(["all", "unread"] as Filter[]).map((value) => (
            <Pressable
              key={value}
              onPress={() => onChangeFilter(value)}
              style={[
                styles.segment,
                filter === value && styles.segmentActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  filter === value && styles.segmentTextActive,
                ]}
              >
                {value === "all"
                  ? "All"
                  : `Unread${unreadCount > 0 ? ` (${unreadCount > 99 ? "99+" : unreadCount})` : ""}`}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          testID="mark-all-read-button"
          onPress={onMarkAllRead}
          disabled={disabled}
          hitSlop={12}
          style={({ pressed }) => [
            styles.readAllButton,
            disabled && styles.readAllButtonDisabled,
            pressed && !disabled && styles.readAllButtonPressed,
          ]}
        >
          <SFIcon
            name="checkmark.circle"
            size={16}
            color={disabled ? lightPalette.text.disabled : lightPalette.primary.main}
          />
          <Text
            style={[
              styles.readAllText,
              disabled && styles.readAllTextDisabled,
            ]}
          >
            Read All
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function AlertsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");

  const {
    data,
    isLoading,
    refetch: refetchNotifications,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["notifications", filter],
    queryFn: async ({ pageParam }: { pageParam: string }) => {
      return await listNotifications({
        unreadOnly: filter === "unread",
        pageSize: 30,
        pageToken: pageParam,
      });
    },
    enabled: false,
    initialPageParam: "",
    getNextPageParam: (lastPage: NotificationsPage) =>
      lastPage.nextPageToken || undefined,
  });

  const { data: unreadData, refetch: refetchUnreadCount } = useQuery({
    queryKey: ["unread-count"],
    queryFn: async () => {
      return getUnreadCount();
    },
    enabled: false,
    refetchInterval: 30000,
  });

  const { isGhostLoading } = useAlertsGhostLoading({
    filter,
    refetchNotifications,
    refetchUnreadCount,
  });

  const refreshAlerts = useCallback(async () => {
    await Promise.allSettled([refetchNotifications(), refetchUnreadCount()]);
  }, [refetchNotifications, refetchUnreadCount]);

  useStreamRecoveryRefresh(refreshAlerts, {
    intervalMs: notificationStreamBehavior.fallbackPollMs.alerts,
  });

  const { isRefreshing, onRefresh } = useManualRefresh(refreshAlerts);

  const handleChangeFilter = useCallback((value: Filter) => {
    setFilter(value);
  }, []);

  const unreadCount = (unreadData as UnreadCountResponse | undefined)?.unreadCount ?? 0;

  const allNotifications = useMemo<AlertNotification[]>(
    () =>
      (data as NotificationPagesData | undefined)?.pages?.flatMap(
        (page) => page.notifications ?? [],
      ) ?? [],
    [data],
  );

  const sections = useMemo(() => groupByDay(allNotifications), [allNotifications]);

  const markReadMutation = useMutation({
    mutationFn: async (recipientId: string) => {
      await sleep(alertsLoadingConfig.mockMutationDelayMs);
      await markAsRead(recipientId);
    },
    onMutate: async (recipientId) => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const prev = queryClient.getQueryData<NotificationPagesData>(["notifications", filter]);
      queryClient.setQueryData<NotificationPagesData>(["notifications", filter], (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            notifications: (page.notifications ?? []).map((notification) =>
              notification.notificationRecipientId === recipientId
                ? { ...notification, readStatus: true }
                : notification
            ),
          })),
        };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(["notifications", filter], ctx?.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      void refreshAlerts();
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await sleep(alertsLoadingConfig.mockMutationDelayMs);
      await markAllBeforeTimestampAsRead();
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      void refreshAlerts();
    },
  });

  // Auto-mark all visible notifications as read when the tab is focused.
  // Fires after the skeleton clears so the user briefly sees unread state.
  useFocusEffect(
    useCallback(() => {
      if (isGhostLoading) return;
      let cancelled = false;
      markAllBeforeTimestampAsRead()
        .then(() => {
          if (cancelled) return;
          queryClient.invalidateQueries({ queryKey: ["unread-count"] });
          // Optimistically mark every cached page entry as read so the UI
          // reflects the change without a round-trip refetch.
          for (const f of ["all", "unread"] as Filter[]) {
            queryClient.setQueryData<NotificationPagesData>(
              ["notifications", f],
              (old) => {
                if (!old?.pages) return old;
                return {
                  ...old,
                  pages: old.pages.map((page) => ({
                    ...page,
                    notifications: (page.notifications ?? []).map((n) => ({
                      ...n,
                      readStatus: true,
                    })),
                  })),
                };
              },
            );
          }
        })
        .catch(() => {
          // Non-fatal – user can still use the Read All button manually.
        });
      return () => {
        cancelled = true;
      };
    }, [isGhostLoading, queryClient]),
  );

  const handleNotificationPress = useCallback(
    (notification: AlertNotification) => {
      if (!notification.readStatus) {
        if (notification.notificationRecipientId) {
          markReadMutation.mutate(notification.notificationRecipientId);
        }
        Haptics.selectionAsync();
      }
      const href = buildHref(notification);
      if (href && href !== NOTIFICATIONS_HOME_HREF) {
        router.push(
          withNavigationContext(href, {
            fallbackHref: NOTIFICATIONS_HOME_HREF,
            ownerTab: "alerts",
            backLabel: "Alerts",
          }) as never,
        );
      }
    },
    [markReadMutation, router],
  );

  const showLoadingSkeleton = isGhostLoading || (isLoading && !isRefreshing);

  return (
    <>
      <Stack.Screen
        options={createTopLevelTabHeader("Alerts")}
      />

      {showLoadingSkeleton ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.loadingScrollContent}
          style={styles.container}
        >
          <AlertsControls
            filter={filter}
            unreadCount={unreadCount}
            onChangeFilter={handleChangeFilter}
            onMarkAllRead={() => {}}
            disabled
          />
          <SkeletonNotifList count={8} sectionCount={3} showControlsPlaceholder={false} />
        </ScrollView>
      ) : sections.length === 0 ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.emptyScrollContent}
          style={styles.container}
        >
          <AlertsControls
            filter={filter}
            unreadCount={unreadCount}
            onChangeFilter={handleChangeFilter}
            onMarkAllRead={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending || unreadCount === 0}
          />
          <EmptyState
            sfSymbol={filter === "unread" ? "bell.slash" : "bell.slash"}
            title={filter === "unread" ? "All caught up!" : "No alerts"}
            subtitle={filter === "unread" ? "You've read all your alerts." : "Alerts will appear here."}
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.container}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.scrollContent}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            if (
              layoutMeasurement.height + contentOffset.y >=
              contentSize.height - 300
            ) {
              if (hasNextPage && !isFetchingNextPage) fetchNextPage();
            }
          }}
          scrollEventThrottle={400}
        >
          <AlertsControls
            filter={filter}
            unreadCount={unreadCount}
            onChangeFilter={handleChangeFilter}
            onMarkAllRead={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending || unreadCount === 0}
          />
          {sections.map((section) => (
            <View key={section.title} style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{section.title}</Text>
              </View>
              <View style={styles.sectionCard}>
                {section.data.map((item, index) => {
                  const icon = notificationIcon(item);
                  const displayText = notificationDisplayText(item);
                  return (
                    <React.Fragment key={buildNotificationRowKey(item, index)}>
                      {index > 0 && <View style={styles.cardSeparator} />}
                      <Pressable
                        onPress={() => handleNotificationPress(item)}
                        style={({ pressed }) => [
                          styles.notifRow,
                          !item.readStatus && styles.notifRowUnread,
                          pressed && styles.notifRowPressed,
                        ]}
                      >
                        <View style={[styles.iconCircle, { backgroundColor: `${icon.tint}15` }]}>
                          <SFIcon name={icon.icon} size={20} color={icon.tint} />
                        </View>

                        <View style={styles.notifContent}>
                          <Text
                            style={[
                              styles.notifTitle,
                              !item.readStatus && styles.notifTitleUnread,
                            ]}
                            numberOfLines={1}
                          >
                            {displayText.title}
                          </Text>
                          <Text numberOfLines={2} style={styles.notifMessage}>
                            {displayText.message}
                          </Text>
                          <Text style={styles.notifTime}>
                            {(() => {
                              const createdAt = parseNotificationDate(item.createdAt);
                              return createdAt
                                ? formatDistanceToNow(createdAt, {
                                    addSuffix: true,
                                  })
                                : "";
                            })()}
                          </Text>
                        </View>

                        {!item.readStatus && <View style={styles.unreadDot} />}
                      </Pressable>
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          ))}
          {isFetchingNextPage && <ActivityIndicator style={{ padding: 16 }} />}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  controlsWrap: {
    paddingHorizontal: mobileLayout.screenPadding,
    paddingTop: 4,
    paddingBottom: mobileLayout.itemGap,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.itemGap,
  },
  readAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dbe7f6",
    backgroundColor: lightPalette.background.paper,
  },
  readAllButtonPressed: {
    opacity: opacity.pressed,
  },
  readAllButtonDisabled: {
    backgroundColor: lightPalette.background.default,
  },
  readAllText: {
    color: lightPalette.primary.main,
    fontSize: mobileTypography.buttonSm.fontSize as number,
    fontWeight: "600" as const,
  },
  readAllTextDisabled: {
    color: lightPalette.text.disabled,
  },
  segmentRow: {
    flexDirection: "row",
    flex: 1,
    backgroundColor: lightPalette.background.default,
    borderRadius: 12,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: lightPalette.background.paper,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  segmentText: {
    fontSize: mobileTypography.buttonSm.fontSize as number,
    fontWeight: "500" as const,
    color: lightPalette.text.secondary,
  },
  emptyScrollContent: {
    flexGrow: 1,
  },
  loadingScrollContent: {
    flexGrow: 1,
    paddingBottom: mobileLayout.itemGap,
  },
  segmentTextActive: {
    color: lightPalette.text.primary,
    fontWeight: "600" as const,
  },
  sectionHeader: {
    backgroundColor: lightPalette.background.default,
    paddingHorizontal: mobileLayout.screenPadding,
    paddingVertical: mobileLayout.itemGap,
  },
  sectionHeaderText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  scrollContent: {
    paddingBottom: spacing[4],
  },
  sectionBlock: {
    marginTop: spacing[0.5],
  },
  sectionCard: {
    marginHorizontal: mobileLayout.screenPadding,
    borderRadius: radius.md,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  cardSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginHorizontal: mobileLayout.cardPadding,
  },
  notifRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 14,
    minHeight: mobileLayout.listRowHeight,
    backgroundColor: lightPalette.background.paper,
    gap: mobileLayout.iconTextGap,
  },
  notifRowUnread: {
    backgroundColor: "#f0f7ff",
  },
  notifRowPressed: {
    opacity: opacity.pressed,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  notifContent: {
    flex: 1,
    gap: 2,
  },
  notifTitle: {
    fontSize: 15,
    fontWeight: "400" as const,
    color: lightPalette.text.primary,
  },
  notifTitleUnread: {
    fontWeight: "600" as const,
  },
  notifMessage: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
    lineHeight: 20,
  },
  notifTime: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: lightPalette.primary.main,
    marginTop: 6,
  },
});
