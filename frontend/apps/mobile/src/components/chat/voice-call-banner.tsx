import React from "react";
import {
  ActivityIndicator,
  Pressable,
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
  mobileTypography,
  opacity,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

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
  onToggleMute: () => void;
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
  onToggleMute,
}: VoiceCallBannerProps) {
  const { palette } = useTheme();
  const styles = useStyles();

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
              color={palette.primary.contrastText}
            />
          ) : (
            <SFIcon
              name="phone.fill"
              size={18}
              color={palette.primary.contrastText}
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
        <SFIcon name="phone.fill" size={18} color={palette.primary.main} />
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
        {/*
          Mute belongs on this banner and not only on the system call screen: a device
          the OS does not ring for has no system call UI, so this is the only mute the
          user has. voiceClient owns the state and native-call.ts mirrors it into the OS
          call object, so the two surfaces cannot disagree.
        */}
        {mediaConnected ? (
          <Pressable
            testID="voice-call-mute-button"
            onPress={onToggleMute}
            accessibilityRole="button"
            accessibilityState={{ selected: isMuted }}
            accessibilityLabel={isMuted ? "Unmute microphone" : "Mute microphone"}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <SFIcon
              name={isMuted ? "mic.slash.fill" : "mic.fill"}
              size={18}
              color={isMuted ? palette.error.main : palette.text.secondary}
            />
          </Pressable>
        ) : null}
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
              <ActivityIndicator size="small" color={palette.error.main} />
            ) : (
              <SFIcon
                name="phone.down.fill"
                size={18}
                color={palette.error.main}
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
                color={palette.primary.contrastText}
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

const useStyles = makeStyles((t) => ({
  startRow: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    backgroundColor: t.background.paper,
  },
  startButton: {
    minHeight: touch.comfortable,
    borderRadius: radius.md,
    backgroundColor: t.primary.main,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
  },
  startButtonText: {
    color: t.primary.contrastText,
    fontSize: mobileTypography.button.fontSize,
    fontWeight: mobileTypography.button.fontWeight,
  },
  startErrorBox: {
    marginBottom: spacing[2],
    borderRadius: radius.md,
    borderWidth: border.thin,
    borderColor: t.error.main,
    backgroundColor: t.error.light,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  startErrorText: {
    color: t.error.dark,
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: "600",
  },
  banner: {
    minHeight: 52,
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
  bannerBody: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: t.text.primary,
    fontSize: mobileTypography.listSecondary.fontSize,
    fontWeight: "700",
  },
  subtitle: {
    flex: 1,
    color: t.text.secondary,
    fontSize: mobileTypography.caption.fontSize,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: 2,
  },
  error: {
    color: t.error.main,
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
    backgroundColor: t.success.main,
  },
  qualityWarn: {
    backgroundColor: t.warning.main,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.error.light,
  },
  joinButton: {
    minHeight: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.primary.main,
  },
  joinButtonText: {
    color: t.primary.contrastText,
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
