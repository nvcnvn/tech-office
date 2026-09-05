import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SFIcon } from "@/components/ui/sf-icon";
import { mobileTypography, shadows, type MobilePalette } from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

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

/**
 * The banner already varied by colour scheme before this feature, by branching on
 * `useColorScheme()` and spelling both halves of every colour by hand. Both halves
 * are exactly the notification-domain tokens, so the branch is gone: the palette
 * has already made the choice by the time this runs.
 */
function getBannerAccent(t: MobilePalette, kind: LiveNotificationBannerProps["kind"]) {
  if (kind === "chat-dm") {
    return {
      tint: t.notificationDomain.chat.bg,
      accent: t.notificationDomain.chat.icon,
      icon: "person.crop.circle.fill",
      label: "Direct message",
    } as const;
  }

  if (kind === "chat-thread") {
    return {
      tint: t.notificationDomain.calendar.bg,
      accent: t.notificationDomain.calendar.icon,
      icon: "text.bubble.fill",
      label: "Thread reply",
    } as const;
  }

  if (kind === "chat-channel") {
    return {
      tint: t.notificationDomain.tasks.bg,
      accent: t.notificationDomain.tasks.icon,
      icon: "bubble.left.and.bubble.right.fill",
      label: "Channel update",
    } as const;
  }

  return {
    tint: t.notificationDomain.chat.bg,
    accent: t.notificationDomain.chat.icon,
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
  const { palette } = useTheme();
  const styles = useStyles();

  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const accent = useMemo(() => getBannerAccent(palette, kind), [palette, kind]);
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
                        // The first chip is filled with the accent; the rest sit
                        // on the card.
                        color:
                          index === 0 ? palette.primary.contrastText : palette.text.primary,
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
                backgroundColor: pressed ? accent.tint : palette.background.default,
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

const useStyles = makeStyles(() => ({
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
    // The shadow tokens are mode-independent by design: on a dark surface this
    // one is invisible, and elevation is carried by the border instead (R5).
    shadowColor: shadows.lg.shadowColor,
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
}));