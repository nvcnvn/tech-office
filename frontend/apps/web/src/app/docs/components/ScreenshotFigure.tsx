'use client';

import { useState } from 'react';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  Typography,
} from '@mui/material';

import type { GuideScreenshot } from '../content';

interface ScreenshotFigureProps {
  screenshot: GuideScreenshot;
}

export function ScreenshotFigure({ screenshot }: ScreenshotFigureProps) {
  const [open, setOpen] = useState(false);

  return (
    <Box component="figure" sx={{ m: 0 }}>
      <Box
        sx={{
          position: 'relative',
          borderRadius: 2,
          overflow: 'hidden',
          border: '1px solid var(--docs-line)',
          bgcolor: '#fffdf7',
          boxShadow: '0 16px 34px rgba(15,23,42,0.08)',
        }}
      >
        <ButtonBase
          onClick={() => setOpen(true)}
          aria-label={`Zoom screenshot: ${screenshot.alt}`}
          sx={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            '&:hover img': {
              transform: 'scale(1.02)',
            },
          }}
        >
          <Box
            component="img"
            src={screenshot.src}
            alt={screenshot.alt}
            sx={{
              display: 'block',
              width: '100%',
              height: 'auto',
              bgcolor: 'background.default',
              transition: 'transform 220ms ease',
            }}
          />
          <Stack
            direction="row"
            spacing={0.75}
            alignItems="center"
            sx={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              px: 1,
              py: 0.75,
              borderRadius: 999,
              bgcolor: 'rgba(16, 23, 32, 0.84)',
              color: '#f7f8f4',
              backdropFilter: 'blur(6px)',
            }}
          >
            <ZoomInRoundedIcon fontSize="small" />
            <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700 }}>
              Zoom
            </Typography>
          </Stack>
        </ButtonBase>
      </Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        sx={{ mt: 1.25 }}
      >
        <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: 'block', pr: 1 }}>
          {screenshot.caption}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<ZoomInRoundedIcon />} onClick={() => setOpen(true)}>
            Zoom
          </Button>
          <Button
            size="small"
            variant="text"
            component="a"
            href={screenshot.src}
            target="_blank"
            rel="noreferrer"
            startIcon={<OpenInNewRoundedIcon />}
          >
            Open
          </Button>
        </Stack>
      </Stack>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="lg"
        PaperProps={{
          sx: {
            bgcolor: '#101720',
            color: '#f8fafc',
            borderRadius: 2,
            overflow: 'hidden',
          },
        }}
      >
        <DialogContent sx={{ p: { xs: 1.5, md: 2.5 }, bgcolor: '#101720' }}>
          <Box
            component="img"
            src={screenshot.src}
            alt={screenshot.alt}
            sx={{
              display: 'block',
              width: '100%',
              height: 'auto',
              maxHeight: '75vh',
              objectFit: 'contain',
              borderRadius: 2,
              border: '1px solid rgba(248,250,252,0.12)',
            }}
          />
          <Typography variant="body2" sx={{ mt: 1.5, color: 'rgba(248,250,252,0.78)' }}>
            {screenshot.caption}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2.25, pt: 0, justifyContent: 'space-between', bgcolor: '#101720' }}>
          <Button component="a" href={screenshot.src} target="_blank" rel="noreferrer" startIcon={<OpenInNewRoundedIcon />} sx={{ color: '#f8fafc' }}>
            Open in new tab
          </Button>
          <Button onClick={() => setOpen(false)} variant="contained" sx={{ bgcolor: '#f7f8f4', color: '#101720', '&:hover': { bgcolor: '#e7eadf' } }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
