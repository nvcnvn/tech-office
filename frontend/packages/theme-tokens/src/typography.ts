/**
 * Typography tokens
 * Platform-agnostic font size and weight definitions
 */

/**
 * System font stack that works across platforms
 * - Web: Uses system fonts with fallbacks
 * - Mobile: React Native will map to platform defaults
 */
export const fontFamily = {
    primary: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
    ],
    // For React Native, you can use: fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto'
};

/**
 * Font size scale (in pixels for web, points for mobile)
 * Based on Material Design type scale
 */
export const fontSize = {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
    '5xl': 48,
};

/**
 * Font weight scale
 */
export const fontWeight = {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
};

/**
 * Line height multipliers
 */
export const lineHeight = {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
};

/**
 * Heading styles
 */
export const headings = {
    h1: { fontSize: fontSize['4xl'], fontWeight: fontWeight.semibold },
    h2: { fontSize: fontSize['3xl'], fontWeight: fontWeight.semibold },
    h3: { fontSize: fontSize['2xl'], fontWeight: fontWeight.semibold },
    h4: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
    h5: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
    h6: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
};

/**
 * Body text styles
 */
export const body = {
    body1: { fontSize: fontSize.base, lineHeight: lineHeight.normal },
    body2: { fontSize: fontSize.sm, lineHeight: lineHeight.normal },
    caption: { fontSize: fontSize.xs, lineHeight: lineHeight.normal },
};
