# Dashboard Layout System

## Overview

The dashboard uses a **tab-based workspace layout** inspired by modern productivity tools. This layout provides:

- 🎯 Single main focus area with tab switching between business domains
- 📊 Persistent right sidebar for contextual information
- ⌨️ Quick keyboard shortcuts (⌘1, ⌘2, etc.)
- 📱 Optimized for wide screens with limited vertical space (13-inch laptops)
- 🎨 Better for deep focus on one domain at a time

## Architecture

```
/dashboard
├── layout.tsx          # Main layout with tab navigation & sidebar
├── page.tsx           # Overview/home page
├── organization/
│   └── page.tsx       # Organization domain page
├── projects/          # Future: Project management
├── chat/              # Future: Team communication
├── calendar/          # Future: Calendar & scheduling
├── crm/               # Future: Customer relationship management
├── finance/           # Future: Financial management
└── hr/                # Future: Human resources
```

## Layout Components

### 1. Top Navigation Bar (`layout.tsx`)
- **Logo & Organization Name**: Displays current organization
- **Tab Navigation**: Domain switchers with keyboard shortcuts
- **Search Bar**: Global search (expandable on focus)
- **User Avatar**: Profile menu access

### 2. Main Content Area
- Full-height scrollable content area
- Adjusts width based on sidebar state
- Hosts the domain-specific page content

### 3. Right Sidebar
- **User Info**: Quick profile overview
- **Upcoming Events**: Next scheduled items
- **Active Tasks**: Current work items
- **Recent Activity**: Team activity feed
- **Quick Stats**: Visual metrics dashboard
- **Toggle Button**: Show/hide sidebar

## Adding a New Business Domain

### Step 1: Enable the Tab in Layout

Edit `/dashboard/layout.tsx` and update the `tabs` array:

```typescript
const tabs: TabConfig[] = [
  // ... existing tabs
  { 
    id: 'projects', 
    label: 'Projects', 
    emoji: '📋', 
    path: '/dashboard/projects', 
    shortcut: '⌘3', 
    enabled: true  // Change to true
  },
];
```

### Step 2: Create the Domain Page

Create a new file: `/dashboard/[domain]/page.tsx`

```tsx
'use client';

import { useRequireAuth } from '@/lib/auth/hooks';

export default function ProjectsPage() {
  const { user } = useRequireAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="h-full bg-white flex flex-col overflow-auto">
      {/* Page Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
            <p className="text-sm text-gray-600">Manage your projects</p>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">
              Filter
            </button>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              + New Project
            </button>
          </div>
        </div>
        {/* Sub-navigation tabs */}
        <div className="flex gap-2">
          <button className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-md text-sm font-medium">
            All Projects
          </button>
          <button className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-sm">
            Active
          </button>
          <button className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-md text-sm">
            Archived
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto">
          {/* Your domain-specific content here */}
        </div>
      </div>
    </div>
  );
}
```

### Step 3: Optional Sub-routes

For complex domains, create nested routes:

```
/dashboard/projects/
├── page.tsx              # Main projects view
├── [id]/
│   └── page.tsx         # Individual project detail
├── board/
│   └── page.tsx         # Kanban board view
└── settings/
    └── page.tsx         # Project settings
```

## Design Patterns

### Page Structure

All domain pages should follow this structure:

```tsx
<div className="h-full bg-white flex flex-col overflow-auto">
  {/* Header: Fixed at top */}
  <div className="p-6 border-b border-gray-200">
    <div className="flex items-center justify-between mb-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Page Title</h1>
        <p className="text-sm text-gray-600">Description</p>
      </div>
      <div className="flex gap-2">
        {/* Action buttons */}
      </div>
    </div>
    <div className="flex gap-2">
      {/* Sub-navigation tabs */}
    </div>
  </div>

  {/* Content: Scrollable */}
  <div className="flex-1 overflow-auto p-6">
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Your content here */}
    </div>
  </div>
</div>
```

### Color System

The layout uses Tailwind CSS with a consistent color palette:

- **Primary**: Blue (buttons, active states)
- **Success**: Green (completed, positive actions)
- **Warning**: Yellow/Amber (in-progress, alerts)
- **Error**: Red (errors, notifications)
- **Neutral**: Gray (text, borders, backgrounds)

### Component Patterns

#### Stat Cards
```tsx
<div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-6 text-white">
  <span className="text-3xl mb-2 block">📊</span>
  <p className="text-3xl font-bold mb-1">42</p>
  <p className="text-sm opacity-90">Description</p>
</div>
```

#### Info Cards
```tsx
<div className="bg-white border border-gray-200 rounded-lg p-6">
  <h2 className="text-lg font-semibold text-gray-900 mb-4">Title</h2>
  {/* Content */}
</div>
```

#### List Items
```tsx
<div className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors">
  <div className="flex items-center gap-3">
    {/* Avatar/Icon */}
    <div>{/* Content */}</div>
  </div>
  <div>{/* Actions */}</div>
</div>
```

## Keyboard Shortcuts

The layout supports keyboard shortcuts for quick navigation:

- `⌘1` - Overview
- `⌘2` - Organization
- `⌘3` - Projects
- `⌘4` - Chat
- `⌘5` - Calendar
- `⌘6` - CRM
- `⌘7` - Finance
- `⌘8` - HR

## Responsive Design

The layout is optimized for:

- **Desktop**: Full layout with sidebar
- **Tablet**: Collapsible sidebar
- **Mobile**: Hidden sidebar by default (toggle button)

## Authentication

All dashboard pages automatically:
- Check authentication via `useRequireAuth()`
- Redirect to login if not authenticated
- Access user and organization data from Zitadel

## Best Practices

1. **Keep pages focused**: Each domain should handle one business area
2. **Consistent headers**: Use the standard header pattern
3. **Use Tailwind classes**: Stay consistent with the design system
4. **Optimize for performance**: Lazy load heavy components
5. **Mobile-first**: Ensure responsive design
6. **Accessibility**: Include proper ARIA labels and keyboard navigation

## Example Domains

### Current Implementations
- ✅ **Overview** (`/dashboard`) - Dashboard home with stats
- ✅ **Organization** (`/dashboard/organization`) - Team management

### Planned Implementations
- 🔜 **Projects** - Task and project management (Jira replacement)
- 🔜 **Chat** - Team communication (Slack replacement)
- 🔜 **Calendar** - Scheduling and events
- 🔜 **CRM** - Customer relationship management (HubSpot replacement)
- 🔜 **Finance** - Accounting and invoicing (QuickBooks replacement)
- 🔜 **HR** - Human resources (BambooHR replacement)

## Related Files

- `/lib/auth/hooks.ts` - Authentication hooks
- `/app/dashboard/layout.tsx` - Main layout component
- `/app/dashboard/page.tsx` - Overview page example
- `/app/dashboard/organization/page.tsx` - Domain page example
- `/app/demos/layout-2-tabs/page.tsx` - Original demo reference
