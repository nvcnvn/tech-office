# Contract: Mobile surfaces

The two new screens, the modified ones, and every `testID` the Maestro flows target.
`testID`s are the mobile equivalent of the web's `data-testid` and are mandatory on every
interactive element (Constitution XIII); they are listed here rather than discovered during
implementation so the flows and the screens can be written against the same names.

Naming follows the repository convention: `kebab-case`, descriptive, unique within the screen.

---

## Routes

| Route | File | Presentation | Gate |
|---|---|---|---|
| `/(app)/(tasks)/create-project` | `app/(app)/(tasks)/create-project.tsx` | Modal screen in the tasks stack | `collab.createProject` |
| `/(app)/(tasks)/[projectId]/create-ritual` | `app/(app)/(tasks)/[projectId]/create-ritual.tsx` | Modal screen in the tasks stack | `collab.manageRitualDefinition` **and** project role `owner` or `admin` |

Both are registered in the existing `app/(app)/(tasks)/_layout.tsx` `Stack`, matching how
`[projectId]/create`, `[projectId]/settings` and `rituals/[definitionId]` are registered
today. Modal presentation matches `(chat)/new-channel.tsx` and `(calendar)/create.tsx`.

Both screens carry a header **Cancel** (`headerLeft`), following `new-channel.tsx`, so leaving
never depends on finding a gesture.

---

## Screen: Create a project

### Layout, top to bottom

A single-column `ScrollView`. No sidebars, no columns, no dense toolbars.

1. **Name** — text input, autofocus.
2. **Project key** — text input, uppercase-forced, pre-filled by derivation from the name
   until the person edits it. Helper line beneath states the rule
   (`PROJECT_KEY_RULE_TEXT`). Turns to an error line, in place, on a client or server
   rejection.
3. **Description** — optional multiline input, 3 lines tall.
4. **Who can see it** — two large segments: *Private* / *Public*, with the one-line
   explanation the web dialog shows for the selected value.
5. **What this project is for** — three large segments: *Tasks* (`standard`) /
   *Rituals* (`ritual`) / *Both* (`mixed`), each with the web's one-line explanation. Plain
   language, per Constitution XIII's "avoid jargon" rule: the segment says *Rituals*, not
   `COLLABORATION_MODE_RITUAL`.
6. **Create project** — full-width primary button, disabled until name and key are both
   non-empty, spinner while pending.

### Behaviour

- **Key suggestion** (FR-002): derives while untouched, stops on first edit, tracked by an
  explicit `keyTouched` flag rather than by testing the field for emptiness — clearing the
  field to retype should not restart the suggestion.
- **Client validation before submit** (FR-002, US2 scenario 2): the key is tested against
  `projectKeySchema`; a failure marks the key input and sends nothing.
- **Server refusal** (FR-016, US2 scenario 3): `fieldViolation(error, 'key')` marks the key
  input; anything else renders as an inline banner above the button. **Every field keeps its
  value in both cases.** The form is never reset on failure.
- **Success** (FR-005): `router.replace` to `/(app)/(tasks)/{id}` — replace, not push, so the
  back gesture from the new project does not return to a form that has already been
  submitted. `["projects"]` is invalidated first.
- **Offline / network drop** (edge case): the mutation rejects, the banner says the project
  was not created, everything typed stays. Retry is the same button. No optimistic write and
  no local draft persistence, so an ambiguous failure cannot produce a duplicate on retry.

### testIDs

| testID | Element |
|---|---|
| `create-project-screen` | Root scroll view |
| `create-project-cancel-button` | Header cancel |
| `project-name-input` | Name |
| `project-key-input` | Key |
| `project-key-error` | Key error line |
| `project-description-input` | Description |
| `project-visibility-private` / `project-visibility-public` | Visibility segments |
| `project-mode-standard` / `project-mode-ritual` / `project-mode-mixed` | Mode segments |
| `create-project-submit` | Primary button |
| `create-project-error` | Form-level error banner |

### Entry point

On `(tasks)/index.tsx` in **projects** mode, a create affordance rendered **only** when the
permissions query contains `collab.createProject` (FR-004, SC-005). Absent — not disabled —
otherwise. It sits with the projects list rather than on the focus view, because that is the
surface it adds to.

| testID | Element |
|---|---|
| `projects-create-button` | The create affordance |

---

## Screen: Create a ritual

### Layout, top to bottom

1. **Name** — text input, autofocus.
2. **Description** — optional multiline, plain text, 3 lines.
3. **How often** — three large segments: *Every day* / *Every week* / *Every month*.
   - *Every week* reveals a seven-segment weekday row: **Mo Tu We Th Fr Sa Su**. Two-letter
     labels, because seven segments inside 328dp of usable width at 360dp leaves ~46dp each
     and three-letter labels do not fit on Android at the default font scale.
   - *Every month* reveals a wrapped grid of day chips 1–31. A wrapped grid, not a picker
     wheel: a wheel is an iOS-flavoured control that renders very differently on Android.
   - Neither sub-control is a dropdown, per Constitution XIII.
4. **Timezone** — a read-only line: "Runs on {IANA zone} time", so a wrong zone is visible
   before saving (FR-010). No picker.
5. **What it has to prove** — the requirement list, at least one. Each row: a name input, a
   wrapped chip row of the seven proof types (multi-select), and a Required/Optional toggle
   defaulting to Required. A **Remove** action per row, disabled when only one row remains.
   An **Add another** action beneath.
6. **Who it is for** — optional. A search field over the project's members
   (`listProjectMembers` → `getEmployeeCards`), selected people shown as removable chips.
   Empty is valid and the helper line says so: "Leave empty and each run starts unassigned."
7. **Create ritual** — full-width primary button.

### Behaviour

- **Submit-time validation** — the six client-side rules in
  [data-model.md](../data-model.md#submit-time-validation-all-client-side-before-any-request),
  each anchored to the control that is wrong, each stated as a plain rule.
- **Atomic save** (FR-013) — one `createRitualDefinition` call carrying
  `evidenceRequirements` inline. Never a create-then-loop. Either the definition exists with
  every requirement, or nothing was created.
- **Server refusal** (FR-016) — rendered as a banner naming what is wrong; the whole draft
  including every requirement row stays on screen.
- **Success** (FR-005, FR-014) — invalidate `["ritualDefinitions", projectId]` and the
  project's task queries, then `router.replace` to
  `/(app)/(tasks)/rituals/{definitionId}`. Because `CreateRitualDefinition` generates the
  first instances inside its own transaction (feature 034), the upcoming runs are already
  there; the refetch is a read, not a wait.

### testIDs

| testID | Element |
|---|---|
| `create-ritual-screen` | Root scroll view |
| `create-ritual-cancel-button` | Header cancel |
| `ritual-name-input` | Name |
| `ritual-description-input` | Description |
| `ritual-recurrence-daily` / `-weekly` / `-monthly` | Recurrence segments |
| `ritual-weekday-1` … `ritual-weekday-7` | Weekday segments, `1`=Mon … `7`=Sun, matching the proto |
| `ritual-day-of-month-1` … `-31` | Day-of-month chips |
| `ritual-recurrence-error` | Recurrence validation message |
| `ritual-timezone-line` | Read-only timezone |
| `ritual-requirement-{index}` | A requirement row |
| `ritual-requirement-name-{index}` | Its name input |
| `ritual-requirement-type-{index}-{type}` | Its proof-type chips, e.g. `…-0-photo` |
| `ritual-requirement-required-{index}` | Its Required/Optional toggle |
| `ritual-requirement-remove-{index}` | Its remove action |
| `ritual-add-requirement` | Add another |
| `ritual-assignee-search` | Assignee search field |
| `ritual-assignee-option-{employeeId}` | A search result |
| `ritual-assignee-chip-{employeeId}` | A selected person |
| `create-ritual-submit` | Primary button |
| `create-ritual-error` | Form-level error banner |

### Entry point

On `(tasks)/[projectId]/index.tsx`, an "add a ritual" affordance rendered **only** when both
gates pass (FR-015, US1 scenario 4): the permissions query contains
`collab.manageRitualDefinition`, **and** `getProject(projectId).currentUserRole` is `owner` or
`admin`. The screen does not fetch `getProject` today and will need to; the project settings
screen already does, so the query key and shape are established.

| testID | Element |
|---|---|
| `project-create-ritual-button` | The add-a-ritual affordance |

---

## Modified screen: Ritual template (`rituals/[definitionId].tsx`)

Gains archive and unarchive (FR-017), and nothing else. FR-018: no other edit of an existing
definition is offered from mobile — no rename, no schedule change, no requirement editing.

- Shown only to a project `owner` or `admin`, which requires the screen to learn the project
  role it does not fetch today (US4 scenario 3).
- **Archive** opens a confirmation (`Alert.alert`, the pattern already used on this platform)
  stating that no new runs will be created. Confirming calls
  `archiveRitualDefinition(id, true)`.
- An archived definition renders an **Archived** badge in place of the existing
  "Reference only" badge, and its action becomes **Restore** →
  `archiveRitualDefinition(id, false)` (US4 scenario 2). Restore is not behind a
  confirmation: it is not the destructive direction.
- Invalidate `["ritual-definition", id]` and `["ritualDefinitions", projectId]` on success.

| testID | Element |
|---|---|
| `ritual-archive-button` | Archive |
| `ritual-unarchive-button` | Restore |
| `ritual-archived-badge` | Archived state badge |

---

## Modified: the tour

Covered in [api-wrapper-changes.md](./api-wrapper-changes.md) §§4–7 and
[tour-content-delta.md](./tour-content-delta.md). The only new mobile `testID` is
`feature-tour-ritual-fallback-note`, matching the web card's `data-testid`.

---

## The 360dp bar (FR-024, SC-007)

Verified on Android as well as iOS, not assumed from an iPhone SE. The three controls that
can fail:

| Control | Why it is at risk | What it does about it |
|---|---|---|
| Weekday row | Seven segments in 328dp usable width ≈ 46dp each | Two-letter labels; `flexShrink` on each segment; minimum 44dp tap target held |
| Day-of-month grid | 31 chips | Wraps rather than scrolling horizontally; no fixed column count |
| Proof-type chips | Seven labels of varying length | `flexWrap: "wrap"`, matching the chip row the ritual detail screen already renders |

No `Dimensions`-based branching and no iOS-only props. Both screens are checked at 360dp on
an Android emulator and on an iPhone SE, per the standing rule that the habitual iOS test
device hides narrow-Android regressions.
