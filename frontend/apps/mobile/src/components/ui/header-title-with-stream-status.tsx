/**
 * HeaderTitleWithStreamStatus
 *
 * Compact title row for top-level tab screens. In debug/QA builds it adds a
 * small stream health chip ahead of the title so transport state is visible
 * without covering header actions or consuming extra screen real estate.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRouter } from "expo-router";
import { SFIcon } from "@/components/ui/sf-icon";
import { useNotificationStream } from "@/providers/notification-stream-provider";
import {
  lightPalette,
  mobileTypography,
  spacing,
} from "@tech-office/theme-tokens";

const headerActionGap = 4;
const headerActionSize = 44;
const headerActionInset = 8;

const shouldShowStreamStatus =
  __DEV__ || process.env.EXPO_PUBLIC_SHOW_STREAM_STATUS === "true";

export function HeaderTitleWithStreamStatus({
  title,
}: {
  title: string;
}) {
  const { isConnected, shouldUseFallbackPolling, showReconnectingIndicator } =
    useNotificationStream();

  const status = shouldUseFallbackPolling
    ? {
        label: "Polling",
        dotColor: lightPalette.info.main,
        textColor: lightPalette.info.dark,
        backgroundColor: "#eff6ff",
        borderColor: "#bfdbfe",
      }
    : isConnected || !showReconnectingIndicator
      ? {
          label: "Live",
          dotColor: lightPalette.success.main,
          textColor: lightPalette.success.dark,
          backgroundColor: "#f0fdf4",
          borderColor: "#bbf7d0",
        }
      : {
          label: "Reconnecting",
          dotColor: lightPalette.warning.main,
          textColor: "#92400e",
          backgroundColor: "#fffbeb",
          borderColor: "#fde68a",
        };

  return (
    <View style={styles.row}>
      {shouldShowStreamStatus ? (
        <View
          style={[
            styles.badge,
            {
              backgroundColor: status.backgroundColor,
              borderColor: status.borderColor,
            },
          ]}
          testID="stream-status-badge"
        >
          <View style={[styles.dot, { backgroundColor: status.dotColor }]} />
          <Text style={[styles.badgeText, { color: status.textColor }]}>
            {status.label}
          </Text>
        </View>
      ) : null}
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

type TopLevelHeaderAction = {
  key: string;
  icon: React.ReactNode;
  onPress: () => void;
  testID?: string;
  accessibilityLabel: string;
};

function HeaderActionRow({
  actions,
}: {
  actions: TopLevelHeaderAction[];
}) {
  return (
    <View style={styles.actionRow}>
      {actions.map((action) => (
        <Pressable
          key={action.key}
          testID={action.testID}
          onPress={action.onPress}
          hitSlop={8}
          style={styles.actionButton}
          accessibilityLabel={action.accessibilityLabel}
          accessibilityRole="button"
        >
          {action.icon}
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Back control for a screen that is a tab root but has no tab button —
 * Schedule and Alerts, which are pushed from the Today and Chat headers.
 * Without it there is no way out except tapping another tab, and a cold
 * deep link (a push notification tap) has no history at all, so it falls
 * back to replacing with the tab that owns the entry point.
 */
function TopLevelBackButton({ label, href }: { label: string; href: string }) {
  const router = useRouter();
  const navigation = useNavigation();

  return (
    <Pressable
      testID="top-level-back-button"
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      hitSlop={8}
      onPress={() => {
        if (navigation.canGoBack()) {
          router.back();
          return;
        }

        router.replace(href as never);
      }}
      style={styles.backButton}
    >
      <SFIcon name="chevron.left" size={16} color={lightPalette.info.main} />
      <Text style={styles.backLabel}>{label}</Text>
    </Pressable>
  );
}

export function createTopLevelTabHeader(
  title: string,
  actions: TopLevelHeaderAction[] = [],
  /** Set on tab roots that have no tab button, so they can be left. */
  back?: { label: string; href: string },
) {
  const sideWidth =
    actions.length === 0
      ? 0
      : actions.length * headerActionSize +
        (actions.length - 1) * headerActionGap +
        headerActionInset;

  return {
    title,
    headerTitleAlign: "center" as const,
    headerTitle: () => <HeaderTitleWithStreamStatus title={title} />,
    headerLeft: () =>
      back ? (
        <TopLevelBackButton label={back.label} href={back.href} />
      ) : (
        <View style={{ width: sideWidth }} />
      ),
    headerRight: () =>
      actions.length > 0 ? <HeaderActionRow actions={actions} /> : null,
  };
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: 220,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 13,
  },
  title: {
    fontSize: mobileTypography.sectionHeader.fontSize as number,
    fontWeight: "700",
    color: lightPalette.text.primary,
    lineHeight: 24,
    flexShrink: 1,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: headerActionGap,
    paddingRight: headerActionInset,
  },
  actionButton: {
    width: headerActionSize,
    height: headerActionSize,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
    paddingLeft: headerActionInset,
    minHeight: headerActionSize,
  },
  backLabel: {
    color: lightPalette.info.main,
    fontSize: mobileTypography.listPrimary.fontSize,
    fontWeight: "600",
  },
});
