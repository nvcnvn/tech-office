# Behavioral Contract: Integration & E2E Scenarios

**Feature**: 033-presence-ping-pong | **Constitution**: Principle II (Scenario-First Integration & E2E Testing — NON-NEGOTIABLE)

> **GATE**: These scenarios are the behavioral contract for the feature. They must be reviewed and approved **before `/speckit-tasks` runs and before any code is written**. Approving this file means agreeing that a feature passing these scenarios is the feature that was asked for.

Every User Story and every user-observable Functional Requirement from [spec.md](../spec.md) maps to at least one scenario below. Coverage and deliberate exclusions are tabulated at the end.

---

## Backend integration scenarios

**File**: `backend/integration/presence_ping_pong_test.go` — `testWorld` pattern per `helper_test.go`.

Time is the substance of this feature, so the suite needs to move the clock without sleeping through 90 seconds per case. Scenarios below marked *(clock)* set `last_pong_at` directly through the admin pool to simulate elapsed silence — the same technique `helper_test.go:2320` already uses for stale-connection cleanup. This is not merely a nicety: `make test-backend` runs with `-timeout 120s` for the whole suite, so a single scenario that genuinely waited out the 90-second removal window would blow the budget on its own.

```go
func TestPresencePingPong(t *testing.T) {
    w := newTestWorld(t)
    _ = w // scenarios only — implementations come after contract review

    // ── User Story 1: notifications reach a colleague whose app went away silently ──

    // FR-001, FR-002: the server challenges and the client answers
    t.Run("when a client holds an open notification stream", func(t *testing.T) {
        t.Run("it receives ping events on the stream", func(t *testing.T) { t.Skip("TODO") })
        t.Run("each ping carries the connection id and a unique event id", func(t *testing.T) { t.Skip("TODO") })
        t.Run("answering a ping records the pong and returns ACK", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-003: liveness comes only from pongs — the regression guard for the original defect
    t.Run("when a stream stays open but the client never answers", func(t *testing.T) {
        t.Run("the server does not advance the connection's liveness on its own", func(t *testing.T) { t.Skip("TODO") })
        t.Run("the connection stops counting as present once the window elapses", func(t *testing.T) { t.Skip("TODO") }) // (clock)
    })

    // FR-012, FR-013, FR-014: routing follows responsiveness
    t.Run("when a notification is generated for an employee", func(t *testing.T) {
        t.Run("with a responsive connection it is delivered live and no fallback is queued", func(t *testing.T) { t.Skip("TODO") })
        t.Run("with only an unresponsive connection it is routed to push fallback", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("the fallback reason records connection_unresponsive, not a policy skip", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("with no connection at all it is routed to push fallback", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-016: exactly one delivery decision per recipient per notification
    t.Run("when a notification is routed at the responsiveness boundary", func(t *testing.T) {
        t.Run("it is never both delivered live and queued for unsuppressed fallback", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-011: aggregation across devices
    t.Run("when an employee has two connections and only one answers", func(t *testing.T) {
        t.Run("the employee still counts as present", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("live delivery targets only the answering connection", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("no push fallback is queued for the employee", func(t *testing.T) { t.Skip("TODO") }) // (clock)
    })

    // ── User Story 2: teammates see an accurate presence indicator ──

    // FR-007, FR-008: the derived liveness state machine
    t.Run("when a connection stops answering", func(t *testing.T) {
        t.Run("it reads as present up to the responsive window", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("it reads as offline past the responsive window", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("its row is deleted past the removal window", func(t *testing.T) { t.Skip("TODO") }) // (clock)
    })

    // FR-009: recovery without re-authentication
    t.Run("when an unresponsive connection answers again before removal", func(t *testing.T) {
        t.Run("it is restored to present", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("the client is not asked to reconnect", func(t *testing.T) { t.Skip("TODO") }) // (clock)
    })

    // FR-010: a removed connection is never resurrected
    t.Run("when a pong arrives for a connection that was already removed", func(t *testing.T) {
        t.Run("it returns the reconnect directive", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("it does not recreate the connection row", func(t *testing.T) { t.Skip("TODO") }) // (clock)
    })

    // FR-011: most-available status wins
    t.Run("when an employee is present on two connections with different states", func(t *testing.T) {
        t.Run("the aggregated presence reports the most available state", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-015, FR-020: visibility affects display, never routing
    t.Run("when an employee has chosen to appear offline", func(t *testing.T) {
        t.Run("viewers see them as offline while they are answering pings", func(t *testing.T) { t.Skip("TODO") })
        t.Run("their notifications are still treated as live-deliverable", func(t *testing.T) { t.Skip("TODO") })
        t.Run("going unresponsive still routes their notifications to push fallback", func(t *testing.T) { t.Skip("TODO") }) // (clock)
    })

    // ── User Story 3: state and context reported through the pong ──

    // FR-002, FR-018: the pong carries everything the removed endpoint carried
    t.Run("when a pong reports a new active channel", func(t *testing.T) {
        t.Run("the connection's active context is updated", func(t *testing.T) { t.Skip("TODO") })
        t.Run("live notifications for the viewed channel are suppressed as already seen", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a pong reports each supported status", func(t *testing.T) {
        t.Run("online, online_hidden, idle, in_meeting and offline are all accepted", func(t *testing.T) { t.Skip("TODO") })
        t.Run("an unspecified status is rejected as invalid argument", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-004: unsolicited pongs take effect immediately
    t.Run("when a client sends an unsolicited pong between pings", func(t *testing.T) {
        t.Run("the new state is visible without waiting for the next ping", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-005: clean departure
    t.Run("when a client sends a departing pong", func(t *testing.T) {
        t.Run("the connection is removed immediately", func(t *testing.T) { t.Skip("TODO") })
        t.Run("the employee reads as offline without waiting out the window", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-006, FR-022, FR-023: ownership and tenancy
    t.Run("when a pong references a connection the caller does not own", func(t *testing.T) {
        t.Run("another employee's connection is not modified", func(t *testing.T) { t.Skip("TODO") })
        t.Run("the response is indistinguishable from an unknown connection", func(t *testing.T) { t.Skip("TODO") })
        t.Run("a connection in another organization is not modified", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-006: malformed input
    t.Run("when a pong is malformed", func(t *testing.T) {
        t.Run("a missing connection id is rejected as invalid argument", func(t *testing.T) { t.Skip("TODO") })
        t.Run("an unparseable active channel id is rejected as invalid argument", func(t *testing.T) { t.Skip("TODO") })
    })

    // Edge case: client clock disagreement (spec Edge Cases, research R6)
    t.Run("when a pong carries an implausible last interaction time", func(t *testing.T) {
        t.Run("a far-future interaction time is clamped to the server's clock", func(t *testing.T) { t.Skip("TODO") })
        t.Run("liveness is unaffected by the client-supplied time", func(t *testing.T) { t.Skip("TODO") })
    })

    // ── User Story 4: the old endpoint is gone ──

    // FR-017
    t.Run("when a caller invokes the removed presence update endpoint", func(t *testing.T) {
        t.Run("the call fails as unimplemented", func(t *testing.T) { t.Skip("TODO") })
        t.Run("no presence record is modified", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-020: read surfaces keep working unchanged
    t.Run("when presence is read after the protocol change", func(t *testing.T) {
        t.Run("single employee lookup returns the same shape as before", func(t *testing.T) { t.Skip("TODO") })
        t.Run("batch lookup returns the same shape as before", func(t *testing.T) { t.Skip("TODO") })
        t.Run("presence visibility settings still apply to both", func(t *testing.T) { t.Skip("TODO") })
    })

    // ── Protocol mechanics: batching and multi-instance behavior ──

    // FR-026, and the batcher design (research R3)
    t.Run("when many pongs arrive at once", func(t *testing.T) {
        t.Run("every pong receives its own directive", func(t *testing.T) { t.Skip("TODO") })
        t.Run("pongs for several organizations are recorded correctly", func(t *testing.T) { t.Skip("TODO") })
        t.Run("a pong for a removed connection in a mixed batch still returns reconnect", func(t *testing.T) { t.Skip("TODO") })
    })

    // FR-024: connections outliving their owner or their instance
    t.Run("when the instance that owned a connection is gone", func(t *testing.T) {
        t.Run("the connection expires on the same timetable as any other silent connection", func(t *testing.T) { t.Skip("TODO") }) // (clock)
        t.Run("no client announcement is required to clear it", func(t *testing.T) { t.Skip("TODO") }) // (clock)
    })
}
```

## Web E2E scenarios

**File**: `frontend/apps/web/e2e/presence-ping-pong.spec.ts` (Playwright).

```
test.describe("presence ping-pong", () => {
  test("a signed-in user appears online to a colleague")                     // US2, FR-001/002
  test("switching channels updates the user's active context")               // US3, FR-002
  test("going idle is reflected to a colleague without a page reload")       // US3, FR-004
  test("closing the tab marks the user offline promptly")                    // US3, FR-005
  test("a colleague whose stream is severed appears offline within a minute")// US1/US2, FR-007/008
  test("the app never calls the removed presence update endpoint")           // US4, FR-019 — assert via network interception
})
```

The last one is the E2E form of FR-019: rather than trusting a grep, the test fails if any request to the removed method leaves the browser.

## Mobile scenarios

**File**: `frontend/apps/mobile/.maestro/presence-ping-pong.yaml` (Constitution XIII).

```
- foreground the app, confirm the user's own presence indicator reads online
- background the app, return, confirm presence recovers without a re-login
```

Mobile coverage is deliberately the happy path only: the timing-sensitive cases are covered far more reliably by the backend suite, and Maestro cannot manipulate the server clock.

## Coverage map

| Requirement | Covered by |
|---|---|
| FR-001, FR-002 | "when a client holds an open notification stream"; "when a pong reports each supported status" |
| FR-003 | "when a stream stays open but the client never answers" — the regression guard |
| FR-004 | "when a client sends an unsolicited pong between pings" |
| FR-005 | "when a client sends a departing pong" |
| FR-006 | "when a pong references a connection the caller does not own"; "when a pong is malformed" |
| FR-007, FR-008 | "when a connection stops answering" |
| FR-009 | "when an unresponsive connection answers again before removal" |
| FR-010 | "when a pong arrives for a connection that was already removed" |
| FR-011 | "when an employee has two connections and only one answers"; "…with different states" |
| FR-012, FR-013, FR-014 | "when a notification is generated for an employee" |
| FR-015 | "when an employee has chosen to appear offline" |
| FR-016 | "when a notification is routed at the responsiveness boundary" |
| FR-017 | "when a caller invokes the removed presence update endpoint" |
| FR-018 | "when a pong reports each supported status"; "when a pong reports a new active channel" |
| FR-019 | E2E network-interception test |
| FR-020 | "when presence is read after the protocol change" |
| FR-022, FR-023 | "when a pong references a connection the caller does not own" |
| FR-024 | "when the instance that owned a connection is gone" |
| FR-026 | "when many pongs arrive at once" |

### Documented exclusions

Three requirements are structural rather than user-observable and are verified by review and tooling instead of a runtime scenario, as Constitution II permits when the exclusion is justified:

- **FR-021** (cross-stack constant synchronization) — verified by the PR alignment check the principle already mandates; there is no runtime behavior to assert that the other scenarios do not already cover.
- **FR-025** (observability signals) — asserting on log output would couple tests to log formatting. Verified by inspecting the structured fields during quickstart validation.
- **FR-019** (no remaining call sites) — has an E2E scenario for the browser, but the mobile half is verified by build: the symbol is deleted from `packages/apis`, so any remaining mobile call site fails type-checking.
