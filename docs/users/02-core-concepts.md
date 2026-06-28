# Core Concepts

Last reviewed: 2026-06-18

Tags: `core-concepts`, `organization`, `employees`, `departments`, `permissions`, `projects`, `tasks`, `rituals`, `notifications`, `chat`, `docs`, `files`, `calendar`, `links`

These concepts appear across the web app, mobile app, notifications, permissions, and task guides.

## Organization

An organization is the top-level workspace. Employees, departments, projects, documents, files, calendar events, chat channels, notifications, and permissions all belong to an organization.

Users can belong to more than one organization. When they switch organizations, TechOffice issues a new organization-scoped session so actions are applied to the correct workspace.

## Employees and Org-Managed Accounts

An employee is the person record inside the organization. Some employees sign in with email/password or SSO. Others can use an organization-managed account with a login identifier and six-digit PIN. PIN accounts are useful for frontline, temporary, shared-device, or low-email workflows.

## Departments

Departments model the reporting structure: Operations, Sales, Support, Store A, Night Shift, or any other hierarchy that fits the business. Departments are used for organization charts, employee grouping, manager assignment, search, permissions, and notification targeting.

## Roles and Permissions

Roles are permission bundles. Permissions describe concrete actions such as inviting users, managing roles, creating projects, submitting evidence, managing calendar resources, or deleting files.

The common mental model is:

- **Owner**: Full setup and recovery authority.
- **Operator**: Day-to-day administration, people operations, and workflow management where granted.
- **Employee**: Daily work, chat, tasks, docs, calendar, and self-service profile actions.
- **Project member roles**: Additional access inside a specific project without requiring global operator access.

## Projects

Projects are work containers. A project can contain tasks, workflow states, task levels, members, saved views, custom fields, workflow rules, attached files, linked discussions, and ritual definitions.

Project visibility controls who can discover or join the work:

- **Public**: Visible to organization members.
- **Private**: Restricted to project members.

Project collaboration mode shapes the default experience:

- **Standard**: One-off work and boards.
- **Ritual**: Recurring operational work and evidence.
- **Mixed**: Both standard and ritual work in one project.

## Tasks and Rituals

A standard task is one piece of work. It can have assignees, watchers, state, hierarchy, custom fields, files, and comments.

A ritual definition is a recurring template. TechOffice generates ritual task instances from that template. Ritual instances can require evidence, such as text, files, checklist values, location, or other proof before review or completion.

## Notifications and Presence

Notifications are the cross-workspace inbox. They route chat mentions, replies, task assignments, ritual evidence status, calendar invites, document activity, file events, and other work signals.

Presence shows whether someone appears online, idle, offline, or intentionally hidden. Presence also helps route live chat indicators and notifications.

## Chat, Voice, and Channels

Channels are shared conversation spaces. Direct messages are private one-on-one channels. Chat supports messages, replies, reactions, mentions, typing indicators, file attachments, notification preferences, voice messages, and live voice calls.

Some channels are related to projects, tasks, rituals, or calendar events. When a channel has a related resource, the interface should make that relationship visible so users can move between conversation and work.

## Docs, Citations, and Embeds

Docs are hierarchical knowledge pages. They support rich editing, version history, comments, access controls, followers, reactions, line-range citation links, and embedded excerpts.

Current citations are based on rendered document line ranges, such as `#L10` or `#L10-L15`. When pasted into another document, a citation can become an embedded live excerpt if the viewer has access.

## Files

Files are stored with metadata, validation, access rules, deletion history, quotas, content indexing, and optional PDF conversion. Upload flows are owned by the domain where the file is attached: chat attachments, task files, evidence files, and future document or event attachments.

## Calendar and Scheduling

Calendar events support attendees, RSVP, recurrence, resources, working hours, free/busy lookup, slot suggestions, booking links, delegation, check-in, evidence, audit history, and overlays from related work.

## Context Rail

The Context Rail is the right-side workspace panel on web. It shows global context and page-specific details without forcing users to leave the page they are working on.

Examples:

- In chat, it can show channel members, pinned messages, shared files, or related work.
- In calendar, it can show selected event details and RSVP actions.
- In projects and tasks, it can show task details, evidence, activity, or project summaries.

The latest specs continue to refine the rail into a consistent guide anchor across every workspace area.

## Resource Links

TechOffice uses canonical resource links so a task, channel, message, document, file, or event can be opened from web, mobile, notifications, or external tools. If the user is signed out, the link should return them to the resource after sign-in. If access is missing, the app should show a clear access state.
