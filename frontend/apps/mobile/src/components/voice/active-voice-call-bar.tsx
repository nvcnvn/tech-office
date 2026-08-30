import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  getPalette,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";
import type { VoiceClientConnectionState } from "@/lib/voice/voice-client";

interface ActiveVoiceCallBarProps {
  connectionState: VoiceClientConnectionState;
  isMuted: boolean;
  remoteParticipantCount: number;
  leaving?: boolean;
  onReturn: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
}

function connectionLabel(
  connectionState: VoiceClientConnectionState,
  remoteParticipantCount: number,
): string {
  switch (connectionState) {
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "connected":
      // Connected to the room is not the same as connected to a person. A caller
      // alone in the room is still ringing the other side, and saying "in voice
      // call" there is what makes a declined call look as though it is running.
      return remoteParticipantCount > 0 ? "In voice call" : "Calling";
    default:
      return "Voice call";
  }
}

export function ActiveVoiceCallBar({
  connectionState,
  isMuted,
  remoteParticipantCount,
  leaving = false,
  onReturn,
  onLeave,
  onToggleMute,
}: ActiveVoiceCallBarProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const palette = getPalette(colorScheme === "dark" ? "dark" : "light");
  const isBusy =
    leaving ||
    connectionState === "connecting" ||
    connectionState === "reconnecting";

  return (
    <View
      testID="active-voice-call-bar"
      style={[
        styles.safeWrap,
        {
          paddingTop: Math.max(insets.top, spacing[2]),
          backgroundColor: palette.background.paper,
          borderBottomColor: palette.divider,
        },
      ]}
    >
      <Pressable
        onPress={onReturn}
        accessibilityRole="button"
        accessibilityLabel="Return to active voice call"
        style={({ pressed }) => [
          styles.bar,
          {
            backgroundColor: palette.mode === "dark" ? "rgba(34, 197, 94, 0.14)" : "#f0fdf4",
            borderColor: palette.mode === "dark" ? "rgba(74, 222, 128, 0.34)" : "#bbf7d0",
          },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.leadingIcon}>
          <SFIcon name="phone.fill" size={17} color="#16a34a" />
        </View>
        <View style={styles.textWrap}>
          <Text style={[styles.title, { color: palette.text.primary }]} numberOfLines={1}>
            {connectionLabel(connectionState, remoteParticipantCount)}
          </Text>
          <Text style={[styles.subtitle, { color: palette.text.secondary }]} numberOfLines={1}>
            {connectionState === "connected" && remoteParticipantCount === 0
              ? "Waiting for an answer - Tap to return"
              : `${isMuted ? "Microphone muted" : "Microphone on"} - Tap to return`}
          </Text>
        </View>
        {isBusy && !leaving ? (
          <ActivityIndicator size="small" color="#16a34a" />
        ) : null}
        {/*
          Mute has to be reachable here, not only from the system call screen. On a
          device the OS does not ring for there is no system call UI at all, so without
          this button the user cannot mute the call anywhere. voiceClient is the single
          owner of the state, and native-call.ts mirrors it into the OS call object, so
          both surfaces agree about whether the microphone is open.
        */}
        <Pressable
          testID="active-voice-call-mute-button"
          onPress={(event) => {
            event.stopPropagation();
            onToggleMute();
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: isMuted }}
          accessibilityLabel={isMuted ? "Unmute microphone" : "Mute microphone"}
          hitSlop={8}
          style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
        >
          <SFIcon
            name={isMuted ? "mic.slash.fill" : "mic.fill"}
            size={17}
            color={isMuted ? palette.error.main : palette.text.secondary}
          />
        </Pressable>
        <Pressable
          testID="active-voice-call-leave-button"
          onPress={(event) => {
            event.stopPropagation();
            onLeave();
          }}
          disabled={leaving}
          accessibilityRole="button"
          accessibilityLabel="Leave active voice call"
          hitSlop={8}
          style={({ pressed }) => [
            styles.roundButton,
            pressed && styles.pressed,
            leaving && styles.disabled,
          ]}
        >
          {leaving ? (
            <ActivityIndicator size="small" color={palette.text.secondary} />
          ) : (
            <SFIcon name="phone.down.fill" size={17} color={palette.error.main} />
          )}
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeWrap: {
    borderBottomWidth: border.thin,
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
  },
  bar: {
    minHeight: 52,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    borderWidth: border.thin,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  leadingIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dcfce7",
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: mobileTypography.listSecondary.fontSize,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: "600",
  },
  roundButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.78)",
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});