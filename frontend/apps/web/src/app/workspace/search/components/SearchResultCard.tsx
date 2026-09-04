'use client';

import React from 'react';
import { Box, Chip, Paper, Typography } from '@mui/material';

interface SearchResultCardProps {
	/** The kind badge, e.g. "Document". */
	badge: string;
	icon: React.ReactNode;
	title: string;
	/** One line saying where it lives. Comes from the server so no client invents phrasing. */
	contextLine: string;
	/** Matched-content excerpt, where the source produced one. */
	snippet?: string;
	testId: string;
	onClick: () => void;
}

/**
 * One row of the ranked list.
 *
 * The server already decided the order, the badge text and the context line, so every
 * kind renders through this same card and the list reads as one list rather than eight
 * stacked sections.
 */
export default function SearchResultCard({
	badge,
	icon,
	title,
	contextLine,
	snippet,
	testId,
	onClick,
}: SearchResultCardProps) {
	return (
		<Paper
			data-testid={testId}
			onClick={onClick}
			sx={{
				p: 2,
				cursor: 'pointer',
				transition: 'border-color 0.2s',
				'&:hover': { borderColor: 'text.disabled' },
			}}
		>
			<Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
				<Box
					sx={{
						p: 1,
						borderRadius: 1,
						bgcolor: 'action.hover',
						color: 'text.secondary',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					{icon}
				</Box>

				<Box sx={{ flex: 1, minWidth: 0 }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
						<Typography variant="body1" fontWeight="medium" noWrap sx={{ minWidth: 0 }}>
							{title}
						</Typography>
						<Chip label={badge} size="small" variant="outlined" data-testid={`${testId}-badge`} />
					</Box>

					<Typography variant="body2" color="text.secondary" noWrap>
						{contextLine}
					</Typography>

					{snippet ? (
						<Typography
							variant="body2"
							color="text.secondary"
							sx={{
								mt: 0.5,
								overflow: 'hidden',
								display: '-webkit-box',
								WebkitLineClamp: 2,
								WebkitBoxOrient: 'vertical',
							}}
							// The snippet is PGroonga's <mark>-highlighted HTML for content the
							// caller is entitled to read; the source never produces one for
							// content they are not.
							dangerouslySetInnerHTML={{ __html: snippet }}
						/>
					) : null}
				</Box>
			</Box>
		</Paper>
	);
}
