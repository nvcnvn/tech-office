import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SFIcon } from "@/components/ui/sf-icon";
import type {
  MobileVoiceCallSummary,
  VoiceCallAction,
} from "@/hooks/channel-voice-call-state";

export type { MobileVoiceCallSummary };
import {
  border,
  lightPalette,
  mobileTypography,
  opacity,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";

interface VoiceCallBannerProps {
  call: MobileVoiceCallSummary | null;
  connectionState: string;
  connectionQuality: "unknown" | "good" | "degraded";
  isMuted?: boolean;
  joined?: boolean;
  /**
   * Which call action is in flight, or null. This was one boolean shared by five
   * actions, so starting a call greyed out the leave button of a different one.
   */
  pending?: VoiceCallAction | null;
  error?: string | null;
  onStart: () => void;
  onJoin: () => void;
  onLeave: () => void;
}

function stateLabel(
  state: MobileVoiceCallSummary["state"] | undefined,
): string {
  switch (state) {
    case "ringing":
      return "Ringing";
    case "active":
      return "Active";
    case "ending":
      return "Ending";
    default:
      return "Voice call";
  }
}

function qualityText(
  quality: VoiceCallBannerProps["connectionQuality"],
): string {
  switch (quality) {
    case "degraded":
      return "Degraded";
    case "good":
      return "Good";
    default:
      return "Ready";
  }
}

export function VoiceCallBanner({
  call,
  connectionState,
  connectionQuality,
  isMuted = false,
  joined = false,
  pending = null,
  error,
  onStart,
  onJoin,
  onLeave,
}: VoiceCallBannerProps) {
  // Any call action in flight blocks the others — firing two at once is what produced
  // the contorted guards this replaces — but only the action actually running spins.
  const busy = pending !== null;

  if (!call) {
    return (
      <View style={styles.startRow}>
        {error ? (
          <View testID="voice-call-error" style={styles.startErrorBox}>
            <Text style={styles.startErrorText}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          testID="voice-call-start-button"
          onPress={onStart}
          disabled={busy}
          style={({ pressed }) => [
            styles.startButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Start voice call"
        >
          {pending === "starting" ? (
            <ActivityIndicator
              size="small"
              color={lightPalette.primary.contrastText}
            />
          ) : (
            <SFIcon
              name="phone.fill"
              size={18}
              color={lightPalette.primary.contrastText}
            />
          )}
          <Text style={styles.startButtonText}>Start voice</Text>
        </Pressable>
      </View>
    );
  }

  const mediaConnected =
    connectionState === "connected" || connectionState === "reconnecting";
  const canLeave = joined || mediaConnected || connectionState === "connecting";

  return (
    <View testID="voice-call-banner" style={styles.banner}>
      <View style={styles.iconWrap}>
        <SFIcon name="phone.fill" size={18} color={lightPalette.primary.main} />
      </View>
      <View style={styles.bannerBody}>
        <Text style={styles.title} numberOfLines={1}>
          {stateLabel(call.state)} voice call
        </Text>
        <View style={styles.statusRow}>
          <View
            testID="voice-quality-indicator"
            style={[
              styles.qualityDot,
              connectionQuality === "degraded" && styles.qualityWarn,
            ]}
          />
          <Text style={styles.subtitle} numberOfLines={1}>
            {call.participantCount || 1} participant
            {call.participantCount === 1 ? "" : "s"} ·{" "}
            {mediaConnected ? "Connected" : joined ? "Joining" : "Not joined"} ·{" "}
            {qualityText(connectionQuality)}
            {isMuted && mediaConnected ? " · Muted" : ""}
          </Text>
        </View>
        {error ? (
          <Text style={styles.error} numberOfLines={1}>
            {error}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {canLeave ? (
          <Pressable
            testID="voice-call-leave-button"
            onPress={onLeave}
            disabled={busy}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Leave voice call"
          >
            {pending === "leaving" ? (
              <ActivityIndicator size="small" color={lightPalette.error.main} />
            ) : (
              <SFIcon
                name="phone.down.fill"
                size={18}
                color={lightPalette.error.main}
              />
            )}
          </Pressable>
        ) : (
          <Pressable
            testID="voice-call-join-button"
            onPress={onJoin}
            disabled={busy}
            style={({ pressed }) => [
              styles.joinButton,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Join voice call"
          >
            {pending === "joining" ? (
              <ActivityIndicator
                size="small"
                color={lightPalette.primary.contrastText}
              />
            ) : (
              <Text style={styles.joinButtonText}>Join</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  startRow: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    backgroundColor: lightPalette.background.paper,
  },
  startButton: {
    minHeight: touch.comfortable,
    borderRadius: radius.md,
    backgroundColor: lightPalette.primary.main,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  startButtonText: {
    color: lightPalette.primary.contrastText,
    fontSize: mobileTypography.button.fontSize,
    fontWeight: mobileTypography.button.fontWeight,
  },
  startErrorBox: {
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: border.thin,
    borderColor: lightPalette.error.main,
    backgroundColor: lightPalette.error.light,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  startErrorText: {
    color: lightPalette.error.dark,
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: "600",
  },
  banner: {
    minHeight: 52,
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
  bannerBody: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: lightPalette.text.primary,
    fontSize: mobileTypography.listSecondary.fontSize,
    fontWeight: "700",
  },
  subtitle: {
    flex: 1,
    color: lightPalette.text.secondary,
    fontSize: mobileTypography.caption.fontSize,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: 2,
  },
  error: {
    color: lightPalette.error.main,
    fontSize: mobileTypography.caption.fontSize,
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  qualityDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: lightPalette.success.main,
  },
  qualityWarn: {
    backgroundColor: lightPalette.warning.main,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.error.light,
  },
  joinButton: {
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.main,
  },
  joinButtonText: {
    color: lightPalette.primary.contrastText,
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
