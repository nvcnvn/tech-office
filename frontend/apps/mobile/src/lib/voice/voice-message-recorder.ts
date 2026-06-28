import { useCallback, useEffect, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import {
  RecordingPresets,
  type RecordingOptions,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import {
  cancelVoiceMessage,
  confirmVoiceMessageUpload,
  requestVoiceMessageUpload,
} from "apis";

type VoiceRecorderState = "idle" | "recording" | "preview" | "sending" | "failed";

interface PendingMobileVoiceRecording {
  uri: string;
  sizeBytes: number;
  durationMs: number;
  deduplicationKey: string;
  mimeType: string;
  waveformPeaks: number[];
  voiceMessageId?: string;
  fileId?: string;
}

interface FileInfoWithSize {
  exists: boolean;
  size?: number;
}

export interface UseMobileVoiceMessageRecorderResult {
  state: VoiceRecorderState;
  recording: PendingMobileVoiceRecording | null;
  error: string | null;
  elapsedMs: number;
  waveformPeaks: number[];
  inputLevel: number | null;
  isBusy: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  sendRecording: () => Promise<void>;
  retrySend: () => Promise<void>;
}

function createDeduplicationKey(): string {
  return `mobile-voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const WAVEFORM_PEAK_COUNT = 32;
const QUIET_PEAK = 0.12;
const EMPTY_WAVEFORM_PEAKS = Array.from({ length: WAVEFORM_PEAK_COUNT }, () => QUIET_PEAK);

const METERED_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

function clampPeak(value: number): number {
  return Number(Math.min(Math.max(value, QUIET_PEAK), 1).toFixed(2));
}

function meteringToPeak(metering: number | undefined): number | null {
  if (metering === undefined || !Number.isFinite(metering)) {
    return null;
  }

  if (metering <= 0) {
    const normalizedDb = Math.min(Math.max((metering + 60) / 60, 0), 1);
    return clampPeak(QUIET_PEAK + Math.pow(normalizedDb, 1.45) * (1 - QUIET_PEAK));
  }

  if (metering <= 1) {
    return clampPeak(QUIET_PEAK + metering * (1 - QUIET_PEAK));
  }

  return clampPeak(QUIET_PEAK + Math.min(metering / 100, 1) * (1 - QUIET_PEAK));
}

function listeningFallbackPeak(elapsedMs: number, sampleIndex: number): number {
  const phase = elapsedMs / 180 + sampleIndex * 0.8;
  return clampPeak(0.18 + Math.abs(Math.sin(phase)) * 0.24);
}

function summarizePeaks(samples: number[], targetCount = WAVEFORM_PEAK_COUNT): number[] {
  const usableSamples = samples.filter((sample) => Number.isFinite(sample));
  if (!usableSamples.length) {
    return EMPTY_WAVEFORM_PEAKS;
  }

  return Array.from({ length: targetCount }, (_, index) => {
    const start = Math.floor((index * usableSamples.length) / targetCount);
    const end = Math.max(start + 1, Math.ceil(((index + 1) * usableSamples.length) / targetCount));
    const bucket = usableSamples.slice(start, end);
    const peak = bucket.reduce((maxPeak, sample) => Math.max(maxPeak, sample), QUIET_PEAK);
    return clampPeak(peak);
  });
}

function livePeaks(samples: number[]): number[] {
  if (!samples.length) {
    return EMPTY_WAVEFORM_PEAKS;
  }
  const recentSamples = samples.slice(-WAVEFORM_PEAK_COUNT);
  return [
    ...Array.from({ length: WAVEFORM_PEAK_COUNT - recentSamples.length }, () => QUIET_PEAK),
    ...recentSamples.map(clampPeak),
  ];
}

async function fileSize(uri: string): Promise<number> {
  const info = (await FileSystem.getInfoAsync(uri)) as FileInfoWithSize;
  if (!info.exists || !info.size) {
    return 1;
  }
  return info.size;
}

export function useMobileVoiceMessageRecorder(
  channelId: string | undefined,
  onSent?: () => void,
): UseMobileVoiceMessageRecorderResult {
  const recorder = useAudioRecorder(METERED_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 125);
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [recording, setRecording] = useState<PendingMobileVoiceRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waveformPeaks, setWaveformPeaks] = useState<number[]>(EMPTY_WAVEFORM_PEAKS);
  const [inputLevel, setInputLevel] = useState<number | null>(null);
  const startedAtRef = useRef(0);
  const actualPeakSamplesRef = useRef<number[]>([]);
  const visualPeakSamplesRef = useRef<number[]>([]);

  useEffect(() => {
    if (state !== "recording") {
      return;
    }

    const elapsedMs = recorderState.durationMillis || Math.max(0, Date.now() - startedAtRef.current);
    const meteredPeak = meteringToPeak(recorderState.metering);
    const visualPeak = meteredPeak ?? listeningFallbackPeak(elapsedMs, visualPeakSamplesRef.current.length);

    if (meteredPeak !== null) {
      actualPeakSamplesRef.current = [...actualPeakSamplesRef.current, meteredPeak];
    }

    visualPeakSamplesRef.current = [...visualPeakSamplesRef.current, visualPeak];
    setInputLevel(meteredPeak);
    setWaveformPeaks(livePeaks(visualPeakSamplesRef.current));
  }, [recorderState.durationMillis, recorderState.metering, state]);

  const startRecording = useCallback(async () => {
    if (!channelId || state === "recording" || state === "sending") {
      return;
    }
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Microphone access is required.");
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(METERED_RECORDING_OPTIONS);
      actualPeakSamplesRef.current = [];
      visualPeakSamplesRef.current = [];
      setWaveformPeaks(EMPTY_WAVEFORM_PEAKS);
      setInputLevel(null);
      startedAtRef.current = Date.now();
      recorder.record();
      setRecording(null);
      setState("recording");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Recording could not start.");
      setState("failed");
    }
  }, [channelId, recorder, state]);

  const stopRecording = useCallback(async () => {
    if (state !== "recording") {
      return;
    }
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      if (!uri) {
        throw new Error("Recording file was not created.");
      }
      const sizeBytes = await fileSize(uri);
      const durationMs = Math.max(500, Math.round(recorderState.durationMillis || Date.now() - startedAtRef.current));
      const capturedPeaks = actualPeakSamplesRef.current.length > 0
        ? actualPeakSamplesRef.current
        : visualPeakSamplesRef.current;
      const recordingWaveformPeaks = summarizePeaks(capturedPeaks);
      setRecording({
        uri,
        sizeBytes,
        durationMs,
        deduplicationKey: createDeduplicationKey(),
        mimeType: "audio/mp4",
        waveformPeaks: recordingWaveformPeaks,
      });
      setWaveformPeaks(recordingWaveformPeaks);
      setInputLevel(null);
      setState("preview");
      setError(null);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Recording could not be saved.");
      setState("failed");
    }
  }, [recorder, recorderState.durationMillis, state]);

  const cancelRecording = useCallback(async () => {
    if (state === "recording") {
      await recorder.stop().catch(() => {});
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
    if (recording?.voiceMessageId) {
      await cancelVoiceMessage(recording.voiceMessageId).catch(() => {});
    }
    actualPeakSamplesRef.current = [];
    visualPeakSamplesRef.current = [];
    setWaveformPeaks(EMPTY_WAVEFORM_PEAKS);
    setInputLevel(null);
    setRecording(null);
    setState("idle");
    setError(null);
  }, [recorder, recording, state]);

  const sendRecording = useCallback(async () => {
    if (!channelId || !recording || state === "sending") {
      return;
    }
    setState("sending");
    setError(null);
    try {
      const upload = await requestVoiceMessageUpload({
        channelId,
        clientDeduplicationKey: recording.deduplicationKey,
        filename: `voice-message-${Date.now()}.m4a`,
        mimeType: recording.mimeType,
        sizeBytes: recording.sizeBytes,
        expectedDurationMs: recording.durationMs,
      });
      setRecording({ ...recording, voiceMessageId: upload.voiceMessageId, fileId: upload.fileId });
      const uploadResult = await FileSystem.uploadAsync(upload.uploadUrl, recording.uri, {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          "Content-Type": recording.mimeType,
        },
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error("Upload failed before confirmation.");
      }
      await confirmVoiceMessageUpload({
        voiceMessageId: upload.voiceMessageId,
        fileId: upload.fileId,
        clientDeduplicationKey: recording.deduplicationKey,
        durationMs: recording.durationMs,
        waveformPeaks: recording.waveformPeaks,
      });
      actualPeakSamplesRef.current = [];
      visualPeakSamplesRef.current = [];
      setWaveformPeaks(EMPTY_WAVEFORM_PEAKS);
      setInputLevel(null);
      setRecording(null);
      setState("idle");
      onSent?.();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Voice message failed to send.");
      setState("failed");
    }
  }, [channelId, onSent, recording, state]);

  return {
    state,
    recording,
    error,
    elapsedMs: recorderState.durationMillis || Math.max(0, Date.now() - startedAtRef.current),
    waveformPeaks,
    inputLevel,
    isBusy: state === "sending",
    startRecording,
    stopRecording,
    cancelRecording,
    sendRecording,
    retrySend: sendRecording,
  };
}