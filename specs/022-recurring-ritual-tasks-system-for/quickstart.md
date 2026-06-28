# Quickstart — Ritual Tasks Test Scenarios

**Phase 1 Output** | **Branch**: `022-recurring-ritual-tasks-system-for`

---

## Integration Test Scenarios

These scenarios map to the spec's acceptance criteria and should be composed as `t.Run` stubs in `backend/integration/` before implementation begins.

---

### File: `collaboration_ritual_test.go`

#### TestRitualDefinitionCRUD

```
when a project admin creates a ritual definition
  it creates the definition with recurrence schedule and evidence requirements
  it auto-creates default assignees from the request
  it returns the full ritual definition with evidence requirements

when getting a ritual definition
  it returns the definition with all evidence requirements and assignees

when updating a ritual definition name and schedule
  it updates only the specified fields (COALESCE partial update)
  it does not affect existing generated instances

when archiving a ritual definition
  it stops generating new instances
  it preserves all historical instances
  it appears in list when include_archived is true
  it does not appear in list when include_archived is false

when listing ritual definitions for a project
  it returns only non-archived definitions by default
  it returns all definitions when include_archived is true
```

#### TestRitualDefinitionPermissions

```
when a project viewer tries to create a ritual definition
  it returns permission denied

when a project member (non-admin) tries to create a ritual definition
  it returns permission denied

when a project admin creates a ritual definition
  it succeeds

when a project owner creates a ritual definition
  it succeeds
```

---

### File: `collaboration_evidence_test.go`

#### TestEvidenceRequirementCRUD

```
when creating evidence requirements for a ritual definition
  it creates requirements with correct types and approval modes
  it assigns sequential positions

when updating an evidence requirement
  it updates only the specified fields

when deleting an evidence requirement
  it removes the requirement
  it does not affect existing submissions against this requirement (restrict)

when listing evidence requirements
  it returns requirements ordered by position
```

#### TestEvidenceSubmission

```
when a worker submits text evidence for a ritual instance
  it creates the submission with pending_review status
  it records the server timestamp

when a worker submits photo evidence with GPS coordinates
  it stores device timestamp, GPS coordinates, and accuracy
  it records both device and server timestamps

when a worker submits evidence for an auto-approve requirement within GPS geofence
  it auto-approves the submission immediately

when a worker submits evidence for an auto-approve requirement outside GPS geofence
  it keeps the submission in pending_review status for manual fallback

when an unassigned worker submits evidence (shift coverage)
  it accepts the evidence with the actual submitter identity
  it routes to manual approval regardless of approval mode

when a reviewer approves evidence
  it sets the approval status to approved
  it records the reviewer and timestamp
  it notifies the submitter

when a reviewer rejects evidence with a comment
  it sets the approval status to rejected
  it records the reviewer comment
  it notifies the submitter
  it sets the ritual instance state back to in_progress

when all required evidence is submitted and approved
  the ritual instance can transition to verified state
```

#### TestEvidenceFileUpload

```
when requesting an evidence file upload
  it returns a presigned URL and file ID

when confirming an evidence file upload
  it links the file to the evidence submission
  it triggers file validation workflow
```

---

### File: `collaboration_ritual_instance_test.go`

#### TestRitualInstanceGeneration

```
when a ritual definition exists with daily recurrence
  instances are generated for the configured window (30 days ahead)
  each instance has the correct scheduled_date and completion_deadline
  instances have task_kind = ritual_instance
  instances are auto-assigned to the definition's default assignees
  instances get auto-created chat channels and description documents

when generating instances for a definition that already has instances
  it does not create duplicate instances (idempotency via unique constraint)
  it only creates instances for dates not yet generated

when a ritual definition is archived
  no new instances are generated after archival
```

#### TestRitualInstanceLifecycle

```
when a ritual instance is created (scheduled)
  it starts in the scheduled state

when the completion window opens
  the instance transitions to open state

when a worker starts submitting evidence
  the instance transitions to in_progress state

when all evidence is submitted
  the instance transitions to submitted state

when all evidence is approved
  the instance transitions to verified state (terminal)

when the completion deadline passes without all evidence
  the instance transitions to overdue state
  the assignee and manager are notified

when the grace period expires
  the instance transitions to missed state (terminal)
  it remains as a permanent compliance gap record

when an admin skips an instance with a reason
  the instance transitions to skipped state (terminal)
  the skip reason is recorded
```

#### TestRitualInstanceTodayView

```
when an employee has ritual instances due today
  they appear sorted: overdue first, then closest deadline, then upcoming

when an employee has no ritual instances due today
  the list is empty

when filtering by project
  it only shows instances from that project
```

---

### File: `collaboration_health_test.go`

#### TestOperationalHealth

```
when a project has ritual instances in various states
  the health summary shows correct counts for each status
  the completion rate is correctly calculated
  the on_time_rate is correctly calculated

when getting health per ritual definition
  it groups metrics by definition
  it calculates health scores per ritual

when getting employee compliance summary
  it shows per-employee metrics (on_time, late, missed)
  it correctly distinguishes on_time vs late completions
  it filters by date range

when filtering health by date range
  it only includes instances within the specified range
```

#### TestHealthDashboardCSVExport

```
when exporting ritual compliance data to CSV
  it includes all instance records with status and evidence details
  it includes employee names and dates
```

---

### File: `collaboration_project_test.go` (extend existing)

#### TestProjectCollaborationMode (add to existing project tests)

```
when creating a project with ritual mode
  it sets collaboration_mode to ritual
  it auto-creates ritual-specific states (Scheduled, Open, Submitted, Verified, etc.)

when creating a project with mixed mode
  it creates both standard and ritual states

when creating a project with standard mode (default)
  it creates only standard states (backward compatible)

when changing project mode from standard to mixed
  it adds ritual states without affecting existing tasks or states

when creating a ritual definition in a standard-mode project
  it succeeds (mode is UI hint, not gate)
```

---

### File: `collaboration_task_test.go` (extend existing)

#### TestTaskKindFiltering (add to existing task tests)

```
when listing tasks without task_kind filter
  it returns both standard and ritual instance tasks

when listing tasks with task_kind = standard
  it returns only standard tasks

when listing tasks with task_kind = ritual_instance
  it returns only ritual instances
```

---

### File: `collaboration_ritual_notification_test.go`

#### TestRitualNotifications

```
when a ritual instance is generated and assigned
  the assignee receives a ritual.instance_assigned notification

when evidence is submitted for review
  the project admin receives a ritual.evidence_submitted notification

when evidence is approved
  the submitter receives a ritual.evidence_approved notification

when evidence is rejected
  the submitter receives a ritual.evidence_rejected notification

when a ritual instance becomes overdue
  the assignee and manager receive ritual.instance_overdue notifications

when a ritual instance is missed
  the manager receives a ritual.instance_missed notification
```

---

## Manual Frontend Test Scenarios

These are for manual testing of the frontend UI (no automated frontend tests per constitution):

1. **Project creation with mode selection**: Create projects in all 3 modes, verify correct default states
2. **Ritual definition creation flow**: Create a ritual with recurrence schedule and evidence requirements
3. **Today view**: Verify ritual instances appear sorted by urgency for the assigned worker
4. **Evidence submission**: Submit different evidence types (photo, text, GPS), verify stored correctly
5. **Evidence review flow**: Approve/reject evidence, verify state transitions
6. **Kanban board with mixed tasks**: Verify both standard and ritual tasks appear on the board
7. **Health dashboard**: Verify correct metrics, drill-down by ritual and employee
8. **CSV export**: Export compliance data and verify contents
9. **Dark/Light mode**: Verify all new components use theme colors
