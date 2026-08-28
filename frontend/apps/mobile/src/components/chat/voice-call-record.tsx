import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { getCallRecord, getDownloadUrl, listCallRecords, type GetCallRecordResponse } from "apis";
import { voice } from "rpc";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  lightPalette,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";
import { VoiceMessagePlayer } from "./voice-message-player";

type VoiceCallRecordData = NonNullable<GetCallRecordResponse["record"]>;
type VoiceCallArtifact = VoiceCallRecordData["artifacts"][number];
export type VoiceCallOutcomeHint = "completed" | "answered" | "missed" | "declined" | "cancelled";

export interface VoiceCallEvent {
  label: string;
  outcomeHint?: VoiceCallOutcomeHint;
}

const VOICE_CALL_EVENT_MAP: Record<string, VoiceCallEvent> = {
  "Voice call started": { label: "Voice call started" },
  "Voice call ended": { label: "Voice call ended", outcomeHint: "completed" },
  "Voice call missed": { label: "Voice call missed", outcomeHint: "missed" },
  "Voice call declined": { label: "Voice call declined", outcomeHint: "declined" },
  "Voice call cancelled": { label: "Voice call cancelled", outcomeHint: "cancelled" },
  "Voice call unavailable": { label: "Voice call unavailable" },
  "Voice call access denied": { label: "Voice call access denied" },
};

interface VoiceCallRecordProps {
  label: string;
  /** The call this system message is about, from the message's own timeline metadata.
   *  Present on anything written by current code; absent on older messages, which still
   *  fall back to listing the channel's recent calls and matching on timestamp. */
  callId?: string;
  channelId?: string;
  messageTimestamp?: Date | null;
  outcomeHint?: VoiceCallOutcomeHint;
  maxWidth?: number;
}

function timestampToDate(timestamp?: { seconds?: bigint | number | string; nanos?: number } | null): Date | null {
  if (!timestamp?.seconds) {
    return null;
  }
  return new Date(Number(timestamp.seconds) * 1000 + Math.floor((timestamp.nanos ?? 0) / 1_000_000));
}

function expectedOutcome(hint?: VoiceCallOutcomeHint): voice.VoiceCallOutcome | null {
  switch (hint) {
    case "answered":
      return voice.VoiceCallOutcome.ANSWERED;
    case "completed":
      return voice.VoiceCallOutcome.COMPLETED;
    case "missed":
      return voice.VoiceCallOutcome.MISSED;
    case "declined":
      return voice.VoiceCallOutcome.DECLINED;
    case "cancelled":
      return voice.VoiceCallOutcome.CANCELLED;
    default:
      return null;
  }
}

function outcomeLabel(outcome: voice.VoiceCallOutcome | undefined, hint?: VoiceCallOutcomeHint): string {
  switch (outcome) {
    case voice.VoiceCallOutcome.ANSWERED:
    case voice.VoiceCallOutcome.COMPLETED:
      return "Voice call ended";
    case voice.VoiceCallOutcome.MISSED:
      return "Voice call missed";
    case voice.VoiceCallOutcome.DECLINED:
      return "Voice call declined";
    case voice.VoiceCallOutcome.CANCELLED:
      return "Voice call cancelled";
    default:
      if (hint === "missed") return "Voice call missed";
      if (hint === "declined") return "Voice call declined";
      if (hint === "cancelled") return "Voice call cancelled";
      return "Voice call ended";
  }
}

function shouldShowElapsedDuration(
  outcome: voice.VoiceCallOutcome | undefined,
  hint?: VoiceCallOutcomeHint,
): boolean {
  switch (outcome) {
    case voice.VoiceCallOutcome.ANSWERED:
    case voice.VoiceCallOutcome.COMPLETED:
      return true;
    case voice.VoiceCallOutcome.MISSED:
    case voice.VoiceCallOutcome.DECLINED:
    case voice.VoiceCallOutcome.CANCELLED:
      return false;
    default:
      return hint === "completed" || hint === "answered";
  }
}

function formatDuration(startedAt: Date | null, endedAt: Date | null): string | null {
  if (!startedAt || !endedAt) {
    return null;
  }
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function artifactStatusLabel(kind: "Recording" | "Transcript", artifact?: VoiceCallArtifact): string {
  if (!artifact) {
    return `${kind} not requested`;
  }
  switch (artifact.status) {
    case voice.VoiceArtifactStatus.PENDING:
      return `${kind} pending`;
    case voice.VoiceArtifactStatus.PROCESSING:
      return `${kind} processing`;
    case voice.VoiceArtifactStatus.READY:
      return artifact.fileId ? `${kind} ready` : `${kind} unavailable`;
    case voice.VoiceArtifactStatus.FAILED:
      return `${kind} failed`;
    case voice.VoiceArtifactStatus.UNAVAILABLE:
      return `${kind} unavailable`;
    default:
      return `${kind} unavailable`;
  }
}

function compactArtifactLabel(recording?: VoiceCallArtifact, transcript?: VoiceCallArtifact): string | null {
  switch (recording?.status) {
    case voice.VoiceArtifactStatus.PENDING:
      return "Recording pending";
    case voice.VoiceArtifactStatus.PROCESSING:
      return "Recording processing";
    case voice.VoiceArtifactStatus.FAILED:
      return "Recording failed";
    default:
      break;
  }

  switch (transcript?.status) {
    case voice.VoiceArtifactStatus.PENDING:
      return "Transcript pending";
    case voice.VoiceArtifactStatus.PROCESSING:
      return "Transcript processing";
    case voice.VoiceArtifactStatus.FAILED:
      return "Transcript failed";
    default:
      return null;
  }
}

function selectClosestRecord(
  records: VoiceCallRecordData[],
  messageTimestamp?: Date | null,
  outcomeHint?: VoiceCallOutcomeHint,
): VoiceCallRecordData | null {
  if (!records.length) {
    return null;
  }
  const wanted = expectedOutcome(outcomeHint);
  const matchingRecords = wanted
    ? records.filter(
        (record) =>
          record.call?.outcome === wanted ||
          (wanted === voice.VoiceCallOutcome.COMPLETED && record.call?.outcome === voice.VoiceCallOutcome.ANSWERED),
      )
    : records;
  const candidates = matchingRecords.length ? matchingRecords : records;
  if (!messageTimestamp) {
    return candidates[0] ?? null;
  }
  return [...candidates].sort((left, right) => {
    const leftEndedAt = timestampToDate(left.call?.endedAt)?.getTime() ?? 0;
    const rightEndedAt = timestampToDate(right.call?.endedAt)?.getTime() ?? 0;
    return Math.abs(leftEndedAt - messageTimestamp.getTime()) - Math.abs(rightEndedAt - messageTimestamp.getTime());
  })[0] ?? null;
}

export function voiceCallOutcomeHintFromText(messageText: string): VoiceCallOutcomeHint | null {
  return VOICE_CALL_EVENT_MAP[messageText.trim()]?.outcomeHint ?? null;
}

export function voiceCallEventFromText(messageText: string): VoiceCallEvent | null {
  return VOICE_CALL_EVENT_MAP[messageText.trim()] ?? null;
}

export function VoiceCallRecord({
  label,
  callId,
  channelId,
  messageTimestamp,
  outcomeHint,
  maxWidth = 320,
}: VoiceCallRecordProps) {
  const [record, setRecord] = useState<VoiceCallRecordData | null>(null);
  const shouldLoadRecord = Boolean(outcomeHint && (callId || channelId));
  const [loading, setLoading] = useState(shouldLoadRecord);
  // The list renders each row's timestamp as a fresh Date, so depending on the object
  // re-ran this effect on every render — which set state, which rendered again. One
  // voice-call message on screen was enough to put the backend under a few hundred
  // requests a minute. A number cannot churn that way.
  const messageTimestampMs = messageTimestamp?.getTime() ?? null;

  useEffect(() => {
    let cancelled = false;
    async function loadRecord() {
      if (!shouldLoadRecord) {
        setRecord(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        // The message names its own call, so fetch that one record. Listing the
        // channel's recent calls and picking the closest by timestamp is the fallback
        // for messages written before the id was recorded, not the normal path.
        const loaded = callId
          ? ((await getCallRecord(callId)).record ?? null)
          : selectClosestRecord(
              (await listCallRecords({ channelId: channelId!, limit: 12 })).records,
              messageTimestampMs === null ? null : new Date(messageTimestampMs),
              outcomeHint,
            );
        if (!cancelled) {
          setRecord(loaded);
        }
      } catch {
        if (!cancelled) {
          setRecord(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [callId, channelId, messageTimestampMs, outcomeHint, shouldLoadRecord]);

  const call = record?.call;
  const startedAt = timestampToDate(call?.startedAt);
  const endedAt = timestampToDate(call?.endedAt);
  const duration = formatDuration(startedAt, endedAt);
  const participantCount = call?.participants?.length ?? 0;
  const recording = useMemo(
    () => record?.artifacts.find((artifact) => artifact.type === voice.VoiceArtifactType.RECORDING),
    [record],
  );
  const transcript = useMemo(
    () => record?.artifacts.find((artifact) => artifact.type === voice.VoiceArtifactType.TRANSCRIPT),
    [record],
  );
  const participantLabel = `${participantCount || 1} participant${participantCount === 1 ? "" : "s"}`;
  const transcriptReady =
    transcript?.status === voice.VoiceArtifactStatus.READY && Boolean(transcript.fileId);
  const artifactSummary = compactArtifactLabel(recording, transcript);
  const summaryParts = [
    shouldShowElapsedDuration(call?.outcome, outcomeHint) ? duration : null,
    participantLabel,
  ].filter(Boolean);
  const recordSummary = shouldLoadRecord
    ? loading
      ? "Loading call details"
      : record
        ? summaryParts.join(" · ") || null
        : null
    : null;
  const resolvedTitle = call ? outcomeLabel(call.outcome, outcomeHint) : label;

  async function openTranscript() {
    if (!transcript?.fileId) {
      return;
    }
    const result = await getDownloadUrl(transcript.fileId);
    await Linking.openURL(result.downloadUrl);
  }

  return (
    <View testID="voice-call-record" style={[styles.card, { maxWidth }]}> 
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <SFIcon name="phone.fill" size={16} color={lightPalette.primary.main} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {resolvedTitle}
          </Text>
          {recordSummary ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {recordSummary}
            </Text>
          ) : null}
        </View>
      </View>
      {artifactSummary || transcriptReady ? (
        <View style={styles.metaRow}>
          {artifactSummary ? (
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText} numberOfLines={1}>
                {artifactSummary}
              </Text>
            </View>
          ) : null}
          {transcriptReady ? (
            <Pressable
              testID="voice-transcript-open-button"
              onPress={() => void openTranscript()}
              style={({ pressed }) => [styles.transcriptLink, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Open voice transcript"
            >
              <SFIcon name="doc.text" size={14} color={lightPalette.primary.main} />
              <Text style={styles.transcriptLinkText}>Transcript</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {recording?.status === voice.VoiceArtifactStatus.READY && recording.fileId ? (
        <VoiceMessagePlayer fileId={recording.fileId} maxWidth={maxWidth - 24} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "center",
    width: "100%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.lg,
    borderWidth: border.thin,
    borderColor: "#dbeafe",
    backgroundColor: "#f8fbff",
    gap: spacing[2],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.paper,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: "#1e3a8a",
    fontSize: mobileTypography.listSecondary.fontSize,
    fontWeight: "700",
  },
  subtitle: {
    color: lightPalette.text.secondary,
    fontSize: mobileTypography.caption.fontSize,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  statusPill: {
    minHeight: 24,
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e0f2fe",
  },
  statusPillText: {
    color: lightPalette.text.secondary,
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: "600",
  },
  transcriptLink: {
    minHeight: 28,
    paddingHorizontal: spacing[2],
    borderRadius: radius.full,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    backgroundColor: "#dbeafe",
  },
  transcriptLinkText: {
    color: lightPalette.primary.main,
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: "700",
  },
  pressed: {
    opacity: opacity.pressed,
  },
});