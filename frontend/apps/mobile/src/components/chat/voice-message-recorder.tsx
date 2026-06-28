import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SFIcon } from "@/components/ui/sf-icon";
import { useMobileVoiceMessageRecorder } from "@/lib/voice/voice-message-recorder";
import {
  border,
  lightPalette,
  mobileTypography,
  opacity,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";

interface VoiceMessageRecorderProps {
  channelId?: string;
  disabled?: boolean;
  onSent?: () => void;
  onActiveChange?: (active: boolean) => void;
  idleAccessory?: React.ReactNode;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function RecorderWaveform({ peaks, active }: { peaks: number[]; active: boolean }) {
  const bars = peaks.length ? peaks.slice(-32) : Array.from({ length: 32 }, () => 0.12);

  return (
    <View
      style={styles.waveform}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {bars.map((peak, index) => {
        const height = 6 + Math.min(Math.max(peak, 0.12), 1) * 24;
        const isRecent = active && index >= bars.length - 6;
        return (
          <View
            key={`${index}-${peak.toFixed(2)}`}
            style={[
              styles.waveformBar,
              { height },
              isRecent && styles.waveformBarRecent,
            ]}
          />
        );
      })}
    </View>
  );
}

export function VoiceMessageRecorder({
  channelId,
  disabled = false,
  onSent,
  onActiveChange,
  idleAccessory,
}: VoiceMessageRecorderProps) {
  const voiceMessage = useMobileVoiceMessageRecorder(channelId, onSent);
  const actionDisabled = disabled || !channelId || voiceMessage.isBusy;
  const isActive = voiceMessage.state !== "idle";

  useEffect(() => {
    onActiveChange?.(isActive);
  }, [isActive, onActiveChange]);

  useEffect(() => {
    return () => onActiveChange?.(false);
  }, [onActiveChange]);

  if (voiceMessage.state === "idle") {
    return (
      <View style={styles.idleActions}>
        <Pressable
          testID="voice-message-record-button"
          onPress={() => void voiceMessage.startRecording()}
          disabled={actionDisabled}
          style={({ pressed }) => [
            styles.roundButton,
            pressed && styles.pressed,
            actionDisabled && styles.disabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Record voice message"
        >
          <SFIcon name="mic.fill" size={18} color={lightPalette.primary.main} />
        </Pressable>
        {idleAccessory}
      </View>
    );
  }

  const durationLabel = formatDuration(voiceMessage.recording?.durationMs ?? voiceMessage.elapsedMs);
  const title = voiceMessage.state === "recording"
    ? "Recording"
    : voiceMessage.state === "sending"
      ? "Sending"
      : voiceMessage.state === "failed"
        ? "Send failed"
        : "Voice message";
  const detail = voiceMessage.state === "failed"
    ? voiceMessage.error ?? "Voice message failed"
    : durationLabel;

  return (
    <View testID="voice-message-recorder" style={styles.recorderWrap}>
      <View style={styles.recorderBody}>
        <View style={styles.recorderHeader}>
          <View style={styles.recorderStatusLabel}>
            <View
              style={[
                styles.statusDot,
                voiceMessage.state === "failed" && styles.statusDotError,
                voiceMessage.inputLevel !== null && { opacity: 0.55 + voiceMessage.inputLevel * 0.45 },
              ]}
            />
            <Text numberOfLines={1} style={styles.recorderTitle}>
              {title}
            </Text>
          </View>
          <Text numberOfLines={1} style={styles.recorderTime}>
            {durationLabel}
          </Text>
        </View>
        <RecorderWaveform
          peaks={voiceMessage.recording?.waveformPeaks ?? voiceMessage.waveformPeaks}
          active={voiceMessage.state === "recording"}
        />
        {voiceMessage.state === "failed" ? (
          <Text numberOfLines={2} style={styles.recorderDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={styles.recorderActions}>
      {voiceMessage.state === "recording" ? (
        <Pressable
          testID="voice-message-stop-button"
          onPress={() => void voiceMessage.stopRecording()}
          style={({ pressed }) => [styles.stopAction, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
        >
          <SFIcon name="stop.fill" size={15} color={lightPalette.primary.contrastText} />
        </Pressable>
      ) : voiceMessage.state === "failed" ? (
        <Pressable
          testID="voice-message-retry-button"
          onPress={() => void voiceMessage.retrySend()}
          disabled={!voiceMessage.recording || voiceMessage.isBusy}
          style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed, !voiceMessage.recording && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Retry voice message"
        >
          <SFIcon name="arrow.clockwise" size={15} color={lightPalette.primary.contrastText} />
        </Pressable>
      ) : (
        <Pressable
          testID="voice-message-send-button"
          onPress={() => void voiceMessage.sendRecording()}
          disabled={!voiceMessage.recording || voiceMessage.isBusy}
          style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed, !voiceMessage.recording && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Send voice message"
        >
          {voiceMessage.isBusy ? (
            <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
          ) : (
            <SFIcon name="paperplane.fill" size={15} color={lightPalette.primary.contrastText} />
          )}
        </Pressable>
      )}
      <Pressable
        testID="voice-message-cancel-button"
        onPress={() => void voiceMessage.cancelRecording()}
        disabled={voiceMessage.isBusy}
        style={({ pressed }) => [styles.cancelAction, pressed && styles.pressed, voiceMessage.isBusy && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel="Cancel voice message"
      >
        <SFIcon name="xmark" size={14} color={lightPalette.text.secondary} />
      </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  idleActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  roundButton: {
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: touch.minTarget / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.default,
  },
  recorderWrap: {
    flex: 1,
    minHeight: touch.minTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    padding: spacing[2],
    borderRadius: radius.lg,
    borderWidth: border.thin,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
  },
  recorderBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1],
  },
  recorderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  recorderStatusLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: lightPalette.primary.main,
  },
  statusDotError: {
    backgroundColor: lightPalette.error.main,
  },
  recorderTitle: {
    color: lightPalette.text.secondary,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700",
  },
  recorderTime: {
    color: lightPalette.text.primary,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "800",
  },
  recorderDetail: {
    color: lightPalette.error.dark,
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: 16,
  },
  waveform: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  waveformBar: {
    flex: 1,
    minWidth: 2,
    maxWidth: 5,
    borderRadius: 3,
    backgroundColor: "#93c5fd",
  },
  waveformBarRecent: {
    backgroundColor: lightPalette.primary.main,
  },
  recorderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  primaryAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.main,
  },
  stopAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.error.main,
  },
  cancelAction: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.paper,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});