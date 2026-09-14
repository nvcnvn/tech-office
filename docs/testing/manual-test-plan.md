# Manual test plan

One short, runnable manual pass per feature area. Written to be followed by a person with
a browser and a phone, without reading a spec first.

**Status date: 2026-09-13.** Derived from `docs/domain/` and the code, not from `specs/`.

## How this relates to what already exists

Most of the detailed step-by-step material already exists and is **not** repeated here:

| Material | Where | What it is |
|---|---|---|
| Per-feature validation scripts | `specs/NNN-*/quickstart.md` (61 files) | the manual steps written when each feature was built. Reused by reference below. |
| Automated web flows | `frontend/apps/web/e2e/*.spec.ts` (`make test-frontend`) | Playwright |
| Automated mobile flows | `frontend/apps/mobile/.maestro/` (`make test-mobile`) | Maestro, 27 standing flows |
| Automated backend scenarios | `backend/integration/*_test.go` (`make test-backend`) | Go |

The rule this document follows: **if an automated flow already covers it, do not put it in
a manual pass.** What is here is the part a machine cannot answer — does the product make
sense on a real device, does the copy read correctly, does the thing actually happen.

A spec quickstart is cited where one covers the same ground in more depth. Treat a
quickstart as *intent at the time it was written*; where it disagrees with this document or
with `docs/domain/`, the code wins. Several quickstarts are stale (spec 024 is titled
"passkey" and shipped as PIN; spec 037's payload contract differs from what shipped).

## Before you start

### 1. Bring the stack up

```
make infra-up                     # Postgres, ClamAV, Gotenberg
cd backend && go run ./cmd server # or: make voice-dev-backend for voice work
cd frontend && pnpm --filter web dev
```

### 2. Seed a workspace

Two fixtures exist; use the one that matches what you are testing. Neither is assembled by
hand, and both are idempotent — re-run rather than reset.

```
cd backend
go run ./cmd seed-demo-org --subdomain demo      # store-review workspace, three credentials
go run ./cmd seed-maestro-fixture > ../frontend/apps/mobile/.maestro/.env
```

`seed-demo-org` leaves: an owner (`owner@demo.demo.invalid`), a **spare** owner
(`spare@demo.demo.invalid`, the one to delete when testing account deletion), and
`demo-worker` with a permanent PIN. It seeds a `General` project with six work items, and a
`Site operations` ritual project with one overdue instance and one unassigned instance due
today. Do not use the `demo` workspace for tests that block people or deactivate accounts —
that is what the `maestro` workspace is for.

### 3. Know the two clocks

Several surfaces are date-sensitive and resolve "today" differently: the mobile Today tab
and the ritual sweeps use the **device's** local date, while `GetAssignedWorkSummary` uses
the **server's**. On a machine far from UTC, run date-sensitive cases in the afternoon, or
expect a one-day disagreement in the early morning and check which clock the surface uses
before filing a bug.

### 4. Background work is not instant

| Sweep | Cadence | What it does |
|---|---|---|
| `ritual_generation_sweep` | 1 min | materialises upcoming ritual instances |
| `ritual_shift_resolution_sweep` | 2 min | binds on-shift ritual assignments |
| `ritual_reconciliation_sweep` | 5 min | writes `overdue`, then `missed`, and notifies |
| `CalendarReminderWorkflow` | 1 min | fires due event reminders |
| rescue push worker | 1 s tick | sends the push the live stream did not confirm |

Wait the cadence before calling something broken. Anything queued on `flows` can also wait
up to ~32 s for its shard to be polled.

---

## MT-1 · Sign-in and accounts

Reuse: `specs/002-continue-user-signin/quickstart.md`,
`specs/024-supporting-passkey-based-login-for/quickstart.md` (read as PIN, not passkey),
`specs/035-mobile-owner-onboarding/quickstart.md`,
`specs/058-signin-error-copy/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 1.1 | On web `/signup`, register a workspace. Use a 8-character password with a letter and a number. | Accepted. The workspace address is derived from the company name; a taken address is refused naming the `subdomain` field and offers the next free variant. You land back on `/signin`. |
| 1.2 | Sign in with the address, email and password. | Lands on `/workspace/calendar`. |
| 1.3 | As owner, create a managed account (Organization → Employees → Add Single Employee → Managed Account). | A six-digit temporary PIN is shown **once**. Note it. |
| 1.4 | Sign in on mobile with workspace → that account ID → the temporary PIN. | Forced to choose a new PIN. A PIN equal to the person's date of birth or the last six digits of their phone is refused. |
| 1.5 | Sign in with the same account using its **email** in the identifier field. | Accepted — the field takes an account ID *or* an email. |
| 1.6 | Enter a wrong PIN 3, 4, 5 then 6 times. | Locked 1 min, 5 min, 15 min, then fully locked needing an admin unlock. Tiers 1–3 show a live countdown. A successful sign-in clears the count. |
| 1.7 | While the account is fully locked, sign in to the same person's **email** credential. | Accepted — email sign-in is not gated by PIN lockout. This is the way back in. |
| 1.8 | Sign out of mobile, relaunch. | The sign-in screen is PIN-first and shows the remembered name and workspace, six PIN boxes, keypad focused. "Not you?" clears it. |
| 1.9 | With `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` unset, open mobile `signin`. | No provider buttons, no "or continue with" divider — just the email form. No message mentions builds, SDKs or environment variables. |
| 1.10 | Profile → active sessions; sign out of one, then all. | Sessions listed with device and last activity; signing out invalidates immediately. |

## MT-2 · People, departments, roles

Reuse: `specs/003-feature-import-employees/`, `specs/004-import-employee-with/quickstart.md`,
`specs/005-employee-listing-page/quickstart.md`, `specs/006-organization-departments-ver/quickstart.md`,
`specs/025-departments-org-chart/quickstart.md`, `specs/048-people-directory-mobile/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 2.1 | Organization → Employees → Import Employees. Upload a CSV with one deliberately bad row. | The preview names the failing row **before** anything is written. Committing writes only accepted rows. Owner-only — an operator does not see the button. |
| 2.2 | Create three departments, assign people, set one manager each. | Tree renders with member and manager counts. |
| 2.3 | Move a department under another. | Moves with its members; a department cannot be its own parent. |
| 2.4 | Delete a department that has a child. | Refused (`ON DELETE RESTRICT`). |
| 2.5 | Mobile More → People. | Directory lists the active roster alphabetically. Search narrows it. A person's entry shows name, department, role, presence, email, and a phone row **only when a number is recorded**. Message opens the DM; your own row offers neither Message nor Call. |
| 2.6 | Sign in as someone without `iam.listEmployees` and open More. | The People row is **absent**, not disabled. |
| 2.7 | Deactivate an account, then reopen the directory. | The person is gone from it, and their sessions are invalid immediately. |
| 2.8 | Organization → Permissions: create a custom role, assign it, sign in as that person. | Only the granted actions are reachable. Owner's role-management permissions cannot be removed. |

## MT-3 · Chat, threads, files in a conversation

Reuse: `specs/009-chat-backend/quickstart.md`, `specs/010-chat-frontend-and-notification/quickstart.md`,
`specs/046-chat-link-previews/quickstart.md`, `specs/038-chat-task-quick-action/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 3.1 | Post a message, reply to it, then try to reply to the reply. | Threading is exactly one level — there is no reply control on a reply. |
| 3.2 | Edit a message, then delete it. | Edited is marked and keeps history; deleted leaves a placeholder. |
| 3.3 | Mention a department. | Everyone in the department is notified. |
| 3.4 | Attach a photo in a **private** channel. Ask someone outside the channel to open the link. | Refused. Who can open it comes from the channel, with no per-file setting to get wrong. |
| 3.5 | Paste a canonical task link, a document link and an event link into one message. | Up to three preview cards, in link order. A link to something the **reader** cannot see renders no card and stays clickable as raw text. The same resource linked twice gives one card. |
| 3.6 | Paste four canonical links. | The fourth stays raw text. |
| 3.7 | Long-press a message on mobile → create task. | A bottom sheet opens pre-filled with the message text, without stealing focus. The created task appears as a chip on the message and the message appears as an origin block on the task. |
| 3.8 | Convert a second message in the same channel. | The project is remembered from the first conversion; overriding it for one conversion does not change the channel's default. |
| 3.9 | Set a channel to *mentions only*, then to *muted*, and have someone post. | Preference is per person and affects only that person. |
| 3.10 | Sign out on one device, have a colleague post, sign back in. | **Known gap:** the channel list shows nothing unread. The backend count is correct; the surface is missing. Do not file. |

## MT-4 · Voice

Reuse: `specs/032-voice-communication-support/quickstart.md`,
`specs/037-native-call-wakeup/quickstart.md` **section C is the release-gating device
matrix and has no automated substitute**, `specs/052-unreachable-callee-missed-call/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 4.1 | Place a 1:1 call from a conversation. | At most one live call per channel. The caller's bar reads **Calling** until the other side joins, not "in voice call". |
| 4.2 | Answer on a locked iPhone. | The OS presents it as a system call. Only one incoming surface is drawn — no in-app prompt behind it. Answering opens the conversation behind the system UI. |
| 4.3 | Decline from the lock screen. | The caller sees it as declined, not as a cancel, and the ring stops on the caller's side. |
| 4.4 | Answer on one device while a second device of the same person is ringing. | The second device stops; the device that acted is not rung again. |
| 4.5 | Call and do not answer. | Ends as **missed** after 45 s, and a missed-call system message appears in the conversation. |
| 4.6 | Call somebody with no valid push token and no live connection. | The caller is refused immediately as unreachable **and** the callee comes back to a missed-call entry in the conversation. |
| 4.7 | Call somebody who is already on a call. | Refused as busy. No missed-call record is written — they are at their device and can see it. |
| 4.8 | Block someone, then try to call them. | Refused in wording that names neither party and does not say a block exists. |
| 4.9 | Mute from the in-app call banner. | Mute state is reflected on the lock screen, and vice versa. |
| 4.10 | Hang up from the in-app bar. | The system call screen closes too — no orphaned call with a running timer. |
| 4.11 | Send a voice message. | Posts into the conversation as a playable message. **Known gap:** the player shows `--:--` until the file loads and draws no waveform. |

## MT-5 · Tasks and projects

Reuse: `specs/017-realtime-task-collaboration-system/quickstart.md`,
`specs/044-mobile-project-ritual-creation/quickstart.md`, `specs/030-canonical-resource-links/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 5.1 | Create a project on web. Try a key that is already taken. | Refused on the **key input**, not as a whole-form error. The key cannot be changed later. |
| 5.2 | Look at the new project's card on the project list. | Member count reads 1, not 0 — you are its owner. |
| 5.3 | Create a project from mobile (`My Work` → create). | Same fields as web. The affordance is **absent** for anyone without `collab.createProject`. |
| 5.4 | Create a task, open it, add a comment. | The comment thread and the description document are created on first open, not at task creation. |
| 5.5 | Nest tasks six deep. | Refused at five. |
| 5.6 | Set up a workflow rule (`state_entered` → `assign_user`) and move a task into that state. | The rule fires and the execution is logged, so the surprising assignment is traceable. |
| 5.7 | Copy a task's canonical link, sign out, open it. | You are sent through sign-in and land on the task afterwards. |
| 5.8 | Add `?utm_source=x` to a canonical link and open it. | The parameter is stripped and does not change what opens. |
| 5.9 | Open a canonical link to a task in a project you are not in. | Access denied — no title, no identifier. |

## MT-6 · Rituals (recurring checklists) and evidence

Reuse: `specs/022-recurring-ritual-tasks-system-for/quickstart.md`,
`specs/028-ritual-submission-flow/quickstart.md`, `specs/029-ritual-ux-redesign/quickstart.md`,
`specs/034-global-ritual-scheduler/quickstart.md`, `specs/040-ritual-overdue-missed/quickstart.md`,
`specs/041-evidence-review-queue/quickstart.md`, `specs/042-shift-based-assignment/quickstart.md`,
`specs/043-attach-procedure-doc/quickstart.md`.

Requires a project whose collaboration mode is **Ritual** or **Mixed**; the mode is fixed at
creation.

| # | Steps | Expected |
|---|---|---|
| 6.1 | Project → Settings → Rituals → new. Set a daily recurrence, a timezone, a completion window and three evidence requirements. Save. | Instances for the next 30 days exist **on return** — generation runs inside the creation transaction, not on a later timer. Each requirement takes exactly one kind of proof. |
| 6.2 | Create the same thing from mobile (`My Work` → project → create ritual). | Collects name, description, daily/weekly/monthly, the device timezone read-only, requirements and optional assignees. Department pools, procedure attachment, auto-approve and the windows are web-only. Offered only to a project owner or admin. |
| 6.3 | Assign to a department with **round-robin**, then generate a week. | Assignees rotate through the sorted member list. |
| 6.4 | Assign to a department with **on-shift**, with no rota published. | Instances show "waiting for the rota" rather than an unexplained empty assignee. There is deliberately **no** fallback to round-robin. |
| 6.5 | Publish shift events covering a date, wait 2 min. | The instance binds to whoever is rostered. Remove the shift: it unbinds and waits again. |
| 6.6 | Let an on-shift instance reach its scheduled date with nobody rostered. | The slot closes and the project's owners and admins get `ritual_instance_unassigned` — a different alert from *missed*, because nobody was ever asked. |
| 6.7 | As the assignee, submit a written note and a photo. | Both timestamps are recorded (device and server). The instance state moves to submitted once every required item is in. |
| 6.8 | Set a requirement to auto-approve via GPS, and check in inside the radius. | Approves itself with no reviewer. |
| 6.9 | As a reviewer, open **Reviews** (web ⌘8) or the review-queue card on the mobile My Work tab. | Late work sorts first, then oldest first. The badge shows "99+" when capped. Anyone who cannot review sees no entry point at all. |
| 6.10 | Reject a submission with an empty comment. | Refused — a reason is required, and it reaches the submitter in the rejection notification. |
| 6.11 | Have two reviewers decide the same submission at once. | Exactly one wins; the other is told who decided and when, rather than silently overwriting. |
| 6.12 | Let a deadline pass with nothing submitted, wait 5 min. | The instance becomes **overdue** and the assignee, reviewer and approver are notified. Project owners are deliberately *not* alerted at this stage. |
| 6.13 | Wait one completion window further. | It becomes **missed**, which is terminal. An instance with nobody on it still escalates to the project's owners and admins at this point. |
| 6.14 | Attach a procedure document to a definition, then open an instance as a worker with **no** grant on that document. | They can read the procedure. It opens as an overlay over whatever they were doing — typed notes and attached files survive. They do not gain the document in their tree, search, comments or history. |
| 6.15 | Delete the attached document's access for the manager, then try to attach a document they cannot open. | Refused on the `procedure_document_id` field, indistinguishably from "does not exist". |
| 6.16 | Change a definition's recurrence. Preview first. | Untouched future runs are removed; any run somebody has already worked on survives as a standalone task. |
| 6.17 | Skip a run with a reason. | Recorded with the reason, state `skipped`. |
| 6.18 | Archive a definition, then unarchive it. | Archiving stops generation and removes pending runs. Unarchiving rebuilds them immediately rather than waiting for real time to catch up. History is untouched either way. |
| 6.19 | Project → Health over a date range, then export CSV. | Per-checklist and per-person compliance, names not UUIDs, name column first in the CSV. |

## MT-7 · Calendar and the rota

Reuse: `specs/026-calendar-system/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 7.1 | Create one event of each type. | Type changes behaviour: only `shift` and anything with `requires_check_in` offers check-in. |
| 7.2 | Create a recurring shift, then change one week. | You are asked: this occurrence / this and following / the whole series. The choice, the person and the time are recorded. |
| 7.3 | Cancel an event. | It stays visible as cancelled. Nothing disappears. |
| 7.4 | Answer a pending invite from the day panel. | Accepted without leaving the calendar. |
| 7.5 | Book a resource on two overlapping events. | The second booking is refused. Only people you allowed can book it. |
| 7.6 | Set working hours, then use Free/busy and Suggest slots. | Suggestions honour working hours and existing bookings. |
| 7.7 | Create a booking link and claim a slot from a private window. | Becomes a real event; the link is marked claimed. |
| 7.8 | Grant a delegate `can_create` with an expiry, have them add an event, then revoke. | Works while granted, refused after. |
| 7.9 | Wait for an event reminder to fire (default 15 min before). | The notification **names the event** — "*&lt;title&gt; starts in N minutes*" — and is delivered even when you are not looking at the app. |
| 7.10 | Check in to a shift on mobile. | **Known gap:** the app asks for location permission and refuses check-in if declined, then discards the reading — nothing stores a coordinate. Do not file; see D74. |
| 7.11 | Toggle Tasks / Rituals / Doc deadlines above the grid. | Work from other areas overlays the calendar. |

## MT-8 · Documents

Reuse: `specs/016-docs-sys-basic-implementation/quickstart.md`,
`specs/049-doc-edit-conflict-protection/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 8.1 | Create a document, save three times with summaries. | Every save is a full snapshot with an author; nothing is pruned. |
| 8.2 | Compare two versions, then open blame. | Diff and line-by-line attribution both work off the snapshots. |
| 8.3 | Rename a document, then open a link you copied before the rename. | Still resolves. |
| 8.4 | Open the same document in two browsers. Save in A, then save in B without reloading. | B is **refused**, not merged and not silently overwritten. The banner keeps B's unsaved text and offers *copy my changes* and *load the current version*. |
| 8.5 | Repeat 8.4 as somebody with read-only access. | Permission denied first — they never learn who edited. |
| 8.6 | Quote a line range of another document, then edit the source. | The quote is a snapshot and does not silently change. `ListIncomingCitations` shows who cites this one. |
| 8.7 | Grant a department read-and-comment; grant one person an explicit **deny**. | The explicit deny wins, even on a public document. |
| 8.8 | Sign in as someone with no grant on a private document and open the Docs sidebar. | **Known gap:** the *title* is visible in the tree to anyone with `docs.view` — content, search and everything else are correctly scoped. See D49. |
| 8.9 | Open a document on mobile. | Read-only, and a canonical link inside the body renders as a card exactly as it would in chat. |
| 8.10 | Open the workspace Docs list after creating a task with a description. | The task's description document does **not** appear. |

## MT-9 · Files

Reuse: `specs/014-file-storage-system-an-integration/quickstart.md`,
`specs/015-file-storage-security-and-access/quickstart.md`,
`specs/059-content-index-honesty/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 9.1 | Upload a `.docx` in a channel. | Scanned, converted to PDF for preview, and its text extracted into the content index. |
| 9.2 | Upload a JPEG. | Scanned. Not converted and not indexed — and the post-processing job reports **completed**, not failed. Content index status reads `NOT_APPLICABLE`. |
| 9.3 | Rename a `.exe` to `.jpg` and upload it. | The declared type is checked against the magic bytes; the mismatch is recorded. |
| 9.4 | Stop the ClamAV container and upload. | The file **fails** validation rather than being waved through. |
| 9.5 | Upload something over the max file size (100 MB default). | Refused. Only an owner can change the limit. |
| 9.6 | Delete a file, then try to report it. | Deletion is soft and logged; reporting a deleted file is refused as not found. |
| 9.7 | Search Files for a word that is only inside a PDF's text. | Found. A file you cannot download never appears in results — verify as someone outside the channel. |
| 9.8 | Search as a person who belongs to no channel or department. | Zero results. Not "everything". |

## MT-10 · Search

Reuse: `specs/045-federated-search/quickstart.md`,
`specs/011-global-multilingual-fuzzy-search-system/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 10.1 | Search a word that exists as a person, a department, a channel, a message, a document, a work item, an event **and** a file. | All eight kinds come back in one ranked list. Every source's best hit precedes any source's second best. |
| 10.2 | Compare the same query on web and mobile. | Identical order. The ranking is total by construction. |
| 10.3 | Narrow to one kind. | Tabs carry per-source counts; the selected kind lives in the web URL (`?kind=`) and survives changing the query. |
| 10.4 | Search as somebody lacking `files.search`. | The Files source is silently skipped — not an error, not an empty-looking failure. |
| 10.5 | Type one character. | Refused; two is the minimum. |
| 10.6 | Open each result kind on mobile. | Every kind opens something: person → DM, document → viewer, work item → task, event → event, department → member list, file → file. |
| 10.7 | Open an **event** result on web. | **Known gap:** lands on `/workspace/calendar`, not a per-event page — web has none. See D53. |
| 10.8 | Misspell a person's name by one letter. | Still found (trigram). Long descriptions can dilute a match — see D62. |

## MT-11 · Notifications, presence, push

Reuse: `specs/007-notification-hub-backend/quickstart.md`,
`specs/019-unified-notification-routing-for-chat/quickstart.md`,
`specs/033-presence-ping-pong/quickstart.md`,
`specs/051-notification-preference-completeness/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 11.1 | With the app open, have somebody DM you. | Arrives live. No duplicate push follows. |
| 11.2 | Force-quit the app, then have somebody DM you. | A push arrives about two seconds later — the rescue window, not an immediate double-send. |
| 11.3 | Scroll past a notification without opening it. | It reads as *read* but not *acknowledged*, so the pending push can still fire. Opening the linked destination is what acknowledges it. |
| 11.4 | Mobile More → Settings → Notifications. Mute **Calendar**. | All five areas are mutable: Chat, Tasks and projects, Calendar, Documents, System. |
| 11.5 | Set a do-not-disturb window covering now, then trigger a notification. | Push is suppressed; the workspace is still live when you open it. |
| 11.6 | With do-not-disturb on, have somebody call you. | It rings anyway. A call is structurally exempt. |
| 11.7 | Turn off In-App Alerts, then trigger a notification. | The foreground banner stops. The notification is still recorded, listed, counted and pushed — it is not a do-not-disturb setting. |
| 11.8 | Change the preferences on one device and open the other. | They follow the person, not the device. |
| 11.9 | Settings → Presence → *departments*, then check how a colleague outside your department sees you. | Offline. |
| 11.10 | Kill the network on a phone that is signed in, and watch the colleague's view. | Presence drops within about 45 s. It never refreshes on its own while the client is silent. |
| 11.11 | Look for do-not-disturb or the mute list on **web**. | Not there. Web settings cover push devices and presence visibility only — DND and mute are mobile. |

## MT-12 · Workspace shell, theme, tour

Reuse: `specs/013-dark-mode-and-color-scheme/quickstart.md`,
`specs/031-context-rail-redesign/quickstart.md`, `specs/039-feature-tour/quickstart.md`,
`specs/047-owner-today-team-block/quickstart.md`, `specs/050-mobile-dark-mode/quickstart.md`.

| # | Steps | Expected |
|---|---|---|
| 12.1 | Sign in as an owner on web. | Eight navigation entries, every one opening something: Calendar, Notifications, Chat, Tasks, Docs, Files, Organization, Reviews. |
| 12.2 | Sign in as an employee with no review permission. | Organization and Reviews are absent. The rest still read ⌘1–⌘6. |
| 12.3 | Press ⌘1. | **Known gap:** nothing happens. The ⌘n text is a label; no shortcut is bound. See D89. |
| 12.4 | Look at the right-hand context rail on any screen. | Who you are, what is next, what is due today, unread. Read-only by design. |
| 12.5 | Let a ritual instance go `missed` and watch the rail. | It leaves the rail entirely — `missed` is a closed state. |
| 12.6 | Open mobile for the first time as an owner. | Six-stop administrator tour. The `people` stop says it is done on the web and offers no action; project and ritual stops offer real actions. |
| 12.7 | Open mobile for the first time as a worker. | Four-stop worker tour (today, evidence, chat, alerts). |
| 12.8 | Complete the tour on web, then open mobile. | It is not offered again. Replay is in the web user menu and the mobile More tab. |
| 12.9 | Follow a deep link into the app on first run. | The tour does **not** interrupt the navigation; it appears when you next arrive at a surface it belongs to. |
| 12.10 | Mobile Settings → Appearance → dark. Force-quit and relaunch. | Still dark. Native controls — keyboard, carets, pickers, switches — follow. |
| 12.11 | Leave the theme on the phone's setting and change the phone to dark. | Mobile follows. Web deliberately does **not** re-read it mid-session — see D30, this is not a bug. |
| 12.12 | As a project owner/admin who can review evidence, open mobile Today. | A **Team** block appears between "Running late" and "Today's schedule", listing the projects' late instances and today's unheld ones. |
| 12.13 | Open mobile Today as an ordinary worker. | No Team heading, no card, no skeleton — byte-for-byte the old screen. |
| 12.14 | As a supervisor with nothing wrong, open Today. | An explicit all-clear naming how many projects it covered — not a vanished block. |
| 12.15 | Break the team feed (stop the backend briefly) and reload Today. | Only the Team block shows a retry. Your own overdue work, events and due-today work stay rendered. |
| 12.16 | Mobile: check that Schedule and Alerts are reachable. | Four tabs only (Chat, Today, My Work, More). Schedule opens from the Today header; Alerts from the bell in the Chat header, which carries the unread badge. |

## MT-13 · Safety, compliance and leaving

Reuse: `specs/036-store-compliance-sweep/quickstart.md`,
`specs/056-report-block-surfaces/quickstart.md`, `specs/055-seed-demo-workspace/quickstart.md`.

Run these against the `maestro` workspace, not `demo`.

| # | Steps | Expected |
|---|---|---|
| 13.1 | Report a channel message, a direct message, a file (list row **and** detail screen) and a document comment. | Every surface opens the same form. A refusal keeps the content on screen and is readable — no `[already_exists]` prefix, and on a tall narrow Android screen the error is above the reason list, not below the fold. |
| 13.2 | Report the same thing twice. | Refused with a sentence a person can read. |
| 13.3 | Have the author delete the reported message, then review the report. | The snapshot survives the deletion. |
| 13.4 | Block someone from a message action sheet or their profile. | The control flips in place. No notification is sent to anyone. |
| 13.5 | As the blocked person, try to open a DM with the blocker — and have the blocker try the same. | Both refused, in wording that names neither party and does not reveal a block exists or which way it points. |
| 13.6 | Look at the blocked person's messages in a **shared** channel. | Still visible. Blocking is scoped to direct contact — hiding work instructions would be its own safety problem. |
| 13.7 | Try to block someone from the **web**. | **Known gap:** web can list and undo blocks but cannot create one. See D76. |
| 13.8 | Try to block a system message ("X created task ABC-12"). | No Block control — the row carries the acting employee, not a speaker. It is reportable but not blockable. |
| 13.9 | As the `spare@` owner on the demo workspace, Settings → delete account. | A preview states what is erased and what is retained, and asks for a typed phrase. Sessions end immediately. |
| 13.10 | As the **sole** owner of a workspace that still has members, try to delete. | Refused, naming each blocking workspace with its member count. |
| 13.11 | As `demo-worker` (admin-provisioned), open the same screen. | Offered *request removal*, not deletion — the account is the employer's record. The workspace's owners are notified. |
| 13.12 | Re-run `seed-demo-org` after a deletion. | A fresh spare owner is created; the anonymised tombstone is left alone and stays out of the directory. |
| 13.13 | Bump `iam.CurrentTermsVersion` and reopen mobile. | Held behind a read-and-accept screen. Break the network: it fails **open** rather than locking somebody out of their work. |

## MT-14 · Multi-workspace and tenant isolation

| # | Steps | Expected |
|---|---|---|
| 14.1 | Invite the same person into a second workspace and accept. | Two memberships, one login. Each has its own roles and data. |
| 14.2 | Switch workspaces. | The token is reissued; nothing from the other workspace is visible. |
| 14.3 | Search a word you know exists in the other workspace. | Nothing. |
| 14.4 | Take a canonical link from workspace A and open it while signed into B. | Access denied on the tenant check. |

---

## Release gate

Not everything above needs running every time. For a release:

1. **`specs/037-native-call-wakeup/quickstart.md` section C** — the device matrix. This is
   the one thing with no automated substitute at all: no test can demonstrate a locked,
   force-quit phone ringing on its lock screen.
2. MT-1 (1.1–1.7), MT-6 (6.1, 6.7, 6.9, 6.12), MT-11 (11.1–11.3), MT-13 (13.1, 13.9).
3. `make test-backend`, `make test-frontend`, `make test-mobile`.

Known gates that are **not** green at HEAD and why are listed in `docs/domain/platform.md`
under *Testing* and in the drift register — check there before treating a red run as a
regression. `make check-tracked-files` and `pnpm lint` are both red for pre-existing
reasons (D82, D67).

## Keeping this current

The trigger is the same as for `docs/domain/`: a change that alters an RPC surface, a
constraint, a job cadence or a user-visible flow updates the case here in the same change
set. When a *Known gap* row is fixed, delete the row rather than annotating it, and delete
its drift-register entry too.
