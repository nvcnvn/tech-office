import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SFIcon } from "@/components/ui/sf-icon";
import type { VoiceCallAction } from "@/hooks/channel-voice-call-state";
import {
  border,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

interface IncomingCallBannerProps {
  alreadyInAnotherCall?: boolean;
  /** Which call action is in flight, so only the button actually running spins. */
  pending?: VoiceCallAction | null;
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
  pending = null,
  title,
  description,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: IncomingCallBannerProps) {
  const { palette } = useTheme();
  const styles = useStyles();

  const busy = pending !== null;
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
        <SFIcon name="phone.fill" size={18} color={palette.primary.main} />
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
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={alreadyInAnotherCall ? "Stay in current call" : resolvedDeclineLabel}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed, busy && styles.disabled]}
        >
          {pending === "declining" ? (
            <ActivityIndicator size="small" color={palette.text.secondary} />
          ) : (
            <Text style={styles.secondaryText}>{resolvedDeclineLabel}</Text>
          )}
        </Pressable>
        <Pressable
          testID="incoming-voice-accept-button"
          onPress={onAccept}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={alreadyInAnotherCall ? "Switch to incoming call" : resolvedAcceptLabel}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
        >
          {pending === "answering" || pending === "joining" ? (
            <ActivityIndicator size="small" color={palette.primary.contrastText} />
          ) : (
            <Text style={styles.primaryText}>{resolvedAcceptLabel}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    minHeight: 56,
    paddingHorizontal: spacing[3],
    paddingVertical: 8,
    borderTopWidth: border.thin,
    borderColor: t.divider,
    backgroundColor: t.background.paper,
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
    backgroundColor: t.background.default,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: t.text.primary,
    fontSize: mobileTypography.listSecondary.fontSize,
    fontWeight: "700",
  },
  subtitle: {
    color: t.text.secondary,
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
    backgroundColor: t.primary.main,
  },
  primaryText: {
    color: t.primary.contrastText,
    fontSize: mobileTypography.buttonSm.fontSize,
    fontWeight: mobileTypography.button.fontWeight,
  },
  secondaryButton: {
    minHeight: 34,
    minWidth: 58,
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    borderWidth: border.thin,
    borderColor: t.divider,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.background.paper,
  },
  secondaryText: {
    color: t.text.primary,
    fontSize: mobileTypography.buttonSm.fontSize,
    fontWeight: mobileTypography.button.fontWeight,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
}));