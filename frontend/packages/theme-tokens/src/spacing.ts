/**
 * Spacing tokens
 * Based on 8px base unit (Material Design standard)
 */

/**
 * Base spacing unit in pixels
 */
export const spacingUnit = 8;

/**
 * Spacing scale
 * Usage: spacing[4] = 32px (4 * 8)
 */
export const spacing = {
    0: 0,
    0.5: spacingUnit * 0.5, // 4px
    1: spacingUnit * 1, // 8px
    1.5: spacingUnit * 1.5, // 12px
    2: spacingUnit * 2, // 16px
    2.5: spacingUnit * 2.5, // 20px
    3: spacingUnit * 3, // 24px
    4: spacingUnit * 4, // 32px
    5: spacingUnit * 5, // 40px
    6: spacingUnit * 6, // 48px
    8: spacingUnit * 8, // 64px
    10: spacingUnit * 10, // 80px
    12: spacingUnit * 12, // 96px
    16: spacingUnit * 16, // 128px
} as const;

/**
 * Border radius scale
 */
export const borderRadius = {
    none: 0,
    sm: 4,
    base: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
};

/**
 * Common layout sizes
 */
export const layout = {
    maxWidth: {
        sm: 640,
        md: 768,
        lg: 1024,
        xl: 1280,
        '2xl': 1536,
    },
    sidebar: {
        collapsed: 64,
        expanded: 240,
    },
    header: {
        height: 64,
    },
    avatar: {
        xs: 24,
        sm: 32,
        md: 40,
        lg: 48,
        xl: 64,
    },
};

/**
 * Helper to get spacing value
 * @param multiplier - Number of spacing units
 */
export function getSpacing(multiplier: number): number {
    return spacingUnit * multiplier;
}
