import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import Link from 'next/link';

import { docsLastReviewed, employeeGuideSections, getFeatureAnchor } from '../../content';
import { ScreenshotFigure } from '../../components/ScreenshotFigure';

export default function EmployeeGuidePage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Paper
        sx={{
          p: { xs: 2.5, md: 3.5 },
          borderRadius: 5,
          bgcolor: 'var(--docs-panel-strong)',
          border: '1px solid var(--docs-line)',
          boxShadow: '0 24px 60px rgba(23, 32, 44, 0.07)',
        }}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.15fr) minmax(280px, 0.85fr)' }, gap: 3 }}>
          <Box>
            <Chip label={`Reviewed ${docsLastReviewed}`} size="small" sx={{ mb: 2, bgcolor: 'var(--docs-accent-soft)', color: 'var(--docs-accent)' }} />
            <Typography variant="overline" sx={{ color: 'var(--docs-accent)', letterSpacing: '0.16em' }}>
              Daily Workflow
            </Typography>
            <Typography variant="h1" gutterBottom sx={{ mt: 1 }}>
              Employee Guide
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 760 }}>
              Use this guide to sign in, check notifications, choose the right chat space, manage schedule changes, complete tasks, submit evidence, and find shared work without guessing where to click next.
            </Typography>
          </Box>

          <Stack spacing={1.25}>
            {[
              { icon: <NotificationsActiveIcon color="inherit" />, title: 'Alerts', body: 'Start with notifications so nothing important is missed.' },
              { icon: <EventAvailableIcon color="inherit" />, title: 'Schedule', body: 'See meetings, shifts, invitations, resources, and booking links.' },
              { icon: <TaskAltIcon color="inherit" />, title: 'Tasks', body: 'Complete standard work and ritual evidence from task details.' },
              { icon: <ChatIcon color="inherit" />, title: 'Chat', body: 'Use channels, direct messages, files, voice messages, and calls.' },
            ].map((item) => (
              <Box
                key={item.title}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '48px minmax(0, 1fr)',
                  gap: 1.25,
                  alignItems: 'start',
                  p: 1.4,
                  borderRadius: 3,
                  bgcolor: 'rgba(255, 255, 255, 0.56)',
                  border: '1px solid var(--docs-line)',
                }}
              >
                <Box
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: 2.5,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'var(--docs-accent-soft)',
                    color: 'var(--docs-accent)',
                  }}
                >
                  {item.icon}
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'var(--docs-ink)' }}>{item.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.body}</Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>
      </Paper>

      <Stack spacing={2}>
        {employeeGuideSections.map((section, index) => (
          <Paper
            key={section.title}
            id={getFeatureAnchor(section.title)}
            sx={{
              p: { xs: 2.5, md: 3 },
              scrollMarginTop: 96,
              borderRadius: 4,
              bgcolor: 'rgba(255, 250, 242, 0.84)',
              border: '1px solid var(--docs-line)',
              boxShadow: '0 20px 50px rgba(23, 32, 44, 0.05)',
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <Chip label={index + 1} size="small" sx={{ bgcolor: 'var(--docs-accent-soft)', color: 'var(--docs-accent)' }} />
              <Typography variant="h3">{section.title}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" paragraph>{section.summary}</Typography>
            <Box sx={{ p: 1.5, borderRadius: 3, bgcolor: 'rgba(139, 77, 43, 0.08)', mb: 2 }}>
              <Typography variant="body2">{section.example}</Typography>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
              {section.tags.map((tag) => (
                <Chip key={tag} label={tag} size="small" variant="outlined" />
              ))}
            </Stack>
            <Divider sx={{ my: 2, borderColor: 'var(--docs-line)' }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: section.screenshot ? 'minmax(0, 1fr) 360px' : '1fr' }, gap: 3, alignItems: 'start' }}>
              <Box component="ol" sx={{ pl: 2.5, m: 0 }}>
                {section.steps.map((step) => (
                  <Typography component="li" variant="body2" key={step} sx={{ mb: 1 }}>{step}</Typography>
                ))}
              </Box>
              {section.screenshot && <ScreenshotFigure screenshot={section.screenshot} />}
            </Box>
            <Divider sx={{ my: 2, borderColor: 'var(--docs-line)' }} />
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
              <Typography variant="caption" color="text.secondary">Related features</Typography>
              {section.relatedFeatures.map((feature) => (
                <Button key={feature.href} component={Link} href={feature.href} size="small" variant="outlined">
                  {feature.label}
                </Button>
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
