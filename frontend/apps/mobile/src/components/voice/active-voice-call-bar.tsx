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
  leaving?: boolean;
  onReturn: () => void;
  onLeave: () => void;
}

function connectionLabel(connectionState: VoiceClientConnectionState): string {
  switch (connectionState) {
    case "connecting":
      return "Connecting";
    case "reconnecting":
      return "Reconnecting";
    case "connected":
      return "In voice call";
    default:
      return "Voice call";
  }
}

export function ActiveVoiceCallBar({
  connectionState,
  isMuted,
  leaving = false,
  onReturn,
  onLeave,
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
            {connectionLabel(connectionState)}
          </Text>
          <Text style={[styles.subtitle, { color: palette.text.secondary }]} numberOfLines={1}>
            {isMuted ? "Microphone muted" : "Microphone on"} - Tap to return
          </Text>
        </View>
        {isBusy && !leaving ? (
          <ActivityIndicator size="small" color="#16a34a" />
        ) : null}
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
            styles.leaveButton,
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
  leaveButton: {
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