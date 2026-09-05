/**
 * Mobile-specific design tokens
 *
 * Extends the shared tokens in colors.ts / spacing.ts / typography.ts with
 * values that only make sense on mobile (touch targets, safe-area helpers,
 * animation durations, shadow presets, etc.).
 *
 * Import from `@tech-office/theme-tokens/mobile` (barrel-exported below).
 */

import { spacing, borderRadius, layout } from './spacing.ts';
import { fontSize, fontWeight, lineHeight } from './typography.ts';
import { lightPalette, darkPalette, type ThemePalette } from './colors.ts';

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

// ─── Semantic Colour Groups ─────────────────────────────────────────────────

/**
 * The five mobile-only semantic colour groups.
 *
 * Each is a `{ light, dark }` pair rather than a single record, because the
 * meaning a colour carries has to survive the mode change: a colour that means
 * "overdue" in light means "overdue" in dark. Dark values are *derived* from the
 * light ones by one rule per role rather than re-chosen, so the two sets stay
 * auditable against each other:
 *
 * - foreground / dot / icon (a 600-level hue) → the 400-level of the same hue,
 *   which is the same step `darkPalette` already makes for error/info/success/
 *   warning;
 * - background tint (a 50-level wash) → a 15% alpha wash of the same hue, which
 *   is the rule `statusColors.dark` in colors.ts already uses;
 * - text-on-tint (an 800-level hue) → the same 400-level value as the dot, which
 *   is what reaches 4.5:1 against a 15% wash on a dark surface;
 * - neutrals lift toward the dark palette's own neutrals rather than darkening.
 *
 * These groups are deliberately **not** exported on their own. The only way to
 * reach a semantic colour is `getMobilePalette(mode)` — a bare export could only
 * ever carry light values, which is exactly how a screen goes on painting a
 * light badge on a dark card.
 *
 * Every pairing below is checked against WCAG 2.1 AA in both modes by
 * `contrast.check.ts`; do not change a value here without re-running it.
 */

type ModePair<T> = { light: T; dark: T };

/**
 * Presence dot colours.
 *
 * `ring` separates the dot from the avatar photo underneath it, so it is the
 * surface the dot sits on — white on a light card, the dark card itself in dark
 * mode. A white ring on a dark card is a bright artefact, not separation.
 */
const presenceByMode: ModePair<{
    online: string;
    away: string;
    busy: string;
    offline: string;
    ring: string;
    ringWidth: number;
}> = {
    light: {
        online: '#16a34a',
        away: '#d97706',
        busy: '#dc2626',
        offline: '#94a3b8',
        ring: '#ffffff',
        ringWidth: 2,
    },
    dark: {
        online: '#4ade80',
        away: '#fbbf24',
        busy: '#f87171',
        offline: '#94a3b8',
        ring: '#1e293b',
        ringWidth: 2,
    },
};

/**
 * Background tints used behind notification-type icons so users can
 * identify the source domain at a glance.
 */
const notificationDomainByMode: ModePair<
    Record<'chat' | 'tasks' | 'calendar' | 'system', { bg: string; icon: string }>
> = {
    light: {
        chat: { bg: '#eff6ff', icon: '#2563eb' },
        tasks: { bg: '#f0fdf4', icon: '#16a34a' },
        calendar: { bg: '#fffbeb', icon: '#d97706' },
        system: { bg: '#f8fafc', icon: '#64748b' },
    },
    dark: {
        chat: { bg: 'rgba(37, 99, 235, 0.15)', icon: '#60a5fa' },
        tasks: { bg: 'rgba(22, 163, 74, 0.15)', icon: '#4ade80' },
        calendar: { bg: 'rgba(217, 119, 6, 0.15)', icon: '#fbbf24' },
        system: { bg: 'rgba(148, 163, 184, 0.15)', icon: '#cbd5e1' },
    },
};

const taskStateByMode: ModePair<
    Record<'todo' | 'inProgress' | 'done' | 'cancelled', { dot: string; bg: string; text: string }>
> = {
    light: {
        todo: { dot: '#94a3b8', bg: '#f8fafc', text: '#64748b' },
        inProgress: { dot: '#2563eb', bg: '#eff6ff', text: '#1e40af' },
        done: { dot: '#16a34a', bg: '#f0fdf4', text: '#166534' },
        cancelled: { dot: '#dc2626', bg: '#fef2f2', text: '#991b1b' },
    },
    dark: {
        todo: { dot: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', text: '#cbd5e1' },
        inProgress: { dot: '#60a5fa', bg: 'rgba(37, 99, 235, 0.15)', text: '#93c5fd' },
        done: { dot: '#4ade80', bg: 'rgba(22, 163, 74, 0.15)', text: '#86efac' },
        cancelled: { dot: '#f87171', bg: 'rgba(220, 38, 38, 0.15)', text: '#fca5a5' },
    },
};

const eventCategoryByMode: ModePair<
    Record<'meeting' | 'personal' | 'holiday' | 'deadline' | 'reminder' | 'other', string>
> = {
    light: {
        meeting: '#2563eb',
        personal: '#7c3aed',
        holiday: '#16a34a',
        deadline: '#dc2626',
        reminder: '#d97706',
        other: '#64748b',
    },
    dark: {
        meeting: '#60a5fa',
        personal: '#a78bfa',
        holiday: '#4ade80',
        deadline: '#f87171',
        reminder: '#fbbf24',
        other: '#94a3b8',
    },
};

const priorityByMode: ModePair<
    Record<'critical' | 'high' | 'medium' | 'low', { bg: string; text: string; dot: string }>
> = {
    light: {
        critical: { bg: '#fef2f2', text: '#991b1b', dot: '#dc2626' },
        high: { bg: '#fffbeb', text: '#92400e', dot: '#d97706' },
        medium: { bg: '#eff6ff', text: '#1e40af', dot: '#2563eb' },
        low: { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8' },
    },
    dark: {
        critical: { bg: 'rgba(220, 38, 38, 0.15)', text: '#fca5a5', dot: '#f87171' },
        high: { bg: 'rgba(217, 119, 6, 0.15)', text: '#fcd34d', dot: '#fbbf24' },
        medium: { bg: 'rgba(37, 99, 235, 0.15)', text: '#93c5fd', dot: '#60a5fa' },
        low: { bg: 'rgba(148, 163, 184, 0.15)', text: '#cbd5e1', dot: '#94a3b8' },
    },
};

/**
 * Scrims and the chrome that floats over media.
 *
 * These are the colours that are *not* a surface from the base palette: the dim
 * behind a bottom sheet, and the bar and controls drawn on top of a photo or a
 * video. `mediaSurface`, `mediaControl`, and `mediaText` are deliberately the
 * same in both modes — a photo is a photo, and chrome over one is always dark
 * with white text, whichever theme the app is in.
 *
 * The group exists so that FR-002 ("no raw colour literals in mobile screens")
 * is satisfiable: before it, twenty-seven call sites each spelled their own
 * near-identical `rgba(...)`.
 */
const overlayByMode: ModePair<{
    scrim: string;
    heavyScrim: string;
    barSurface: string;
    mediaSurface: string;
    mediaControl: string;
    mediaText: string;
}> = {
    light: {
        scrim: 'rgba(15, 23, 42, 0.35)',
        heavyScrim: 'rgba(15, 23, 42, 0.64)',
        barSurface: 'rgba(255, 255, 255, 0.78)',
        mediaSurface: 'rgba(2, 6, 23, 0.94)',
        mediaControl: 'rgba(255, 255, 255, 0.16)',
        mediaText: '#ffffff',
    },
    dark: {
        scrim: 'rgba(2, 6, 23, 0.6)',
        heavyScrim: 'rgba(2, 6, 23, 0.8)',
        barSurface: 'rgba(15, 23, 42, 0.82)',
        mediaSurface: 'rgba(2, 6, 23, 0.94)',
        mediaControl: 'rgba(255, 255, 255, 0.16)',
        mediaText: '#ffffff',
    },
};

// ─── Themed Palette Helper ──────────────────────────────────────────────────

export type MobilePalette = ThemePalette & {
    presence: (typeof presenceByMode)['light'];
    notificationDomain: (typeof notificationDomainByMode)['light'];
    taskState: (typeof taskStateByMode)['light'];
    eventCategory: (typeof eventCategoryByMode)['light'];
    priority: (typeof priorityByMode)['light'];
    overlay: (typeof overlayByMode)['light'];
};

/**
 * Returns the full mobile palette for the given mode, combining the
 * shared palette from colors.ts with mobile-specific semantic tokens.
 *
 * `getMobilePalette('light')` returns byte-identical values to the pre-dark-mode
 * app, for every key that existed then. That is what makes "light is unchanged"
 * a regression gate rather than an opinion.
 */
function buildMobilePalette(mode: 'light' | 'dark'): MobilePalette {
    const base: ThemePalette = mode === 'dark' ? darkPalette : lightPalette;

    return {
        ...base,
        presence: presenceByMode[mode],
        notificationDomain: notificationDomainByMode[mode],
        taskState: taskStateByMode[mode],
        eventCategory: eventCategoryByMode[mode],
        priority: priorityByMode[mode],
        overlay: overlayByMode[mode],
    };
}

/**
 * Exactly two palettes exist, so both are built once and handed out by identity:
 * `getMobilePalette(mode) === getMobilePalette(mode)`. Callers rely on that —
 * it is what makes the palette safe as a `useMemo` dependency on mobile, and it
 * keeps the two style sheets `makeStyles` caches from being rebuilt.
 */
const mobilePalettes: Record<'light' | 'dark', MobilePalette> = {
    light: buildMobilePalette('light'),
    dark: buildMobilePalette('dark'),
};

export function getMobilePalette(mode: 'light' | 'dark'): MobilePalette {
    return mobilePalettes[mode];
}
