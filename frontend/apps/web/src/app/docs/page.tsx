import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArticleIcon from '@mui/icons-material/Article';
import ExploreRoundedIcon from '@mui/icons-material/ExploreRounded';
import GroupsIcon from '@mui/icons-material/Groups';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import WorkspacesIcon from '@mui/icons-material/Workspaces';
import Link from 'next/link';

import { docsLastReviewed, docsScreenshots, productFeatures } from './content';
import { ScreenshotFigure } from './components/ScreenshotFigure';

export default function DocsLandingPage() {
  const availableCount = productFeatures.length;
  const allTags = Array.from(new Set(productFeatures.flatMap((feature) => feature.tags))).slice(0, 18);
  const docsMetrics = [
    { value: '2', label: 'role guides' },
    { value: availableCount.toString(), label: 'feature groups' },
    { value: '3', label: 'ways to use docs' },
    { value: allTags.length.toString(), label: 'shared tags' },
  ];
  const quickStartSteps = [
    {
      title: 'Start with the role that matches your job',
      detail: 'Choose the owner and IT admin guide for setup, or the employee guide for daily work.',
    },
    {
      title: 'Read the workflow card, then follow the screenshots',
      detail: 'Each guide section is written as a task with example language and image evidence from the real product.',
    },
    {
      title: 'Use Feature Reference only for lookup',
      detail: 'The reference page is the index of capabilities. It is not the best starting point for first-time onboarding.',
    },
  ];
  const docsModes = [
    {
      icon: <GroupsIcon color="inherit" />,
      title: 'Owner / IT Admin',
      body: 'Register the workspace, invite the team, set up departments, delegate permissions, create projects and rituals, and prepare communications.',
      href: '/docs/guides/owner',
      action: 'Open setup guide',
    },
    {
      icon: <WorkspacesIcon color="inherit" />,
      title: 'Employee',
      body: 'Sign in, check notifications, choose the right chat space, manage schedule changes, complete tasks, and submit evidence.',
      href: '/docs/guides/employee',
      action: 'Open daily guide',
    },
    {
      icon: <ArticleIcon color="inherit" />,
      title: 'Feature Reference',
      body: `Look up ${availableCount} current feature groups by capability, platform, status, and related task guide.`,
      href: '/docs/features',
      action: 'Open reference',
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <Paper
        sx={{
          p: { xs: 2.5, md: 4 },
          borderRadius: 0,
          bgcolor: 'var(--docs-panel-strong)',
          border: '1px solid var(--docs-line)',
          boxShadow: 'none',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.15fr) 390px' }, gap: 3, alignItems: 'start' }}>
          <Box>
            <Chip label={`Reviewed ${docsLastReviewed}`} size="small" variant="outlined" sx={{ mb: 2, bgcolor: '#eef6dc', borderColor: '#b8cf6a' }} />
            <Typography variant="overline" color="text.secondary">
              Start Here
            </Typography>
            <Typography variant="h1" gutterBottom sx={{ mt: 1, fontSize: { xs: '2.25rem', sm: '2.9rem', lg: '3.8rem' }, lineHeight: 0.96, fontWeight: 900, maxWidth: 820 }}>
              Read the docs the same way you use TechOffice: by workflow.
            </Typography>
            <Typography variant="h6" color="text.secondary" sx={{ mt: 2.5, maxWidth: 760, fontWeight: 500, lineHeight: 1.5 }}>
              Start with your role, follow the step-by-step tasks, then switch to Feature Reference only when you need a quick capability lookup.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 3 }}>
              <Button component={Link} href="/docs/guides/owner" variant="contained" size="large" endIcon={<ArrowForwardIcon />} sx={{ bgcolor: 'var(--docs-ink)', '&:hover': { bgcolor: '#0f1824' } }}>
                Owner / IT admin guide
              </Button>
              <Button component={Link} href="/docs/guides/employee" variant="outlined" size="large">
                Employee guide
              </Button>
            </Stack>
            <Box sx={{ mt: 3, display: 'grid', gap: 1.25 }}>
              {quickStartSteps.map((step, index) => (
                <Box
                  key={step.title}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '46px minmax(0, 1fr)',
                    gap: 1.25,
                    alignItems: 'start',
                    p: 1.35,
                    borderRadius: 2,
                    bgcolor: '#fffdf7',
                    border: '1px solid var(--docs-line)',
                  }}
                >
                  <Box
                    sx={{
                      width: 46,
                      height: 46,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: '50%',
                      bgcolor: 'var(--docs-accent-soft)',
                      color: 'var(--docs-accent-ink)',
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'var(--docs-ink)' }}>
                      {step.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {step.detail}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>

          <Paper sx={{ p: 2, borderRadius: 2, border: '1px solid var(--docs-line)', bgcolor: '#fffdf7' }}>
            <Typography variant="overline" color="text.secondary">
              Screenshot Evidence
            </Typography>
            <Typography variant="h5" sx={{ mt: 0.75, mb: 1.5 }}>
              Every guide uses real screens.
            </Typography>
            <ScreenshotFigure screenshot={docsScreenshots.signIn} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Tip: click any screenshot to zoom it, or open it in a new tab when you need more detail.
            </Typography>
          </Paper>
        </Box>
      </Paper>

      <Box sx={{ bgcolor: '#101720', color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
        <Box sx={{ px: { xs: 2.5, md: 3 }, py: { xs: 0.5, md: 0 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 0, borderLeft: '1px solid rgba(255,255,255,0.14)' }}>
            {docsMetrics.map((metric) => (
              <Box key={metric.label} sx={{ p: { xs: 2, md: 3 }, borderRight: '1px solid rgba(255,255,255,0.14)' }}>
                <Typography variant="h2" sx={{ color: 'inherit', lineHeight: 1 }}>{metric.value}</Typography>
                <Typography variant="caption" sx={{ color: 'rgba(248,250,252,0.72)' }}>{metric.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      <Box sx={{ bgcolor: '#e7eadf', py: { xs: 3, md: 4 }, borderTop: '1px solid rgba(15,23,42,0.12)', borderBottom: '1px solid rgba(15,23,42,0.12)' }}>
        <Box sx={{ px: { xs: 2.5, md: 3 } }}>
          <Typography variant="overline" color="text.secondary">Role-based documentation</Typography>
          <Typography variant="h2" sx={{ mt: 1, mb: 3, letterSpacing: 0 }}>Three ways to read the docs, depending on what you need.</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
            {docsModes.map((mode) => (
              <Paper
                key={mode.title}
                sx={{
                  p: { xs: 3, md: 4 },
                  borderRadius: 2,
                  bgcolor: '#fdfcf6',
                }}
              >
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: '#d9e98f',
                    color: '#101720',
                    mb: 1.5,
                  }}
                >
                  {mode.icon}
                </Box>
                <Typography variant="h3" gutterBottom>{mode.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {mode.body}
                </Typography>
                <Button component={Link} href={mode.href} sx={{ mt: 2.5 }} variant="outlined" endIcon={<OpenInNewRoundedIcon />}>
                  {mode.action}
                </Button>
              </Paper>
            ))}
          </Box>
        </Box>
      </Box>

      <Paper
        sx={{
          p: { xs: 2.5, md: 3 },
          borderRadius: 0,
          bgcolor: '#f7f8f4',
          border: '1px solid var(--docs-line)',
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2.5} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
          <Box sx={{ maxWidth: 760 }}>
            <Typography variant="overline" sx={{ color: 'var(--docs-accent)', letterSpacing: '0.16em' }}>
              How to navigate
            </Typography>
            <Typography variant="h3" sx={{ mt: 0.75, mb: 1 }}>
              The docs are split into three reading modes.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Role guides are for full workflows. Feature reference is for lookup. The left rail is the map when you already know the task or keyword.
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button component={Link} href="/docs/features" variant="outlined" startIcon={<ExploreRoundedIcon />}>
              Browse feature reference
            </Button>
            <Button component={Link} href="/docs/guides/owner" variant="contained" startIcon={<MenuBookRoundedIcon />} sx={{ bgcolor: 'var(--docs-ink)', '&:hover': { bgcolor: '#0f1824' } }}>
              Read a full workflow
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Box sx={{ bgcolor: '#101720', color: '#f8fafc', py: { xs: 3, md: 4 }, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
        <Box sx={{ px: { xs: 2.5, md: 3 } }}>
          <Typography variant="overline" sx={{ color: 'rgba(248,250,252,0.62)' }}>Search tags</Typography>
          <Typography variant="h2" sx={{ color: 'inherit', mt: 1, mb: 2 }}>
            Search by the words users already know.
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(248,250,252,0.72)', mb: 2.5, maxWidth: 720 }}>
            Tags are shared across owner/admin tasks, employee tasks, and feature reference sections so the docs can be searched by role, feature, or workflow language.
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {allTags.map((tag) => (
              <Chip key={tag} label={tag} size="small" sx={{ color: '#f8fafc', borderColor: 'rgba(248,250,252,0.22)', bgcolor: 'rgba(248,250,252,0.04)' }} variant="outlined" />
            ))}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
