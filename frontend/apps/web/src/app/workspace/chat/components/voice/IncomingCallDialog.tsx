'use client';

import { useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import CallIcon from '@mui/icons-material/Call';
import CallEndIcon from '@mui/icons-material/CallEnd';
import SwapCallsIcon from '@mui/icons-material/SwapCalls';

interface IncomingCallDialogProps {
  open: boolean;
  alreadyInAnotherCall?: boolean;
  isLoading?: boolean;
  onAccept: () => Promise<void> | void;
  onDecline: () => Promise<void> | void;
  onClose: () => void;
}

export function IncomingCallDialog({
  open,
  alreadyInAnotherCall = false,
  isLoading = false,
  onAccept,
  onDecline,
  onClose,
}: IncomingCallDialogProps) {
  const [pendingAction, setPendingAction] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runAction = async (action: 'accept' | 'decline') => {
    setPendingAction(action);
    setError(null);
    try {
      if (action === 'accept') {
        await onAccept();
      } else {
        await onDecline();
      }
      onClose();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '';
      // If the invitation was already responded to (stale notification replayed
      // from a previous session), close silently — there's nothing left to do.
      if (message.includes('already responded')) {
        onClose();
        return;
      }
      setError(message || 'Unable to respond to the call.');
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={pendingAction || isLoading ? undefined : onClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby="incoming-voice-call-title"
      data-testid="incoming-voice-call-dialog"
    >
      <DialogTitle id="incoming-voice-call-title" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CallIcon color="primary" fontSize="small" />
        Incoming voice call
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {alreadyInAnotherCall
              ? 'You are already connected to another voice call.'
              : 'Answer this call from the current conversation.'}
          </Typography>
          {alreadyInAnotherCall ? (
            <Alert severity="info" icon={<SwapCallsIcon fontSize="small" />}>
              Switch will move you into the incoming call. Stay keeps your current call active.
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          data-testid="incoming-voice-stay-button"
          startIcon={<CallEndIcon />}
          disabled={isLoading || Boolean(pendingAction)}
          onClick={() => { void runAction('decline'); }}
        >
          {alreadyInAnotherCall ? 'Stay' : 'Decline'}
        </Button>
        <Button
          data-testid="incoming-voice-accept-button"
          variant="contained"
          startIcon={alreadyInAnotherCall ? <SwapCallsIcon /> : <CallIcon />}
          disabled={isLoading || Boolean(pendingAction)}
          onClick={() => { void runAction('accept'); }}
        >
          {alreadyInAnotherCall ? 'Switch' : 'Answer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}