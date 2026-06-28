import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { getDownloadUrl } from "apis";
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

interface VoiceMessagePlayerProps {
  fileId: string;
  maxWidth?: number;
}

function formatPlaybackTime(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function VoiceMessagePlayer({ fileId, maxWidth = 320 }: VoiceMessagePlayerProps) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressTrackWidth, setProgressTrackWidth] = useState(0);
  const hasLoadedRef = useRef(false);

  const duration = Number.isFinite(status.duration) ? Math.max(status.duration, 0) : 0;
  const currentTime = Number.isFinite(status.currentTime)
    ? Math.min(Math.max(status.currentTime, 0), duration > 0 ? duration : status.currentTime)
    : 0;
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const remainingTime = duration > 0 ? Math.max(duration - currentTime, 0) : 0;
  const canSeek = hasLoadedRef.current && duration > 0 && progressTrackWidth > 0 && !loading;
  const progressThumbLeft = progressTrackWidth > 0
    ? Math.min(Math.max(progress * progressTrackWidth - 5, 1), Math.max(progressTrackWidth - 9, 1))
    : 1;
  const statusText = error
    ?? (loading
      ? "Loading voice message"
      : status.playing
        ? "Playing voice message"
        : status.didJustFinish
          ? "Replay voice message"
          : currentTime > 0
            ? "Paused voice message"
            : "Voice message");

  useEffect(() => {
    return () => {
      if (hasLoadedRef.current) {
        try {
          player.pause();
        } catch {
          // Native player may already be deallocated when the component unmounts
        }
      }
    };
  }, [player]);

  async function togglePlayback() {
    setError(null);
    try {
      let playableUrl = downloadUrl;
      if (!playableUrl) {
        setLoading(true);
        const result = await getDownloadUrl(fileId);
        playableUrl = result.downloadUrl;
        setDownloadUrl(playableUrl);
        player.replace({ uri: playableUrl });
        hasLoadedRef.current = true;
      }
      if (status.playing) {
        player.pause();
      } else {
        if (status.didJustFinish || (duration > 0 && currentTime >= duration - 0.25)) {
          await player.seekTo(0);
        }
        player.play();
      }
    } catch {
      setError("Playback unavailable");
    } finally {
      setLoading(false);
    }
  }

  async function seekPlayback(event: GestureResponderEvent) {
    if (!canSeek) {
      return;
    }
    setError(null);
    try {
      const nextRatio = Math.min(Math.max(event.nativeEvent.locationX / progressTrackWidth, 0), 1);
      await player.seekTo(nextRatio * duration);
    } catch {
      setError("Playback unavailable");
    }
  }

  return (
    <View testID="voice-message-player" style={[styles.wrap, { maxWidth }]}>
      <Pressable
        testID="voice-message-play-button"
        onPress={() => void togglePlayback()}
        disabled={loading}
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed, loading && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause voice message" : "Play voice message"}
      >
        {loading ? (
          <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
        ) : (
          <SFIcon
            name={status.playing ? "pause.fill" : "play.fill"}
            size={15}
            color={lightPalette.primary.contrastText}
          />
        )}
      </Pressable>
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.title, error && styles.errorText]}>
          {statusText}
        </Text>
        <Pressable
          testID="voice-message-progress-bar"
          onLayout={(event) => setProgressTrackWidth(event.nativeEvent.layout.width)}
          onPress={(event) => void seekPlayback(event)}
          disabled={!canSeek}
          style={({ pressed }) => [
            styles.progressTrack,
            !canSeek && styles.progressTrackDisabled,
            pressed && canSeek && styles.progressTrackPressed,
          ]}
          accessibilityRole={canSeek ? "button" : undefined}
          accessibilityLabel={canSeek ? "Seek voice message" : undefined}
        >
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.progressThumb, { left: progressThumbLeft }]} />
        </Pressable>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatPlaybackTime(currentTime)}</Text>
          <Text style={styles.timeText}>{duration > 0 ? `-${formatPlaybackTime(remainingTime)}` : "--:--"}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing[1],
    minHeight: 58,
    minWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: radius.lg,
    borderWidth: border.thin,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
  },
  playButton: {
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: touch.minTarget / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.main,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  title: {
    color: lightPalette.text.secondary,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700",
  },
  errorText: {
    color: lightPalette.error.main,
  },
  progressTrack: {
    height: 12,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#bfdbfe",
    justifyContent: "center",
  },
  progressTrackDisabled: {
    opacity: 0.72,
  },
  progressTrackPressed: {
    opacity: opacity.pressed,
  },
  progressFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 999,
    backgroundColor: lightPalette.primary.main,
  },
  progressThumb: {
    position: "absolute",
    top: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: lightPalette.background.paper,
    backgroundColor: lightPalette.primary.main,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  timeText: {
    color: lightPalette.text.secondary,
    fontSize: 11,
    fontWeight: "700",
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});