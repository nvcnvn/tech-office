/**
 * Chat — channel list
 *
 * Shows all channels grouped by priority:
 *   1. Needs Attention — unread channels (task channels first, then recency)
 *   2. Recent — read channels from today / this week
 *   3. Earlier — older read channels
 *
 * Features:
 * - Real-time unread indicator via SSE invalidation
 * - Task channels visually tagged with 📋 badge + task key
 * - DM avatars with presence indicator
 * - Pull-to-refresh
 * - Large touch targets for low-tech workers (72px rows)
 */

import React, { useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Stack, useNavigation, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listRecentChannels, type ChannelWithDetails } from "apis";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { parseChatStreamEvent } from "@/lib/chat-stream-events";
import { UserAvatar } from "@/components/common/user-avatar";
import { SkeletonChatList } from "@/components/ui/skeleton";
import { SFIcon } from "@/components/ui/sf-icon";
import { groupChannels } from "@/utils/group-channels";
import { usePresence } from "@/hooks/use-presence";
import { PresenceIndicator } from "@/components/common/presence-indicator";
import { SearchPill } from "@/components/ui/search-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { createTopLevelTabHeader } from "@/components/ui/header-title-with-stream-status";
import { ghostLoadingTimings, useGhostLoading } from "@/hooks/use-ghost-loading";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import { useStreamRecoveryRefresh } from "@/hooks/use-stream-recovery-refresh";
import { notificationStreamBehavior } from "@/lib/notification-stream-behavior";
import { withNavigationContext } from "@/lib/mobile-navigation";
import { useNotificationStream } from "@/providers/notification-stream-provider";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  chatIcons,
} from "@tech-office/theme-tokens";

// ── Time formatting ────────────────────────────────────────────────────────

function formatTime(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const oneDay = 86400000;

  if (diff < oneDay && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diff < 7 * oneDay) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── Unread tracking ────────────────────────────────────────────────────────
// Client-side unread: track which channel IDs have received a new message
// from SSE while we're not currently viewing them. Cleared on channel open.

function useUnreadChannels() {
  const [unreadSet, setUnreadSet] = React.useState<Set<string>>(new Set());

  const markUnread = useCallback((channelId: string) => {
    setUnreadSet((prev) => {
      if (prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.add(channelId);
      return next;
    });
  }, []);

  const clearUnread = useCallback((channelId: string) => {
    setUnreadSet((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
  }, []);

  return { unreadSet, markUnread, clearUnread };
}

// ── Channel row ─────────────────────────────────────────────────────────────

function ChannelRow({
  item,
  hasUnread,
  onPress,
}: {
  item: ChannelWithDetails;
  hasUnread: boolean;
  onPress: () => void;
}) {
  const isDM = item.channel.channelType === "direct_message";
  const isTask = item.channel.channelType === "project_ticket_thread";
  const otherPerson = item.dmParticipants?.[0];

  // Display name varies by channel type
  const displayName = isTask
    ? item.linkedResource
      ? `${item.linkedResource.displayIdentifier} ${item.linkedResource.displayTitle}`
      : item.channel.displayName || item.channel.titleSlug
    : isDM
    ? otherPerson
      ? `${otherPerson.givenName} ${otherPerson.familyName}`.trim()
      : item.channel.displayName
    : item.channel.displayName || item.channel.titleSlug;

  // Presence for DM rows
  const otherPersonId = isDM ? otherPerson?.id : undefined;
  const presenceStatus = usePresence(otherPersonId);

  // Map API presence status to PresenceIndicator status
  const indicatorStatus =
    presenceStatus === "online"
      ? "online"
      : presenceStatus === "idle"
      ? "away"
      : presenceStatus === "offline" ||
        presenceStatus === "online_hidden" ||
        presenceStatus === "unspecified"
      ? "offline"
      : null;

  return (
    <Pressable
      testID={`channel-row-${item.channel.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={displayName}
    >
      {/* Avatar / icon */}
      {isDM ? (
        <View style={styles.avatarWrap}>
          <UserAvatar name={displayName} size={46} color="#7c3aed" />
          {indicatorStatus && <PresenceIndicator status={indicatorStatus} />}
        </View>
      ) : isTask ? (
        <View style={[styles.avatarWrap, styles.taskIcon]}>
          <SFIcon name="checkmark.square.fill" size={20} color={lightPalette.success.dark} />
        </View>
      ) : (
        <View style={[styles.avatarWrap, styles.channelIcon]}>
          <SFIcon
            name={item.channel.isPrivate ? chatIcons.privateLock.name : chatIcons.channel.name}
            size={18}
            color={lightPalette.primary.main}
          />
        </View>
      )}

      {/* Name + subtitle */}
      <View style={styles.rowContent}>
        <View style={styles.rowTopLine}>
          <Text
            style={[styles.rowTitle, hasUnread && styles.rowTitleUnread]}
            numberOfLines={1}
          >
            {displayName}
          </Text>
          {item.channel.updatedAt && (
            <Text style={styles.rowTime}>
              {formatTime(item.channel.updatedAt)}
            </Text>
          )}
        </View>
        {item.channel.description ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {item.channel.description}
          </Text>
        ) : null}
      </View>

      {/* Unread dot */}
      {hasUnread && <View style={styles.unreadDot} />}

      {/* Chevron */}
      <SFIcon name="chevron.right" size={14} color={lightPalette.text.disabled} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

function ChatOverviewCard({
  totalCount,
  unreadCount,
}: {
  totalCount: number;
  unreadCount: number;
}) {
  return (
    <Card style={styles.summaryCard}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryIconWrap}>
          <SFIcon name="bubble.left.fill" size={18} color={lightPalette.primary.main} />
        </View>
        <View style={styles.summaryCopy}>
          <Text selectable style={styles.summaryTitle}>Recent Conversations</Text>
          <Text selectable style={styles.summarySubtitle}>
            Unread items stay at the top so you can see where action is needed first.
          </Text>
        </View>
      </View>

      <View style={styles.summaryStatsRow}>
        <View style={styles.summaryStatBlock}>
          <Text style={styles.summaryStatValue}>{totalCount}</Text>
          <Text style={styles.summaryStatLabel}>Visible chats</Text>
        </View>
        <View style={styles.summaryStatDivider} />
        <View style={styles.summaryStatBlock}>
          <Text style={styles.summaryStatValue}>{unreadCount}</Text>
          <Text style={styles.summaryStatLabel}>Need attention</Text>
        </View>
      </View>
    </Card>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function ChatIndexScreen() {
  const navigation = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { subscribe } = useNotificationStream();
  const { unreadSet, markUnread, clearUnread } = useUnreadChannels();
  const hasLoadedRef = useRef(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["recentChannels"],
    queryFn: listRecentChannels,
    staleTime: 30_000,
  });
  const { isRefreshing, onRefresh } = useManualRefresh(refetch);
  const { isGhostLoading, runGhostLoad } = useGhostLoading(
    refetch,
    ghostLoadingTimings.tabMinimumMs,
  );

  useStreamRecoveryRefresh(refetch, {
    intervalMs: notificationStreamBehavior.fallbackPollMs.chat,
  });

  useEffect(() => {
    if (!isLoading) {
      hasLoadedRef.current = true;
    }
  }, [isLoading]);

  useEffect(() => {
    const parentNavigation = navigation.getParent();
    if (!parentNavigation) {
      return;
    }

    const unsubscribe = parentNavigation.addListener("tabPress", () => {
      if (!hasLoadedRef.current) {
        return;
      }
      void runGhostLoad();
    });

    return unsubscribe;
  }, [navigation, runGhostLoad]);

  useEffect(() => {
    return subscribe(({ type, rawData }) => {
      if (
        type !== "chat_message" &&
        type !== "chat_reaction" &&
        type !== "notification"
      ) {
        return;
      }

      try {
        const event = parseChatStreamEvent(rawData);
        if (event?.channelId) {
          const isReactionEvent =
            type === "chat_reaction" || event.notificationType === "reaction";
          const isVoiceEvent = event.notificationType?.startsWith("voice_call_") ?? false;
          if (!isReactionEvent) {
            markUnread(event.channelId);
          }
          if (isVoiceEvent) {
            queryClient.invalidateQueries({ queryKey: ["messages", event.channelId] });
          }
          queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
        }
      } catch {
        // silently ignore malformed events
      }
    });
  }, [markUnread, queryClient, subscribe]);

  if (isLoading || isGhostLoading) {
    return (
      <>
        <Stack.Screen
          options={createTopLevelTabHeader("Chat", [
            {
              key: "new-channel",
              testID: chatIcons.newChannel.testID,
              accessibilityLabel: chatIcons.newChannel.label,
              onPress: () => router.push("/(app)/(chat)/new-channel"),
              icon: (
                <SFIcon
                  name={chatIcons.newChannel.name}
                  size={22}
                  color={lightPalette.primary.main}
                />
              ),
            },
            {
              key: "new-dm",
              testID: chatIcons.newDM.testID,
              accessibilityLabel: chatIcons.newDM.label,
              onPress: () => router.push("/(app)/(chat)/new-dm"),
              icon: (
                <SFIcon
                  name={chatIcons.newDM.name}
                  size={22}
                  color={lightPalette.primary.main}
                />
              ),
            },
          ])}
        />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.container}
          contentContainerStyle={styles.loadingScrollContent}
        >
          <SearchPill />
          <SkeletonChatList count={10} sectionCount={3} />
        </ScrollView>
      </>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text selectable style={styles.errorText}>Failed to load conversations</Text>
        <Button label="Retry" onPress={() => refetch()} />
      </View>
    );
  }

  const channels = data ?? [];
  const sections = groupChannels(channels, unreadSet);

  const handleChannelPress = (item: ChannelWithDetails) => {
    clearUnread(item.channel.id);
    router.push(
      withNavigationContext(`/(app)/(chat)/${item.channel.id}`, {
        fallbackHref: "/(app)/(chat)",
        ownerTab: "chat",
        backLabel: "Chat",
      }) as never,
    );
  };

  return (
    <>
      <Stack.Screen
        options={createTopLevelTabHeader("Chat", [
          {
            key: "new-channel",
            testID: chatIcons.newChannel.testID,
            accessibilityLabel: chatIcons.newChannel.label,
            onPress: () => router.push("/(app)/(chat)/new-channel"),
            icon: (
              <SFIcon
                name={chatIcons.newChannel.name}
                size={22}
                color={lightPalette.primary.main}
              />
            ),
          },
          {
            key: "new-dm",
            testID: chatIcons.newDM.testID,
            accessibilityLabel: chatIcons.newDM.label,
            onPress: () => router.push("/(app)/(chat)/new-dm"),
            icon: (
              <SFIcon
                name={chatIcons.newDM.name}
                size={22}
                color={lightPalette.primary.main}
              />
            ),
          },
        ])}
      />
      {sections.length === 0 ? (
        <EmptyState
          sfSymbol="bubble.left.and.text.bubble.right"
          title="No messages yet"
          subtitle="Start a conversation with your team!"
          action={{
            label: "Start Chat",
            onPress: () => router.push("/(app)/(chat)/new-dm"),
          }}
        />
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.container}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.scrollContent}
        >
          <SearchPill />
          <ChatOverviewCard totalCount={channels.length} unreadCount={unreadSet.size} />
          {sections.map((section) => (
            <View key={section.title} style={styles.sectionBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>
                  {section.title}
                  {section.title === "Needs Attention" && section.data.length > 0
                    ? ` (${section.data.length})`
                    : ""}
                </Text>
              </View>
              <View style={styles.sectionCard}>
                {section.data.map((item, index) => (
                  <React.Fragment key={item.channel.id}>
                    {index > 0 && <View style={styles.cardSeparator} />}
                    <ChannelRow
                      item={item}
                      hasUnread={unreadSet.has(item.channel.id)}
                      onPress={() => handleChannelPress(item)}
                    />
                  </React.Fragment>
                ))}
              </View>
            </View>
          ))}
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
  loadingScrollContent: {
    flexGrow: 1,
    paddingBottom: mobileLayout.itemGap,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 14,
    minHeight: mobileLayout.listRowHeight,
    backgroundColor: lightPalette.background.paper,
    gap: mobileLayout.iconTextGap,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  avatarWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  channelIcon: {
    backgroundColor: "#dbeafe",
  },
  taskIcon: {
    backgroundColor: "#e8f5e9",
  },
  summaryCard: {
    marginHorizontal: mobileLayout.screenPadding,
    marginTop: spacing[1],
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: mobileLayout.iconTextGap,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef5fc",
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
  summaryTitle: {
    fontSize: mobileTypography.sectionHeader.fontSize as number,
    lineHeight: mobileTypography.sectionHeader.lineHeight as number,
    fontWeight: mobileTypography.sectionHeader.fontWeight as "700",
    color: lightPalette.text.primary,
  },
  summarySubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: mobileTypography.listSecondary.lineHeight as number,
    color: lightPalette.text.secondary,
  },
  summaryStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[1.5],
    paddingTop: spacing[1.5],
    borderTopWidth: border.hairline,
    borderTopColor: lightPalette.divider,
  },
  summaryStatBlock: {
    flex: 1,
    gap: 2,
  },
  summaryStatValue: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
    fontVariant: ["tabular-nums"],
  },
  summaryStatLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  summaryStatDivider: {
    width: border.hairline,
    alignSelf: "stretch",
    backgroundColor: lightPalette.divider,
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: mobileLayout.itemGap,
  },
  rowTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: lightPalette.text.primary,
    flex: 1,
  },
  rowTitleUnread: {
    fontWeight: "700" as const,
  },
  rowTime: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
    fontVariant: ["tabular-nums"],
  },
  rowSubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: lightPalette.primary.main,
    marginRight: 4,
  },
  sectionHeader: {
    backgroundColor: lightPalette.background.default,
    paddingHorizontal: mobileLayout.screenPadding,
    paddingTop: spacing[1.5],
    paddingBottom: mobileLayout.itemGap,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: mobileLayout.cardPadding * 2,
    gap: mobileLayout.cardGap,
  },
  errorText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.error.main,
    textAlign: "center",
  },
});
