# TabLink Component

A reusable tab button component that acts as a clickable link, allowing users to navigate between different views/pages in the application.

## Features

- **Link-based Navigation**: Uses Next.js `Link` component for proper routing
- **Right-click Support**: Users can right-click to open tabs in new browser tabs
- **Cmd/Ctrl+Click**: Support for opening in new tabs with keyboard modifiers
- **Active State Detection**: Automatically detects active state based on current pathname
- **Keyboard Shortcuts**: Optional display of keyboard shortcuts
- **Customizable Styling**: Flexible className props for different visual styles
- **Icon/Emoji Support**: Display icons or emojis alongside tab labels
- **Disabled State**: Support for disabled tabs (coming soon features)

## Usage

### Basic Usage

```tsx
import TabLink from '@/components/TabLink';

<TabLink
  id="overview"
  label="Overview"
  icon="📊"
  href="/workspace/organization?tab=overview"
/>
```

### With Active State Control

```tsx
<TabLink
  id="employees"
  label="Employees"
  icon="👥"
  href="/workspace/organization?tab=employees"
  isActive={activeTab === 'employees'}
  onClick={(id) => setActiveTab(id)}
/>
```

### With Keyboard Shortcuts

```tsx
<TabLink
  id="overview"
  label="Overview"
  emoji="🏠"
  href="/workspace"
  shortcut="⌘1"
/>
```

### Disabled State

```tsx
<TabLink
  id="calendar"
  label="Calendar"
  emoji="📅"
  href="/workspace/calendar"
  disabled={true}
/>
```

### Custom Styling

```tsx
<TabLink
  id="projects"
  label="Projects"
  emoji="📋"
  href="/workspace/projects"
  className="px-4 py-2 rounded-lg"
  activeClassName="bg-blue-100 text-blue-700"
  inactiveClassName="text-gray-600 hover:bg-gray-100"
/>
```

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `id` | `string` | Yes | - | Unique identifier for the tab |
| `label` | `string` | Yes | - | Display text for the tab |
| `href` | `string` | Yes | - | Navigation URL |
| `icon` | `string` | No | - | Icon character to display |
| `emoji` | `string` | No | - | Emoji character to display |
| `isActive` | `boolean` | No | Auto-detected | Whether this tab is currently active |
| `shortcut` | `string` | No | - | Keyboard shortcut to display |
| `disabled` | `boolean` | No | `false` | Whether the tab is disabled |
| `className` | `string` | No | `''` | Additional CSS classes |
| `activeClassName` | `string` | No | `'bg-blue-100 text-blue-700'` | Classes for active state |
| `inactiveClassName` | `string` | No | `'text-gray-600 hover:bg-gray-100'` | Classes for inactive state |
| `onClick` | `(id: string) => void` | No | - | Click handler (for normal clicks only) |

## Examples

### Main Navigation (Workspace Layout)

```tsx
const tabs = [
  { id: 'overview', label: 'Overview', emoji: '🏠', path: '/workspace', shortcut: '⌘1' },
  { id: 'organization', label: 'Organization', emoji: '🏢', path: '/workspace/organization', shortcut: '⌘2' },
  // ...
];

<nav className="flex items-center gap-1">
  {tabs.map((tab) => (
    <TabLink
      key={tab.id}
      id={tab.id}
      label={tab.label}
      emoji={tab.emoji}
      href={tab.path}
      shortcut={tab.shortcut}
      className="px-4 py-2 rounded-lg"
    />
  ))}
</nav>
```

### Sub-Navigation (Organization Page)

```tsx
const tabs = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'employees', label: 'Employees', icon: '👥' },
  // ...
];

<div className="flex gap-2">
  {tabs.map((tab) => (
    <TabLink
      key={tab.id}
      id={tab.id}
      label={tab.label}
      icon={tab.icon}
      href={`/workspace/organization?tab=${tab.id}`}
      isActive={activeTab === tab.id}
      onClick={handleTabChange}
    />
  ))}
</div>
```

## Implementation Details

### Active State Detection

The component automatically detects if it's active by comparing the `href` with the current pathname:

- If `isActive` prop is provided, it uses that value
- Otherwise, it checks if the pathname matches the href exactly or starts with the href (for nested routes)

### Link vs Button Behavior

- Normal clicks call the optional `onClick` handler (if provided)
- Cmd/Ctrl+Click and right-clicks use native browser link behavior
- Middle-clicks open in new tab (browser default)
- Disabled tabs render as buttons without href

## Browser Support

- All modern browsers with Link support
- Right-click context menu (native browser feature)
- Cmd/Ctrl+Click to open in new tab
