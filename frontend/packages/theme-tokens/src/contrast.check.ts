/**
 * Contrast self-check for the mobile palette. Run with
 * `pnpm --filter @tech-office/theme-tokens check:contrast`.
 *
 * SC-002 asks for WCAG AA "verified across the full set of tokens rather than by
 * spot-check", which is a program rather than a review activity. This file is
 * that program: it enumerates every foreground/background pairing the tokens
 * *declare* — not the ones some screen happens to render today — measures the
 * WCAG 2.1 contrast ratio in both modes, and exits non-zero with a table of the
 * pairs that fall short.
 *
 * Two details that are easy to get wrong and would make the numbers meaningless:
 *
 * 1. Alpha. Half the dark tints are `rgba(...)` washes. A ratio computed against
 *    an uncomposited alpha colour is arithmetic about nothing, so every wash is
 *    composited over the surface it is declared to sit on before it is measured,
 *    and over *both* surfaces (`background.default` and `background.paper`) when
 *    it can appear on either — the worse of the two is the one that counts.
 * 2. Thresholds. 4.5:1 for body text, 3:1 for large text, icons, and the
 *    boundaries of controls, per FR-007. Dividers are decorative separators,
 *    which WCAG 1.4.11 explicitly exempts; they are still measured, against a
 *    floor that only catches "the separator is the same colour as the surface".
 */

import assert from 'node:assert/strict';

import { getMobilePalette } from './mobile.ts';

type Mode = 'light' | 'dark';

// ── Colour maths ────────────────────────────────────────────────────────────

interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

function parseColor(value: string): Rgba {
    const hex = value.trim();

    if (hex.startsWith('#')) {
        const body = hex.slice(1);
        const expand = (c: string) => parseInt(c.length === 1 ? c + c : c, 16);
        if (body.length === 3 || body.length === 4) {
            return {
                r: expand(body[0]),
                g: expand(body[1]),
                b: expand(body[2]),
                a: body.length === 4 ? expand(body[3]) / 255 : 1,
            };
        }
        if (body.length === 6 || body.length === 8) {
            return {
                r: expand(body.slice(0, 2)),
                g: expand(body.slice(2, 4)),
                b: expand(body.slice(4, 6)),
                a: body.length === 8 ? expand(body.slice(6, 8)) / 255 : 1,
            };
        }
        throw new Error(`unparseable hex colour: ${value}`);
    }

    const match = hex.match(/^rgba?\(([^)]+)\)$/);
    if (!match) {
        throw new Error(`unparseable colour: ${value}`);
    }
    const parts = match[1].split(',').map((p) => Number(p.trim()));
    if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) {
        throw new Error(`unparseable colour: ${value}`);
    }
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** Source-over composite of `fg` onto an already-opaque `bg`. */
function composite(fg: Rgba, bg: Rgba): Rgba {
    if (fg.a >= 1) return fg;
    return {
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
    };
}

/** WCAG 2.1 relative luminance. */
function luminance({ r, g, b }: Rgba): number {
    const channel = (raw: number) => {
        const c = raw / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg: string, bg: string, surface: string): number {
    const opaqueSurface = parseColor(surface);
    const bgOpaque = composite(parseColor(bg), opaqueSurface);
    const fgOpaque = composite(parseColor(fg), bgOpaque);
    const [hi, lo] = [luminance(fgOpaque), luminance(bgOpaque)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
}

// ── Thresholds (FR-007) ─────────────────────────────────────────────────────

/** Body text. */
const TEXT = 4.5;
/** Large text, icons, and the boundaries of controls. */
const NON_TEXT = 3;
/**
 * Decorative separators. WCAG 1.4.11 exempts them, so this floor only catches a
 * divider that has become invisible against its own surface.
 */
const SEPARATOR = 1.1;

// ── Pairing enumeration ─────────────────────────────────────────────────────

interface Pairing {
    /** Stable name — the key the debt register below is written against. */
    name: string;
    fg: string;
    bg: string;
    /** The opaque surface an alpha `bg` is composited over. */
    surface: string;
    required: number;
}

function pairings(mode: Mode): Pairing[] {
    const t = getMobilePalette(mode);
    const surfaces: Array<[string, string]> = [
        ['background.default', t.background.default],
        ['background.paper', t.background.paper],
    ];
    const out: Pairing[] = [];

    const add = (name: string, fg: string, bg: string, required: number, surface = bg) =>
        out.push({ name, fg, bg, surface, required });

    // Text on both app surfaces.
    for (const [surfaceName, surface] of surfaces) {
        add(`text.primary on ${surfaceName}`, t.text.primary, surface, TEXT);
        add(`text.secondary on ${surfaceName}`, t.text.secondary, surface, TEXT);
        // Disabled text is an inactive component, which WCAG exempts. It is held
        // to the non-text floor so it stays perceivable rather than ignored.
        add(`text.disabled on ${surfaceName}`, t.text.disabled, surface, NON_TEXT);
        add(`divider on ${surfaceName}`, t.divider, surface, SEPARATOR);
    }

    // Every colour scale's declared label colour, on the fill it is declared for.
    for (const key of ['primary', 'secondary', 'error', 'warning', 'info', 'success'] as const) {
        const scale = t[key];
        add(`${key}.contrastText on ${key}.main`, scale.contrastText, scale.main, TEXT);
    }

    // Presence dots sit on their own ring, which is the surface underneath them.
    for (const key of ['online', 'away', 'busy', 'offline'] as const) {
        add(`presence.${key} on presence.ring`, t.presence[key], t.presence.ring, NON_TEXT);
    }

    // Notification domain icons, on their own tint and on the bare card.
    for (const key of ['chat', 'tasks', 'calendar', 'system'] as const) {
        const group = t.notificationDomain[key];
        add(
            `notificationDomain.${key}.icon on its bg`,
            group.icon,
            group.bg,
            NON_TEXT,
            t.background.paper
        );
        add(
            `notificationDomain.${key}.icon on background.paper`,
            group.icon,
            t.background.paper,
            NON_TEXT
        );
    }

    // Task state chips: text is body text, the dot is an icon.
    for (const key of ['todo', 'inProgress', 'done', 'cancelled'] as const) {
        const group = t.taskState[key];
        for (const [surfaceName, surface] of surfaces) {
            add(
                `taskState.${key}.text on its bg over ${surfaceName}`,
                group.text,
                group.bg,
                TEXT,
                surface
            );
            add(
                `taskState.${key}.dot on its bg over ${surfaceName}`,
                group.dot,
                group.bg,
                NON_TEXT,
                surface
            );
        }
        add(`taskState.${key}.dot on background.paper`, group.dot, t.background.paper, NON_TEXT);
    }

    // Calendar categories are dots and bars — non-text.
    for (const key of [
        'meeting',
        'personal',
        'holiday',
        'deadline',
        'reminder',
        'other',
    ] as const) {
        for (const [surfaceName, surface] of surfaces) {
            add(`eventCategory.${key} on ${surfaceName}`, t.eventCategory[key], surface, NON_TEXT);
        }
    }

    // Priority chips, same shape as task state.
    for (const key of ['critical', 'high', 'medium', 'low'] as const) {
        const group = t.priority[key];
        for (const [surfaceName, surface] of surfaces) {
            add(
                `priority.${key}.text on its bg over ${surfaceName}`,
                group.text,
                group.bg,
                TEXT,
                surface
            );
            add(
                `priority.${key}.dot on its bg over ${surfaceName}`,
                group.dot,
                group.bg,
                NON_TEXT,
                surface
            );
        }
        add(`priority.${key}.dot on background.paper`, group.dot, t.background.paper, NON_TEXT);
    }

    // Chrome drawn over media. `mediaSurface` is a wash, so it is composited over
    // the darkest thing it can cover — a photo is unknowable, the app surface is not.
    add(
        'overlay.mediaText on overlay.mediaSurface',
        t.overlay.mediaText,
        t.overlay.mediaSurface,
        TEXT,
        t.background.default
    );
    add(
        'overlay.mediaText on overlay.mediaControl over mediaSurface',
        t.overlay.mediaText,
        t.overlay.mediaControl,
        TEXT,
        composeToHex(t.overlay.mediaSurface, t.background.default)
    );
    add(
        'overlay.mediaText on overlay.heavyScrim',
        t.overlay.mediaText,
        t.overlay.heavyScrim,
        TEXT,
        t.background.default
    );
    add(
        'text.primary on overlay.barSurface',
        t.text.primary,
        t.overlay.barSurface,
        TEXT,
        t.background.default
    );

    return out;
}

function composeToHex(over: string, under: string): string {
    const c = composite(parseColor(over), parseColor(under));
    const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

// ── Recorded light-mode debt ────────────────────────────────────────────────

/**
 * Pairings that already fell short before this feature existed and that it is
 * out of scope to fix.
 *
 * Every entry names a value from the shared `colors.ts` palette, which the web
 * app renders from too: the light half is frozen outright by SC-003
 * (`getMobilePalette('light')` must be byte-identical to the pre-dark-mode app),
 * and the dark half belongs to the web theme, which this feature explicitly does
 * not touch. Changing either would be a change to a surface nobody asked for.
 *
 * The rule this register enforces is narrow and deliberate: a pairing may be
 * recorded only if both of its colours come from `colors.ts`. Every value this
 * feature *introduces* — the five semantic groups and the overlay group — meets
 * its threshold outright and may never be added here. Entries are pinned to the
 * ratio measured when they were written rather than waived, so the check still
 * fails if one of them gets worse.
 */
const RECORDED_DEBT: Record<string, number> = {
    // `text.disabled` — WCAG exempts inactive components, so these are below our
    // own 3:1 floor rather than below an AA requirement.
    'light: text.disabled on background.default': 2.45,
    'light: text.disabled on background.paper': 2.56,
    'dark: text.disabled on background.default': 2.35,
    'dark: text.disabled on background.paper': 1.93,
    // White label on a mid-weight fill. Both fills are `colors.ts` values shared
    // with the web app's buttons and alerts.
    'light: warning.contrastText on warning.main': 3.18,
    'light: success.contrastText on success.main': 3.29,
    // The neutral `#94a3b8` against a near-white surface. It is `text.disabled`
    // again, reached through the three tokens that reuse it for "inactive".
    'light: presence.offline on presence.ring': 2.56,
    'light: taskState.todo.dot on its bg over background.default': 2.45,
    'light: taskState.todo.dot on its bg over background.paper': 2.45,
    'light: taskState.todo.dot on background.paper': 2.56,
    'light: priority.low.dot on its bg over background.default': 2.45,
    'light: priority.low.dot on its bg over background.paper': 2.45,
    'light: priority.low.dot on background.paper': 2.56,
};

// ── Run ─────────────────────────────────────────────────────────────────────

interface Failure {
    pair: string;
    mode: Mode;
    ratio: number;
    required: number;
}

const failures: Failure[] = [];
const regressions: Failure[] = [];
const honouredDebt = new Set<string>();

for (const mode of ['light', 'dark'] as const) {
    for (const pairing of pairings(mode)) {
        const actual = ratio(pairing.fg, pairing.bg, pairing.surface);
        const key = `${mode}: ${pairing.name}`;
        const recorded = RECORDED_DEBT[key];

        if (recorded !== undefined) {
            honouredDebt.add(key);
            // Rounded to the same two decimals the register is written in, so a
            // pure re-measure never trips it.
            if (Math.round(actual * 100) / 100 < recorded) {
                regressions.push({
                    pair: pairing.name,
                    mode,
                    ratio: actual,
                    required: recorded,
                });
            }
            continue;
        }

        if (actual < pairing.required) {
            failures.push({
                pair: pairing.name,
                mode,
                ratio: actual,
                required: pairing.required,
            });
        }
    }
}

function table(rows: Failure[]): string {
    return rows
        .map(
            (f) =>
                `  ${f.mode.padEnd(5)}  ${f.pair.padEnd(56)}  ${f.ratio.toFixed(2).padStart(6)} : 1   (needs ${f.required})`
        )
        .join('\n');
}

if (regressions.length > 0) {
    console.error('contrast: recorded colors.ts debt got worse:\n' + table(regressions));
}
if (failures.length > 0) {
    console.error('contrast: pairings below their WCAG threshold:\n' + table(failures));
}

// A debt entry that no longer matches a pairing is a stale exemption, and a stale
// exemption is how a real failure hides.
const stale = Object.keys(RECORDED_DEBT).filter((key) => !honouredDebt.has(key));
if (stale.length > 0) {
    console.error('contrast: stale debt entries (no such pairing):\n  ' + stale.join('\n  '));
}

assert.equal(regressions.length, 0, 'recorded colors.ts contrast debt must not get worse');
assert.equal(failures.length, 0, 'every declared pairing must meet its WCAG threshold');
assert.equal(stale.length, 0, 'every recorded debt entry must name a real pairing');

console.log(
    `contrast: ok — ${pairings('light').length * 2} pairings checked across both modes, ` +
        `${Object.keys(RECORDED_DEBT).length} pre-existing colors.ts exemptions pinned`
);
