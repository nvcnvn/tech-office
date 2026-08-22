'use client';

import { useState } from 'react';
import { Alert, Box, Button, Collapse, LinearProgress, Typography } from '@mui/material';
import ArticleIcon from '@mui/icons-material/Article';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { getDownloadUrl, type GetCallRecordResponse } from 'apis';
import { voice } from 'rpc';

type VoiceCallArtifact = NonNullable<GetCallRecordResponse['record']>['artifacts'][number];

interface VoiceTranscriptPanelProps {
  artifact?: VoiceCallArtifact;
}

function transcriptStatusLabel(artifact?: VoiceCallArtifact): string {
  if (!artifact) {
    return 'Transcript unavailable';
  }
  switch (artifact.status) {
    case voice.VoiceArtifactStatus.PENDING:
      return 'Transcript pending';
    case voice.VoiceArtifactStatus.PROCESSING:
      return 'Transcript processing';
    case voice.VoiceArtifactStatus.READY:
      return artifact.fileId ? 'Transcript ready' : 'Transcript unavailable';
    case voice.VoiceArtifactStatus.FAILED:
      return 'Transcript failed';
    case voice.VoiceArtifactStatus.UNAVAILABLE:
      return 'Transcript unavailable';
    default:
      return 'Transcript unavailable';
  }
}

export function VoiceTranscriptPanel({ artifact }: VoiceTranscriptPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = artifact?.status === voice.VoiceArtifactStatus.READY && Boolean(artifact.fileId);
  const pending = artifact?.status === voice.VoiceArtifactStatus.PENDING || artifact?.status === voice.VoiceArtifactStatus.PROCESSING;

  const fetchTranscript = async () => {
    if (!artifact?.fileId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getDownloadUrl(artifact.fileId);
      const response = await fetch(result.downloadUrl);
      if (!response.ok) {
        throw new Error('Transcript download failed.');
      }
      setText(await response.text());
      setExpanded(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Transcript unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const openTranscript = async () => {
    if (!artifact?.fileId) {
      return;
    }
    setError(null);
    try {
      const result = await getDownloadUrl(artifact.fileId);
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Transcript unavailable.');
    }
  };

  return (
    <Box data-testid="voice-transcript-panel" sx={{ display: 'grid', gap: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <ArticleIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {transcriptStatusLabel(artifact)}
        </Typography>
        {ready ? (
          <>
            <Button
              data-testid="voice-transcript-preview-button"
              size="small"
              startIcon={<VisibilityIcon />}
              disabled={loading}
              onClick={() => { void fetchTranscript(); }}
            >
              Preview
            </Button>
            <Button
              data-testid="voice-transcript-open-button"
              size="small"
              startIcon={<DownloadIcon />}
              disabled={loading}
              onClick={() => { void openTranscript(); }}
            >
              Open
            </Button>
          </>
        ) : null}
      </Box>
      {loading || pending ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Collapse in={expanded && Boolean(text)}>
        <Box
          sx={{
            mt: 0.5,
            p: 1,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'background.default',
            maxHeight: 180,
            overflow: 'auto',
          }}
        >
          <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap', m: 0, fontFamily: 'inherit' }}>
            {text}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
}