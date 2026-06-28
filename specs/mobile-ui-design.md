# Mobile App UI & Layout Design — Low-Tech Worker Edition

**Target**: Employees performing day-to-day tasks on common phones (360–430dp width, portrait).
**NOT for mobile**: Admin/config features (departments, import, IAM, billing) → web only.

---

## 1. Feature Scope: Web → Mobile Mapping

| Web Feature | Mobile? | Rationale |
|---|---|---|
| Chat (channels, DMs, threads) | **YES — Tab 1** | Core daily communication |
| Tasks / Projects | **YES — Tab 2** | Daily task tracking |
| Calendar / Events | **YES — Tab 3** | View schedule, check in/out |
| Notifications / Alerts | **YES — Tab 4** | Stay informed on updates |
| Profile | **YES — More** | View/edit own profile |
| Global Search | **YES — Global Layout** | 1-tap access from every tab |
| Documents (view only) | **YES — More** | Reference docs on the go |
| Files (view/download) | **YES — More** | Access shared files |
| Settings (notifications, presence) | **YES — More** | Personal preferences |
| ~~Overview Dashboard~~ | **NO** | Information-dense, web-optimized |
| ~~Organization Management~~ | **NO** | Admin-only (departments, members) |
| ~~Employee Import~~ | **NO** | Admin-only bulk operation |
| ~~IAM / Permissions~~ | **NO** | Admin-only configuration |
| ~~Docs Editing / Version Compare~~ | **NO** | Complex editor, web-suited |
| ~~File Management (quotas, admin)~~ | **NO** | Admin storage management |
| ~~CRM / Finance / HR~~ | **NO** | Future modules, not day-to-day |

---

## 2. Bottom Tab Bar — 5 Tabs

The current 5-tab setup is well-suited for the scope. Keep it as-is:

```
┌─────────┬─────────┬──────────┬─────────┬─────────┐
│  💬     │  ✅     │  📅      │  🔔     │  •••    │
│  Chat   │  Tasks  │ Calendar │ Alerts  │  More   │
└─────────┴─────────┴──────────┴─────────┴─────────┘
```

**Design rules**:
- Icons: SF Symbols (filled variant when selected)
- Text labels: **always visible** under icons — never icon-only tabs
- Active tint: `#1976d2` (blue) — maintains current theme
- Badge on Alerts: shows unread count (capped at "99+")
- Minimum tap target: 48×48dp per Apple/Google guidelines
- Tab bar always visible (no auto-hide)

---

## 3. Global Search — Accessible From Every Tab

Search is a **universal escape hatch**: "I know the name but not where it is."
Currently buried in the More tab (2 taps). It must be promoted to the global layout.

### Placement: Tappable Search Pill

A non-editable pill displayed at the top of the three primary list screens
(Chat, Tasks, Calendar). Tapping opens the full-screen search modal.

```
┌──────────────────────────────────┐
│ Chat                    [+] [✉️] │
├──────────────────────────────────┤
│ 🔍 Search people, tasks, chats… │  ← Tappable pill (not a real input)
├──────────────────────────────────┤
│      (tab content continues)     │
```

**Why a pill and not a persistent text field?**
- A real input steals focus, triggers keyboard — wasteful when just scrolling.
- The pill is a large 48dp tap target with clear placeholder text.
- Opening the search dedicates the full screen to results (better on 360dp).

**Why NOT a 6th tab or a header icon?**
- 5 tabs is the iOS maximum before usability degrades.
- A lone magnifying-glass icon violates the "icon + label" rule. Low-tech
  users may not recognise it without context.
- The pill with text ("Search people, tasks, chats…") is self-explanatory.

### Full-Screen Search Modal

```
┌──────────────────────────────────┐
│ ← Cancel                        │
├──────────────────────────────────┤
│ 🔍 |                            │  ← Auto-focused real input
├──────────────────────────────────┤
│                                  │
│ Recent                           │  ← Before typing: recent items
│ ┌──────────────────────────────┐ │
│ │ 👤 Jane Doe         Person   │ │  ← Domain label on every row
│ │ 💬 #general         Channel  │ │
│ │ ✅ Fix login bug    Task     │ │
│ └──────────────────────────────┘ │
│                                  │
│ ─ ─ ─ after typing 2+ chars ─ ─ │
│                                  │
│ Results                          │  ← Flat ranked list, not grouped
│ ┌──────────────────────────────┐ │
│ │ 👤 John Doe         Person   │ │  ← Icon + name + domain badge
│ │ 💬 #dev-team        Channel  │ │
│ │ 🗨️ "PR merged…"     Message  │ │  ← Preview + sender context
│ │ ✅ WEB-3            Task     │ │
│ │ 📅 Team Standup     Event    │ │
│ └──────────────────────────────┘ │
│                                  │
│ [Clear recent]                   │  ← Footer action
└──────────────────────────────────┘
```

### Design Decisions for Low-Tech Workers

| Decision | Reasoning |
|---|---|
| **Recent items on open** | No blank screen intimidation — show useful content immediately |
| **Flat list, not sectioned** | Fewer headers to parse; domain badge on each row is enough |
| **Domain badge on every row** | "Person", "Channel", "Task", "Event" — no ambiguity about what you tapped |
| **2-char minimum** | Prevents accidental flood; communicated via placeholder: "Type 2+ letters…" |
| **Tap → navigate directly** | Person → DM, Channel → channel, Task → detail, Event → detail |
| **"Cancel" button, not just ←** | Explicit text label for dismissal (not icon-only back arrow) |
| **Persistent in More tab too** | Users who already learned the old path still find it |

---

## 4. Screen-by-Screen Layout Design

### 4.1 Chat Tab

#### Channel List (Home)
```
┌──────────────────────────────────┐
│ Chat                    [+] [✉️] │  ← Header: title + New Channel / New DM
├──────────────────────────────────┤
│ 🔍 Search people, tasks, chats… │  ← Global search pill (tappable)
├──────────────────────────────────┤
│ Needs Attention (4)              │  ← Unread channels, any type
│ ┌──────────────────────────────┐ │
│ │ 📋 WEB-3 Fix login…  ● 2:30p│ │  ← Task channel: 📋 badge + task key
│ │    Jane: "Found the bug"     │ │     linkedResource.displayIdentifier
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 🟢 Bob Lee           ● 2:15p│ │  ← DM: avatar + presence dot
│ │    "Can you check this?"     │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 📋 MOB-12 Dark mode  ● 1:45p│ │  ← Task channels identifiable at a glance
│ │    Tom: "PR is ready"        │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ # general             ● 1:00p│ │  ← Regular channel
│ │    "Meeting moved to 3pm"    │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ Recent                           │  ← Read channels, by recency
│ ┌──────────────────────────────┐ │
│ │ 📋 WEB-5 Add toggle   11:00a│ │
│ │    You: "Done, merged"       │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ # dev-team             10:30a│ │
│ │    "Sprint review at 4"      │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 🟢 Jane Doe            9:00a│ │
│ │    "Thanks!"                 │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ Earlier                          │
│ ...                              │
└──────────────────────────────────┘
```

**Channel grouping & ordering**:

| Group | Content | Sort order |
|---|---|---|
| **Needs Attention** | All channels with unread messages | Task unreads first, then by recency |
| **Recent** | Read channels from today / this week | By recency (`updatedAt` DESC) |
| **Earlier** | Read channels older than this week | By recency (`updatedAt` DESC) |

Within "Needs Attention", task channels (`project_ticket_thread`) sort before
DMs and regular channels. This is a gentle nudge toward task focus without
hiding other conversations. Once a channel is read, it falls to "Recent"
sorted purely by time — no forced pinning.

**Why NOT group by type (Tasks / DMs / Channels)**:
- 3 parallel sections to scan every time — high cognitive load
- Breaks the "what needs my attention now?" mental model
- Low-tech workers need one clear priority: unread first

**Why NOT always pin task channels on top**:
- Stale task channels with no new messages would bury active DMs
- Users learn to ignore the pinned section → defeats the purpose
- Efficiency drops when irrelevant items occupy prime screen space

**Visual differentiation by channel type** (instead of structural grouping):

| Channel Type | Row Appearance |
|---|---|
| `project_ticket_thread` | 📋 badge + task key (`WEB-3`) + task title |
| `direct_message` | Avatar + presence dot (🟢/🟡/⚫) + person name |
| `chat` (public) | `#` prefix + channel display name |
| `chat` (private) | 🔒 prefix + channel display name |

**Key decisions**:
- **72dp minimum row height** — easy tap for all users
- **"Needs Attention" replaces time-based grouping for unreads** — one section for all unread channels
- **Task channels visually tagged** with 📋 and the task key — recognizable without forcing them to the top
- **Single-line preview** of last message (truncated with "…")
- **Presence dots** on DM avatars (🟢 online, 🟡 away, ⚫ offline)
- **Pull-to-refresh** for manual sync
- **FAB or header buttons** for create channel / new DM — clearly labeled

#### Message View
```
┌──────────────────────────────────┐
│ ← # general              ℹ️     │  ← Back + channel name + info
├──────────────────────────────────┤
│                                  │
│  John Doe              2:30 PM  │
│  ┌────────────────────────────┐ │
│  │ Hey team, the update is    │ │  ← Full-width message bubble
│  │ ready for review.          │ │
│  │              👍 2  🎉 1    │ │  ← Reactions inline, tappable
│  │         3 replies →        │ │  ← Thread entry point
│  └────────────────────────────┘ │
│                                  │
│  Jane Smith            2:35 PM  │
│  ┌────────────────────────────┐ │
│  │ Great, I'll check it now!  │ │
│  └────────────────────────────┘ │
│                                  │
├──────────────────────────────────┤
│ [📎] Type a message...   [Send] │  ← Attachment + input + explicit Send btn
└──────────────────────────────────┘
```

**Key decisions**:
- **Full-width messages** — no left/right bubble alignment (saves space, reduces cognitive load)
- **Explicit "Send" button** — never rely on keyboard's return key alone
- **Thread entry** is a clear "3 replies →" link within the message
- **@ mentions** highlighted in blue, tappable to open profile
- **Long-press** for reactions and reply — with haptic feedback
- **Jump to bottom** FAB when scrolled up

#### Thread View
- Full-screen push from message view
- Shows parent message at top (non-editable context)
- Replies listed chronologically below
- Same composer at bottom

---

### 4.2 Tasks Tab

#### Projects List
```
┌──────────────────────────────────┐
│ My Tasks                         │  ← Header
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ 📋 Website Redesign    WEB  │ │  ← Project icon + name + key
│ │    3 tasks assigned to you   │ │     Personal task count
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 📋 Mobile App          MOB  │ │
│ │    1 task assigned to you    │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 📋 Office Setup        OFF  │ │
│ │    5 tasks assigned to you   │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**Key decisions**:
- **"My Tasks" framing** — show only projects where user has tasks (not all org projects)
- **Task count badge** per project (assigned to current user)
- Tap → project task list (filtered to "my tasks" by default)

#### Task List (within a project)
```
┌──────────────────────────────────┐
│ ← Website Redesign   [+ Task]   │  ← Back + project name + create
├──────────────────────────────────┤
│ [My Tasks ▼] [All ▼]            │  ← Simple toggle: my tasks vs all
├──────────────────────────────────┤
│ ● To Do                         │  ← State group header (colored dot)
│ ┌──────────────────────────────┐ │
│ │ ☐ Fix login page bug   WEB-3│ │  ← Checkbox + title + task key
│ │   🏷️ High  👤 You   📅 Mar25│ │     Priority + assignee + due date
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ ☐ Update footer text   WEB-7│ │
│ │   🏷️ Low   👤 You   📅 Mar28│ │
│ └──────────────────────────────┘ │
│                                  │
│ ● In Progress                    │
│ ┌──────────────────────────────┐ │
│ │ ☑ Add dark mode toggle WEB-5│ │
│ │   🏷️ Med  👤 You   📅 Mar26│ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**Key decisions**:
- **Group by state** (To Do / In Progress / Done) — visual kanban in list form
- **Colored dots** per state (gray/blue/green) — immediately recognizable
- **Tap checkbox** = quick state change (move to next state)
- **Tap row** = open task detail
- **"+ Task" button** always visible in header
- **No drag-and-drop** — use explicit state change buttons instead (simpler)
- **72dp row height** minimum

#### Task Detail
```
┌──────────────────────────────────┐
│ ← WEB-3                    ⋮   │  ← Back + task key + overflow menu
├──────────────────────────────────┤
│                                  │
│ Fix login page bug               │  ← Title (large, bold)
│                                  │
│ ┌──────────────────────────────┐ │
│ │ Status    [● To Do     ▼]   │ │  ← Tappable state picker
│ │ Assignee  [👤 You      ▼]   │ │     Tappable assignee picker
│ │ Priority  [🏷️ High     ▼]   │ │     Tappable priority picker
│ │ Due Date  [📅 Mar 25   ▼]   │ │     Date picker
│ └──────────────────────────────┘ │
│                                  │
│ Description                      │
│ ┌────────────────────────────┐   │
│ │ The SSO callback doesn't   │   │
│ │ redirect properly on iOS.  │   │
│ │ Steps to reproduce:...     │   │
│ └────────────────────────────┘   │
│                                  │
│ 💬 Comments (4)                  │
│ ┌────────────────────────────┐   │
│ │ Jane: "Is this related to  │   │  ← Latest 2 comments shown
│ │  the OAuth change?"  2h ago│   │
│ └────────────────────────────┘   │
│ [View all comments]              │
│                                  │
│ 📎 Attachments (1)              │
│ [screenshot.png 📥]             │
│                                  │
├──────────────────────────────────┤
│ [📎] Add a comment...   [Send]  │  ← Comment composer at bottom
└──────────────────────────────────┘
```

**Key decisions**:
- **Metadata fields as large tappable rows** — opens bottom sheet picker
- **Status change is the #1 action** — positioned at top, most prominent
- **Comments at bottom** with inline composer (same pattern as chat)
- **Scroll-based layout** — no tabs within the detail screen
- Quick actions in overflow menu: Watch/Unwatch, Copy Link

#### Ritual Tasks
- Same list layout as regular tasks
- Ritual icon (🔁) badge to distinguish from normal tasks
- Tap opens the ritual task detail (same as task detail layout)

---

### 4.3 Calendar Tab

#### Calendar View
```
┌──────────────────────────────────┐
│ Calendar             [+ Event]   │  ← Header + create button
├──────────────────────────────────┤
│ ◀  March 2026  ▶                │  ← Month/week toggle
│                                  │
│ Mo Tu We Th Fr Sa Su             │
│ .. .. .. .. .. ..  1             │
│  2  3  4  5  6  7  8            │  ← Dot indicators under dates
│  9 10 11 12 13 14 15            │     with events
│ 16 17 18 19 20 21 22            │
│ [23]24 25 26 27 28 29           │  ← Today highlighted
│ 30 31                            │
├──────────────────────────────────┤
│ Today, March 23                  │  ← Selected day's events
│ ┌──────────────────────────────┐ │
│ │ 🔵 9:00 AM                  │ │  ← Color bar + time
│ │ Team Standup                 │ │     Event title (bold)
│ │ 📍 Room A  ⏱️ 30 min        │ │     Location + duration
│ │           [✅ Check In]      │ │  ← Primary action button
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 🟢 2:00 PM                  │ │
│ │ Design Review                │ │
│ │ 📍 Online  ⏱️ 1 hr          │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**Key decisions**:
- **Compact month calendar** at top (takes ~40% of screen)
- **Day's agenda** listed below the calendar grid
- **Dot indicators** on dates that have events (not full event previews in grid)
- **Check In / Check Out** as prominent action buttons on event cards
- **Color-coded events** by category (meeting, personal, holiday, etc.)
- **Swipe left/right** to change months
- **Tap date** to jump to that day's agenda
- **No week view** on mobile — month overview + daily list is simpler

#### Event Detail
```
┌──────────────────────────────────┐
│ ← Event                         │
├──────────────────────────────────┤
│ Team Standup                     │  ← Title (large, bold)
│ Monday, March 23, 2026          │
│ 9:00 AM – 9:30 AM              │
│                                  │
│ 📍 Room A, 3rd Floor            │  ← Location
│ 🔁 Every weekday                │  ← Recurrence
│ 👤 Organized by Jane Smith      │  ← Organizer
│                                  │
│ Attendees (5)                    │
│ ┌────────────────────────────┐   │
│ │ 🟢 Jane Smith (organizer)  │   │
│ │ 🟢 You (accepted)          │   │
│ │ 🟡 Bob Lee (tentative)     │   │
│ │ ⚫ Mary Chen (pending)      │   │
│ │ 🟢 Tom Park (accepted)     │   │
│ └────────────────────────────┘   │
│                                  │
│ Notes                            │
│ Review sprint progress and       │
│ blockers.                        │
│                                  │
├──────────────────────────────────┤
│ [  ✅ Check In  ] [  ❌ Decline ] │  ← Full-width action buttons
└──────────────────────────────────┘
```

**Key decisions**:
- **All info on one scrollable screen** — no tabs
- **Check In is the primary CTA** — large, full-width, at the bottom
- **Attendee list** with presence/RSVP status indicators
- **Simple decline/accept** actions — no "maybe" to reduce decision complexity

---

### 4.4 Alerts Tab (Notifications)

```
┌──────────────────────────────────┐
│ Alerts              [Mark All ✓] │  ← Header + mark all read
├──────────────────────────────────┤
│ [All] [Unread]                   │  ← Simple 2-segment filter
├──────────────────────────────────┤
│ Today                            │
│ ┌──────────────────────────────┐ │
│ │ 💬 Jane mentioned you       │ │  ← Icon + title (bold if unread)
│ │ in #general: "Hey @you..."  │ │     Context preview
│ │                    2:30 PM ● │ │     Time + unread dot
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ ✅ Task WEB-3 assigned      │ │
│ │ "Fix login page bug"        │ │
│ │                    1:15 PM   │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ 📅 Meeting in 15 minutes    │ │
│ │ "Team Standup" at 9:00 AM   │ │
│ │                    8:45 AM   │ │
│ └──────────────────────────────┘ │
│                                  │
│ Yesterday                        │
│ ┌──────────────────────────────┐ │
│ │ 💬 New message from Bob     │ │
│ │ "Can you review the PR?"    │ │
│ │                    5:30 PM   │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**Key decisions**:
- **Simple 2-filter toggle**: All vs Unread — no complex multi-filter dropdowns
- **Grouped by day** (Today / Yesterday / Earlier)
- **Domain icons** (💬 chat, ✅ tasks, 📅 calendar) for instant recognition
- **Tap notification → deep-link** to the relevant screen (channel, task, event)
- **Swipe left to dismiss/mark read** — but also include "Mark All Read" button
- **72dp row height** minimum
- **Bold text for unread**, normal weight for read
- **Pull-to-refresh**

---

### 4.5 More Tab

```
┌──────────────────────────────────┐
│ More                             │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ 🟢 [Avatar]                 │ │  ← User card with presence
│ │    John Doe                  │ │     Name + role/title
│ │    Software Engineer         │ │
│ │    [Edit Profile →]          │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ 🔍  Search             →    │ │  ← Full-width menu rows
│ ├──────────────────────────────┤ │     48dp+ height each
│ │ 📄  Documents           →    │ │     Icon + label + chevron
│ ├──────────────────────────────┤ │
│ │ 📁  Files               →    │ │
│ └──────────────────────────────┘ │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ ⚙️  Settings            →    │ │  ← Separated section
│ ├──────────────────────────────┤ │
│ │ ❓  Help & Support      →    │ │
│ └──────────────────────────────┘ │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ 🚪  Sign Out                 │ │  ← Destructive action, isolated
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**Key decisions**:
- **User card at top** with presence indicator + quick "Edit Profile" link
- **Grouped menu sections**: Features / Settings / Account
- **Large rows** with icon + text label + chevron arrow
- **Sign Out isolated** at bottom (red text, confirm dialog before executing)
- **No grid layout** — vertical list is more scannable for low-tech users

---

## 5. Design System — Tokens & Components

All tokens live in `frontend/packages/theme-tokens/src/` and are shared across web and mobile.
Mobile-specific tokens are in `mobile.ts`; the icon catalog is in `icons.ts`.

### 5.1 Spacing Scale (8dp base unit)

```
 0    →   0dp       0.5  →   4dp       1    →   8dp
 1.5  →  12dp       2    →  16dp       2.5  →  20dp
 3    →  24dp       4    →  32dp       5    →  40dp
 6    →  48dp       8    →  64dp      10    →  80dp
```

**Mobile layout constants** (`mobileLayout`):

| Token | Value | Usage |
|---|---|---|
| `screenPadding` | 16dp | Horizontal/vertical edge inset |
| `cardPadding` | 16dp | Inner padding of cards & groups |
| `cardGap` | 12dp | Vertical space between cards |
| `itemGap` | 8dp | Vertical space between items inside a card |
| `iconTextGap` | 12dp | Horizontal gap: icon ↔ text label |
| `listRowHeight` | 72dp | Standard row (channels, tasks, alerts) |
| `compactRowHeight` | 56dp | Settings rows, secondary lists |
| `headerHeight` | 64dp | Navigation bar height |
| `tabBarHeight` | 56dp | Bottom tab bar (+ safe area) |
| `fabSize` | 56dp | Floating action button diameter |

### 5.2 Touch Targets

| Tier | Size | When to use |
|---|---|---|
| `minTarget` | 44dp | Absolute minimum (inline links, small icons) |
| `comfortable` | 48dp | Standard — list rows, buttons, chips |
| `large` | 56dp | Primary CTAs, FABs, bottom-bar items |

**Rule**: Primary actions (Send, Check In, Create Task) always use the `large` tier.

### 5.2.1 Safe Areas & Header Spacing

Header layout must be **safe-area aware at runtime**. Do not hardcode a notch size.
The device's top/bottom inset should determine how much space is reserved.
Phones without a notch should reclaim that space automatically.

| Rule | Requirement |
|---|---|
| **Top safe area is dynamic** | Read the top inset from the device at runtime. Never assume a fixed 34dp/44dp notch. |
| **Bottom tab safe area is dynamic** | Tab bar height = base tab height + device bottom inset. Flat-top / no-home-indicator phones should not keep phantom padding. |
| **Large-title screens reserve content space automatically** | Root `ScrollView` / `FlatList` / `SectionList` screens under a native large-title header must use automatic content inset adjustment so the first row never sits under the title or status/notch area. |
| **Custom non-scroll headers use SafeAreaView** | If a screen draws its own top chrome instead of using the native navigation header, wrap that region in `SafeAreaView` with `edges={["top"]}`. |
| **Header actions stay out of unsafe corners** | Header buttons must keep at least 8dp inset from the safe edge and provide a 44×44dp minimum touch zone. Do not place tappable controls flush against the notch/status area corner. |
| **Header action count stays small** | Prefer 1 primary action on the right, 2 maximum. Overflow beyond that belongs in a menu or inside the screen body. |

**Practical rule for this app**:
- Chat / Tasks / Calendar / Alerts index screens should rely on the native iOS header for the title area and let the first scrollable content block begin **below** that header automatically.
- Month grids, filter pills, and segmented controls are content, not header chrome. They start below the safe header region, never inside it.
- If a control is important enough to live in the header, give it a full 44dp touch target and extra side inset so it remains tappable on notched iPhones.

### 5.3 Border Radius

| Token | Value | Usage |
|---|---|---|
| `none` | 0 | — |
| `sm` | 4dp | Inputs, small chips |
| `base` | 8dp | Buttons, message bubbles |
| `md` | 12dp | Cards, bottom sheets |
| `lg` | 16dp | Prominent cards, modals |
| `xl` | 24dp | Pills, segment controls |
| `full` | 9999dp | Avatars, dots |

### 5.4 Borders & Separators

| Token | Value | Usage |
|---|---|---|
| `hairline` | 0.5dp | List row dividers (StyleSheet.hairlineWidth) |
| `thin` | 1dp | Card borders, input borders |
| `medium` | 2dp | Selected state, focus ring |

### 5.5 Shadows

| Level | Elevation | Usage |
|---|---|---|
| `none` | 0 | Flat elements |
| `sm` | 1 | Cards in lists (subtle lift) |
| `md` | 3 | Floating cards, action sheets |
| `lg` | 6 | Modals, dialogs, FABs |

### 5.6 Typography Scale

| Preset | Size | Weight | Usage |
|---|---|---|---|
| `screenTitle` | 28dp | Bold (700) | Navigation large title |
| `sectionHeader` | 18dp | Semibold (600) | Group headers in lists |
| `listPrimary` | 16dp | Medium (500) | Row primary text |
| `listSecondary` | 14dp | Regular (400) | Row subtitle / preview |
| `button` | 16dp | Semibold (600) | Button labels |
| `buttonSm` | 14dp | Semibold (600) | Small buttons, chips |
| `caption` | 12dp | Regular (400) | Timestamps, metadata |
| `badge` | 11dp | Bold (700) | Badge count |
| `messageBody` | 16dp | Regular (400) | Chat messages (relaxed line-height) |

### 5.7 Color System

**Core palette** (from `colors.ts`, same for web and mobile):

| Token | Light | Dark | Usage |
|---|---|---|---|
| `primary.main` | `#1976d2` | `#90caf9` | Tabs, links, primary buttons |
| `primary.dark` | `#1565c0` | `#42a5f5` | Pressed states |
| `background.default` | `#f5f5f5` | `#121212` | Screen backgrounds |
| `background.paper` | `#ffffff` | `#1e1e1e` | Card / surface backgrounds |
| `text.primary` | `rgba(0,0,0,0.87)` | `rgba(255,255,255,0.87)` | Primary text |
| `text.secondary` | `rgba(0,0,0,0.6)` | `rgba(255,255,255,0.6)` | Subtitles, timestamps |
| `text.disabled` | `rgba(0,0,0,0.38)` | `rgba(255,255,255,0.38)` | Disabled controls |
| `divider` | `rgba(0,0,0,0.12)` | `rgba(255,255,255,0.12)` | Borders, hairlines |
| `error.main` | `#d32f2f` | `#f44336` | Delete, sign out, errors |
| `success.main` | `#2e7d32` | `#66bb6a` | Online, done, check-in |
| `warning.main` | `#ed6c02` | `#ffa726` | Away, attention |

**Semantic tokens** (mobile-only, in `mobile.ts`):

| Category | Tokens |
|---|---|
| **Presence** | `online` #4caf50 · `away` #ff9800 · `busy` #f44336 · `offline` #9e9e9e |
| **Task state** | `todo` gray · `inProgress` blue · `done` green · `cancelled` red |
| **Priority** | `critical` red · `high` orange · `medium` blue · `low` gray |
| **Event category** | `meeting` blue · `personal` purple · `holiday` green · `deadline` red |
| **Notification domain** | `chat` blue · `tasks` green · `calendar` orange · `system` gray |

### 5.8 Opacity

| Token | Value | Usage |
|---|---|---|
| `pressed` | 0.7 | Tap feedback on buttons/rows |
| `disabled` | 0.38 | Disabled controls |
| `scrim` | 0.5 | Dark overlay behind modals |

### 5.9 Animation Durations

| Token | Value | Usage |
|---|---|---|
| `fast` | 150ms | Checkbox toggle, ripple |
| `normal` | 250ms | Screen push, sheet slide |
| `slow` | 400ms | Modal appear, skeleton shimmer |
| `slower` | 600ms | Onboarding, splash |

### 5.10 Avatar Sizes

| Token | Size | Usage |
|---|---|---|
| `xs` | 24dp | Reactions, typing indicator |
| `sm` | 32dp | Compact rows, chips |
| `md` | 40dp | Standard list rows |
| `lg` | 48dp | Profile card, detail header |
| `xl` | 64dp | Full profile screen |

---

## 6. Icon System — SF Symbols Catalog

Icon names follow the **Apple SF Symbols** naming convention.
Full catalog in `frontend/packages/theme-tokens/src/icons.ts`.

> **Runtime note:** `expo-image@2.4.1` (the version compatible with Expo SDK 53) does
> **not** support the `sf:` prefix. Icons are rendered via `@expo/vector-icons/Ionicons`
> through the **`SFIcon`** wrapper component
> (`frontend/apps/mobile/src/components/ui/sf-icon.tsx`), which maps SF Symbol names to
> their closest Ionicons equivalents. Tab bar icons use Ionicons directly in the layout.

**Design rules**:
1. **Every icon MUST have a text label visible next to it** — no icon-only buttons
2. Icons rendered at **24×24dp** in list rows, **20×20dp** in compact rows
3. Active/selected state uses the **filled variant** of the icon
4. Colors come from the palette — never hardcoded in components
5. All interactive icons have a `testID` for Maestro testing
6. Use `<SFIcon name="symbol.name" size={24} color={...} />` — **not** `<Image source="sf:..." />`

### 6.1 Tab Bar Icons

| Tab | SF Symbol | Filled | Label |
|---|---|---|---|
| Chat | `bubble.left` | `bubble.left.fill` | Chat |
| Tasks | `checkmark.square` | `checkmark.square.fill` | Tasks |
| Calendar | `calendar` | `calendar` | Calendar |
| Alerts | `bell` | `bell.fill` | Alerts |
| More | `ellipsis` | `ellipsis` | More |

### 6.2 Navigation Icons

| Action | SF Symbol | Label | When |
|---|---|---|---|
| Back | `chevron.left` | Back | All drill-down screens |
| Close | `xmark` | Close | Modals, sheets |
| Search | `magnifyingglass` | Search | Search bars, search entry |
| Filter | `line.3.horizontal.decrease` | Filter | List filtering |
| Sort | `arrow.up.arrow.down` | Sort | List sorting |
| Settings | `gearshape` | Settings | Settings entry |
| Info | `info.circle` | Info | Channel/event details |
| Overflow | `ellipsis.circle` | Menu | Header overflow actions |

### 6.3 Chat Icons

| Action | SF Symbol | Label |
|---|---|---|
| Send message | `paperplane.fill` | Send |
| Attach file | `paperclip` | Attach |
| New channel | `plus.bubble` | New Channel |
| New DM | `envelope` | New Message |
| Reply | `arrowshape.turn.up.left` | Reply |
| Thread | `bubble.left.and.bubble.right` | Thread |
| Add reaction | `face.smiling` | React |
| Mention | `at` | Mention |
| Pin message | `pin` | Pin |
| Mute channel | `bell.slash` | Mute |
| Channel marker | `number` | Channel |
| Private channel | `lock` | Private |

### 6.4 Task / Project Icons

| Action | SF Symbol | Label |
|---|---|---|
| Create task | `plus.circle` | New Task |
| Task checkbox | `square` / `checkmark.square.fill` | Mark Complete |
| Project folder | `folder` | Project |
| Assignee | `person` | Assignee |
| Due date | `calendar.badge.clock` | Due Date |
| Priority flag | `flag` | Priority |
| Comment | `text.bubble` | Comment |
| Watch | `eye` | Watch |
| Unwatch | `eye.slash` | Unwatch |
| Subtask | `list.bullet.indent` | Subtask |
| Move state | `arrow.right.circle` | Move |
| Ritual task | `repeat` | Ritual |

### 6.5 Calendar / Event Icons

| Action | SF Symbol | Label |
|---|---|---|
| Create event | `plus.circle` | New Event |
| Check in | `checkmark.circle` | Check In |
| Check out | `arrow.right.circle` | Check Out |
| Decline | `xmark.circle` | Decline |
| Accept | `hand.thumbsup` | Accept |
| Location | `mappin.and.ellipse` | Location |
| Time | `clock` | Time |
| Recurrence | `repeat` | Repeats |
| Attendees | `person.2` | Attendees |
| Organizer | `person.text.rectangle` | Organizer |

### 6.6 Alert / Notification Icons

| Domain | SF Symbol | Label |
|---|---|---|
| Chat message | `bubble.left` | Message |
| Mention | `at` | Mentioned you |
| Task assigned | `checkmark.square` | Task assigned |
| Task comment | `text.bubble` | Comment |
| Calendar event | `calendar` | Event |
| Reminder | `alarm` | Reminder |
| System | `gear` | System |
| Mark read | `checkmark` | Mark Read |
| Mark all read | `checkmark.circle` | Mark All Read |

### 6.7 Profile & More Menu Icons

| Item | SF Symbol | Label |
|---|---|---|
| Profile | `person.crop.circle` | Profile |
| Edit profile | `pencil` | Edit Profile |
| Camera (avatar) | `camera` | Camera |
| Search | `magnifyingglass` | Search |
| Documents | `doc.text` | Documents |
| Files | `folder` | Files |
| Settings | `gearshape` | Settings |
| Help | `questionmark.circle` | Help & Support |
| Sign out | `rectangle.portrait.and.arrow.right` | Sign Out |

### 6.8 Common Action Icons

| Action | SF Symbol | Label |
|---|---|---|
| Add | `plus` | Add |
| Edit | `pencil` | Edit |
| Delete | `trash` | Delete |
| Share | `square.and.arrow.up` | Share |
| Copy | `doc.on.doc` | Copy |
| Download | `arrow.down.circle` | Download |
| Refresh | `arrow.clockwise` | Refresh |
| Cancel | `xmark` | Cancel |
| Confirm | `checkmark` | Confirm |
| Undo | `arrow.uturn.backward` | Undo |

### 6.9 Empty State Icons (48–64dp)

| Screen | SF Symbol | Label |
|---|---|---|
| No messages | `bubble.left.and.text.bubble.right` | No messages yet |
| No tasks | `checkmark.square.trianglebadge.exclamationmark` | No tasks |
| No events | `calendar.badge.exclamationmark` | No events |
| No notifications | `bell.slash` | All caught up |
| No search results | `magnifyingglass` | No results |
| No files | `doc` | No files |
| No documents | `doc.text` | No documents |
| Offline | `wifi.slash` | No connection |

---

## 7. Cross-Cutting UX Patterns

### 7.1 Navigation Patterns

| Pattern | Usage |
|---|---|
| **Bottom tabs** | Primary 5-tab navigation (always visible) |
| **Stack push** | Drill-down within tabs (channel → message → thread) |
| **Modal (present)** | Create forms (new channel, new task, new event) |
| **Bottom sheet** | Pickers (status, assignee, priority, date) |
| **Action sheet** | Destructive/multi-option menus (delete, archive) |

**Rules**:
- Back button always visible on drill-down screens
- Modals use "Cancel" (left) and "Save"/"Create" (right) in header
- No hamburger menus or side drawers
- No auto-redirect past list screens — each tab's index is the landing page
- No nested tabs (tabs within tabs)

### 7.2 Empty States

Every list screen must have a friendly empty state:

```
┌──────────────────────────────────┐
│                                  │
│      [SF Symbol at 48dp]         │
│                                  │
│     No messages yet              │  ← Plain language heading
│     Start a conversation with    │  ← Helpful subtitle explaining
│     your team!                   │     what to do next
│                                  │
│     [  Start Chat  ]             │  ← Single CTA button
│                                  │
└──────────────────────────────────┘
```

### 7.3 Loading States

- **Skeleton screens** (not spinners) for initial loads
- **Pull-to-refresh** indicator for manual refresh
- **Inline loading** for actions (button shows spinner, not full-screen overlay)
- **Optimistic updates** for instant-feeling interactions (send message, change task state)
- **Animation**: skeleton shimmer at 400ms cycle (`duration.slow`)

### 7.4 Error States

- **Inline error banners** at top of screen (not alert dialogs)
- **Retry button** always available
- **Offline banner** (already exists) — persistent at top when no connectivity
- **Never show raw error codes** — always human-readable messages

### 7.5 Pressed / Disabled Feedback

- **Pressed**: opacity drops to 0.7 (`opacity.pressed`) on tap-down
- **Disabled**: opacity 0.38 (`opacity.disabled`), no tap handler
- **Transition**: 150ms (`duration.fast`) for all press states

---

## 8. Interaction Principles for Low-Tech Workers

### 8.1 Minimize Steps
- **Quick actions on lists**: Tap checkbox to change task state (no detail screen needed)
- **Check In from calendar list**: No need to open event detail first
- **Reply from notification**: Deep-link directly to the conversation
- **One-tap send**: Send button always visible, no hidden gestures required

### 8.2 Eliminate Ambiguity
- **Every icon has a text label** — tab bar, menu items, action buttons
- **Buttons say what they do**: "Send Message", "Create Task", "Check In" — not just icons
- **Confirm destructive actions**: "Sign Out?", "Delete message?" with clear Yes/No
- **Status indicators use both color AND text**: "🟢 Online", "🔴 Offline" — not color alone (accessibility)

### 8.3 Consistency Across Screens
- **Same row height** (72dp) everywhere: channels, tasks, notifications, events
- **Same card style** across all screens (same border radius, padding, shadow)
- **Same composer pattern**: Chat message input = Task comment input = consistent
- **Same empty state layout**: illustration + heading + subtitle + CTA
- **Same skeleton loading**: consistent shimmer pattern across all lists
- **Same swipe gestures** (if used): always swipe-left for secondary action
- **Same header pattern**: Title left-aligned, action buttons right-aligned

### 8.4 Forgiveness & Recovery
- **Undo for destructive actions** (toast with "Undo" for 5 seconds)
- **Draft auto-save** for messages and comments
- **Offline queue** for actions taken without connectivity
- **Never lose user input** — form state persisted across back navigation

---

## 9. Screens NOT Built for Mobile (Web-Only)

These explicitly remain web-only per Constitution Principle XIII:

| Feature | Why Web-Only |
|---|---|
| Organization Overview | Dashboard with metrics, charts — information dense |
| Department Management | Org chart, department CRUD — admin config |
| Employee Import (CSV) | Bulk data operation — admin workflow |
| IAM / Roles / Permissions | Complex permission matrix — admin config |
| Document Editor | Rich text editing — needs full keyboard + large screen |
| Document Version Compare | Side-by-side diff — needs wide viewport |
| File Storage Admin | Quota management, access policies — admin config |
| Booking Page Builder | Calendar booking link configuration — admin config |
| Settings > Presence Rules | Complex configuration — admin config |

---

## 10. Summary: Current State vs Proposed Changes

The current mobile app structure (5 tabs: Chat, Tasks, Calendar, Alerts, More) is **already well-aligned** with the feature scope. The key improvements are:

1. **Global Search**: Promote from More tab to a tappable search pill at the top of Chat, Tasks, and Calendar screens — 1-tap access with recent items, flat ranked results, and domain badges on every row
2. **Tasks Tab**: Reframe as "My Tasks" with personal task count per project, quick-toggle checkbox for state changes
3. **Calendar Tab**: Add prominent Check In/Check Out action buttons on event cards
4. **Alerts Tab**: Add "All/Unread" segment filter, domain icons per notification type, swipe-to-dismiss
5. **More Tab**: Replace emoji grid with grouped list rows + user profile card at top + Help & Support link
6. **Consistency pass**: Enforce 72dp row heights, 48dp tap targets, and icon+text labels everywhere
7. **Empty/loading/error states**: Standardize skeleton loading, friendly empty states, inline error banners across all screens
