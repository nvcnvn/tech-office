/**
 * Theme-aware color hook
 * Provides semantic color tokens that work with MUI theme
 * 
 * Usage:
 * const colors = useThemeColors();
 * <div style={colors.bg.paper.style}> // Inline style (most reliable)
 * <div className={colors.bg.paper.className}> // Tailwind class (for gradients/hover)
 */

import { useTheme } from '@mui/material/styles';
import { useMemo } from 'react';
import type { ComponentProps } from 'react';

type InlineStyle = NonNullable<ComponentProps<'div'>['style']>;

interface ColorToken {
	style: InlineStyle;
	className: string;
}

export function useThemeColors() {
	const theme = useTheme();
	const isDark = theme.palette.mode === 'dark';

	return useMemo(
		() => ({
			// Background colors
			bg: {
				default: {
					style: { backgroundColor: isDark ? '#09090b' : '#f9fafb' },
					className: isDark ? 'bg-zinc-950' : 'bg-gray-50',
				} as ColorToken,
				paper: {
					style: { backgroundColor: isDark ? '#18181b' : '#ffffff' },
					className: isDark ? 'bg-zinc-900' : 'bg-white',
				} as ColorToken,
				elevated: {
					style: { backgroundColor: isDark ? '#27272a' : '#ffffff' },
					className: isDark ? 'bg-zinc-800' : 'bg-white',
				} as ColorToken,
				active: {
					style: { backgroundColor: isDark ? '#3f3f46' : '#f3f4f6' },
					className: isDark ? 'bg-zinc-700' : 'bg-gray-100',
				} as ColorToken,
				hover: isDark ? 'hover:bg-zinc-800' : 'hover:bg-gray-50', // className only
			},
			// Text colors
			text: {
				primary: {
					style: { color: isDark ? 'rgba(255, 255, 255, 0.87)' : '#111827' },
					className: isDark ? 'text-white/87' : 'text-gray-900',
				} as ColorToken,
				secondary: {
					style: { color: isDark ? 'rgba(255, 255, 255, 0.6)' : '#4b5563' },
					className: isDark ? 'text-white/60' : 'text-gray-600',
				} as ColorToken,
				disabled: {
					style: { color: isDark ? 'rgba(255, 255, 255, 0.38)' : '#9ca3af' },
					className: isDark ? 'text-white/38' : 'text-gray-400',
				} as ColorToken,
				hint: {
					style: { color: isDark ? 'rgba(255, 255, 255, 0.6)' : '#6b7280' },
					className: isDark ? 'text-white/60' : 'text-gray-500',
				} as ColorToken,
			},
			// Border colors
			border: {
				default: {
					style: { borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : '#e5e7eb' },
					className: isDark ? 'border-white/12' : 'border-gray-200',
				} as ColorToken,
				light: {
					style: { borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#f3f4f6' },
					className: isDark ? 'border-white/8' : 'border-gray-100',
				} as ColorToken,
				dark: {
					style: { borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : '#d1d5db' },
					className: isDark ? 'border-white/20' : 'border-gray-300',
				} as ColorToken,
				primary: {
					style: { borderColor: isDark ? '#60a5fa' : '#2563eb' },
					className: isDark ? 'border-blue-400' : 'border-blue-600',
				} as ColorToken,
			},
			// Primary colors
			primary: {
				main: {
					style: { backgroundColor: isDark ? '#60a5fa' : '#2563eb' },
					className: isDark ? 'bg-blue-400' : 'bg-blue-600',
				} as ColorToken,
				light: {
					style: { backgroundColor: isDark ? '#172554' : '#dbeafe' },
					className: isDark ? 'bg-blue-950' : 'bg-blue-100',
				} as ColorToken,
				text: {
					style: { color: isDark ? '#60a5fa' : '#2563eb' },
					className: isDark ? 'text-blue-400' : 'text-blue-600',
				} as ColorToken,
				textLight: {
					style: { color: isDark ? '#bfdbfe' : '#dbeafe' },
					className: isDark ? 'text-blue-200' : 'text-blue-100',
				} as ColorToken,
				hover: isDark ? 'hover:bg-blue-400/10' : 'hover:bg-blue-50', // className only
			},
			// Status colors (gradients work as Tailwind classes)
			gradients: {
				blue: 'bg-gradient-to-br from-blue-500 to-blue-600 text-white',
				green: 'bg-gradient-to-br from-green-500 to-green-600 text-white',
				purple: 'bg-gradient-to-br from-purple-500 to-purple-600 text-white',
				pink: 'bg-gradient-to-br from-pink-500 to-pink-600 text-white',
				indigo: 'bg-gradient-to-br from-indigo-500 to-pink-600 text-white',
				teal: 'bg-gradient-to-br from-teal-500 to-teal-600 text-white',
				orange: 'bg-gradient-to-br from-orange-500 to-orange-600 text-white',
				red: 'bg-gradient-to-br from-red-500 to-red-600 text-white',
			},
			// Semantic status colors (for badges, alerts, etc.)
			status: {
				success: {
					bg: isDark ? 'bg-green-900/30' : 'bg-green-50',
					text: isDark ? 'text-green-400' : 'text-green-700',
					border: isDark ? 'border-green-700' : 'border-green-200',
				},
				error: {
					bg: isDark ? 'bg-red-900/30' : 'bg-red-50',
					text: isDark ? 'text-red-400' : 'text-red-700',
					border: isDark ? 'border-red-700' : 'border-red-200',
				},
				warning: {
					bg: isDark ? 'bg-orange-900/30' : 'bg-orange-50',
					text: isDark ? 'text-orange-400' : 'text-orange-700',
					border: isDark ? 'border-orange-700' : 'border-orange-200',
				},
				info: {
					bg: isDark ? 'bg-blue-900/30' : 'bg-blue-50',
					text: isDark ? 'text-blue-400' : 'text-blue-700',
					border: isDark ? 'border-blue-700' : 'border-blue-200',
				},
			},
			// Semantic card backgrounds (for info panels)
			card: {
				info: {
					bg: isDark ? 'bg-gradient-to-br from-blue-950 to-indigo-950' : 'bg-gradient-to-br from-blue-50 to-indigo-50',
					border: isDark ? 'border-blue-800' : 'border-blue-200',
				},
				success: {
					bg: isDark ? 'bg-gradient-to-br from-green-950 to-emerald-950' : 'bg-gradient-to-br from-green-50 to-emerald-50',
					border: isDark ? 'border-green-800' : 'border-green-200',
				},
			},
			// Button variants
			button: {
				primary: {
					bg: isDark ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-600 hover:bg-blue-700',
					text: 'text-white',
				},
				secondary: {
					bg: isDark ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-white hover:bg-gray-50',
					text: isDark ? 'text-white' : 'text-gray-700',
					border: isDark ? 'border-zinc-600' : 'border-gray-300',
				},
				danger: {
					bg: isDark ? 'bg-red-900/30 hover:bg-red-900/50' : 'bg-red-50 hover:bg-red-100',
					text: isDark ? 'text-red-400' : 'text-red-700',
					border: isDark ? 'border-red-700' : 'border-red-300',
				},
			},
			// Input styles
			input: {
				base: {
					bg: isDark ? 'bg-zinc-800' : 'bg-white',
					border: isDark ? 'border-zinc-700' : 'border-gray-300',
					text: isDark ? 'text-white' : 'text-gray-900',
					placeholder: isDark ? 'placeholder-zinc-500' : 'placeholder-gray-400',
					focus: isDark ? 'focus:ring-blue-500 focus:border-blue-500' : 'focus:ring-blue-500 focus:border-blue-500',
				},
			},
		}),
		[isDark]
	);
}
