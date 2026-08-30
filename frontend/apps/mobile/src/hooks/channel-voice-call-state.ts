/**
 * The call state machine for one conversation, as a pure reducer with no imports, so the
 * race guards it exists for can be exercised by `npm run check:voice-state` without a
 * React renderer, a network, or a test framework.
 *
 * See `use-channel-voice-call.ts` for why this state has one owner.
 */

/** The one call summary the UI renders. */
export interface MobileVoiceCallSummary {
  id: string;
  state: "ringing" | "active" | "ending" | "ended";
  participantCount: number;
}

/** Which control is busy. One boolean could not say, so every control disabled together. */
export type VoiceCallAction =
  | "starting"
  | "joining"
  | "leaving"
  | "answering"
  | "declining";

export interface State {
  call: MobileVoiceCallSummary | null;
  joinedCallId: string | null;
  /**
   * Calls known to be over. ponytail: a bounded list, newest last — a screen open across
   * dozens of calls trims the oldest, and a call that old cannot still be in flight.
   */
  endedCallIds: string[];
  /** "Later" on a group channel's discovery prompt. Direct calls never set this. */
  dismissedCallId: string | null;
  pending: VoiceCallAction | null;
  error: string | null;
}

const ENDED_CALL_MEMORY = 32;

export type Action =
  | { type: "channelChanged" }
  | { type: "callLoaded"; call: MobileVoiceCallSummary | null }
  | { type: "callEnded"; callId?: string }
  | { type: "joined"; call: MobileVoiceCallSummary | null; callId: string }
  | { type: "left"; callId: string; call: MobileVoiceCallSummary | null }
  | { type: "pending"; pending: VoiceCallAction | null }
  | { type: "error"; error: string | null }
  | { type: "dismissed"; callId: string };

export const initialState: State = {
  call: null,
  joinedCallId: null,
  endedCallIds: [],
  dismissedCallId: null,
  pending: null,
  error: null,
};

function remember(endedCallIds: string[], callId: string): string[] {
  if (endedCallIds.includes(callId)) return endedCallIds;
  return [...endedCallIds, callId].slice(-ENDED_CALL_MEMORY);
}

/** The one place a call may be set. Rule 1 lives here so no caller can forget it. */
function withCall(state: State, call: MobileVoiceCallSummary | null): State {
  if (call && (call.state === "ended" || state.endedCallIds.includes(call.id))) {
    return { ...state, call: null };
  }
  return { ...state, call };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "channelChanged":
      // The ended-call memory is deliberately kept: leaving a conversation and coming
      // straight back must not let a stale read resurrect the call that just ended.
      return { ...initialState, endedCallIds: state.endedCallIds };

    case "callLoaded":
      return withCall(state, action.call);

    case "callEnded": {
      // A late terminal event for a previous call must not wipe the call that replaced
      // it. An event with no call id can only be read as "the current one".
      if (action.callId && state.call && state.call.id !== action.callId) {
        return state;
      }
      const endedId = action.callId ?? state.call?.id;
      return {
        ...state,
        call: null,
        error: null,
        endedCallIds: endedId ? remember(state.endedCallIds, endedId) : state.endedCallIds,
        joinedCallId: state.joinedCallId === endedId ? null : state.joinedCallId,
        dismissedCallId:
          state.dismissedCallId === endedId ? null : state.dismissedCallId,
      };
    }

    case "joined":
      return withCall(
        { ...state, joinedCallId: action.callId, error: null },
        action.call ?? { id: action.callId, state: "active", participantCount: 1 },
      );

    case "left": {
      const ended = !action.call || action.call.state === "ended";
      const next: State = {
        ...state,
        joinedCallId: null,
        endedCallIds: ended
          ? remember(state.endedCallIds, action.callId)
          : state.endedCallIds,
      };
      return withCall(next, ended ? null : action.call);
    }

    case "pending":
      return { ...state, pending: action.pending };

    case "error":
      return { ...state, error: action.error };

    case "dismissed":
      return { ...state, dismissedCallId: action.callId };
  }
}
