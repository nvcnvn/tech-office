# Contract: Tour Content

The two tours as they will be defined in `internal/tour/content.go`. This is the copy
reviewers should argue about — it is the whole user-visible surface of the feature.

Vocabulary is constrained by FR-021: only words the product and the user guides already use
— **project**, **ritual**, **evidence**, **channel**, **task**, **Today**, **Alerts**,
**account ID**. No new coined terms.

`content_version` for the initial release: `"2026-09-02.1"`.

## Administrator tour — `tour_id = "administrator"`

Served to anyone holding `iam.inviteUser`. Six stops, matching FR-003's required order.

### 1. `people` — Get your team in

> **Everyone works here, not just the people with email**
>
> Your baristas, drivers and shop-floor staff do not need a company email address. Give them
> an account ID and a 6-digit PIN and they sign in on their own phone. Managers and office
> staff can use email and a password instead.

- Target: `TOUR_TARGET_PEOPLE` · Action: **Add your team**
- Required permission: `iam.inviteUser`
- **Web-only.** Mobile note: *"Adding staff, importing a team and setting roles are done on
  the web app — open TechOffice on a computer when you have a moment."* Target becomes
  `TOUR_TARGET_NONE`; no action button. (FR-023)

### 2. `project` — Make one project

> **A project is where work lives**
>
> Most small businesses need one or two, not twenty. Bright Bean Coffee runs everything out
> of a single project called *Store Operations*. Pick the **Mixed** mode if you want both
> one-off tasks and recurring checklists in the same place.

- Target: `TOUR_TARGET_PROJECTS` · Action: **Create a project**
- Required permission: `collab.createProject`
- **FR-013a**: the route must land with project creation visible — not on a project list that
  is empty in exactly the workspace this stop is written for.

### 3. `ritual` — Set up a checklist that proves itself

> **This is the part most businesses come here for**
>
> A ritual is recurring work that has to happen and has to leave proof — the opening
> checklist, the closing count, the Monday deep clean. Define it once; a fresh run appears
> for whoever is on shift, they submit the evidence, and you approve it. A photo of the
> fridge thermometer beats someone saying they checked.

- Target: `TOUR_TARGET_RITUALS` · Action: **Define a ritual**
- Required permission: `collab.manageRitualDefinition`
- **FR-013a**: rituals live inside a project, and a brand-new workspace has none. When there
  is no project yet, this stop routes to project creation and says so, rather than to a
  rituals screen that cannot exist.

### 4. `chat` — Keep the conversation attached to the work

> **Stop losing decisions in group texts**
>
> Channels are where the shift is discussed. When a message turns out to be a job — *"the
> grinder is making that noise again"* — turn it into a task without leaving the
> conversation. The task remembers which message it came from, and the message shows where
> the job went.

- Target: `TOUR_TARGET_CHAT` · Action: **Open chat**
- Required permission: `chat.viewChannel`

### 5. `schedule` — Publish the schedule

> **One calendar everyone can see**
>
> Shifts, meetings and the room booking live in the same place. Share a booking link and
> someone outside the business can pick a slot without an account.

- Target: `TOUR_TARGET_CALENDAR` · Action: **Open the calendar**
- Required permission: *(none — the calendar has no view permission; only resource management
  is gated, on `calendar.manageResources`)*

### 6. `docs` — Write down how you do things

> **So training is not a person**
>
> Put the procedures somewhere they can be read on a phone during a shift: how the machine
> gets cleaned, what to do when the card reader dies. A ritual can point at the document
> that explains why it matters.

- Target: `TOUR_TARGET_DOCS` · Action: **Open documents**
- Required permission: `docs.create`
- **FR-013a**: the route must land with document creation visible.

## Worker tour — `tour_id = "worker"`

Served to everyone else. Four stops, matching FR-004's required order. Shorter, plainer, and
it never mentions anything the person cannot do.

### 1. `today` — Start here every shift

> **Today shows what is yours**
>
> Anything late, anything happening today, and anything due before you go home — in one
> list. If Today is empty, you are done.

- Target: `TOUR_TARGET_TODAY` · Action: **Show me Today**
- Required permission: `collab.viewTask`

### 2. `evidence` — Finish a checklist and show your work

> **Tick the box, then prove it**
>
> A checklist asks for evidence — a photo, a number, a note. Fill it in as you go and submit
> when you are done. Your manager sees it and either approves it or asks you to redo one
> part, not the whole thing.

- Target: `TOUR_TARGET_TODAY` · Action: **Show me Today**
- Required permission: `collab.submitEvidence`

### 3. `chat` — Ask, and turn it into a job

> **Your channels are where the shift is discussed**
>
> Message the people you work with. If something needs doing, turn the message into a task
> right there — whoever picks it up can see exactly what was said.

- Target: `TOUR_TARGET_CHAT` · Action: **Open chat**
- Required permission: `chat.viewChannel`

### 4. `alerts` — How you are told, and how you find things

> **Alerts tell you; search finds it**
>
> Alerts is the bell — anything assigned to you, anything sent back for a redo. Search finds
> a person, a channel, a message or a job when you know roughly what you are looking for.

- Target: `TOUR_TARGET_ALERTS` · Action: **Open alerts**
- Required permission: `notif.view`

## Length check against FR-005 and SC-007

Six stops and four stops, both within the six-stop cap. Body word counts, measured:

| Tour | Stop | Words |
|---|---|---|
| administrator | people | 41 |
| administrator | project | 39 |
| administrator | ritual | **56** |
| administrator | chat | 50 |
| administrator | schedule | 27 |
| administrator | docs | 39 |
| worker | today | 23 |
| worker | evidence | 43 |
| worker | chat | 29 |
| worker | alerts | 35 |

Every body is within FR-005's 60-word cap; the ritual stop at 56 is the one with no room
left, so it is the one to watch if the copy is edited. The administrator tour totals 252
words and the worker tour 130 — both comfortably inside SC-007's three minutes of reading.

**Re-measure this table whenever the copy changes.** It is the only check on FR-005, and a
stale table is worse than none.

## Review notes for whoever approves this

- **Stop 2 of the worker tour points at Today, not at a specific checklist run.** There may
  not be one when the tour runs. Pointing at Today is honest and always works; pointing at a
  run that does not exist is the empty-screen failure the spec's edge cases forbid.
- **The calendar stop is ungated** because the calendar genuinely has no view permission —
  only `calendar.manageResources` exists. If a view permission is ever added, this stop must
  be gated with it.
- **The `people` stop is the only web-only stop.** If more administrator surfaces reach
  mobile later, the `WebOnly` flag is how they stop being web-only — one field, no structural
  change.
- **Three administrator stops describe things a new workspace does not have.** Project,
  ritual and docs all point at creation, per FR-013a. The ritual stop is the awkward one: it
  depends on a project existing, so its route is conditional. That conditionality is the only
  place in the tour where a stop's destination depends on workspace state — worth knowing,
  because the tour otherwise never inspects it.
