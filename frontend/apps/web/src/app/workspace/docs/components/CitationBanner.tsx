/**
 * CitationBanner Component
 * Shows high-level awareness that a document is being cited by others
 * Displays when document has incoming citations
 */

'use client';

import React from 'react';
import { Box, Typography, Chip, Button } from '@mui/material';
import { FormatQuote as QuoteIcon } from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';
import type { CitedLineRange } from 'apis';

interface CitationBannerProps {
	citationCount: number;
	citedLineRanges: CitedLineRange[];
	onViewAll: () => void;
}

export default function CitationBanner({
	citationCount,
	citedLineRanges,
	onViewAll,
}: CitationBannerProps) {
	const colors = useThemeColors();

	// Format line ranges for display (e.g., "Lines 5-10, 25-30, 45")
	const lineRangeSummary = citedLineRanges
		.slice(0, 3) // Show first 3 ranges
		.map((range) =>
			range.startLine === range.endLine
				? `${range.startLine}`
				: `${range.startLine}-${range.endLine}`
		)
		.join(', ');

	const hasMoreRanges = citedLineRanges.length > 3;

	return (
		<Box
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 1.5,
				px: 2,
				py: 1,
				borderBottom: 1,
				...colors.border.default.style,
				backgroundColor: colors.bg.elevated.style.backgroundColor,
			}}
			data-testid="citation-banner"
		>
			{/* Icon */}
			<QuoteIcon
				fontSize="small"
				sx={{
					...colors.text.secondary.style,
				}}
			/>

			{/* Citation count */}
			<Typography variant="body2" sx={colors.text.primary.style}>
				<strong>Cited by {citationCount}</strong> document{citationCount !== 1 ? 's' : ''}
			</Typography>

			{/* Line ranges */}
			{lineRangeSummary && (
				<>
					<Typography variant="body2" sx={colors.text.secondary.style}>
						•
					</Typography>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<Typography variant="body2" sx={colors.text.secondary.style}>
							Lines
						</Typography>
						<Chip
							label={lineRangeSummary}
							size="small"
							sx={{
								...colors.bg.active.style,
								fontSize: '0.75rem',
								height: 20,
							}}
							data-testid="citation-line-ranges"
						/>
						{hasMoreRanges && (
							<Typography variant="body2" sx={colors.text.secondary.style}>
								+{citedLineRanges.length - 3} more
							</Typography>
						)}
					</Box>
				</>
			)}

			{/* View All button */}
			<Button
				size="small"
				onClick={onViewAll}
				sx={{
					ml: 'auto',
					...colors.text.primary.style,
					textTransform: 'none',
				}}
				data-testid="citation-view-all-btn"
			>
				View All
			</Button>
		</Box>
	);
}
