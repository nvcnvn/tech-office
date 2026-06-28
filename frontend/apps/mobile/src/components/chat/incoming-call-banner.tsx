import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  lightPalette,
  mobileTypography,
  opacity,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";

interface IncomingCallBannerProps {
  alreadyInAnotherCall?: boolean;
  loading?: boolean;
  /** Override the title shown in the banner (default: "Incoming voice call") */
  title?: string;
  /** Override the subtitle / description text */
  description?: string;
  /** Override the primary (accept) button label */
  acceptLabel?: string;
  /** Override the secondary (decline) button label */
  declineLabel?: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function IncomingCallBanner({
  alreadyInAnotherCall = false,
  loading = false,
  title,
  description,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: IncomingCallBannerProps) {
  const resolvedTitle = title ?? "Incoming voice call";

  const resolvedDescription =
    description ??
    (alreadyInAnotherCall
      ? "Switch to answer, or stay in your current call."
      : "Answer from this conversation.");

  const resolvedAcceptLabel =
    acceptLabel ?? (alreadyInAnotherCall ? "Switch" : "Answer");
  const resolvedDeclineLabel =
    declineLabel ?? (alreadyInAnotherCall ? "Stay" : "Decline");

  return (
    <View testID="incoming-voice-call-banner" style={styles.banner}>
      <View style={styles.iconWrap}>
        <SFIcon name="phone.fill" size={18} color={lightPalette.primary.main} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {resolvedTitle}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {resolvedDescription}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          testID="incoming-voice-decline-button"
          onPress={onDecline}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={alreadyInAnotherCall ? "Stay in current call" : resolvedDeclineLabel}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, loading && styles.disabled]}
        >
          <Text style={styles.secondaryText}>{resolvedDeclineLabel}</Text>
        </Pressable>
        <Pressable
          testID="incoming-voice-accept-button"
          onPress={onAccept}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={alreadyInAnotherCall ? "Switch to incoming call" : resolvedAcceptLabel}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, loading && styles.disabled]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
          ) : (
            <Text style={styles.primaryText}>{resolvedAcceptLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 56,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    borderTopWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: lightPalette.text.primary,
    fontSize: mobileTypography.listSecondary.fontSize,
    fontWeight: "700",
  },
  subtitle: {
    color: lightPalette.text.secondary,
    fontSize: mobileTypography.caption.fontSize,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  primaryButton: {
    minHeight: 34,
    minWidth: 64,
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.main,
  },
  primaryText: {
    color: lightPalette.primary.contrastText,
    fontSize: mobileTypography.buttonSm.fontSize,
    fontWeight: mobileTypography.button.fontWeight,
  },
  secondaryButton: {
    minHeight: 34,
    minWidth: 58,
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.paper,
  },
  secondaryText: {
    color: lightPalette.text.primary,
    fontSize: mobileTypography.buttonSm.fontSize,
    fontWeight: mobileTypography.button.fontWeight,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});