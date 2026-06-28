# Mobile Navigation Summary

## Purpose

This document defines the recommended simplified contract for mobile navigation in the Expo Router app.

It keeps the five-tab workspace model, but reduces the amount of synthetic back-routing logic. The goal is to make navigation feel more native and easier to predict for operational users:

- normal in-app movement should behave like a standard stack
- task-linked chat should clearly show its task context
- deep links and notifications should still land on the exact resource
- stack cleanup should happen through clear, repeatable rules instead of ad hoc history rewrites

This is a recommended target behavior for future navigation changes. It intentionally simplifies the earlier `navParent` and `navFallback` heavy model.

## Research-Based Principles

This recommendation is based on the current app structure and the default behavior of Expo Router and React Navigation.

Key guidance:

- Expo Router is stack-first. `router.navigate()` and `router.push()` work best when the app lets stack history behave normally.
- React Navigation explicitly warns against frequent `reset`-style history rewrites because they create confusing back behavior.
- Bottom tabs already support a clean reset pattern: pressing an already focused tab can pop that tab's nested stack to top.
- `popToTopOnBlur` is available, but using it on every tab switch is a stronger reset than many users expect.

Recommended interpretation:

- Prefer real stack history for normal in-app flows.
- Use fallback routing only when the user entered the app cold from outside the current stack.
- Reset history intentionally from tab interactions, not from every detail-to-detail navigation.

## Top-Level Navigation Model

The authenticated mobile app remains organized around five primary tabs:

| Tab | Route Root | Label Shown to User |
|-----|------------|---------------------|
| Chat | `/(app)/(chat)` | `Chat` |
| Tasks | `/(app)/(tasks)` | `Tasks` |
| Calendar | `/(app)/(calendar)` | `Schedule` |
| Notifications | `/(app)/(notifications)` | `Alerts` |
| More | `/(app)/(more)` | `More` |

Expected behavior:

- Signed-out users are redirected to the auth flow.
- Signed-in users work primarily inside these five tab roots.
- Each tab represents a stable work area.
- Navigation inside a tab should normally behave like a standard stack: list -> detail -> subdetail -> back.

## Recommended Mental Model

The app should teach one simple rule:

- If I moved through screens inside the app, Back should usually follow my real history.
- If I opened the app directly from outside, Back should take me to a sensible home for that resource.

That means the app should stop trying to reconstruct a perfect semantic parent for every detail screen. In most cases, the actual stack is already the correct answer.

## Route Ownership

### Tab-Owned Routes

These remain the normal, primary homes for the main work areas:

- Chat channels and threads live under the chat tab.
- Task lists, projects, and task details live under the tasks tab.
- Calendar views and event details live under the calendar tab.
- Alerts remain under notifications.
- Utilities and secondary tools remain under more.

### Shared Resource Routes

The root-level shared stack under `/(shared)` should continue to exist, but its role should be narrower and clearer.

Expected purpose of the shared stack:

- open a resource directly from a notification or deep link
- open a resource from another tab without polluting that source tab's stack
- provide a fallback back target when the user arrived cold and there is no usable in-app history

Current shared resource families:

- `/(shared)/resource/chat/...`
- `/(shared)/resource/tasks/...`
- `/(shared)/resource/calendar/...`

Important simplification:

- Shared routes are entry containers, not a general replacement for real stack history.
- Once a shared route is open, follow normal stack behavior unless there is no stack to go back to.

## Primary Back Behavior

### Rule 1: Prefer Real Stack History

For any screen opened during normal in-app navigation:

- if `router.back()` is available and meaningful, use it
- do not override it just because the app knows the domain parent
- do not attach synthetic parent metadata to every hop

Examples:

- Task list -> task detail -> chat thread: Back should walk back through that actual path.
- Alerts -> task detail -> chat channel: Back should walk back through that actual path.
- Search -> calendar event: Back should return to search if that is how the user got there.

### Rule 2: Use Fallback Only For Cold Entry

If a resource is opened from a push notification, universal link, or other cold external entry, there may be no useful back history.

In that case:

- the screen should expose one fallback destination
- that fallback should usually be the owning work area or the alerts tab
- the fallback is only used when stack history does not exist

This keeps the rule simple:

- first try real back
- if there is no real back path, go to a sensible root

### Rule 3: Avoid Full History Rewrites

Do not treat `reset` or aggressive `replace` chains as the normal solution for deep links or notification opens.

Recommended behavior:

- push or navigate to the exact destination when possible
- use shared routes for cross-context entry
- only use replace-style behavior for authentication gates, invalid routes, or explicit recovery flows

## Lightweight Entry Context

The app still needs some navigation metadata, but much less than before.

Recommended contract:

- keep `navFallback` as a cold-entry fallback route
- keep `navTab` as a lightweight owning-area hint
- keep `navLabel` for the fallback button label when no real back history exists
- stop treating `navParent` as required for normal navigation

Recommended meaning of each field:

| Param | Recommended Meaning |
|-------|---------------------|
| `navFallback` | Where to go only if no usable stack history exists |
| `navTab` | Owning work area for fallback and labeling |
| `navLabel` | Button text for fallback affordances |
| `navParent` | Optional exact parent only for a small number of high-value flows, not the default |

In other words:

- fallback metadata is acceptable
- synthetic parent graphs should be exceptional

## Task Discussion Channels

This is the most important explicit origin relationship that should stay visible in the UI.

If a chat channel is a task discussion channel, the screen should make that obvious even when the user did not arrive from the task screen.

Expected behavior:

- show a clear task discussion treatment near the top of the screen
- identify the linked task by human-readable title, not just an ID
- provide an explicit `View task` action
- keep this affordance visible regardless of whether the channel was opened from Tasks, Chat, Alerts, or a deep link

Why this matters:

- the user should not need back behavior to understand the relationship between the chat and the task
- the task relationship is domain data, not just navigation state
- showing the task link directly is more reliable than trying to reconstruct navigation intent later

Recommended user-facing copy:

- `Task discussion`
- `Open task`
- `Related to task: ...`

Recommended behavior differences by channel type:

- Task discussion: show linked-task summary and task CTA
- DM: no task-origin back affordance
- Group chat: no task-origin back affordance unless the channel is explicitly task-bound

## Deep Links And Notification Opens

### Notification Opens

Notifications should still resolve to the exact resource the user needs.

Expected behavior:

- task notifications open the relevant task
- chat notifications open the relevant channel or thread
- calendar notifications open the relevant event
- the destination should open in a shared route when needed so the app can provide a clean fallback without corrupting a tab stack

Back behavior for notification opens:

- if the notification was opened while the user was already in the app and a real stack exists, follow normal back history
- if the notification opened the app cold, use the configured fallback affordance
- for alert-origin flows, the fallback should usually be `Alerts`

Deep-link entry policy:

- canonical external links that launch the app cold should enter through `/(shared)` so the app can provide fallback behavior without mutating a tab stack
- canonical external links received while the app is already running should prefer the resolved tab-owned route so the bottom tab bar remains visible
- `/(shared)` should therefore be treated as a cold-entry container first, not the default destination for every recognized external link

In-app navigation policy:

- notification taps inside the running app should prefer tab-owned routes with navigation context instead of routing through `/(shared)` by default
- search results, task-discussion CTAs, and internal canonical-link preview taps should also prefer tab-owned routes so the workspace tab bar stays visible
- use `/(shared)` for ordinary in-app navigation only when preserving a distinct cross-context entry container is more important than keeping the tab bar visible

### Canonical And External Links

Canonical links should resolve to the in-app resource route first.

Expected behavior:

- resolve the canonical URL to the exact app route
- convert to a shared resource route when entering from outside the current tab stack
- provide one clear fallback if there is no existing stack

Unsupported resource behavior:

- show a recoverable screen
- explain that the exact mobile view is unavailable
- offer both an in-app fallback and `Open in browser` when possible

## Tab History Strategy

The app should not try to keep one infinite cross-context history.

The recommended strategy is bounded and intentional:

### Default

- each tab keeps its own recent stack during normal use
- cross-tab opens can use shared routes so they do not distort the source tab's local history

### Reset Trigger

The main explicit reset action should be pressing the currently focused bottom tab again.

Expected behavior on focused tab press:

- if the tab has a nested stack, pop it to the tab root
- if the tab is already at its root and has a primary list, scroll that list to top

This matches standard native expectations and gives users a predictable escape hatch.

### Blur Reset

`popToTopOnBlur` should be treated as a product choice, not an automatic rule for every tab.

Recommended use:

- use it only where a fresh return is clearly better than preserving context
- alerts is the strongest candidate for blur reset
- tasks, chat, and calendar often benefit from preserving the user's place until they explicitly reset by re-tapping the tab

Current product decision:

- keep `popToTopOnBlur` enabled across the five main tabs as an intentional simplification
- treat this as a stronger reset model than the preferred long-term UX below
- continue to preserve real stack history inside a focused tab and inside shared resource flows

The preferred long-term UX remains:

- preserve tab state on ordinary switching
- reset on focused-tab reselect

That combination is easier to learn and less surprising.

## Simplified Navigation Contract

For future implementation work, the contract should be:

1. Use normal stack navigation for ordinary in-app movement.
2. Use shared routes for cold entry and cross-tab resource entry.
3. Prefer `router.back()` when real history exists.
4. Use one fallback route only when real history does not exist.
5. Show task relationships as data on the screen, not mainly as back logic.
6. Let focused-tab reselect be the primary history reset gesture.
7. Avoid broad manual history rewrites.

## User Experience Expectations

From a user's perspective, the app should behave like this:

- If I open a task from Tasks, Back returns through the screens I actually used.
- If I open a task from Alerts, Back returns through that path if the app has it.
- If I open a notification cold, I still get one clear way back to the right work area.
- If I open a chat that belongs to a task, I can clearly see that it is a task discussion and open the task directly.
- If I get lost in a tab, tapping that tab again resets me to its main screen.

## Practical Rules For Future Changes

- Preserve the five-tab mental model.
- Keep stack behavior native and unsurprising.
- Use shared resource routes for cross-tab and cold-entry resource opens.
- Reserve explicit parent routing for rare, high-value cases.
- Keep fallback metadata lightweight and entry-focused.
- Treat task-discussion context as visible domain data, not just navigation metadata.
- Prefer tab reselect reset over frequent full-stack rewriting.
- Validate navigation changes in the running app, especially deep link entry, notification entry, focused-tab reselect, and task-linked chat.
