# Dark Mode Theme Compatibility Fix

**Issue**: Components using hardcoded Tailwind CSS classes (like `text-gray-900`, `bg-white`, `border-gray-200`) do not respond to MUI theme changes, causing visibility issues in dark mode.

**Root Cause**: 
- Application uses **Tailwind CSS v4** alongside **MUI v7**
- Tailwind classes are **static** and don't respond to MUI's theme context
- When switching to dark mode via MUI's `ThemeProvider`, only MUI components update
- Custom components with Tailwind classes remain unchanged, causing text/backgrounds to blend with the background

## Solution Overview

Created a **theme-aware color utility** (`useThemeColors` hook) that:
1. Reads the current MUI theme mode (light/dark)
2. Returns Tailwind-compatible class strings that map to appropriate colors for each mode
3. Provides semantic color tokens that components can use instead of hardcoded classes

### Implementation

**File**: `frontend/apps/web/src/theme/useThemeColors.ts`

```typescript
import { useTheme } from '@mui/material/styles';
import { useMemo } from 'react';

export function useThemeColors() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return useMemo(() => ({
    bg: {
      default: isDark ? 'bg-[#121212]' : 'bg-gray-50',
      paper: isDark ? 'bg-[#1e1e1e]' : 'bg-white',
      hover: isDark ? 'hover:bg-[#2a2a2a]' : 'hover:bg-gray-50',
      // ... more variants
    },
    text: {
      primary: isDark ? 'text-white/[0.87]' : 'text-gray-900',
      secondary: isDark ? 'text-white/60' : 'text-gray-600',
      // ... more variants
    },
    border: {
      default: isDark ? 'border-white/[0.12]' : 'border-gray-200',
      // ... more variants
    },
    primary: {
      main: isDark ? 'bg-[#90caf9]' : 'bg-blue-600',
      text: isDark ? 'text-[#90caf9]' : 'text-blue-600',
      hover: isDark ? 'hover:bg-[#90caf9]/10' : 'hover:bg-blue-50',
      // ... more variants
    }
  }), [isDark]);
}
```

## Components Updated

### ✅ Completed
1. **ChannelSidebar** (`frontend/apps/web/src/app/workspace/chat/components/ChannelSidebar.tsx`)
   - Sidebar background, borders, text colors
   - Category headers and collapsed state

2. **MessageList** (`frontend/apps/web/src/app/workspace/chat/components/MessageList.tsx`)
   - Message area background
   - Channel header text and borders
   - Typing indicator area

3. **ThreadView** (`frontend/apps/web/src/app/workspace/chat/components/ThreadView.tsx`)
   - Thread sidebar background and borders
   - Header text colors

4. **Chat Page** (`frontend/apps/web/src/app/workspace/chat/page.tsx`)
   - Main grid background
   - Empty state text

5. **Workspace Layout** (`frontend/apps/web/src/app/workspace/layout.tsx`)
   - Main container background
   - Header background and borders
   - Left sidebar (Quick Info)
   - Organization name text

6. **TabLink** (`frontend/apps/web/src/components/TabLink.tsx`)
   - Active/inactive tab colors
   - Disabled state colors
   - Made theme-aware by default

### 🚧 Remaining Components to Update

Components that still need theme-aware color updates:

#### High Priority (Visible on Common Pages)
1. **Workspace Pages**
   - `frontend/apps/web/src/app/workspace/page.tsx` - Overview page with stats cards
   - `frontend/apps/web/src/app/workspace/notifications/page.tsx` - Notifications header/content
   - `frontend/apps/web/src/app/workspace/organization/page.tsx` - Organization page

2. **Notification Components**
   - `frontend/apps/web/src/app/workspace/notifications/components/NotificationItem.tsx` - Text colors
   - `frontend/apps/web/src/app/workspace/notifications/components/NotificationEmpty.tsx` - Empty state
   - `frontend/apps/web/src/app/workspace/notifications/components/NotificationFilters.tsx` - Filter buttons
   - `frontend/apps/web/src/app/workspace/notifications/components/SSEConnectionStatus.tsx` - Status indicators

#### Medium Priority (Chat Components)
3. **Chat Components**
   - `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx` - Individual message styling
   - `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx` - Composer area
   - `frontend/apps/web/src/app/workspace/chat/components/TypingIndicator.tsx` - Typing text
   - `frontend/apps/web/src/app/workspace/chat/components/VirtualizedMessageList.tsx` - Empty message text
   - `frontend/apps/web/src/app/workspace/chat/components/UnifiedChannelSearch.tsx` - Search component
   - `frontend/apps/web/src/app/workspace/chat/components/CreateChannelDialog.tsx` - Dialog styling
   - `frontend/apps/web/src/app/workspace/chat/components/StartDMDialog.tsx` - Dialog styling
   - `frontend/apps/web/src/app/workspace/chat/components/InviteMemberDialog.tsx` - Search icon

## How to Update a Component

### Step 1: Import the Hook
```typescript
import { useThemeColors } from '@/theme/useThemeColors';
```

### Step 2: Use the Hook in Component
```typescript
export default function MyComponent() {
  const colors = useThemeColors();
  // ... rest of component
}
```

### Step 3: Replace Hardcoded Classes
Replace patterns like:

**Before:**
```tsx
<div className="bg-white border-gray-200 text-gray-900">
  <h1 className="text-gray-900">Title</h1>
  <p className="text-gray-600">Description</p>
</div>
```

**After:**
```tsx
<div className={`${colors.bg.paper} ${colors.border.default} ${colors.text.primary}`}>
  <h1 className={colors.text.primary}>Title</h1>
  <p className={colors.text.secondary}>Description</p>
</div>
```

### Common Replacements

| Hardcoded Tailwind | Theme-Aware Replacement |
|-------------------|------------------------|
| `bg-white` | `${colors.bg.paper}` |
| `bg-gray-50` | `${colors.bg.default}` |
| `text-gray-900` | `${colors.text.primary}` |
| `text-gray-600` | `${colors.text.secondary}` |
| `text-gray-500` | `${colors.text.hint}` |
| `text-gray-400` | `${colors.text.disabled}` |
| `border-gray-200` | `${colors.border.default}` |
| `hover:bg-gray-50` | `${colors.bg.hover}` |
| `bg-blue-100 text-blue-700` | `${colors.primary.light} ${colors.primary.text}` |

### Alternative: Use MUI Typography
For text elements, you can also use MUI's `Typography` component with `color` prop:

**Before:**
```tsx
<p className="text-gray-600">Secondary text</p>
```

**After (Option 1):**
```tsx
<Typography color="text.secondary">Secondary text</Typography>
```

**After (Option 2):**
```tsx
<p className={colors.text.secondary}>Secondary text</p>
```

## Testing Checklist

After updating a component:

1. **Light Mode Test**
   - [ ] Component renders correctly
   - [ ] All text is readable (proper contrast)
   - [ ] Borders are visible
   - [ ] Hover states work

2. **Dark Mode Test**
   - [ ] Component renders correctly
   - [ ] All text is readable (proper contrast with dark background)
   - [ ] Borders are visible (lighter borders on dark background)
   - [ ] Hover states work

3. **Theme Toggle Test**
   - [ ] Component smoothly transitions when toggling theme (700ms)
   - [ ] No flash of unstyled content
   - [ ] All colors update correctly

4. **Contrast Test**
   - [ ] Run automated WCAG checker (axe DevTools)
   - [ ] Verify 4.5:1 contrast ratio for normal text
   - [ ] Verify 3:1 contrast ratio for large text

## Build Status

✅ **Frontend builds successfully** with current changes
- No TypeScript errors
- Only linter warnings (pre-existing, not related to theme changes)

## Next Steps

1. Update remaining high-priority components (workspace pages, notification components)
2. Update medium-priority chat components
3. Run comprehensive manual testing across all pages
4. Verify WCAG contrast compliance
5. Update tasks.md to mark completed work

## Notes

- **Gradients**: Stat cards with gradients (blue, green, purple, pink) intentionally kept unchanged as they look good in both modes
- **MUI Components**: Components using MUI's `sx` prop or styled system automatically respond to theme changes
- **Performance**: `useThemeColors` uses `useMemo` to avoid unnecessary re-renders
- **Flexibility**: Components can still override colors via `activeClassName`/`inactiveClassName` props if needed
