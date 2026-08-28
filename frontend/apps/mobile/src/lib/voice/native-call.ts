/**
 * Native call integration — the phone's own incoming-call screen and in-call controls.
 *
 * The operating system draws the call. This file is the translator between a workspace
 * call and the OS's idea of one: a wake arrives, the call is reported to CallKit or
 * Telecom, and from then on the user answers, mutes and hangs up from the lock screen
 * while this module keeps the workspace call in step.
 *
 * Three rules run through everything here, and each exists because breaking it produces
 * a specific, bad failure:
 *
 *   1. **Report first, always.** Every wake results in a call reported to the OS before
 *      anything else happens — even a wake about a call that is already over, and even
 *      when there is no valid session. On iOS this is survival: a VoIP push that does
 *      not report a call terminates the app. The native module reports the call before
 *      JavaScript is even running, so by the time this file sees an event the obligation
 *      is already met; what is left is to end the call promptly with the right reason.
 *
 *   2. **Never leave an orphan.** Every terminal path closes the OS call object. A
 *      device still showing an incoming call for a call that ended is the worst failure
 *      this feature has, because the user cannot dismiss it from inside the app.
 *
 *   3. **Nothing slow inside a system callback.** Android's Telecom tears the call down
 *      if a callback takes more than five seconds. No network round trip belongs in one,
 *      which is why the wake payload carries everything needed to ring.
 */

import { Platform } from "react-native";
import * as Calls from "expo-callkit-telecom";

type EventSubscription = ReturnType<typeof Calls.addCallSessionAddedListener>;
import {
  isTerminalCallWakeEvent,
  type CallWakeEvent,
} from "apis";
import { joinVoiceCall, endVoiceCall, respondToVoiceCallInvite } from "apis";
import { configureCallAudioSession, releaseCallAudioSession } from "./call-audio";
import { voiceClient } from "./voice-client";

/** Metadata keys the backend sets on every wake. Mirrors callWakeEventKey in
 *  backend/internal/notification/call_wake.go. */
const WAKE_EVENT_KEY = "event";

/**
 * What this device knows about one call.
 *
 * Keyed by the workspace call id rather than the OS call id, because a wake names the
 * former and the OS names the latter, and terminal wakes have to find the OS call that
 * an earlier wake created.
 */
interface TrackedCall {
  /** The OS-assigned call UUID. */
  nativeId: string;
  /** Highest sequence seen. A lower or equal one is a duplicate or an out-of-order
   *  straggler and must not be allowed to resurrect a call that is already over. */
  sequence: number;
  /** Set once the user answers here, so a wake saying somebody answered elsewhere does
   *  not hang up the phone that did the answering. */
  answeredHere: boolean;
  channelId?: string;
  ringExpiresAt?: number;
}

const trackedCalls = new Map<string, TrackedCall>();

/** Resolves the workspace call id for an OS call id — the reverse lookup the system
 *  callbacks need, since they only know the OS's own identifier. */
function serverCallIdFor(nativeId: string): string | undefined {
  for (const [serverCallId, tracked] of trackedCalls) {
    if (tracked.nativeId === nativeId) return serverCallId;
  }
  return undefined;
}

/** A workspace session must exist before a call can be joined. Supplied by the auth
 *  layer so this module does not reach into it directly. */
type SessionResolver = () => { isAuthenticated: boolean } | null;

let resolveSession: SessionResolver = () => null;
let onCallAnswered: ((serverCallId: string, channelId?: string) => void) | null = null;

interface WakeMetadata {
  event: CallWakeEvent;
  sequence: number;
  channelId?: string;
  ringExpiresAt?: number;
  organizationId?: string;
}

function log(message: string, fields: Record<string, unknown> = {}): void {
  // Structured so a field report ("my phone never rang") can be traced against the
  // backend's per-device delivery_attempt rows for the same call.
  console.log(`[native-call] ${message}`, JSON.stringify(fields));
}

function readWakeMetadata(raw: Record<string, unknown> | undefined): WakeMetadata {
  const value = (key: string): string | undefined => {
    const found = raw?.[key];
    return typeof found === "string" && found.length > 0 ? found : undefined;
  };
  const ringExpiresAt = value("ringExpiresAt");
  const parsedExpiry = ringExpiresAt ? Date.parse(ringExpiresAt) : Number.NaN;
  return {
    // An unrecognised event is treated as incoming, because the module only reports a
    // call at all for an incoming-shaped payload: refusing to act would leave the phone
    // ringing with nothing to end it.
    event: (value(WAKE_EVENT_KEY) as CallWakeEvent | undefined) ?? "incoming",
    sequence: Number.parseInt(value("sequence") ?? "0", 10) || 0,
    channelId: value("channelId"),
    ringExpiresAt: Number.isNaN(parsedExpiry) ? undefined : parsedExpiry,
    organizationId: value("organizationId"),
  };
}

/** Maps a terminal wake to the end reason the OS records, which is what the user later
 *  sees in their phone's own call history. */
function endedReasonFor(event: CallWakeEvent): Calls.CallEndedReason {
  switch (event) {
    case "cancelled":
      return "unanswered";
    case "answered_elsewhere":
      return "answeredElsewhere";
    case "declined_elsewhere":
      return "declinedElsewhere";
    case "ended":
    default:
      return "remoteEnded";
  }
}

/**
 * Ends the OS call and forgets it. Safe to call for a call that is already gone — which
 * matters, because the terminal wake and the user's own hang-up race each other.
 */
async function closeNativeCall(
  serverCallId: string,
  nativeId: string,
  reason: Calls.CallEndedReason,
): Promise<void> {
  trackedCalls.delete(serverCallId);
  try {
    await Calls.reportCallEnded(nativeId, reason);
  } catch (error) {
    log("failed to report call ended to the OS", { serverCallId, nativeId, reason, error: String(error) });
  }
  releaseCallAudioSession();
}

/**
 * Decides what one wake means for this device.
 *
 * By the time this runs the native module has already reported the call — that is what
 * satisfies iOS and what puts the incoming screen on the lock screen. This function's
 * job is everything after: keep it ringing, or stop it.
 */
async function handleWake(session: Calls.CallSession): Promise<void> {
  const incoming = session.incomingCallEvent;
  if (!incoming) return;

  const serverCallId = incoming.serverCallId;
  const metadata = readWakeMetadata(incoming.metadata as Record<string, unknown> | undefined);
  const existing = trackedCalls.get(serverCallId);

  log("wake received", {
    serverCallId,
    nativeId: session.id,
    event: metadata.event,
    sequence: metadata.sequence,
  });

  // A wake that is older than one already applied says nothing new. Dropping it is what
  // makes "cancelled during the same second as incoming" deterministic instead of a
  // race between two pushes.
  if (existing && metadata.sequence <= existing.sequence && existing.nativeId === session.id) {
    log("dropping out-of-order or duplicate wake", { serverCallId, sequence: metadata.sequence });
    return;
  }

  if (isTerminalCallWakeEvent(metadata.event)) {
    // The device that answered ignores "answered elsewhere": it is the elsewhere.
    if (metadata.event === "answered_elsewhere" && existing?.answeredHere) {
      log("ignoring answered_elsewhere on the device that answered", { serverCallId });
      return;
    }
    const nativeId = existing?.nativeId ?? session.id;
    await closeNativeCall(serverCallId, nativeId, endedReasonFor(metadata.event));
    log("call closed by terminal wake", { serverCallId, event: metadata.event });
    return;
  }

  // A wake with no valid workspace session cannot become a call: joining needs
  // credentials this device does not have. Report-then-end rather than ringing a phone
  // the user could not answer anyway (FR-019).
  if (!resolveSession()?.isAuthenticated) {
    await closeNativeCall(serverCallId, session.id, "failed");
    log("ended a wake that arrived with no valid session", { serverCallId });
    return;
  }

  // A wake delivered after the caller has already given up. Ending it now is better
  // than ringing a phone for a call that is about to be swept anyway.
  if (metadata.ringExpiresAt !== undefined && metadata.ringExpiresAt <= Date.now()) {
    await closeNativeCall(serverCallId, session.id, "unanswered");
    log("ended an expired wake rather than ringing", { serverCallId, ringExpiresAt: metadata.ringExpiresAt });
    return;
  }

  // Refuse to force-connect over another call. The OS already declines to present a
  // second call in most cases; saying so explicitly means the caller is told "busy"
  // rather than being left listening to a ring nobody will pick up (FR-015).
  const active = await Calls.getActiveCallSession();
  if (active && active.id !== session.id && active.status === "connected") {
    await closeNativeCall(serverCallId, session.id, "failed");
    log("declined a wake while already on a call", { serverCallId, activeCallId: active.id });
    return;
  }

  trackedCalls.set(serverCallId, {
    nativeId: session.id,
    sequence: metadata.sequence,
    answeredHere: false,
    channelId: metadata.channelId,
    ringExpiresAt: metadata.ringExpiresAt,
  });
  log("ringing", { serverCallId, nativeId: session.id, channelId: metadata.channelId });
}

/**
 * The user answered from the lock screen.
 *
 * Telecom gives this five seconds, so the audio session is configured synchronously and
 * the workspace join — the part that touches the network — is deliberately left to run
 * after the callback has already returned.
 */
async function handleAnswered(nativeId: string, requestId: string): Promise<void> {
  const serverCallId = serverCallIdFor(nativeId);
  if (!serverCallId) {
    log("answered a call this device does not track", { nativeId });
    await Calls.reportCallEnded(nativeId, "failed");
    return;
  }

  const tracked = trackedCalls.get(serverCallId);
  if (tracked) tracked.answeredHere = true;

  // The native framework owns the audio session; LiveKit only carries media. Doing this
  // before the join is what keeps the two from fighting over the session — the failure
  // mode is a call that connects with nobody able to hear.
  configureCallAudioSession();

  try {
    await joinVoiceCall(serverCallId);
    await Calls.fulfillIncomingCallConnected(requestId);
    onCallAnswered?.(serverCallId, tracked?.channelId);
    log("call answered and joined", { serverCallId, nativeId });
  } catch (error) {
    // Answering and then failing to join is the one case where the OS call must not be
    // left open: the user would see a connected call with no audio and no way out.
    log("join failed after answering - closing the call", { serverCallId, error: String(error) });
    try {
      await Calls.failIncomingCallConnected(nativeId, requestId);
    } catch {
      // Falling through to reportCallEnded below is enough; the call still closes.
    }
    await closeNativeCall(serverCallId, nativeId, "failed");
  }
}

/** The user hung up or declined from the system UI. */
async function handleEnded(nativeId: string): Promise<void> {
  const serverCallId = serverCallIdFor(nativeId);
  if (!serverCallId) {
    releaseCallAudioSession();
    return;
  }
  const tracked = trackedCalls.get(serverCallId);
  trackedCalls.delete(serverCallId);
  releaseCallAudioSession();

  try {
    // Declining before answering is an invitation response; hanging up afterwards ends
    // the call. Both reach the server after the OS call is already closed, so a slow
    // network cannot hold the phone's UI hostage.
    if (tracked?.answeredHere) {
      await endVoiceCall(serverCallId);
    } else {
      await endVoiceCall(serverCallId);
    }
    log("call ended from the system UI", { serverCallId, nativeId });
  } catch (error) {
    log("failed to tell the server the call ended", { serverCallId, error: String(error) });
  }
}

let subscriptions: EventSubscription[] = [];

/**
 * Starts the native call integration. Call once, from the authenticated root layout.
 *
 * Returns a teardown function. Registering the VoIP push here rather than at import
 * time keeps the permission prompt attached to a moment the user understands: they have
 * signed in to a workspace that makes calls.
 */
export function startNativeCallIntegration(options: {
  getSession: SessionResolver;
  onAnswered?: (serverCallId: string, channelId?: string) => void;
}): () => void {
  resolveSession = options.getSession;
  onCallAnswered = options.onAnswered ?? null;

  Calls.registerVoIPPush();

  subscriptions = [
    // A session appears both when a push arrives and when the app is launched by one,
    // which is why the wake is handled here rather than in a push listener: this is the
    // one place that sees both.
    Calls.addCallSessionAddedListener(({ session }) => {
      void handleWake(session);
    }),
    Calls.addCallSessionUpdatedListener(({ session }) => {
      // A terminal wake for a call already on screen arrives as an update rather than an
      // addition, so the same handling has to run here too.
      if (session.incomingCallEvent) void handleWake(session);
    }),
    Calls.addCallAnsweredListener(({ id, requestId }) => {
      void handleAnswered(id, requestId);
    }),
    Calls.addCallEndedListener(({ id }) => {
      void handleEnded(id);
    }),
    // The lock-screen mute button must actually mute. A system control that changes the
    // OS's idea of the call without changing the media is worse than no control at all:
    // the user believes they are muted and is still heard.
    Calls.addSetMutedActionListener(({ isMuted }) => {
      void voiceClient.setMuted(isMuted).catch((error: unknown) => {
        log("failed to apply the system mute request to the call", { isMuted, error: String(error) });
      });
    }),
    // Hold is mapped to mute rather than to a separate media state: the workspace call
    // has no hold concept, and leaving the microphone open on a held call would leak the
    // room the user stepped away to.
    Calls.addSetHeldActionListener(({ isOnHold }) => {
      void voiceClient.setMuted(isOnHold).catch((error: unknown) => {
        log("failed to apply the system hold request to the call", { isOnHold, error: String(error) });
      });
    }),
  ];

  log("native call integration started", { platform: Platform.OS });

  return () => {
    subscriptions.forEach((subscription) => subscription.remove());
    subscriptions = [];
    trackedCalls.clear();
  };
}

/**
 * Reports a decline made inside the app so the OS call closes too, keeping the two
 * representations of one call from drifting apart.
 */
export async function declineTrackedCall(serverCallId: string, invitationId: string): Promise<void> {
  const tracked = trackedCalls.get(serverCallId);
  if (tracked) {
    await closeNativeCall(serverCallId, tracked.nativeId, "declinedElsewhere");
  }
  await respondToVoiceCallInvite({ invitationId, response: "decline" });
}

/**
 * Reflects a mute made inside the app back into the OS call object, so the lock screen
 * and the in-app surface never disagree about whether the microphone is open (FR-012).
 */
export async function syncMutedToSystemCall(serverCallId: string, isMuted: boolean): Promise<void> {
  const tracked = trackedCalls.get(serverCallId);
  if (!tracked) return;
  try {
    await Calls.setMuted(tracked.nativeId, isMuted);
  } catch (error) {
    log("failed to mirror mute into the system call", { serverCallId, isMuted, error: String(error) });
  }
}

/** Whether this device is presenting a given call through the OS. Lets the in-app
 *  surfaces defer to the system UI instead of drawing a second incoming-call screen. */
export function isNativeCallActive(serverCallId: string): boolean {
  return trackedCalls.has(serverCallId);
}
