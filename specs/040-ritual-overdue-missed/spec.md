# Feature Specification: Overdue and Missed Rituals Become Real States with Alerts

**Feature Branch**: `040-ritual-overdue-missed`

**Created**: 2026-09-03

**Status**: Draft

**Input**: User description: "Overdue and missed rituals become real states with alerts. Add a reconciliation sweep so a ritual instance whose deadline passes with no evidence moves to overdue and later to missed, and notify the assignee and the reviewer. Today an owner only learns a checklist was skipped by opening a health report; the headline promise depends on the worker volunteering. Clears drift D29."

## Context

A ritual is a recurring operational task with mandatory evidence — a shift checklist, a
safety inspection, a closing procedure. The product's headline promise to a small-business
owner is that they will know when one of these is not done.

Today that promise is not kept. `overdue` and `missed` exist as workflow state categories,
but nothing ever writes them for an instance nobody touched. State is recomputed only when
somebody submits, approves or rejects evidence — so the one case that matters most, a
worker who did nothing at all, is exactly the case that produces no signal. The instance
sits in `todo` forever. It appears as overdue only where a screen computes urgency at read
time (the "my work" summary and the health report), which means the owner has to go looking
for the failure. `missed` is never reached by any path.

This is drift **D29** in `docs/domain/README.md`. This feature clears it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A skipped checklist reaches the assignee without anyone asking (Priority: P1)

Mai is a shift worker with a "Closing checklist" ritual due by 23:00. She forgets. At the
next reconciliation pass after 23:00 the instance stops claiming it is merely "to do" — it
becomes **overdue** and Mai gets a notification naming the ritual and how late it is. She
opens it from the notification, completes the evidence, and the instance leaves the overdue
state on its own.

**Why this priority**: This is the whole feature. Without it every other story is
decoration. It is the first moment the system tells the truth about work that did not
happen, and it does so early enough that the work can still be recovered — which is more
valuable to the business than any report.

**Independent Test**: Create a ritual instance with a deadline in the past and no evidence,
run one reconciliation pass, and observe (a) the instance's state category is `overdue` and
(b) the assignee has an overdue notification. Nothing else in the feature is required.

**Acceptance Scenarios**:

1. **Given** a ritual instance in `todo` whose completion deadline has passed and which has
   no evidence submissions, **When** a reconciliation pass runs, **Then** the instance moves
   to the `overdue` state and its assignees each receive one overdue notification.
2. **Given** a ritual instance that is already `overdue`, **When** further reconciliation
   passes run before the missed threshold, **Then** its state does not change and no further
   overdue notification is sent.
3. **Given** an `overdue` instance, **When** the assignee submits the last required piece of
   evidence, **Then** the instance leaves `overdue` on the existing evidence-driven path and
   later reconciliation passes leave it alone.
4. **Given** a ritual instance whose deadline has **not** passed, **When** a reconciliation
   pass runs, **Then** nothing about it changes and nobody is notified.
5. **Given** a ritual instance whose deadline has passed but which has some — not all —
   required evidence submitted, **When** a reconciliation pass runs, **Then** it moves to
   `overdue`, because partial evidence is not a completed ritual.

---

### User Story 2 - The owner learns a ritual was missed, in the place they already look (Priority: P1)

Tuan owns the business. A safety inspection was due yesterday and never happened. Once the
grace period after the deadline elapses the instance becomes **missed** — a terminal state —
and Tuan is notified, along with the ritual's reviewer and the assignee who did not do it.
He learns this from the notification he already receives everything else through, not by
remembering to open a compliance report.

**Why this priority**: The drift note names this exact failure: "an owner only learns a
checklist was skipped by opening a health report". P1 alongside Story 1 because an overdue
alert to a worker who is already ignoring the ritual does not escalate to anyone; the
promise is only kept when the escalation lands.

**Independent Test**: Create an instance whose deadline passed longer ago than the grace
period, run one reconciliation pass, and observe the instance is `missed` and that the
assignee, the reviewer and (where no reviewer exists) the project's owners and admins each
hold a missed notification.

**Acceptance Scenarios**:

1. **Given** an `overdue` instance whose grace period after the deadline has now elapsed,
   **When** a reconciliation pass runs, **Then** it moves to `missed` and the assignees and
   reviewers each receive one missed notification.
2. **Given** a missed instance with no reviewer assigned, **When** it transitions to
   `missed`, **Then** the owners and admins of the instance's project receive the missed
   notification instead, so the escalation always reaches a person with authority.
3. **Given** an instance that is already `missed`, **When** later reconciliation passes run,
   **Then** it is left alone and nobody is notified again — `missed` is terminal.
4. **Given** an instance whose deadline and grace period both passed before the first
   reconciliation pass ever ran, **When** that pass runs, **Then** it moves straight to
   `missed` in one step rather than pausing at `overdue`.
5. **Given** an instance that was explicitly skipped with a reason, or already verified,
   **When** a reconciliation pass runs, **Then** it is not touched — an accounted-for
   outcome is not a failure.

---

### User Story 3 - Overdue and missed are visible wherever the ritual is (Priority: P2)

Because the states are now written to the instance rather than computed per screen, every
surface that shows a ritual shows the same truth: the task list, the ritual detail view, the
"my work" summary, the calendar overlay, the health report and the compliance export all
agree. Tapping the overdue or missed notification on web or mobile opens that instance.

**Why this priority**: The value is delivered by Stories 1 and 2; this story is what stops
the system contradicting itself across screens, and it is what makes the notification
actionable rather than merely informative. It cannot be skipped for release but it does not
stand alone.

**Independent Test**: With one overdue and one missed instance present, load each ritual
surface on web and on mobile and confirm each reports the same state, and that opening the
notification on each client lands on the instance.

**Acceptance Scenarios**:

1. **Given** an instance the sweep moved to `overdue`, **When** a user opens the task list,
   the ritual detail view, the "my work" summary or the health report, **Then** every one of
   them reports it as overdue.
2. **Given** an overdue or missed notification, **When** the recipient opens it on web or on
   mobile, **Then** the client navigates to that ritual instance rather than to a generic
   list or a dead end.
3. **Given** a missed instance, **When** compliance figures are read or exported for the
   period, **Then** it is counted as missed rather than as outstanding work.

---

### User Story 4 - The escalation respects how the person has asked to be reached (Priority: P3)

An overdue alert at 02:00 for a ritual due at 23:00 helps nobody. These notifications follow
the same do-not-disturb window, domain mute and presence rules as every other notification
in the system, and they are ordinary-priority: they are not permitted to override quiet
hours the way an @mention or a ringing call may.

**Why this priority**: Correct by construction if the feature publishes through the existing
notification pipeline and does not reach for elevated priority. Called out as its own story
because getting it wrong turns the product's most useful alert into the one people mute.

**Independent Test**: Put a recipient in a do-not-disturb window and confirm an overdue
transition still records the notification and still updates state, but does not push during
the window.

**Acceptance Scenarios**:

1. **Given** a recipient inside their do-not-disturb window, **When** an instance assigned to
   them becomes overdue, **Then** the state change still happens and the notification is
   still recorded, but no push interrupts them during the window.
2. **Given** a recipient who has muted the projects domain, **When** an instance becomes
   overdue or missed, **Then** the same rules that mute every other projects notification
   apply here, with no special case.

---

### Edge Cases

- **An instance with no assignee.** Pool-based assignment can leave an instance unassigned if
  a department pool is empty. The state transition still happens; the overdue notification
  has no recipient, and the missed notification escalates to the project's owners and admins.
  An unassigned ritual failing silently is precisely the hole this feature closes.
- **The instance's definition was archived after the instance was generated.** The instance
  still has a deadline and still matters, so it is still reconciled. Discovery for this sweep
  cannot be limited to organizations with *active* definitions the way generation's is.
- **The instance was detached from its ritual** by a schedule change. Detached instances are
  ordinary standalone tasks and are never reconciled — the same rule the evidence-driven path
  already applies.
- **The instance has no completion deadline recorded.** It cannot be judged late, so it is
  left alone rather than guessed at.
- **All required evidence is submitted and awaiting review when the deadline passes.** The
  worker did their part; the delay is the reviewer's. It stays `submitted` and does not
  become overdue.
- **Required evidence was submitted and then rejected, and the deadline has passed.** The
  ritual is not satisfied, so it becomes overdue — a rejected submission must not shelter an
  instance from the sweep.
- **First run over a backlog.** On first deployment every historical unreconciled instance is
  eligible at once. Instances whose deadline passed longer ago than the backfill horizon are
  moved to their terminal state without notifying anyone; nobody is served by a hundred
  alerts about last quarter.
- **Two passes overlap, or a pass runs twice.** Reconciliation is driven by the instance's
  current stored state, so a repeated pass changes nothing and re-notifies nobody.
- **One organization's data is malformed and the pass errors on it.** That organization is
  logged and skipped; every other organization in the same pass is still reconciled.
- **A project has no `overdue` or `missed` state configured.** The instance is left in its
  current state and the condition is logged, rather than the pass failing.
- **The clock crosses the threshold while a user is submitting evidence.** Whichever write
  lands second sees the state the first one left and derives from the same rules, so the
  instance cannot end up both overdue and complete.
- **A ritual in a non-UTC timezone.** Lateness is judged against the instance's stored
  deadline, which was computed in the definition's timezone at generation, so a ritual in
  `Asia/Tokyo` is not late eleven hours early.

## Requirements *(mandatory)*

### Functional Requirements

#### The states themselves

- **FR-001**: A ritual instance whose completion deadline has passed without its required
  evidence being fully submitted MUST be recorded in the `overdue` state, persistently, and
  not merely computed at read time.
- **FR-002**: A ritual instance that remains unsatisfied for a grace period beyond its
  completion deadline MUST be recorded in the `missed` state.
- **FR-003**: `missed` MUST be terminal: no automatic transition may move an instance out of
  it, and it MUST NOT be re-notified.
- **FR-004**: `verified` and `skipped` instances MUST NOT be reconciled to `overdue` or
  `missed`. Instances detached from their ritual definition MUST NOT be reconciled at all.
- **FR-005**: An instance with no completion deadline MUST NOT be judged late.
- **FR-006**: State derivation MUST rank a passed deadline above partial progress, so an
  instance with some — but not all — required evidence submitted becomes overdue rather than
  remaining "in progress". Fully submitted evidence awaiting review MUST continue to rank
  above overdue, because the outstanding action is the reviewer's.
- **FR-007**: Evidence-driven reconciliation and sweep-driven reconciliation MUST decide
  state from the same rules, so the two paths cannot disagree about the same instance.

#### The sweep

- **FR-008**: A recurring reconciliation pass MUST run automatically without any user or
  client action, across all organizations, and MUST NOT depend on a per-definition or
  per-instance schedule.
- **FR-009**: The pass MUST find instances belonging to archived as well as active ritual
  definitions, since an already-generated instance outlives its definition's archival.
- **FR-010**: The pass MUST be idempotent: running it twice over the same data MUST produce
  the same states and no duplicate notifications.
- **FR-011**: A failure while reconciling one organization MUST be logged and MUST NOT abort
  the pass for the remaining organizations. The same isolation MUST apply per instance within
  an organization.
- **FR-012**: The pass MUST report how many organizations it processed, how many instances it
  examined, and how many it moved to `overdue` and to `missed`, so a silent pass is
  distinguishable from an empty one.
- **FR-013**: The pass MUST bound its own work per run rather than loading every eligible
  instance in an organization without limit, so a large backlog degrades into more passes
  rather than one failed pass.

#### Notification

- **FR-014**: On the transition to `overdue`, the instance's assignees and its reviewers MUST
  each be notified once, with a message naming the ritual, the instance's scheduled date and
  how late it now is.
- **FR-015**: On the transition to `missed`, the instance's assignees and its reviewers MUST
  each be notified once, with a message identifying it as missed and naming the ritual and
  its scheduled date.
- **FR-016**: When an instance becomes `missed` and has no reviewer, the owners and admins of
  its project MUST receive the missed notification instead, so the escalation always reaches
  someone with authority over the work.
- **FR-017**: Opening an overdue or missed notification on web or on mobile MUST navigate to
  that ritual instance.
- **FR-018**: These notifications MUST be published at ordinary priority and MUST be subject
  to the existing do-not-disturb, domain-mute and presence rules. They MUST NOT use the
  always-deliver priority reserved for mentions and incoming calls.
- **FR-019**: The notification types these transitions publish MUST be declared in the
  application's notification-type list and the database's permitted-type constraint together,
  so the two cannot drift apart.
- **FR-020**: Notifications MUST be sent only for an actual state transition performed by
  this feature. An instance already in the target state MUST NOT produce a notification.
- **FR-021**: Instances whose deadline passed longer ago than the backfill horizon MUST be
  moved to their terminal state without notification, so first deployment does not flood
  recipients with historical alerts.

#### Surfaces

- **FR-022**: Every surface that displays a ritual instance's state — task lists, ritual
  detail, the assigned-work summary, the calendar overlay, health reporting and compliance
  export — MUST reflect the stored `overdue` and `missed` states rather than each computing
  its own notion of lateness.
- **FR-023**: Web and mobile MUST both render the `overdue` and `missed` states distinctly
  from `todo`, and MUST both resolve the two new notification types to a destination.

### Key Entities

- **Ritual instance**: the recurring task occurrence. Already carries a scheduled date, a
  completion deadline, a workflow state and an evidence trail. This feature makes its state
  column the authority on lateness.
- **Ritual definition**: the recurrence and evidence template. Already carries the completion
  window that produces each instance's deadline; that window also determines the grace period
  before `missed`.
- **Workflow state**: the per-project ordered column an instance sits in, carrying a category.
  `overdue` and `missed` already exist as ritual categories and are seeded per project.
- **Evidence submission**: the proof against a requirement. Its presence, completeness and
  approval status decide whether a passed deadline means anything.
- **Task assignment**: who is responsible (`assignee`) and who checks the work (`reviewer`,
  `approver`). Determines who is told.
- **Reconciliation pass**: the recurring, organization-spanning job that applies the lateness
  rules and emits the transitions. Reports its own counts.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of ritual instances whose deadline passes without complete evidence are
  recorded as overdue, with no user or client action required to make it happen.
- **SC-002**: An assignee is notified that a ritual is overdue within 10 minutes of its
  deadline passing.
- **SC-003**: An owner learns that a ritual was missed without opening a report — measured as
  the missed notification reaching a project owner or admin in 100% of cases where the
  instance has no reviewer.
- **SC-004**: Repeated reconciliation passes over unchanged data produce zero additional
  notifications and zero additional state changes.
- **SC-005**: All ritual surfaces on web and mobile report the same state for the same
  instance, with zero screens computing their own lateness.
- **SC-006**: A single organization's failure never prevents the remaining organizations in
  the same pass from being reconciled — verified with a fault injected mid-pass.
- **SC-007**: Drift D29 is cleared from the drift register and the "Known drift" section of
  the rituals domain document, with `overdue` and `missed` documented as real states.

## Assumptions

- **[ASSUMPTION: The grace period before `missed` equals the ritual's own completion window,
  rather than a new configurable field.]** Every definition already carries
  `completion_window_hours` (default 24), which sets each instance's deadline. Reusing it as
  the grace period means a ritual becomes missed one window after it becomes overdue, so an
  urgent ritual with a short window escalates quickly and a monthly one with a long window
  does not. This avoids a new column, a new request field and a new form control on two
  clients for a knob nobody has asked for; a dedicated `missed_after_hours` is the upgrade
  path if a customer needs the two decoupled.
- **[ASSUMPTION: The reconciliation pass is a separate recurring job from the existing
  ritual generation sweep, running every 5 minutes.]** Generation discovers organizations by
  their *active* definitions; reconciliation must also cover instances of archived ones, so
  the discovery query genuinely differs. Keeping them separate also keeps a write-and-notify
  job from sharing failure and reporting with an idempotent read-mostly one. Five minutes is
  chosen because the thresholds are measured in hours — the generation sweep's one-minute
  cadence buys nothing here — and it satisfies SC-002 with margin.
- **[ASSUMPTION: "Reviewer" means a task assignment with the `reviewer` or `approver` role on
  the instance.]** The description says "the reviewer" without naming a mechanism; these are
  the two existing roles that mean "checks this work", and both are notified.
- **[ASSUMPTION: The backfill horizon is 7 days.]** Instances whose deadline passed more than
  7 days ago are reconciled silently. This is a first-deployment and long-outage protection,
  not a product rule; a week is long enough that anything older is history rather than
  actionable.
- **[ASSUMPTION: Per-pass work is bounded at a fixed number of instances per organization.]**
  FR-013 requires a bound; the specific figure is an implementation choice for the plan, since
  the correctness requirement is only that a backlog produces more passes rather than one
  failed pass.
- **[ASSUMPTION: No new client-initiated RPC is introduced.]** The states arrive through the
  data clients already read and the notifications through the pipeline they already consume,
  so this feature adds no read or write endpoint. A manual "reconcile now" control was not
  asked for and would only paper over a broken schedule.
- **[ASSUMPTION: Notification wording is generated server-side in the existing style.]** No
  new template system or per-organization customisation is introduced.
- Assignment, deadline computation, timezone handling and instance generation are unchanged;
  this feature only reads what generation already wrote.
- Both `overdue` and `missed` are already seeded as ritual state categories in every project's
  workflow, so no state-seeding change is required. Where a project is missing one, the
  instance is left alone and the condition logged (see Edge Cases).
- The notification types `ritual_instance_overdue` and `ritual_instance_missed` were removed
  from the code and the database constraint on 2026-08-30 because they had no caller. This
  feature restores them in both places in the same change set, which the existing
  constraint-vs-constants test enforces.

## Out of Scope

- A configurable, per-definition escalation ladder (reminders before the deadline, repeated
  nags after it). This feature emits exactly two transitions and two notifications.
- Notifying anyone other than the assignee, the reviewer, and — for `missed` with no reviewer
  — the project's owners and admins. Department-wide or organization-wide broadcast is not
  included.
- Any change to how instances are generated, assigned, scheduled or deadlined.
- Automatic remediation: the system does not reassign, reschedule or clone a missed ritual.
- A digest or roll-up of overdue rituals. Each transition notifies independently; if volume
  proves to be a problem, the generation sweep's post-loop summary is the pattern to copy.
- Changes to the compliance report's own layout or metrics beyond their counting the newly
  real states correctly.
