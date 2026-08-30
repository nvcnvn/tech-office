/**
 * One owner for the voice-call state of one conversation.
 *
 * This state used to live as eight independent pieces inside the channel screen, each
 * added by a different feature, and the bugs came from the gaps between them rather than
 * from any one of them:
 *
 *  - Every non-terminal voice event fired a `getActiveVoiceCall` with no cancellation and
 *    no ordering, so a response issued before a call ended could land after it and put the
 *    banner back. The next signal then took it away again — the call controls appearing
 *    and disappearing after a call was over.
 *  - The guard against that was a single ref holding one ended call id, which a second
 *    call, or a terminal event carrying no call id, silently defeated.
 *  - One `loading` boolean covered five different actions.
 *
 * So the rules are stated once, here:
 *
 *  1. **An ended call never comes back.** Terminal ids go into `endedCallIds` and every
 *     write checks it. Nothing needs to reset it, because a new call has a new id.
 *  2. **Only the newest server read wins.** Each read takes a ticket from `loadTicketRef`
 *     and applies only while it still holds the latest one, which also cancels every read
 *     in flight when the channel changes or the screen unmounts.
 *  3. **`pending` names the action.** Callers can disable the one control that is busy.
 *  4. **The incoming call has one source**, `notification-stream-provider`. The channel
 *     screen used to keep a second copy from its own stream subscription whose only
 *     purpose was to be suppressed when the provider had the same call.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  endVoiceCall,
  getActiveVoiceCall,
  joinVoiceCall,
  leaveVoiceCall,
  respondToVoiceCallInvite,
  startVoiceCall,
  voiceCallErrorMessage,
  voiceCallStateToString,
  type VoiceCallSession,
  type VoiceJoinCredentials,
} from "apis";
import {
  initialState,
  reducer,
  type MobileVoiceCallSummary,
  type VoiceCallAction,
} from "@/hooks/channel-voice-call-state";
import type { ChatStreamEventMeta } from "@/lib/chat-stream-events";
export type { MobileVoiceCallSummary, VoiceCallAction };

import type { IncomingVoiceCallAlert } from "@/providers/notification-stream-provider";
import { connectCallWithNativePresentation } from "@/lib/voice/native-call";
import { voiceClient, type VoiceClientSnapshot } from "@/lib/voice/voice-client";

// ── Server shapes → the one summary the UI renders ───────────────────────────

function toSummary(
  call: VoiceCallSession | undefined | null,
): MobileVoiceCallSummary | null {
  if (!call?.id) return null;
  return {
    id: call.id,
    state: voiceCallStateToString(call.state),
    participantCount: call.participants?.length ?? 0,
  };
}

function toJoinCredentials(
  credentials: VoiceJoinCredentials | undefined | null,
  activeCallId?: string,
  activeChannelId?: string,
) {
  if (!credentials?.livekitToken || !credentials.roomName) return null;
  const seconds = Number(credentials.expiresAt?.seconds ?? 0);
  return {
    livekitUrl: credentials.livekitUrl,
    livekitToken: credentials.livekitToken,
    roomName: credentials.roomName,
    activeCallId,
    activeChannelId,
    expiresAt: seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined,
  };
}

export interface ChannelVoiceCall {
  /** The call running in this conversation, or null. Never an ended one. */
  call: MobileVoiceCallSummary | null;
  /** The incoming call for this conversation, from the provider. Tier-B devices only. */
  incoming: IncomingVoiceCallAlert | null;
  joined: boolean;
  pending: VoiceCallAction | null;
  error: string | null;
  snapshot: VoiceClientSnapshot;
  /** True once "Later" was tapped for the running call. Group channels only. */
  dismissed: boolean;
  start: () => Promise<void>;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  answer: () => Promise<void>;
  /** Always tells the caller: declines the invitation, or ends a call that has none. */
  decline: () => Promise<void>;
  /** Flips the microphone. Mirrored into the OS call object by native-call.ts. */
  toggleMute: () => Promise<void>;
  dismiss: () => void;
  /**
   * Feed every `voice_call_*` stream event for this channel here. Returns which kind it
   * was, so the caller can refresh the transcript for a non-terminal one without having
   * to repeat the terminal test and drift from it.
   */
  applyStreamEvent: (event: ChatStreamEventMeta) => "terminal" | "updated";
}

export function useChannelVoiceCall(options: {
  channelId: string | undefined;
  channelTitle: string;
  incoming: IncomingVoiceCallAlert | null;
  clearIncoming: (callId?: string) => void;
  onCallSettled: (callId: string) => void;
}): ChannelVoiceCall {
  const { channelId, channelTitle, clearIncoming, onCallSettled } = options;
  const [state, dispatch] = useReducer(reducer, initialState);
  const [snapshot, setSnapshot] = useReducer(
    (_: VoiceClientSnapshot, next: VoiceClientSnapshot) => next,
    voiceClient.getSnapshot(),
  );

  // Rule 2. Bumped by every read and by every channel change, so a response can check
  // whether it is still the answer anyone is waiting for.
  const loadTicketRef = useRef(0);

  const incoming =
    options.incoming && options.incoming.channelId === channelId
      ? options.incoming
      : null;

  useEffect(() => voiceClient.subscribe(setSnapshot), []);

  const refresh = useCallback(() => {
    if (!channelId) return;
    const ticket = ++loadTicketRef.current;
    getActiveVoiceCall(channelId)
      .then((response) => {
        if (loadTicketRef.current !== ticket) return;
        dispatch({
          type: "callLoaded",
          call: response.hasActiveCall ? toSummary(response.call) : null,
        });
      })
      .catch(() => undefined);
  }, [channelId]);

  useEffect(() => {
    dispatch({ type: "channelChanged" });
    if (!channelId) return;
    const ticket = ++loadTicketRef.current;
    getActiveVoiceCall(channelId)
      .then((response) => {
        if (loadTicketRef.current !== ticket) return;
        dispatch({
          type: "callLoaded",
          call: response.hasActiveCall ? toSummary(response.call) : null,
        });
        dispatch({ type: "error", error: null });
      })
      .catch((error: unknown) => {
        if (loadTicketRef.current !== ticket) return;
        dispatch({
          type: "error",
          error: voiceCallErrorMessage(error, "Unable to load active voice call."),
        });
      });
    // Cancels every read still in flight for the channel being left.
    return () => {
      loadTicketRef.current += 1;
    };
  }, [channelId]);

  // A LiveKit disconnect is not itself a verdict. It is a genuine failure (the backend
  // still holds a stale participant, so the leave API has to run) or the server having
  // deleted the room because the call ended — the one terminal signal that survives a
  // missed live-only event. Re-read either way: in a group call the room can drop just
  // this participant while the call goes on.
  useEffect(() => {
    if (snapshot.connectionState !== "disconnected" || !state.joinedCallId) return;
    const callId = state.joinedCallId;
    dispatch({ type: "left", callId, call: state.call });
    if (snapshot.error) {
      dispatch({ type: "error", error: snapshot.error });
      void leaveVoiceCall(callId).catch(() => undefined);
    }
    refresh();
  }, [refresh, snapshot.connectionState, snapshot.error, state.call, state.joinedCallId]);

  const run = useCallback(
    async (action: VoiceCallAction, fallback: string, body: () => Promise<void>) => {
      dispatch({ type: "pending", pending: action });
      dispatch({ type: "error", error: null });
      try {
        await body();
      } catch (error) {
        dispatch({ type: "error", error: voiceCallErrorMessage(error, fallback) });
      } finally {
        dispatch({ type: "pending", pending: null });
      }
    },
    [],
  );

  const connect = useCallback(
    async (
      credentials: ReturnType<typeof toJoinCredentials>,
      targetChannelId: string,
    ) => {
      if (!credentials) return;
      // Every in-app path reports the call to the OS before the media connects. On iOS
      // the audio unit is only enabled for a call CallKit knows about, so connecting
      // without reporting publishes silence on a call that looks connected everywhere.
      await connectCallWithNativePresentation(credentials, {
        id: targetChannelId,
        displayName: channelTitle,
      });
    },
    [channelTitle],
  );

  const start = useCallback(
    () =>
      run("starting", "Unable to start voice call.", async () => {
        if (!channelId) return;
        const response = await startVoiceCall({ channelId });
        const call = toSummary(response.call);
        if (!call) return;
        dispatch({ type: "joined", call, callId: call.id });
        await connect(
          toJoinCredentials(response.joinCredentials, call.id, channelId),
          channelId,
        );
      }),
    [channelId, connect, run],
  );

  const join = useCallback(
    () =>
      run("joining", "Unable to join voice call.", async () => {
        if (!state.call || !channelId) return;
        const callId = state.call.id;
        const response = await joinVoiceCall(callId);
        dispatch({ type: "joined", call: toSummary(response.call), callId });
        await connect(
          toJoinCredentials(response.joinCredentials, callId, channelId),
          channelId,
        );
      }),
    [channelId, connect, run, state.call],
  );

  const answer = useCallback(
    () =>
      run("answering", "Unable to answer voice call.", async () => {
        if (!incoming) return;
        const { callId, invitationId, channelId: incomingChannelId } = incoming;
        // An invitation response answers with credentials but not with a call session,
        // so the summary for that path is built from the alert that raised the prompt.
        const response = invitationId
          ? await respondToVoiceCallInvite({ invitationId, response: "accept" })
          : await joinVoiceCall(callId);
        const call =
          "call" in response
            ? toSummary(response.call)
            : {
                id: callId,
                state: "active" as const,
                participantCount: incoming.participantCount ?? 1,
              };
        dispatch({ type: "joined", call, callId });
        const credentials = toJoinCredentials(
          response.joinCredentials,
          callId,
          incomingChannelId,
        );
        if (credentials) {
          await voiceClient.disconnect();
          await connect(credentials, incomingChannelId);
        }
        clearIncoming(callId);
      }),
    [clearIncoming, connect, incoming, run],
  );

  const decline = useCallback(
    () =>
      run("declining", "Unable to decline voice call.", async () => {
        const callId = incoming?.callId ?? state.call?.id;
        if (!callId) return;
        // Same rule the system call UI applies in native-call.ts: declining before
        // answering is an invitation response, and a call with no invitation to decline
        // is ended instead. Either way the caller stops ringing — which is the whole
        // point, and what the local-only "Later" never did.
        if (incoming?.invitationId) {
          await respondToVoiceCallInvite({
            invitationId: incoming.invitationId,
            response: "decline",
          });
        } else {
          await endVoiceCall(callId);
        }
        dispatch({ type: "callEnded", callId });
        clearIncoming(callId);
        onCallSettled(callId);
      }),
    [clearIncoming, incoming, onCallSettled, run, state.call],
  );

  // Not wrapped in run(): muting is local media, it has no server round-trip to fail,
  // and putting it in the shared pending slot would grey out the leave button.
  const toggleMute = useCallback(
    () => voiceClient.setMuted(!snapshot.isMuted),
    [snapshot.isMuted],
  );

  const leave = useCallback(
    () =>
      run("leaving", "Unable to leave voice call.", async () => {
        if (!state.call) return;
        const callId = state.call.id;
        await voiceClient.disconnect();
        const response = await leaveVoiceCall(callId);
        dispatch({ type: "left", callId, call: toSummary(response.call) });
        onCallSettled(callId);
      }),
    [onCallSettled, run, state.call],
  );

  const dismiss = useCallback(() => {
    if (state.call) dispatch({ type: "dismissed", callId: state.call.id });
  }, [state.call]);

  const applyStreamEvent = useCallback(
    (event: ChatStreamEventMeta): "terminal" | "updated" => {
      const terminal =
        event.notificationType === "voice_call_ended" ||
        event.state === "VOICE_CALL_STATE_ENDED";
      if (!terminal) {
        refresh();
        return "updated";
      }
      const active = voiceClient.getSnapshot().activeCallId;
      if (!event.callId || active === event.callId) {
        void voiceClient.disconnect();
      }
      dispatch({ type: "callEnded", callId: event.callId });
      if (event.callId) {
        clearIncoming(event.callId);
        onCallSettled(event.callId);
      }
      return "terminal";
    },
    [clearIncoming, onCallSettled, refresh],
  );

  return useMemo(
    () => ({
      call: state.call,
      incoming,
      joined: Boolean(
        state.call &&
          (state.joinedCallId === state.call.id ||
            snapshot.activeCallId === state.call.id),
      ),
      pending: state.pending,
      error: state.error,
      snapshot,
      dismissed: Boolean(state.call && state.dismissedCallId === state.call.id),
      start,
      join,
      leave,
      answer,
      decline,
      toggleMute,
      dismiss,
      applyStreamEvent,
    }),
    [
      answer,
      applyStreamEvent,
      decline,
      dismiss,
      incoming,
      join,
      leave,
      snapshot,
      start,
      toggleMute,
      state.call,
      state.dismissedCallId,
      state.error,
      state.joinedCallId,
      state.pending,
    ],
  );
}
