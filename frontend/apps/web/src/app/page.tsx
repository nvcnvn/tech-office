import type { ReactElement, ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Box,
  Button,
  Chip,
  Container,
  Divider,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import GroupsIcon from '@mui/icons-material/Groups';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import SearchIcon from '@mui/icons-material/Search';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import GitHubIcon from '@mui/icons-material/GitHub';
import { APP_VERSION } from 'apis';

import { MarketingHeader } from './components/MarketingHeader';
import { versionedPublicAssetPath } from '@/lib/publicAsset';

const heroMetrics = [
  { value: '1', label: 'shared workspace instead of scattered chat threads and spreadsheets' },
  { value: 'Free now', label: 'paid plans are being prepared for growth and scale teams' },
  { value: 'Web + mobile', label: 'the same workspace for office, field, and remote staff' },
  { value: 'Built-in', label: 'chat, tasks, schedules, docs, files, search, and notifications' },
];

const painCards = [
  {
    kicker: '01',
    title: 'Patchwork tools create invisible work.',
    body: 'Questions end up in one personal chat, files sit somewhere else, tasks live in memory, and schedules drift into side calendars. Owners only see the cost when something important is missed.',
  },
  {
    kicker: '02',
    title: 'Free consumer apps were never meant to run a business.',
    body: 'They work for quick messages, but not for permissions, searchable history, recurring routines, shared context, or company records that should stay with the company.',
  },
  {
    kicker: '03',
    title: 'Small teams should not have to buy enterprise complexity.',
    body: 'You do not need a bloated rollout just to get order. The right workspace should feel calmer on day one, clear enough for frontline staff, and affordable enough to keep.',
  },
];

const workspacePillars: Array<{ title: string; body: string; icon: ReactNode; points: string[] }> = [
  {
    title: 'Keep conversations attached to real work',
    body: 'Talk where the work already lives so decisions and follow-up do not disappear into private threads.',
    icon: <ChatBubbleOutlineIcon />,
    points: [
      'Channels, direct messages, voice, and mentions',
      'Task discussions that stay with the task',
      'Notifications that bring people back to the right context',
    ],
  },
  {
    title: 'Turn follow-up into a system',
    body: 'Tasks, recurring routines, evidence, and reviews make repeat work visible instead of depending on memory.',
    icon: <TaskAltIcon />,
    points: [
      'Project workspaces with task views and assignments',
      'Recurring rituals and evidence submission',
      'Operational review flows that make missed work obvious',
    ],
  },
  {
    title: 'Run the schedule in the same workspace',
    body: 'Meetings, resource bookings, and daily planning belong next to tasks and communication, not in a separate silo.',
    icon: <CalendarMonthIcon />,
    points: [
      'Shared calendar with invites and RSVP',
      'Availability, booking links, and resource scheduling',
      'A clearer day for managers and frontline teams alike',
    ],
  },
  {
    title: 'Store the proof where people can find it',
    body: 'Docs, files, and search keep the business from depending on one person knowing where everything is.',
    icon: <FolderOutlinedIcon />,
    points: [
      'Company docs and files in one place',
      'Search across work instead of hunting app by app',
      'Fewer lost links, fewer duplicate uploads, less confusion',
    ],
  },
];

const outcomeCards: Array<{ title: string; body: string; icon: ReactNode }> = [
  {
    title: 'Clear ownership instead of guesswork',
    body: 'Managers can see what is assigned, what is waiting, and what has slipped without chasing the team across different apps.',
    icon: <GroupsIcon />,
  },
  {
    title: 'Company data stays with the company',
    body: 'Permissions, records, files, and message history live in a business workspace instead of floating through personal accounts.',
    icon: <LockOutlinedIcon />,
  },
  {
    title: 'Less tool sprawl, lower day-to-day cost',
    body: 'A single affordable workspace is easier to manage than a growing pile of free tools and expensive add-ons.',
    icon: <SearchIcon />,
  },
];

const ownerSignals = [
  'Free is available now for very small teams, and paid Growth and Scale plans are coming soon.',
  'Role-based access helps owners and admins share the work without exposing everything to everyone.',
  'Web and mobile keep office staff and frontline workers in the same operating system.',
];

const productSignals: Array<{ label: string; icon: ReactElement }> = [
  { label: 'Chat with context', icon: <ChatBubbleOutlineIcon fontSize="small" /> },
  { label: 'Tasks and recurring routines', icon: <TaskAltIcon fontSize="small" /> },
  { label: 'Schedules and booking', icon: <CalendarMonthIcon fontSize="small" /> },
  { label: 'Docs, files, and search', icon: <FolderOutlinedIcon fontSize="small" /> },
  { label: 'Alerts and role-based access', icon: <NotificationsNoneIcon fontSize="small" /> },
  { label: 'Company setup and permissions', icon: <AccountTreeIcon fontSize="small" /> },
];

const primaryButtonSx = {
  bgcolor: '#d4ef64',
  color: '#101720',
  '&:hover': {
    bgcolor: '#c8e85d',
  },
};

export default function Home() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#f4efe4', color: '#101720' }}>
      <MarketingHeader />

      <Box
        component="section"
        sx={{
          minHeight: { xs: '100svh', md: '92svh' },
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          pt: 7,
          borderBottom: '1px solid rgba(15,23,42,0.16)',
        }}
      >
        <Image
          src={versionedPublicAssetPath('/docs/employee-chat.png')}
          alt="TechOffice workspace showing chat, task discussions, notifications, and shared context"
          fill
          priority
          sizes="100vw"
          style={{ objectFit: 'cover', objectPosition: 'center' }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(94deg, rgba(244,239,228,0.98) 0%, rgba(244,239,228,0.95) 34%, rgba(244,239,228,0.66) 62%, rgba(16,23,32,0.12) 100%)',
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle at 12% 20%, rgba(212,239,100,0.28) 0, rgba(212,239,100,0) 28%), radial-gradient(circle at 86% 18%, rgba(16,23,32,0.18) 0, rgba(16,23,32,0) 32%)',
          }}
        />
        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ maxWidth: 820, pt: { xs: 5, md: 6 } }}>
            <Chip
              label="Made for small and midsize businesses"
              size="small"
              variant="outlined"
              sx={{ mb: 2.5, bgcolor: 'rgba(255,250,240,0.78)', borderColor: 'rgba(15,23,42,0.2)' }}
            />
            <Typography
              variant="h1"
              sx={{
                fontSize: { xs: '2.55rem', sm: '3.35rem', md: '5.15rem' },
                lineHeight: { xs: 0.98, md: 0.92 },
                letterSpacing: '-0.04em',
                fontWeight: 900,
                maxWidth: 840,
                textWrap: 'balance',
              }}
            >
              Small businesses deserve a calmer way to run the workday.
            </Typography>
            <Typography
              variant="h5"
              sx={{ mt: 3, maxWidth: 700, fontWeight: 500, lineHeight: 1.55, color: 'rgba(16,23,32,0.78)' }}
            >
              TechOffice brings chat, tasks, schedules, files, notifications, and routine follow-up into one secure workspace,
              so your team can stop stitching work together across personal apps, spreadsheets, and memory.
            </Typography>
            <Typography variant="body1" sx={{ mt: 2.25, maxWidth: 670, color: 'rgba(16,23,32,0.66)' }}>
              You do not need an overbuilt enterprise tool chain to get order. You need one place that fits how a growing
              company actually works.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 4.5 }}>
              <Button component={Link} href="/pricing" variant="contained" size="large" endIcon={<ArrowForwardIcon />} sx={primaryButtonSx}>
                See pricing
              </Button>
              <Button
                component={Link}
                href="/#workspace"
                variant="outlined"
                size="large"
                sx={{ borderColor: 'rgba(15,23,42,0.24)', color: '#101720' }}
              >
                See what you get
              </Button>
            </Stack>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 4 }}>
              {productSignals.map((signal) => (
                <Chip
                  key={signal.label}
                  icon={signal.icon}
                  label={signal.label}
                  sx={{
                    bgcolor: 'rgba(255,250,240,0.82)',
                    border: '1px solid rgba(15,23,42,0.12)',
                    '& .MuiChip-icon': { color: '#101720' },
                  }}
                />
              ))}
            </Stack>
          </Box>
        </Container>
      </Box>

      <Box sx={{ bgcolor: '#101720', color: '#f8fafc', borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, borderLeft: '1px solid rgba(255,255,255,0.14)' }}>
            {heroMetrics.map((metric) => (
              <Box key={metric.label} sx={{ p: { xs: 2.25, md: 3 }, borderRight: '1px solid rgba(255,255,255,0.14)' }}>
                <Typography variant="h2" sx={{ color: 'inherit', lineHeight: 1 }}>
                  {metric.value}
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(248,250,252,0.72)' }}>
                  {metric.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Container>
      </Box>

      <Box id="why" component="section" sx={{ py: { xs: 6.5, md: 9 }, position: 'relative' }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.8fr 1.2fr' }, gap: { xs: 3, md: 6 } }}>
            <Box sx={{ position: { lg: 'sticky' }, top: { lg: 96 }, alignSelf: 'start' }}>
              <Typography variant="overline" color="text.secondary">
                Why this matters
              </Typography>
              <Typography variant="h2" sx={{ mt: 1, fontSize: { xs: '1.95rem', md: '2.8rem' }, letterSpacing: '-0.03em', maxWidth: 520 }}>
                The cheapest-looking setup often becomes the messiest one.
              </Typography>
              <Typography variant="body1" sx={{ mt: 2.25, maxWidth: 500, color: 'rgba(16,23,32,0.72)' }}>
                Many SME owners do not wake up thinking they need new software. They feel the symptoms first: repeated
                questions, missed handoffs, duplicate files, no clean history, and too much work living in personal tools.
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gap: 1.75 }}>
              {painCards.map((card) => (
                <Paper
                  key={card.title}
                  sx={{
                    p: { xs: 2.5, md: 3.25 },
                    bgcolor: '#fff9ef',
                    border: '1px solid rgba(15,23,42,0.1)',
                    boxShadow: '0 20px 40px rgba(15,23,42,0.06)',
                  }}
                >
                  <Typography variant="overline" sx={{ color: '#6b7280' }}>
                    {card.kicker}
                  </Typography>
                  <Typography
                    variant="h3"
                    sx={{ mt: 0.5, mb: 1.25, fontSize: { xs: '1.35rem', md: '1.65rem' }, letterSpacing: '-0.02em' }}
                  >
                    {card.title}
                  </Typography>
                  <Typography variant="body1" sx={{ color: 'rgba(16,23,32,0.72)', maxWidth: 760 }}>
                    {card.body}
                  </Typography>
                </Paper>
              ))}
            </Box>
          </Box>
        </Container>
      </Box>

      <Box id="workspace" component="section" sx={{ py: { xs: 2, md: 3 }, pb: { xs: 6.5, md: 9 } }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '0.9fr 1.1fr' }, gap: { xs: 3, lg: 5 }, alignItems: 'start' }}>
            <Box>
              <Paper sx={{ overflow: 'hidden', bgcolor: '#101720', borderRadius: 3, boxShadow: '0 24px 48px rgba(15,23,42,0.14)' }}>
                <Box sx={{ position: 'relative', aspectRatio: '16 / 10' }}>
                  <Image
                    src={versionedPublicAssetPath('/docs/employee-my-work.png')}
                    alt="TechOffice task workspace with project context and shared planning surfaces"
                    fill
                    sizes="(max-width: 1200px) 100vw, 560px"
                    style={{ objectFit: 'cover' }}
                  />
                </Box>
              </Paper>
              <Box sx={{ mt: 2.25, p: 2.25, bgcolor: 'rgba(212,239,100,0.24)', border: '1px solid rgba(15,23,42,0.12)', borderRadius: 2 }}>
                <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.72)' }}>
                  One workspace means the team can move from a message to a task, from a task to a file, and from a file to
                  the schedule without losing context.
                </Typography>
              </Box>
            </Box>

            <Box>
              <Typography variant="overline" color="text.secondary">
                What you get
              </Typography>
              <Typography variant="h2" sx={{ mt: 1, mb: 2, fontSize: { xs: '1.95rem', md: '2.8rem' }, letterSpacing: '-0.03em', maxWidth: 620 }}>
                Everything the day depends on, in one calmer operating workspace.
              </Typography>
              <Typography variant="body1" sx={{ mb: 3.5, color: 'rgba(16,23,32,0.72)', maxWidth: 680 }}>
                TechOffice is not trying to be every piece of software a company will ever buy. It focuses on the work that
                repeats every day and falls apart fastest when it is spread across too many places.
              </Typography>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.75 }}>
                {workspacePillars.map((pillar) => (
                  <Paper
                    key={pillar.title}
                    sx={{
                      p: 2.5,
                      bgcolor: '#fffdf7',
                      border: '1px solid rgba(15,23,42,0.1)',
                      minHeight: 260,
                    }}
                  >
                    <Box sx={{ width: 40, height: 40, borderRadius: 1.5, bgcolor: '#d4ef64', display: 'grid', placeItems: 'center', color: '#101720', mb: 1.75 }}>
                      {pillar.icon}
                    </Box>
                    <Typography variant="h4" sx={{ mb: 1, letterSpacing: '-0.02em' }}>
                      {pillar.title}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.72)', mb: 2 }}>
                      {pillar.body}
                    </Typography>
                    <Stack component="ul" spacing={1} sx={{ m: 0, pl: 2.25 }}>
                      {pillar.points.map((point) => (
                        <Typography component="li" variant="body2" key={point} sx={{ color: 'rgba(16,23,32,0.82)' }}>
                          {point}
                        </Typography>
                      ))}
                    </Stack>
                  </Paper>
                ))}
              </Box>
            </Box>
          </Box>
        </Container>
      </Box>

      <Box component="section" sx={{ bgcolor: '#ebe4d4', py: { xs: 6.5, md: 8.5 }, borderTop: '1px solid rgba(15,23,42,0.1)', borderBottom: '1px solid rgba(15,23,42,0.1)' }}>
        <Container maxWidth="lg">
          <Typography variant="overline" color="text.secondary">
            What changes
          </Typography>
          <Typography variant="h2" sx={{ mt: 1, mb: 3, fontSize: { xs: '1.95rem', md: '2.55rem' }, letterSpacing: '-0.03em', maxWidth: 720 }}>
            The goal is simple: less chaos, safer records, and a team that knows where work belongs.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
            {outcomeCards.map((card) => (
              <Paper key={card.title} sx={{ p: 3, bgcolor: '#fffaf0', border: '1px solid rgba(15,23,42,0.1)' }}>
                <Box sx={{ width: 42, height: 42, borderRadius: '50%', bgcolor: '#101720', color: '#f8fafc', display: 'grid', placeItems: 'center', mb: 1.75 }}>
                  {card.icon}
                </Box>
                <Typography variant="h4" sx={{ mb: 1, letterSpacing: '-0.02em' }}>
                  {card.title}
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.72)' }}>
                  {card.body}
                </Typography>
              </Paper>
            ))}
          </Box>
        </Container>
      </Box>

      <Box id="pricing" component="section" sx={{ bgcolor: '#101720', color: '#f8fafc', py: { xs: 6.5, md: 8.5 } }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.95fr 1.05fr' }, gap: { xs: 3, md: 5 }, alignItems: 'start' }}>
            <Box>
              <Chip label="Free now, paid soon" size="small" sx={{ bgcolor: 'rgba(212,239,100,0.92)', color: '#101720', fontWeight: 700 }} />
              <Typography variant="h2" sx={{ color: 'inherit', mt: 2, mb: 2, fontSize: { xs: '2rem', md: '3rem' }, letterSpacing: '-0.03em', maxWidth: 620 }}>
                Start free today. Paid plans are on the way.
              </Typography>
              <Typography variant="body1" sx={{ color: 'rgba(248,250,252,0.76)', maxWidth: 620 }}>
                The free-looking path gets expensive when follow-up is missed, files sit in personal accounts, and owners spend
                their own time stitching the business back together. TechOffice has a free plan available now for small teams,
                and the paid Growth and Scale plans are being prepared for a later rollout.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 3.5 }}>
                <Button component={Link} href="/pricing" variant="contained" endIcon={<ArrowForwardIcon />} sx={primaryButtonSx}>
                  See pricing status
                </Button>
                <Button
                  component={Link}
                  href="/signup"
                  variant="outlined"
                  sx={{ color: '#f8fafc', borderColor: 'rgba(248,250,252,0.3)' }}
                >
                  Start free
                </Button>
              </Stack>
            </Box>

            <Box sx={{ display: 'grid', gap: 1.25 }}>
              {ownerSignals.map((signal) => (
                <Box key={signal} sx={{ p: 2.25, border: '1px solid rgba(248,250,252,0.16)', bgcolor: 'rgba(248,250,252,0.04)' }}>
                  <Typography variant="body2" sx={{ color: 'inherit' }}>
                    {signal}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <Divider sx={{ my: 4, borderColor: 'rgba(248,250,252,0.16)' }} />
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' } }}>
            <Box>
              <Typography variant="h5" sx={{ color: 'inherit', mb: 0.5 }}>
                Need the detailed evaluation view?
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(248,250,252,0.68)' }}>
                The docs are still available for feature-by-feature review, rollout planning, and owner or employee
                walkthroughs.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <Button component={Link} href="/docs" variant="outlined" sx={{ color: '#f8fafc', borderColor: 'rgba(248,250,252,0.3)' }}>
                Read the docs
              </Button>
              <Button component={Link} href="/signin" variant="contained" endIcon={<ArrowForwardIcon />} sx={primaryButtonSx}>
                Open workspace
              </Button>
            </Stack>
          </Box>
        </Container>
      </Box>

      <Box sx={{ bgcolor: '#0b1017', color: 'rgba(248,250,252,0.58)', py: 2.5 }}>
        <Container maxWidth="lg" sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, justifyContent: 'space-between' }}>
          <Typography variant="caption">TechOffice · workspace operations for small and midsize teams</Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <IconButton
              href="https://github.com/nvcnvn/tech-office"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
              size="small"
              sx={{ color: 'rgba(248,250,252,0.58)' }}
            >
              <GitHubIcon fontSize="small" />
            </IconButton>
            <Typography variant="caption">Version {APP_VERSION}</Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
