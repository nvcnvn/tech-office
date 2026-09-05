# Phase 0 Research: Notification Preference Completeness

**Feature**: `051-notification-preference-completeness` | **Date**: 2026-09-05

The spec left no `[NEEDS CLARIFICATION]` markers — it resolved its own open
questions in an Assumptions section. What Phase 0 had to establish instead is
*where the code actually is today*, because three of the spec's claims are
statements about the current system that the plan depends on being true. Each
finding below was read out of the repository, not recalled.

---

## R1 — The stored record, and what already reads it

**Decision**: Extend `notification.personal_preference` in place. Add one
column, widen one CHECK. Do not create a second table and do not move the
record.

**What is there today** (`backend/database/scripts/schema.sql:3268`):

```sql
CREATE TABLE notification.personal_preference (
    organization_id uuid NOT NULL,
    employee_id     uuid NOT NULL,
    dnd_enabled     boolean DEFAULT false NOT NULL,
    dnd_start       time without time zone,
    dnd_end         time without time zone,
    muted_domains   text[] DEFAULT '{}'::text[] NOT NULL,
    created_at      timestamptz DEFAULT now() NOT NULL,
    updated_at      timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT muted_domains_valid CHECK (muted_domains <@ ARRAY[
        'chat','projects','docs','crm','hr','support','finance','system'])
);
-- PRIMARY KEY (organization_id, employee_id)
-- FK (organization_id, employee_id) -> organization.employee(organization_id, id) ON DELETE CASCADE
```

It is already tenant-correct under Principle I: composite primary key leading
with `organization_id`, composite foreign key, no cross-tenant uniqueness. The
feature adds a column to a table that already satisfies the schema checklist,
so no tenancy work is created.

**The only reader** is `routingLogicImpl.ShouldSuppressPush`
(`backend/internal/notification/routing_logic.go:233`), reached through
`DecideFallback`. Three properties of that reader matter to this feature and
are already true, which is why the delivery pipeline needs **no change at all**:

| Spec requirement | Already true because |
|---|---|
| FR-015 muting suppresses push | the mute loop returns `true`, and the caller records `suppressed_by_preference` |
| FR-016 muting does not suppress the record, the list, or unread | `ShouldSuppressPush` is consulted only on the *push fallback* path; the row and the SSE event are written before it runs |
| FR-017 mentions and calls come through | `if priority == 0 { return false, nil }` is the first statement in the function; `call_wake` never consults it |

**The only writer** is nothing. `GetPersonalPreference`
(`backend/database/scripts/notification.query.sql:886`) is the sole query
against the table; there is no INSERT, no UPDATE, and no RPC. The spec's second
gap — "nothing can be muted, by anyone" — is confirmed exactly as written.

**Alternatives considered**: moving these fields onto `iam.user_preference`
(owned by `PreferenceService`, where the theme lives) was rejected for the
reason the spec gives — it would split one record across two owners — and for a
second reason found in the code: `ShouldSuppressPush` runs inside the delivery
transaction on `notification.*`, and reading a preference out of `iam.*` from
there would be a cross-schema join, which Principle I forbids outright.

---

## R2 — `calendar` is missing from three lists, not one

**Decision**: Treat FR-002 as "one Go list is the source of truth, and every
other list is checked against it by a test", not as "add `calendar` in three
places and hope".

`calendar` is a valid `source_domain` — the notification table's own CHECK has
admitted it since migration `20260320000002_notification_calendar_checks.up.sql`,
and `IsValidSourceDomain` in `backend/internal/notification/constants.go:279`
accepts it. Three places disagree:

| Location | Has `calendar`? |
|---|---|
| `notification.notification.source_domain` CHECK | yes (9 values) |
| `IsValidSourceDomain` (Go) | yes (9 values) |
| `notification.personal_preference.muted_domains` CHECK | **no** (8 values) — drift D28 |
| `SourceDomain` union in `packages/apis/src/notification.ts:92` | **no** (8 values) |

The TypeScript omission is a second instance of the same drift, unrecorded in
the register and found while reading for this plan. It has been harmless only
because nothing on a client has ever filtered by `calendar` domain; the moment
a settings screen renders one row per `SourceDomain`, an omission there is a
domain that cannot be muted — precisely the gap this feature closes.

**Mechanism**: add `AllSourceDomains []string` to `constants.go` and define
`IsValidSourceDomain` in terms of it, so Go has exactly one list. SQL cannot
import that list, so the CHECK stays a literal — but an integration test that
iterates `AllSourceDomains` and mutes each one in turn fails the moment the
CHECK falls behind (SC-002). That test is the enforcement, and it is the reason
FR-002 is worded as a property rather than a to-do.

**Alternatives considered**: dropping the CHECK entirely and validating only in
Go was rejected — the CHECK is the last line of defence for a table an operator
can still write to by hand, and it is what makes "the database refuses an
unknown domain" true rather than aspirational. Generating the CHECK from Go at
migration time was rejected as machinery for a nine-element list.

---

## R3 — Where the write path goes, and which permission guards it

**Decision**: Two new RPCs on the existing `NotificationService`,
`GetNotificationPreferences` and `UpdateNotificationPreferences`, guarded by the
existing `pref.view` and `pref.update` permissions.

The shape is copied from the closest precedent in the same service —
`GetPresenceSettings` / `SetPresenceVisibility`
(`backend/rpc/v1/notification.proto:161`, implemented in
`visibility_connect.go` over `visibility_logic.go`). That pair already
demonstrates the whole pattern this feature needs: an empty request for the
read, inline scalar fields on the write, both deriving employee and
organization from `extractAuthContext` and taking no identity from the caller
(FR-005), with the logic layer taking `tx database.DBTX` and the connect layer
owning `txn.WithTxn` (Principle III).

**On the permission**, the alternative was a new `notif.notificationSettings`
id. That costs a migration that inserts into `public.permission`, updates all
three rows of `public.default_role_permission`, and back-fills
`iam.role_permission` for every existing organization —
`20260403000001_add_missing_collab_ritual_calendar_permissions.up.sql` is the
90-line template. `pref.view` ("View user preferences") and `pref.update`
("Update user preferences") already exist, already mean exactly this, and are
already granted to owner, operator and employee. Principle III requires
permission ids from the catalogue with OR semantics; it does not require the
id's domain prefix to match the service's. `voice.proto` already guards every
one of its RPCs with `chat.*` permissions, so cross-prefix reuse is established
practice here, not an invention.

[ASSUMPTION: `pref.view`/`pref.update` guard the two new RPCs instead of new
`notif.*` ids. An organization that strips `pref.update` from a custom role to
take away the theme toggle would also take away notification preferences. That
is a coherent outcome for a permission literally named "Update user
preferences", and it is worth avoiding a permission migration plus a
per-organization back-fill for a nine-element preference record.]

---

## R4 — Whole-record replace, and the shape of the wire message

**Decision**: `UpdateNotificationPreferencesRequest` carries the five stored
values as inline scalars; both responses carry a `NotificationPreferences`
message. The write is `INSERT … ON CONFLICT (organization_id, employee_id) DO
UPDATE`, replacing every field.

FR-009 asks for whole-record replacement so the do-not-disturb window and the
mute list cannot drift apart across two partial writes. That makes an upsert
the natural statement and removes any need for `COALESCE` partial-update
machinery or a field mask. Constitution I explicitly permits `now()` inside
`ON CONFLICT … DO UPDATE` since the database is a single un-sharded node.

Reusing one `NotificationPreferences` message for both request and response was
rejected: it would put a server-owned `updated_at` on the request, a field the
handler must then ignore. Inline request fields match `SetPresenceVisibility`
and make the ignored-field question disappear.

**On the do-not-disturb times**: `dnd_start` / `dnd_end` are
`time without time zone` and nullable. They cross the wire as `"HH:MM"` strings,
empty when unset. `google.type.TimeOfDay` is not currently imported anywhere in
`backend/rpc/v1/`, and adding a well-known-type dependency for two fields no
screen edits in this feature is out of proportion.

[ASSUMPTION: do-not-disturb times are `"HH:MM"` strings on the wire. The stored
type has no timezone and no seconds, so a string in the same shape is a faithful
representation; a future do-not-disturb screen can revisit this without a schema
change.]

---

## R5 — In-app alerts: a client gate, stored on the server

**Decision**: `in_app_alerts_enabled boolean NOT NULL DEFAULT true` on
`personal_preference`. The backend stores and returns it and **never reads it**.

FR-012 is explicit that turning in-app alerts off must not change what is
recorded, what is listed, what is counted, or what is pushed — it removes one
banner drawn by one client. So the correct place for the check is where the
banner is drawn, and the only reason the value goes to the server at all is so
it follows the person (FR-010, FR-013). Adding it to
`ShouldSuppressPush` would be actively wrong: it would silence pushes as well.

Today the banner gate is `liveNotification && inAppAlertsEnabled` at
`apps/mobile/src/app/(app)/_layout.tsx:345`, reading `useInAppAlertsEnabled()`
from `src/lib/app-settings.ts` — an MMKV store whose *only* content is this one
key. FR-014 requires that store to be removed rather than mirrored, which means
`app-settings.ts` is deleted outright and its two importers switch to the
server-backed hook. Net file count for the mobile preference plumbing is zero.

**Alternatives considered**: keeping the MMKV key as a write-through cache was
rejected by FR-014, and independently by what already exists: React Query's
cache is *already* persisted to MMKV by `src/lib/query-client.ts` and cleared on
sign-out by `resetAuthenticatedAppState`. A hand-rolled cache would be a second
device copy of a value that is already cached correctly.

---

## R6 — The client pattern: React Query, optimistic, rollback on failure

**Decision**: One hook, `useNotificationPreferences`, over
`useQuery(["notification-preferences"])` plus a mutation that writes the whole
record, applies the change optimistically, and rolls the cache back on failure
with an `Alert`.

This is the pattern feature 050 established for the theme toggle and that the
spec's assumption names as precedent — `apps/mobile/src/lib/theme.tsx` and the
`handleThemeToggle` handler in `settings.tsx:184`, which repaints immediately
and says so out loud when the write fails. FR-021 asks for exactly that
behaviour; FR-023-by-implication (the spec's "Muting while offline" edge case)
asks for it *not* to be queued. React Query's `onMutate`/`onError`/`onSettled`
gives optimistic-plus-rollback without any new dependency.

Two consequences worth recording:

- **FR-022 comes for free on relaunch.** `setupQueryPersistence` restores every
  successful query from MMKV at startup, so the settings screen paints the last
  server-known preference rather than a device default, then refetches.
- **US1 scenario 2 comes for free at sign-out.** `resetAuthenticatedAppState`
  calls `queryClient.clear()` and `clearPersistedQueryCache()`, so a colleague
  signing in on the same handset cannot see the previous person's cached value.

The theme needed a React *provider* because a palette is read by 98 modules.
Notification preferences are read by two — the banner gate and the settings
screen — so a plain hook is enough. No context, no provider.

---

## R7 — Where the mute list lives in the UI

**Decision**: Inline in the existing **Notifications** section of
`app/(app)/(more)/settings.tsx`. No new route, no new screen.

The screen already has a `Notifications` section containing the single In-App
Alerts row, and already has the `SettingSectionLabel` / `Card` / `SettingRow`
vocabulary to add nine more switch rows without inventing a component. A
dedicated sub-screen (the `blocked.tsx` shape) would add a route, a navigation
row, a second data-loading site, and two more steps to SC-001's 30-second
budget.

Nine switches is a long section, but a settings screen is a scrolling surface
and Principle XIII's ask is large tap targets and plain language, not brevity —
both of which the existing `SettingRow` already provides.

**Copy is part of the work, not decoration.** US3 and FR-020 are satisfied by
the `subtitle` strings, which is why they are specified in
[contracts/settings-copy.md](./contracts/settings-copy.md) rather than left to
the implementer.

---

## R8 — Unknown stored domains

**Decision**: Filter unknown values out **on read**. Validate strictly **on
write**.

The spec asks for two things that sound contradictory: an unknown domain in a
request must be refused (FR-007), and a stored record naming a domain the system
no longer has must not stop the person reading or saving (edge case), with the
unknown entry dropped on the next save.

Filtering on read resolves both without a special case: the client is never
handed a value it would have to send back, so the next whole-record save
naturally omits it, and the strict write validation never sees it. The read
therefore returns a value that can differ from storage — deliberate, and
documented in the contract.

---

## R9 — Testing shape

**Decision**: One new backend integration test file, one new Maestro flow, no
Playwright spec.

Constitution II requires a backend integration scenario per user story and
per user-observable FR, and a web E2E scenario per UI-visible behaviour. The UI
here is mobile-only (the spec's client-scope assumption; the web settings area
has no notification-preference controls today), so there is no web journey to
drive and the E2E half is satisfied by Principle XIII's Maestro flow. This is
recorded as a justified deviation in the plan's Complexity Tracking, following
the precedent set by feature 050.

The suppression scenarios need a recipient who is offline with a registered push
token, and then need to read `notification.delivery_attempt`. Both already have
helpers: `registerPushToken` and `deliveryAttemptReasons`
(`backend/integration/helper_test.go:1440,2627`). One new helper is needed —
a `publishNotification` variant that takes the source domain, notification type
and priority, since the existing three all hard-code `chat`/`message`.
