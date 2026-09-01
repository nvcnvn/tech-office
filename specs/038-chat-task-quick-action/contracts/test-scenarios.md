# Behavioural Contract: Create a Task from a Chat Message

**This is the Principle II gate.** These scenarios are a planning artifact, not yet test
files. They must be reviewed and approved **before** `/speckit-tasks` runs and before any
implementation code is written. Approving this document approves what the feature is
required to do.

Scenario stubs land in `backend/integration/chat_task_capture_test.go` following the
`testWorld` pattern in `backend/integration/helper_test.go`, with `t.Skip("TODO: implement
after scenario review")` bodies and `// FR-XXX` comments for traceability.

---

## Backend integration — `backend/integration/chat_task_capture_test.go`

```go
func TestChatTaskCapture(t *testing.T) {
    w := newTestWorld(t)
    _ = w // scenarios only — implementation follows contract review
```

### User Story 1 — turning a message into a task

```text
when a member converts a message in a channel
  ├─ it creates a standard task in the chosen project                        FR-005
  ├─ the created task has no ritual definition, scheduled date or deadline   FR-005, SC-007
  ├─ it assigns the project's default initial workflow state                 FR-006
  ├─ it assigns a project-scoped identifier of the form KEY-n                FR-006
  ├─ it defaults the task level when the request names none                  FR-007 (D5)
  ├─ it records the converting member as the reporter                        FR-005
  ├─ it applies the named assignee and due date                              FR-007
  └─ it returns the task and the announcement message id                     FR-004

when the conversion request is malformed
  ├─ an empty title is refused and nothing is created                        FR-011
  ├─ a whitespace-only title is refused and nothing is created               FR-011
  └─ a missing project is refused and nothing is created                     FR-011

when the caller may not create the task
  ├─ a viewer on the destination project is refused                          FR-012
  ├─ a non-member of a private destination project is refused                FR-012
  ├─ a project in another organization is refused                            FR-013, SC-008
  └─ a non-member of a private source channel is refused                     FR-002

when the source message cannot be converted
  ├─ a system message is refused                                             FR-002
  └─ a soft-deleted message is refused                                       FR-002
```

### User Story 2 — the link between message and task

```text
when a task has been created from a message
  ├─ the task stores the source channel and source message together          FR-019
  ├─ GetTaskOrigin returns the channel name, author and excerpt              FR-020
  ├─ ListTasksBySourceMessages returns the link with live task state         FR-021
  ├─ one call resolves links for a whole page of message ids                 (N+1 guard)
  └─ a message converted twice returns both links                            FR-025

when the viewer cannot access the destination project
  └─ ListTasksBySourceMessages omits the link entirely                       FR-021, SC-008

when the source message is soft-deleted afterwards
  ├─ the task still exists with its origin intact                            FR-023
  └─ GetTaskOrigin reports the message as unavailable                        FR-023

when the task is deleted afterwards
  └─ ListTasksBySourceMessages returns no link for that message              FR-024

when the conversion is announced
  ├─ a system message is posted as a reply to the source message             FR-028
  ├─ the announcement carries the task id, identifier and title              FR-028
  ├─ the announcement is attributed to the converting member                 FR-028
  ├─ it produces no reply or mention notification for anyone                 FR-028a
  └─ the source message author is not notified of the conversion             FR-029

when an assignee is named at creation
  └─ the assignee receives the ordinary task-assignment notification         FR-027
```

### User Story 3 — the remembered destination

```text
when a channel has never had a task created from it
  ├─ GetChannelTaskDestination reports it unset with reason NEVER_SET        FR-014
  └─ no project is inferred from the caller's history or the org default     FR-014

when the first task is created from a channel
  └─ that project becomes the channel's remembered destination               FR-015

when a later conversion overrides the project
  ├─ the task is created in the overridden project                           FR-016
  └─ the channel's remembered destination is unchanged                       FR-016

when a channel administrator manages the destination
  ├─ they can set it                                                         FR-017
  ├─ they can clear it                                                       FR-017
  └─ a non-admin member is refused                                           FR-017

when the remembered destination is no longer usable
  ├─ an archived project reports unset with reason PROJECT_ARCHIVED          FR-018
  ├─ a deleted project reports unset with reason PROJECT_DELETED             FR-018
  ├─ a project the caller cannot write to reports unset with NO_ACCESS       FR-018
  └─ converting into it fails with a precondition detail naming the project  FR-018

when two channels are used
  └─ each remembers its own destination independently                        FR-015

when the channel is a direct message
  └─ it remembers its own destination like any other channel                 (edge case)
```

### Atomicity and failure

```text
when the announcement cannot be written
  └─ the task is not created either                                          FR-031

when task creation fails
  └─ no origin row, destination row or announcement survives                 FR-030, FR-031
```

### Regressions from D5 and D6 — existing suites, extended

```text
collaboration_task_test.go
  ├─ CreateTask with an explicit level_id behaves as before                  D5
  └─ CreateTask without a level_id selects the shallowest level              D5

workflow_task_lifecycle_test.go
  ├─ a standard task is created without a chat channel or document           D6
  ├─ opening it provisions both, once                                        D6
  └─ opening it twice does not create duplicates                             D6

collaboration_ritual_instance_test.go
  └─ ritual instances still provision resources on first open                D6 (no regression)

collaboration_constants_test.go
  └─ task_created_from_message matches across DB, Go and TypeScript          Principle VIII
```

---

## Web E2E — `frontend/apps/web/e2e/chat-task-capture.spec.ts`

```text
creating a task from a message
  ├─ the message hover menu offers Create task                               FR-001
  ├─ the dialog opens with the message text as the title, focused/selected   FR-009
  ├─ a single mentioned person is preselected as assignee                    FR-010
  ├─ the project picker is expanded on a channel with no remembered project  FR-014
  ├─ confirming creates the task and shows a confirmation naming it          FR-004
  ├─ the dialog closes and the conversation keeps its scroll position        FR-004
  └─ More options opens the full task form carrying entered values           FR-008

seeing the result
  ├─ a chip naming the task and its state appears on the message             FR-021
  ├─ the chip opens the task detail view                                     FR-022
  ├─ the announcement reply appears in the message's thread                  FR-028
  ├─ the task detail shows channel, author and excerpt                       FR-020
  └─ the origin link opens the channel highlighting the source message       FR-022

the remembered destination
  ├─ the second conversion in the channel pre-fills the project collapsed    FR-015, SC-002
  ├─ overriding the project does not change the remembered one               FR-016
  └─ a channel admin changes it in channel settings                          FR-017

refusals
  ├─ an empty title shows an inline field error and creates nothing          FR-011
  ├─ converting an already-converted message warns before proceeding         FR-025
  └─ a failed conversion keeps the dialog open with values intact            FR-030
```

## Mobile — `frontend/apps/mobile/.maestro/chat-task-capture.yaml`

```text
├─ long-pressing a message opens the action sheet with Create task           FR-001
├─ the bottom sheet opens with the title prefilled                           FR-009
├─ picking a project and confirming creates the task                         FR-004
├─ the chip appears on the message                                           FR-021
└─ tapping the chip opens the task detail with its origin block              FR-020, FR-022
```

Mobile does **not** cover FR-017 (setting a channel's destination): per constitution
principle XIII administrative configuration stays web-only. Mobile reads the destination and
can override it for a single conversion, which is day-to-day employee work.

---

## Deliberate exclusions from automated coverage

Constitution principle II requires any untested FR to be justified here.

| Requirement | Why excluded |
|---|---|
| **FR-003** — the action is hidden from a user with no task-create permission anywhere | Asserting the *absence* of a menu item across every permission shape is a combinatorial UI assertion with little value. The security property that matters — such a user cannot create a task — is covered server-side by the User Story 1 refusal scenarios and by SC-008. |
| **FR-009 truncation at a word boundary**, and the long-message and formatted-message edge cases | Pure string transformation with no I/O. Covered by a table-driven unit test on the title-derivation helper, which is cheaper and more exhaustive than an integration scenario; the constitution's "avoid unit tests" guidance targets tests that duplicate integration coverage, which this does not. |

Every other Functional Requirement and all three User Stories are traced above.

---

## Approval

- [ ] Reviewed and approved as the behavioural contract for feature 038 — required before `/speckit-tasks`.
