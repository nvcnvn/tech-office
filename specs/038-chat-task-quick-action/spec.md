# Feature Specification: Create a Task from a Chat Message

**Feature Branch**: `038-chat-task-quick-action`

**Created**: 2026-09-01

**Status**: Draft

**Input**: User description: "quick action for creating task from chat. We have task management system, best if we can find a way to managed task from chat. The Tasks create from chat cannot be a Ritual right? So it need to be a standard task, but how to properly intergration them to fit a simple workspace tool to work for small team need carefull ux design"

## Context

Work in a small team is agreed in conversation and then forgotten. Someone writes "can you
re-order the filters before Friday", everyone nods, and nothing exists anywhere that says
it is owed. Today the only way to record it is to leave the conversation, open the task
area, pick a project, retype the request from memory, and lose the thread that explains it.
The cost of that round trip is high enough that most teams simply do not pay it, so the
task system holds only the work somebody deliberately sat down to file.

This feature closes that gap: a message becomes a task in place, and the task remembers
where it came from.

**Rituals are explicitly out of scope.** A ritual is a *recurring* obligation with mandatory
evidence, generated ahead of time from a schedule by an organization-wide sweep. A sentence
in a chat channel is a one-off commitment with no recurrence rule and no evidence contract,
so a message can only ever produce a **standard task**. Nothing in this feature creates,
edits, or schedules a ritual definition or a ritual instance.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn a message into a task without leaving the conversation (Priority: P1)

A team member reads a message that contains a commitment. From the message's own action
menu they choose "Create task". A compact sheet opens with the title already filled in from
the message text. They pick the destination project (the first time in this channel; after
that it is remembered), optionally pick an assignee and a due date, and confirm. The sheet
closes, a reply appears on the message naming the new task, and the reader is still in the
same place in the conversation.

**Why this priority**: This is the whole feature. Without it there is nothing to link,
nothing to display, and nothing to configure. On its own it already removes the round trip
that stops small teams from recording work.

**Independent Test**: Open any channel, use the action on a message, confirm the sheet, and
verify a standard task exists in the destination project with the expected title, creator,
and (if chosen) assignee and due date — without any other part of this feature built.

**Acceptance Scenarios**:

1. **Given** a channel member viewing a text message, **When** they open the message action
   menu, **Then** a "Create task" action is offered alongside the existing reply, react,
   edit and delete actions.
2. **Given** the quick-create sheet is open, **When** it first renders, **Then** the title
   field contains the message's text content with formatting removed, truncated to the
   title limit, and the field is focused with the text selected so it can be replaced in
   one keystroke.
3. **Given** the sheet is open with a valid title, **When** the user confirms, **Then** a
   task of kind *standard* is created in the destination project, the creator is the
   confirming user, and a confirmation naming the task identifier is shown with an action
   to open the task.
4. **Given** the message mentions exactly one person, **When** the sheet opens, **Then**
   that person is pre-selected as the assignee, and the user can clear or change it.
5. **Given** the user wants fields the sheet does not offer, **When** they choose the
   sheet's "More options" affordance, **Then** the full task creation surface opens
   carrying every value already entered, and confirming there produces the same linked task.
6. **Given** the user confirms with an empty title, **When** validation runs, **Then**
   creation is refused with an inline message and nothing is created.
7. **Given** a message of kind *system* (such as a call-started notice), **When** its
   actions are shown, **Then** "Create task" is not offered.
8. **Given** a task was created from a message, **When** the conversion completes, **Then**
   one reply naming the task appears on that message's thread, attributed to the converting
   user, and it produces no reply or mention notification for anyone.

---

### User Story 2 - See what a message became, and get back to the conversation from the task (Priority: P2)

After a message has been turned into a task, anyone who can see the message sees a compact
chip on it naming the resulting task and its current state, and can tap through. From the
other direction, the task shows where it came from: an excerpt of the originating message,
who wrote it, and a link that opens the conversation at that exact message.

**Why this priority**: Without the link the feature quietly creates duplicates — three
people read the same message and file the same task three times — and the assignee gets a
one-line title with none of the discussion that explains it. This is what makes the
integration trustworthy rather than merely convenient.

**Independent Test**: Create a task from a message, then reload both the channel and the
task detail view; verify the chip appears on the message, the origin block appears on the
task, and each navigates to the other.

**Acceptance Scenarios**:

1. **Given** a message that has produced a task, **When** any member who can read that
   message views it, **Then** a chip naming the task identifier and its current state is
   rendered with the message.
2. **Given** that chip, **When** it is activated, **Then** the task detail view opens.
3. **Given** a task created from a message, **When** its detail view is opened, **Then** it
   shows the source channel name, the message author, an excerpt of the message, and a link
   that opens the conversation scrolled to and highlighting that message.
4. **Given** a user opens the action menu on a message that has already produced a task,
   **When** the menu renders, **Then** it offers to open the existing task and warns before
   creating a second one from the same message.
5. **Given** a message that produced a task is later deleted, **When** the task is viewed,
   **Then** the origin block states the source message is no longer available and the
   channel link still works.
6. **Given** a task created from a message is later deleted, **When** the message is viewed,
   **Then** no chip is shown and no broken link is offered.
7. **Given** a user who cannot access the destination project, **When** they view a message
   that produced a task there, **Then** the chip is not shown to them.

---

### User Story 3 - The channel remembers where its tasks go (Priority: P3)

The first time someone creates a task from a given channel they choose the destination
project. That choice becomes the channel's remembered default, so every later conversion in
that channel is one confirmation with no project picking. Anyone who can administer the
channel can change or clear the remembered default, and any individual conversion can
override it for that task alone without changing the default.

**Why this priority**: This is the difference between a feature people use once and a
feature that becomes reflex. It is deliberately last because Story 1 works with an explicit
picker; the memory only removes taps.

**Independent Test**: Create a task from a channel with no remembered default, verify the
project picker is required; create a second one and verify the project is pre-filled and
the picker is collapsed; change the default and verify the third conversion follows the new
value.

**Acceptance Scenarios**:

1. **Given** a channel with no remembered destination, **When** the sheet opens, **Then**
   the project selector is shown expanded and confirmation is blocked until a project is
   chosen.
2. **Given** the user confirms a conversion in a channel with no remembered destination,
   **When** the task is created, **Then** the chosen project becomes that channel's
   remembered destination.
3. **Given** a channel with a remembered destination, **When** the sheet opens, **Then**
   that project is pre-selected and shown as a single collapsed line that can be expanded to
   change it.
4. **Given** a user overrides the project for one conversion, **When** the task is created,
   **Then** the task goes to the overridden project and the channel's remembered
   destination is unchanged.
5. **Given** a channel administrator, **When** they change the channel's remembered
   destination in channel settings, **Then** subsequent conversions in that channel default
   to the new project.
6. **Given** a channel whose remembered destination has been archived or deleted, or which
   the acting user cannot write to, **When** the sheet opens, **Then** the destination is
   treated as unset, the picker is shown expanded, and the reason is stated in one line.

---

### Edge Cases

- **No usable destination.** A user who is a member of no project they can create tasks in
  opens the action: the sheet must explain that in one line and offer no dead-end form.
- **Missing permission.** A user without the permission to create tasks must not see the
  action at all, rather than seeing it and being refused on confirm.
- **Direct messages.** A DM is a channel like any other for this purpose: the action is
  offered, the first conversion requires an explicit project, and that DM then remembers it.
  There is no shared "DM default" across different conversations.
- **Messages inside a task's own comment thread.** These channels already belong to a task.
  The destination defaults to that task's project, and the sheet offers to file the new
  task as a subtask of the task being discussed.
- **Concurrent conversion.** Two people convert the same message within seconds: both tasks
  are created (neither person's work is silently discarded), and the message carries a chip
  for each, capped at a small number with an overflow indicator.
- **Message content that makes a poor title.** A voice message, an attachment-only message,
  or an empty message body yields an empty title field with a placeholder rather than a
  nonsense title; the user must type one.
- **Very long messages.** The title is truncated at the title limit on a word boundary with
  the full message text preserved in the task's origin excerpt.
- **Formatted messages.** Bold, links, lists and code in the message become plain text in
  the title; the origin excerpt preserves the original formatting.
- **Attachments.** Files attached to the source message are *not* copied to the task; the
  origin link is how the assignee reaches them.
- **Archived channel.** The action is not offered in an archived channel.
- **Unsent message.** A message still queued for delivery offers no actions, including this
  one.
- **Offline confirmation.** Confirming without connectivity surfaces a failure the user can
  retry; it must not report success for a task that was never created.
- **Cross-organization safety.** A destination project must belong to the same organization
  as the source message; no path may offer or accept a project from another tenant.

## Requirements *(mandatory)*

### Functional Requirements

#### The action

- **FR-001**: The system MUST offer a "Create task" action on individual chat messages from
  the same action surface that already carries reply, react, edit and delete — the hover
  menu on web and the long-press sheet on mobile — so users find it where they already look.
- **FR-002**: The action MUST be offered only for messages of kind *text* or *voice* in a
  non-archived channel the user is a member of, and MUST NOT be offered for *system*
  messages or for messages that have not finished sending.
- **FR-003**: The action MUST NOT be offered to a user who lacks permission to create tasks
  in any project in their organization.
- **FR-004**: Choosing the action MUST open a quick-create surface in place, without
  navigating away from the conversation, and dismissing it MUST return the user to the same
  scroll position with nothing created.

#### What gets created

- **FR-005**: Confirming MUST create a task of kind *standard*. The system MUST NOT create,
  modify, or schedule any ritual definition or ritual instance through this feature, and
  MUST NOT allow the created task to be given ritual scheduling or evidence properties at
  creation time.
- **FR-006**: The created task MUST receive the project's default initial workflow state and
  a project-scoped task identifier, exactly as a task created through the existing task
  creation surface does.
- **FR-007**: The quick-create surface MUST expose exactly four editable inputs: title
  (required), destination project, assignee (optional, zero or one person), and due date
  (optional). Every other task attribute MUST take its normal default.
- **FR-008**: The surface MUST offer an escape to the full task creation experience that
  carries over all values already entered, so the quick path never becomes a ceiling.
- **FR-009**: The title MUST be pre-filled from the source message's text with formatting
  stripped, whitespace collapsed, and truncation at a word boundary when the text exceeds
  the title limit.
- **FR-010**: When the source message mentions exactly one person and that person is an
  employee in the organization, that person MUST be pre-selected as assignee; when it
  mentions zero or more than one, assignee MUST start empty.
- **FR-011**: Creation MUST be refused with an inline, field-level message when the title is
  empty or only whitespace, or when no destination project is selected.
- **FR-012**: Creation MUST be authorized as an ordinary task creation in the destination
  project — the same permission and project-membership checks — with no privilege granted by
  the fact that the request originated in chat.
- **FR-013**: The destination project MUST belong to the same organization as the source
  message, enforced on the server and not merely by what the client offers.

#### Destination routing

- **FR-014**: The system MUST resolve the default destination project when the sheet opens
  from the channel's remembered destination only. When the channel has none, no project is
  pre-selected, the picker is shown expanded, and confirmation is blocked until the user
  chooses. The system MUST NOT fall back to the user's last-used project or to the
  organization's default project — an unattended guess would file work in the wrong place
  silently, and the per-channel memory removes the cost after the first use.
- **FR-015**: The system MUST record the destination project chosen for a channel's first
  conversion as that channel's remembered destination, and MUST use it as the pre-selection
  for subsequent conversions in that channel.
- **FR-016**: Users MUST be able to override the destination for a single conversion without
  changing the channel's remembered destination.
- **FR-017**: Channel administrators MUST be able to view, change, and clear the channel's
  remembered destination from channel settings.
- **FR-018**: The system MUST treat a remembered destination as unset when the project has
  been archived or deleted, or when the acting user cannot create tasks in it, and MUST say
  so in one line rather than failing on confirm.

#### The link between message and task

- **FR-019**: The system MUST durably record, for each task created this way, the source
  channel and the source message, so that the relationship survives independently of the
  message text.
- **FR-020**: The task detail view MUST show an origin block containing the source channel
  name, the source message's author, an excerpt of the message, and a link that opens the
  conversation positioned on that message.
- **FR-021**: The source message MUST render a chip naming the resulting task's identifier
  and current state, visible to every viewer of the message who can access the task, and
  hidden from those who cannot.
- **FR-022**: The chip MUST navigate to the task detail view, and the origin link MUST
  navigate to the message, using the workspace's canonical link format so both directions
  work from web, mobile, notifications and pasted links.
- **FR-023**: When the source message is deleted, the task MUST survive and its origin block
  MUST state that the source message is unavailable while still linking to the channel.
- **FR-024**: When the task is deleted, the chip MUST disappear from the message and no
  broken link may remain.
- **FR-025**: When a user opens the action on a message that has already produced at least
  one task, the surface MUST show the existing task(s) and require a second, explicit
  confirmation before creating another from the same message.
- **FR-026**: Task discussion MUST remain on the task's own comment thread, and the system
  MUST NOT redirect task comments into the source channel.
- **FR-026a**: The task's comment thread MUST be created lazily, on first open of the task,
  not at conversion — matching how generated ritual instances behave. Conversion is cheap
  and frequent by design, and a thread created for a task nobody opens is a channel nobody
  reads.

#### Visibility and notifications

- **FR-027**: An assignee named at creation MUST receive the ordinary task-assignment
  notification, carrying the task identifier and title.
- **FR-028**: A successful conversion MUST post one reply on the source message's thread,
  attributed to the converting user, naming the created task's identifier and title and
  linking to it. It MUST NOT be posted as a channel-level message: the confirmation belongs
  next to the sentence it came from, not in the middle of the channel timeline.
- **FR-028a**: That reply MUST NOT generate reply or mention notifications for the source
  message's author or for thread participants. The conversion is already announced to the
  person it obliges through the assignment notification (FR-027); anyone else learns of it
  by reading the conversation.
- **FR-029**: The system MUST NOT notify the source message's author merely because their
  message was converted, unless they are the assignee.

#### Behaviour under failure

- **FR-030**: A failed creation MUST leave the sheet open with the entered values intact and
  a retry available, and MUST NOT report success.
- **FR-031**: A task creation and its message link MUST both succeed or both fail; a task
  MUST never exist showing no origin when it was created from a message.

### Key Entities

- **Standard task from chat**: An ordinary task in a project, distinguished only by carrying
  a reference to the conversation it came from. It has no recurrence, no evidence
  requirements, and no scheduled date; it participates in boards, search, assignment,
  analytics and the "my work" summary exactly like any other standard task.
- **Message → task origin link**: The durable record connecting one task to the one message
  that produced it: source channel, source message, and the moment of conversion. One
  message may have several such links (several tasks); each task has at most one.
- **Channel task destination**: A per-channel remembered project used to pre-select the
  destination for future conversions in that channel. Advisory only — it never grants access
  and never overrides an authorization check.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can turn a message into an assigned, dated task in under 10 seconds and
  no more than three interactions (open action, adjust, confirm), measured from opening the
  message action menu to the confirmation appearing.
- **SC-002**: In a channel with a remembered destination, creating a task from a message with
  no edits takes exactly two interactions.
- **SC-003**: 90% of first-time users complete a conversion successfully on their first
  attempt without opening the full task creation surface.
- **SC-004**: From an existing task created this way, a user reaches the originating message
  in the conversation in one interaction, and from the message reaches the task in one
  interaction.
- **SC-005**: Duplicate tasks created from the same message drop to near zero after the
  message chip ships, because the second person to open the action sees the existing task
  before creating another.
- **SC-006**: The share of recorded tasks that originate in conversation is measurable, and
  the total number of tasks created per active team increases after launch — the feature is
  meant to capture work that previously went unrecorded, not to relabel existing work.
- **SC-007**: Zero tasks created through this path are of ritual kind, and zero ritual
  definitions are created or modified by it.
- **SC-008**: No user can create a task in a project they could not already create tasks in,
  verified by authorization tests covering the chat entry point.

## Assumptions

- Tasks must belong to a project, because a task's identifier is derived from its project's
  key — so a destination project is unavoidable and the UX problem is minimising how often
  the user has to think about it. This is what Story 3 exists to solve.
- Every organization already has a default project created at registration, so no
  organization is structurally unable to receive a chat-created task.
- The existing message action surfaces (web hover menu, mobile long-press sheet) are the
  right place for this action; no new discovery affordance is introduced.
- Reusing the existing task creation path means chat-created tasks inherit workflow rules,
  custom field defaults, notifications, search indexing and analytics for free; nothing
  about them is special-cased downstream.
- Bulk conversion (selecting several messages, or converting a whole thread into one task)
  is out of scope for this feature. So is converting a task back into a message, and
  extracting tasks from message text automatically.
- Attachments on the source message stay with the message; the origin link is how the
  assignee reaches them.
- The origin excerpt is a snapshot for context. If the source message is later edited, the
  excerpt is not required to update, because the link to the live message is always present.
- Canonical resource links already support addressing a specific message inside a channel,
  so both directions of navigation are expressible without a new link format.
- Web and mobile ship the same capability; the interaction differs (hover menu versus
  long-press sheet) but the fields, defaults and rules are identical.
