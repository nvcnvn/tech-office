/**
 * Theme toggle button component
 * Allows users to switch between light and dark themes with a single click
 * 
 * Features:
 * - Material-UI IconButton with sun/moon icons
 * - Loading state during API call
 * - Tooltip with dynamic text
 * - data-testid for accessibility testing
 */

'use client';

import React from 'react';
import { IconButton, Tooltip, CircularProgress } from '@mui/material';
import { Brightness4, Brightness7 } from '@mui/icons-material';
import { useTheme } from './ThemeProvider';

/**
 * ThemeToggle component
 * Renders an icon button that toggles between light and dark themes
 * 
 * @example
 * ```tsx
 * <ThemeToggle />
 * ```
 */
export function ThemeToggle() {
	const { themeMode, toggleTheme, loading } = useTheme();

	const handleClick = async () => {
		if (loading) return; // Prevent concurrent toggles
		await toggleTheme();
	};

	// Determine tooltip text based on current theme
	const tooltipText = themeMode === 'light'
		? 'Switch to dark mode'
		: 'Switch to light mode';

	// Show loading spinner during API call
	if (loading) {
		return (
			<IconButton
				disabled
				data-testid="theme-toggle-button"
				aria-label="Switching theme..."
			>
				<CircularProgress size={24} />
			</IconButton>
		);
	}

	return (
		<Tooltip title={tooltipText}>
			<IconButton
				onClick={handleClick}
				data-testid="theme-toggle-button"
				aria-label={tooltipText}
				color="inherit"
			>
				{themeMode === 'light' ? <Brightness4 /> : <Brightness7 />}
			</IconButton>
		</Tooltip>
	);
}
