'use client';

import { Alert, Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import CallIcon from '@mui/icons-material/Call';
import CallEndIcon from '@mui/icons-material/CallEnd';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import type { UseVoiceCallResult } from '../../hooks/useVoiceCall';

interface VoiceCallBarProps {
  voiceCall: UseVoiceCallResult;
}

function stateLabel(state: UseVoiceCallResult['state'], canJoin: boolean): string {
  if (canJoin) {
    // Make it obvious to the user that a call is waiting for them to join.
    return 'Voice call in progress — join now';
  }
  switch (state) {
    case 'ringing':
      return 'Ringing';
    case 'active':
      return 'Active';
    case 'ending':
      return 'Ending';
    case 'ended':
      return 'Ended';
    default:
      return 'Voice call';
  }
}

function qualityLabel(quality: UseVoiceCallResult['connectionQuality']): string {
  switch (quality) {
    case 'degraded':
      return 'Degraded connection';
    case 'good':
      return 'Good connection';
    default:
      return 'Quality unknown';
  }
}

export function VoiceCallBar({ voiceCall }: VoiceCallBarProps) {
  if (!voiceCall.call) {
    return null;
  }

  // When connected to the LiveKit room, show the live participant count.
  // Otherwise show the backend's API count which may lag slightly.
  const displayCount = voiceCall.isConnected
    ? voiceCall.connectedParticipantCount
    : voiceCall.call.participantCount;
  const participantText = `${displayCount} participant${displayCount === 1 ? '' : 's'}`;

  // When the user can join but hasn't yet, use a prominent green background so
  // the "incoming call" state is impossible to miss.
  const isIncomingState = voiceCall.canJoin;

  return (
    <Box data-testid="voice-call-bar">
      {voiceCall.error && (
        <Alert severity="error" sx={{ borderRadius: 0, py: 0.25, px: 2 }}>
          {voiceCall.error.message}
        </Alert>
      )}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          px: 2,
          py: isIncomingState ? 1.25 : 1,
          borderTop: 2,
          borderColor: isIncomingState ? 'success.main' : 'divider',
          bgcolor: isIncomingState ? 'success.50' : 'action.hover',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <CallIcon color={isIncomingState ? 'success' : 'primary'} fontSize={isIncomingState ? 'medium' : 'small'} />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              data-testid="voice-call-state"
              variant="body2"
              fontWeight={700}
              color={isIncomingState ? 'success.dark' : 'text.primary'}
              noWrap
            >
              {stateLabel(voiceCall.state, voiceCall.canJoin)}
            </Typography>
            <Typography variant="caption" color={isIncomingState ? 'success.main' : 'text.secondary'} noWrap>
              {participantText}
            </Typography>
          </Box>
          {(voiceCall.isConnected || voiceCall.connectionQuality !== 'unknown') && (
            <Chip
              data-testid="voice-quality-indicator"
              icon={<NetworkCheckIcon />}
              label={qualityLabel(voiceCall.connectionQuality)}
              color={voiceCall.connectionQuality === 'degraded' ? 'warning' : 'default'}
              size="small"
              variant="outlined"
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {voiceCall.isLoading && <CircularProgress size={18} />}
          {voiceCall.isAudioPlaybackBlocked && voiceCall.isConnected && (
            <Button
              data-testid="voice-enable-audio-button"
              variant="outlined"
              color="warning"
              size="small"
              startIcon={<VolumeUpIcon />}
              onClick={voiceCall.startAudio}
            >
              Enable audio
            </Button>
          )}
          {voiceCall.canJoin && (
            <Button
              data-testid="voice-join-call-button"
              variant="contained"
              color="success"
              size="medium"
              startIcon={<CallIcon />}
              disabled={voiceCall.isLoading}
              onClick={() => { void voiceCall.joinCall(); }}
            >
              Join call
            </Button>
          )}
          {voiceCall.canLeave && (
            <Button
              data-testid="voice-leave-call-button"
              variant="outlined"
              color="error"
              size="small"
              startIcon={<CallEndIcon />}
              disabled={voiceCall.isLoading}
              onClick={() => { void voiceCall.leaveCall(); }}
            >
              Leave
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
