import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SFIcon } from "@/components/ui/sf-icon";
import { getPalette, mobileTypography } from "@tech-office/theme-tokens";

interface LiveNotificationBannerProps {
  title: string;
  body: string;
  count: number;
  senderNames?: string[];
  kind?: "chat-channel" | "chat-thread" | "chat-dm" | "default";
  onPress: () => void;
  onDismiss: () => void;
}

function buildInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "?";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function getBannerAccent(kind: LiveNotificationBannerProps["kind"], isDark: boolean) {
  if (kind === "chat-dm") {
    return {
      tint: isDark ? "rgba(96, 165, 250, 0.15)" : "#eff6ff",
      accent: isDark ? "#60a5fa" : "#2563eb",
      icon: "person.crop.circle.fill",
      label: "Direct message",
    } as const;
  }

  if (kind === "chat-thread") {
    return {
      tint: isDark ? "rgba(251, 191, 36, 0.15)" : "#fffbeb",
      accent: isDark ? "#fbbf24" : "#d97706",
      icon: "text.bubble.fill",
      label: "Thread reply",
    } as const;
  }

  if (kind === "chat-channel") {
    return {
      tint: isDark ? "rgba(74, 222, 128, 0.15)" : "#f0fdf4",
      accent: isDark ? "#4ade80" : "#16a34a",
      icon: "bubble.left.and.bubble.right.fill",
      label: "Channel update",
    } as const;
  }

  return {
    tint: isDark ? "rgba(96, 165, 250, 0.15)" : "#eff6ff",
    accent: isDark ? "#60a5fa" : "#2563eb",
    icon: "bell.fill",
    label: "Live update",
  } as const;
}

export function LiveNotificationBanner({
  title,
  body,
  count,
  senderNames = [],
  kind = "default",
  onPress,
  onDismiss,
}: LiveNotificationBannerProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const palette = getPalette(colorScheme === "dark" ? "dark" : "light");
  const isDark = palette.mode === "dark";
  const accent = useMemo(() => getBannerAccent(kind, isDark), [isDark, kind]);
  const senderChipNames = senderNames.filter(Boolean).slice(0, 2);
  const extraSenderCount = Math.max(senderNames.length - senderChipNames.length, 0);

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 72,
        friction: 10,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      translateY.setValue(-120);
      opacity.setValue(0);
    };
  }, [opacity, title, translateY]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          opacity,
          paddingTop: insets.top + 10,
          transform: [{ translateY }],
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: palette.background.paper,
            borderColor: palette.divider,
            shadowColor: isDark ? "#000000" : "#0f172a",
          },
          pressed && styles.cardPressed,
        ]}
      >
        <View style={[styles.accentRail, { backgroundColor: accent.accent }]} />

        <View style={[styles.leadingWrap, { backgroundColor: accent.tint }]}> 
          {senderChipNames.length > 0 ? (
            <View style={styles.avatarStack}>
              {senderChipNames.map((name, index) => (
                <View
                  key={`${name}-${index}`}
                  style={[
                    styles.avatarChip,
                    {
                      backgroundColor: index === 0 ? accent.accent : palette.background.paper,
                      borderColor: palette.background.paper,
                      marginLeft: index === 0 ? 0 : -10,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.avatarChipText,
                      {
                        color:
                          index === 0
                            ? isDark && kind !== "default"
                              ? "rgba(0, 0, 0, 0.87)"
                              : "#ffffff"
                            : palette.text.primary,
                      },
                    ]}
                  >
                    {buildInitials(name)}
                  </Text>
                </View>
              ))}
              {extraSenderCount > 0 ? (
                <View
                  style={[
                    styles.extraAvatarChip,
                    {
                      backgroundColor: palette.background.paper,
                      borderColor: palette.divider,
                    },
                  ]}
                >
                  <Text
                    style={[styles.extraAvatarChipText, { color: palette.text.secondary }]}
                  >
                    +{extraSenderCount}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <SFIcon name={accent.icon} size={18} color={accent.accent} />
          )}
        </View>

        <View style={styles.textWrap}>
          <View style={styles.eyebrowRow}>
            <Text numberOfLines={1} style={[styles.eyebrow, { color: accent.accent }]}>
              {accent.label}
            </Text>
            {count > 1 ? (
              <View
                style={[
                  styles.countPill,
                  { backgroundColor: accent.tint, borderColor: accent.accent },
                ]}
              >
                <Text style={[styles.countText, { color: accent.accent }]}>{count}</Text>
              </View>
            ) : null}
          </View>

          <Text numberOfLines={1} style={[styles.title, { color: palette.text.primary }]}>
            {title}
          </Text>

          {!!body && (
            <Text numberOfLines={2} style={[styles.body, { color: palette.text.secondary }]}>
              {body}
            </Text>
          )}
        </View>

        <View style={styles.metaWrap}>
          <Pressable
            hitSlop={10}
            onPress={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
            style={({ pressed }) => [
              styles.dismissButton,
              {
                backgroundColor: pressed
                  ? accent.tint
                  : isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(17, 24, 39, 0.04)",
              },
            ]}
          >
            <SFIcon name="xmark" size={14} color={palette.text.secondary} />
          </Pressable>
          <SFIcon
            name="chevron.right"
            size={14}
            color={palette.text.disabled}
            style={styles.chevronIcon}
          />
          <Text style={[styles.tapHint, { color: palette.text.disabled }]}>Open</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1200,
    paddingHorizontal: 14,
  },
  card: {
    alignItems: "center",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 82,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
  },
  cardPressed: {
    opacity: 0.94,
  },
  accentRail: {
    alignSelf: "stretch",
    width: 4,
  },
  leadingWrap: {
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    paddingHorizontal: 8,
    width: 58,
  },
  avatarStack: {
    alignItems: "center",
    flexDirection: "row",
    paddingLeft: 4,
  },
  avatarChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1.5,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  avatarChipText: {
    fontSize: 9,
    fontWeight: "700",
  },
  extraAvatarChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 20,
    justifyContent: "center",
    marginLeft: -4,
    width: 20,
  },
  extraAvatarChipText: {
    fontSize: 9,
    fontWeight: "700",
  },
  textWrap: {
    flex: 1,
    gap: 3,
    paddingLeft: 12,
    paddingVertical: 14,
    paddingRight: 10,
  },
  eyebrowRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  eyebrow: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  title: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    lineHeight: 20,
    fontWeight: "700",
  },
  body: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 18,
  },
  metaWrap: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: 4,
    justifyContent: "center",
    paddingRight: 14,
    width: 56,
  },
  countPill: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 26,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    fontSize: mobileTypography.badge.fontSize as number,
    fontWeight: "700",
  },
  dismissButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  chevronIcon: {
    marginTop: 2,
  },
  tapHint: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600",
  },
});