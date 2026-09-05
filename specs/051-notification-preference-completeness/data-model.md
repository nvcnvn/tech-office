# Data Model: Notification Preference Completeness

**Feature**: `051-notification-preference-completeness` | **Date**: 2026-09-05

One existing table gains one column and a widened CHECK. Nothing else in the
schema moves.

---

## `notification.personal_preference` (MODIFIED)

One row per person per organization. Absent for the great majority of people, in
which case the documented defaults apply.

| Column | Type | Null | Default | Change | Notes |
|---|---|---|---|---|---|
| `organization_id` | `uuid` | no | — | unchanged | PK part 1, FK to `public.organization(id)` |
| `employee_id` | `uuid` | no | — | unchanged | PK part 2; composite FK `(organization_id, employee_id)` → `organization.employee(organization_id, id)` `ON DELETE CASCADE` |
| `in_app_alerts_enabled` | `boolean` | no | `true` | **NEW** | Draw the foreground banner while the app is open. Stored and returned by the server; **never read by the delivery pipeline** (FR-012) |
| `dnd_enabled` | `boolean` | no | `false` | unchanged | |
| `dnd_start` | `time` | yes | `NULL` | unchanged | No timezone, no seconds. Read by `ShouldSuppressPush` against `LOCALTIME` |
| `dnd_end` | `time` | yes | `NULL` | unchanged | Wrapping windows (22:00→06:00) are handled by the existing reader |
| `muted_domains` | `text[]` | no | `'{}'` | **CHECK widened** | Push suppressed for these source domains |
| `created_at` | `timestamptz` | no | `now()` | unchanged | |
| `updated_at` | `timestamptz` | no | `now()` | unchanged | Set explicitly by the upsert |

### Constraint change

```sql
CONSTRAINT muted_domains_valid CHECK (muted_domains <@ ARRAY[
    'chat','projects','docs','crm','hr','support','finance','system','calendar'])
```

`calendar` is the only addition. This list MUST equal
`notification.AllSourceDomains` in Go and the `notification.notification.source_domain`
CHECK; the equality is enforced by the SC-002 integration scenario, not by review
(see [research.md R2](./research.md)).

Widening a `<@` (contained-by) CHECK only permits values previously rejected, so
every existing row remains valid and **no data migration is required**.

### Tenancy check (Principle I)

| Requirement | Status |
|---|---|
| Composite primary key leading with `organization_id` | already `(organization_id, employee_id)` |
| Unique indexes lead with `organization_id` | no additional index added |
| Foreign keys reference composite keys | already `(organization_id, employee_id)` |
| Every query pins `organization_id` | both queries take `@organization_id` from the auth context |
| No cross-schema join | the new queries touch `notification.personal_preference` only |

---

## Source domain (REFERENCE — not a table)

The nine areas the workspace publishes notifications from. Each may be
independently muted. The list exists in four places and they must agree:

| Where | Form | Change |
|---|---|---|
| `backend/internal/notification/constants.go` | `AllSourceDomains []string`, with `IsValidSourceDomain` defined over it | **NEW** slice; the nine `SourceDomain*` constants already exist |
| `notification.notification.source_domain` CHECK | SQL literal list | unchanged — already has all nine |
| `notification.personal_preference.muted_domains` CHECK | SQL literal list | **`calendar` added** |
| `frontend/packages/apis/src/notification.ts` | `SourceDomain` union + `SOURCE_DOMAINS` array | **`calendar` added** to the union; `SOURCE_DOMAINS` is new |

Values: `chat`, `crm`, `projects`, `docs`, `hr`, `support`, `finance`, `system`,
`calendar`.

Ordering: `SOURCE_DOMAINS` is the display order of the mute list, so it is
ordered for a reader — chat first because it is the noisiest, `system` last
because it is the one nobody mutes — not alphabetically. `AllSourceDomains`
ordering is irrelevant and is not depended on.

---

## Wire entity: `NotificationPreferences`

Not stored; the projection of one `personal_preference` row (or of the defaults)
onto the RPC contract. Full definition in
[contracts/notification-preferences.proto](./contracts/notification-preferences.proto).

| Field | Type | Maps to |
|---|---|---|
| `in_app_alerts_enabled` | `bool` | column of the same name |
| `muted_domains` | `repeated string` | `muted_domains`, **filtered to known domains on read** (R8) |
| `dnd_enabled` | `bool` | column of the same name |
| `dnd_start` / `dnd_end` | `string` `"HH:MM"` | `dnd_start` / `dnd_end`; empty string when `NULL` |
| `updated_at` | `Timestamp` | `updated_at`; unset when no row exists |

---

## Defaults when no row exists (FR-006)

`GetNotificationPreferences` returns `exists = false` and:

| Field | Default |
|---|---|
| `in_app_alerts_enabled` | `true` (FR-011) |
| `muted_domains` | `[]` |
| `dnd_enabled` | `false` |
| `dnd_start` / `dnd_end` | `""` |
| `updated_at` | unset |

These match the column defaults exactly, so the first
`UpdateNotificationPreferences` creates a row whose untouched fields hold the
same values the caller was already shown.

---

## Validation rules

Applied in the logic layer, in this order, before any write:

1. **Known domains only** — every entry of `muted_domains` must satisfy
   `IsValidSourceDomain`. The first offender fails the whole request with
   `CodeInvalidArgument` and a message naming the value; nothing is written
   (FR-007).
2. **Dedupe and sort** — duplicates collapse to one entry, and the stored array
   is sorted so two clients sending the same set store the same array (FR-008).
3. **Do-not-disturb times** — each of `dnd_start` / `dnd_end` is either empty or
   `HH:MM` with `00 <= HH <= 23` and `00 <= MM <= 59`; a malformed value is
   `CodeInvalidArgument`. No screen in this feature sends them, but the contract
   accepts them, so it validates them.
4. **Whole-record replace** — the upsert writes all five values plus
   `updated_at = now()`. There is no partial write (FR-009).

The `muted_domains_valid` CHECK is the backstop for rule 1, not its
implementation: the check produces a constraint-violation error, the logic layer
produces the message that names the value.

---

## State transitions

The record has no lifecycle state. It is absent, or it exists; the first
successful update creates it and no path deletes it except the employee's
`ON DELETE CASCADE`. Concurrent updates from two devices are last-write-wins
over the whole row, which is the intended resolution — a person is the only
writer of their own record (spec assumption).
