# Behavioural Contract: Test Scenarios

**Feature**: `052-unreachable-callee-missed-call` | Constitution principle II

These scenario stubs are the behavioural contract. They are written before implementation
and reviewed as part of this plan. Every User Story and every user-observable Functional
Requirement maps to at least one scenario below.

## Backend integration — `backend/integration/voice_unreachable_missed_call_test.go`

New file, `testWorld` pattern. A callee is made unreachable by simply not calling
`w.registerCallWakeDevice` for them, which is how `native_call_wakeup_test.go:298` already
does it.

```go
func TestUnreachableCalleeStillGetsAMissedCall(t *testing.T) {
    t.Parallel()

    // US1, FR-001, FR-002, FR-003, FR-008: the offline worker sees that someone tried
    t.Run("when a direct call is refused because the callee cannot be reached", func(t *testing.T) {
        t.Run("the caller is still refused immediately", func(t *testing.T) {})                       // FR-005, SC-003
        t.Run("a completed call record is written naming the caller and the conversation", func(t *testing.T) {}) // FR-001
        t.Run("the record is missed, with no answer time and no participant", func(t *testing.T) {})  // FR-002, US3.2
        t.Run("a missed-call system message appears in the direct conversation", func(t *testing.T) {}) // FR-003
        t.Run("the message is the same kind the ring-timeout sweep writes", func(t *testing.T) {})    // FR-003
        t.Run("the conversation counts as unread for the callee", func(t *testing.T) {})              // FR-008, SC-002
        t.Run("no media room is created and no join credentials are issued", func(t *testing.T) {})   // FR-006
        t.Run("the recorded call cannot be joined", func(t *testing.T) {})                            // FR-006, SC-004
        t.Run("no device is rung, woken, or pushed to", func(t *testing.T) {})                        // FR-007
    })

    // FR-004: the write survives the failure — the load-bearing scenario
    t.Run("when the call request fails for the caller", func(t *testing.T) {
        t.Run("the record and the message are both durably stored", func(t *testing.T) {})            // FR-004, SC-001
        t.Run("neither is written without the other", func(t *testing.T) {})                          // FR-004
    })

    // US1.4, FR-011: repeated attempts
    t.Run("when the same caller is refused three times", func(t *testing.T) {
        t.Run("three separate records and three separate messages are written", func(t *testing.T) {}) // FR-011, US1.4
        t.Run("each carries its own attempt time", func(t *testing.T) {})                              // US1.4
    })

    // Edge case: two attempts at once
    t.Run("when two calls to the same unreachable person are placed simultaneously", func(t *testing.T) {
        t.Run("each attempt is refused", func(t *testing.T) {})                                        // FR-005
        t.Run("each produces exactly one record with a matching conversation entry", func(t *testing.T) {}) // FR-011
    })

    // FR-010, SC-005: a blocked pair writes nothing
    t.Run("when a direct call is refused because the two people have blocked each other", func(t *testing.T) {
        t.Run("no call record is written", func(t *testing.T) {})                                      // FR-010, SC-005
        t.Run("no conversation entry is written for either side", func(t *testing.T) {})               // FR-010, SC-005
    })

    // Assumption 1: busy is unchanged
    t.Run("when a direct call is refused because the callee is busy", func(t *testing.T) {
        t.Run("no record and no conversation entry are written", func(t *testing.T) {})                // Assumption 1
    })

    // Edge case: the reachability check fails open
    t.Run("when the callee can be reached", func(t *testing.T) {
        t.Run("the call rings as an ordinary call and produces no unreachable record", func(t *testing.T) {})
    })

    // Edge case: shared channels are untouched
    t.Run("when a call is placed in a shared channel", func(t *testing.T) {
        t.Run("no unreachable record can be produced", func(t *testing.T) {})
    })

    // FR-014, SC-004: it must not block the next call
    t.Run("when a call was recorded as unreachable", func(t *testing.T) {
        t.Run("a subsequent call in the same conversation starts normally", func(t *testing.T) {})     // FR-014
        t.Run("the conversation reports no active call", func(t *testing.T) {})                        // SC-004
    })

    // US3, FR-009, SC-006: call history distinguishes the two kinds of missed call
    t.Run("when the conversation's call history is read", func(t *testing.T) {
        t.Run("a call that rang out and one that never reached a device are both missed", func(t *testing.T) {}) // US3.1
        t.Run("each carries a distinct recorded reason", func(t *testing.T) {})                        // FR-009, SC-006
        t.Run("the unreachable record shows no answer time and no duration", func(t *testing.T) {})    // US3.2
    })
}
```

### Constant synchronisation — `backend/integration/voice_constants_test.go` (extend)

```go
    t.Run("when checking voice call ended reasons", func(t *testing.T) {
        // FR-009, Constitution VIII: the reason crosses Go, SQL and TypeScript now that
        // it is on the wire, so the three must not drift.
    })
```

Asserts the `EndedReason*` set matches the literals in
`backend/database/scripts/voice.query.sql` and the TypeScript union in
`frontend/packages/apis/src/voice.ts`.

## Web E2E — `frontend/apps/web/e2e/voice-communication.spec.ts` (extend)

```ts
test.describe('calling someone who cannot be reached', () => {
  // US2.1, FR-012
  test('the missed-call entry appears in the caller\'s open conversation without a reload', ...)
  // US2.2, FR-013
  test('the refusal says the person will see the call and does not say why they could not be reached', ...)
  // US2.3, FR-005, SC-004
  test('no call is in progress, no call bar is shown, and there is nothing to hang up', ...)
  // US1.2, FR-008
  test('the callee returning to the app finds the conversation unread with the missed-call entry', ...)
})
```

## Mobile — `frontend/apps/mobile/src/hooks/channel-voice-call-state.check.ts` (extend)

The mobile reducer already carries an assert-based check file. One case is added:

```ts
// FR-005, FR-013: a terminal event for a call this client never held must not wipe the
// refusal the caller is being shown.
```

Mobile has no Maestro flow for this: the scenario needs a second, deliberately offline
device, which the Maestro harness cannot stage. Covered by the reducer check plus the
backend scenarios instead.

## Documented exclusions (Constitution II)

- **FR-015** (documentation and drift register) is verified by review of `docs/domain/`,
  not by a test. There is no assertion that meaningfully covers prose.
- **SC-002's thirty-second budget** is not asserted as a timing test. The backend scenario
  asserts the entry and the unread state exist immediately after the refusal; a wall-clock
  budget on top of that would be a flaky restatement of the same fact.
