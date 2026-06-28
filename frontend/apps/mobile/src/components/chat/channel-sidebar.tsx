/**
 * ChannelSidebar — Slack-style slide-in channel list
 *
 * Slides in from the left as an overlay on the message thread.
 * Shows time-grouped channels (Today / This Week / Earlier)
 * with unread indicators and presence dots for DMs.
 */

import React, { useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  SectionList,
  Animated,
  Dimensions,
  StyleSheet,
} from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listRecentChannels, type ChannelWithDetails } from "apis";
import { UserAvatar } from "@/components/common/user-avatar";
import { PresenceIndicator } from "@/components/common/presence-indicator";
import { usePresence } from "@/hooks/use-presence";
import { groupChannelsByTime } from "@/utils/group-channels";
import { useNotificationStream } from "@/providers/notification-stream-provider";

const SIDEBAR_WIDTH = Dimensions.get("window").width * 0.82;

// ── Sidebar channel row ──────────────────────────────────────────────────────

function SidebarRow({
  item,
  isCurrent,
  hasUnread,
  onPress,
}: {
  item: ChannelWithDetails;
  isCurrent: boolean;
  hasUnread: boolean;
  onPress: () => void;
}) {
  const isDM = item.channel.channelType === "direct_message";
  const otherPerson = item.dmParticipants?.[0];
  const displayName = isDM
    ? otherPerson
      ? `${otherPerson.givenName} ${otherPerson.familyName}`.trim()
      : item.channel.displayName
    : item.channel.displayName || item.channel.titleSlug;

  const otherPersonId = isDM ? otherPerson?.id : undefined;
  const presenceStatus = usePresence(otherPersonId);
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
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        isCurrent && styles.rowActive,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={displayName}
    >
      {isDM ? (
        <View style={styles.avatarWrap}>
          <UserAvatar name={displayName} size={32} color="#7c3aed" />
          {indicatorStatus && <PresenceIndicator status={indicatorStatus} />}
        </View>
      ) : (
        <View style={[styles.avatarWrap, styles.channelIcon]}>
          <Text style={styles.channelIconText}>#</Text>
        </View>
      )}
      <Text
        style={[styles.rowTitle, isCurrent && styles.rowTitleActive, hasUnread && styles.rowTitleUnread]}
        numberOfLines={1}
      >
        {displayName}
      </Text>
      {hasUnread && !isCurrent && <View style={styles.unreadDot} />}
    </Pressable>
  );
}

// ── Main sidebar ─────────────────────────────────────────────────────────────

export function ChannelSidebar({
  visible,
  currentChannelId,
  onClose,
  onSelectChannel,
}: {
  visible: boolean;
  currentChannelId: string;
  onClose: () => void;
  onSelectChannel: (channelId: string) => void;
}) {
  const translateX = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const isVisible = useRef(false);

  const { data } = useQuery({
    queryKey: ["recentChannels"],
    queryFn: listRecentChannels,
    staleTime: 30_000,
  });

  const { unreadChannelIds } = useNotificationStream();

  useEffect(() => {
    if (visible && !isVisible.current) {
      isVisible.current = true;
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          damping: 25,
          stiffness: 200,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!visible && isVisible.current) {
      isVisible.current = false;
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: -SIDEBAR_WIDTH,
          useNativeDriver: true,
          damping: 25,
          stiffness: 200,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateX, overlayOpacity]);

  const channels = data ?? [];
  const sections = groupChannelsByTime(channels);

  // Always render (for animation), but pointer-events disabled when hidden
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]} pointerEvents={visible ? "auto" : "none"}>
      {/* Overlay */}
      <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Sidebar panel */}
      <Animated.View
        style={[
          styles.sidebar,
          { width: SIDEBAR_WIDTH, transform: [{ translateX }] },
        ]}
      >
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarTitle}>Channels</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close sidebar">
            <Text style={styles.closeBtn}>✕</Text>
          </Pressable>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.channel.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <SidebarRow
              item={item}
              isCurrent={item.channel.id === currentChannelId}
              hasUnread={unreadChannelIds.has(item.channel.id)}
              onPress={() => onSelectChannel(item.channel.id)}
            />
          )}
          stickySectionHeadersEnabled
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sidebar: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: "#f8f8fa",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#d1d1d6",
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  sidebarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
    backgroundColor: "#f8f8fa",
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111",
  },
  closeBtn: {
    fontSize: 18,
    color: "#8e8e93",
    fontWeight: "600",
  },
  sectionHeader: {
    backgroundColor: "#f2f2f7",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#636366",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: "#f8f8fa",
  },
  rowActive: {
    backgroundColor: "#dbeafe",
  },
  rowPressed: {
    backgroundColor: "#e8e8ed",
  },
  avatarWrap: {
    width: 32,
    height: 32,
  },
  channelIcon: {
    borderRadius: 16,
    backgroundColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
  },
  channelIconText: {
    fontSize: 15,
    color: "#2563eb",
    fontWeight: "700",
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: "#111",
  },
  rowTitleActive: {
    fontWeight: "700",
    color: "#2563eb",
  },
  rowTitleUnread: {
    fontWeight: "700",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0f172a",
    marginLeft: 4,
  },
});
