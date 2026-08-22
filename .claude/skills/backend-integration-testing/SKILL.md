---
name: backend-integration-testing
description: Write or refactor Go backend integration tests using the project's testWorld pattern. Use this skill when the user asks to create, rewrite, or improve integration tests for backend RPC services, database operations, or multi-tenant features. Covers test structure, naming conventions, helper design, and the arrange/act/assert pattern with nested t.Run.
---

This skill guides creation of high-quality Go integration tests for the Tech Office backend. Tests run against a live local server (`localhost:18080`) and a real PostgreSQL database — they are NOT unit tests with mocks.

## Core Philosophy

Tests should read like **behavior documentation**. A developer unfamiliar with the code should understand WHAT the feature does by reading test names alone, without reading the test body.

**Anti-pattern** (implementation-focused):
```go
func TestCreateProject(t *testing.T) { ... }
func TestCreateProjectPrivate(t *testing.T) { ... }
func TestArchiveProject(t *testing.T) { ... }
```

**Correct pattern** (behavior-focused):
```go
func TestProject(t *testing.T) {
    t.Run("when a project is created with defaults", func(t *testing.T) {
        t.Run("it has default task states (todo, in_progress, done)", ...)
        t.Run("the creator is automatically added as owner", ...)
    })
    t.Run("when archiving a project", func(t *testing.T) {
        t.Run("a non-owner cannot archive", ...)
        t.Run("the owner can archive the project", ...)
    })
}
```

## Test Structure: The testWorld Pattern

Every test file uses a shared `testWorld` struct defined in `helper_test.go`. This struct holds all RPC clients and provides **arrange** and **act** helpers so tests stay focused on assertions.

### Anatomy of a Test Function

```go
func TestFeatureName(t *testing.T) {
    // 1. Create a testWorld (initializes all RPC clients)
    w := newTestWorld(t)

    // 2. Arrange: create identities
    owner := w.withOwner()       // org owner
    emp := w.withEmployee()      // employee in same org

    // 3. Scenarios as nested t.Run
    t.Run("when <action or precondition>", func(t *testing.T) {
        // Act: use testWorld helpers
        result := w.someAction(owner, ...)

        // Assert: nested t.Run for each expectation
        t.Run("the result has property X", func(t *testing.T) {
            assert.Equal(t, expected, result.X)
        })

        t.Run("the result does not have property Y", func(t *testing.T) {
            assert.Empty(t, result.Y)
        })
    })
}
```

### Naming Conventions

| Level | Pattern | Example |
|-------|---------|---------|
| Top-level function | `TestFeatureDomain` | `TestProject`, `TestChatMessaging`, `TestNotificationLifecycle` |
| Scenario (outer `t.Run`) | `"when <action/precondition>"` | `"when a project is created with defaults"` |
| Expectation (inner `t.Run`) | `"<assertion in plain english>"` | `"the creator is automatically added as owner"` |
| Nested scenario | `"when <subsequent action>"` | `"when marked as read"` (nested inside `"when a notification is published"`) |

The output of `go test -v` should read like a spec:

```
=== RUN   TestProject
=== RUN   TestProject/when_a_project_is_created_with_defaults
=== RUN   TestProject/when_a_project_is_created_with_defaults/it_has_default_task_states_(todo,_in_progress,_done)
=== RUN   TestProject/when_a_project_is_created_with_defaults/the_creator_is_automatically_added_as_owner
=== RUN   TestProject/when_archiving_a_project
=== RUN   TestProject/when_archiving_a_project/a_non-owner_cannot_archive
=== RUN   TestProject/when_archiving_a_project/the_owner_can_archive_the_project
```

## Rules

### 1. One test function per feature domain, one file per feature domain

Group related scenarios into a single `TestXxx` function. Don't scatter related tests across multiple top-level functions.

- `TestProject` — all project CRUD, visibility, archive
- `TestTask` — creation, hierarchy, state transitions, assignees, filtering
- `TestNotificationLifecycle` — publish, list, mark-read, delete
- `TestMultiTenancy` — cross-org isolation for all features

### 2. Use testWorld helpers for ALL RPC interactions

Never construct `connect.NewRequest` or set headers directly in test functions. All RPC calls go through testWorld methods. This keeps tests readable and centralizes auth/setup boilerplate.

```go
// ✅ Correct: test focuses on WHAT, not HOW
proj := w.createProject(owner, "My Project", uniqueSlug("PROJ"))
members := w.listProjectMembers(owner, proj.ID)

// ❌ Wrong: raw RPC calls leak implementation into tests
req := connect.NewRequest(&rpcv1.CreateProjectRequest{Name: "My Project", Key: "PROJ"})
req.Header().Set("Authorization", "Bearer "+owner.Token)
resp, err := client.CreateProject(context.Background(), req)
```

### 3. Arrange helpers create identities, Act helpers perform operations

**Arrange** (identity setup):
- `w.withOwner()` — org owner identity
- `w.withEmployee()` — employee in the same org
- `w.withEmployees(n)` — n employees in the same org
- `w.withUsersFromDifferentOrgs()` — two users from different orgs (for multi-tenancy tests)

**Act** (operations that return results or assert internally):
- Named after the action: `createProject`, `sendMessage`, `uploadChannelFile`, `markAsRead`
- Error variants: `createTaskError`, `getProjectError` — return `error` instead of calling `require.NoError`
- These use `w.t.Helper()` to report failures at the caller's line

**Assert** (search/find helpers):
- Pure functions, not testWorld methods: `findNotification`, `findProject`, `stateByCategory`, `levelByDepth`
- Return `nil` when not found — let the caller `require.NotNil` or `assert.Nil`

### 4. Test error cases with connect error codes

```go
t.Run("a non-owner cannot archive", func(t *testing.T) {
    _, err := w.archiveProject(employee, proj.ID, true)
    require.Error(t, err)
    assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
})
```

### 5. Use `require` for preconditions, `assert` for verifications

- `require` — stops the test immediately if it fails (use for setup that must succeed)
- `assert` — records failure but continues (use for actual assertions)

```go
t.Run("when a task is created", func(t *testing.T) {
    level0 := levelByDepth(proj.Levels, 0)
    require.NotNil(t, level0)  // precondition: must have level 0

    task := w.createTask(owner, proj.ID, "Task", level0.Id)

    t.Run("it gets an auto-generated identifier", func(t *testing.T) {
        assert.NotEmpty(t, task.Id)                               // verification
        assert.True(t, strings.HasPrefix(task.Identifier, proj.Key+"-"))  // verification
    })
})
```

### 6. DB-direct tests use testWorld too

For tests that need direct database access (stale cleanup, delivery status, department counts), add helpers to testWorld:

```go
t.Run("when a connection has a stale heartbeat beyond 60s", func(t *testing.T) {
    staleConn := w.insertStaleConnection(owner.ID, 2*time.Minute, "stale-instance")
    freshConn := w.insertStaleConnection(owner.ID, 10*time.Second, "fresh-instance")
    w.cleanupStaleConnections(60 * time.Second)

    t.Run("the stale connection is removed", func(t *testing.T) {
        assert.False(t, w.connectionExists(staleConn))
    })
    t.Run("the fresh connection is preserved", func(t *testing.T) {
        assert.True(t, w.connectionExists(freshConn))
    })
})
```

### 7. Multi-tenancy tests are explicit

Dedicate a `TestMultiTenancy` function that uses `withUsersFromDifferentOrgs()` and verifies cross-org isolation for each feature (presence, push tokens, preferences, etc.).

### 8. Utility conventions

- `uniqueSlug(prefix)` — generates unique short IDs for project keys, channel names
- `ptr[T](v)` — generic pointer helper for optional proto fields
- `findXxx` functions — pure search helpers that return `nil` on not-found

## Adding a New testWorld Helper

When introducing a new RPC operation to tests:

1. Add the method to `helper_test.go` under the appropriate `// Act: <Domain>` section
2. Follow the signature pattern: `func (w *testWorld) verbNoun(actor testUser, ...params) returnType`
3. Always call `w.t.Helper()` as the first line
4. Use `require.NoError(w.t, err)` for the happy-path variant
5. Create an error variant (`verbNounError`) if tests need to assert on specific error codes
6. Keep the helper minimal — just the RPC call, auth header, and error check

```go
func (w *testWorld) createWidget(actor testUser, name string) *rpcv1.Widget {
    w.t.Helper()
    req := connect.NewRequest(&rpcv1.CreateWidgetRequest{Name: name})
    req.Header().Set("Authorization", "Bearer "+actor.Token)
    resp, err := w.widgetClient.CreateWidget(context.Background(), req)
    require.NoError(w.t, err)
    return resp.Msg.Widget
}

func (w *testWorld) createWidgetError(actor testUser, name string) error {
    w.t.Helper()
    req := connect.NewRequest(&rpcv1.CreateWidgetRequest{Name: name})
    req.Header().Set("Authorization", "Bearer "+actor.Token)
    _, err := w.widgetClient.CreateWidget(context.Background(), req)
    return err
}
```

## File Organization

```
backend/integration/
├── helper_test.go                    # testWorld, identity helpers, all act/assert helpers
├── collaboration_project_test.go     # TestProject
├── collaboration_task_test.go        # TestTask
├── collaboration_membership_test.go  # TestProjectMembership
├── collaboration_customfield_test.go # TestCustomField
├── collaboration_analytics_test.go   # TestTaskAnalytics
├── collaboration_constants_test.go   # TestConstantSync (DB/Go/Proto enum sync)
├── chat_messaging_test.go           # TestChatMessaging
├── notification_lifecycle_test.go    # TestNotificationLifecycle
├── notification_routing_test.go      # TestNotificationRouting
├── files_access_control_test.go      # TestFileAccessControl
├── files_batch_test.go              # TestFileMetadataBatch
├── files_search_test.go             # TestFileSearch
├── files_validation_test.go         # TestFileValidation
├── files_pdf_conversion_test.go     # TestPDFConversion
├── files_content_index_test.go      # TestContentIndexing
├── docs_crud_test.go               # TestDocumentCRUD
├── docs_version_test.go            # TestDocumentVersion
├── docs_diff_test.go               # TestDocumentDiff
├── presence_status_test.go          # TestPresenceStatus
├── push_token_test.go              # TestPushToken
├── preference_test.go              # TestPreference
├── department_test.go              # TestDepartment
├── organization_onboarding_test.go  # TestOrganizationOnboarding
├── stale_cleanup_test.go           # TestStaleConnectionCleanup
└── multi_tenancy_test.go           # TestMultiTenancy
```

Naming convention: `<domain>_<feature>_test.go` → `Test<Feature>`.

## Checklist Before Submitting

1. `go vet ./integration/` passes cleanly
2. No raw `connect.NewRequest` in test functions — all calls go through testWorld
3. Every outer `t.Run` starts with `"when ..."`
4. Every inner `t.Run` describes the expected outcome, not the action
5. `require` for preconditions, `assert` for verifications
6. Proto field names verified against `.pb.go` files (not guessed)
7. No unused imports
8. Error code assertions use `connect.CodeOf(err)` with specific codes
9. Multi-tenancy scenarios use `withUsersFromDifferentOrgs()`
10. New helpers follow the `verbNoun(actor, ...params)` signature pattern
