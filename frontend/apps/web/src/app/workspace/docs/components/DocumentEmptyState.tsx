/**
 * DocumentEmptyState Component
 * Shown when no document is selected
 */

'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import { Description as DocIcon } from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';

export default function DocumentEmptyState() {
	const colors = useThemeColors();

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				height: '100%',
				gap: 2,
				p: 4,
				...colors.bg.default.style,
			}}
			data-testid="docs-empty-state"
		>
			<DocIcon sx={{ fontSize: 64, ...colors.text.disabled.style }} />
			<Typography variant="h6" sx={colors.text.secondary.style}>
				Select a document to view
			</Typography>
			<Typography variant="body2" sx={colors.text.disabled.style}>
				Choose a document from the sidebar or create a new one
			</Typography>
		</Box>
	);
}
