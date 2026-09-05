# Feature Specification: Mobile Dark Mode

**Feature Branch**: `050-mobile-dark-mode`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Mobile dark mode. Thread the palette through the mobile screens and read the stored theme preference. Web has it and the tokens exist, but mobile is pinned to light. Clears drift D30."

## Problem

The workspace has a theme. A person can set it to dark on the web app, the
choice is stored against their account, and it follows them to any browser they
sign in from. The phone app ignores all of it. Every mobile screen is painted
from the light palette by name, so the app is a light-mode app no matter what
the person chose or what their phone is set to.

This is not merely a missing preference. Because the screens are hardcoded
light, the app also has to force the operating system into light mode at
startup — otherwise the parts the app does not paint (keyboards, switches, text
cursors, date pickers) would turn dark on top of a white UI and become
unreadable. A Dark Mode switch used to sit on the mobile Settings screen; it did
exactly that and nothing else, so it was removed. The tombstone comment left in
its place says the switch comes back with the theme, not before it.

The result is a person who works at night, or who has set their phone to dark
for eye strain or battery, opening a bright white app on a dark home screen, and
finding that the choice they already made on the web did not travel.

Everything needed to fix this already exists except the painting. The shared
token package exports a dark palette alongside the light one. The backend stores
`theme_mode` and `preference_source` per person and serves them over three RPCs.
The client libraries that read that preference and cache it locally are already
platform-neutral and already work on the phone's storage. Three mobile
components already select their palette by colour scheme correctly, and are dead
code only because the scheme is pinned. What is missing is that roughly
seventy-five mobile files build their styles once, at import time, from a
palette chosen by name.

This feature threads a runtime palette through those screens, unpins the colour
scheme, and reads the person's stored preference. It closes drift **D30**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The app is readable in dark (Priority: P1)

Someone whose phone is set to dark mode opens the app and finds a dark app. Every
screen they can reach — chat, today, tasks, calendar, notifications, more,
settings, sign-in, onboarding — is painted for dark: dark surfaces, light text,
readable badges and chips, a dark tab bar, dark headers, and a status bar whose
clock and battery are visible against it. Nothing is a white card stranded on a
dark background, and nothing is white text on a white field.

**Why this priority**: This is the whole feature. A preference that selects
between "light" and "a broken half-dark app" is worth nothing, and no
preference-reading work can be demonstrated until there is a dark app to select.
It is also the only part with real risk: it touches almost every mobile file.

**Independent Test**: Fully testable with no server involvement and no
preference stored — set the phone to dark, open the app, and walk every screen
and every state (loading skeletons, empty states, error banners, incoming call
overlay, in-app notification banner, action sheets, modals). Then set the phone
back to light and confirm the app is exactly as it is today.

**Acceptance Scenarios**:

1. **Given** a phone whose operating system is set to dark and a person signed
   in with no stored theme preference, **When** they open the app and visit
   every tab and every screen reachable from it, **Then** every screen is
   painted dark and all text, icons, and controls are legible against their
   backgrounds.
2. **Given** the same phone set to light, **When** they open the app and visit
   the same screens, **Then** the app looks exactly as it does today, with no
   visual change from before this feature.
3. **Given** the app open in dark, **When** the person opens a text field, a
   date picker, a switch, or the keyboard, **Then** those controls are dark and
   match the surrounding screen, rather than being a light control on a dark
   screen or the reverse.
4. **Given** the app open in dark, **When** a screen shows a status colour — a
   presence dot, a task state, a priority, an event category, a notification
   domain badge — **Then** the colour is legible against the dark surface it
   sits on and still means the same thing it meant in light.
5. **Given** the app open in dark, **When** a screen is still loading, empty, or
   showing an error, **Then** the placeholder, empty state, and error surfaces
   are dark too, with no white flash between the placeholder and the content.
6. **Given** the person is on a screen in dark mode, **When** they change the
   phone's system setting to light while the app is in the foreground,
   **Then** the screen they are looking at repaints to light without them
   leaving it and without restarting the app.

---

### User Story 2 - The theme the person already chose follows them to the phone (Priority: P1)

Someone who set dark mode on the web opens the phone app and it is dark, even
though their phone is set to light. Someone who has never expressed a choice
gets whatever their phone is set to, and that first silent choice is recorded as
"following the phone" rather than as a decision they made — so the app keeps
following the phone until they say otherwise.

**Why this priority**: This is the "read the stored theme preference" half of
the request, and it is what makes the theme a property of the person rather than
of the device. Without it the phone and the web disagree for anyone who ever
touched the web toggle.

**Independent Test**: Testable against the running backend without any mobile UI
of its own — set the preference to dark from the web, open the phone app on a
light-mode phone, and confirm the app is dark; then reset the preference and
confirm the app follows the phone again.

**Acceptance Scenarios**:

1. **Given** a person whose stored preference is dark, set deliberately,
   **When** they open the app on a phone set to light, **Then** the app is dark.
2. **Given** a person whose stored preference is light, set deliberately,
   **When** they open the app on a phone set to dark, **Then** the app is light.
3. **Given** a person with no stored preference at all, **When** they open the
   app on a phone set to dark, **Then** the app is dark, and the preference now
   recorded for them says dark *and* says it came from the device rather than
   from them.
4. **Given** a person whose recorded preference came from the device rather than
   from them, **When** they change their phone's system setting, **Then** the
   app follows the phone and the newly recorded preference still says it came
   from the device.
5. **Given** a person who deliberately chose a theme, **When** they change their
   phone's system setting to the other one, **Then** the app does not change —
   their deliberate choice outranks the device.
6. **Given** a person who changes their theme on the web while the phone app is
   open in the background, **When** they bring the phone app back to the
   foreground, **Then** the app is showing the theme they just chose on the web.
7. **Given** a person signs out and a different person signs in on the same
   phone, **When** the second person's app finishes loading, **Then** the app
   shows the second person's theme, not the first person's.
8. **Given** the app cannot reach the server at launch, **When** it opens,
   **Then** it uses the last theme that person was known to have on that phone,
   falling back to the phone's own setting if there is none, and it corrects
   itself once the server can be reached.

---

### User Story 3 - The switch comes back (Priority: P2)

A person can change the theme from the phone's Settings screen, in the place the
old Dark Mode switch used to sit. Changing it there is a deliberate choice: the
app stops following the phone's setting from then on, and the choice shows up on
the web too.

**Why this priority**: The theme is usable without it — the app already follows
the phone, and a person can still change it on the web. But the tombstone
comment on the Settings screen promises the switch returns with the theme, and
an owner running the business from a phone should not need a laptop to turn the
lights down. It is deliberately ranked below reading, because a switch that
writes a preference nothing paints is precisely the decoration that was removed.

**Independent Test**: Testable entirely on the phone once Stories 1 and 2 exist —
open Settings, flip the control, confirm the app repaints immediately and stays
that way after a restart and after the phone's own setting changes.

**Acceptance Scenarios**:

1. **Given** the app in light, **When** the person turns on dark from the
   Settings screen, **Then** the whole app repaints to dark immediately, without
   a restart and without leaving Settings.
2. **Given** the person has just used that control, **When** they later change
   their phone's system setting, **Then** the app does not change, because their
   choice is now deliberate.
3. **Given** the person has just used that control, **When** they close and
   reopen the app, or open the web app, **Then** the theme they chose is what
   they see in both places.
4. **Given** the person uses the control while the phone has no network,
   **When** the change cannot be saved, **Then** the app still repaints
   immediately, and either the change is saved when the network returns or the
   control returns to its previous position and says the change did not stick —
   it never silently disagrees with what is stored.

---

### User Story 4 - Launching does not flash white (Priority: P3)

Someone opening the app on a dark phone at night does not get a white rectangle
in the face before the first screen paints. The splash screen and the launch
background are dark too.

**Why this priority**: Cosmetic, and only visible for a fraction of a second,
but it is the one moment of the experience that no amount of in-app theming can
fix, because it happens before the app's own code runs. It is separated so it is
not mistaken for part of the screen sweep — it is platform launch configuration,
not painting.

**Independent Test**: Cold-launch the app on a dark-mode phone, on both
platforms, and watch the transition from the home screen to the first app
screen.

**Acceptance Scenarios**:

1. **Given** a phone set to dark, **When** the person cold-launches the app,
   **Then** the splash screen is dark and there is no light frame between the
   home screen and the first painted app screen.
2. **Given** a phone set to light, **When** the person cold-launches the app,
   **Then** the splash screen is light, exactly as it is today.

---

### Edge Cases

- **Signed-out and public screens.** Sign-in, invitation acceptance, onboarding,
  and the public booking link have no person to read a preference for. They
  follow the phone's own setting. When someone signs in, the app switches to
  their stored preference if it differs, and that switch is allowed to be
  visible — it happens once, at sign-in.
- **The first render before the preference arrives.** The stored preference is
  fetched over the network, so the app must paint something first. It paints the
  last theme known for that person on that phone, or the phone's setting if
  there is none, and corrects itself when the answer arrives. A correction is
  allowed to be visible; a correction on every launch is not.
- **A person with no stored preference on a device already carrying one.** The
  locally remembered theme is per person, so it is never used for somebody else.
- **The phone's setting changes while the app is backgrounded.** The app is in
  the correct theme by the time it is visible again, not one frame later.
- **A brand colour that is not a theme colour.** The app icon, the notification
  tint, and any brand mark keep their fixed colours in both themes. They are the
  brand, not the surface.
- **Photographs, avatars, and uploaded images.** They are not recoloured. Only
  the surfaces and borders around them respond to the theme.
- **A colour derived from another colour.** Where a screen builds a tint or a
  translucent wash out of a theme colour, the derived colour must be derived
  again per theme; a wash computed for a white background is not a wash for a
  dark one.
- **A screen that is currently mid-animation or mid-scroll when the theme
  changes.** It repaints in the new theme; it does not need to preserve
  animation state.
- **A theme value the app does not understand.** If the stored preference is
  ever something other than light or dark, the app treats it as "no preference"
  and follows the phone rather than failing to start.

## Requirements *(mandatory)*

### Functional Requirements

**Painting the app**

- **FR-001**: Every mobile screen, component, overlay, and system surface MUST
  select its colours from the active theme at the time it renders, and MUST NOT
  be fixed to one theme's colours.
- **FR-002**: No mobile surface may paint a colour that does not come from the
  shared theme tokens. Colours written directly into a screen MUST be replaced
  by a token that has a value in both themes.
- **FR-003**: The shared mobile tokens MUST define a dark value for every
  semantic colour group they define today — presence, task state, priority,
  event category, and notification domain — so that badges, chips, and status
  dots are legible in both themes and continue to carry the same meaning.
- **FR-004**: The tab bar, screen headers, back controls, and the status bar
  MUST follow the active theme, including the status bar's own foreground so
  that the phone's clock, signal, and battery stay visible.
- **FR-005**: Controls the app does not paint itself — keyboards, text cursors,
  switches, pickers, selection handles, scroll indicators — MUST match the
  active theme rather than the phone's setting, so the app never mixes the two.
- **FR-006**: Loading placeholders, empty states, error banners, in-app
  notification banners, call overlays, action sheets, and modals MUST follow the
  active theme on the same terms as ordinary screens.
- **FR-007**: All text and meaningful non-text elements MUST meet WCAG 2.1 AA
  contrast against their own background in both themes — 4.5:1 for body text,
  3:1 for large text, icons, and control boundaries.
- **FR-008**: A change of theme MUST repaint the app in place, with no restart,
  no sign-out, and no loss of the person's position or unsent input on the
  screen they are on.

**Choosing the theme**

- **FR-009**: For a signed-in person, the theme MUST be the one stored against
  their account.
- **FR-010**: When a signed-in person has no stored theme, the app MUST adopt
  the phone's current setting and record that as their theme, marked as having
  come from the device rather than from the person.
- **FR-011**: While a person's theme is marked as having come from the device,
  a change to the phone's setting MUST change the app's theme and MUST keep the
  mark as device-derived.
- **FR-012**: Once a person has chosen a theme deliberately, the app MUST NOT
  change it in response to the phone's setting.
- **FR-013**: The app MUST NOT mark a theme as a deliberate choice unless the
  person performed an action to choose it. Adopting the phone's setting, reading
  a stored theme, or rendering for the first time MUST NOT record a deliberate
  choice.
- **FR-014**: On screens with no signed-in person, the theme MUST be the phone's
  current setting.
- **FR-015**: The app MUST re-read the stored theme when it returns to the
  foreground and when a person signs in, so a change made on another device is
  picked up without reinstalling or signing out.
- **FR-016**: The app MUST remember, per person, the last theme it knew for them
  on that phone, and MUST use it to paint the first frame before the stored
  theme has been retrieved.
- **FR-017**: If the stored theme cannot be retrieved, the app MUST fall back to
  the locally remembered theme, then to the phone's setting, and MUST NOT fail
  to start, block on the network, or show an error about it.
- **FR-018**: A stored theme value the app does not recognise MUST be treated as
  no preference.

**Changing the theme from the phone**

- **FR-019**: The mobile Settings screen MUST offer a control that switches
  between light and dark.
- **FR-020**: Using that control MUST record the person's choice as deliberate
  and MUST store it against their account so it applies on every device.
- **FR-021**: Using that control MUST repaint the app immediately, without
  waiting for the store to confirm.
- **FR-022**: If storing the choice fails, the app MUST either retry until it
  succeeds or return the control and the app to the previous theme with a
  visible explanation. It MUST NOT leave the app showing a theme different from
  the one stored.

**Launch**

- **FR-023**: The splash and launch background MUST follow the phone's setting
  on both platforms, so a cold launch on a dark phone shows no light frame.

### Key Entities *(include if data involved)*

- **Theme preference**: what a person has for a theme — which of the two themes,
  and whether it came from them or from their device. Already stored per person
  on the server and already served over the existing preference RPCs; this
  feature is a new reader and writer of it, not a new store.
- **Palette**: the full set of named colours for one theme. Already exists in
  the shared token package for both themes, with the exception of the mobile
  semantic groups that have light values only.
- **Device colour scheme**: what the phone itself is set to. Currently forced to
  light by the app at startup; after this feature it is an input to the theme
  decision rather than something the app overrides.

## Out of Scope

- **A third "follow the system" theme value.** The stored theme is light or
  dark, and "follow the phone" is expressed by marking the value as
  device-derived. This is how the web works today and mobile matches it. The
  separate drift note that this indirection is easy for a new client to get
  wrong stays open; FR-013 is the guard against getting it wrong here.
- **Any change to how the web app behaves.** Two known web inconsistencies are
  adjacent to this work and are deliberately left alone: the web's stylesheet
  defines a dark variable set that nothing ever applies, and the web keeps its
  own copy of the palettes instead of importing the shared package. Both are
  worth fixing and neither is mobile.
- **New themes.** No high-contrast theme, no per-organisation brand theming, no
  scheduled or location-based switching.
- **Redesigning any mobile screen.** Layout, spacing, hierarchy, and copy stay
  as they are. This feature changes which colours a screen uses, not what the
  screen is.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A walkthrough of every mobile screen and state with the app in
  dark finds zero surfaces still painted for light — no light card on a dark
  background, no light-on-light text, no light native control on a dark screen.
- **SC-002**: Every text and control colour pairing in both themes meets WCAG
  2.1 AA contrast, verified across the full set of tokens rather than by
  spot-check.
- **SC-003**: A walkthrough of every mobile screen with the app in light is
  visually identical to the app before this feature.
- **SC-004**: A person who sets dark on the web sees a dark phone app the next
  time they open it, with no sign-out, reinstall, or manual step.
- **SC-005**: Changing the theme — from the phone's own setting, from the
  Settings control, or from the web — repaints the app in under one second,
  with no restart and no loss of what the person was doing.
- **SC-006**: A person's chosen theme survives every app restart on that phone;
  across ten consecutive cold launches the app never shows the other theme, not
  even for a frame.
- **SC-007**: A cold launch on a dark phone shows no light frame between the
  home screen and the first app screen.
- **SC-008**: With the server unreachable, the app still opens in the person's
  last known theme and shows no error about the theme.
- **SC-009**: Drift D30 is removed from the register: mobile reads the stored
  preference, paints from a runtime palette, and no longer pins the colour
  scheme.

## Assumptions

- [ASSUMPTION: The theme stays a two-value choice — light or dark — with "follow
  the phone" carried by the existing device-derived marker, rather than adding a
  third stored value. Matching the web exactly means no change to the stored
  contract, and a mobile-only third value would put the two clients on different
  models of the same field. The cost is that the indirection is subtle, which
  FR-013 addresses directly.]
- [ASSUMPTION: The whole mobile app is swept in one change rather than screen by
  screen. A half-themed app is worse than a light-only one: the person sees a
  dark tab bar under a white screen and reasonably concludes the app is broken.
  There is no shippable intermediate state, so the sweep is the unit of work
  even though it touches most mobile files.]
- [ASSUMPTION: The dark values for the mobile semantic colour groups — presence,
  task state, priority, event category, notification domain — are authored as
  part of this feature, because they do not exist yet and every badge and chip
  on the phone depends on them. They are derived to preserve the meaning each
  colour already carries in light, not re-chosen.]
- [ASSUMPTION: The stored preference is re-read when the app returns to the
  foreground rather than pushed to the phone in real time. A theme change is
  rare and not urgent; adding a realtime channel for it would be machinery far
  out of proportion to the benefit.]
- [ASSUMPTION: The last known theme is remembered on the device, keyed to the
  person, so the first frame after launch is usually already correct. The client
  library that does this already exists and already works on the phone's
  storage, so this is a use of it rather than new storage.]
- [ASSUMPTION: Signed-out and public screens follow the phone's setting, because
  there is no person whose preference could be read. The one visible theme
  change at sign-in is accepted as correct rather than papered over.]
- [ASSUMPTION: Existing colour semantics are preserved across themes — a colour
  that means "overdue" in light means "overdue" in dark. Dark is a re-rendering
  of the same information design, not an opportunity to re-map meanings.]
- [ASSUMPTION: The app's icon, notification tint, and brand marks keep fixed
  colours. They identify the product rather than participating in the surface,
  and the icon already carries its own platform-level dark variant.]
- [ASSUMPTION: Uploaded content — photographs, avatars, attachments — is never
  recoloured. Only the app's own surfaces respond to the theme.]
- [ASSUMPTION: This feature reuses the existing preference service and its three
  RPCs unchanged. Spec 013 designed that contract for mobile and left it
  unclaimed; no backend change is expected, and any that turns out to be needed
  is a signal that something has been misread rather than a licence to widen.]
- [ASSUMPTION: Mobile coverage follows the project's standing rule of at least
  one blackbox flow per feature domain, exercising the happy path of choosing a
  theme and seeing it applied. Exhaustive per-screen visual verification is a
  review activity, not a flow.]
