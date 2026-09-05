# Quickstart: Validating the Unreachable Missed Call

**Feature**: `052-unreachable-callee-missed-call`

How to run and see this feature work end to end. Contracts live in
[`contracts/voice-service.md`](contracts/voice-service.md); the row and message shapes are
in [`data-model.md`](data-model.md).

## Prerequisites

```bash
make infra-up                 # Postgres + LiveKit + supporting services
make check-servers            # confirms postgres, backend and frontend are reachable
```

The backend must be started the way the voice tests expect, so the test process and the
server agree on `PUBLIC_LIVEKIT_URL`:

```bash
make voice-dev-infra-up
make voice-dev-backend
```

## 1. Regenerate after the proto and query changes

The feature adds `VoiceCallSession.ended_reason` and one sqlc query. No migration.

```bash
cd backend && buf generate      # Go in place, TypeScript into frontend/packages/rpc
cd backend && sqlc generate     # CreateEndedVoiceCallSession
```

`backend/database/scripts/schema.sql` must come back unchanged — if `git status` shows it
modified, something added a migration that this feature does not need.

## 2. Backend integration scenarios

```bash
make test-backend-one T=TestUnreachableCalleeStillGetsAMissedCall
make test-backend-one T=TestVoiceConstantSync
```

Expected: every scenario in
[`contracts/test-scenarios.md`](contracts/test-scenarios.md) passes. `go test -v` output
reads as the behaviour specification — the scenario names are the contract.

Then the whole suite, which is the Definition of Done gate (Constitution II):

```bash
make test-backend
```

## 3. Web end-to-end

```bash
make test-frontend-one F=voice-communication
```

Expected: the `calling someone who cannot be reached` describe block passes — the refusal
appears, the missed-call entry appears in the same conversation without a reload, and no
call bar is shown.

## 4. Mobile reducer check

```bash
cd frontend && pnpm --filter mobile check:theme-resolution   # existing checks
node --experimental-strip-types frontend/apps/mobile/src/hooks/channel-voice-call-state.check.ts
```

Expected: the new assertion — a terminal event for a call the client never held leaves the
error in place — passes.

## 5. Manual walkthrough (the scenario the spec describes)

Two accounts in one workspace, in a direct conversation.

1. Sign in as the **callee** on one browser, then sign out and close the tab. Ensure the
   callee has no registered push device (a fresh web-only account has none).
2. Sign in as the **caller** in another browser and open the direct conversation.
3. Place a voice call.

**Expected, caller side:**
- The call is refused within a second or two — no ringing, no call bar, nothing to hang up.
- The message reads *"They cannot be reached right now. They will see that you called."*
  and says nothing about why.
- A **"Voice call missed"** entry appears in the open conversation without a reload.

4. Repeat the call twice more.

**Expected:** three separate entries with three separate times, not one collapsed entry.

5. Sign back in as the **callee** and look at the channel list before opening anything.

**Expected:** the direct conversation is marked unread; opening it shows the three
missed-call entries.

## 6. Verify the record from the database

```bash
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c \
  "select state, outcome, ended_reason, answered_at,
          ended_at - started_at as duration
     from voice.call_session
    order by started_at desc limit 5"
```

**Expected** for each recorded attempt: `ended | missed | callee_unreachable`, a NULL
`answered_at`, and a zero duration. Compare against a call that rang out — same
`state`/`outcome`, `ended_reason = ring_timeout` — which is the distinction US3 asks for.

Confirm nothing was created on the media side:

```bash
docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c \
  "select count(*) from voice.call_participant p
     join voice.call_session s on (s.organization_id, s.id) = (p.organization_id, p.call_session_id)
    where s.ended_reason = 'callee_unreachable'"
```

**Expected:** `0`.

## 7. Confirm the negative cases

- **Blocked pair**: block the callee, place a call, confirm the refusal names neither party
  and that `select count(*) from voice.call_session where ended_reason =
  'callee_unreachable'` did not increase.
- **Busy callee**: put the callee on another call, place a call, confirm the refusal is
  "already on another call" and again no new record.
- **Next call still works**: register a device for the callee and place a call — it rings
  normally and produces an ordinary `ringing` session.

## 8. Documentation gate (FR-015)

```bash
grep -n "D22" docs/domain/README.md    # expected: no match
grep -n "callee_unreachable" docs/domain/voice.md
```

`docs/domain/voice.md` must describe the recorded outcome and must no longer say the
callee sees nothing; `docs/domain/README.md` must no longer list D22. Updating both is part
of the Definition of Done, not a follow-up (Constitution XII).
