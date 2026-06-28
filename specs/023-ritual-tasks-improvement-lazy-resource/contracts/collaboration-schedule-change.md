# API Contracts: Ritual Tasks — Lazy Resource Creation & Schedule Change Handling

**Feature**: 023-ritual-tasks-improvement-lazy-resource  
**Proto file**: `backend/rpc/v1/collaboration.proto`  
**Target location for new RPCs**: after the existing `SkipRitualInstance` RPC (within `// Ritual Instance Operations` section)

---

## New RPCs (Additions to CollaborationService)

```proto
// -------------------------------------------------------------------------
// Ritual Schedule Change (with impact preview and atomic apply)
// -------------------------------------------------------------------------

// GetScheduleChangeImpact returns a preview of how many instances would be
// affected before the caller applies a schedule change. Read-only — no mutation.
// Required: caller must be the ritual definition creator or a project admin.
rpc GetScheduleChangeImpact(GetScheduleChangeImpactRequest) returns (GetScheduleChangeImpactResponse) {
  option (rpc.v1.access_control) = {
    required_permissions: ["collab.manageRitualDefinition"]
  };
}

// ChangeRitualDefinitionSchedule applies a recurrence pattern change atomically:
// 1. Soft-deletes future untouched instances (scheduled state, no channel, no evidence)
// 2. Detaches future touched instances (converts to standard tasks)
// 3. Updates the recurrence rule and increments schedule_version
// 4. Regenerates new instances using the updated pattern
// Required: caller must be the ritual definition creator or a project admin.
rpc ChangeRitualDefinitionSchedule(ChangeRitualDefinitionScheduleRequest) returns (ChangeRitualDefinitionScheduleResponse) {
  option (rpc.v1.access_control) = {
    required_permissions: ["collab.manageRitualDefinition"]
  };
}
```

---

## New Messages

```proto
// -------------------------------------------------------------------------
// GetScheduleChangeImpact
// -------------------------------------------------------------------------

message GetScheduleChangeImpactRequest {
  // ID of the ritual definition whose recurrence pattern would change.
  string ritual_definition_id = 1;

  // The proposed new recurrence rule. Must be valid; server validates it
  // before computing impact counts.
  RecurrenceRule new_recurrence_rule = 2;
}

message GetScheduleChangeImpactResponse {
  // Number of future instances that would be soft-deleted (untouched:
  // scheduled state, no channel, no evidence submissions).
  int32 instances_to_remove = 1;

  // Number of future instances that would be converted to standalone tasks
  // (touched: any interaction has occurred — channel created, state changed,
  // or evidence submitted).
  int32 instances_to_detach = 2;

  // Estimated number of new instances that would be generated using the
  // new recurrence rule over the standard generation window.
  int32 instances_to_create = 3;
}

// -------------------------------------------------------------------------
// ChangeRitualDefinitionSchedule
// -------------------------------------------------------------------------

message ChangeRitualDefinitionScheduleRequest {
  // ID of the ritual definition to update.
  string ritual_definition_id = 1;

  // The new recurrence rule to apply.
  RecurrenceRule new_recurrence_rule = 2;

  // Caller must set this to true after viewing the GetScheduleChangeImpact
  // response. The server rejects requests with confirmed = false.
  // This prevents accidental schedule changes without user acknowledgment.
  bool confirmed = 3;
}

message ChangeRitualDefinitionScheduleResponse {
  // The updated ritual definition (with new recurrence_rule and incremented
  // schedule_version).
  RitualDefinition ritual_definition = 1;

  // Actual number of instances that were soft-deleted.
  int32 instances_removed = 2;

  // Actual number of instances that were converted to standalone tasks.
  int32 instances_detached = 3;

  // Number of new instances generated using the new pattern.
  int32 instances_created = 4;
}
```

---

## Modified Messages

### `RitualDefinition` — add `schedule_version` field

**Current last field**: `google.protobuf.Timestamp updated_at = 12;`

**Addition** (append field 13):

```proto
message RitualDefinition {
  string id = 1;
  string project_id = 2;
  string name = 3;
  string description = 4;
  RecurrenceRule recurrence_rule = 5;
  int32 completion_window_hours = 6;
  string timezone = 7;
  bool is_archived = 8;
  string created_by_employee_id = 9;
  repeated string default_assignee_ids = 10;
  repeated EvidenceRequirementDetail evidence_requirements = 11;
  google.protobuf.Timestamp updated_at = 12;
  // Monotonically incremented each time the recurrence_rule changes.
  // Used for audit: distinguishes "missed because schedule changed" from
  // "missed because nobody did the work."
  int32 schedule_version = 13;                                        // NEW
}
```

### `Task` — add `detached_from_ritual` field

Find the `Task` message and add after the existing ritual fields (`ritual_definition_id`, `scheduled_date`, `completion_deadline`, `skip_reason`):

```proto
// True if this task was originally a ritual instance but was detached from its
// definition when the schedule changed. The task is now a standalone standard
// task. The deadline is advisory-only (no automatic overdue transitions).
bool detached_from_ritual = XX;   // NEW — use next available field number
```

---

## Frontend API Wrapper Contracts

**File**: `frontend/packages/apis/src/collaboration.ts`

```typescript
// --- Schedule Change Impact Preview ---

export interface GetScheduleChangeImpactParams {
  ritualDefinitionId: string;
  newRecurrenceRule: RecurrenceRule;
}

export interface ScheduleChangeImpact {
  instancesToRemove: number;  // will be soft-deleted (untouched)
  instancesToDetach: number;  // will become standalone tasks (touched)
  instancesToCreate: number;  // will be generated fresh
}

export async function getScheduleChangeImpact(
  params: GetScheduleChangeImpactParams
): Promise<ScheduleChangeImpact> {
  return rpcCall(async () => {
    const resp = await collaborationClient.getScheduleChangeImpact({
      ritualDefinitionId: params.ritualDefinitionId,
      newRecurrenceRule: toProtoRecurrenceRule(params.newRecurrenceRule),
    });
    return {
      instancesToRemove: resp.instancesToRemove,
      instancesToDetach: resp.instancesToDetach,
      instancesToCreate: resp.instancesToCreate,
    };
  });
}

// --- Apply Schedule Change ---

export interface ChangeRitualDefinitionScheduleParams {
  ritualDefinitionId: string;
  newRecurrenceRule: RecurrenceRule;
  confirmed: boolean;  // must be true; caller shows confirmation dialog first
}

export interface ScheduleChangeResult {
  ritualDefinition: RitualDefinition;
  instancesRemoved: number;
  instancesDetached: number;
  instancesCreated: number;
}

export async function changeRitualDefinitionSchedule(
  params: ChangeRitualDefinitionScheduleParams
): Promise<ScheduleChangeResult> {
  return rpcCall(async () => {
    const resp = await collaborationClient.changeRitualDefinitionSchedule({
      ritualDefinitionId: params.ritualDefinitionId,
      newRecurrenceRule: toProtoRecurrenceRule(params.newRecurrenceRule),
      confirmed: params.confirmed,
    });
    return {
      ritualDefinition: toRitualDefinition(resp.ritualDefinition!),
      instancesRemoved: resp.instancesRemoved,
      instancesDetached: resp.instancesDetached,
      instancesCreated: resp.instancesCreated,
    };
  });
}
```

---

## Access Control Notes

Both new RPCs use `required_permissions: ["collab.manageRitualDefinition"]` at the proto level (same as existing ritual RPCs). **Business rule enforcement** (must be creator OR project admin) lives in the **logic layer**, not the proto:

```go
// In ritual_logic.go — ChangeRitualDefinitionSchedule:
def, err := l.Queries.GetRitualDefinition(ctx, tx, ...)
isCreator := def.CreatedByEmployeeID == employeeID
role, _ := l.GetProjectMemberRole(ctx, tx, orgID, def.ProjectID, employeeID)
isAdmin := role == ProjectMemberRoleAdmin || role == ProjectMemberRoleOwner
if !isCreator && !isAdmin {
    return nil, ErrAccessDenied
}
```

---

## Error Contracts

| Scenario | Connect Code | Description |
|----------|-------------|-------------|
| `confirmed = false` in `ChangeRitualDefinitionSchedule` | `codes.FailedPrecondition` | Client must show impact preview first |
| Caller is not creator or project admin | `codes.PermissionDenied` | Maps to `ErrAccessDenied` |
| Ritual definition not found | `codes.NotFound` | Maps to `ErrRitualDefinitionNotFound` |
| Invalid recurrence rule | `codes.InvalidArgument` | Server validates rule before impact count |
