/**
 * Mobile-specific design tokens
 *
 * Extends the shared tokens in colors.ts / spacing.ts / typography.ts with
 * values that only make sense on mobile (touch targets, safe-area helpers,
 * animation durations, shadow presets, etc.).
 *
 * Import from `@tech-office/theme-tokens/mobile` (barrel-exported below).
 */

import { spacing, borderRadius, layout } from './spacing';
import { fontSize, fontWeight, lineHeight } from './typography';
import { lightPalette, darkPalette, type ThemePalette } from './colors';

// ─── Touch & Tap Targets ────────────────────────────────────────────────────

/**
 * Minimum sizes per Apple HIG / Material 3 guidelines.
 * For low-tech workers we use the COMFORTABLE tier everywhere.
 */
export const touch = {
    /** Absolute minimum (Apple HIG) — avoid on primary actions. */
    minTarget: 44,
    /** Comfortable tap target — use for list rows, buttons, chips. */
    comfortable: 48,
    /** Large target — use for primary CTAs and bottom-bar items. */
    large: 56,
} as const;

// ─── Mobile Layout ──────────────────────────────────────────────────────────

export const mobileLayout = {
    /** Screen edge padding. */
    screenPadding: spacing[2], // 16
    /** Padding inside cards and grouped rows. */
    cardPadding: spacing[2], // 16
    /** Vertical gap between card-level elements in a list. */
    cardGap: spacing[1.5], // 12
    /** Vertical gap between items inside a card / group. */
    itemGap: spacing[1], // 8
    /** Horizontal gap between icon and text label in a row. */
    iconTextGap: spacing[1.5], // 12

    /** Minimum list-row height for tap friendliness. */
    listRowHeight: 72,
    /** Compact row (e.g. settings toggles, secondary lists). */
    compactRowHeight: 56,
    /** Header bar height (navigation). */
    headerHeight: layout.header.height, // 64
    /** Minimum tap target for header actions. */
    headerActionSize: 44,
    /** Minimum inset from the screen edge for header actions. */
    headerActionInset: spacing[1], // 8

    /** Bottom tab bar approximate height (iOS safe-area adds on top). */
    tabBarHeight: 56,
    /** Floating action button size. */
    fabSize: 56,

    /** Max content width — prevents text lines from being too long on tablets. */
    maxContentWidth: 600,
} as const;

// ─── Avatar Sizes (re-export with mobile-friendly aliases) ──────────────────

export const avatar = {
    /** Tiny inline indicator (message reactions, typing dots). */
    xs: layout.avatar.xs, // 24
    /** Small — compact list rows, chips. */
    sm: layout.avatar.sm, // 32
    /** Default — standard list rows (channels, contacts). */
    md: layout.avatar.md, // 40
    /** Large — profile card in More tab, detail headers. */
    lg: layout.avatar.lg, // 48
    /** Extra-large — full profile screen. */
    xl: layout.avatar.xl, // 64
} as const;

// ─── Border Radius (mobile semantic aliases) ────────────────────────────────

export const radius = {
    /** No rounding. */
    none: borderRadius.none, // 0
    /** Subtle rounding on inputs, small chips. */
    sm: borderRadius.sm, // 4
    /** Default card / button radius. */
    base: borderRadius.base, // 8
    /** Card group, bottom-sheet, modal. */
    md: borderRadius.md, // 12
    /** Large prominent cards. */
    lg: borderRadius.lg, // 16
    /** Pills / segment controls / avatars. */
    xl: borderRadius.xl, // 24
    /** Fully circular. */
    full: borderRadius.full, // 9999
} as const;

// ─── Border / Separator ─────────────────────────────────────────────────────

export const border = {
    /** Hairline separator for lists (StyleSheet.hairlineWidth equivalent). */
    hairline: 0.5,
    /** Standard border for cards, inputs. */
    thin: 1,
    /** Emphasis border (selected state, focus ring). */
    medium: 2,
} as const;

// ─── Shadows ────────────────────────────────────────────────────────────────

/**
 * Platform-agnostic shadow presets.
 * On Android these map to `elevation`; on iOS to shadow* properties.
 */
export const shadows = {
    none: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    /** Subtle lift — cards in a flat list. */
    sm: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 2,
        elevation: 1,
    },
    /** Default — floating cards, action sheets. */
    md: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    /** Prominent — modals, dialogs, FAB. */
    lg: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 4,
    },
} as const;

// ─── Animation Durations ────────────────────────────────────────────────────

export const duration = {
    /** Micro-interactions: checkbox toggle, ripple. */
    fast: 150,
    /** Standard transitions: screen push, sheet slide. */
    normal: 250,
    /** Emphasis: modal appear, skeleton shimmer. */
    slow: 400,
    /** Long: onboarding animation, splash fade. */
    slower: 600,
} as const;

// ─── Opacity ────────────────────────────────────────────────────────────────

export const opacity = {
    /** Pressed / active feedback. */
    pressed: 0.7,
    /** Disabled controls. */
    disabled: 0.38,
    /** Overlay / scrim behind modals. */
    scrim: 0.5,
    /** Hover feedback (web fallback on touch). */
    hover: 0.08,
} as const;

// ─── Mobile Typography Presets ──────────────────────────────────────────────

/**
 * Pre-composed text styles for the mobile app.
 * Use these in StyleSheet.create() to keep typography consistent.
 */
export const mobileTypography = {
    /** Screen title (Navigation bar large title). */
    screenTitle: {
        fontSize: 28,
        fontWeight: fontWeight.bold,
        lineHeight: 28 * lineHeight.tight, // 35
    },
    /** Section header inside a screen. */
    sectionHeader: {
        fontSize: fontSize.lg, // 18
        fontWeight: fontWeight.semibold,
        lineHeight: fontSize.lg * lineHeight.tight, // 22.5
    },
    /** Primary text in list rows. */
    listPrimary: {
        fontSize: fontSize.base, // 16
        fontWeight: fontWeight.medium,
        lineHeight: fontSize.base * lineHeight.normal, // 24
    },
    /** Secondary / subtitle text in list rows. */
    listSecondary: {
        fontSize: fontSize.sm, // 14
        fontWeight: fontWeight.normal,
        lineHeight: fontSize.sm * lineHeight.normal, // 21
    },
    /** Button label. */
    button: {
        fontSize: fontSize.base, // 16
        fontWeight: fontWeight.semibold,
        lineHeight: fontSize.base * lineHeight.tight, // 20
    },
    /** Small button / chip label. */
    buttonSm: {
        fontSize: fontSize.sm, // 14
        fontWeight: fontWeight.semibold,
        lineHeight: fontSize.sm * lineHeight.tight, // 17.5
    },
    /** Caption, timestamp, metadata. */
    caption: {
        fontSize: fontSize.xs, // 12
        fontWeight: fontWeight.normal,
        lineHeight: fontSize.xs * lineHeight.normal, // 18
    },
    /** Badge count text. */
    badge: {
        fontSize: 11,
        fontWeight: fontWeight.bold,
        lineHeight: 11 * lineHeight.tight, // ~14
    },
    /** Message body in chat. */
    messageBody: {
        fontSize: fontSize.base, // 16
        fontWeight: fontWeight.normal,
        lineHeight: fontSize.base * lineHeight.relaxed, // 28
    },
} as const;

// ─── Presence / Status Colors ───────────────────────────────────────────────

/**
 * Presence dot colors. Identical in light and dark mode for maximum
 * recognisability (dots are always rendered on top of avatars with a
 * white ring, providing constant contrast).
 */
export const presence = {
    online: '#16a34a',
    away: '#d97706',
    busy: '#dc2626',
    offline: '#94a3b8',
    /** Ring/border around dot for contrast with any background. */
    ring: '#ffffff',
    ringWidth: 2,
} as const;

// ─── Notification Domain Colors ─────────────────────────────────────────────

/**
 * Background tints used behind notification-type icons so users can
 * identify the source domain at a glance.
 */
export const notificationDomain = {
    chat: { bg: '#eff6ff', icon: '#2563eb' },
    tasks: { bg: '#f0fdf4', icon: '#16a34a' },
    calendar: { bg: '#fffbeb', icon: '#d97706' },
    system: { bg: '#f8fafc', icon: '#64748b' },
} as const;

// ─── Task State Colors ──────────────────────────────────────────────────────

export const taskState = {
    todo: { dot: '#94a3b8', bg: '#f8fafc', text: '#64748b' },
    inProgress: { dot: '#2563eb', bg: '#eff6ff', text: '#1e40af' },
    done: { dot: '#16a34a', bg: '#f0fdf4', text: '#166534' },
    cancelled: { dot: '#dc2626', bg: '#fef2f2', text: '#991b1b' },
} as const;

// ─── Calendar Event Colors ──────────────────────────────────────────────────

export const eventCategory = {
    meeting: '#2563eb',
    personal: '#7c3aed',
    holiday: '#16a34a',
    deadline: '#dc2626',
    reminder: '#d97706',
    other: '#64748b',
} as const;

// ─── Priority Colors ────────────────────────────────────────────────────────

export const priority = {
    critical: { bg: '#fef2f2', text: '#991b1b', dot: '#dc2626' },
    high: { bg: '#fffbeb', text: '#92400e', dot: '#d97706' },
    medium: { bg: '#eff6ff', text: '#1e40af', dot: '#2563eb' },
    low: { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8' },
} as const;

// ─── Themed Palette Helper ──────────────────────────────────────────────────

/**
 * Returns the full mobile palette for the given mode, combining the
 * shared palette from colors.ts with mobile-specific semantic tokens.
 */
export function getMobilePalette(mode: 'light' | 'dark') {
    const base: ThemePalette = mode === 'dark' ? darkPalette : lightPalette;

    return {
        ...base,
        presence,
        notificationDomain,
        taskState,
        eventCategory,
        priority,
    } as const;
}
