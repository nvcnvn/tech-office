# Phase 1 Data Model: Create Projects And Rituals On Mobile

**No persisted entity is added, removed or altered by this feature.** There is no migration,
no new table, no new column and no new constraint. `backend/database/scripts/schema.sql` is
untouched.

What follows is therefore in two parts: the existing entities the feature writes to, stated
with the validation rules and defaults the mobile surfaces must honour; and the client-side
draft models that live only in React state until the person saves.

---

## Part 1 — Existing persisted entities this feature writes

### Project (`collaboration.project`)

Written by `CreateProject`. Mobile populates five of the six request fields.

| Field | Mobile source | Rule |
|---|---|---|
| `name` | Required text input | Non-empty after trim. No length rule exists in the schema; the form does not invent one. |
| `key` | Text input, pre-filled by derivation from `name` | `^[A-Z][A-Z0-9_]{0,9}$` — the `valid_project_key` CHECK constraint. Unique per `(organization_id, key)` — the `unique_project_key` constraint. **Permanent**: no update path exists for it, which is why the phone validates before submitting. |
| `description` | Optional multiline input | Nullable. Empty string is sent and stored as NULL by `pgtype.Text{Valid: req.Description != ""}`. |
| `visibility` | Two-way choice | `public` \| `private`. Wrapper defaults to `private` when unset; the mobile form sets it explicitly. |
| `collaboration_mode` | Three-way choice | `standard` \| `ritual` \| `mixed`. Wrapper defaults to `standard`. Determines which default state set the server creates and, per US2 scenario 4, what the created project leads with. |
| `default_states` | **Not collected** | Omitted, exactly as the web dialog omits it. The server then applies `DefaultRitualProjectStates` or the standard set according to `collaboration_mode`. |

Server-assigned on create and never sent by a client: `id` (uuidv7), `organization_id`,
`owner_employee_id` (the creator), `next_task_number` (1), `is_archived` (false),
`member_count`, `task_count`, `updated_at`.

**Derivation rule** (`deriveProjectKey`, moving to `@tech-office/validations`):
`name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10)`. Note it strips `_` although
the format rule permits it — a hand-typed `STORE_OPS` is valid but is never suggested. This
asymmetry is preserved from the web form rather than corrected, so the two clients suggest
identical keys for identical names.

**Suggestion lifecycle** (FR-002): the derivation runs while the key field is untouched and
stops the moment the person edits it. The web implements this as
`if (name && !key)`, which stops suggesting once the field is non-empty; mobile uses an
explicit `keyTouched` flag instead, because `!key` also resumes suggesting if the person
clears the field to retype it, which reads as the form fighting them.

### Ritual definition (`collaboration.ritual_definition`)

Written by `CreateRitualDefinition`, archived and unarchived by `ArchiveRitualDefinition`.

| Field | Mobile source | Rule |
|---|---|---|
| `project_id` | Route parameter | The person must be `owner` or `admin` of it — enforced in `ritual_logic.go`, mirrored in the UI. |
| `name` | Required text input | Non-empty after trim. |
| `description` | Optional multiline input | **Plain text on mobile.** The web editor is a rich-text surface; the field round-trips as text, so a phone-authored description is readable on both. |
| `recurrence_rule` | Recurrence picker | See the recurrence table below. Stored as JSON. |
| `completion_window_hours` | **Not collected** | Sent as `24` — the product default, and the web editor's own initial state. |
| `timezone` | Device, read-only display | IANA name from `Intl.DateTimeFormat().resolvedOptions().timeZone`, `"UTC"` on failure. `loadTimezone` accepts IANA names before offset strings, so this is a stored form the product already reads. |
| `default_assignee_ids` | Assignee picker, optional | Zero or more employee IDs, drawn from the project's members. Empty is valid and means unassigned, unchanged from today. |
| `evidence_requirements` | Requirement editor | **At least one.** Sent inline in the create request, so they commit in the definition's transaction. |
| `default_department_pools` | **Not collected** | Sent empty. Pools stay web-only (FR-012). |
| `procedure_document_id` | **Not collected** | Omitted. Attachment stays web-only (FR-012, spec 043). |
| `is_archived` | Archive action | `false` on create. Toggled by `ArchiveRitualDefinition`, behind a confirmation (FR-017). |

Server-assigned: `id`, `organization_id`, `created_by_employee_id`,
`generation_window_days` (hard-coded `30` in `ritual_logic.go`, not on the request at all),
`schedule_version`, `updated_at`.

**FR-012 preservation**: a definition configured on the web keeps its pools, its procedure
document, its non-default completion window and its custom recurrence when later *viewed* on
mobile, because mobile never issues an update for a definition — only create, archive and
unarchive. There is no partial-update path from mobile that could null a field it does not
collect. This is what makes FR-012's "preserved untouched" a structural property rather than
a discipline.

### Recurrence rule (embedded JSON on the definition)

`RecurrenceRule` carries `type`, `interval`, `days_of_week`, `day_of_month`, `nth_weekday`
and `time_of_day`. Mobile writes a strict subset:

| Recurrence | `type` | `interval` | `days_of_week` | `day_of_month` | Validation before save |
|---|---|---|---|---|---|
| Every day | `daily` | `1` | `[]` | `0` | none |
| Every week | `weekly` | `1` | 1–7 values, `1`=Mon … `7`=Sun | `0` | **at least one weekday**, else refused in place with the rule stated |
| Every month | `monthly` | `1` | `[]` | `1`–`31` | **a day must be chosen**, else refused in place |

`interval` is always `1` from mobile: `custom_interval` and `nth_weekday` are excluded
(FR-012), so there is no second numeric field on the form. `nth_weekday` is sent absent.
`time_of_day` is not collected and is sent empty, matching what the web editor sends.

### Evidence requirement (`collaboration.evidence_requirement`)

Created inline with the definition, never separately from mobile.

| Field | Mobile source | Rule |
|---|---|---|
| `name` | Required text input per requirement | Non-empty after trim. A requirement whose name is blank blocks the save rather than being silently dropped. |
| `description` | **Not collected** | Sent empty. |
| `evidence_types` | Multi-select chip row | **One or more** of `photo`, `voice_memo`, `pdf`, `file`, `link`, `text_note`, `gps_checkin` — the full set the product supports (FR-008). |
| `is_required` | Toggle, defaults to on | Required or optional (FR-008). |
| `approval_mode` | **Not collected** | Sent `manual`. Auto-approval is web-only (FR-012). |
| `auto_approve_config` | **Not collected** | Omitted. |
| `deadline_offset_hours` | **Not collected** | Sent `0`. Per-requirement deadline offsets are web-only. |

`position` is assigned server-side from the array index, so the order the person arranges
them in on the phone is the order they appear in.

### Tour stop (`internal/tour` content, not a table)

Not persisted — the two tours are a Go literal in `content.go`. Two stops change:

| Stop | Before | After |
|---|---|---|
| `project` | `WebOnly: true` + `MobileNote` | `WebOnly: false`, `MobileNote` **deleted** |
| `ritual` | `WebOnly: true` + `MobileNote` | `WebOnly: false`, `MobileNote` **deleted** |
| `people` | `WebOnly: true` + `MobileNote` | unchanged (FR-020) |

The notes are deleted rather than left in place: `logic.go` only reads `MobileNote` when
`WebOnly` is set, so a retained note is unreachable text asserting something false.
`content_version` is bumped, because the wording a mobile administrator sees changes.

The persisted side of the tour — `iam.tour_progress`, one row per
`(organization_id, employee_id, tour_id)` — is untouched. FR-022: progress, offer rules and
reopen behaviour are unchanged.

---

## Part 2 — Client-side draft models

These exist only in the create screens' React state. Nothing persists them; an abandoned form
is discarded, and a failed save leaves them intact so the person can correct and retry
(FR-016, SC-006).

### `ProjectDraft`

```
name: string
key: string
keyTouched: boolean      // stops the derivation, per FR-002
description: string
visibility: 'public' | 'private'          // default 'private'
collaborationMode: 'standard' | 'ritual' | 'mixed'   // default 'standard'
```

Submit is enabled when `name.trim()` and `key.trim()` are both non-empty. On press, the key
is tested against `projectKeySchema` before any request is made; a failure sets a field error
on the key input and nothing is sent. A server `key` field violation is rendered on the same
input, and every field keeps its value.

### `RitualDraft`

```
name: string
description: string
recurrence: { type: 'daily' | 'weekly' | 'monthly',
              daysOfWeek: number[],       // weekly only
              dayOfMonth: number }        // monthly only, 0 = unchosen
assigneeIds: string[]
requirements: EvidenceRequirementDraft[]  // at least one to submit
timezone: string                          // device, read-only
```

### `EvidenceRequirementDraft`

```
localId: string          // client-only, for list keys and reordering; never sent
name: string
evidenceTypes: EvidenceType[]   // at least one
isRequired: boolean             // default true
```

`localId` exists because a draft requirement has no server identity until the definition is
created; it is dropped at the request boundary. This is the one place a client-only field
exists, and it is why the drafts are modelled here rather than reusing
`EvidenceRequirementDetail` — that type carries `id`, `ritualDefinitionId` and `position`,
none of which a draft can honestly hold.

### Submit-time validation (all client-side, before any request)

| Condition | Message shown | Where |
|---|---|---|
| Name empty | "Give this ritual a name." | on the name field |
| Weekly with no weekday | "Pick at least one day of the week." | on the weekday row |
| Monthly with no day | "Pick a day of the month." | on the day grid |
| No requirement at all | "Add at least one thing this ritual has to prove." | on the requirements section |
| A requirement with a blank name | "Name this proof step." | on that requirement |
| A requirement with no proof type | "Pick at least one kind of proof." | on that requirement |

Each message states the rule in plain words rather than naming a constraint, per the spec's
edge case on weekly-with-no-day, and each anchors to the control that is wrong rather than
appearing as a form-level banner.
