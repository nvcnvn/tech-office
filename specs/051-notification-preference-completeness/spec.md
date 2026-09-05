# Feature Specification: Notification Preference Completeness

**Feature Branch**: `051-notification-preference-completeness`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Notification preference completeness. Allow the calendar domain to be muted like every other domain, and move the in-app alert toggle from device-local storage to the server preference so it follows the person. The settings screen promises a control that does not fully apply. Clears drift D28."

## Context

Two related gaps make the workspace's notification preferences less than they appear:

1. **Calendar cannot be muted.** The stored list of muted domains is validated against a
   fixed set of eight domain names that omits `calendar`, even though calendar is a valid
   notification source that publishes six notification types (invite, cancel, change,
   reminder, missed check-in, digest). Recorded as drift **D28**.

2. **Nothing can be muted, by anyone.** The stored preference record holding the muted
   domain list and the do-not-disturb window is *read* by the delivery pipeline but has no
   write path at all — no screen, no request surface. It can only be populated by an
   operator writing directly to the database. So domain muting and do-not-disturb are
   features the system enforces but nobody can turn on.

3. **The one notification control a person can reach is device-local and overpromises.**
   The mobile settings screen offers an "In-App Alerts" switch stored on the handset. It
   does not follow the person to another device, it is lost when the app is reinstalled,
   and it silences only the banner shown while the app is open — the alert list, the unread
   counts and the phone's push notifications all continue unchanged. Someone who turns it
   off reasonably expects to have turned notifications down, and has not.

This feature closes all three: it gives the stored preference a read/write surface, adds
calendar to the mutable domains, moves in-app alerts onto that stored preference, and makes
each control state plainly what it does and does not cover.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The in-app alert choice follows the person (Priority: P1)

A shift supervisor turns In-App Alerts off on the phone she uses on the floor, because the
banners cover the task she is reading. Later she is issued a replacement phone, signs in,
and the alerts are still off. Her colleague, signing in to the same shared tablet
afterwards, gets his own setting, not hers.

**Why this priority**: This is the control people actually touch today, and it is the one
that silently fails to persist. It is also the prerequisite for the preference record
having any write path at all, which the other stories build on.

**Independent Test**: Turn the setting off on one signed-in device, sign in as the same
person on a second device, and confirm the setting reads off there without touching it.
Sign in as a different person on the same device and confirm the setting reads on.

**Acceptance Scenarios**:

1. **Given** a signed-in person with In-App Alerts on, **When** they turn it off and open
   the app on a second device signed in as the same person, **Then** In-App Alerts reads
   off on the second device and no foreground banner is drawn there.
2. **Given** a person who has turned In-App Alerts off, **When** a colleague signs in on
   the same device, **Then** the colleague sees In-App Alerts on, because the preference
   belongs to the person and not to the handset.
3. **Given** a person with In-App Alerts off, **When** a notification arrives while the app
   is open, **Then** no foreground banner is drawn, **and** the notification still appears
   in the notification list and still increments the unread count.
4. **Given** a person who has reinstalled the app and signed back in, **When** they open
   settings, **Then** In-App Alerts reads the value they last chose, not the default.
5. **Given** a device that cannot reach the server, **When** the person flips In-App
   Alerts, **Then** the switch moves immediately, the app is told plainly that the change
   could not be saved, and the switch returns to its stored value rather than showing a
   choice that was never recorded.

---

### User Story 2 - Mute a noisy domain, calendar included (Priority: P2)

An operations lead is in back-to-back meetings all week and does not want a phone buzz for
every calendar invite, change and reminder, but does want messages and task assignments to
still reach him. He opens notification settings, mutes Calendar, and his phone stops
buzzing for calendar events while everything else continues.

**Why this priority**: This is the drift the epic names (D28) and the reason the preference
record exists. It depends on US1 having established the write path.

**Independent Test**: Mute a domain from the settings screen, publish a notification in that
domain to the muted person while they are offline, and confirm no push is delivered while an
unmuted domain's notification to the same person still is.

**Acceptance Scenarios**:

1. **Given** a person viewing notification settings, **When** they open the domain mute
   list, **Then** Calendar appears alongside every other source domain the workspace
   publishes into and can be switched on and off exactly like the others.
2. **Given** a person who has muted Calendar, **When** a calendar event invite, change,
   cancellation, reminder, missed check-in or digest is published to them while they are
   offline, **Then** no push notification is delivered to their device.
3. **Given** a person who has muted Calendar, **When** a calendar notification is published
   to them, **Then** it is still written to their notification list and still raises their
   unread count — muting quiets the interruption, it does not discard the record.
4. **Given** a person who has muted Calendar, **When** a chat message is published to them
   while they are offline, **Then** a push notification is still delivered, because muting
   is per domain.
5. **Given** a person who has muted every domain, **When** someone @mentions them or calls
   them, **Then** the push is still delivered, because those two are the interruptions the
   system is not permitted to withhold.
6. **Given** a person who has muted Calendar, **When** they unmute it, **Then** the next
   calendar notification pushes normally with no further action from them.

---

### User Story 3 - The settings screen says what it actually does (Priority: P3)

Someone opening notification settings can tell, without experimenting, which noise each
control removes and which it leaves alone — so they stop looking for a switch that does not
exist and stop believing they have silenced something they have not.

**Why this priority**: Correcting the promise costs little once the controls behave, and it
is the stated motivation for the epic. It carries no value on its own if the controls
underneath are still wrong, so it lands last.

**Independent Test**: Read the settings screen cold and confirm each control's description
matches what the acceptance scenarios in US1 and US2 assert, including the exceptions.

**Acceptance Scenarios**:

1. **Given** the notification settings screen, **When** a person reads the In-App Alerts
   control, **Then** its description says it affects only the banner shown while the app is
   open, and that the notification list, unread counts and phone notifications are
   unaffected.
2. **Given** the domain mute list, **When** a person reads it, **Then** it says muting stops
   the phone notification for that domain while the item still appears in the notification
   list.
3. **Given** the domain mute list, **When** a person reads it, **Then** it says mentions and
   incoming calls always come through.

---

### Edge Cases

- **A person with no stored preference record.** The great majority of people have never had
  one written. Reading preferences must return the documented defaults — in-app alerts on,
  nothing muted, do-not-disturb off — rather than an error or an empty screen, and the first
  change must create the record.
- **A domain name the system does not recognise.** A request to mute an unknown domain must
  be refused with a clear reason rather than stored, and must not corrupt the domains that
  were already muted.
- **The same domain listed twice** in one request must be stored once, not twice.
- **A muted domain later removed from the system.** A stored preference naming a domain that
  no longer exists must not prevent the person from reading or changing their preferences;
  the unknown entry is dropped on the next save.
- **Two devices changing the preference at the same moment.** Last write wins for the whole
  preference record; a person is changing their own single record, so there is no cross-user
  conflict to resolve.
- **Muting while offline.** The change must be refused visibly rather than silently queued,
  so a person never believes a domain is muted when the server has not recorded it.
- **A person who had turned the device-local In-App Alerts off before this feature.** Their
  old handset-local value is not carried over; they see the default (on) once, and their
  next change is the one that persists. See Assumptions.
- **Priority-0 notifications** (mentions, incoming calls) ignore both mute and do-not-disturb
  by design. The settings screen must not imply otherwise.
- **Delivery already in flight** when a domain is muted is not recalled; the mute applies to
  notifications published after it is stored.

## Requirements *(mandatory)*

### Functional Requirements

#### Stored preference and its contract

- **FR-001**: The system MUST allow `calendar` to be stored as a muted domain, on equal
  terms with every other domain the system can publish notifications from.
- **FR-002**: The set of domains that may be muted MUST be the same set the system accepts
  as a notification source, so that adding a future source domain does not silently create
  a second unmutable domain.
- **FR-003**: The system MUST expose a way for a signed-in person to read their own
  notification preferences: whether in-app alerts are on, which domains are muted, and their
  do-not-disturb window.
- **FR-004**: The system MUST expose a way for a signed-in person to change their own
  notification preferences, creating the stored record on first change.
- **FR-005**: A person MUST only be able to read and change their own preferences; the
  request MUST derive who they are from their session rather than accepting an identity from
  the caller.
- **FR-006**: Reading preferences for a person who has none stored MUST return the defaults
  — in-app alerts on, no muted domains, do-not-disturb off — and indicate that no record
  exists yet, without erroring.
- **FR-007**: A change naming a domain the system does not recognise MUST be refused with a
  reason that names the offending value, and MUST leave the stored preference unchanged.
- **FR-008**: Duplicate domain names in one change MUST be stored once.
- **FR-009**: A change MUST replace the stored preference as a whole, so that a person's
  do-not-disturb window and mute list cannot drift apart across two partial writes.

#### In-app alerts

- **FR-010**: Whether foreground in-app alert banners are shown MUST be stored against the
  person on the server, not against the device.
- **FR-011**: The in-app alert preference MUST default to on for a person who has never
  changed it.
- **FR-012**: When in-app alerts are off, the app MUST NOT draw the foreground banner, and
  MUST still record the notification in the notification list, still update unread counts,
  and still deliver push notifications subject to the other preferences.
- **FR-013**: Changing the in-app alert preference on one device MUST take effect on that
  person's other devices without them changing it again there.
- **FR-014**: The device-local store of the in-app alert preference MUST be removed, not
  kept in step with the server value, so that only one value can ever be authoritative.

#### Domain muting behaviour

- **FR-015**: When a domain is muted, push notifications for notifications published from
  that domain MUST be suppressed for that person.
- **FR-016**: Muting a domain MUST NOT prevent the notification being recorded, appearing in
  the notification list, or counting toward unread.
- **FR-017**: Notifications the system is not permitted to withhold — mentions and incoming
  voice calls — MUST still be delivered regardless of muted domains and do-not-disturb.
- **FR-018**: Muting one domain MUST NOT affect delivery for any other domain.

#### Settings screen

- **FR-019**: A signed-in person MUST be able to see and change, from the mobile settings
  screen, whether in-app alerts are on and which domains are muted.
- **FR-020**: Each control MUST state in plain language which notifications it affects and
  which it leaves alone, including that mentions and incoming calls always come through.
- **FR-021**: A change MUST appear to take effect immediately, and MUST be visibly returned
  to its stored value with an explanation if it could not be saved.
- **FR-022**: The settings screen MUST show the person's stored preferences when it opens,
  not a device default that may disagree with the server.

### Key Entities

- **Personal notification preference**: One record per person per organization. Holds
  whether in-app alerts are on, the list of muted source domains, and the do-not-disturb
  window (on/off plus start and end times). Absent for most people, in which case documented
  defaults apply. Read by the delivery pipeline when deciding whether to push.
- **Source domain**: The area of the workspace a notification came from — chat, projects,
  docs, calendar, CRM, HR, support, finance, system. Each may be independently muted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can mute calendar notifications and stop receiving calendar phone
  alerts, using only the app, in under 30 seconds from opening settings.
- **SC-002**: 100% of the source domains the system can publish from can be muted; none is
  missing from the list a person sees.
- **SC-003**: After changing the in-app alert setting on one device, the same person signing
  in on a second device sees the changed value on first open, with no manual step.
- **SC-004**: After a person reinstalls the app and signs back in, their notification
  preferences read exactly as they left them.
- **SC-005**: With every domain muted, an @mention and an incoming call still reach the
  person's phone in 100% of attempts.
- **SC-006**: With a domain muted, notifications from that domain still appear in the
  notification list in 100% of attempts — muting never loses a record.
- **SC-007**: Zero notification preference values remain stored only on a device; the
  settings screen reads every value it shows from the person's account.
- **SC-008**: Drift D28 is removed from the drift register, and the calendar and
  notifications domain snapshots no longer describe calendar as unmutable.

## Assumptions

- **[ASSUMPTION: The write path is added to the notification service, not the existing
  user-preference service.]** The muted domain list and do-not-disturb window already live
  in one record owned by the notifications area, and the delivery pipeline already reads it
  there. Putting the write path beside them keeps one owner for one record; adding these
  fields to the separate theme-preference service would split a single record across two
  owners and two write paths.
- **[ASSUMPTION: The read and change operations carry the whole preference record, including
  the do-not-disturb window, even though no screen in this feature edits do-not-disturb.]**
  A change replaces one record; a change that omitted do-not-disturb would either erase a
  window an operator had set or require partial-update machinery for a field nobody edits
  yet. Carrying the field costs three values on the contract and means a future
  do-not-disturb screen needs no server change.
- **[ASSUMPTION: No do-not-disturb editing screen is built in this feature.]** The epic asks
  for calendar muting and the in-app alert move. Do-not-disturb becomes reachable through the
  contract but gains no UI here; that is a separate, larger design (time pickers, timezone,
  overnight windows).
- **[ASSUMPTION: The client scope is the mobile app only.]** In-app alert banners exist only
  on mobile, and domain muting suppresses push, which only mobile receives. The web settings
  area today manages push tokens and presence visibility and has no notification-preference
  controls; adding them there is a separate feature. This also follows the project's standing
  position that owners run the business from the mobile app.
- **[ASSUMPTION: Existing device-local in-app alert values are not migrated to the server.]**
  The project does not preserve backward compatibility during early development, and a
  one-time upload of a handset value would be a compatibility shim that has to be reasoned
  about forever. People who had turned the banner off see it default back to on once, and
  their next change persists properly. The old device-local key is deleted outright.
- **[ASSUMPTION: The full set of nine source domains is offered for muting, including
  `system`.]** The stored contract already permits muting `system`, mentions and calls
  bypass muting regardless, and hiding a domain from the list would recreate exactly the
  "a domain that cannot be muted" gap this feature exists to close.
- **[ASSUMPTION: Changes are written straight through with no offline queue.]** A queued
  mute that has not reached the server is a preference a person believes is active and is
  not. Refusing visibly is more honest and much smaller than a sync queue; this matches how
  the existing theme toggle already behaves — optimistic repaint, rollback with an
  explanation on failure.
- **[ASSUMPTION: Concurrent changes from two devices resolve last-write-wins.]** A person is
  the only writer of their own record, so the loser of a race is the same person's earlier
  intent; conflict resolution machinery is not warranted.
- **[ASSUMPTION: Widening the stored set of valid domains needs no data migration.]** Adding
  `calendar` only permits values that were previously rejected; every existing stored record
  remains valid.

## Dependencies

- The stored personal preference record and the delivery pipeline's existing use of it
  (domain mute and do-not-disturb suppression, and the priority rule that exempts mentions
  and incoming calls) are reused unchanged apart from the new field.
- The mobile settings screen and its foreground banner gate already exist; this feature
  changes where they read from.
- Domain snapshots for notifications/presence and calendar, and the drift register entry
  D28, are updated as part of this change.

## Out of Scope

- A do-not-disturb editing screen on any client.
- Notification preferences on the web client.
- Per-notification-type or per-resource muting finer than the domain level; per-resource
  follow state already exists separately and is unchanged.
- Changing which notifications bypass suppression. Mentions and incoming calls keep their
  current exemption.
- Email or digest notification preferences.
- Migrating or importing previously stored device-local settings.
