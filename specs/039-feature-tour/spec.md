# Feature Specification: Feature Tour

**Feature Branch**: `039-feature-tour`

**Created**: 2026-09-02

**Status**: Draft

**Input**: User description: "implement 'feature tour' for most important features. we should have different tour for owners and employees"

## Problem

Nothing today teaches a person what TechOffice is for. An owner who finishes registration
lands on an empty Calendar and has to guess that rituals, projects and PIN accounts exist.
A worker who signs in for the first time on a phone sees four tabs and no explanation of
why "Today" matters or what "proof" means. The written guides exist and are good, but they
live on a separate site nobody opens unprompted.

The product's whole claim is that chat, checklists, the schedule and the written procedures
are *connected*. That claim is invisible on first sign-in, and the two audiences need to be
told completely different things: the owner has to **set the workspace up**, the worker has
to **know what they owe today and how to prove it**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An administrator is shown how to make the workspace real (Priority: P1)

Dana registers Bright Bean Coffee and lands in an empty workspace. Instead of a blank
Calendar, she is offered a short tour of the things that turn an empty workspace into a
running one: getting her baristas in without email addresses, making a project, defining
the opening checklist that must leave proof, the channels the work is discussed in, the
schedule, and where procedures are written down. Each stop is a card that explains one
capability and offers to open the screen that provides it. She can leave at any point and
pick it up later, on the laptop in the back office or on her phone on the floor.

**Why this priority**: The owner is the person who decides whether the product is adopted
at all, and the owner is the only person who can create the content everyone else uses. An
owner who never defines a ritual has a workspace that does nothing, and the strongest
feature in the product is never seen.

**Independent Test**: Register a new organization, sign in as the owner on web and on
mobile, and verify the tour is offered, that each stop names a real capability and opens the
surface that provides it, that a stop for a web-only capability says so rather than offering
it on the phone, that leaving mid-tour and returning — including on the other platform —
resumes at the same stop, and that finishing it never offers it again unless deliberately
restarted.

**Acceptance Scenarios**:

1. **Given** a newly created organization whose owner has never seen the tour, **When** the owner reaches the workspace for the first time, **Then** the administrator tour is offered with a clear way to start it and a clear way to decline it.
2. **Given** an owner part-way through the tour, **When** they leave the workspace and sign in again — on the same device or a different one — **Then** the tour resumes at the stop they had not completed, not at the beginning.
3. **Given** an owner on a tour stop about a capability, **When** they choose to act on that stop, **Then** they are taken to the surface where that capability lives, and the tour is still resumable afterwards.
4. **Given** an owner who has completed or dismissed the tour, **When** they sign in again, **Then** the tour is not offered automatically.
5. **Given** an owner who has completed or dismissed the tour, **When** they choose to restart it from the help entry point, **Then** the tour runs again from its first stop.
6. **Given** an owner who took the tour on the web, **When** they sign in on the mobile app for the first time, **Then** the administrator tour is not offered again automatically.
7. **Given** an owner taking the tour on mobile, **When** they reach a stop for a capability that only exists on the web, **Then** the stop explains that it is done on the web rather than offering to start it on the phone.

---

### User Story 2 - A worker is shown what they owe and how to prove it (Priority: P1)

Leo signs in on his phone with an account ID and a PIN on his first shift. Before he is left
alone with four tabs, a short tour tells him: this tab is what you owe today, this is how you
complete a checklist run and submit the proof, this is where the shift is discussed and how a
message becomes a piece of work, and this is how you are told when something needs you. It is
shorter than the owner's, uses plain language, and never mentions anything he cannot do.

**Why this priority**: Deskless workers are the majority of users and the least likely to
explore. The product only produces value when they actually submit evidence; a worker who
does not understand "proof" silently turns the ritual system into an unticked clipboard.

**Why it is built after User Story 1 despite sharing its priority**: both tours are rendered
by the same components and served by the same call, so User Story 1 builds essentially all of
this story. Sequencing it second is a build order, not a statement that it matters less.

**Independent Test**: Sign in as a newly created org-managed worker, on mobile and on web,
verify the worker tour is offered on both, that it covers only capabilities that worker can
actually reach, that it can be dismissed and resumed, and that it is a different sequence
from the owner's.

**Acceptance Scenarios**:

1. **Given** a worker signing in for the first time on either platform, **When** they arrive at the workspace, **Then** the worker tour is offered — not the administrator tour.
2. **Given** a worker on the tour, **When** a stop describes a capability their permissions do not grant, **Then** that stop is not shown at all.
3. **Given** a worker who dismisses the tour, **When** they sign in again, **Then** it is not offered automatically, and it remains available from the help entry point.
4. **Given** a worker who completes the tour, **When** the workspace records completion, **Then** the completion is remembered for that person in that organization and survives reinstalling the app.

---

### User Story 3 - The tour is available on demand, not only at first run (Priority: P2)

Mai was busy on her first day and skipped the tour. Three weeks later she wants to know what
the Review queue is. She opens Help and replays the tour for her role, or jumps to a single
stop from it.

**Why this priority**: Recoverable discovery. Without it, a single mistimed dismissal
permanently removes the only in-product explanation of the product. It is P2 because the
first-run path already delivers the core value.

**Independent Test**: As any signed-in person who has dismissed the tour, open the help
entry point, start the tour, and verify it runs the sequence matching that person's role.

**Acceptance Scenarios**:

1. **Given** any signed-in person, **When** they open the help entry point, **Then** a way to run the tour for their role is present.
2. **Given** a person whose role has changed since they last took a tour, **When** they run the tour again, **Then** they get the sequence matching their current permissions.

---

### Edge Cases

- **A stop describes something that does not exist yet.** The owner's "your rituals" stop is shown in a workspace with no project. The stop must describe the capability and offer to create the thing, never drop the owner on an empty screen with no explanation.
- **Permissions hide the capability.** A worker cannot open Organization. Any stop whose capability the person lacks permission for is omitted from their sequence rather than shown and then failing.
- **The capability is not on this platform.** An owner takes the tour on the phone and reaches bulk employee import. The stop explains what it is and that it lives on the web; it does not offer a button that cannot work.
- **The tour is taken on both platforms.** A person who completed it on web opens the mobile app. They are not offered it again, and the help entry point on mobile can still replay it.
- **Role changes mid-tour.** A worker promoted to operator part-way through the worker tour. Progress is per tour, so the new role's tour is offered as not-yet-taken and the old progress is left alone.
- **A person belongs to more than one organization.** Progress is remembered per person per organization, so joining a second workspace offers the tour again.
- **The person is on a small screen or mobile web.** Every stop must remain fully readable and dismissible at the narrowest supported width; a stop that cannot be dismissed is a lockout.
- **Keyboard and screen-reader users.** The tour must be fully operable and announced without a pointing device, and must never trap focus with no exit.
- **The tour collides with a blocking gate.** Terms acceptance, mandatory PIN creation and first-run onboarding all take precedence; the tour is offered only once nothing is holding the person out of the workspace.
- **Interrupted by a deep link.** A person who arrives from a push notification or a shared link is taken to the resource; the tour is not allowed to intercept that navigation.
- **The tour's content changes after someone completed it.** A completed tour is not silently re-offered because a stop was edited; re-offering requires a deliberate decision recorded with the tour.
- **Repeated declines.** Declining is a decision, not a snooze — it is honoured permanently until the person restarts the tour themselves.

## Requirements *(mandatory)*

### Functional Requirements

**Tour content and audience**

- **FR-001**: The system MUST provide two distinct tours — the **administrator tour** and the **worker tour** — with different stops, ordering and language. "Administrator" is the settled name for the first throughout this feature; it is served to owners and operators alike, which is why it is not called the owner tour.
- **FR-002**: The system MUST select which tour a person is offered from that person's permissions in the organization they are signed into, not from a self-declared choice.
- **FR-003**: The administrator tour MUST cover, in order: getting people into the workspace (including accounts for staff with no email address), creating a project, defining a recurring checklist that collects proof, the conversation surface and how a message becomes a piece of work, the schedule, and where written procedures live.
- **FR-004**: The worker tour MUST cover, in order: what is due today and what is overdue, completing a run of a recurring checklist and submitting proof for it, the conversation surface and turning a message into a piece of work, and how they are notified and how they search.
- **FR-005**: Each tour MUST be at most 6 stops, and no stop's body MUST exceed 60 words. The word cap is what makes "short" checkable; it is verified when the tour copy is reviewed, not by a runtime test.
- **FR-006**: A stop whose capability the person lacks permission to use MUST be omitted from that person's sequence.

**Running the tour**

- **FR-007**: The system MUST offer the appropriate tour automatically the first time a person reaches the workspace in an organization, and MUST NOT offer it automatically again once it has been completed or dismissed.
- **FR-008**: The system MUST NOT offer the tour while any mandatory gate — terms acceptance, mandatory credential setup, first-run onboarding — is still holding the person out of the workspace.
- **FR-009**: Users MUST be able to leave the tour at any stop, with a dismissal control present and reachable on every stop.
- **FR-010**: The system MUST resume an incomplete tour at the first stop the person has not completed.
- **FR-011**: Users MUST be able to move to the next and previous stop, and MUST be able to see how many stops there are and which one they are on.
- **FR-012**: Each stop MUST offer a way to go to the surface that provides the capability it describes. Acting on a stop MUST close the tour rather than cover the surface it just opened, and the tour MUST reappear — at the same stop — the next time the person returns to the place the tour is offered from, without them having to find it in the help menu.
- **FR-013**: The tour MUST NOT intercept a navigation the person did not initiate from within the tour — in particular a deep link, a shared link or a notification tap.
- **FR-013a**: A stop describing something the workspace does not have yet MUST open the surface where that thing is created, positioned so the create action is visible without further searching. A stop MUST NOT leave the person on an empty list with no explanation of what to do next.

**Persistence and re-entry**

- **FR-014**: A stop MUST be treated as complete when the person has read it and moved past it. Tour progress MUST NOT be derived from the state of the workspace, and a stop MUST NOT stay outstanding because the capability it describes has not been used.
- **FR-015**: The system MUST remember, per person per organization per tour, whether that tour is not started, in progress at a specific stop, completed, or dismissed.
- **FR-015a**: If a person's permissions change so that their tour has fewer stops than their recorded position, the tour MUST resume at the last stop that still exists rather than failing or showing a blank stop.
- **FR-016**: That record MUST survive signing out, changing device, and reinstalling the mobile application.
- **FR-017**: Users MUST be able to start the tour for their current role on demand from the product's help entry point, regardless of previously recording completion or dismissal.

**Presentation**

- **FR-018**: A tour stop MUST be presented as a self-contained card that describes the capability and offers to open the surface providing it. A stop MUST NOT be anchored to, positioned against, or highlight a specific live interface element.
- **FR-019**: The tour MUST be fully operable by keyboard and MUST be announced to assistive technology, including the current stop's position in the sequence.
- **FR-020**: The tour MUST remain readable and dismissible at the narrowest supported width on each platform.
- **FR-021**: Tour copy MUST use the product's plain-language vocabulary and MUST NOT introduce names for concepts that do not appear in the product or the user guides.

**Platform coverage**

- **FR-022**: Both tours MUST be available on both the web application and the mobile application. An administrator is offered the administrator tour on either, and a worker is offered the worker tour on either.
- **FR-023**: A stop MUST be adapted to the platform it is running on. Where the capability it teaches exists on that platform, the stop describes it and offers to open it there. Where the capability is web-only — bulk import, role editing, department management, storage quota — the mobile stop MUST say plainly that it is done on the web and MUST NOT offer to start it on the phone.
- **FR-024**: A person who has taken a tour on one platform MUST NOT be offered that same tour automatically on the other. Progress is a property of the person and the organization, not of the device.
- **FR-025**: The mobile presentation of a tour MUST be purpose-built for a phone in portrait and MUST NOT be a responsive rendering of the web presentation.

### Key Entities

- **Tour**: A named, ordered sequence of stops for one audience. Has an audience (owner/administrator or worker) and a content version.
- **Tour Stop**: One step of a tour. Names the capability it teaches, the surface that provides it, its position in the sequence, and the permission that must be held for it to be shown.
- **Tour Progress**: What one person, in one organization, has done with one tour — not started, in progress at a stop, completed, or dismissed — with the time it last changed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A newly registered owner can complete the whole administrator tour, from the first offer to the last stop, in under 5 minutes including the time spent opening each surface it points at.
- **SC-002**: At least 60% of owners offered the tour complete every stop of it, and at least 85% engage with at least one stop rather than dismissing immediately.
- **SC-003**: The share of workspaces that have at least one recurring checklist defined within seven days of registration increases by 40% against the pre-tour baseline. This is an adoption outcome the tour is expected to influence, not something it enforces: a stop is complete when it has been read, and no stop inspects whether the workspace was actually set up.
- **SC-004**: At least 70% of workers offered the tour complete it, and the share of first-week workers who submit proof for at least one checklist run increases by 30% against the pre-tour baseline.
- **SC-005**: A tour that a person has completed or dismissed is never offered to them automatically again, on either platform, verified by test rather than by telemetry — nothing records individual offers.
- **SC-006**: Every tour stop is reachable, readable and dismissible using only a keyboard and using only a screen reader, verified for both tours.
- **SC-007**: Each tour is completable in under 3 minutes of reading time.
- **SC-008**: Every stop of both tours is readable and dismissible at 360 dp width in portrait without truncation or horizontal scrolling, and on the web at the narrowest supported browser width.

## Assumptions

- **Owners use the mobile app.** Both tours run on both platforms because owners of small businesses operate from the floor, not a desk, and mobile is progressively gaining the product's most important features. This does not weaken Constitution principle XIII: the administrator tour on mobile teaches *day-to-day operation*, and any stop covering *administration* — bulk import, role editing, department management, storage quota, billing — points the owner at the web rather than surfacing the capability on the phone. The split that holds is administration versus day-to-day operation, not owner versus worker.
- **Cards, not spotlights.** Stops are self-contained cards rather than overlays anchored on live interface elements. This keeps the tour durable across redesigns and avoids coupling it to the geometry of every screen it describes, at the cost of teaching *what exists* rather than *exactly where it sits on this screen*.
- **Reading is completion.** A stop is done when it has been read. The tour is orientation, not a setup checklist driven by workspace state, so no stop inspects whether a project, ritual or second member actually exists.
- **Audience mapping.** Two tours are built, not three. The `owner` and `operator` roles both receive the owner/administrator tour, because both configure the workspace; `employee` and any custom role without administrative permissions receives the worker tour. Which one a person gets is derived from held permissions, so a custom role lands on the correct side automatically.
- **The tour teaches; it does not replace the guides.** The written guides in the product's help site remain the long-form explanation. The tour is the short in-product pointer, and may link out to a guide, but does not duplicate its content.
- **Feature selection.** "Most important features" is taken to mean the capabilities the user guides and product positioning already treat as the core: people and PIN accounts, projects, rituals with evidence, chat connected to work, the schedule, and written procedures. Files, voice, the context rail, department management and administrative settings are deliberately out of the tour.
- **No new analytics infrastructure is assumed.** Where a success criterion needs a completion or adoption rate, it is measured from data the system already records — tour progress records and existing workspace content — not from a new event pipeline.
- **Existing surfaces are reused.** The tour opens screens that already exist. It does not require new screens for the capabilities it teaches, only the tour presentation itself.
- **Multi-tenancy.** Tour progress is scoped to a person within an organization, consistent with every other per-person record in the product.
- **Interruption is normal.** Owners set up a workspace between other jobs; the tour is designed to be abandoned and resumed rather than completed in one sitting.

## Out of Scope

- Any tour of administrative surfaces beyond the six owner stops — department management, role editing, bulk import, storage quota, billing.
- Product-change announcements, "what's new" notices, or any recurring in-product messaging. This feature is first-run orientation only.
- Interactive sandbox or sample data. The tour runs against the person's real workspace.
- Spotlight or coach-mark overlays anchored on live interface elements, and any per-element highlighting.
- A setup checklist derived from workspace state, or any surface that tracks whether the owner actually created a project, a ritual or a second account.
- Localisation into additional languages.
- A tour authoring interface for administrators. Tour content is defined by the product, not per organization.
