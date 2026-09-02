# Phase 1 Data Model: Feature Tour

Two things hold state for this feature: one table that records what a person has seen, and
a pair of Go values that define what there is to see. Only the first is data in the database
sense; the second is deliberately code, for the reasons in [research.md](research.md).

## `iam.tour_progress`

One row per person per tour. Created on first write, never on read — `GetTour` returns a
`NOT_STARTED` default for an absent row, the same pattern `GetUserPreference` already uses.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | `DEFAULT uuidv7()` |
| `organization_id` | `uuid NOT NULL` | tenant key, leading column everywhere |
| `employee_id` | `uuid NOT NULL` | the person |
| `tour_id` | `text NOT NULL` | `'administrator'` or `'worker'`, CHECK-constrained |
| `status` | `text NOT NULL` | `'in_progress'`, `'completed'`, `'dismissed'`, CHECK-constrained |
| `current_stop` | `integer NOT NULL DEFAULT 0` | zero-based index of the first stop not yet completed |
| `content_version` | `text NOT NULL` | the tour content version in force when the row was last written |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

**Keys and constraints**

- Primary key `(organization_id, id)` — composite, tenant key leading (Constitution I).
- Unique `(organization_id, employee_id, tour_id)` — tenant key leading. This is the natural
  key every query uses, so no second index is needed.
- Foreign key `(organization_id, employee_id)` → `iam.employee (organization_id, id)`,
  `ON DELETE CASCADE`.
- `CHECK (tour_id IN ('administrator','worker'))`
- `CHECK (status IN ('in_progress','completed','dismissed'))`
- `CHECK (current_stop >= 0)`

**Why `NOT_STARTED` is not a status value.** The absence of a row *is* not-started. Storing
it would mean writing a row for every person who is merely offered the tour, which turns a
read path into a write path and inflates the denominator of every completion-rate query in
SC-002 and SC-004.

**Why `content_version` is stored.** It records which version of the tour a person actually
saw. Nothing reads it in this feature — a completed tour is never re-offered because its copy
changed (an explicit spec edge case) — but without it, a future decision to re-offer after a
substantial rewrite has no data to act on. One text column, written on every upsert.

### State transitions

```
        (no row)                  ── the person has never engaged
            │
            ├── starts the tour ──────────────→ in_progress (current_stop = 0)
            └── declines the offer ───────────→ dismissed

      in_progress
            ├── advances a stop ─────────────→ in_progress (current_stop = n+1)
            ├── goes back a stop ────────────→ in_progress (current_stop = n-1)
            ├── leaves mid-tour ─────────────→ in_progress (unchanged; resumable)
            ├── dismisses ───────────────────→ dismissed
            └── finishes the last stop ──────→ completed (current_stop = len(stops))

      completed / dismissed
            └── restarts from Help ──────────→ in_progress (current_stop = 0)
```

`in_progress` is the only state that is offered automatically. `completed` and `dismissed`
are both terminal with respect to the automatic offer (FR-007) and both re-enterable by
deliberate restart (FR-017). Declining is a decision, not a snooze.

**Idempotency**: every write is an upsert on the natural key. Re-sending the same stop index
is a no-op beyond `updated_at`, which matters because both clients may write on navigation
and on unmount.

### Queries — `backend/database/scripts/tour.query.sql`

| Name | Kind | Purpose |
|---|---|---|
| `GetTourProgress` | `:one` | read one row by `(organization_id, employee_id, tour_id)` |
| `UpsertTourProgress` | `:one` | insert or update on the natural key, refreshing `updated_at` |
| `DeleteTourProgressForOrganization` | `:exec` | organization teardown, called from the account-deletion sweep |

Every query pins `organization_id` to a parameter. None is cross-tenant, so none carries a
`-- lint:cross-tenant` marker.

## Tour definitions — `internal/tour/content.go`

Go values, not rows. Shapes:

```
Tour  { ID, ContentVersion, Stops []Stop }
Stop  { Key, Title, Body, ActionLabel, Target, RequiredPermission, WebOnly, MobileNote }
```

| Field | Meaning |
|---|---|
| `Key` | stable identifier for the stop, used by tests and by the clients' `testID`s |
| `Title`, `Body`, `ActionLabel` | the copy the client renders verbatim |
| `Target` | `TourTarget` enum value the client maps to its own route |
| `RequiredPermission` | permission id gating the stop; empty means always shown (FR-006) |
| `WebOnly` | the capability does not exist on mobile |
| `MobileNote` | the substitute body used when `WebOnly` and the caller is mobile (FR-023) |

**Selection**: `iam.inviteUser` in the caller's permission set → administrator tour,
otherwise worker tour.

**Filtering pipeline**, applied in `logic.go` in this order:

1. Drop stops whose `RequiredPermission` the caller lacks.
2. For a mobile caller, replace `Body` with `MobileNote` and force `Target` to
   `TARGET_NONE` on `WebOnly` stops, so the client renders no action button.
3. Index the surviving stops from zero. **`current_stop` indexes the filtered list**, which
   is why `content_version` is worth storing: a content change can shift what a stored index
   points at, and the stored version is the only record of that.
4. **Clamp the stored position to the filtered list on read.** Because the list length depends
   on permissions, a revoked permission can leave the stored index past the end. `GetTour`
   returns `min(current_stop, len(stops) - 1)`, or `0` for an empty list, without writing the
   clamped value back — the permission may be restored, and the person should return to where
   they actually were. A `COMPLETED` row keeps reporting `len(stops)`. (FR-015a)

The stop-by-stop copy for both tours is in [contracts/tour-content.md](contracts/tour-content.md).

## The permission ids this feature depends on

`content.go` and the audience rule reference permission ids as bare strings —
`iam.inviteUser`, `collab.createProject`, `collab.manageRitualDefinition`,
`collab.submitEvidence`, `collab.viewTask`, `chat.viewChannel`, `docs.create`, `notif.view`.
There is no Go permission catalogue to compile against: the ids live only in `public.permission`
and in the proto `access_control` options, so a typo or a later rename fails **silently** — the
audience flips or a stop quietly disappears, with nothing to catch it.

A test asserts that every permission id referenced by tour content exists in
`public.permission`. It is three lines and it is the only thing standing between a renamed
permission and a tour that shows the wrong person the wrong stops.

## New permissions

Two rows in `public.permission`, and grants to all three seeded role templates — every
person needs to see their own tour.

| Permission | Purpose |
|---|---|
| `tour.view` | read the tour and one's own progress |
| `tour.update` | write one's own progress |

Both are granted to `owner`, `operator` and `employee` in the same migration. `tour` becomes
a new permission domain alongside `iam`, `org`, `dept`, `chat`, `files`, `docs`, `collab`,
`notif`, `calendar` and `pref`.

## What this feature does not store

- No per-stop view records, no timestamps per stop, no dwell time.
- No tour content in the database, and so no authoring, versioning or seeding path.
- No analytics events. The success criteria are answered from this table plus data the
  product already keeps.
