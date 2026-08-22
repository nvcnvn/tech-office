# Feature Specification: Global Ritual Scheduler

**Feature Branch**: `034-global-ritual-scheduler`
**Created**: 2026-08-22
**Status**: Draft
**Input**: User description: "Delete the per-definition ritual cron machinery and have a global one."

## Context

Today every ritual definition owns a private recurring schedule. When an owner creates,
edits, archives, or reschedules a ritual, the system translates that ritual's recurrence
rule into a machine-level recurring timer and registers, updates, pauses, resumes, or
rewrites a timer dedicated to that one ritual.

Each of those timers, when it fires, does exactly the same thing: it regenerates ritual
instances for *every* active ritual definition in that organization. The ritual identity
attached to the timer is only used for logging. An organization with 40 active rituals
therefore performs 40 identical whole-organization regeneration passes per cycle, and the
recurrence-to-timer translation exists purely to decide *when to poll*, never *what gets
generated* — the generation pass already re-derives the correct dates from each
definition's own recurrence rule and generation window.

This feature deletes the per-definition timer machinery outright and replaces it with a
single global sweep that regenerates ritual instances for all organizations on one fixed
cadence.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rituals keep appearing on schedule with no per-ritual timer (Priority: P1)

An operations lead relies on recurring rituals (daily standup checks, weekly safety walks,
monthly audits) appearing as task instances ahead of their due dates. After this change no
ritual owns a private timer, yet every active ritual still produces its instances on the
same dates it did before, across every organization on the platform.

**Why this priority**: This is the entire user-visible contract of the ritual system. If
instances stop appearing — or appear on different dates — the feature has broken the
product regardless of how much machinery was deleted.

**Independent Test**: Create ritual definitions covering each supported recurrence pattern
(daily, every-N-days, weekly on selected weekdays, monthly on a day-of-month, custom
interval) in more than one organization, let the global sweep run, and confirm the set of
generated instances and their scheduled dates match what the per-definition timers produced
for the same definitions.

**Acceptance Scenarios**:

1. **Given** active ritual definitions exist in several organizations, **When** the global
   sweep runs once, **Then** every organization's due instances are generated in that
   single run.
2. **Given** a weekly ritual scheduled for Mondays and Thursdays, **When** the global sweep
   runs repeatedly across a week, **Then** instances are created only for Mondays and
   Thursdays, on the same dates as before this change.
3. **Given** a ritual whose instances for the current generation window already exist,
   **When** the global sweep runs again, **Then** no duplicate instances are created and no
   error is raised.
4. **Given** an organization with 40 active ritual definitions, **When** one sweep cycle
   completes, **Then** that organization is regenerated exactly once, not once per
   definition.

---

### User Story 2 - Ritual lifecycle actions no longer manage timers (Priority: P1)

A project owner creates a new ritual, edits its recurrence, archives it, and later
restores it. None of these actions registers, rewrites, pauses, or resumes a timer. The
ritual's own stored recurrence rule and archived flag are the only things that decide what
the global sweep generates for it.

**Why this priority**: This is the deletion the feature exists to make. It is the source of
the redundant work and of the drift risk where a stored recurrence rule and a separately
stored timer can disagree.

**Independent Test**: Exercise create, update, archive, unarchive, and reschedule on ritual
definitions, then inspect the scheduling records: no ritual-specific recurring schedule is
ever created, and generation behaviour still tracks each definition's stored rule.

**Acceptance Scenarios**:

1. **Given** a new ritual definition is created, **When** creation succeeds, **Then** no
   ritual-specific recurring schedule record exists for it, and the ritual's first
   instances are generated immediately as part of creation rather than waiting for the
   next sweep.
2. **Given** an existing ritual's recurrence rule is changed, **When** the change is saved,
   **Then** no schedule record is written or rewritten, and subsequent sweeps generate
   instances matching the new rule.
3. **Given** a ritual is archived, **When** the next sweep runs, **Then** that ritual
   produces no new instances, without any pause operation having been performed.
4. **Given** an archived ritual is unarchived, **When** the next sweep runs, **Then** it
   resumes producing instances, without any resume operation having been performed.
5. **Given** a ritual's recurrence rule cannot be interpreted, **When** the sweep runs,
   **Then** that ritual is skipped with a warning and every other ritual in the sweep is
   still generated.

---

### User Story 3 - Operators can see and trust one scheduling surface (Priority: P2)

An operator diagnosing "why didn't my ritual appear?" looks at one recurring job instead of
hunting for a timer belonging to a specific ritual. The sweep reports, per run, how many
organizations and definitions it processed and how many instances it created, and it is
visible as a single named recurring job.

**Why this priority**: Valuable for operations and support, but the system is correct and
shippable without the reporting improvements; it depends on P1 being done.

**Independent Test**: Run the sweep and confirm a single named recurring job exists, that
its run output reports organizations processed, definitions processed, and instances
created, and that a failure affecting one organization is attributable from that output.

**Acceptance Scenarios**:

1. **Given** the system is running, **When** an operator lists recurring scheduled jobs,
   **Then** exactly one ritual generation job is present regardless of how many ritual
   definitions exist across the platform.
2. **Given** the sweep runs, **When** it completes, **Then** it reports the number of
   organizations processed, definitions processed, and instances created for that run.
3. **Given** generation fails for one organization, **When** the sweep runs, **Then** the
   failure is reported with that organization identified and the remaining organizations
   are still processed in the same run.

---

### Edge Cases

- **Existing per-ritual schedules at rollout**: Organizations already running have one
  recurring schedule record per ritual definition. These must be removed as part of the
  rollout so they cannot keep firing the deleted work; the global sweep must not depend on
  them being gone in order to be correct.
- **A ritual finer-grained than the sweep**: The supported recurrence set includes
  very-short-interval patterns used for testing. A ritual can never be generated more often
  than the sweep cadence; recurrence patterns finer than the sweep interval are satisfied
  only up to that interval.
- **Ritual created between sweeps**: Instances are generated at creation time, so a newly
  created ritual does not wait up to a full sweep interval for its first instances.
- **Recurrence changed between sweeps**: The reschedule path already regenerates instances
  as part of the change, so the corrected instances appear immediately rather than at the
  next sweep.
- **Organization with zero active rituals**: The sweep visits it and creates nothing,
  without error and without measurable cost.
- **Organization deleted or deactivated**: The sweep skips it rather than failing the whole
  run.
- **Sweep run overruns its interval**: A run still in progress when the next tick arrives
  must not produce duplicate instances; generation is idempotent per definition and date.
- **Instance already exists for a date**: Re-running produces no duplicate and no error.
- **Time zones**: Each ritual's own configured time zone continues to determine the dates
  it generates; a single global sweep cadence must not shift any ritual's dates.
- **Clock skew / missed cycle**: If a sweep cycle is missed entirely, the next run
  backfills the dates that were due, because generation derives its dates from each
  definition's last-generated marker and generation window rather than from when the timer
  fired.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST generate ritual task instances from exactly one recurring
  platform-wide job, regardless of the number of organizations or ritual definitions.
- **FR-002**: The system MUST NOT create, update, pause, resume, or delete any
  ritual-specific recurring schedule when a ritual definition is created, updated,
  archived, unarchived, or rescheduled.
- **FR-003**: The system MUST remove all recurrence-rule-to-timer translation: no ritual's
  recurrence rule is converted into a machine-level recurring timer expression anywhere in
  the system.
- **FR-004**: Each run of the global job MUST process every organization that has at least
  one active, unarchived ritual definition, and MUST regenerate each such organization at
  most once per run.
- **FR-005**: For every active ritual definition, generated instances and their scheduled
  dates MUST be identical to what the per-definition schedules produced for the same
  definition, recurrence rule, time zone, and generation window.
- **FR-006**: Instance generation MUST remain idempotent: re-running the job for the same
  definition and date MUST NOT create duplicate instances or raise an error.
- **FR-007**: The global job MUST run on a fixed cadence of once per minute, matching the
  cadence of the platform's existing global polling jobs and satisfying the finest
  supported ritual recurrence pattern.
- **FR-008**: A failure processing one organization MUST NOT abort the run; remaining
  organizations MUST still be processed and the failure MUST be reported with the
  organization identified.
- **FR-009**: A ritual definition with an uninterpretable recurrence rule MUST be skipped
  with a warning, leaving all other definitions in that organization unaffected.
- **FR-010**: Archived ritual definitions MUST produce no instances, determined solely from
  the definition's stored archived state at sweep time.
- **FR-011**: Creating a ritual definition MUST generate its immediately-due instances as
  part of the creation operation, so the ritual does not wait for the next sweep.
- **FR-012**: Changing a ritual definition's schedule MUST regenerate its instances as part
  of that operation, preserving the existing removed / detached / created counts reported
  back to the user.
- **FR-013**: The rollout MUST delete all existing per-ritual-definition recurring schedule
  records so that no orphaned timer continues to fire after the change.
- **FR-014**: Each run MUST report the number of organizations processed, ritual
  definitions processed, and instances created.
- **FR-015**: The global job MUST be registered and actually scheduled at service startup,
  and MUST remain scheduled across restarts without creating duplicate schedule records.
- **FR-016**: All code paths that exist solely to support per-definition scheduling MUST be
  deleted rather than left unused, including the ritual-specific schedule identifier, the
  recurrence-to-timer conversion and its helpers, the per-definition job input, and the
  scheduler dependency threaded into the collaboration request handlers.

### Key Entities

- **Ritual Definition**: The recurring ritual template an owner configures. Owns its
  recurrence rule, time zone, generation window, archived flag, and last-generated marker.
  After this change it owns no scheduling record; its stored fields are the sole input to
  generation.
- **Ritual Instance**: A dated, assignable occurrence produced from a definition. Unique
  per definition and scheduled date, which is what makes repeated sweeps safe.
- **Global Ritual Generation Job**: The single platform-wide recurring job. Iterates
  organizations that have active ritual definitions, regenerates each once per run, and
  reports its per-run totals.
- **Recurring Schedule Record**: The stored scheduling entry the platform uses to fire
  recurring jobs. Reduced from one record per ritual definition to one record for the
  whole platform.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The number of stored recurring schedule records for ritual generation is
  exactly one across the entire platform, down from one per ritual definition.
- **SC-002**: For an organization with N active ritual definitions, one sweep cycle performs
  one regeneration pass instead of N, eliminating (N−1) redundant passes per cycle — a
  greater than 95% reduction in redundant generation work for any organization with 20 or
  more rituals.
- **SC-003**: For every supported recurrence pattern, the dates and count of generated
  instances after the change are identical to those generated before the change for the
  same definitions and time zones — verified as zero differences across the pattern matrix.
- **SC-004**: Ritual owners observe no change in when their ritual instances appear:
  instances for a newly created ritual are available immediately on creation, and
  subsequent instances appear on the same dates as before.
- **SC-005**: Creating, updating, archiving, unarchiving, and rescheduling a ritual each
  complete without performing any scheduling operation — zero schedule writes across the
  full lifecycle.
- **SC-006**: An operator can determine why a ritual did not generate by inspecting a single
  job's run output, without needing to locate a ritual-specific timer.
- **SC-007**: Net deletion: the ritual scheduling code path is smaller after the change than
  before, with no unused scheduling helpers left behind.

## Assumptions

- The finest recurrence patterns the system supports are the short-interval test patterns
  (one and two minute). A one-minute sweep cadence therefore satisfies every supported
  pattern, and matches the cadence the platform's existing global polling jobs already use.
- Generation correctness does not depend on *when* the sweep fires. The generation pass
  already derives target dates from each definition's recurrence rule, time zone,
  last-generated marker, and generation window, so a fixed cadence produces the same dates
  a rule-derived timer did. This is what makes the recurrence-to-timer translation
  deletable rather than merely relocatable.
- Immediate generation on ritual creation and on schedule change is preserved, so no user
  waits for a sweep tick to see the effect of an action they just took.
- Per the project's early-development stance, this is a deliberate breaking change to the
  scheduling implementation shipped as one coordinated change set; no compatibility path
  keeps per-definition schedules working alongside the global job.
- Existing per-definition schedule records are removed as part of the rollout, since leaving
  them would keep firing work the global job now covers.
- Sweeping every organization once per minute is acceptable at current platform scale; if
  the organization count grows enough for the per-run cost to matter, the sweep can later
  narrow to organizations with rituals actually due without changing this specification's
  observable behaviour.
