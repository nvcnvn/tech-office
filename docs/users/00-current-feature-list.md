# Current Product Feature List

Last reviewed: 2026-06-18

Tags: `feature-list`, `available now`, `role-dependent`, `mobile in progress`

This page is the plain inventory behind the end-user guides. Use it to check what TechOffice can do today. Use the persona guides when you need step-by-step instructions for a real task.

## How to Read Status

- **Available now**: The backend service and at least one user-facing web or mobile surface exist.
- **Role-dependent**: The feature is available only to users with the required permission, project membership, or resource access.
- **Mobile in progress**: Mobile routes exist, but the web app remains the fuller setup or management workflow.

## Available Feature Groups

### Account Access and Organization Context

TechOffice supports organization registration, organization subdomain lookup, email/password sign-in, Google and Apple SSO, password reset, invitation acceptance, organization switching, active sessions, and PIN-based organization accounts.

Used by:
- Owners or IT admins registering the workspace and first admin account.
- Employees signing in with email, SSO, invitation links, or account ID plus PIN.

### Organization, Employees, Departments, and Permissions

Owners and IT admins can manage employees, import employees in bulk, create individual accounts, create PIN-based accounts, manage departments, assign managers, move employees, and manage permission-backed roles.

Used by:
- Owners or IT admins building the first department structure.
- Owners or IT admins inviting the team and delegating operations safely.

### Notifications, Presence, and Push Delivery

Notifications collect unread work from chat, tasks, rituals, calendar, docs, files, and system activity. The workspace supports read/unread actions, source filters, live delivery, push token registration, and presence visibility.

Used by:
- Employees checking what needs attention today.
- Owners or IT admins confirming that time-sensitive work can reach the right people.

### Chat, Direct Messages, Files, and Voice

Chat supports public and private channels, direct messages, message replies, reactions, edits, deletes, typing indicators, user and department mentions, file attachments, notification preferences, voice messages, and live voice calls.

Used by:
- Employees deciding when to use a direct message, group channel, task discussion, voice message, or live call.
- Owners or IT admins creating team and project communication spaces.

### Projects, Tasks, Rituals, and Evidence

Projects support standard tasks, workflow states, task levels, members, custom fields, workflow rules, board/list/gantt/calendar/analytics views, task files, recurring ritual definitions, generated ritual work, evidence requirements, evidence submission, review, and operational health views.

Used by:
- Owners or IT admins setting up project workflows and recurring operational work.
- Employees completing assigned tasks and submitting evidence.

### Calendar, Scheduling, Resources, and Booking Links

Calendar supports day/week/month/agenda views, event creation, event details, attendees, RSVP, recurrence, working hours, free/busy lookup, slot suggestions, resources, booking links, delegation, check-in, evidence, audit entries, search, and overlays for related work.

Used by:
- Owners or IT admins configuring resources such as rooms, vehicles, or equipment.
- Employees responding to invites and checking schedules.

### Docs and Knowledge Management

Docs support document trees, rich content editing, version history, diffs, line-by-line attribution, access grants, comments, replies, followers, reactions, line-range citation links, embedded sections, active editors, status changes, slug redirects, and search.

Used by:
- Owners or IT admins publishing policies, procedures, and team handbooks.
- Employees finding precise instructions and citing the exact section they used.

### Files and Storage Management

Files support secure download URLs, metadata, batch metadata lookup, file listing, soft deletion with deletion details, batch deletion, quota view/update, validation, access rules, access checks, file search, PDF conversion status/retry, and content indexing status.

Used by:
- Owners or IT admins reviewing storage and cleanup.
- Employees opening files attached to chats, tasks, docs, events, or evidence.

### Search, Links, and Cross-Workspace Navigation

Search covers people, departments, channels, messages, documents, files, and calendar events through current web and mobile entry points. Canonical resource links open supported resources across web and mobile, including sign-in and access fallback states.

Used by:
- Employees finding people, documents, events, files, channels, and messages.
- Any user opening a shared TechOffice link from chat, email, mobile push, or browser.

### Mobile App

The mobile app has five main work areas: Chat, Tasks, Schedule, Alerts, and More. Current routes support authentication, invitation acceptance, PIN setup, chat, threads, voice calls and messages, notifications, tasks, projects, ritual details, calendar viewing and creation, booking links, profile, files, docs, search, and canonical resource links.

Used by:
- Employees responding to alerts, chat, schedule changes, and evidence work from the field.
- Owners or IT admins checking operations while away from the desk.

## Still Iterating

Document these areas carefully until parity and behavior are fully verified:

- Mobile ritual UX for frontline workers and manager review.
- Unified global search ranking across every domain.
- Context Rail consistency across every workspace page.
- Advanced calendar resource governance in every client surface.

## Related Pages

- Start here: [Getting Started](01-getting-started.md)
- Owner and IT admin workflows: [Owner and IT Admin Guide](03-admin-guide.md)
- Employee workflows: [Employee Guide](04-employee-guide.md)
- Lookup reference: [Feature Reference](05-feature-reference.md)
