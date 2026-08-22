'use client';

import { useEffect, useMemo, useState } from 'react';
import { Box, Chip, Typography, alpha, useTheme } from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CallIcon from '@mui/icons-material/Call';
import GroupIcon from '@mui/icons-material/Group';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import { getCallRecord, type GetCallRecordResponse } from 'apis';
import { voice } from 'rpc';
import VoiceMessagePlayer from './VoiceMessagePlayer';
import { VoiceTranscriptPanel } from './VoiceTranscriptPanel';

type VoiceCallRecordData = NonNullable<GetCallRecordResponse['record']>;
type VoiceCallArtifact = VoiceCallRecordData['artifacts'][number];
export type VoiceCallOutcomeHint = 'completed' | 'answered' | 'missed' | 'declined' | 'cancelled';

export interface VoiceCallTimelineMetadata {
  callId?: string;
  outcome?: string;
  state?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number | string;
  participantCount?: number | string;
  recordingStatus?: string;
  transcriptStatus?: string;
}

interface VoiceCallRecordProps {
  label?: string;
  callId?: string;
  metadata?: VoiceCallTimelineMetadata | null;
  outcomeHint?: VoiceCallOutcomeHint;
}

const callRecordCache = new Map<string, VoiceCallRecordData | null>();

function timestampToDate(timestamp?: { seconds?: bigint | number | string; nanos?: number } | null): Date | null {
  if (!timestamp?.seconds) {
    return null;
  }
  const seconds = Number(timestamp.seconds);
  return new Date(seconds * 1000 + Math.floor((timestamp.nanos ?? 0) / 1_000_000));
}

function outcomeLabel(outcome: voice.VoiceCallOutcome | undefined, hint?: VoiceCallOutcomeHint): string {
  switch (outcome) {
    case voice.VoiceCallOutcome.ANSWERED:
    case voice.VoiceCallOutcome.COMPLETED:
      return 'Voice call ended';
    case voice.VoiceCallOutcome.MISSED:
      return 'Voice call missed';
    case voice.VoiceCallOutcome.DECLINED:
      return 'Voice call declined';
    case voice.VoiceCallOutcome.CANCELLED:
      return 'Voice call cancelled';
    default:
      if (hint === 'missed') return 'Voice call missed';
      if (hint === 'declined') return 'Voice call declined';
      if (hint === 'cancelled') return 'Voice call cancelled';
      return 'Voice call ended';
  }
}

function formatDuration(startedAt: Date | null, endedAt: Date | null): string | null {
  if (!startedAt || !endedAt) {
    return null;
  }
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatDurationMs(value?: number | string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const durationMs = Number(value);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const durationSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function parseMetadataDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function positiveInteger(value?: number | string): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function metadataOutcomeHint(outcome?: string): VoiceCallOutcomeHint | undefined {
  switch (outcome) {
    case 'answered':
    case 'completed':
    case 'missed':
    case 'declined':
    case 'cancelled':
      return outcome;
    default:
      return undefined;
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
      return hint === 'completed' || hint === 'answered';
  }
}

function artifactStatusLabel(artifact: VoiceCallArtifact): string {
  switch (artifact.status) {
    case voice.VoiceArtifactStatus.PENDING:
      return 'Recording pending';
    case voice.VoiceArtifactStatus.PROCESSING:
      return 'Recording processing';
    case voice.VoiceArtifactStatus.READY:
      return artifact.fileId ? 'Recording ready' : 'Recording unavailable';
    case voice.VoiceArtifactStatus.FAILED:
      return 'Recording failed';
    case voice.VoiceArtifactStatus.UNAVAILABLE:
      return 'Recording unavailable';
    default:
      return 'Recording unavailable';
  }
}

function statusLabel(status?: string): string | null {
  switch (status) {
    case 'pending':
      return 'Recording pending';
    case 'processing':
      return 'Recording processing';
    case 'failed':
      return 'Recording failed';
    case 'ready':
      return 'Recording ready';
    default:
      return null;
  }
}

function shouldShowRecordingStatus(artifact?: VoiceCallArtifact): artifact is VoiceCallArtifact {
  if (!artifact) {
    return false;
  }
  return artifact.status !== voice.VoiceArtifactStatus.READY || !artifact.fileId;
}

export function voiceCallOutcomeHintFromText(messageText: string): VoiceCallOutcomeHint | null {
  switch (messageText.trim()) {
    case 'Voice call ended':
      return 'completed';
    case 'Voice call missed':
      return 'missed';
    case 'Voice call declined':
      return 'declined';
    case 'Voice call cancelled':
      return 'cancelled';
    default:
      return null;
  }
}

export function VoiceCallRecord({ label = 'Voice call', callId, metadata, outcomeHint }: VoiceCallRecordProps) {
  const theme = useTheme();
  const resolvedCallId = callId ?? metadata?.callId;
  const effectiveOutcomeHint = outcomeHint ?? metadataOutcomeHint(metadata?.outcome);
  const [record, setRecord] = useState<VoiceCallRecordData | null>(() => resolvedCallId ? callRecordCache.get(resolvedCallId) ?? null : null);

  useEffect(() => {
    let cancelled = false;
    async function loadRecord() {
      if (!resolvedCallId) {
        setRecord(null);
        return;
      }
      if (callRecordCache.has(resolvedCallId)) {
        setRecord(callRecordCache.get(resolvedCallId) ?? null);
        return;
      }
      try {
        const response = await getCallRecord(resolvedCallId);
        const nextRecord = response.record ?? null;
        callRecordCache.set(resolvedCallId, nextRecord);
        if (!cancelled) {
          setRecord(nextRecord);
        }
      } catch {
        callRecordCache.set(resolvedCallId, null);
        if (!cancelled) {
          setRecord(null);
        }
      }
    }
    void loadRecord();
    return () => {
      cancelled = true;
    };
  }, [resolvedCallId]);

  const call = record?.call;
  const startedAt = timestampToDate(call?.startedAt);
  const endedAt = timestampToDate(call?.endedAt);
  const metadataStartedAt = parseMetadataDate(metadata?.startedAt);
  const metadataEndedAt = parseMetadataDate(metadata?.endedAt);
  const duration = formatDuration(startedAt, endedAt)
    ?? formatDurationMs(metadata?.durationMs)
    ?? formatDuration(metadataStartedAt, metadataEndedAt);
  const participantCount = call?.participants?.length ?? positiveInteger(metadata?.participantCount) ?? 1;
  const recording = useMemo(
    () => record?.artifacts.find((artifact) => artifact.type === voice.VoiceArtifactType.RECORDING),
    [record],
  );
  const transcript = useMemo(
    () => record?.artifacts.find((artifact) => artifact.type === voice.VoiceArtifactType.TRANSCRIPT),
    [record],
  );
  const participantLabel = `${participantCount || 1} participant${participantCount === 1 ? '' : 's'}`;
  const visibleDuration = shouldShowElapsedDuration(call?.outcome, effectiveOutcomeHint) ? duration : null;
  // FR-012: always say whether a recording exists. A ready artifact renders the
  // player instead of a status chip; anything else (including no artifact at all)
  // gets an explicit status.
  const recordingStatus = shouldShowRecordingStatus(recording)
    ? artifactStatusLabel(recording)
    : recording
      ? null
      : statusLabel(metadata?.recordingStatus) ?? 'Recording unavailable';
  const resolvedTitle = call ? outcomeLabel(call.outcome, effectiveOutcomeHint) : effectiveOutcomeHint ? outcomeLabel(undefined, effectiveOutcomeHint) : label;

  return (
    <Box
      data-testid="voice-call-record"
      sx={{
        mt: 0.75,
        p: 1.25,
        width: 'min(420px, 100%)',
        borderRadius: 1,
        border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
        bgcolor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
        display: 'grid',
        gap: 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
        <CallIcon fontSize="small" color="primary" sx={{ flexShrink: 0 }} />
        <Typography variant="body2" fontWeight={700} sx={{ minWidth: 140, flex: '1 1 150px' }} noWrap>
          {resolvedTitle}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', ml: { xs: 0, md: 'auto' } }}>
          {visibleDuration ? (
            <Chip size="small" variant="outlined" icon={<AccessTimeIcon />} label={visibleDuration} />
          ) : null}
          <Chip
            size="small"
            variant="outlined"
            icon={<GroupIcon />}
            label={participantLabel}
          />
          {recordingStatus ? (
            <Chip size="small" variant="outlined" icon={<GraphicEqIcon />} label={recordingStatus} />
          ) : null}
        </Box>
      </Box>

      {recording?.status === voice.VoiceArtifactStatus.READY && recording.fileId ? (
        <VoiceMessagePlayer fileId={recording.fileId} durationMs={recording.durationMs} />
      ) : null}
      <VoiceTranscriptPanel artifact={transcript} />
    </Box>
  );
}