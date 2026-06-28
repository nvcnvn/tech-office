'use client';

import { Box, CircularProgress, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MicIcon from '@mui/icons-material/Mic';
import ReplayIcon from '@mui/icons-material/Replay';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import { useVoiceMessages } from '../../hooks/useVoiceMessages';

interface VoiceMessageRecorderProps {
	channelId?: string;
	disabled?: boolean;
	onSent?: () => void;
}

function formatDuration(durationMs: number): string {
	const seconds = Math.max(1, Math.round(durationMs / 1000));
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function RecorderWaveform({ peaks, active }: { peaks: number[]; active: boolean }) {
	const theme = useTheme();
	const bars = peaks.length ? peaks.slice(-32) : Array.from({ length: 32 }, () => 0.12);

	return (
		<Box
			aria-hidden
			sx={{
				height: 34,
				display: 'flex',
				alignItems: 'center',
				gap: 0.25,
				minWidth: 180,
				flex: 1,
			}}
		>
			{bars.map((peak, index) => {
				const height = 6 + Math.min(Math.max(peak, 0.12), 1) * 24;
				const isRecent = active && index >= bars.length - 6;
				return (
					<Box
						key={`recorder-wave-${index}-${peak.toFixed(2)}`}
						sx={{
							flex: 1,
							minWidth: 2,
							maxWidth: 5,
							height,
							borderRadius: 999,
							bgcolor: isRecent ? 'primary.main' : alpha(theme.palette.primary.main, 0.32),
							transition: 'height 120ms ease, background-color 120ms ease',
						}}
					/>
				);
			})}
		</Box>
	);
}

export default function VoiceMessageRecorder({ channelId, disabled = false, onSent }: VoiceMessageRecorderProps) {
	const theme = useTheme();
	const voiceMessage = useVoiceMessages(channelId, onSent);
	const actionDisabled = disabled || !channelId || voiceMessage.isBusy;

	if (voiceMessage.state === 'idle') {
		return (
			<Tooltip title="Record voice message">
				<span>
					<IconButton
						size="small"
						disabled={actionDisabled}
						onClick={() => { void voiceMessage.startRecording(); }}
						data-testid="voice-message-record-button"
					>
						<MicIcon fontSize="small" />
					</IconButton>
				</span>
			</Tooltip>
		);
	}

	const isFailed = voiceMessage.state === 'failed';
	const canSend = Boolean(voiceMessage.recording) && !voiceMessage.isBusy;
	const durationLabel = formatDuration(voiceMessage.recording?.durationMs ?? voiceMessage.elapsedMs);
	const title = voiceMessage.isRecording
		? 'Recording'
		: voiceMessage.isBusy
			? 'Sending'
			: isFailed
				? 'Send failed'
				: 'Voice message';

	return (
		<Box
			data-testid="voice-message-recorder"
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 1,
				px: 1.25,
				py: 0.75,
				borderRadius: 1,
				border: `1px solid ${alpha(theme.palette.primary.main, 0.22)}`,
				bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.06),
				width: 'min(520px, 100%)',
				minWidth: { xs: 0, sm: 280 },
			}}
		>
			<Box sx={{ flex: 1, minWidth: 0 }}>
				<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
						<Box
							sx={{
								width: 8,
								height: 8,
								borderRadius: '50%',
								bgcolor: isFailed ? 'error.main' : voiceMessage.isRecording ? 'error.main' : 'primary.main',
								opacity: voiceMessage.inputLevel === null ? 1 : 0.45 + voiceMessage.inputLevel * 0.55,
								boxShadow: voiceMessage.isRecording ? `0 0 0 4px ${alpha(theme.palette.error.main, 0.12)}` : 'none',
								flexShrink: 0,
							}}
						/>
						<Typography variant="caption" sx={{ color: isFailed ? 'error.main' : 'text.secondary', fontWeight: 700 }} noWrap>
							{title}
						</Typography>
					</Box>
					<Typography variant="caption" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
						{durationLabel}
					</Typography>
				</Box>
				<RecorderWaveform peaks={voiceMessage.recording?.waveformPeaks ?? voiceMessage.waveformPeaks} active={voiceMessage.isRecording} />
				{isFailed ? (
					<Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
						{voiceMessage.error ?? 'Voice message failed to send.'}
					</Typography>
				) : null}
			</Box>

			{voiceMessage.isRecording ? (
				<Tooltip title="Stop recording">
					<IconButton size="small" color="error" onClick={voiceMessage.stopRecording} data-testid="voice-message-stop-button">
						<StopIcon fontSize="small" />
					</IconButton>
				</Tooltip>
			) : isFailed ? (
				<Tooltip title="Retry voice message">
					<span>
						<IconButton size="small" disabled={!canSend} onClick={() => { void voiceMessage.retrySend(); }} data-testid="voice-message-retry-button">
							<ReplayIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
			) : (
				<Tooltip title="Send voice message">
					<span>
						<IconButton size="small" disabled={!canSend} onClick={() => { void voiceMessage.sendRecording(); }} data-testid="voice-message-send-button">
							{voiceMessage.isBusy ? <CircularProgress size={16} /> : <SendIcon fontSize="small" />}
						</IconButton>
					</span>
				</Tooltip>
			)}

			<Tooltip title="Cancel voice message">
				<span>
					<IconButton size="small" disabled={voiceMessage.isBusy} onClick={() => { void voiceMessage.cancelRecording(); }} data-testid="voice-message-cancel-button">
						<CloseIcon fontSize="small" />
					</IconButton>
				</span>
			</Tooltip>
		</Box>
	);
}