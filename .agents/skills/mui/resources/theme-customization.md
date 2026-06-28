# MUI Theme Customization — Tech Office Design System

> **Canonical source**: `frontend/apps/web/src/theme/tokens.ts`
>
> All theme tokens (colors, typography, spacing, component overrides) are
> defined in `tokens.ts`.  When building new components or pages, reference the
> MUI theme — never hard-code hex colours, pixel font sizes, or shadow values.

---

## Design Principles

| Principle              | Rule |
|------------------------|------|
| **High-contrast light** | Slate-900 text on slate-50 backgrounds; WCAG AA (4.5:1) minimum |
| **Flat surfaces**       | `elevation: 0` everywhere; use `1px solid divider` borders instead of box-shadows |
| **Compact radius**      | Global `borderRadius: 6`; cards 8 px; dialogs 8 px |
| **Professional typography** | System font stack; tight letter-spacing on headings; compact body sizes (15 px / 13 px) |
| **No gradients**        | Solid fills only — gradients are banned from the theme |
| **Restrained accents**  | `info.main` (#2563eb) for interactive accents; primary is neutral slate |

---

## Colour Palette (Light Mode)

```
primary     #0f172a / #334155 / #020617   (slate family)
secondary   #475569 / #64748b / #334155
info        #2563eb / #93c5fd / #1e40af   (blue — interactive accent)
error       #dc2626   warning #d97706   success #16a34a
background  default #f8fafc   paper #ffffff
text        primary #0f172a   secondary #64748b   disabled #94a3b8
divider     #e2e8f0
```

## Colour Palette (Dark Mode)

```
primary     #e2e8f0 / #f1f5f9 / #cbd5e1
secondary   #94a3b8 / #cbd5e1 / #64748b
info        #60a5fa / #93c5fd / #2563eb
error       #f87171   warning #fbbf24   success #4ade80
background  default #0f172a   paper #1e293b
text        primary #f1f5f9   secondary #94a3b8   disabled #475569
divider     #334155
```

---

## Typography Scale

| Variant   | Size      | Weight | Tracking      |
|-----------|-----------|--------|---------------|
| h1        | 2 rem     | 700    | -0.025 em     |
| h2        | 1.5 rem   | 700    | -0.02 em      |
| h3        | 1.25 rem  | 600    | -0.015 em     |
| h4        | 1.125 rem | 600    | —             |
| h5        | 1 rem     | 600    | —             |
| h6        | 0.875 rem | 600    | —             |
| body1     | 0.9375 rem| 400    | —             |
| body2     | 0.8125 rem| 400    | —             |
| caption   | 0.75 rem  | 400    | —             |
| overline  | 0.6875 rem| 600    | 0.08 em, CAPS |
| button    | 0.875 rem | 500    | —, no CAPS    |

---

## Component Overrides

All components are configured in the theme so new code inherits the
professional look automatically.  Key decisions:

| Component           | Default | Notes |
|---------------------|---------|-------|
| **Button**          | `disableElevation`, 6 px radius, compact padding | No transform on hover |
| **Paper / Card**    | `elevation: 0`, 1 px divider border | Cards use 8 px radius |
| **AppBar**          | White bg, 1 px bottom border, no shadow | |
| **TextField**       | `size="small"`, 6 px radius, divider-colour border | |
| **Chip**            | 6 px radius, 28 px height | |
| **Dialog**          | 8 px radius, 1 px border, subtle shadow | |
| **TableCell**       | 1 px bottom border, 13 px font, uppercase header | |
| **Tab**             | `textTransform: 'none'`, 40 px minHeight | |
| **IconButton**      | 6 px radius | |
| **Drawer**          | 1 px right border, no shadow | |
| **ListItemButton**  | 6 px radius | |

---

## Theme Provider Architecture

```
RootLayout (app/layout.tsx)
└── MuiThemeProvider (app/components/theme-provider.tsx)
    └── lightTheme from theme/tokens.ts  ← public pages

WorkspaceLayout (app/workspace/layout.tsx)
└── ThemeProvider (components/ThemeProvider.tsx)
    └── getThemeByMode(mode)  ← light OR dark, per-user
        └── theme/tokens.ts   ← same token file
```

Both providers share the **same** token file.  Public pages always use light
mode.  The workspace `ThemeProvider` adds persistence (localStorage + server
sync) and an OS-preference detector.

---

## Using Theme Tokens

### sx prop (preferred)

```tsx
<Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
  <Typography variant="h5">Title</Typography>
  <Typography variant="body2" color="text.secondary">Subtitle</Typography>
</Box>
```

### useThemeColors hook (Tailwind-compatible workspace pages)

```tsx
import { useThemeColors } from '@/theme/useThemeColors';

function Panel() {
  const colors = useThemeColors();
  return (
    <div style={colors.bg.paper.style} className={`border ${colors.border.default.className}`}>
      <span style={colors.text.primary.style}>Content</span>
    </div>
  );
}
```

### useTheme (advanced)

```tsx
import { useTheme } from '@mui/material/styles';

function Component() {
  const theme = useTheme();
  return (
    <Box sx={{
      color: theme.palette.text.primary,
      p: theme.spacing(2),
      borderRadius: `${theme.shape.borderRadius}px`,
    }} />
  );
}
```

---

## Do / Don't

| ✅ Do | ❌ Don't |
|-------|---------|
| `color: 'text.primary'` | `color: '#0f172a'` (hard-coded hex) |
| `bgcolor: 'background.default'` | `background: 'linear-gradient(...)'` |
| `border: 1, borderColor: 'divider'` | `boxShadow: '0 8px 30px ...'` |
| `<Button disableElevation>` (theme default) | `<Button sx={{ boxShadow: '...' }}>` |
| `variant="body2"` for small text | `sx={{ fontSize: '0.8rem' }}` |
| `elevation={0}` on Paper | `elevation={20}` |
| `borderRadius: 1` (6 px via theme) | `borderRadius: '20px'` |

---

## Dark Mode

The workspace uses a custom `ThemeProvider` that:

1. Reads from `localStorage` (instant, optimistic).
2. Fetches from server (authoritative).
3. Falls back to OS preference on first visit.

Toggle via `<ThemeToggle />` which calls `toggleTheme()` from the context.

Both `lightTheme` and `darkTheme` share the same `sharedOptions` (typography,
shape, spacing) and the same `buildComponentOverrides()` function so overrides
stay in sync automatically.
