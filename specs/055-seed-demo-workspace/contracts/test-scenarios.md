# Behavioural contract: scenario stubs

**Branch**: `055-seed-demo-workspace` | Constitution Principle II (Scenario-as-Contract)

These are the `t.Run` names that constitute the behavioural contract for this feature. They
extend the existing `TestDemoSeed` in `backend/integration/demo_seed_test.go`, which already
drives the command as a subprocess and asserts idempotency and the permanent PIN. No new
test file is needed: the subject under test is the same command.

The one new file is `backend/integration/demo_seed_deletion_test.go`, which needs a Connect
client rather than a subprocess and so belongs beside the other `testWorld` suites.

---

## `backend/integration/demo_seed_test.go` — extends `TestDemoSeed`

```go
// FR-001, FR-003: User Story 1 — the workspace has two deletable owners
t.Run("when the seed runs for the first time", func(t *testing.T) {
    t.Run("it creates two owner accounts", ...)
    t.Run("both owner accounts are self-registered, not admin-provisioned", ...)
    t.Run("the admin-provisioned worker is still the only org-managed account", ...)

    // FR-021: the printed credentials
    t.Run("it prints three credentials, primary first and the spare marked for deletion", ...)

    // FR-009, FR-010, FR-012: User Story 2 — work items
    t.Run("it creates six work items across two open workflow states", ...)
    t.Run("every sign-in credential has at least one work item assigned to it", ...)
    t.Run("at least one assigned item is past its due date and at least one is due today", ...)

    // FR-013, FR-014, FR-016: the recurring job
    t.Run("it creates one recurring job with exactly two instances", ...)
    t.Run("the late instance is in an overdue state and is assigned to the worker", ...)
    t.Run("the unassigned instance is scheduled for today and has no assignee", ...)
    t.Run("the unassigned instance is in a state that is neither overdue nor closed", ...)
})

// FR-015, FR-017: User Story 3 — the seeded shape survives the sweeps
t.Run("when the background sweeps run against the seeded workspace", func(t *testing.T) {
    t.Run("the late instance is still overdue rather than written off as missed", ...)
    t.Run("the generation sweep creates no further instances", ...)
})

// FR-019, FR-020: User Story 3 — re-running
t.Run("when the seed runs again", func(t *testing.T) {
    t.Run("it leaves exactly one copy of each work item and each instance", ...)
    t.Run("it leaves exactly two owner accounts rather than a third", ...)
    t.Run("the unassigned instance is dated for the current day", ...)
    t.Run("the late instance is still dated so that it reads as late", ...)
})

// FR-018: the loud failure
t.Run("when a demo project is missing a workflow state the seed needs", func(t *testing.T) {
    t.Run("the command fails naming the project and the missing category", ...)
})
```

## `backend/integration/demo_seed_deletion_test.go` — new

```go
// FR-004, FR-005: User Story 1 — the deletion a reviewer is asked to perform
func TestDemoSeedAccountDeletion(t *testing.T) {
    t.Run("when the nominated spare owner requests deletion of their own account", func(t *testing.T) {
        t.Run("the request is accepted rather than refused as sole owner", ...)      // FR-004
        t.Run("the deletion preview names no blocking workspace", ...)               // FR-004
        t.Run("their sessions are invalidated", ...)                                 // US1
    })

    t.Run("after the spare owner has been deleted", func(t *testing.T) {
        t.Run("the primary owner credential still signs in", ...)                    // FR-005
        t.Run("the worker PIN still signs in", ...)                                  // FR-005
        t.Run("the workspace still has at least one owner", ...)                     // FR-005
        t.Run("the conversation, the work items and the instances are all still there", ...) // FR-005
    })

    // FR-007: the other account-ending path is untouched
    t.Run("when the admin-provisioned worker asks to end their account", func(t *testing.T) {
        t.Run("they are offered the removal-request path rather than deletion", ...)
    })

    // FR-006: the demonstration is repeatable
    t.Run("when the seed runs again after the deletion", func(t *testing.T) {
        t.Run("the spare owner credential signs in once more", ...)
        t.Run("the deletion can be performed a second time", ...)
    })

    // Edge case from the spec: both owners deleted
    t.Run("when the second owner then tries to delete too", func(t *testing.T) {
        t.Run("the sole-owner guard refuses, unchanged by this feature", ...)
    })
}
```

---

## Scenarios deliberately excluded, with justification

| Requirement | Excluded from | Why |
|---|---|---|
| FR-002, FR-008, FR-021 (prose) | E2E and Maestro | These are assertions about a markdown document and a stdout block. FR-021's ordering is covered by an integration assertion on the command's output; FR-002 and FR-008 are covered by a documentation review task, because no automated check can tell a clear instruction from an unclear one. |
| FR-011, FR-013, SC-003, SC-004 | Maestro | This feature adds no mobile UI. The screens that read the seeded rows — Today and My Work — already carry Maestro coverage under `frontend/apps/mobile/.maestro/tasks/` and `rituals/`. A flow that asserted against the demo workspace's contents would bind the mobile suite to a fixture it does not own. The observable outcome is verified instead by the integration assertions on the predicates those screens use (`GetAssignedWorkSummary`, `GetTeamAttentionSummary`), and by the manual pass in [quickstart.md](../quickstart.md). |
| All | Web E2E (Playwright) | No web surface changes. The seeded rows flow into existing, already-covered web screens. |

This exclusion is the one Principle II requires to be written down and agreed during
planning.
