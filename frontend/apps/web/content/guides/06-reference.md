# Reference

Look-up material for when you know what you want and need to find it. The task guides are
[in the index](README.md).

---

## Where everything lives on the web

The top bar is the whole navigation.

| Area | Label | What it holds | Shown to |
|---|---|---|---|
| **Calendar** | ⌘1 | Events, shifts, resources, booking links | everyone |
| **Notifications** | ⌘2 | Everything waiting on you, from every area | everyone |
| **Chat** | ⌘3 | Channels, direct messages, task discussions, voice | everyone |
| **Tasks** | ⌘4 | Projects, planned work, checklists, health | everyone |
| **Docs** | ⌘5 | The document tree, versions, comments | everyone |
| **Files** | ⌘6 | Every attachment, storage usage, deletion | everyone |
| **Organization** | ⌘7 | Employees, departments, permissions | people who can invite |
| **Reviews** | ⌘8 | Proof waiting on your decision, across every project | people who review proof |

An entry you are not allowed to use is **absent**, not greyed out. Note that the ⌘n text is
currently a label rather than a working shortcut — see [Current gaps](#current-gaps).

The **search box** at the top searches all eight kinds of thing in the workspace: people,
departments, channels, messages, documents, files, work items and calendar events.

The **right-hand panel** ("Workspace Context") shows who you are, what is next on your
calendar, what work is due today, and unread messages — on every screen. It is deliberately
read-only; it tells you what needs you without becoming a second task list.

**Settings** on the web covers your light/dark theme, the devices registered for push,
presence visibility, the people you have blocked, and — for reviewers and owners — reported
content and removal requests. **Do-not-disturb and the mute list are set in the mobile app**
(More → Settings → Notifications); they are stored against you, so they apply everywhere.

Your theme follows your operating system until you set it yourself. One difference worth
knowing: once you have set it explicitly it stays put on both clients, but while it is still
following the OS, the phone picks up a later change to the system setting mid-session and
the web page does not until you reload.

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
| **Review** | Proof waiting on a reviewer's decision, in this project. The **Reviews** tab in the top bar is the same queue across every project you review for |
| **Health** | Compliance over a date range, per checklist and per person, exportable as CSV |
| **Settings** | Workflow states, task levels, members, custom fields, workflow rules, and — in Ritual and Mixed projects only — **Rituals**, where checklists are defined |

## The mobile app

Four tabs: **Chat**, **Today**, **My Work**, **More**.

Two more surfaces are one tap away rather than tabs of their own, to keep the bar narrow on
a small phone:

- **Schedule** opens from the Today header.
- **Alerts** opens from the bell in the Chat header, which carries the unread badge.

Search is the pill at the top of Chat, Today, My Work and Schedule — not a menu row.

Mobile is built for doing the work. It handles: signing in (including account ID + PIN),
chat and threads, voice calls and voice messages, tasks and checklist runs including
**capturing photo and GPS proof with the phone**, reviewing and approving other people's
proof, the calendar including creating events, notifications with push, reading documents,
files, search, the people directory, and your profile.

It also creates the two things a manager needs to start work without a laptop: **projects**
and **ritual definitions**. A ritual created on the phone collects a deliberate subset —
name, description, a daily/weekly/monthly schedule, evidence requirements and assignees —
and a definition configured on the web keeps everything else when it is later opened on a
phone. Archiving and restoring a definition work on mobile; renaming and rescheduling do not.

Everything else about setting the workspace up — employees, departments, permissions, bulk
import, department assignee pools, procedure attachment, resources, reported content and
removal requests — is on the web by design.

A **Team** block appears on Today for anyone who reviews proof and owns or administers at
least one project: that project's late checklist runs, and today's runs with nobody on them.
It shows nothing at all to everybody else.

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
| Password (email accounts) | At least 8 characters, with a letter and a number |
| Preview cards per message | Three; later links stay as plain clickable text |
| Search results | 40 per query by default, at most 5 per kind before narrowing |
| PIN | Exactly six digits |
| Temporary PIN validity | Three days |
| Email invitation validity | Seven days |

## Current gaps

Honest list of things that do not work the way you might reasonably expect. None of them
are secret; all are being worked on.

**The ⌘ shortcuts in the top bar do nothing.** Each navigation entry shows a ⌘n label
beside it, and no key is actually bound. Use the mouse.

**You cannot block someone from the web.** Web Settings lists the people you have blocked
and lets you unblock them, but every way of *starting* a block is on the phone — from a
message action sheet or a person's profile. A block made on the phone is honoured
everywhere.

**The channel list forgets what you missed while you were away.** Unread marks are built
from messages arriving while you have the app open, so signing back in after being offline
shows a clean list even when there are unread messages. Open the conversation to see them.

**A calendar event link opens the calendar on the web, not the event.** The web app has no
per-event page, so a shared event link or an event in search results lands you on the
calendar with the right date. On the phone it opens the event itself.

**Document titles in the Docs sidebar are visible to everyone.** Access controls the
content, the search results, the comments and the history correctly — only the title in the
tree is not scoped. Name a sensitive document dully.

**Mobile check-in asks for location and does not keep it.** Checking in to a shift on the
phone asks for location permission and refuses if you decline, then records only the time.
Nothing stores where you were.

**A project's collaboration mode cannot be changed after it is created.** Picking Standard
and later wanting checklists means making a new project. Choose Mixed if you are unsure.

## Getting a link to a specific thing

Every task, channel, message, thread, project, document, calendar event and booking link has
a shareable URL. Paste it into an email, a message or a QR code and it opens the right thing
on web and on mobile — including for someone who is not signed in yet, who gets sent through
sign-in and then lands where the link pointed. The one exception today is a calendar event
on the web, which lands on the calendar rather than the event; see
[Current gaps](#current-gaps).

Tracking parameters are stripped from these links, so a shared link cannot carry stale state
or analytics junk into your workspace.

Pasted into a conversation, these links become **preview cards** — a task card names its
state and who has it, a document card names the space it is in, an event card shows its start
in *your* time zone. A card appears only if the person reading can open the thing it points
at; if they cannot, they see the plain link and nothing about what is behind it.

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
