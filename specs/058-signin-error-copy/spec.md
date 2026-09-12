# Feature Specification: Sign-In Errors Written for the Person Reading Them

**Feature Branch**: `058-signin-error-copy`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Sign-in errors written for the person reading them. The sign-in screen raises alerts saying the iOS build does not have Sign in with Apple enabled yet, and that Google sign-in for Android still needs EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in the app environment. Both name build configuration to somebody who has none, on the first screen a reviewer sees, and both read as an unfinished app. Say what the person can do instead and keep the diagnostic in a development-only log."

## Why this exists

The mobile email-and-password sign-in screen offers two single-tap alternatives — Continue
with Google and Continue with Apple. Either can be unavailable in a given build, and when
that happens the screen currently explains the build to the person:

| Situation | What the person is told today |
|---|---|
| iOS build reports Sign in with Apple is not available on the device | "This iOS build does not have Sign in with Apple enabled yet. Rebuild the app after syncing native changes." |
| Android build has no Google client identifier configured | "Google sign-in for Android still needs `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` in the app environment." |

Both are true and both are useless to the reader. Nobody holding a phone can rebuild an app
or set an environment variable, and an environment variable name printed in an alert box is
the single clearest signal that what they are holding is unfinished. An app-store reviewer
who taps the SSO buttons on a build where one is not wired up sees exactly this, one screen
into the product.

The worse part is the shape of the interaction, not only the wording. The screen offers a
button, the person taps it, and only then is told the button was never going to work. A
control that cannot do anything should not be offered.

Nothing about how sign-in actually works changes. Email and password, PIN, Google and Apple
all keep behaving exactly as they do now. This feature changes what an unavailable provider
looks like and where the build diagnostic goes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A provider that cannot work is not offered (Priority: P1)

A person opens the email-and-password sign-in screen on a build where one sign-in provider
is not configured. That provider's button is simply not on the screen. They sign in with the
methods that are there, and never learn that a fourth one exists in some other build.

**Why this priority**: This removes the failure entirely rather than rewording it. A dead
button the person must tap to discover is dead is the defect; better copy in the alert still
wastes a tap and still says "something here is broken". This is also what a store reviewer
sees, so it is the highest-value slice.

**Independent Test**: Launch the app on a build with no Google client identifier for the
running platform, open the email sign-in screen, and confirm no Google button is rendered
and no alert can be raised. Repeat on an iOS build or simulator where Sign in with Apple
reports unavailable. Fully testable with nothing else in this feature built.

**Acceptance Scenarios**:

1. **Given** an Android build with no Google client identifier configured, **When** the
   person opens the email-and-password sign-in screen, **Then** the Continue with Google
   button is not rendered.
2. **Given** an iOS build where the device reports Sign in with Apple is unavailable,
   **When** the person opens the email-and-password sign-in screen, **Then** the Apple
   button is not rendered.
3. **Given** a build where both Google and Apple are unavailable, **When** the person opens
   the screen, **Then** the "or continue with" divider and the alternatives card are not
   rendered at all, leaving the email and password form as the whole screen with no empty
   container and no leftover heading.
4. **Given** a build where exactly one provider is available, **When** the person opens the
   screen, **Then** that provider's button is rendered at full width rather than left as a
   half-width control with a gap beside it.
5. **Given** any build, **When** the availability of a provider is still being determined on
   first render, **Then** the screen does not flash a button that is about to disappear.
6. **Given** a build where a provider is available, **When** the person taps it, **Then**
   sign-in proceeds exactly as it does today, with no change to the flow, the workspace
   requirement, or the resulting session.

---

### User Story 2 - An alert a person can act on (Priority: P2)

A provider fails at the moment of use — the device withdraws it, the request has not
finished initialising, or the attempt errors. The person is told, in one sentence, what they
can do right now: sign in with their email and password. No environment variable, no build
step, no apology for the app.

**Why this priority**: Hiding an unavailable provider handles the state known before the
tap. Something can still fail during the tap, and that message has to be readable by the
person reading it. It depends on nothing in User Story 1 and can ship on its own.

**Independent Test**: Force each remaining sign-in failure path and read the alert. Confirm
no message names an environment variable, a build, a rebuild, a platform SDK, or a
configuration step, and that each offers a next action the reader can perform.

**Acceptance Scenarios**:

1. **Given** a provider becomes unavailable between render and tap, **When** the person taps
   it, **Then** the alert names the alternative available to them — signing in with email
   and password — and does not mention the app's configuration or build.
2. **Given** the Google request has not finished initialising, **When** the person taps
   Continue with Google, **Then** the alert tells them to try again in a moment, which is
   already true today and stays.
3. **Given** a provider sign-in attempt returns an error, **When** the alert is shown,
   **Then** it is phrased as something that did not work this time, with email and password
   named as the way through.
4. **Given** the person cancels a provider sign-in themselves, **When** the sheet closes,
   **Then** no alert is shown, which is already true today and stays.
5. **Given** any alert on the sign-in screens, **When** its text is read, **Then** it
   contains no environment variable name, no "rebuild", no "not enabled yet", and no
   reference to native or build configuration.

---

### User Story 3 - The diagnostic still reaches the developer (Priority: P3)

An engineer running a development build taps nothing and still learns that the Google client
identifier is missing, because the app says so in the development log the moment it decides
to hide the button. In a release build, that same line is never produced.

**Why this priority**: The two alerts exist because the information is genuinely useful — to
the one audience that can act on it. Moving it rather than deleting it keeps a
misconfigured build diagnosable. It is last because a missing diagnostic costs an engineer
minutes, while a visible one costs the product a reviewer.

**Independent Test**: Run a development build with a provider unconfigured and confirm the
diagnostic appears in the development log naming the missing configuration. Build for
release and confirm the same line is absent.

**Acceptance Scenarios**:

1. **Given** a development build where the Google client identifier for the running platform
   is absent, **When** the sign-in screen determines provider availability, **Then** a
   development-only log line states which configuration value is missing, by name.
2. **Given** a development build where the device reports Sign in with Apple unavailable,
   **When** the screen determines availability, **Then** a development-only log line records
   it.
3. **Given** a release build, **When** any provider is unavailable, **Then** no such line is
   produced and nothing about the configuration is surfaced anywhere in the interface.
4. **Given** a development build, **When** the diagnostic is logged, **Then** it is written
   once per screen mount rather than on every render or every tap.

---

### Edge Cases

- **Provider availability changes mid-session.** The device can withdraw Sign in with Apple
  after the screen has rendered. The tap-time guard in User Story 2 covers this; the button
  does not have to disappear under the person's finger.
- **Both providers unavailable.** Covered explicitly: the entire alternatives section
  disappears, including its divider. The screen must not show a heading over nothing.
- **Neither the Apple nor the Google path is reachable on the non-mobile targets.** The Apple
  button is already iOS-only. Hiding must not change what non-iOS platforms render beyond
  removing a button that was already absent.
- **A sign-in failure whose message comes from the provider, not from this app.** Provider
  error text is passed through today. It is outside this app's control, so it stays, but the
  alert's own framing around it must still name the email-and-password alternative.
- **The person has no email-and-password credential** (an org-managed worker who only knows
  a PIN). The alert names email and password because that is the alternative on this
  particular screen; the PIN entry screen is one back and is the app's default entry point.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The mobile sign-in screen MUST determine, before rendering its sign-in
  alternatives, whether each provider can actually complete a sign-in on the running build
  and device.
- **FR-002**: A provider determined to be unavailable MUST NOT be rendered as a control the
  person can tap.
- **FR-003**: When no provider is available, the sign-in alternatives section MUST be omitted
  entirely, including its separator and heading, leaving no empty container.
- **FR-004**: When exactly one provider is available, it MUST occupy the full width of the
  alternatives row rather than leaving a gap where the hidden control was.
- **FR-005**: The screen MUST NOT render a provider control and then remove it after an
  asynchronous availability result arrives; until availability is known, the control is not
  shown.
- **FR-006**: A provider that becomes unavailable between render and tap MUST produce a
  message that names signing in with email and password as the way forward.
- **FR-007**: No message shown to a person on the sign-in screens MAY name an environment
  variable, a configuration value, a build, a rebuild, a native module, or a platform SDK.
- **FR-008**: No message shown to a person MAY describe a capability as not built, not
  enabled yet, or still needing something.
- **FR-009**: Every sign-in failure message MUST state an action the reader can perform
  themselves.
- **FR-010**: The build-configuration diagnostic that the removed alerts carried MUST be
  emitted to a developer-facing log in development builds, naming the missing configuration
  value.
- **FR-011**: The diagnostic MUST NOT be emitted in release builds and MUST NOT be reachable
  from any interface surface in any build.
- **FR-012**: The diagnostic MUST be emitted at most once per sign-in screen mount.
- **FR-013**: Sign-in behaviour for an available provider MUST be unchanged — the same
  workspace requirement, the same token exchange, the same destination after success.
- **FR-014**: An automated check MUST fail if a message on the authentication screens
  reintroduces build-configuration vocabulary, so this cannot silently regress.

### Key Entities

- **Provider availability**: For each single-tap sign-in provider, whether this build on this
  device can complete a sign-in with it. Derived from the running platform, the presence of
  the provider's configuration, and — for Apple — the device's own answer. Drives what is
  rendered.
- **Sign-in message**: Any text shown to a person when sign-in cannot proceed. Has one
  required property: it names something the reader can do.
- **Development diagnostic**: The build-configuration detail behind an unavailable provider.
  Audience is the engineer running the build; never the person signing in.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero sign-in messages visible to a person contain an environment variable name,
  the word "rebuild", or the phrase "not enabled yet" — verified by an automated check over
  the authentication screens that fails the build if one reappears.
- **SC-002**: On a build with an unconfigured provider, the number of taps a person can spend
  discovering that provider does not work drops from one to zero.
- **SC-003**: Every failure message on the sign-in screens names a next action the reader can
  take without leaving the app or contacting anyone.
- **SC-004**: A reviewer or new user completing sign-in on an incompletely configured build
  encounters no text suggesting the app is unfinished.
- **SC-005**: An engineer running a development build with a provider unconfigured learns
  which configuration value is missing without adding instrumentation, within the first
  screen mount.
- **SC-006**: The sign-in screen with all providers hidden renders with no empty card, no
  orphan divider, and no gap, on both a narrow Android device and the smallest supported
  iPhone.

## Assumptions

- [ASSUMPTION: Hiding an unavailable provider is preferred over disabling it or rewording its
  alert. The description asks for "what the person can do instead", and the strongest form of
  that is not offering a path that goes nowhere. A greyed-out button still reads as broken.]
- [ASSUMPTION: "Development-only log" means the standard development-build console diagnostic
  the mobile app already uses for this class of information, guarded the same way as the
  app's other development-only behaviour. No log-collection service is introduced.]
- [ASSUMPTION: Scope is the mobile app's email-and-password sign-in screen, which is where
  both named alerts live. The web sign-in page and the PIN-first mobile entry screen are not
  touched, because neither raises a build-configuration message.]
- [ASSUMPTION: Messages that are already written for a person — "Google sign-in is still
  initializing. Try again in a moment.", "Enter your workspace subdomain before continuing
  with Google sign-in." — are kept, with the failure ones extended to name the
  email-and-password alternative where they do not already.]
- [ASSUMPTION: The automated check in FR-014 is a repository-level assertion in the style of
  the mobile app's existing self-checks, not new lint infrastructure, consistent with the
  project's preference for a small check over new tooling.]
- [ASSUMPTION: The Google client identifier for iOS is compiled into the app and is not
  expected to go missing, so the availability rule that matters in practice is the Android
  one; the requirement is written per-platform rather than Android-only so an iOS regression
  is caught by the same rule.]
- [ASSUMPTION: No backend, API, or data change is required. This is entirely a mobile client
  presentation change, consistent with the project's position that client copy and
  availability rules are not contract changes.]
