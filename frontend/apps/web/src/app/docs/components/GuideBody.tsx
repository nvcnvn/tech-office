import { Box } from '@mui/material';

/**
 * Renders a guide's HTML inside the docs shell. The markdown in
 * `content/guides/` is authored by hand and built at compile time, so there is
 * no untrusted input here and nothing to sanitise.
 */
export function GuideBody({ html }: { html: string }) {
	return (
		<Box
			component="article"
			dangerouslySetInnerHTML={{ __html: html }}
			sx={{
				bgcolor: 'var(--docs-panel)',
				border: '1px solid var(--docs-line)',
				borderRadius: 2,
				boxShadow: '0 16px 34px rgba(15,23,42,0.07)',
				px: { xs: 2.5, md: 5 },
				py: { xs: 3, md: 5 },
				color: 'var(--docs-ink)',
				fontSize: '1.0625rem',
				lineHeight: 1.7,

				'& > :first-of-type': { mt: 0 },
				'& > :last-child': { mb: 0 },

				'& h1': {
					fontSize: { xs: '2rem', md: '2.5rem' },
					fontWeight: 700,
					lineHeight: 1.15,
					letterSpacing: '-0.02em',
					textWrap: 'balance',
					mt: 0,
					mb: 2.5,
				},
				'& h2': {
					fontSize: { xs: '1.4rem', md: '1.6rem' },
					fontWeight: 700,
					lineHeight: 1.25,
					letterSpacing: '-0.01em',
					mt: 5,
					mb: 1.5,
					pb: 1,
					borderBottom: '1px solid var(--docs-line)',
					scrollMarginTop: '96px',
				},
				'& h3': {
					fontSize: '1.15rem',
					fontWeight: 700,
					mt: 3.5,
					mb: 1,
					scrollMarginTop: '96px',
				},

				'& p': { my: 2 },
				'& strong': { fontWeight: 700 },

				'& a': {
					color: 'inherit',
					textDecoration: 'underline',
					textDecorationColor: 'var(--docs-accent)',
					textDecorationThickness: 2,
					textUnderlineOffset: 3,
					'&:hover': { textDecorationColor: 'var(--docs-ink)' },
				},

				'& ul, & ol': { my: 2, pl: 3 },
				'& li': { my: 0.75 },
				'& li > p': { my: 0.5 },

				'& img': {
					display: 'block',
					width: '100%',
					height: 'auto',
					my: 3,
					borderRadius: 1.5,
					border: '1px solid var(--docs-line)',
					boxShadow: '0 10px 24px rgba(15,23,42,0.10)',
				},

				'& blockquote': {
					my: 3,
					mx: 0,
					px: 2.5,
					py: 0.5,
					borderLeft: '4px solid var(--docs-accent)',
					bgcolor: 'var(--docs-accent-soft)',
					borderRadius: '0 8px 8px 0',
					'& p': { my: 1.5 },
				},

				'& code': {
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
					fontSize: '0.875em',
					bgcolor: 'rgba(15,23,42,0.06)',
					px: 0.75,
					py: 0.25,
					borderRadius: 0.75,
				},
				'& pre': {
					my: 3,
					p: 2,
					overflowX: 'auto',
					bgcolor: 'rgba(15,23,42,0.05)',
					border: '1px solid var(--docs-line)',
					borderRadius: 1.5,
					lineHeight: 1.5,
					'& code': { bgcolor: 'transparent', p: 0, fontSize: '0.85rem' },
				},

				// Tables carry a lot of these guides; let wide ones scroll rather
				// than force the page to.
				'& table': {
					display: 'block',
					overflowX: 'auto',
					width: '100%',
					my: 3,
					borderCollapse: 'collapse',
					fontSize: '0.95rem',
				},
				'& th, & td': {
					border: '1px solid var(--docs-line)',
					px: 1.5,
					py: 1,
					textAlign: 'left',
					verticalAlign: 'top',
				},
				'& th': { bgcolor: 'rgba(15,23,42,0.04)', fontWeight: 700 },

				'& hr': {
					my: 4,
					border: 0,
					borderTop: '1px solid var(--docs-line)',
				},
			}}
		/>
	);
}
