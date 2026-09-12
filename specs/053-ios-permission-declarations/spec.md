# Feature Specification: Declare only the permissions the app actually uses

**Feature Branch**: `053-ios-permission-declarations`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Declare only the permissions the app actually uses. The shipped IPA carries NSLocationAlwaysUsageDescription and NSLocationAlwaysAndWhenInUseUsageDescription both reading 'Allow TechOffice to access your location', which is expo-location's own default text, and NSFaceIDUsageDescription for a Face ID sign-in that exists nowhere in the codebase. Pass false for locationAlwaysPermission, locationAlwaysAndWhenInUsePermission and faceIDPermission, delete those keys and the dev-only local-network pair from the committed ios prebuild that EAS builds as-is, and drop the biometric entries from the store-manifest allow-lists rather than widening them. A placeholder purpose string and a permission with no feature behind it are each a 5.1.1 rejection on their own. Clears drift D64."

## Why this exists

The app that ships and the app the manifest describes have come apart in three
places at once, and each one is independently sufficient to fail review under
App Store Review Guideline 5.1.1 (Data Collection and Storage — Privacy).

1. **Two background-location permissions the app never requests.** The shipped
   binary declares an "always" location permission and an "always and when in
   use" location permission. Nothing in the app asks for background location;
   the only two places that touch location request foreground access, take a
   single reading, and stop. A permission with no feature behind it is a
   rejection on its own.
2. **Both of those carry a framework placeholder as the purpose string.** They
   read "Allow TechOffice to access your location" — the location library's own
   default text, not a sentence anyone wrote for the person being asked. A
   purpose string that does not name the feature it enables is a rejection on
   its own, independent of point 1.
3. **A biometric sign-in permission for a capability that does not exist.** The
   binary declares Face ID with a purpose string promising sign-in without
   re-typing a PIN, and the Android manifest declares the two matching biometric
   permissions. There is no biometric sign-in anywhere in the app: the only
   secure-storage call configures at-rest protection and never asks for
   authentication, and nothing imports a biometric authentication library at
   all. The store manifest's own allow-lists list the biometric entries as
   permitted, so the automated gate is blessing the discrepancy rather than
   catching it.

On top of that, the committed native build carries two development-only keys —
a local-network usage description reading "Expo Dev Launcher uses the local
network to discover and connect to development servers running on your
computer" and the matching service list — which exist so a debug build can find
a development server on the LAN. The build service builds the committed native
tree as-is, so they reach production.

The automated store-manifest gate already fails on all five of these, and
because it runs first in the mobile test target, **no mobile test can run at
all** without bypassing the gate. That is drift D64. Fixing the declarations
fixes the gate, and fixing the gate returns the mobile suite to its normal
entry point.

The important distinction this feature draws: a permission is removed by
telling the configuration not to declare it, not by deleting a line from a
generated file. A hand-scrubbed generated file is correct exactly until the
next regeneration. Every removal here is expressed in the source configuration
first, and the committed generated output is brought into agreement second.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The app asks only for what it uses (Priority: P1)

Someone installs the app and uses the parts of it that need a device
capability: they make a voice call, attach a photo, and check in at a job site.
They are asked for exactly those capabilities, each with a sentence naming the
feature it enables, and never for anything else.

**Why this priority**: This is the whole feature. Every other story is a
consequence of it. A person who is asked for their location "always" by an app
that only ever needs it at check-in has been asked for more than the app uses,
and a reviewer reading that declaration reaches the same conclusion faster.

**Independent Test**: Install a production-configuration build and exercise
every capability-using flow. Enumerate every permission the built app declares
and every prompt the person actually sees, and compare both against the set the
app can be shown to use. Delivers the compliant declaration set on its own.

**Acceptance Scenarios**:

1. **Given** a build produced from the production configuration, **When** its
   declared iOS permission set is enumerated, **Then** it contains exactly
   microphone, camera, photo library, and when-in-use location — and no
   background-location key, no biometric key, and no local-network key.
2. **Given** the same build, **When** its declared Android permission set is
   enumerated, **Then** it contains exactly audio recording, coarse location,
   fine location, and notification posting — and neither biometric permission.
3. **Given** someone completing a task that requires location evidence,
   **When** the system prompts for location, **Then** the prompt asks for
   access while using the app and the text names checking in at a job site.
4. **Given** someone using the app from first launch through every
   capability-using flow, **When** they complete all of them, **Then** they are
   never prompted for background location, for biometrics, or for local-network
   access.
5. **Given** any permission the app declares, **When** its purpose string is
   read, **Then** it names the feature that permission enables and is not the
   text the underlying library supplies by default.

---

### User Story 2 - Removing a permission survives the next rebuild (Priority: P1)

An engineer regenerates the native project — because a dependency changed, or
because they need the development-only keys for LAN debugging and then reverts.
The removed permissions do not come back.

**Why this priority**: Equal to P1 because a removal that does not survive
regeneration has not happened. The exact failure being fixed is a generated
file that disagrees with its source configuration; repeating the hand-edit
without the configuration change reproduces the bug on a schedule. This story
is what separates a fix from a patch.

**Independent Test**: Regenerate the native projects from the source
configuration into a scratch location and enumerate the permissions in the
result. Compare against the committed generated tree. They agree.

**Acceptance Scenarios**:

1. **Given** the source configuration, **When** the native projects are
   regenerated from scratch, **Then** the regenerated iOS declarations contain
   no background-location key and no biometric key.
2. **Given** the regenerated native projects, **When** they are compared to the
   committed generated tree, **Then** the permission declarations agree in both
   directions — the committed tree is what regeneration produces, not a
   hand-scrubbed variant of it.
3. **Given** the regenerated Android project, **When** its merged manifest is
   enumerated, **Then** neither biometric permission is present in effect,
   whether because nothing declares it or because it is explicitly removed at
   merge.
4. **Given** an engineer who needs the development-only local-network keys on a
   physical device, **When** they regenerate the native project with the
   documented development opt-in, **Then** those keys are present with a
   development-appropriate string, and **When** they regenerate without it,
   **Then** the keys are absent again.

---

### User Story 3 - The automated gate catches the next one (Priority: P2)

The store-manifest gate runs as part of the mobile test target. It passes on a
correct tree, and it fails when someone adds a dependency that brings a
permission along with it.

**Why this priority**: P2 because the app is already compliant once P1 lands —
but this is what stops the same class of defect from recurring, and it is what
returns the mobile test suite to its normal entry point. The gate currently
fails, which means it has been providing no signal at all: a failing gate and a
gate that catches something look identical to anyone who has learned to skip
it.

**Independent Test**: Run the mobile test target on a clean tree and observe it
proceed past the gate into the test flows. Then introduce a spurious permission
and observe the gate fail with a message naming it.

**Acceptance Scenarios**:

1. **Given** a clean tree after this feature, **When** the store-manifest gate
   runs, **Then** it passes with no findings.
2. **Given** a clean tree after this feature, **When** the mobile test target is
   invoked through its normal entry point, **Then** it proceeds past the gate
   and runs the test flows, without anyone having to invoke the suite runner
   directly.
3. **Given** someone adds a biometric permission back to the app configuration,
   **When** the gate runs, **Then** it fails and names that permission as
   unexpected.
4. **Given** someone reintroduces a background-location or local-network key
   into either the app configuration or the committed generated build, **When**
   the gate runs, **Then** it fails and names the key.
5. **Given** the gate's allow-lists, **When** they are read, **Then** every
   entry corresponds to a capability the app can be shown to use — the
   allow-list is narrowed to match reality rather than widened to accommodate
   the discrepancy.

---

### User Story 4 - The permission document and the app agree (Priority: P3)

A reviewer, or a teammate preparing a submission, reads the written permission
justifications and finds one entry per permission the app actually requests,
and no entry for anything it does not.

**Why this priority**: P3 because it does not change what the app asks for. It
matters because the document is written to be pasted into a submission form —
a justification for a capability a reviewer then cannot find in the app is
worse than no mention at all, and the document's own standing rule is that a
change which removes a permission updates it in the same change set.

**Independent Test**: Read the justification document against the app's
declared permission set. Every declared permission has an entry; no entry
describes an undeclared permission.

**Acceptance Scenarios**:

1. **Given** the justification document after this feature, **When** it is read
   against the app's declared permissions, **Then** there is exactly one entry
   per declared permission and no entry for biometric sign-in.
2. **Given** the document's list of deliberately-absent keys, **When** it is
   read, **Then** the biometric permissions appear there with the reason, so
   the next person to wonder why finds the answer instead of re-adding them.
3. **Given** the gate's requirement that the document and the allow-lists
   agree, **When** the gate runs, **Then** it passes — the narrowed allow-lists
   and the narrowed document describe the same set.

---

### Edge Cases

- **An engineer needs LAN access to a development server on a physical
  device.** The development-only keys must remain reachable, because removing
  the capability rather than the production declaration would trade one broken
  thing for another. The opt-in already exists as a documented environment
  switch that injects the keys at regeneration time; this feature must leave
  that path working and must not leave its output committed. The friction is
  real and must be documented: because the generated native tree is committed
  and built as-is, an engineer who opts in produces local changes to that tree
  which must not be committed.
- **A dependency reintroduces a permission transitively.** Removing an entry
  from the allow-list is not enough on its own if a library declares the
  permission in its own manifest and the build merges it in. The removal must
  hold at merge time, not only in the app's own declaration — the existing
  handling for other transitively-arriving permissions is the pattern to
  follow.
- **The generated native tree is regenerated wholesale by a future change.**
  Any permission removal expressed only in the generated tree is lost. This is
  the failure mode that produced the current state and must not be the shape of
  the fix.
- **The gate is run before the native projects have been generated.** It must
  still check what it can and say plainly that its coverage is partial, rather
  than reporting a clean result that implies more than it verified.
- **A purpose string that is grammatical but generic.** "Allow TechOffice to
  access your location" is a complete sentence and would pass a naive
  non-empty check. The gate must reject strings that fail to name the feature,
  not merely strings that are missing.
- **Removing the last permission a document section describes.** The document
  and the allow-lists are cross-checked against each other; narrowing one
  without the other leaves the gate red for the opposite reason it is red
  today.

## Requirements *(mandatory)*

### Functional Requirements

**Declaring only what is used**

- **FR-001**: The app MUST NOT declare any background-location permission on
  either platform. The app requests foreground location only, at two explicit
  moments, and takes a single reading each time.
- **FR-002**: The app MUST NOT declare any biometric-authentication permission
  on either platform. No biometric sign-in exists in the app.
- **FR-003**: The app MUST NOT declare local-network access or service
  discovery in any build produced for distribution. These serve development
  against a local server only.
- **FR-004**: Each permission the app does declare MUST carry a purpose string
  that names the product and the specific feature the permission enables, and
  MUST NOT be the default text supplied by the library that contributes the
  permission.
- **FR-005**: After this feature, the app's declared permission set MUST be
  exactly: microphone, camera, photo library, and when-in-use location on iOS;
  and audio recording, coarse location, fine location, and notification posting
  on Android.

**Removal expressed at the source**

- **FR-006**: Every permission removal in FR-001 through FR-003 MUST be
  expressed in the source configuration that produces the native build, such
  that regenerating the native projects from scratch reproduces the removal
  without manual intervention.
- **FR-007**: The committed generated native build MUST agree with what
  regeneration from the source configuration produces, with respect to declared
  permissions and purpose strings.
- **FR-008**: For a permission that a dependency contributes to the merged
  native manifest, the removal MUST take effect at merge time, so that the
  permission is absent from the built artifact rather than merely absent from
  the app's own declaration.
- **FR-009**: The development-only local-network capability MUST remain
  available to an engineer through the existing opt-in, MUST produce a
  development-appropriate purpose string when opted in, and MUST produce
  nothing when not opted in.

**The automated gate**

- **FR-010**: The automated store-manifest gate MUST pass on a clean tree after
  this feature.
- **FR-011**: The gate's allow-lists MUST be narrowed to the set in FR-005. The
  biometric entries MUST be removed from the allow-lists rather than the
  declarations being retained to satisfy them.
- **FR-012**: The gate MUST fail, naming the offending permission or key, when
  any of the permissions in FR-001 through FR-003 is reintroduced — whether in
  the source configuration or in the committed generated build.
- **FR-013**: The gate MUST fail when a purpose string is the default text of
  the library that contributes it, or is otherwise generic enough not to name a
  feature.
- **FR-014**: The mobile test target MUST reach and run its test flows through
  its normal entry point, rather than aborting on the gate.

**Documentation**

- **FR-015**: The written permission justifications MUST contain exactly one
  entry per permission the app declares, and MUST NOT justify a permission the
  app does not declare.
- **FR-016**: The biometric permissions MUST be recorded among the
  deliberately-absent declarations, with the reason, so that the absence reads
  as a decision rather than an oversight.
- **FR-017**: The domain documentation describing the store-manifest gate MUST
  be updated to describe the gate as passing, and the drift entry recording its
  failure MUST be closed.

### Key Entities

- **Declared permission**: A capability the built app tells the operating
  system it may request. Has a platform, an identifier, and — on iOS — a
  purpose string shown to the person when it is first requested. Exists in
  three places that must agree: the source configuration, the committed
  generated build, and the gate's allow-list.
- **Purpose string**: The sentence a person reads when asked. Judged by whether
  it names the feature; a library default is a failure regardless of grammar.
- **Allow-list**: The gate's record of which permissions are permitted. Narrowed
  to match the app, never widened to match a discrepancy.
- **Justification entry**: The written explanation for one permission, kept in
  submission-ready prose and cross-checked against the allow-list by the gate.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who uses every capability-requiring flow in the app is
  shown exactly four distinct permission prompts on iOS (microphone, camera,
  photos, location while using the app) and three on Android (audio recording,
  location, notifications — the two location grades being a single prompt), and
  never a prompt for background location, biometrics, or local-network access.
- **SC-002**: Enumerating the permissions declared by a distribution-ready
  build yields the set in FR-005 exactly — no additions, no omissions — on both
  platforms.
- **SC-003**: Every purpose string in a distribution-ready build names a
  feature a person can find in the app; zero strings match the default text of
  the library that contributes them.
- **SC-004**: Regenerating the native projects from the source configuration
  and comparing the permission declarations against the committed generated
  tree yields no differences.
- **SC-005**: The automated store-manifest gate reports zero findings on a
  clean tree, where it reports five today.
- **SC-006**: The mobile test suite runs to completion through its normal entry
  point, with no step requiring the gate to be bypassed.
- **SC-007**: Reintroducing any one of the five removed declarations causes the
  gate to fail and to name it, verified once per declaration.
- **SC-008**: The written justifications and the app's declared permissions are
  in exact one-to-one correspondence, with zero entries describing a permission
  the app does not request.
- **SC-009**: Drift D64 is closed, and no new drift is opened in its place.

## Assumptions

- [ASSUMPTION: Removing biometric sign-in is a removal of a declaration, not of
  a feature. Verified before writing this spec: the only secure-storage call in
  the app configures at-rest key protection and never requests authentication,
  and no biometric authentication library is a dependency. Had a real feature
  been found behind the declaration, the correct outcome would have been the
  opposite — keep the permission, write a real purpose string. It was not.]
- [ASSUMPTION: The Android biometric permissions are handled the same way as
  the other transitively-arriving permissions the app already blocks, rather
  than by hand-editing the generated manifest. They appear in the generated
  manifest without appearing in the app's own declared list, which is the
  signature of a transitive arrival, and the project already has an established
  mechanism for exactly this case with three permissions in it. Following it
  keeps one pattern instead of two.]
- [ASSUMPTION: The written permission justifications are updated in this change
  set rather than deferred. That document states as a standing obligation that
  a change which removes a permission updates it in the same change set, and
  the gate cross-checks the document against the allow-lists, so deferring
  would leave the gate red for a new reason. The broader compliance-prose work
  — the reviewer notes, the data-collection inventory, and the age-rating
  questionnaire — is a separate, larger piece of work and stays out of this
  feature. See Out of Scope.]
- [ASSUMPTION: The development-only local-network opt-in is kept rather than
  removed. The existing mechanism already does the right thing — it injects the
  keys only behind an environment switch — and the defect is that the committed
  generated build predates it. Removing the opt-in would break debugging
  against a local server on a physical device, trading a compliance problem for
  a workflow one.]
- [ASSUMPTION: No migration, compatibility shim, or staged rollout is needed.
  Permission declarations are build-time metadata; a person who has already
  granted a permission that the new build no longer declares is simply never
  asked again and the app never uses it. Consistent with the project's stance
  that breaking changes ship as one coordinated change set.]
- [ASSUMPTION: The gate's existing rejection of generic purpose strings —
  minimum length, required product name, banned development vocabulary — is
  sufficient for FR-013 as written, since the specific placeholder at issue
  fails it. No new string heuristic is introduced unless the placeholder is
  found to pass.]

## Out of Scope

- The compliance prose beyond the permission justifications: the reviewer
  notes, the data-collection inventory, and the newly-mandatory social-media
  capability questions in the age-rating questionnaire. That is a distinct and
  larger piece of work.
- Removing the unused biometric credential type from the backend data model.
  That is part of a separate cleanup of reserved-but-unused values.
- Any change to what the app does with the permissions it keeps. The location,
  camera, photo, and microphone flows are unchanged.
- Adding a biometric sign-in feature. If one is wanted later, it arrives with
  its own permission, its own purpose string, its own justification entry, and
  its own allow-list entry.
- The other environment drift recorded alongside D64 — the failing lint run,
  the frontend test-gate health check, the tracked binary. Unrelated to
  permissions.
