# Research: Unified Color Scheme System with Light/Dark Mode

**Feature**: 013-dark-mode-and-color-scheme  
**Date**: 2025-11-09  
**Status**: Complete

## Research Questions

### 1. Theme Storage Architecture

**Question**: How should theme preferences be stored to support dual storage (server + client) with cross-device sync?

**Decision**: 
- **Server-side (authoritative)**: PostgreSQL table `iam.user_preference` with columns:
  - `id UUID PRIMARY KEY DEFAULT uuidv7()`
  - `organization_id UUID NOT NULL` (multi-tenant isolation)
  - `employee_id UUID NOT NULL` (user FK)
  - `theme_mode TEXT NOT NULL CHECK (theme_mode IN ('light', 'dark'))`
  - `preference_source TEXT NOT NULL CHECK (preference_source IN ('manual', 'os_default'))`
  - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- **Client-side (immediate availability)**: Browser localStorage with key pattern `theme_preference_{employee_id}`

**Rationale**:
- Server-side storage enables cross-device sync (FR-013)
- Composite key `(organization_id, employee_id)` supports multi-tenant isolation per Constitution Principle I
- CHECK constraints enforce valid theme modes per Constitution Principle VIII
- `preference_source` tracks whether theme was manually selected or OS default (needed for FR-017, FR-018 logic)
- localStorage prevents flash of wrong theme (FR-005, NFR-002)

**Alternatives Considered**:
- ❌ Client-side only: No cross-device sync, violates FR-013
- ❌ Server-side only: Blocks initial render, violates NFR-002
- ❌ Separate `user_preferences` table: Over-engineered for single preference type, violates YAGNI (Principle V)

**Existing Patterns**:
- Multi-tenant table structure: See `organization.employee`, `iam.identity`
- User-scoped preferences: New pattern for Tech Office (first user preference feature)

---

### 2. MUI Theme Integration

**Question**: How should MUI theme system integrate with our custom theme preferences?

**Decision**:
- Use MUI's `createTheme()` with two theme objects: `lightTheme` and `darkTheme`
- Wrap application with custom `ThemeProvider` that:
  1. Reads theme preference from localStorage (immediate)
  2. Fetches server-side preference via RPC (authoritative)
  3. Merges with MUI ThemeProvider
  4. Provides `useTheme()` hook for components
- Define theme tokens as TypeScript constants in `packages/ui/src/theme/tokens.ts`
- Use MUI's palette customization for semantic colors (primary, secondary, error, etc.)

**Rationale**:
- MUI v7 has built-in theme switching support via `ThemeProvider`
- Separate theme token files enable reusability for future mobile apps
- MUI palette system provides WCAG-compliant color combinations (FR-008)
- Existing MUI components automatically respond to theme changes (FR-002)

**Alternatives Considered**:
- ❌ CSS variables only: Loses MUI component integration, requires manual styling for all components
- ❌ styled-components: Adds dependency, MUI already uses Emotion
- ❌ Tailwind CSS: Breaking change to existing codebase, violates existing patterns

**Existing Patterns**:
- Current MUI theme: `frontend/apps/web/src/app/components/theme-provider.tsx`
- Extend existing provider rather than replace

---

### 3. Theme Transition Animation

**Question**: How to implement smooth 700ms theme transitions without jarring flicker?

**Decision**:
- Apply CSS transitions to root element with 700ms duration and ease-in-out timing
- Transition specific properties: `background-color`, `color`, `border-color`, `box-shadow`
- Use React's `useTransition` hook to defer non-urgent updates during transition
- Disable transitions during initial page load (class-based opt-out)

**Implementation**:
```css
:root {
  transition: background-color 700ms ease-in-out,
              color 700ms ease-in-out,
              border-color 700ms ease-in-out,
              box-shadow 700ms ease-in-out;
}

:root.no-transition {
  transition: none;
}
```

**Rationale**:
- 700ms duration specified in FR-016
- ease-in-out provides smooth acceleration/deceleration
- Property-specific transitions avoid animating layout (prevents jank)
- Class-based opt-out prevents initial load flicker (FR-005)

**Alternatives Considered**:
- ❌ Instant transition (0ms): Jarring, violates FR-015, FR-016
- ❌ Longer duration (>1s): Feels sluggish, violates NFR-001
- ❌ Animate all properties: Causes layout thrashing, poor performance

**Existing Patterns**:
- No existing transition patterns in Tech Office
- Follow standard CSS transition best practices

---

### 4. OS Preference Detection

**Question**: How to detect and respect OS color scheme preference on first visit?

**Decision**:
- Use CSS media query `@media (prefers-color-scheme: dark)` to detect OS preference
- JavaScript API: `window.matchMedia('(prefers-color-scheme: dark)').matches`
- On first visit (no localStorage, no server preference):
  1. Detect OS preference
  2. Apply detected theme
  3. Save to server with `preference_source: 'os_default'`
  4. Listen for OS preference changes ONLY if `preference_source === 'os_default'`
- On manual theme selection:
  1. Update `preference_source: 'manual'`
  2. Stop listening to OS preference changes
  3. Preserve manual selection (FR-018)

**Rationale**:
- Respects user's system preference (good UX)
- Meets FR-017 (detect on first visit)
- Meets FR-018 (don't override manual selection)
- `preference_source` field distinguishes behavior

**Alternatives Considered**:
- ❌ Always follow OS preference: Violates FR-018, user loses control
- ❌ Never follow OS preference: Poor UX for first-time users
- ❌ No `preference_source` tracking: Can't distinguish manual vs OS default

**Existing Patterns**:
- No existing OS preference detection in Tech Office
- Standard browser API usage

---

### 5. Flash of Wrong Theme Prevention

**Question**: How to prevent FOUT (Flash of Unstyled Theme) during page load?

**Decision**:
- Inline critical theme detection script in `<head>` before render:
  ```html
  <script>
    (function() {
      const stored = localStorage.getItem('theme_preference');
      if (stored) {
        document.documentElement.setAttribute('data-theme', stored);
      } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
      }
    })();
  </script>
  ```
- Use `data-theme` attribute for CSS targeting: `[data-theme="dark"] { ... }`
- Hydrate React theme provider with `data-theme` value to match server/initial render

**Rationale**:
- Synchronous script runs before first paint (prevents FOUT)
- Meets FR-005 (prevent flickering)
- Meets NFR-002 (don't block render - runs in <20ms)
- `data-theme` attribute is SSR-compatible (Next.js App Router)

**Alternatives Considered**:
- ❌ Wait for React hydration: Causes FOUT, violates FR-005
- ❌ Server-side theme detection: Requires cookies, adds complexity, slower than localStorage
- ❌ CSS-only media queries: Can't persist user choice, violates FR-010

**Existing Patterns**:
- Next.js App Router SSR hydration patterns
- Standard blocking script technique for critical CSS

---

### 6. Cross-Device Sync Mechanism

**Question**: How should theme preference changes propagate to other devices/sessions?

**Decision**:
- **Immediate**: Update localStorage and apply theme locally
- **Background**: RPC call to save preference to server
- **Polling**: Other devices poll every 30 seconds via RPC `GetUserPreference` call
- **Optimization**: Use ETag or `updated_at` timestamp to skip unnecessary updates

**Rationale**:
- Meets FR-013 (cross-device sync)
- Optimistic update provides instant feedback (NFR-001)
- 30-second poll interval balances freshness vs server load
- ETag prevents redundant theme applications

**Alternatives Considered**:
- ❌ Server-Sent Events (SSE): Over-engineered for low-frequency updates, adds complexity
- ❌ WebSocket: Same complexity issue, theme changes are rare
- ❌ No polling: Users must refresh to see changes from other devices, poor UX
- ❌ Faster polling (<10s): Unnecessary server load for rare events

**Existing Patterns**:
- Tech Office has SSE for real-time notifications (chat, presence)
- Don't reuse for theme sync - different frequency/criticality profile
- Keep theme sync simple per Principle V (YAGNI)

---

### 7. Component Update Strategy

**Question**: How to systematically update all existing components for theme support?

**Decision**:
- **Phase 1**: Core infrastructure (theme provider, storage, RPC service)
- **Phase 2**: Layout and navigation components (header, sidebar, global search)
- **Phase 3**: Domain components by priority:
  1. Organization domain (most used)
  2. Chat domain (high visibility)
  3. Notifications (high visibility)
  4. Settings page (natural fit)
- **Phase 4**: Forms, inputs, buttons, dialogs (cross-domain)
- **Phase 5**: Data display components (tables, cards, lists)

**Update Pattern** (per component):
1. Replace hardcoded colors with MUI theme values: `theme.palette.primary.main`
2. Use MUI's `sx` prop for dynamic styles: `sx={{ bgcolor: 'background.paper' }}`
3. For custom CSS, use CSS custom properties: `var(--mui-palette-primary-main)`
4. Test both light and dark modes manually
5. Add `data-testid` attributes for accessibility testing (Principle VII)

**Rationale**:
- Phased approach prevents massive PR, enables incremental review
- Priority order addresses most visible components first
- MUI theme values ensure WCAG compliance (FR-008)
- Systematic pattern reduces errors

**Alternatives Considered**:
- ❌ Update all at once: Too large to review, high risk of bugs
- ❌ Update components as discovered: Inconsistent experience, poor UX
- ❌ Create new theme-aware versions: Code duplication, maintenance burden

**Existing Patterns**:
- Many components already use MUI theme via `sx` prop
- Some use hardcoded colors (legacy): `color="#1976d2"`
- Standardize on theme palette values

---

### 8. Existing UI Component Audit

**Question**: Which existing pages and components need to be updated to support the theme system?

**Current UI State Analysis**:

**Pages (8 total)**:
1. `workspace/page.tsx` - Overview page (Tailwind classes)
2. `workspace/organization/page.tsx` - Organization tabs (Tailwind classes)
3. `workspace/organization/import-employees/page.tsx` - Import flow (Tailwind classes)
4. `workspace/notifications/page.tsx` - Notification center (Tailwind + MUI)
5. `workspace/chat/page.tsx` - Chat interface (Tailwind + MUI)
6. `workspace/search/page.tsx` - Global search (Tailwind + MUI)
7. `workspace/settings/notifications/page.tsx` - Push token settings (MUI)
8. `workspace/settings/presence/page.tsx` - Presence settings (MUI)

**Shared Layout**:
- `workspace/layout.tsx` - Header, sidebar, tabs (Tailwind classes)

**Critical Components with Hardcoded Colors** (120+ components analyzed):
- `TabLink.tsx` - Uses `bg-blue-100 text-blue-700`, `text-gray-600 hover:bg-gray-100`
- `MessageItem.tsx` - Uses `hover:bg-gray-50`, `bg-yellow-50` (highlight)
- `ChannelSidebar.tsx` - Uses `bg-white`, `border-gray-200`
- `NotificationPopup.tsx` - Uses `bg-white`, `shadow-lg`
- `GlobalSearchBar.tsx` - Uses `bg-white`, `border-gray-300`
- Notification utils (`packages/notifications/src/utils.ts`) - Domain color badges

**Color Usage Patterns Found**:
1. **Tailwind utility classes** (majority): `bg-white`, `bg-gray-50`, `text-gray-900`, `border-gray-200`
   - These need Tailwind dark mode classes (`dark:bg-gray-800`, `dark:text-white`)
2. **MUI components** (minority): Already theme-aware via `<Box sx={{ bgcolor: 'background.paper' }}>`
3. **Inline styles** (rare): `style={{ backgroundColor: '#fff' }}` - Need conversion

**Decision**: Two-phase migration strategy

**Phase A: Critical Path (Included in Feature 013 Tasks)**:
- workspace/layout.tsx - Header, sidebar, tabs
- TabLink.tsx - Shared navigation component
- Theme-agnostic MUI components (already compatible)

**Phase B: Progressive Enhancement (Post-Feature 013)**:
- Individual page components (8 pages)
- Domain-specific components (chat, notifications, organization)
- Package utilities (notification colors)

**Implementation Strategy**:
1. Define Tailwind dark mode config in `tailwind.config.js`
2. Add `dark` class to root `<html>` element based on theme preference
3. Update critical components with dark mode classes
4. Create migration guide for remaining components
5. Use automated tools (e.g., regex scripts) to batch-update Tailwind classes

**Rationale**:
- Progressive migration prevents "big bang" refactor
- MUI components already theme-aware (minimal work)
- Tailwind dark mode is additive (non-breaking for light mode)
- Critical path (layout + navigation) ensures consistent header/tabs
- Remaining components degrade gracefully (stay light until updated)

**Alternatives Considered**:
- ❌ Update all 120+ components in Feature 013: Too large, delays delivery
- ❌ No component updates: Broken UX with inconsistent theming
- ✅ Two-phase approach: Ship functional theme toggle, iterate on component coverage

**Documentation Output**:
- `specs/013-dark-mode-and-color-scheme/component-migration-guide.md` (Phase B reference)

---

### 9. Mobile Application Guidelines

**Question**: What guidelines should be documented for future mobile app theming?

**Decision**: Create `specs/013-dark-mode-and-color-scheme/mobile-theming-guidelines.md` with:
- **Design Tokens**: Export TypeScript theme tokens to JSON for React Native consumption
- **Storage**: Platform-specific (AsyncStorage for React Native, UserDefaults for iOS, SharedPreferences for Android)
- **Sync**: Same RPC service (`PreferenceService`), same dual-storage pattern
- **OS Integration**: Native dark mode support (iOS 13+, Android 10+)
- **Platform Differences**: Document iOS/Android system theme behavior differences
- **Migration**: If building native apps, use platform APIs; if React Native, adapt web theme provider

**Rationale**:
- Meets user requirement: "guidelines for mobile application theming"
- Documentation-only (no implementation) per user request
- Reuses backend RPC service (no mobile-specific backend work)
- Design tokens enable cross-platform consistency

**Alternatives Considered**:
- ❌ No documentation: Leaves future mobile devs without guidance
- ❌ Implement mobile app now: Out of scope, no mobile app exists yet
- ❌ Different backend service: Violates DRY, creates sync inconsistencies

**Existing Patterns**:
- No mobile apps in Tech Office yet
- Design guidelines are forward-looking

---

## Research Summary

**All questions resolved**. Key decisions:
1. Dual storage: PostgreSQL (server, authoritative) + localStorage (client, immediate)
2. MUI theme integration with custom ThemeProvider wrapper
3. 700ms CSS transitions with class-based opt-out for initial load
4. OS preference detection on first visit only, preserve manual selection
5. Inline script prevents FOUT, `data-theme` attribute for SSR compatibility
6. 30-second polling for cross-device sync (no SSE/WebSocket complexity)
7. **Component audit completed**: 8 pages, 120+ components analyzed
8. **Two-phase migration**: Phase A (critical path in Feature 013), Phase B (progressive enhancement)
9. Mobile guidelines document for future implementation

**Component Update Scope**:
- **Phase A (Feature 013)**: workspace/layout.tsx, TabLink.tsx, Tailwind dark mode config
- **Phase B (Post-013)**: 8 workspace pages, 100+ domain components (chat, notifications, organization)
- **Already Compatible**: MUI components using theme palette (no changes needed)

**No blockers**. Ready for Phase 1 (Design & Contracts).
