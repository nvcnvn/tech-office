/**
 * Theme tokens for light and dark mode
 * Defines color palettes and design tokens using Material-UI's createTheme
 *
 * Design System: Professional Workspace
 * - High-contrast light theme with neutral surfaces
 * - Slate-based color palette for professional typography
 * - Subtle 1px borders instead of heavy shadows
 * - Compact, 6px border-radius for a clean look
 * - WCAG 2.1 Level AA compliance (4.5:1 contrast for normal text)
 * - Smooth 700ms transitions between modes
 *
 * Color tokens sourced from @tech-office/theme-tokens for cross-platform consistency.
 */

import { createTheme, type ThemeOptions, type Theme } from '@mui/material/styles';

/**
 * Professional workspace palette — high-contrast with neutral surfaces,
 * restrained accent colors, and clear visual hierarchy.
 *
 * Colors are defined inline (mirroring the @tech-office/theme-tokens package)
 * so this file has zero build-time dependency on the shared package while still
 * keeping the two in sync via the same slate-based scale.
 */

const lightPalette = {
	primary: { main: '#0f172a', light: '#334155', dark: '#020617', contrastText: '#ffffff' },
	secondary: { main: '#475569', light: '#64748b', dark: '#334155', contrastText: '#ffffff' },
	error: { main: '#dc2626', light: '#fca5a5', dark: '#991b1b', contrastText: '#ffffff' },
	warning: { main: '#d97706', light: '#fbbf24', dark: '#92400e', contrastText: '#ffffff' },
	info: { main: '#2563eb', light: '#93c5fd', dark: '#1e40af', contrastText: '#ffffff' },
	success: { main: '#16a34a', light: '#86efac', dark: '#166534', contrastText: '#ffffff' },
	background: { default: '#f8fafc', paper: '#ffffff' },
	text: { primary: '#0f172a', secondary: '#64748b', disabled: '#94a3b8' },
	divider: '#e2e8f0',
};

const darkPalette = {
	primary: { main: '#e2e8f0', light: '#f1f5f9', dark: '#cbd5e1', contrastText: '#0f172a' },
	secondary: { main: '#94a3b8', light: '#cbd5e1', dark: '#64748b', contrastText: '#0f172a' },
	error: { main: '#f87171', light: '#fca5a5', dark: '#dc2626', contrastText: '#0f172a' },
	warning: { main: '#fbbf24', light: '#fde68a', dark: '#d97706', contrastText: '#0f172a' },
	info: { main: '#60a5fa', light: '#93c5fd', dark: '#2563eb', contrastText: '#0f172a' },
	success: { main: '#4ade80', light: '#86efac', dark: '#16a34a', contrastText: '#0f172a' },
	background: { default: '#0f172a', paper: '#1e293b' },
	text: { primary: '#f1f5f9', secondary: '#94a3b8', disabled: '#475569' },
	divider: '#334155',
};

/**
 * Shared theme options applied to both light and dark themes.
 * Uses system font stack for maximum native feel across platforms.
 */
const sharedOptions: ThemeOptions = {
	typography: {
		fontFamily: [
			'-apple-system',
			'BlinkMacSystemFont',
			'"Segoe UI"',
			'Roboto',
			'"Helvetica Neue"',
			'Arial',
			'sans-serif',
		].join(','),
		fontSize: 14,
		h1: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.025em' },
		h2: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3, letterSpacing: '-0.02em' },
		h3: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.4, letterSpacing: '-0.015em' },
		h4: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.4 },
		h5: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.5 },
		h6: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.5 },
		body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
		body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
		caption: { fontSize: '0.75rem', lineHeight: 1.5 },
		overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' },
		button: { textTransform: 'none', fontWeight: 500, fontSize: '0.875rem' },
	},
	shape: {
		borderRadius: 6,
	},
	spacing: 8,
};

/**
 * Build MUI component overrides for a given palette mode.
 * Keeps surfaces flat with subtle borders instead of box-shadows.
 */
function buildComponentOverrides(mode: 'light' | 'dark'): ThemeOptions['components'] {
	const p = mode === 'light' ? lightPalette : darkPalette;

	return {
		MuiCssBaseline: {
			styleOverrides: {
				body: {
					backgroundColor: p.background.default,
					color: p.text.primary,
				},
			},
		},
		MuiButton: {
			defaultProps: {
				disableElevation: true,
			},
			styleOverrides: {
				root: {
					borderRadius: 6,
					padding: '6px 16px',
					fontWeight: 500,
					fontSize: '0.875rem',
					textTransform: 'none' as const,
				},
				sizeSmall: {
					padding: '4px 12px',
					fontSize: '0.8125rem',
				},
				sizeLarge: {
					padding: '10px 24px',
					fontSize: '0.9375rem',
				},
				contained: {
					'&:hover': {
						boxShadow: 'none',
					},
				},
				outlined: {
					borderColor: p.divider,
					'&:hover': {
						borderColor: p.text.secondary,
						backgroundColor: mode === 'light' ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.04)',
					},
				},
			},
		},
		MuiPaper: {
			defaultProps: {
				elevation: 0,
			},
			styleOverrides: {
				root: {
					backgroundImage: 'none',
					border: `1px solid ${p.divider}`,
				},
				elevation0: {
					boxShadow: 'none',
				},
				elevation1: {
					boxShadow: 'none',
					border: `1px solid ${p.divider}`,
				},
			},
		},
		MuiCard: {
			defaultProps: {
				elevation: 0,
			},
			styleOverrides: {
				root: {
					borderRadius: 8,
					border: `1px solid ${p.divider}`,
					boxShadow: 'none',
					'&:hover': {
						borderColor: p.text.disabled,
					},
				},
			},
		},
		MuiAppBar: {
			defaultProps: {
				elevation: 0,
			},
			styleOverrides: {
				root: {
					backgroundColor: p.background.paper,
					color: p.text.primary,
					borderBottom: `1px solid ${p.divider}`,
					boxShadow: 'none',
				},
			},
		},
		MuiToolbar: {
			styleOverrides: {
				root: {
					minHeight: '48px !important',
				},
			},
		},
		MuiChip: {
			styleOverrides: {
				root: {
					borderRadius: 6,
					fontWeight: 500,
					fontSize: '0.75rem',
					height: 28,
				},
				sizeSmall: {
					height: 24,
					fontSize: '0.6875rem',
				},
			},
		},
		MuiTextField: {
			defaultProps: {
				size: 'small',
			},
			styleOverrides: {
				root: {
					'& .MuiOutlinedInput-root': {
						borderRadius: 6,
						'& fieldset': {
							borderColor: p.divider,
						},
						'&:hover fieldset': {
							borderColor: p.text.disabled,
						},
					},
				},
			},
		},
		MuiDialog: {
			styleOverrides: {
				paper: {
					borderRadius: 8,
					border: `1px solid ${p.divider}`,
					boxShadow: mode === 'light'
						? '0 4px 24px rgba(0,0,0,0.08)'
						: '0 4px 24px rgba(0,0,0,0.32)',
				},
			},
		},
		MuiDivider: {
			styleOverrides: {
				root: {
					borderColor: p.divider,
				},
			},
		},
		MuiTableCell: {
			styleOverrides: {
				root: {
					borderBottom: `1px solid ${p.divider}`,
					padding: '10px 16px',
					fontSize: '0.8125rem',
				},
				head: {
					fontWeight: 600,
					fontSize: '0.75rem',
					letterSpacing: '0.04em',
					textTransform: 'uppercase' as const,
					color: p.text.secondary,
				},
			},
		},
		MuiTab: {
			styleOverrides: {
				root: {
					textTransform: 'none' as const,
					fontWeight: 500,
					fontSize: '0.875rem',
					minHeight: 40,
				},
			},
		},
		MuiTooltip: {
			styleOverrides: {
				tooltip: {
					borderRadius: 4,
					fontSize: '0.75rem',
					fontWeight: 500,
				},
			},
		},
		MuiIconButton: {
			styleOverrides: {
				root: {
					borderRadius: 6,
				},
				sizeSmall: {
					padding: 4,
				},
			},
		},
		MuiAlert: {
			styleOverrides: {
				root: {
					borderRadius: 6,
					fontSize: '0.8125rem',
				},
			},
		},
		MuiTypography: {
			styleOverrides: {
				gutterBottom: {
					marginBottom: '0.5em',
				},
			},
		},
		MuiContainer: {
			styleOverrides: {
				root: {
					paddingLeft: 24,
					paddingRight: 24,
					'@media (min-width:600px)': {
						paddingLeft: 32,
						paddingRight: 32,
					},
				},
			},
		},
		MuiListItemButton: {
			styleOverrides: {
				root: {
					borderRadius: 6,
					'&.Mui-selected': {
						backgroundColor: mode === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.08)',
					},
				},
			},
		},
		MuiDrawer: {
			styleOverrides: {
				paper: {
					borderRight: `1px solid ${p.divider}`,
					boxShadow: 'none',
				},
			},
		},
	};
}

/**
 * Light theme configuration
 * High-contrast workspace theme with neutral surfaces
 */
export const lightTheme: Theme = createTheme({
	...sharedOptions,
	palette: {
		mode: 'light',
		primary: lightPalette.primary,
		secondary: lightPalette.secondary,
		error: lightPalette.error,
		warning: lightPalette.warning,
		info: lightPalette.info,
		success: lightPalette.success,
		background: lightPalette.background,
		text: lightPalette.text,
		divider: lightPalette.divider,
	},
	components: buildComponentOverrides('light'),
});

/**
 * Dark theme configuration
 * Professional dark mode with maintained contrast and hierarchy
 */
export const darkTheme: Theme = createTheme({
	...sharedOptions,
	palette: {
		mode: 'dark',
		primary: darkPalette.primary,
		secondary: darkPalette.secondary,
		error: darkPalette.error,
		warning: darkPalette.warning,
		info: darkPalette.info,
		success: darkPalette.success,
		background: darkPalette.background,
		text: darkPalette.text,
		divider: darkPalette.divider,
	},
	components: buildComponentOverrides('dark'),
});

/**
 * Get theme by mode string
 * @param mode - Theme mode ('light' or 'dark')
 * @returns Material-UI theme object
 */
export function getThemeByMode(mode: 'light' | 'dark'): Theme {
	return mode === 'dark' ? darkTheme : lightTheme;
}
