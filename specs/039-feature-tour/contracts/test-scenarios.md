# Behavioural Contract: Feature Tour

Constitution II, Scenario-as-Contract. **These scenarios must be reviewed and approved before
`/speckit-tasks` runs and before any code is written.** They are the agreement about what the
feature does; the test files are their implementation.

Every User Story and every user-observable Functional Requirement below is traceable to at
least one scenario. Requirements excluded from a layer are listed with a reason at the end.

## Backend — `backend/integration/feature_tour_test.go`

`testWorld` pattern, `withOwner()` for the administrator and `withEmployee()` for the worker,
matching `preference_test.go`.

```go
// TestFeatureTour covers audience selection, permission filtering, platform adaptation,
// progress persistence and the offer rule.
func TestFeatureTour(t *testing.T) {
    // US1, FR-002 — the tour a person gets is decided by their permissions
    t.Run("when an owner asks for their tour", func(t *testing.T) {
        t.Run("they are served the administrator tour")                          // FR-001, FR-002
        t.Run("its stops are people, project, ritual, chat, schedule, docs in that order") // FR-003
        t.Run("it has no more than six stops")                                   // FR-005
    })

    // US2, FR-002 — the same call from a worker returns the other tour
    t.Run("when an employee asks for their tour", func(t *testing.T) {
        t.Run("they are served the worker tour, not the administrator tour")     // FR-001, FR-002
        t.Run("its stops are today, evidence, chat, alerts in that order")       // FR-004
        t.Run("no stop mentions a capability the employee cannot use")           // FR-006
    })

    // FR-006 — filtering removes stops rather than disabling them
    t.Run("when a person lacks the permission a stop requires", func(t *testing.T) {
        t.Run("the stop is absent from the returned list entirely")              // FR-006
        t.Run("the remaining stops are renumbered from zero with no gap")        // FR-006, FR-011
    })

    // FR-023 — platform adaptation
    t.Run("when an owner asks for the tour from mobile", func(t *testing.T) {
        t.Run("the web-only people stop says the work is done on the web")       // FR-023
        t.Run("the web-only people stop carries no target and no action label")  // FR-023
        t.Run("every other stop keeps its target and action label")              // FR-022, FR-023
    })
    t.Run("when the same owner asks for the tour from web", func(t *testing.T) {
        t.Run("the people stop carries its normal body and a target")            // FR-022
    })

    // US1, FR-007 — the offer rule
    t.Run("when a person has never engaged with their tour", func(t *testing.T) {
        t.Run("the status is not started and the tour should be offered")        // FR-007
        t.Run("no progress row is written by merely reading the tour")           // FR-007
    })
    t.Run("when a person has completed their tour", func(t *testing.T) {
        t.Run("the tour is no longer offered")                                   // FR-007
    })
    t.Run("when a person has dismissed their tour", func(t *testing.T) {
        t.Run("the tour is no longer offered")                                   // FR-007, FR-009
    })

    // US1, FR-010, FR-014 — progress
    t.Run("when a person advances part-way and stops", func(t *testing.T) {
        t.Run("asking again returns the stop they had not completed")            // FR-010
        t.Run("the status is in progress and the tour is still offered")         // FR-007, FR-010
        t.Run("re-sending the same stop index changes nothing")                  // FR-014
        t.Run("moving back a stop is accepted and stored")                       // FR-011
    })
    t.Run("when a person completes the final stop", func(t *testing.T) {
        t.Run("the status becomes completed without inspecting the workspace")   // FR-014
    })
    t.Run("when a workspace has no project, no ritual and one member", func(t *testing.T) {
        t.Run("an owner who reads every stop still completes the tour")          // FR-014
    })

    // FR-015a — the stored position survives the stop list changing under it
    t.Run("when a permission is revoked while a person is mid-tour", func(t *testing.T) {
        t.Run("the stop it gated disappears from the list")                      // FR-006
        t.Run("a stored position past the shortened list resumes at the last stop that exists") // FR-015a
        t.Run("the stored position is not overwritten by the clamp")             // FR-015a
        t.Run("restoring the permission restores the original position")         // FR-015a
    })
    t.Run("when a person's filtered tour has no stops at all", func(t *testing.T) {
        t.Run("the response is empty rather than an error and nothing is offered") // FR-006
    })

    // Spec edge case — role change mid-tour
    t.Run("when a worker is promoted part-way through the worker tour", func(t *testing.T) {
        t.Run("they are served the administrator tour on the next call")         // FR-002
        t.Run("the administrator tour reads as not started and is offered")       // FR-007
        t.Run("their worker-tour progress is left untouched")                     // FR-015
        t.Run("a progress write lands on the administrator tour, not the worker one") // FR-015
    })

    // Spec edge case — content changed after completion
    t.Run("when the tour content version changes after a person completed it", func(t *testing.T) {
        t.Run("the tour is still not offered again")                             // FR-007
        t.Run("the stored content version is the one they actually saw")          // FR-015
    })

    // FR-024 — progress belongs to the person, not the device
    t.Run("when a person completed the tour from web", func(t *testing.T) {
        t.Run("asking from mobile reports completed and does not offer it")      // FR-024
    })

    // US3, FR-017 — restart
    t.Run("when a person restarts a completed tour", func(t *testing.T) {
        t.Run("the status returns to in progress at the first stop")             // FR-017
        t.Run("a dismissed tour can be restarted the same way")                  // FR-017
    })

    // Contract enforcement
    t.Run("when the request is malformed", func(t *testing.T) {
        t.Run("an unspecified platform is rejected")                             // contract
        t.Run("a progress write of not-started is rejected")                     // contract
        t.Run("a stop index past the end of the filtered tour is rejected")      // contract
        t.Run("a negative stop index is rejected")                               // contract
    })

    // Constitution I — tenancy
    t.Run("when two organizations each have a person mid-tour", func(t *testing.T) {
        t.Run("neither reads nor overwrites the other's progress")               // FR-015
        t.Run("the same person in a second organization is offered the tour again") // FR-015
    })

    // Lifecycle
    t.Run("when an organization is deleted", func(t *testing.T) {
        t.Run("its tour progress rows are removed with it")                      // data lifecycle
    })
}

// TestTourPermissionIdsExist guards the one silent failure mode in this feature: the
// permission ids in content.go are bare strings with no compile-time check, so a rename in a
// later migration would flip the audience or hide a stop with nothing to catch it.
func TestTourPermissionIdsExist(t *testing.T) {
    t.Run("every permission id referenced by tour content exists in public.permission")
    t.Run("the audience discriminator iam.inviteUser exists and is absent from the employee role template")
}
```

## Web E2E — `frontend/apps/web/e2e/feature-tour.spec.ts`

```
describe: Feature tour on web
  US1  an owner signing in for the first time is offered the administrator tour   // FR-007
  US1  the owner can move forward and back and sees their position in the sequence // FR-011
  US1  each stop is a card that links to its surface and does not highlight any element // FR-018
  US1  acting on a stop closes the tour and navigates to the surface             // FR-012
  US1  returning to the workspace reopens the tour at the same stop, unprompted   // FR-012
  FR-013a in an empty workspace the project stop lands with project creation visible
  FR-013a in an empty workspace the ritual stop routes to project creation and says why
  US1  leaving mid-tour and signing in again resumes at the same stop            // FR-010
  US1  a completed tour is not offered on the next sign-in                       // FR-007
  US2  an employee signing in for the first time is offered the worker tour      // FR-001, FR-002
  US3  the tour can be started from the help entry point after being dismissed   // FR-017
  A11y the tour is fully operable by keyboard and exposes its stop position      // FR-019
  A11y focus is never trapped without an exit                                    // FR-009, FR-019
  FR-013 arriving from a shared resource link opens the resource and shows no tour
  FR-008 a person who has not accepted the terms sees the terms gate and no tour
```

Every interactive element carries `data-testid` (Constitution VII).

## Mobile — `frontend/apps/mobile/.maestro/feature-tour/`

`owner-tour.yaml`
```
US1  sign in as an owner on a fresh install → the administrator tour is offered   // FR-022
FR-023 reach the people stop → it says the work is done on the web and shows no action button
US1  advance to the end → the tour completes and is not offered on relaunch       // FR-007
FR-025 every stop renders inside a 360 dp portrait viewport with no clipping      // FR-020
```

`worker-tour.yaml`
```
US2  sign in as a PIN worker on a fresh install → the worker tour is offered      // FR-001, FR-002
US2  the today stop closes the tour and opens the Today tab                      // FR-012
US2  returning to the tab the tour was offered from reopens it at the same stop   // FR-012
US2  dismiss the tour → relaunch → it is not offered                              // FR-009, FR-007
US3  open More → Take the tour → it runs from the first stop                      // FR-017
FR-008 a worker who must set a PIN completes that first and is not shown the tour mid-gate
```

All interactive elements carry `testID` (Constitution XIII).

**SC-001** (tour completable in under 5 minutes) and **SC-005** (a completed or dismissed
tour is never re-offered) are both covered above — SC-005 by the offer-rule scenarios, SC-001
by the measured reading times in [tour-content.md](tour-content.md) plus the navigation
scenarios. Neither needs telemetry.

## Requirements deliberately not covered by an automated scenario

| Requirement | Why, and how it is verified instead |
|---|---|
| **FR-016** (progress survives reinstall) | Reinstall is not scriptable inside a single Maestro run. It follows from the backend scenarios: progress is server-side and keyed on person and organization, and `clearAppState` in the Maestro flows exercises the same "no local state" path. |
| **FR-005** (≤6 stops, ≤60 words per body) | The stop cap is asserted in `TestFeatureTour`. The word cap is editorial and is verified against the measured table in [tour-content.md](tour-content.md#length-check-against-fr-005-and-sc-007), which must be re-measured whenever the copy changes. |
| **FR-021** (copy uses product vocabulary) | An editorial property, not a machine-checkable one. Verified at review of [tour-content.md](tour-content.md). |
| **FR-025** (mobile layout is purpose-built, not a web copy) | Verified by review of the diff — the mobile component shares no code with the web component. The Maestro viewport assertion covers the observable half. |
| **SC-002 – SC-004** (adoption rates) | Measured post-release from `iam.tour_progress` and existing workspace data, per the spec's assumptions. Not testable pre-release; the baseline capture is an operational task called out in [research.md](research.md) and tracked as a task in [tasks.md](../tasks.md). |
| **D37** (Maestro cannot drive a physical iPhone) | Pre-existing environment limitation recorded in the drift register. The mobile flows run on a real Android device and an iOS simulator, as with every other feature. |
