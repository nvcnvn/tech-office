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
import { makeStyles, useTheme } from "@/lib/theme";
import { shadows, statusColors } from "@tech-office/theme-tokens";

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
  const styles = useStyles();
  const { palette } = useTheme();

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
          <UserAvatar name={displayName} size={32} color={palette.eventCategory.personal} />
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
  const styles = useStyles();

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

const useStyles = makeStyles((t) => ({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.overlay.scrim,
  },
  sidebar: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: t.background.default,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: t.divider,
    shadowColor: shadows.lg.shadowColor,
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
    borderBottomColor: t.divider,
    backgroundColor: t.background.default,
  },
  sidebarTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: t.text.primary,
  },
  closeBtn: {
    fontSize: 18,
    color: t.text.secondary,
    fontWeight: "600",
  },
  sectionHeader: {
    backgroundColor: t.background.default,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: "600",
    color: t.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: t.background.default,
  },
  rowActive: {
    backgroundColor: statusColors.info[t.mode].bg,
  },
  rowPressed: {
    backgroundColor: t.divider,
  },
  avatarWrap: {
    width: 32,
    height: 32,
  },
  channelIcon: {
    borderRadius: 16,
    backgroundColor: t.notificationDomain.chat.bg,
    justifyContent: "center",
    alignItems: "center",
  },
  channelIconText: {
    fontSize: 15,
    color: t.notificationDomain.chat.icon,
    fontWeight: "700",
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: t.text.primary,
  },
  rowTitleActive: {
    fontWeight: "700",
    color: t.info.main,
  },
  rowTitleUnread: {
    fontWeight: "700",
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.text.primary,
    marginLeft: 4,
  },
}));
