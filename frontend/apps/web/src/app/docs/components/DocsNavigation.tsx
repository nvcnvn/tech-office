'use client';

import { Box, List, ListItemButton, Typography } from '@mui/material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface DocsNavItem {
	slug: string;
	title: string;
}

/**
 * The guide list, in reading order. Built from the markdown filenames, so a new
 * guide appears here by existing.
 */
export function DocsNavigation({ items }: { items: DocsNavItem[] }) {
	const pathname = usePathname()?.replace(/\/$/, '') || '/docs';

	const entries = [{ slug: '', title: 'Start here' }, ...items];

	return (
		<Box component="nav" aria-label="Guides">
			<Typography
				variant="overline"
				sx={{ px: 1.5, color: 'var(--docs-muted)', fontWeight: 700, letterSpacing: '0.08em' }}
			>
				Guides
			</Typography>
			<List disablePadding sx={{ mt: 0.5 }}>
				{entries.map(({ slug, title }) => {
					const href = slug ? `/docs/${slug}` : '/docs';
					const active = pathname === href;
					return (
						<ListItemButton
							key={href}
							component={Link}
							href={href}
							selected={active}
							sx={{
								borderRadius: 1.5,
								py: 0.9,
								px: 1.5,
								mb: 0.25,
								color: active ? 'var(--docs-ink)' : 'var(--docs-muted)',
								fontWeight: active ? 700 : 500,
								lineHeight: 1.35,
								'&.Mui-selected, &.Mui-selected:hover': {
									bgcolor: 'var(--docs-accent-soft)',
								},
							}}
						>
							{title}
						</ListItemButton>
					);
				})}
			</List>
		</Box>
	);
}
