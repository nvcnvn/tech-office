# Feature Specification: Create Projects And Rituals On Mobile

**Feature Branch**: `044-mobile-project-ritual-creation`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "Owners and managers create projects and rituals on mobile. The feature tour marks these stops web-only and an owner cannot set up tomorrow's checklist while standing in the store. Clears drift D38."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Define Tomorrow's Ritual From The Shop Floor (Priority: P1)

An owner or manager standing in their store, at the end of a shift, opens the phone and
defines a recurring checklist — the opening routine, the closing count, the Monday deep
clean — naming it, saying how often it repeats, and saying what proof each run must leave.
The first runs exist the moment they save, so tomorrow's shift has the checklist without
anyone going to a computer.

**Why this priority**: This is the whole request. Rituals are what the product's own tour
calls "the part most businesses come here for", and the moment a business needs one is the
moment the gap is noticed — a manager on the floor, after a shift, seeing something that
should be checked every day. Sending them to a desk means the ritual is defined days later
or never. Everything else in this spec either enables this story or removes a way it can
strand somebody.

**Independent Test**: In a workspace that already has a project (every registered workspace
does), sign in on a phone as an owner, define a daily ritual with one photo evidence
requirement, and confirm the upcoming runs are visible on the phone immediately afterwards
and that a worker assigned to it can open tomorrow's run and submit evidence.

**Acceptance Scenarios**:

1. **Given** an owner on a phone viewing a project they own or administer, **When** they
   choose to add a ritual, name it, pick "every day", add one required photo evidence
   requirement and save, **Then** the ritual definition exists and its upcoming runs are
   listed on the phone without any further wait.
2. **Given** the same owner, **When** they pick "every week" and select Monday and Friday,
   **Then** the saved ritual generates runs only on those days.
3. **Given** the same owner, **When** they pick "every month" and a day of the month,
   **Then** the saved ritual generates a run on that day each month.
4. **Given** a person who is a plain member of a project (not owner or admin), **When** they
   open that project on the phone, **Then** no add-a-ritual action is offered to them.
5. **Given** an owner who saved a ritual with two evidence requirements, **When** they reopen
   it on the phone, **Then** both requirements are shown, with the same names, types and
   required/optional setting they entered.
6. **Given** an owner who names a ritual and saves it, **When** the save fails for any
   reason, **Then** they are told plainly and no half-created ritual is left behind.

---

### User Story 2 - Start A Project From The Phone (Priority: P1)

An owner who has just created their workspace on a phone, or who is separating a new part of
the business, creates a project from the phone: a name, a short identifier, and whether the
project is for one-off tasks, for recurring rituals, or for both.

**Why this priority**: A ritual lives inside a project, so this is the floor under Story 1
for any workspace that needs a second project — and it is the stop the tour points at first.
It is a separate story because it is a separate surface with its own rules (the project key,
which is permanent and must be unique) and because Story 1 is independently deliverable
without it: every registered workspace already has one project.

**Independent Test**: On a phone, create a project with a name and a mode, and confirm it
appears in the project list on the phone and on the web with the name, identifier and mode
that were entered.

**Acceptance Scenarios**:

1. **Given** an owner on a phone, **When** they enter a project name and save, **Then** the
   project is created with a short identifier derived from the name, and they land on the new
   project.
2. **Given** an owner entering a name, **When** they change the suggested identifier by hand,
   **Then** their identifier is used, and an identifier that breaks the workspace's rules is
   refused before the save is attempted, with a message saying what a valid one looks like.
3. **Given** an owner entering an identifier already used by another project in the
   workspace, **When** they save, **Then** they are told the identifier is taken and the form
   keeps everything they typed.
4. **Given** an owner creating a project, **When** they choose the mode that covers both
   one-off tasks and recurring rituals, **Then** the created project opens leading with
   whichever of the two that mode implies, the same as it would on the web.
5. **Given** a person whose role does not allow creating projects, **When** they open the
   project list on the phone, **Then** no create action is offered.

---

### User Story 3 - The Tour Stops Point Somewhere On Mobile (Priority: P2)

The administrator tour's "Create a project" and "Define a ritual" stops stop being
apologies. On a phone they carry their real copy and a working action button, exactly as on
the web, so an owner taking the tour on their phone can act on the two stops the product's
own tour calls the most important.

**Why this priority**: This is the drift the request names (D38) and it is the difference
between the feature existing and the feature being found. It is P2 rather than P1 because
the create surfaces are worth having even if the tour still says otherwise, and because it
cannot be delivered before them — an actionable stop pointing at a screen that does not
exist is the empty-screen failure the tour's own spec forbids.

**Independent Test**: Take the administrator tour on a phone and confirm the project and
ritual stops show their full copy with an action button, that each button lands on the
matching create surface, and that the tour reopens at the right stop on return.

**Acceptance Scenarios**:

1. **Given** an administrator taking the tour on a phone, **When** they reach the project
   stop, **Then** it shows the same body copy as on the web and an action button, not the
   "done on the web" note.
2. **Given** the same person, **When** they act on the project stop, **Then** they arrive at
   project creation on the phone.
3. **Given** the same person in a workspace that already has a project, **When** they act on
   the ritual stop, **Then** they arrive at ritual creation inside that project.
4. **Given** the same person in a workspace with no project at all, **When** they act on the
   ritual stop, **Then** they arrive at project creation instead and the card says why, the
   same fallback the web tour uses.
5. **Given** an administrator who acts on a stop and then returns to the surface the tour was
   offered from, **When** the tour reopens, **Then** it reopens at the stop they acted on.
6. **Given** an administrator on a phone, **When** they reach the "Add your team" stop,
   **Then** it still shows the "done on the web" note — adding staff and setting roles remain
   web-only.

---

### User Story 4 - Undo A Ritual Created By Mistake (Priority: P3)

Someone who defines a ritual on the phone and immediately realises it is wrong — wrong days,
wrong name, wrong project — can stop it from the phone rather than living with a checklist
that fires every morning until they next sit at a computer.

**Why this priority**: It is the trap the first three stories open. Creating without any way
to stop is worse than not creating, because a daily ritual on the wrong schedule generates a
run every day and each one nags somebody. It is P3 because it is only reachable after Story
1, and because a single "stop this ritual" is enough — full editing on the phone is a much
larger surface and is deliberately not in this feature.

**Independent Test**: Create a ritual on the phone, archive it from the phone, and confirm no
further runs are generated and existing future runs behave exactly as they do when a ritual
is archived on the web.

**Acceptance Scenarios**:

1. **Given** an owner or admin of a project viewing one of its rituals on the phone, **When**
   they archive it, **Then** they are asked to confirm, and on confirming the ritual stops
   generating new runs.
2. **Given** an archived ritual, **When** the same person views it on the phone, **Then** it
   is shown as archived and offers to restore it.
3. **Given** a project member who is not an owner or admin, **When** they view a ritual on
   the phone, **Then** no archive action is offered.

---

### Edge Cases

- **A workspace with no project at all.** Registration seeds one, but a workspace can archive
  its last project. Ritual creation must not be reachable in that state; the ritual tour stop
  falls back to project creation and says so.
- **A project the person can see but not administer.** Ritual management needs project owner
  or admin, which is a stricter bar than the workspace-level permission. The phone must apply
  the stricter bar, because an action offered and then refused is worse than one never
  offered.
- **A duplicate project identifier**, or one that breaks the format rule. Both are refused
  with a message naming the field, and nothing the person typed is lost.
- **Weekly with no day selected**, or monthly with no day of the month. Refused before saving,
  with the rule stated in plain words.
- **A ritual saved while the phone is offline or the network drops mid-save.** The person is
  told the save did not happen and their entries are still on screen to retry. No duplicate
  ritual is created by retrying after an ambiguous failure.
- **Evidence requirements that fail to save.** A ritual with no evidence requirement is a task
  with a schedule, not a ritual, so the definition and its requirements must land together or
  not at all.
- **A very narrow phone screen.** The recurrence controls (seven weekday choices, a day-of-month
  choice) must remain usable at 360dp width on Android as well as iOS.
- **Timezone.** A ritual created on a phone must run on the local day the person means. The
  phone's own timezone is the honest default; a person travelling with their phone must not
  silently re-time a store's opening checklist.
- **Someone who cannot create anything.** No dead affordances: a person without the permission
  sees no create action rather than one that fails.
- **A ritual created inside a project that is later archived.** Behaviour is unchanged from
  today; this feature adds no new rule there.

## Requirements *(mandatory)*

### Functional Requirements

**Creating a project on mobile**

- **FR-001**: A person using the mobile app who holds the workspace permission to create
  projects MUST be able to create one, entering a project name, a short project identifier, an
  optional description, the project's visibility, and its collaboration mode.
- **FR-002**: The mobile form MUST suggest a project identifier derived from the name using the
  same rule the web form uses, MUST stop suggesting once the person edits the identifier, and
  MUST validate the identifier against the same format rule before submitting.
- **FR-003**: A project created on mobile MUST be indistinguishable from one created on the
  web — same fields, same defaults, same resulting states and levels — so nothing needs
  repairing on a computer afterwards.
- **FR-004**: The mobile project list MUST offer the create action only to people who hold the
  permission to create projects, and MUST NOT show it to anyone else.
- **FR-005**: On success the person MUST land on the newly created project rather than back on
  a list they have to search.

**Creating a ritual on mobile**

- **FR-006**: A person who is an owner or administrator of a project and holds the permission
  to manage ritual definitions MUST be able to create a ritual definition in that project from
  the mobile app.
- **FR-007**: The mobile ritual form MUST collect: a name (required); an optional plain-text
  description; a recurrence of daily, weekly or monthly with the parameters that recurrence
  needs (an interval for daily, a set of weekdays for weekly, a day of the month for monthly);
  and at least one evidence requirement.
- **FR-008**: Each evidence requirement collected on mobile MUST carry a name, one or more
  kinds of proof, and whether it is required or optional. The kinds of proof offered MUST be
  the same set the product already supports.
- **FR-009**: The mobile form MUST NOT ask for the completion window, the generation window, or
  the approval mode. It MUST apply the same defaults the product already applies when those are
  not specified, and those defaults MUST remain changeable on the web.
- **FR-010**: The mobile form MUST default the ritual's timezone to the phone's current
  timezone, expressed in the form the product already stores, and MUST show the person which
  timezone it is using so a wrong one is visible before saving.
- **FR-011**: A person MUST be able to name who the ritual is for by choosing one or more
  people from the workspace. Choosing nobody MUST be allowed and MUST behave exactly as an
  unassigned ritual behaves today.
- **FR-012**: The mobile form MUST NOT offer department pools, assignment strategies, the
  procedure document attachment, auto-approval configuration, custom intervals or nth-weekday
  recurrences. Those remain web-only configuration and MUST be preserved untouched when a
  ritual configured on the web is later viewed on mobile.
- **FR-013**: Creating a ritual and its evidence requirements MUST be atomic from the person's
  point of view: either the ritual exists with every requirement they entered, or nothing was
  created and they are told so.
- **FR-014**: Immediately after a successful save the person MUST be able to see the ritual's
  upcoming runs from the phone, with no waiting for a background cycle.
- **FR-015**: The mobile ritual create action MUST be offered only inside a project where the
  person is an owner or administrator, matching the rule the server enforces, and MUST NOT
  appear elsewhere.
- **FR-016**: A refusal from the server MUST be shown as a plain-language message naming what
  is wrong, and the form MUST keep everything the person entered so they can correct and retry.

**Stopping a ritual from mobile**

- **FR-017**: A project owner or administrator MUST be able to archive and unarchive a ritual
  definition from the mobile app, behind a confirmation, with the same effect archiving has on
  the web.
- **FR-018**: Mobile MUST NOT offer any other edit of an existing ritual definition. Changing a
  ritual's schedule, its evidence requirements, its pools or its procedure document remains
  web-only.

**The feature tour**

- **FR-019**: The tour's project and ritual stops MUST no longer be treated as web-only. On
  mobile they MUST carry their full body copy, their action label, and an action that leads to
  the matching mobile create surface.
- **FR-020**: The tour's people stop MUST remain web-only on mobile, unchanged.
- **FR-021**: On mobile, the ritual stop MUST land inside an existing project's ritual
  creation, and MUST fall back to project creation — saying why — when the workspace has no
  project, matching the web tour's behaviour.
- **FR-022**: Tour progress, the offer rules and the reopen-after-acting behaviour MUST be
  unchanged; this feature changes only where two stops point on one platform.
- **FR-023**: Drift register entry D38 MUST be closed, and every document that states these
  capabilities are absent from mobile MUST be corrected in the same change set — the drift
  register, the mobile and ritual domain snapshots, the tour content contract and the mobile
  feature-scope mapping.

**Cross-cutting**

- **FR-024**: Both mobile create surfaces MUST be purpose-built for a phone in portrait — not a
  reflow of the web forms — and MUST be usable at 360dp width, verified on Android as well as
  iOS.
- **FR-025**: Every interactive element added by this feature MUST be addressable by the
  mobile blackbox test driver, and each of project creation and ritual creation MUST have at
  least one happy-path flow in the standing mobile suite.
- **FR-026**: This feature MUST add no new server capability. Both creations go through the
  existing request surfaces, with the existing permission and resource checks unchanged; if a
  shared client wrapper cannot express what the existing request already accepts, the wrapper
  is what changes.
- **FR-027**: Constitution principle XIII MUST be amended in the same change set to admit
  project and ritual-definition creation as mobile capabilities, since it presently confines
  configuration to the web with a carve-out that covers only first-run onboarding. Shipping
  these surfaces without that amendment leaves the codebase contradicting its own constitution.

### Key Entities

- **Project**: unchanged. Gains a second creation surface, not a new field. Its identifier is
  permanent and unique per workspace, which is why the phone validates it before saving.
- **Ritual definition**: unchanged. Gains a second creation surface that populates a deliberate
  subset of its fields and leaves the rest at their existing defaults.
- **Evidence requirement**: unchanged. Created together with the definition it belongs to.
- **Tour stop**: unchanged in shape. Two administrator stops lose their web-only marking and
  gain a mobile destination.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner standing in their store can define a daily ritual with one photo
  requirement, from opening the app to seeing tomorrow's run listed, in under 2 minutes and
  without touching a computer.
- **SC-002**: An owner can create a project on the phone in under 60 seconds, entering only a
  name.
- **SC-003**: A ritual created on the phone and the same ritual created on the web produce
  identical runs — same dates, same evidence requirements, same assignment behaviour — when
  given the same inputs.
- **SC-004**: 100% of the administrator tour's stops are actionable on mobile except the people
  stop, which remains deliberately web-only.
- **SC-005**: Nobody is shown a create action they cannot complete: in every permission and
  project-role combination, the affordance is present exactly when the action would succeed.
- **SC-006**: A person who mistypes a project identifier, picks a weekly recurrence with no day,
  or hits a network failure mid-save loses nothing they typed and can correct and retry in
  place.
- **SC-007**: Both new mobile surfaces render and operate correctly at 360dp width on Android
  and on iOS, with no clipped, unreachable or overlapping controls.
- **SC-008**: Drift register entry D38 is closed, and no repository document still states that
  mobile cannot create projects or rituals.

## Assumptions

- [ASSUMPTION: This feature requires amending Constitution principle XIII, which currently
  says administrative and configuration features "MUST remain web-only" with an exhaustive
  first-run-onboarding carve-out that does not cover project or ritual creation. It is
  specified as in scope (FR-027) rather than treated as a blocker, because the repository
  owner's standing direction is that mobile progressively gains the product's most important
  features and that the real line is between *administration* and *day-to-day operation* —
  and defining the checklist for tomorrow's shift, from the floor, is operation. The amendment
  should widen the carve-out narrowly, to project and ritual-definition creation only, and
  leave role editing, department management, member import, billing and quotas web-only.]
- [ASSUMPTION: The mobile ritual form collects a deliberate subset of the web form's fields.
  The web editor is a two-column, five-section page with roughly fifteen controls; reproducing
  it on a phone would violate the mobile simplicity rule and would take longer to fill in than
  walking to a computer. The subset chosen — name, recurrence, evidence requirements,
  assignees — is what a ritual cannot be defined without. Everything omitted already has a
  working default on the server and stays editable on the web.]
- [ASSUMPTION: Custom-interval recurrences and nth-weekday ("second Monday") recurrences are
  excluded from mobile. Nth-weekday has no control on the web either, and custom intervals are
  a power-user case that adds a second numeric field to every phone form for a rare need.]
- [ASSUMPTION: The procedure document attachment (feature 043) stays web-only on mobile, as
  spec 043 decided. Attaching hands read access to everyone who can see the ritual, the
  document chooser is known to offer documents the chooser cannot themselves open (drift D49),
  and a consequential sharing decision made from a phone picker is the wrong first mobile
  surface for it. Mobile continues to *read* attached procedures, which it already does.]
- [ASSUMPTION: The ritual's description is collected as plain text on mobile, not rich text.
  The web editor is a rich-text surface; a phone keyboard with a formatting toolbar is not the
  place to author one, and the field round-trips as text today.]
- [ASSUMPTION: Archiving a ritual from mobile (Story 4) is included even though the request
  says "create", because creation without any stop is a trap: a wrong daily ritual generates a
  run every morning. Archiving is one existing operation with existing semantics; full mobile
  editing is not included.]
- [ASSUMPTION: Project creation on mobile collects all five fields the web dialog collects
  rather than a reduced set. Visibility and collaboration mode are two- and three-way choices
  that fit a phone, the mode determines what the project looks like from then on, and the
  project identifier is permanent — none of the three are things to guess on the person's
  behalf.]
- [ASSUMPTION: No new server capability, permission or data is introduced (FR-026). The
  existing create requests already accept everything both mobile forms collect, including
  evidence requirements in the same call. Where a shared typed client wrapper does not yet
  expose a field the request accepts, extending that wrapper is the change — not adding a
  server endpoint.]
- [ASSUMPTION: The project-role bar for ritual creation (project owner or administrator) is
  reflected in the mobile UI even though it is a resource-level rule rather than a workspace
  permission. Without it the action is offered to plain members and refused on submit.]
- [ASSUMPTION: The mobile create surfaces are presented as modal screens, matching the
  existing mobile create pattern for events and channels, rather than as pushed screens or
  bottom sheets. This is a convention match, not a new decision.]
- [ASSUMPTION: The default project seeded at workspace registration means Story 1 is
  reachable in every real workspace without Story 2, which is why the two are both P1 and
  independently testable.]

## Dependencies

- The existing project and ritual-definition creation request surfaces, with their existing
  permission and project-role checks, supply everything both forms need. No backend feature
  work is expected beyond whatever the shared typed client wrapper is missing.
- The feature tour (feature 039) supplies the stop content and the per-platform route maps.
  Its web-only marking is one field per stop and its mobile route map already carries an
  explicit placeholder for these two targets.
- The ritual generation sweep (feature 034) already materialises a new definition's first
  window inside the creation transaction, which is what makes FR-014 achievable with no new
  work.
- Constitution principle XIII must be amended (FR-027) before or with this change set.
- Per the project's Definition of Done, `docs/domain/workspace-navigation.md`,
  `docs/domain/rituals-tasks.md`, the drift register in `docs/domain/README.md`,
  `specs/039-feature-tour/contracts/tour-content.md` and the web→mobile scope table in
  `specs/mobile-ui-design.md` must be updated in the same change set.

## Out of Scope

- Editing an existing ritual definition on mobile beyond archive and unarchive — no schedule
  change, no evidence-requirement editing, no renaming.
- Department pools and assignment strategies (including on-shift) on mobile.
- Attaching, replacing or removing a ritual's procedure document on mobile.
- Auto-approval configuration, per-requirement deadline offsets, completion-window and
  generation-window editing on mobile.
- Custom-interval and nth-weekday recurrences on mobile.
- Rich-text ritual descriptions on mobile.
- Project settings beyond creation — the existing mobile project settings screen is unchanged.
- Adding staff, importing a team or setting roles on mobile; the tour's people stop stays
  web-only.
- Any change to how rituals are generated, assigned, submitted or reviewed.
- Closing drift D49 (organization-scoped document search), which this feature avoids rather
  than fixes by keeping the procedure picker off mobile.
