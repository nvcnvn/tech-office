'use client';

import { Alert, Box, Button, Chip, Typography } from '@mui/material';
import CallIcon from '@mui/icons-material/Call';
import GroupIcon from '@mui/icons-material/Group';
import type { UseVoiceCallResult } from '../../hooks/useVoiceCall';

interface VoiceCallAnnouncementProps {
  voiceCall: UseVoiceCallResult;
}

function labelForState(state: UseVoiceCallResult['state']): string {
  switch (state) {
    case 'ringing':
      return 'Ringing voice call';
    case 'active':
      return 'Active voice call';
    case 'ending':
      return 'Ending voice call';
    default:
      return 'Voice call';
  }
}

export function VoiceCallAnnouncement({ voiceCall }: VoiceCallAnnouncementProps) {
  // Only show for users who have not yet joined the call.
  // When the user IS in the call (canLeave = true) the VoiceCallBar handles
  // the active-call controls, so this announcement is redundant and confusing.
  if (!voiceCall.call || voiceCall.state === 'ended' || voiceCall.canLeave) {
    return null;
  }

  const participantCount = voiceCall.call.participantCount;

  return (
    <Box data-testid="voice-call-announcement">
      {voiceCall.error && (
        <Alert severity="error" sx={{ mx: 2, mt: 1.5, mb: 0.5 }}>
          {voiceCall.error.message}
        </Alert>
      )}
      <Box
        sx={{
          mx: 2,
          mt: voiceCall.error ? 0.5 : 1.5,
          mb: 1,
          px: 1.5,
          py: 1.25,
          border: 2,
          borderColor: 'success.main',
          borderRadius: 1,
          bgcolor: 'success.50',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <CallIcon color="success" fontSize="small" />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} noWrap>
              {labelForState(voiceCall.state)}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {voiceCall.isLoading ? 'Connecting…' : 'Tap Join to enter the call'}
            </Typography>
          </Box>
          <Chip
            icon={<GroupIcon />}
            label={`${participantCount} participant${participantCount === 1 ? '' : 's'}`}
            size="small"
            variant="outlined"
          />
        </Box>
        {voiceCall.canJoin && (
          <Button
            data-testid="voice-announcement-join-button"
            variant="contained"
            size="small"
            startIcon={<CallIcon />}
            disabled={voiceCall.isLoading}
            onClick={() => { void voiceCall.joinCall(); }}
            sx={{ flexShrink: 0 }}
          >
            Join
          </Button>
        )}
      </Box>
    </Box>
  );
}