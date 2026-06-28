/**
 * Platform-agnostic color tokens
 * These raw color values can be consumed by:
 * - MUI's createTheme (web)
 * - React Native's StyleSheet (mobile)
 * - Any CSS-in-JS solution
 */

export type ColorScale = {
    main: string;
    light: string;
    dark: string;
    contrastText: string;
};

export type BackgroundColors = {
    default: string;
    paper: string;
};

export type TextColors = {
    primary: string;
    secondary: string;
    disabled: string;
};

export type ThemePalette = {
    mode: 'light' | 'dark';
    primary: ColorScale;
    secondary: ColorScale;
    error: ColorScale;
    warning: ColorScale;
    info: ColorScale;
    success: ColorScale;
    background: BackgroundColors;
    text: TextColors;
    divider: string;
};

/**
 * Light theme color palette
 *
 * Professional workspace environment — high-contrast with neutral surfaces,
 * restrained accent colors, and clear visual hierarchy.
 */
export const lightPalette: ThemePalette = {
    mode: 'light',
    primary: {
        main: '#0f172a',
        light: '#334155',
        dark: '#020617',
        contrastText: '#ffffff',
    },
    secondary: {
        main: '#475569',
        light: '#64748b',
        dark: '#334155',
        contrastText: '#ffffff',
    },
    error: {
        main: '#dc2626',
        light: '#fca5a5',
        dark: '#991b1b',
        contrastText: '#ffffff',
    },
    warning: {
        main: '#d97706',
        light: '#fbbf24',
        dark: '#92400e',
        contrastText: '#ffffff',
    },
    info: {
        main: '#2563eb',
        light: '#93c5fd',
        dark: '#1e40af',
        contrastText: '#ffffff',
    },
    success: {
        main: '#16a34a',
        light: '#86efac',
        dark: '#166534',
        contrastText: '#ffffff',
    },
    background: {
        default: '#f8fafc',
        paper: '#ffffff',
    },
    text: {
        primary: '#0f172a',
        secondary: '#64748b',
        disabled: '#94a3b8',
    },
    divider: '#e2e8f0',
};

/**
 * Dark theme color palette
 * Professional dark mode — maintains contrast and hierarchy
 */
export const darkPalette: ThemePalette = {
    mode: 'dark',
    primary: {
        main: '#e2e8f0',
        light: '#f1f5f9',
        dark: '#cbd5e1',
        contrastText: '#0f172a',
    },
    secondary: {
        main: '#94a3b8',
        light: '#cbd5e1',
        dark: '#64748b',
        contrastText: '#0f172a',
    },
    error: {
        main: '#f87171',
        light: '#fca5a5',
        dark: '#dc2626',
        contrastText: '#0f172a',
    },
    warning: {
        main: '#fbbf24',
        light: '#fde68a',
        dark: '#d97706',
        contrastText: '#0f172a',
    },
    info: {
        main: '#60a5fa',
        light: '#93c5fd',
        dark: '#2563eb',
        contrastText: '#0f172a',
    },
    success: {
        main: '#4ade80',
        light: '#86efac',
        dark: '#16a34a',
        contrastText: '#0f172a',
    },
    background: {
        default: '#0f172a',
        paper: '#1e293b',
    },
    text: {
        primary: '#f1f5f9',
        secondary: '#94a3b8',
        disabled: '#475569',
    },
    divider: '#334155',
};

/**
 * Get palette by theme mode
 */
export function getPalette(mode: 'light' | 'dark'): ThemePalette {
    return mode === 'dark' ? darkPalette : lightPalette;
}

/**
 * Semantic status colors for badges, alerts, etc.
 * Works with both light and dark themes
 */
export const statusColors = {
    success: {
        light: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
        dark: { bg: 'rgba(22, 163, 74, 0.15)', text: '#4ade80', border: '#166534' },
    },
    error: {
        light: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
        dark: { bg: 'rgba(220, 38, 38, 0.15)', text: '#f87171', border: '#991b1b' },
    },
    warning: {
        light: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
        dark: { bg: 'rgba(217, 119, 6, 0.15)', text: '#fbbf24', border: '#92400e' },
    },
    info: {
        light: { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
        dark: { bg: 'rgba(37, 99, 235, 0.15)', text: '#60a5fa', border: '#1e40af' },
    },
};
