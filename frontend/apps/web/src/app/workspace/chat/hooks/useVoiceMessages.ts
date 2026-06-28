'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelVoiceMessage, confirmVoiceMessageUpload, requestVoiceMessageUpload } from 'apis';

type VoiceMessageState = 'idle' | 'recording' | 'preview' | 'sending' | 'failed';

interface PendingVoiceRecording {
	blob: Blob;
	deduplicationKey: string;
	durationMs: number;
	mimeType: string;
	waveformPeaks: number[];
	voiceMessageId?: string;
	fileId?: string;
}

interface VoiceTestWindow extends Window {
	__TECH_OFFICE_VOICE_TEST_BLOB__?: Blob;
}

interface AudioContextWindow extends Window {
	webkitAudioContext?: typeof AudioContext;
}

export interface UseVoiceMessagesResult {
	state: VoiceMessageState;
	recording: PendingVoiceRecording | null;
	error: string | null;
	elapsedMs: number;
	waveformPeaks: number[];
	inputLevel: number | null;
	isRecording: boolean;
	isBusy: boolean;
	startRecording: () => Promise<void>;
	stopRecording: () => void;
	cancelRecording: () => Promise<void>;
	sendRecording: () => Promise<void>;
	retrySend: () => Promise<void>;
}

function preferredMimeType(): string {
	const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
	if (typeof MediaRecorder === 'undefined') {
		return 'audio/webm';
	}
	return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? 'audio/webm';
}

function normalizedMimeType(mimeType: string): string {
	return mimeType.split(';')[0] || 'audio/webm';
}

function createDeduplicationKey(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
		return crypto.randomUUID();
	}
	return `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const WAVEFORM_PEAK_COUNT = 32;
const QUIET_PEAK = 0.12;
const EMPTY_WAVEFORM_PEAKS = Array.from({ length: WAVEFORM_PEAK_COUNT }, () => QUIET_PEAK);

function clampPeak(value: number): number {
	return Number(Math.min(Math.max(value, QUIET_PEAK), 1).toFixed(2));
}

function rmsToPeak(rms: number): number {
	return clampPeak(QUIET_PEAK + Math.min(rms * 3.4, 1) * (1 - QUIET_PEAK));
}

function listeningFallbackPeak(elapsedMs: number, sampleIndex: number): number {
	const phase = elapsedMs / 180 + sampleIndex * 0.8;
	return clampPeak(0.18 + Math.abs(Math.sin(phase)) * 0.22);
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
		return clampPeak(bucket.reduce((maxPeak, sample) => Math.max(maxPeak, sample), QUIET_PEAK));
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

function audioContextConstructor(): typeof AudioContext | null {
	if (typeof window === 'undefined') {
		return null;
	}
	return window.AudioContext ?? (window as AudioContextWindow).webkitAudioContext ?? null;
}

async function waveformPeaksFromBlob(blob: Blob, fallbackSamples: number[]): Promise<number[]> {
	const AudioContextConstructor = audioContextConstructor();
	if (!AudioContextConstructor || blob.size === 0) {
		return summarizePeaks(fallbackSamples);
	}

	const audioContext = new AudioContextConstructor();
	try {
		const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
		const rawPeaks = Array.from({ length: WAVEFORM_PEAK_COUNT }, (_, index) => {
			const start = Math.floor((index * audioBuffer.length) / WAVEFORM_PEAK_COUNT);
			const end = Math.max(start + 1, Math.ceil(((index + 1) * audioBuffer.length) / WAVEFORM_PEAK_COUNT));
			const stride = Math.max(1, Math.floor((end - start) / 600));
			let peak = 0;

			for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
				const channelData = audioBuffer.getChannelData(channel);
				for (let sampleIndex = start; sampleIndex < end; sampleIndex += stride) {
					peak = Math.max(peak, Math.abs(channelData[sampleIndex] ?? 0));
				}
			}

			return peak;
		});
		const maxPeak = Math.max(...rawPeaks, 0.01);
		return rawPeaks.map((peak) => clampPeak(QUIET_PEAK + Math.min(peak / maxPeak, 1) * (1 - QUIET_PEAK)));
	} catch {
		return summarizePeaks(fallbackSamples);
	} finally {
		void audioContext.close();
	}
}

export function useVoiceMessages(channelId: string | undefined, onSent?: () => void): UseVoiceMessagesResult {
	const [state, setState] = useState<VoiceMessageState>('idle');
	const [recording, setRecording] = useState<PendingVoiceRecording | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [elapsedMs, setElapsedMs] = useState(0);
	const [waveformPeaks, setWaveformPeaks] = useState<number[]>(EMPTY_WAVEFORM_PEAKS);
	const [inputLevel, setInputLevel] = useState<number | null>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const samplingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const startedAtRef = useRef<number>(0);
	const actualPeakSamplesRef = useRef<number[]>([]);
	const visualPeakSamplesRef = useRef<number[]>([]);
	const discardStopRef = useRef(false);

	const resetWaveformState = useCallback(() => {
		actualPeakSamplesRef.current = [];
		visualPeakSamplesRef.current = [];
		setElapsedMs(0);
		setInputLevel(null);
		setWaveformPeaks(EMPTY_WAVEFORM_PEAKS);
	}, []);

	const stopLevelSampling = useCallback(() => {
		if (samplingTimerRef.current) {
			clearInterval(samplingTimerRef.current);
			samplingTimerRef.current = null;
		}
		audioSourceRef.current?.disconnect();
		audioSourceRef.current = null;
		analyserRef.current?.disconnect();
		analyserRef.current = null;
		if (audioContextRef.current) {
			void audioContextRef.current.close();
			audioContextRef.current = null;
		}
	}, []);

	const startFallbackSampling = useCallback(() => {
		if (samplingTimerRef.current) {
			clearInterval(samplingTimerRef.current);
		}
		samplingTimerRef.current = setInterval(() => {
			const elapsed = Math.max(0, Date.now() - startedAtRef.current);
			const peak = listeningFallbackPeak(elapsed, visualPeakSamplesRef.current.length);
			visualPeakSamplesRef.current = [...visualPeakSamplesRef.current, peak].slice(-900);
			setElapsedMs(elapsed);
			setInputLevel(null);
			setWaveformPeaks(livePeaks(visualPeakSamplesRef.current));
		}, 125);
	}, []);

	const startLevelSampling = useCallback((stream?: MediaStream) => {
		stopLevelSampling();
		if (!stream) {
			startFallbackSampling();
			return;
		}

		const AudioContextConstructor = audioContextConstructor();
		if (!AudioContextConstructor) {
			startFallbackSampling();
			return;
		}

		const audioContext = new AudioContextConstructor();
		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 512;
		analyser.smoothingTimeConstant = 0.72;
		const source = audioContext.createMediaStreamSource(stream);
		source.connect(analyser);
		audioContextRef.current = audioContext;
		audioSourceRef.current = source;
		analyserRef.current = analyser;

		const samples = new Uint8Array(analyser.fftSize);
		samplingTimerRef.current = setInterval(() => {
			analyser.getByteTimeDomainData(samples);
			let sumSquares = 0;
			for (let index = 0; index < samples.length; index += 1) {
				const centeredSample = ((samples[index] ?? 128) - 128) / 128;
				sumSquares += centeredSample * centeredSample;
			}
			const peak = rmsToPeak(Math.sqrt(sumSquares / samples.length));
			actualPeakSamplesRef.current = [...actualPeakSamplesRef.current, peak].slice(-900);
			visualPeakSamplesRef.current = [...visualPeakSamplesRef.current, peak].slice(-900);
			setElapsedMs(Math.max(0, Date.now() - startedAtRef.current));
			setInputLevel(peak);
			setWaveformPeaks(livePeaks(visualPeakSamplesRef.current));
		}, 100);
	}, [startFallbackSampling, stopLevelSampling]);

	const finishRecording = useCallback(async (blob: Blob) => {
		const durationMs = Math.max(500, Date.now() - startedAtRef.current);
		const mimeType = normalizedMimeType(blob.type || preferredMimeType());
		const capturedPeaks = await waveformPeaksFromBlob(blob, actualPeakSamplesRef.current);
		setRecording({
			blob,
			deduplicationKey: createDeduplicationKey(),
			durationMs,
			mimeType,
			waveformPeaks: capturedPeaks,
		});
		setElapsedMs(durationMs);
		setWaveformPeaks(capturedPeaks);
		setInputLevel(null);
		setState('preview');
		setError(null);
	}, []);

	const startRecording = useCallback(async () => {
		if (!channelId || state === 'recording' || state === 'sending') {
			return;
		}
		setError(null);
		const testBlob = typeof window !== 'undefined'
			? (window as VoiceTestWindow).__TECH_OFFICE_VOICE_TEST_BLOB__
			: undefined;
		if (testBlob) {
			startedAtRef.current = Date.now();
			resetWaveformState();
			startLevelSampling();
			setState('recording');
			chunksRef.current = [testBlob];
			return;
		}
		if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
			setError('Voice recording is unavailable in this browser.');
			setState('failed');
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mimeType = preferredMimeType();
			const recorder = new MediaRecorder(stream, { mimeType });
			resetWaveformState();
			chunksRef.current = [];
			streamRef.current = stream;
			recorderRef.current = recorder;
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunksRef.current.push(event.data);
				}
			};
			recorder.onstop = () => {
				stopLevelSampling();
				stream.getTracks().forEach((track) => track.stop());
				streamRef.current = null;
				recorderRef.current = null;
				if (discardStopRef.current) {
					discardStopRef.current = false;
					chunksRef.current = [];
					return;
				}
				void finishRecording(new Blob(chunksRef.current, { type: normalizedMimeType(mimeType) }));
			};
			startedAtRef.current = Date.now();
			startLevelSampling(stream);
			recorder.start();
			setState('recording');
		} catch {
			setError('Microphone access was blocked.');
			setState('failed');
		}
	}, [channelId, finishRecording, resetWaveformState, startLevelSampling, state, stopLevelSampling]);

	const stopRecording = useCallback(() => {
		if (state !== 'recording') {
			return;
		}
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== 'inactive') {
			recorder.stop();
			return;
		}
		const blob = chunksRef.current[0] ?? new Blob(['voice-message'], { type: 'audio/webm' });
		stopLevelSampling();
		void finishRecording(blob);
	}, [finishRecording, state, stopLevelSampling]);

	const cancelRecording = useCallback(async () => {
		const activeRecorder = recorderRef.current;
		if (activeRecorder && activeRecorder.state !== 'inactive') {
			discardStopRef.current = true;
			activeRecorder.stop();
		}
		stopLevelSampling();
		streamRef.current?.getTracks().forEach((track) => track.stop());
		if (recording?.voiceMessageId) {
			await cancelVoiceMessage(recording.voiceMessageId);
		}
		chunksRef.current = [];
		resetWaveformState();
		setRecording(null);
		setState('idle');
		setError(null);
	}, [recording, resetWaveformState, stopLevelSampling]);

	const sendRecording = useCallback(async () => {
		if (!channelId || !recording || state === 'sending') {
			return;
		}
		setState('sending');
		setError(null);
		try {
			const upload = await requestVoiceMessageUpload({
				channelId,
				clientDeduplicationKey: recording.deduplicationKey,
				filename: `voice-message-${Date.now()}.${recording.mimeType.includes('ogg') ? 'ogg' : 'webm'}`,
				mimeType: recording.mimeType,
				sizeBytes: recording.blob.size,
				expectedDurationMs: recording.durationMs,
			});
			setRecording({ ...recording, voiceMessageId: upload.voiceMessageId, fileId: upload.fileId });
			const uploadResponse = await fetch(upload.uploadUrl, {
				method: 'PUT',
				headers: { 'Content-Type': recording.mimeType },
				body: recording.blob,
			});
			if (!uploadResponse.ok) {
				throw new Error('Upload failed');
			}
			await confirmVoiceMessageUpload({
				voiceMessageId: upload.voiceMessageId,
				fileId: upload.fileId,
				clientDeduplicationKey: recording.deduplicationKey,
				durationMs: recording.durationMs,
				waveformPeaks: recording.waveformPeaks,
			});
			resetWaveformState();
			setRecording(null);
			setState('idle');
			onSent?.();
		} catch (sendError) {
			setError(sendError instanceof Error ? sendError.message : 'Voice message failed to send.');
			setState('failed');
		}
	}, [channelId, onSent, recording, resetWaveformState, state]);

	useEffect(() => {
		return () => {
			stopLevelSampling();
			streamRef.current?.getTracks().forEach((track) => track.stop());
		};
	}, [stopLevelSampling]);

	return {
		state,
		recording,
		error,
		elapsedMs,
		waveformPeaks,
		inputLevel,
		isRecording: state === 'recording',
		isBusy: state === 'sending',
		startRecording,
		stopRecording,
		cancelRecording,
		sendRecording,
		retrySend: sendRecording,
	};
}