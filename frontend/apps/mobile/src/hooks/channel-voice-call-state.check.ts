/**
 * Self-check for the channel call state machine. Run with `npm run check:voice-state`.
 *
 * These are the races that produced call controls appearing after a call was over, and
 * every one of them is cheap to re-break: the reducer is the only thing standing between
 * a late server response and a resurrected call banner. No framework — the reducer is
 * pure, so plain asserts are the whole harness.
 */

import assert from "node:assert/strict";
import {
  initialState,
  reducer,
  type Action,
  type MobileVoiceCallSummary,
  type State,
} from "./channel-voice-call-state.ts";

const ringing = (id: string): MobileVoiceCallSummary => ({
  id,
  state: "ringing",
  participantCount: 1,
});

const run = (state: State, ...actions: Action[]): State =>
  actions.reduce(reducer, state);

// A server read that was issued before the call ended, and lands after, must not put the
// banner back. This is the bug that made the controls flash back into view.
{
  const after = run(
    initialState,
    { type: "callLoaded", call: ringing("call-a") },
    { type: "callEnded", callId: "call-a" },
    { type: "callLoaded", call: ringing("call-a") },
  );
  assert.equal(after.call, null, "an ended call must not be resurrected by a stale read");
}

// The old guard was a single ref. A second call overwrote it and the first came back.
{
  const after = run(
    initialState,
    { type: "callEnded", callId: "call-a" },
    { type: "callEnded", callId: "call-b" },
    { type: "callLoaded", call: ringing("call-a") },
  );
  assert.equal(after.call, null, "the ended-call memory must hold more than one id");
}

// A terminal event carrying no call id means "the one on screen", and must still be
// remembered — the old code left the tombstone unset in exactly this case.
{
  const after = run(
    initialState,
    { type: "callLoaded", call: ringing("call-a") },
    { type: "callEnded", callId: undefined },
    { type: "callLoaded", call: ringing("call-a") },
  );
  assert.equal(after.call, null, "a terminal event with no id must still tombstone");
}

// A late terminal event for the previous call must not wipe the call that replaced it.
{
  const after = run(
    initialState,
    { type: "callLoaded", call: ringing("call-b") },
    { type: "callEnded", callId: "call-a" },
  );
  assert.equal(after.call?.id, "call-b", "a late end for an old call must not clear a new one");
}

// A call the server already reports as ended never renders, however it arrives.
{
  const after = reducer(initialState, {
    type: "callLoaded",
    call: { id: "call-a", state: "ended", participantCount: 0 },
  });
  assert.equal(after.call, null, "an ended call must never be shown");
}

// Leaving a conversation and coming straight back must not resurrect the call that ended
// while it was open, so the ended memory survives a channel change.
{
  const after = run(
    initialState,
    { type: "callEnded", callId: "call-a" },
    { type: "channelChanged" },
    { type: "callLoaded", call: ringing("call-a") },
  );
  assert.equal(after.call, null, "the ended memory must survive a channel change");
  assert.equal(after.joinedCallId, null, "everything else must reset on a channel change");
}

// The memory is bounded, and bounded from the correct end: the newest ids survive.
{
  let state = initialState;
  for (let i = 0; i < 40; i += 1) {
    state = reducer(state, { type: "callEnded", callId: `call-${i}` });
  }
  assert.equal(state.endedCallIds.length, 32, "the ended memory must stay bounded");
  assert.ok(state.endedCallIds.includes("call-39"), "the newest ended call must be kept");
}

// Hanging up leaves no trace of the call, and a read still in flight cannot bring it back.
{
  const after = run(
    initialState,
    { type: "joined", call: ringing("call-a"), callId: "call-a" },
    { type: "left", callId: "call-a", call: null },
    { type: "callLoaded", call: ringing("call-a") },
  );
  assert.equal(after.call, null, "a call left by this device must not come back");
  assert.equal(after.joinedCallId, null, "leaving must clear the joined id");
}

// Leaving a group call that is still running for other people keeps the call on screen.
{
  const after = run(
    initialState,
    { type: "joined", call: ringing("call-a"), callId: "call-a" },
    {
      type: "left",
      callId: "call-a",
      call: { id: "call-a", state: "active", participantCount: 2 },
    },
  );
  assert.equal(after.call?.id, "call-a", "a call others are still on stays visible");
  assert.equal(after.joinedCallId, null, "but this device is no longer in it");
}

// "Later" applies to the call it was tapped for, and is forgotten when that call ends.
{
  const after = run(
    initialState,
    { type: "callLoaded", call: ringing("call-a") },
    { type: "dismissed", callId: "call-a" },
  );
  assert.equal(after.dismissedCallId, "call-a");
  const next = run(
    after,
    { type: "callEnded", callId: "call-a" },
    { type: "callLoaded", call: ringing("call-b") },
  );
  assert.equal(next.dismissedCallId, null, "a new call must not inherit a dismissal");
  assert.equal(next.call?.id, "call-b");
}

console.log("channel-voice-call-state: all checks passed");
