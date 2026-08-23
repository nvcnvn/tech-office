import { Box } from '@mui/material';

import { MarketingHeader } from '../components/MarketingHeader';
import { DocsNavigation } from './components/DocsNavigation';
import { getGuideNav } from './guides';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const navItems = getGuideNav().map(({ slug, title }) => ({ slug, title }));

  return (
    <Box
      sx={{
        '--docs-bg': '#f7f8f4',
        '--docs-panel': '#fffdf7',
        '--docs-panel-strong': '#fffdf7',
        '--docs-ink': '#101720',
        '--docs-muted': 'rgba(16, 23, 32, 0.68)',
        '--docs-accent': '#d9e98f',
        '--docs-accent-ink': '#101720',
        '--docs-accent-soft': 'rgba(217, 233, 143, 0.38)',
        '--docs-line': 'rgba(15, 23, 42, 0.12)',
        minHeight: '100vh',
        color: 'var(--docs-ink)',
        bgcolor: 'var(--docs-bg)',
        fontFamily: 'inherit',
        '& .MuiTypography-h1, & .MuiTypography-h2, & .MuiTypography-h3, & .MuiTypography-h4, & .MuiTypography-h5, & .MuiTypography-h6': {
          color: 'var(--docs-ink)',
          letterSpacing: 0,
          textWrap: 'balance',
        },
      }}
    >
      <MarketingHeader />

      <Box
        sx={{
          maxWidth: 1440,
          mx: 'auto',
          px: { xs: 2, md: 3 },
          pt: { xs: 10, md: 11 },
          pb: { xs: 2.5, md: 4 },
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '320px minmax(0, 1fr)' },
          gap: { xs: 2.5, lg: 4 },
          alignItems: 'start',
        }}
      >
        <Box
          sx={{
            display: { xs: 'block', lg: 'none' },
            bgcolor: 'var(--docs-panel)',
            border: '1px solid var(--docs-line)',
            borderRadius: 2,
            p: 1.5,
            boxShadow: '0 14px 30px rgba(15,23,42,0.06)',
          }}
        >
          <DocsNavigation items={navItems} />
        </Box>

        <Box
          sx={{
            display: { xs: 'none', lg: 'block' },
            position: 'sticky',
            top: 88,
            maxHeight: 'calc(100vh - 112px)',
            overflowY: 'auto',
            bgcolor: 'var(--docs-panel)',
            border: '1px solid var(--docs-line)',
            borderRadius: 2,
            p: 1.75,
            boxShadow: '0 16px 34px rgba(15,23,42,0.07)',
          }}
        >
          <DocsNavigation items={navItems} />
        </Box>

        <Box component="main" sx={{ minWidth: 0, pb: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
