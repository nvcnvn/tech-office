import type { ReactNode } from 'react';
import { Box, Container, Divider, Stack, Typography } from '@mui/material';

import { MarketingHeader } from './MarketingHeader';

/**
 * Shared shell for the public legal pages.
 *
 * Both stores require a privacy policy at a URL anyone can open without signing
 * in, so these routes sit on the marketing site rather than behind auth, and the
 * mobile app links to them instead of carrying a second copy of the text that
 * would drift from this one.
 */
export function LegalPage({
	title,
	version,
	lastUpdated,
	summary,
	children,
}: {
	title: string;
	version: string;
	lastUpdated: string;
	summary: string;
	children: ReactNode;
}) {
	return (
		<Box sx={{ bgcolor: '#fffaf0', minHeight: '100vh' }}>
			<MarketingHeader />
			<Container maxWidth="md" sx={{ py: { xs: 5, md: 8 } }}>
				<Stack spacing={1.5}>
					<Typography variant="h1" sx={{ fontSize: { xs: '2rem', md: '2.75rem' }, letterSpacing: '-0.03em' }}>
						{title}
					</Typography>
					<Typography variant="body2" sx={{ color: 'rgba(16,23,32,0.6)' }}>
						Version {version} · Last updated {lastUpdated}
					</Typography>
					<Typography variant="body1" sx={{ color: 'rgba(16,23,32,0.78)', maxWidth: 680 }}>
						{summary}
					</Typography>
				</Stack>

				<Divider sx={{ my: { xs: 3, md: 4 } }} />

				<Box
					sx={{
						'& h2': {
							fontSize: { xs: '1.25rem', md: '1.5rem' },
							fontWeight: 700,
							letterSpacing: '-0.02em',
							mt: 4,
							mb: 1.5,
						},
						'& h3': { fontSize: '1.05rem', fontWeight: 700, mt: 3, mb: 1 },
						'& p': { color: 'rgba(16,23,32,0.78)', lineHeight: 1.7, mb: 1.5 },
						'& ul': { color: 'rgba(16,23,32,0.78)', lineHeight: 1.7, pl: 3, mb: 2 },
						'& li': { mb: 0.75 },
						'& a': { color: '#101720', textUnderlineOffset: 3 },
						'& table': { width: '100%', borderCollapse: 'collapse', my: 2 },
						'& th, & td': {
							border: '1px solid rgba(15,23,42,0.14)',
							padding: '10px 12px',
							textAlign: 'left',
							verticalAlign: 'top',
							fontSize: '0.925rem',
							color: 'rgba(16,23,32,0.82)',
						},
						'& th': { bgcolor: 'rgba(15,23,42,0.04)', fontWeight: 700 },
					}}
				>
					{children}
				</Box>
			</Container>
		</Box>
	);
}
