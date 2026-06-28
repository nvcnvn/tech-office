'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Box, CircularProgress, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { getDownloadUrl } from 'apis';

interface VoiceMessagePlayerProps {
	fileId: string;
	durationMs?: number | bigint | string | null;
	waveformPeaks?: number[] | null;
}

const NEUTRAL_WAVEFORM_PEAKS = Array.from({ length: 24 }, () => 0.18);

function durationMsToSeconds(value: VoiceMessagePlayerProps['durationMs']): number {
	if (value === null || value === undefined || value === '') {
		return 0;
	}
	const durationNumber = typeof value === 'bigint' ? Number(value) : Number(value);
	return Number.isFinite(durationNumber) && durationNumber > 0 ? durationNumber / 1000 : 0;
}

function normalizeWaveformPeaks(peaks?: number[] | null): number[] {
	const usablePeaks = peaks?.filter((peak) => Number.isFinite(peak)) ?? [];
	if (!usablePeaks.length) {
		return NEUTRAL_WAVEFORM_PEAKS;
	}
	return usablePeaks.slice(0, 48).map((peak) => Math.min(Math.max(peak, 0.12), 1));
}

function formatPlaybackTime(totalSeconds: number): string {
	const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
	const minutes = Math.floor(safeSeconds / 60);
	const seconds = safeSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function VoiceMessagePlayer({ fileId, durationMs, waveformPeaks }: VoiceMessagePlayerProps) {
	const theme = useTheme();
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [loadedDuration, setLoadedDuration] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const metadataDuration = durationMsToSeconds(durationMs);
	const duration = loadedDuration > 0 ? loadedDuration : metadataDuration;
	const progress = duration > 0 ? Math.min(Math.max(currentTime / duration, 0), 1) : 0;
	const remainingTime = duration > 0 ? Math.max(duration - currentTime, 0) : 0;
	const resolvedWaveformPeaks = useMemo(() => normalizeWaveformPeaks(waveformPeaks), [waveformPeaks]);

	useEffect(() => {
		return () => {
			audioRef.current?.pause();
			audioRef.current = null;
		};
	}, []);

	function bindAudioElement(audio: HTMLAudioElement) {
		audio.onloadedmetadata = () => {
			setLoadedDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
		};
		audio.ontimeupdate = () => {
			setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
		};
		audio.onplay = () => setIsPlaying(true);
		audio.onpause = () => setIsPlaying(false);
		audio.onended = () => {
			setIsPlaying(false);
			setCurrentTime(0);
		};
		audio.onerror = () => {
			setIsPlaying(false);
			setError('Playback unavailable');
		};
	}

	const handleToggle = async () => {
		setError(null);
		try {
			let playableUrl = downloadUrl;
			if (!playableUrl) {
				setIsLoading(true);
				const result = await getDownloadUrl(fileId);
				playableUrl = result.downloadUrl;
				setDownloadUrl(playableUrl);
			}
			if (!audioRef.current) {
				audioRef.current = new Audio(playableUrl);
				bindAudioElement(audioRef.current);
			}
			if (isPlaying) {
				audioRef.current.pause();
			} else {
				if (duration > 0 && audioRef.current.currentTime >= duration - 0.25) {
					audioRef.current.currentTime = 0;
				}
				await audioRef.current.play();
			}
		} catch {
			setError('Playback unavailable');
		} finally {
			setIsLoading(false);
		}
	};

	const handleSeek = (event: MouseEvent<HTMLDivElement>) => {
		if (!audioRef.current || duration <= 0 || isLoading) {
			return;
		}
		const bounds = event.currentTarget.getBoundingClientRect();
		const nextRatio = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
		audioRef.current.currentTime = nextRatio * duration;
		setCurrentTime(audioRef.current.currentTime);
	};

	const statusText = error ?? (isLoading
		? 'Loading voice message'
		: isPlaying
			? 'Playing voice message'
			: currentTime > 0
				? 'Paused voice message'
				: 'Voice message');

	return (
		<Box
			data-testid="voice-message-player"
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 1,
				mt: 0.75,
				px: 1.25,
				py: 0.85,
				width: 'min(360px, 100%)',
				borderRadius: 1,
				border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
				bgcolor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
			}}
		>
			<Tooltip title={isPlaying ? 'Pause voice message' : 'Play voice message'}>
				<span>
					<IconButton size="small" disabled={isLoading} onClick={() => { void handleToggle(); }} data-testid="voice-message-play-button">
						{isLoading ? <CircularProgress size={18} /> : isPlaying ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
					</IconButton>
				</span>
			</Tooltip>
			<VolumeUpIcon fontSize="small" sx={{ color: 'text.secondary' }} />
			<Box sx={{ flex: 1, minWidth: 0 }}>
				<Typography variant="caption" sx={{ display: 'block', color: error ? 'error.main' : 'text.secondary' }}>
					{statusText}
				</Typography>
				<Box
					role={audioRef.current && duration > 0 ? 'button' : undefined}
					aria-label={audioRef.current && duration > 0 ? 'Seek voice message' : undefined}
					onClick={handleSeek}
					sx={{
						mt: 0.5,
						height: 24,
						px: 1,
						borderRadius: 999,
						bgcolor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.18 : 0.1),
						display: 'flex',
						alignItems: 'center',
						gap: 0.25,
						cursor: audioRef.current && duration > 0 ? 'pointer' : 'default',
					}}
				>
					{resolvedWaveformPeaks.map((peak, index) => {
						const barProgress = resolvedWaveformPeaks.length <= 1 ? 1 : index / (resolvedWaveformPeaks.length - 1);
						return (
							<Box
								key={`voice-peak-${index}`}
								sx={{
									flex: 1,
									minWidth: 2,
									maxWidth: 5,
									height: 4 + peak * 16,
									borderRadius: 999,
									bgcolor: barProgress <= progress ? 'primary.main' : alpha(theme.palette.primary.main, 0.28),
								}}
							/>
						);
					})}
				</Box>
				<Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
					<Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
						{formatPlaybackTime(currentTime)}
					</Typography>
					<Typography variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
						{duration > 0 ? `-${formatPlaybackTime(remainingTime)}` : '--:--'}
					</Typography>
				</Box>
			</Box>
		</Box>
	);
}