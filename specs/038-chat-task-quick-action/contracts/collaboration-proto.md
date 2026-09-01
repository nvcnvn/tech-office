# Contract: `rpc/v1/collaboration.proto` delta

Four new RPCs on `CollaborationService`, two new fields on `Task`, one existing field made
optional. Every RPC declares `required_permissions`, as constitution principle III requires.

---

## Changed: `CreateTaskRequest.level_id` becomes optional

```proto
message CreateTaskRequest {
  string project_id = 1;
  string title = 2;
  optional string level_id = 3;  // CHANGED: absent selects the project's shallowest level
  // ... fields 4-14 unchanged
}
```

Breaking at the contract level; every existing caller keeps compiling and keeps sending its
explicit level. See D5 in [research.md](../research.md) — the field is currently parsed with
`dbuuid.MustParse`, which panics on an empty string, so the absent case must be handled in
`CreateTask` before anything else in this feature works.

---

## Changed: `Task` gains the origin reference

```proto
message Task {
  // ... fields 1-27 unchanged
  optional string source_channel_id = 28;
  optional string source_message_id = 29;
}
```

Identifiers only. The human-readable origin (channel name, author, excerpt) needs a call into
chat and is served by `GetTaskOrigin`, so that `GetTask` stays a single-domain read.

---

## New: `CreateTaskFromMessage`

```proto
rpc CreateTaskFromMessage(CreateTaskFromMessageRequest)
    returns (CreateTaskFromMessageResponse) {
  option (rpc.v1.auth) = { required_permissions: ["collab.createTask"] };
}

message CreateTaskFromMessageRequest {
  string source_channel_id = 1;
  string source_message_id = 2;
  string project_id = 3;
  string title = 4;
  optional string assignee_employee_id = 5;
  optional string due_date = 6;        // ISO date, "2026-09-04"
  optional string parent_task_id = 7;  // subtask of the discussed task, in a task comment thread
}

message CreateTaskFromMessageResponse {
  Task task = 1;
  string announcement_message_id = 2;  // the threaded system reply posted on the source message
}
```

**Notably absent**: `task_kind`, `ritual_definition_id`, `scheduled_date`,
`completion_deadline`, `level_id`, `state_id`, `custom_fields`. FR-005 is satisfied
structurally — there is no field through which this path could produce a ritual — and FR-007's
four-field limit is enforced by the message shape rather than by validation.

**Also absent**: any flag about remembering the destination. The server records the channel's
destination only when none exists (`ON CONFLICT DO NOTHING`), which satisfies FR-015 and
FR-016 together without a client deciding.

**Behaviour**: one transaction — create the task (via the existing `CreateTask` logic, so
workflow rules, notifications, search indexing and analytics all apply unchanged), write the
origin columns, upsert the channel destination if absent, post the announcement through
`ChatLogic`.

**Errors**:

| Condition | Code | Detail |
|---|---|---|
| Title empty after trimming | `InvalidArgument` | `BadRequest` naming the `title` field |
| Destination archived, deleted, or not writable by the caller | `FailedPrecondition` | `PreconditionFailure` naming the project, so the sheet reopens the picker rather than showing a dead end (FR-018) |
| Caller is a `viewer` on the project, or not a member of a private one | `PermissionDenied` | — |
| Source message not readable, `system` kind, or soft-deleted | `FailedPrecondition` | — |
| Project belongs to another organization | `PermissionDenied` | — |

---

## New: `ListTasksBySourceMessages`

```proto
rpc ListTasksBySourceMessages(ListTasksBySourceMessagesRequest)
    returns (ListTasksBySourceMessagesResponse) {
  option (rpc.v1.auth) = { required_permissions: ["collab.viewTask"] };
}

message ListTasksBySourceMessagesRequest {
  repeated string message_ids = 1;  // one call per rendered page of messages, max 200
}

message ListTasksBySourceMessagesResponse {
  repeated MessageTaskLink links = 1;
}

message MessageTaskLink {
  string source_message_id = 1;
  string task_id = 2;
  string identifier = 3;      // "PROJ-12"
  string title = 4;
  string project_id = 5;
  string state_name = 6;
  StateCategory state_category = 7;
}
```

Backs the chip (FR-021). The repeated request field is the contract-level guarantee against
an N+1: a per-message implementation is visibly wrong against this shape.

Links to tasks in projects the caller cannot access are **omitted from the response**, not
returned with a flag — FR-021 requires the chip to be invisible, and a flagged entry would
leak the identifier. A message with several tasks returns several links; the client caps what
it renders and shows an overflow indicator.

---

## New: `GetTaskOrigin`

```proto
rpc GetTaskOrigin(GetTaskOriginRequest) returns (GetTaskOriginResponse) {
  option (rpc.v1.auth) = { required_permissions: ["collab.viewTask"] };
}

message GetTaskOriginRequest {
  string task_id = 1;
}

message GetTaskOriginResponse {
  bool has_origin = 1;
  string source_channel_id = 2;
  string channel_display_name = 3;
  string source_message_id = 4;
  string author_display_name = 5;
  string excerpt_html = 6;         // sanitized HTML, as stored by chat
  bool source_message_available = 7; // false once the message is soft-deleted (FR-023)
}
```

Separate from `GetTask` so the ordinary task read stays a single-domain query; the client
calls it only when `Task.source_message_id` is set. Implemented by calling
`ChatLogic.GetMessage` — the same method `internal/compliance` already uses to resolve a
reported message's author and snapshot.

---

## New: `GetChannelTaskDestination` / `SetChannelTaskDestination`

```proto
rpc GetChannelTaskDestination(GetChannelTaskDestinationRequest)
    returns (GetChannelTaskDestinationResponse) {
  option (rpc.v1.auth) = { required_permissions: ["collab.viewProject"] };
}

rpc SetChannelTaskDestination(SetChannelTaskDestinationRequest)
    returns (SetChannelTaskDestinationResponse) {
  option (rpc.v1.auth) = { required_permissions: ["collab.createTask"] };
}

message GetChannelTaskDestinationRequest { string channel_id = 1; }

message GetChannelTaskDestinationResponse {
  bool is_set = 1;                     // false when unset, archived, deleted, or not writable
  string project_id = 2;
  string project_name = 3;
  string project_key = 4;
  ChannelDestinationUnsetReason unset_reason = 5;
}

enum ChannelDestinationUnsetReason {
  CHANNEL_DESTINATION_UNSET_REASON_UNSPECIFIED = 0;
  CHANNEL_DESTINATION_UNSET_REASON_NEVER_SET = 1;
  CHANNEL_DESTINATION_UNSET_REASON_PROJECT_ARCHIVED = 2;
  CHANNEL_DESTINATION_UNSET_REASON_PROJECT_DELETED = 3;
  CHANNEL_DESTINATION_UNSET_REASON_NO_ACCESS = 4;
}

message SetChannelTaskDestinationRequest {
  string channel_id = 1;
  optional string project_id = 2;  // absent clears the remembered destination
}

message SetChannelTaskDestinationResponse {
  GetChannelTaskDestinationResponse destination = 1;
}
```

`unset_reason` is a proto enum rather than a string, so the one-line explanation FR-018
requires is a client-side lookup with no cross-stack string to keep in sync.

`SetChannelTaskDestination` additionally requires the caller to be a **channel admin**. That
is a resource check in the logic layer on top of the interceptor's permission check —
the same shape as ritual definition management, which requires `admin`/`owner` on the project
above the `collab.manageRitualDefinition` permission. Per constitution principle XIII this
administrative surface is **web-only**; mobile reads the destination but does not set it.

---

## Frontend wrappers

Added to `frontend/packages/apis/src/collaboration.ts` with hand-written input/output
interfaces and native types (`Date`, not protobuf `Timestamp`), per constitution principle
VII. Applications import from `apis`; no app imports from `rpc`.

```ts
createTaskFromMessage(params: CreateTaskFromMessageParams): Promise<{ task: Task; announcementMessageId: string }>
listTasksBySourceMessages(messageIds: string[]): Promise<MessageTaskLink[]>
getTaskOrigin(taskId: string): Promise<TaskOrigin>
getChannelTaskDestination(channelId: string): Promise<ChannelTaskDestination>
setChannelTaskDestination(channelId: string, projectId?: string): Promise<ChannelTaskDestination>
```
