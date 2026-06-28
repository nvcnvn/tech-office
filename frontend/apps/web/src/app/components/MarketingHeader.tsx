'use client';

import Link from 'next/link';
import { AppBar, Box, Button, Container, IconButton, Stack, Typography } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';

const REPO_URL = 'https://github.com/nvcnvn/tech-office';

const navItems = [
  { label: 'Why it works', href: '/#why' },
  { label: 'Workspace', href: '/#workspace' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Docs', href: '/docs' },
];

interface MarketingHeaderProps {
  position?: 'fixed' | 'sticky';
}

export function MarketingHeader({ position = 'fixed' }: MarketingHeaderProps) {
  return (
    <AppBar
      position={position}
      sx={{
        bgcolor: 'rgba(247,248,244,0.92)',
        color: 'text.primary',
        borderBottom: '1px solid rgba(15,23,42,0.12)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <Container maxWidth="lg">
        <Box sx={{ minHeight: 56, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography
            component={Link}
            href="/"
            variant="h5"
            sx={{ textDecoration: 'none', color: 'inherit', fontWeight: 800 }}
          >
            TechOffice
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'none', md: 'flex' }, ml: 'auto' }}>
            {navItems.map((item) => (
              <Button key={item.href} component={Link} href={item.href} color="inherit" size="small">
                {item.label}
              </Button>
            ))}
          </Stack>
          <IconButton
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
            size="small"
            sx={{ color: 'inherit', ml: { xs: 'auto', md: 0.5 } }}
          >
            <GitHubIcon />
          </IconButton>
          <Button component={Link} href="/signin" variant="contained" size="small">
            Sign in
          </Button>
        </Box>
      </Container>
    </AppBar>
  );
}