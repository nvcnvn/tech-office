import Link from 'next/link';
import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';

import { MarketingHeader } from '../components/MarketingHeader';

const availabilityMetrics = [
  {
    value: 'Free now',
    label: 'small-team access is available today',
  },
  {
    value: '2',
    label: 'paid plans are being prepared',
  },
  {
    value: '100 MB',
    label: 'included storage on the current free plan',
  },
  {
    value: 'Web + mobile',
    label: 'the same workspace across office and field teams',
  },
];

const pricingPlans = [
  {
    tier: 'Free',
    status: 'Available now',
    eyebrow: 'For pilots and early daily use',
    headline: '$0',
    cadence: '/ month',
    summary: 'Use TechOffice today while your team consolidates chat, tasks, files, schedules, and routine follow-up into one workspace.',
    support: 'Community support while the commercial rollout is still being prepared.',
    storageIncluded: '100 MB included on the current free plan.',
    rolloutNote: 'Best for very small teams evaluating the product or beginning rollout now.',
    accent: '#d4ef64',
    accentInk: '#101720',
    border: 'rgba(15,23,42,0.14)',
    ctaLabel: 'Start free',
    ctaHref: '/signup',
  },
  {
    tier: 'Growth',
    status: 'Coming soon',
    eyebrow: 'For growing companies',
    headline: 'Paid plan',
    cadence: 'coming soon',
    summary: 'Planned for teams that want supported rollout, cleaner administration, and a commercial operating contract without enterprise sprawl.',
    support: 'Support package and response expectations are still being finalized.',
    storageIncluded: 'Commercial storage policy is still being finalized.',
    rolloutNote: 'Pricing and launch timing are not public yet because the paid package is not live.',
    accent: '#101720',
    accentInk: '#f8fafc',
    border: 'rgba(15,23,42,0.14)',
  },
  {
    tier: 'Scale',
    status: 'Coming soon',
    eyebrow: 'For larger operations',
    headline: 'Paid plan',
    cadence: 'coming soon',
    summary: 'Planned for organizations that need stronger support expectations, more formal rollout help, and a clearer long-term operating contract.',
    support: 'Support and SLA packaging are still in progress.',
    storageIncluded: 'Commercial storage policy is still being finalized.',
    rolloutNote: 'Details will be published once the paid rollout is ready to support real customers.',
    accent: '#d9d1c0',
    accentInk: '#101720',
    border: 'rgba(15,23,42,0.14)',
  },
];

const rolloutNotes = [
  {
    title: 'Use the free plan now',
    body: 'Small teams can start organizing daily work in TechOffice today instead of waiting for the full commercial launch.',
  },
  {
    title: 'Standardize the workflow first',
    body: 'Get chat, tasks, files, schedules, and routine follow-up into one workspace now, then move into paid support later.',
  },
  {
    title: 'Paid details will be explicit',
    body: 'Pricing, support response expectations, and storage rules for paid plans will be published only when they are real and ready.',
  },
];

const primaryButtonSx = {
  bgcolor: '#d4ef64',
  color: '#101720',
  '&:hover': {
    bgcolor: '#c8e85d',
  },
};

export default function PricingPage() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4efe4', color: '#101720' }}>
      <MarketingHeader />

      <Box sx={{ pt: { xs: 10, md: 11 } }}>
        <Box
          component="section"
          sx={{
            position: 'relative',
            overflow: 'hidden',
            borderBottom: '1px solid rgba(15,23,42,0.12)',
            bgcolor: '#f4efe4',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              backgroundImage:
                'radial-gradient(circle at 10% 18%, rgba(212,239,100,0.26) 0, rgba(212,239,100,0) 28%), radial-gradient(circle at 84% 16%, rgba(16,23,32,0.12) 0, rgba(16,23,32,0) 30%)',
            }}
          />
          <Container maxWidth="lg" sx={{ py: { xs: 5, md: 8 }, position: 'relative', zIndex: 1 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.95fr 0.85fr' }, gap: { xs: 3, md: 5 }, alignItems: 'start' }}>
              <Box sx={{ maxWidth: 780 }}>
                <Chip label="Pricing status" size="small" variant="outlined" sx={{ mb: 2.5, bgcolor: 'rgba(255,250,240,0.78)', borderColor: 'rgba(15,23,42,0.2)' }} />
                <Typography variant="h1" sx={{ fontSize: { xs: '2.5rem', sm: '3.3rem', md: '4.9rem' }, lineHeight: { xs: 0.98, md: 0.92 }, fontWeight: 900, letterSpacing: '-0.04em', maxWidth: 820 }}>
                  Start free now. Paid plans are coming soon.
                </Typography>
                <Typography variant="h5" sx={{ mt: 3, maxWidth: 720, fontWeight: 500, lineHeight: 1.55, color: 'rgba(16,23,32,0.78)' }}>
                  The free plan is available today for small teams. Growth and Scale are being prepared, so commercial pricing,
                  support packages, and paid rollout details are not live yet.
                </Typography>
                <Typography variant="body1" sx={{ mt: 2.25, maxWidth: 680, color: 'rgba(16,23,32,0.66)' }}>
                  This page is intentionally direct: what you can use now is marked available now, and what is still being packaged is marked coming soon.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4.5 }}>
                  <Button component={Link} href="/signup" variant="contained" size="large" endIcon={<ArrowForwardIcon />} sx={primaryButtonSx}>
                    Start free
                  </Button>
                  <Button component={Link} href="/docs" variant="outlined" size="large" sx={{ borderColor: 'rgba(15,23,42,0.22)', color: '#101720' }}>
                    Read the docs
                  </Button>
                </Stack>
              </Box>

              <Paper sx={{ p: 0, overflow: 'hidden', bgcolor: '#fffaf0', border: '1px solid rgba(15,23,42,0.12)', boxShadow: '0 24px 48px rgba(15,23,42,0.08)' }}>
                <Box sx={{ p: 2.5, bgcolor: '#101720', color: '#f8fafc' }}>
                  <Typography variant="overline" sx={{ color: 'rgba(248,250,252,0.62)' }}>Current rollout</Typography>
                  <Typography variant="h3" sx={{ mt: 0.75, color: 'inherit', letterSpacing: '-0.02em' }}>
                    One plan is live. Two paid plans are still in progress.
                  </Typography>
                </Box>
                <Box sx={{ p: 2.5 }}>
                  <Stack spacing={2}>
                    <Box sx={{ p: 2, border: '1px solid rgba(15,23,42,0.1)', bgcolor: 'rgba(212,239,100,0.18)' }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                        <CheckCircleOutlineRoundedIcon sx={{ color: '#101720' }} />
                        <Typography variant="body2" fontWeight={700}>Available now</Typography>
                      </Stack>
                      <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.74)' }}>
                        Free plan access for small teams, with 100 MB included and the full workspace available for early rollout.
                      </Typography>
                    </Box>

                    <Box sx={{ p: 2, border: '1px solid rgba(15,23,42,0.1)', bgcolor: '#fffdf7' }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                        <AccessTimeRoundedIcon sx={{ color: '#101720' }} />
                        <Typography variant="body2" fontWeight={700}>Coming soon</Typography>
                      </Stack>
                      <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.74)' }}>
                        Growth and Scale paid plans, commercial support packaging, and final paid pricing details.
                      </Typography>
                    </Box>

                    <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.66)' }}>
                      Paid plan details will be published when the rollout is ready to support real customers without vague placeholders.
                    </Typography>
                  </Stack>
                </Box>
              </Paper>
            </Box>
          </Container>
        </Box>

        <Box sx={{ bgcolor: '#101720', color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
          <Container maxWidth="lg">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, borderLeft: '1px solid rgba(255,255,255,0.14)' }}>
              {availabilityMetrics.map((item) => (
                <Box key={item.label} sx={{ p: { xs: 2, md: 3 }, borderRight: '1px solid rgba(255,255,255,0.14)' }}>
                  <Typography variant="h2" sx={{ color: 'inherit', lineHeight: 1 }}>{item.value}</Typography>
                  <Typography variant="caption" sx={{ color: 'rgba(248,250,252,0.72)' }}>{item.label}</Typography>
                </Box>
              ))}
            </Box>
          </Container>
        </Box>

        <Box component="section" sx={{ py: { xs: 6, md: 8 } }}>
          <Container maxWidth="lg">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.82fr 1.18fr' }, gap: { xs: 3, md: 6 }, alignItems: 'start' }}>
              <Box sx={{ position: { lg: 'sticky' }, top: { lg: 104 } }}>
                <Typography variant="overline" color="text.secondary">Plan status</Typography>
                <Typography variant="h2" sx={{ mt: 1, fontSize: { xs: '1.9rem', md: '2.5rem' }, letterSpacing: '-0.03em' }}>
                  The rollout is simple on purpose.
                </Typography>
                <Typography variant="body1" sx={{ mt: 2, color: 'rgba(16,23,32,0.72)' }}>
                  The page now reflects product reality: one free plan is usable today, and the paid tiers are clearly marked as coming soon instead of being presented like finished commercial offers.
                </Typography>
                <Stack spacing={1.5} sx={{ mt: 3 }}>
                  {[
                    'Small teams can start using the free plan right now.',
                    'Growth and Scale are planned, but not yet open for purchase.',
                    'Paid pricing will be published only when support and rollout details are finalized.',
                  ].map((line) => (
                    <Stack key={line} direction="row" spacing={1.25} alignItems="flex-start">
                      <CheckCircleOutlineRoundedIcon sx={{ mt: '2px', color: '#101720' }} />
                      <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.72)' }}>{line}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
                {pricingPlans.map((plan) => (
                  <Paper key={plan.tier} sx={{ p: 0, overflow: 'hidden', bgcolor: '#fffdf7', border: `1px solid ${plan.border}`, minHeight: 360 }}>
                    <Box sx={{ p: 2.5, bgcolor: plan.accent, color: plan.accentInk }}>
                      <Chip
                        label={plan.status}
                        size="small"
                        sx={{
                          bgcolor: plan.status === 'Available now' ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.18)',
                          color: 'inherit',
                          border: '1px solid rgba(255,255,255,0.22)',
                        }}
                      />
                      <Typography variant="overline" sx={{ color: 'inherit', opacity: 0.72 }}>
                        {plan.eyebrow}
                      </Typography>
                      <Typography variant="h3" sx={{ mt: 0.5, color: 'inherit' }}>
                        {plan.tier}
                      </Typography>
                      <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ mt: 2 }}>
                        <Typography variant="h2" sx={{ color: 'inherit', lineHeight: 1 }}>
                          {plan.headline}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'inherit', opacity: 0.72 }}>
                          {plan.cadence}
                        </Typography>
                      </Stack>
                    </Box>

                    <Box sx={{ p: 2.5 }}>
                      <Stack spacing={2.25}>
                        <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.74)' }}>{plan.summary}</Typography>

                        <Divider />

                        <Box>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                            <SupportAgentRoundedIcon fontSize="small" />
                            <Typography variant="body2" fontWeight={700}>Support status</Typography>
                          </Stack>
                          <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.72)' }}>{plan.support}</Typography>
                        </Box>

                        <Divider />

                        <Box>
                          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                            <StorageRoundedIcon fontSize="small" />
                            <Typography variant="body2" fontWeight={700}>Storage status</Typography>
                          </Stack>
                          <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.72)' }}>{plan.storageIncluded}</Typography>
                        </Box>

                        <Divider />

                        <Box>
                          <Typography variant="body2" fontWeight={700} sx={{ mb: 0.75 }}>Rollout note</Typography>
                          <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.72)' }}>{plan.rolloutNote}</Typography>
                        </Box>

                        {plan.ctaHref ? (
                          <Button component={Link} href={plan.ctaHref} variant="contained" endIcon={<ArrowForwardIcon />} sx={primaryButtonSx}>
                            {plan.ctaLabel}
                          </Button>
                        ) : null}
                      </Stack>
                    </Box>
                  </Paper>
                ))}
              </Box>
            </Box>
          </Container>
        </Box>

        <Box component="section" sx={{ bgcolor: '#ebe4d4', py: { xs: 6, md: 8 }, borderTop: '1px solid rgba(15,23,42,0.12)', borderBottom: '1px solid rgba(15,23,42,0.12)' }}>
          <Container maxWidth="lg">
            <Typography variant="overline" color="text.secondary">How to think about rollout</Typography>
            <Typography variant="h2" sx={{ mt: 1, mb: 3, fontSize: { xs: '1.95rem', md: '2.45rem' }, letterSpacing: '-0.03em', maxWidth: 760 }}>
              Use what is ready now. Upgrade later when paid support is actually ready.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
              {rolloutNotes.map((item) => (
                <Paper key={item.title} sx={{ p: 3.5, bgcolor: '#fffaf0', border: '1px solid rgba(15,23,42,0.1)' }}>
                  <Typography variant="h3" gutterBottom>{item.title}</Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.72)' }}>{item.body}</Typography>
                </Paper>
              ))}
            </Box>
          </Container>
        </Box>

        <Box component="section" sx={{ bgcolor: '#101720', color: '#f8fafc', py: { xs: 6.5, md: 8 } }}>
          <Container maxWidth="lg">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.95fr 1.05fr' }, gap: { xs: 3, md: 5 }, alignItems: 'start' }}>
              <Box>
                <Chip label="Free now, paid later" size="small" sx={{ bgcolor: 'rgba(212,239,100,0.92)', color: '#101720', fontWeight: 700 }} />
                <Typography variant="h2" sx={{ color: 'inherit', mt: 2, mb: 2, fontSize: { xs: '2rem', md: '3rem' }, letterSpacing: '-0.03em', maxWidth: 640 }}>
                  You can evaluate the workspace today without guessing about the commercial roadmap.
                </Typography>
                <Typography variant="body1" sx={{ color: 'rgba(248,250,252,0.76)', maxWidth: 620 }}>
                  Start with the free plan now if you want to test fit, align the team, and reduce tool chaos. Paid plans will appear here once the support and pricing details are ready to be trusted.
                </Typography>
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignSelf: { lg: 'end' }, justifyContent: { lg: 'flex-end' } }}>
                <Button component={Link} href="/signup" variant="contained" endIcon={<ArrowForwardIcon />} sx={primaryButtonSx}>
                  Start free
                </Button>
                <Button component={Link} href="/docs" variant="outlined" sx={{ color: '#f8fafc', borderColor: 'rgba(248,250,252,0.3)' }}>
                  Read the docs
                </Button>
              </Stack>
            </Box>
          </Container>
        </Box>
      </Box>
    </Box>
  );
}