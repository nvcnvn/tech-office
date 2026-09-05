# Behavioural contract: test scenarios

**Feature**: `051-notification-preference-completeness`

Constitution II makes these scenarios the feature's behavioural contract: they
are written as `t.Run` stubs before implementation, they must be approved before
`/speckit-tasks` runs, and every user story and user-observable FR must be
traceable to at least one of them.

---

## Backend — `backend/integration/notification_personal_preference_test.go` (NEW)

One new file, `TestNotificationPersonalPreference`, in the repository's
`testWorld` idiom. The existing `notification_preference_test.go` covers
*per-channel and per-resource* preferences and is untouched; this covers the
*personal* record, which nothing has ever exercised because it had no write
path.

```go
func TestNotificationPersonalPreference(t *testing.T) {
    t.Parallel()

    // ── The stored record and its contract ──────────────────────────────────
    t.Run("a person who has never set preferences reads the documented defaults", ...)
        // FR-006, FR-011: in-app alerts on, nothing muted, DND off, exists = false

    t.Run("the first change creates the record and reads back exactly", ...)
        // FR-004, FR-010: exists = false, then update, then exists = true with the sent values

    t.Run("a person reads and writes only their own preferences", ...)
        // FR-005: alice mutes chat; bob's read is unaffected and still exists = false

    t.Run("a change replaces the whole record", ...)
        // FR-009: set a DND window, then change only the mute list on the client's
        // round-tripped record; the DND window survives. Then send a record with
        // dnd_enabled false and confirm it is cleared, not merged.

    t.Run("a domain the system does not recognise is refused by name and stores nothing", ...)
        // FR-007: InvalidArgument mentioning "marketing"; the previously stored
        // mute list is byte-identical afterwards

    t.Run("a domain named twice is stored once", ...)
        // FR-008: ["chat","chat","calendar"] reads back as two entries

    t.Run("a malformed do-not-disturb time is refused", ...)
        // data-model rule 3: "25:00" is InvalidArgument

    // The "stored domain the system no longer recognises" edge case is NOT here:
    // the CHECK makes such a row unwritable, so an integration test could only
    // produce one by altering the constraint mid-test. It is covered instead by
    // preference_logic_test.go below, where the filter is a pure function.

    // ── Calendar, and the completeness property ─────────────────────────────
    t.Run("calendar can be muted", ...)
        // FR-001: the drift D28 case, stated on its own so a regression is legible

    t.Run("every source domain the system publishes from can be muted", ...)
        // FR-002, SC-002: iterate notification.AllSourceDomains, mute each one in
        // turn, assert each is accepted. This is the guard that keeps the CHECK,
        // the Go list and the TypeScript list from drifting again.

    // ── Delivery behaviour ──────────────────────────────────────────────────
    t.Run("muting calendar suppresses push for a calendar notification", ...)
        // US2, FR-015: recipient offline with a registered push token; publish a
        // calendar_event_invite; delivery_attempt reason is suppressed_by_preference

    t.Run("a muted domain's notification is still listed and still counts as unread", ...)
        // US2, FR-016, SC-006: the same publish appears in ListNotifications and
        // raises GetUnreadCount

    t.Run("muting one domain leaves another domain's push alone", ...)
        // US2, FR-018: with calendar muted, a chat message still produces a
        // delivery attempt without suppressed_by_preference

    t.Run("with every domain muted a mention still pushes", ...)
        // US2, FR-017, SC-005: mute all nine; a priority-0 mention is not suppressed

    t.Run("unmuting restores push with no further action", ...)
        // US2 scenario 6: mute, confirm suppression, unmute, confirm delivery

    // ── In-app alerts do not touch delivery ─────────────────────────────────
    t.Run("turning in-app alerts off changes nothing the server does", ...)
        // FR-012: with in_app_alerts_enabled false, the notification is still
        // recorded, still listed, still counted, and still pushed
}
```

### Traceability

| Requirement | Scenario |
|---|---|
| FR-001 | calendar can be muted |
| FR-002 | every source domain … can be muted |
| FR-003, FR-006, FR-011 | defaults for a person who has never set preferences |
| FR-004, FR-010 | first change creates the record |
| FR-005 | reads and writes only their own |
| FR-007 | unrecognised domain refused by name; `normalizeMutedDomains` |
| FR-008 | domain named twice stored once; `normalizeMutedDomains` |
| FR-009 | change replaces the whole record |
| FR-012 | in-app alerts off changes nothing the server does |
| FR-013 | first change creates the record (a second client's read is the same RPC) |
| FR-014 | not backend-observable — covered by the deletion of `app-settings.ts` and `pnpm typecheck:mobile` |
| FR-015 | muting calendar suppresses push |
| FR-016 | still listed and still counts as unread |
| FR-017 | with every domain muted a mention still pushes |
| FR-018 | muting one domain leaves another alone |
| FR-019…FR-022 | mobile UI — Maestro flow below |
| SC-002 | every source domain … can be muted |
| SC-005 | with every domain muted a mention still pushes |
| SC-006 | still listed and still counts as unread |

### Pure-function check — `backend/internal/notification/preference_logic_test.go` (NEW)

Two table-driven cases for the two pure transforms, alongside the package's
existing `publisher_test.go` and `call_wake_test.go`:

- `filterKnownDomains` drops a stored domain the system no longer recognises and
  preserves the rest, in order. This is the edge case an integration test cannot
  reach, because the CHECK makes such a row unwritable through any supported
  path — the value can only exist if a future migration narrows the list.
- `normalizeMutedDomains` deduplicates and sorts, and reports the first
  unrecognised value by name (FR-007, FR-008).

### New helper

`publishDomainNotification(recipientID, sourceDomain, notificationType, policyKey, priority, title)`
in `helper_test.go`. The three existing publish helpers all hard-code
`chat`/`message`, and this feature is about the domains that are not chat.

---

## Mobile — `.maestro/settings/notification-preferences.yaml` (NEW)

Principle XIII's one happy-path blackbox flow, following the shape of
`.maestro/settings/dark-mode-toggle.yaml`.

```text
sign in → More → Settings
  assert the mute list is visible and Calendar is in it        (FR-019, SC-002)
  toggle In-App Alerts off                                     (FR-019, FR-021)
  toggle Mute Calendar on                                      (US2, FR-019)
  relaunch the dev client
  More → Settings
  assert In-App Alerts is off and Calendar is muted            (FR-022, SC-004)
```

The relaunch, not a reinstall, is the point: it proves the values were read back
rather than remembered, which is the whole of US1.

**Not covered by Maestro, deliberately**: the "second device, same person"
half of US1 (a blackbox driver runs one device) and the rollback-on-failure path
of FR-021 (a driver cannot cut the network mid-tap). The first is covered by the
backend scenarios — the RPC derives the person from the session, so a second
device is the same read — and the second by the identical, already-shipped
rollback in the theme toggle.

---

## Web E2E — none

The feature adds no web surface (spec: client scope is mobile only; the web
settings area has no notification-preference controls today). Recorded as a
justified deviation from Principle II in the plan's Complexity Tracking.
