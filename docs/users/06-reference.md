# Reference

Look-up material for when you know what you want and need to find it. The task guides are
[in the index](README.md).

---

## Where everything lives on the web

The top bar is the whole navigation. Keyboard shortcuts are shown next to each item.

| Area | Shortcut | What it holds |
|---|---|---|
| **Calendar** | ⌘1 | Events, shifts, resources, booking links |
| **Notifications** | ⌘2 | Everything waiting on you, from every area |
| **Chat** | ⌘3 | Channels, direct messages, task discussions, voice |
| **Tasks** | ⌘4 | Projects, planned work, checklists, review queue, health |
| **Docs** | ⌘5 | The document tree, versions, comments |
| **Files** | ⌘6 | Every attachment, storage usage, deletion |
| **Organization** | ⌘7 | Employees, departments, permissions (admins only) |

The **search box** at the top searches people, departments, channels and messages.

The **right-hand panel** ("Workspace Context") shows who you are, what is next on your
calendar, what work is due today, and unread messages — on every screen. It is deliberately
read-only; it tells you what needs you without becoming a second task list.

**Settings** covers notification preferences and do-not-disturb, presence visibility, and
your light/dark theme, which follows your operating system until you set it yourself.

## Inside a project

Which tabs a project shows depends on the kind of work it holds.

| Tab | What it is for |
|---|---|
| **Overview** | The "what needs me now" summary across planned work and routine operations |
| **Today** | Today's tasks and today's checklist runs, kept separate |
| **Tasks / List** | Every standard task |
| **Board** | The same tasks as columns you drag between |
| **Timeline / Gantt** | Tasks against dates |
| **Calendar** | Tasks and checklist runs on a month grid |
| **Review** | Proof waiting on a reviewer's decision |
| **Health** | Compliance over a date range, per checklist and per person, exportable as CSV |
| **Settings** | Workflow states, task levels, members, custom fields, workflow rules, and — in Ritual and Mixed projects only — **Rituals**, where checklists are defined |

## The mobile app

Five tabs: **Chat**, **Tasks**, **Schedule**, **Alerts**, **More**.

Mobile is built for doing the work, not configuring it. It handles: signing in (including
account ID + PIN), chat and threads, voice calls and voice messages, tasks and checklist
runs including **capturing photo and GPS proof with the phone**, the calendar including
creating events, notifications with push, reading documents, files, search, and your
profile.

Set up the workspace — employees, departments, permissions, ritual definitions, resources —
on the web. There is no admin surface on mobile by design.

## Roles and what they can do

Every workspace starts with three roles. They cannot be deleted.

| | Owner | Operator | Employee |
|---|---|---|---|
| Everyday work: chat, tasks, proof, calendar, docs | ✅ | ✅ | ✅ |
| Review and approve proof | ✅ | ✅ | ✅ |
| Create departments, move people, set managers | ✅ | ✅ | ❌ |
| Invite people by email | ✅ | ✅ | ❌ |
| Create account-ID / PIN accounts | ✅ | ❌ | ❌ |
| Bulk-import employees | ✅ | ❌ | ❌ |
| Manage roles | ✅ | ❌ | ❌ |
| Change storage quota | ✅ | ❌ | ❌ |

You can create your own roles from the same permission catalogue. Most small businesses
never need to.

On top of roles there is **resource-level access**: being allowed to use documents is not
the same as being allowed to open *this* document, and being in the workspace is not the
same as being in *this* private channel. Managing checklists additionally requires being an
admin or owner **on the project**, not just holding the permission.

## Sign-in and account recovery

| Situation | What to do |
|---|---|
| Forgot password (email account) | Use **Forgot password** on the sign-in page. The reset link lasts one hour. |
| Forgot or lost PIN | An admin resets the account, which issues a new temporary PIN and revokes the old one. |
| Locked out after wrong PINs | Wait: 1 minute after 3 tries, 5 after 4, 15 after 5. After 6, an admin must unlock the account. A successful sign-in clears the count. |
| Staff member leaves | Deactivate the account. This invalidates all their sessions immediately. |
| Someone works for two businesses on TechOffice | One login, several workspaces. Switch between them; each has its own roles and data. |

Sessions last 30 days. You can list your active sessions and sign out of one or all of them
from your profile. Signing out is recorded rather than erased, so the trail survives.

## Limits worth knowing

| | Limit |
|---|---|
| Maximum file size | 100 MB by default (owner can change) |
| Storage quota | Set per workspace; unlimited if unset |
| Chat reply depth | One level — you cannot reply to a reply |
| Document nesting | Ten levels |
| Task nesting | Five levels |
| People editing one document at once | Ten |
| Live voice calls per channel | One |
| Checklist runs generated ahead | 30 days by default, per checklist |
| Password (email accounts) | At least 16 characters, with a letter and a number |
| PIN | Exactly six digits |
| Temporary PIN validity | Three days |
| Email invitation validity | Seven days |

## Current gaps

Honest list of things that do not work the way you might reasonably expect. None of them
are secret; all are being worked on.

**Global search does not cover documents, files, tasks or calendar events.** It covers
people, departments, channels and messages. Use the search inside Docs to find a document,
and the project task list to find a task.

**Nothing marks a checklist run overdue on its own.** Lateness is calculated when you look
at the Today view, the review queue or the Health report — accurately — but no notification
fires the moment a deadline passes with nothing submitted. Check the views.

**Calendar reminders only reach people whose app is open**, and the reminder text does not
name the event. Tapping it still lands on the right event. Do not rely on the reminder
alone to get someone to a shift.

**Calendar cannot be muted** in the do-not-disturb settings the way chat, tasks and docs
can.

**Simultaneous document edits are last-write-wins.** You will see who else is in the
document and where their cursor is, but two people typing in the same paragraph will not be
merged word-by-word.

**Task description documents appear in the Docs list.** Documents that belong to a task show
up alongside your real documents, prefixed with `Task:`. They are safe to ignore.

**A project's collaboration mode cannot be changed after it is created.** Picking Standard
and later wanting checklists means making a new project. Choose Mixed if you are unsure.

**A newly created project shows "0 members" on the project list card** until the page is
reloaded. You are in fact its owner; the count on the card is stale.

## Getting a link to a specific thing

Every task, channel, message, thread, project, document, calendar event and booking link has
a shareable URL. Paste it into an email, a message or a QR code and it opens the right thing
on web and on mobile — including for someone who is not signed in yet, who gets sent through
sign-in and then lands where the link pointed.

Tracking parameters are stripped from these links, so a shared link cannot carry stale state
or analytics junk into your workspace.

## Data and safety, briefly

- **Each business's data is separated at the database level**, not by a filter in the
  application. There is no query in TechOffice that can walk from one workspace into
  another.
- **Every uploaded file is virus-scanned**, and a scan that cannot complete fails the file
  rather than letting it through.
- **Deleting is soft and logged** for files, messages, events and checklist runs. Accidents
  are recoverable; deliberate deletions are auditable.
- **Edits keep their history** on messages and documents.
- **Proof carries two timestamps** — the device's and the server's — so a wrong phone clock
  is visible rather than hidden.
