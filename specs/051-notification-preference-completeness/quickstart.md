# Quickstart: Validating Notification Preference Completeness

How to run and prove this feature end to end. The contracts being validated live
in [contracts/](./contracts/); the scenarios being run are listed in
[contracts/test-scenarios.md](./contracts/test-scenarios.md).

---

## Prerequisites

```bash
make infra-up                                  # PostgreSQL + supporting services
cd backend && ./scripts/migrate.sh             # DATABASE_URL must be set
```

The migration is required this time: the feature adds
`notification.personal_preference.in_app_alerts_enabled` and widens the
`muted_domains_valid` CHECK.

Then the backend and the mobile app, started through the repository's own
tooling (`backend/scripts/dev/`, the Makefile header, and the mobile dev command
that resolves the LAN IP) rather than by hand.

## Regenerating the contract

```bash
cd backend && ./scripts/regen-schema.sh   # schema.sql is generated — never hand-edited
cd backend && sqlc generate               # picks up UpsertPersonalPreference
cd backend && buf generate                # writes rpc/v1/*.pb.go and frontend/packages/rpc
make lint-tenancy                          # the new query must stay tenancy-clean
```

`make lint-tenancy` is not a formality here: `UpsertPersonalPreference` writes a
tenant table, so it must pin `organization_id` and must not carry a
`-- lint:cross-tenant` marker.

---

## 1. Backend behavioural contract

```bash
make test-backend-one T=TestNotificationPersonalPreference
go test ./internal/notification/ -run TestPreferenceLogic -v
```

**Expect**: every scenario passes and the `go test -v` output reads as a
description of the behaviour — defaults for someone who has never set anything,
calendar accepted as a mute, every one of the nine domains accepted, a calendar
push suppressed while the same notification still appears in the list, a mention
still pushing with everything muted, an unknown domain refused by name with
nothing written.

The delivery pipeline is unchanged, so the existing suites must stay green:

```bash
make test-backend-one T=TestNotificationDeliveryConsistency
make test-backend-one T=TestNotificationPreferences
make test-backend-one T=TestCalendarNotification
```

## 2. The completeness property (SC-002)

This is the assertion that keeps drift D28 from recurring in a different domain.
It is inside `TestNotificationPersonalPreference`, but it is worth reading on its
own after a change to the domain list:

```bash
make test-backend-one T=TestNotificationPersonalPreference/every_source_domain
```

**Expect**: pass. **If it fails**, a domain was added to
`notification.AllSourceDomains` without being added to the
`muted_domains_valid` CHECK — which is exactly the failure mode this feature
exists to close, caught the first time rather than two features later.

## 3. Static gates

```bash
cd frontend && pnpm run typecheck:mobile
cd frontend && pnpm lint
```

**Expect**: both clean. `typecheck:mobile` is the gate that proves FR-014 — with
`src/lib/app-settings.ts` deleted, any surviving importer is a compile error
rather than a runtime surprise. (Note the standing caveat in drift **D34**:
nothing runs `tsc` on mobile in CI yet, so this has to be run by hand.)

## 4. The mobile happy path

```bash
cd frontend/apps/mobile && maestro test .maestro/settings/notification-preferences.yaml
```

**Expect**: In-App Alerts and the nine-row mute list are visible, Calendar among
them; both toggles hold their new value across a dev-client relaunch.

Run it on **both** an Android device and an iOS target, per the standing rule
that mobile UI is verified on Android as well as iOS — the habitual test device
is an iPhone SE, so a nine-row section that overflows on a narrow Android screen
would otherwise go unnoticed.

## 5. By hand, the two things a driver cannot show

1. **The preference follows the person (US1, SC-003).** Sign in as the same
   person on a second device, or on a simulator alongside the phone. Turn
   In-App Alerts off on one; open Settings on the other. It reads off without
   being touched. Then sign out and sign in as a colleague on the *same*
   handset: In-App Alerts reads on.
2. **A refused write is visible (FR-021).** Put the device in airplane mode and
   flip a mute. The switch moves, then returns to where it was, and the
   "Couldn't save that" alert explains why. Nothing is queued: bring the network
   back and confirm the domain is still unmuted.

## 6. The user-visible outcome (SC-001)

From a cold open of the app, mute Calendar in under 30 seconds: More →
Settings → scroll to Notifications → Calendar switch. Then have someone send a
calendar invite while the phone is locked, and confirm no push arrives while the
invite is waiting in the alerts tab when the phone is opened.

---

## Definition of Done

- [ ] `TestNotificationPersonalPreference` passes in full, and the three named
      pre-existing suites stay green
- [ ] `TestPreferenceLogic` passes
- [ ] `make lint-tenancy` green
- [ ] `pnpm run typecheck:mobile` and `pnpm lint` clean
- [ ] `.maestro/settings/notification-preferences.yaml` passes on Android **and**
      an iOS target
- [ ] `frontend/apps/mobile/src/lib/app-settings.ts` is **deleted**, and
      `grep -r notifications_enabled frontend/` returns nothing (FR-014, SC-007)
- [ ] `backend/database/scripts/schema.sql` regenerated by
      `regen-schema.sh`, not edited
- [ ] `docs/domain/notifications-presence.md` — the "`muted_domains` omits
      `calendar`" drift paragraph is **removed**, the personal-preference row in
      the storage table gains `in_app_alerts_enabled`, and the two new RPCs are
      described (Principle XII)
- [ ] `docs/domain/calendar.md` — the "Calendar cannot be domain-muted" drift
      paragraph is **removed**
- [ ] `docs/domain/README.md` — **D28 removed** from the drift register (SC-008)
- [ ] `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` — the personal
      preference now has a write path and a client; check whether it says
      otherwise and correct it if so
