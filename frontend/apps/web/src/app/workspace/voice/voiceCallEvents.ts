import type { Notification } from "@tech-office/notifications";

export const VOICE_CALL_EVENT_NAME = "tech-office:voice-call-event";
export const VOICE_CALL_ACCEPTED_EVENT_NAME = "tech-office:voice-call-accepted";
export const VOICE_CALL_ACCEPTED_STORAGE_KEY =
  "tech-office:accepted-voice-call";

export type VoiceCallNotificationType =
  | "voice_call_started"
  | "voice_call_updated"
  | "voice_call_ended"
  | "voice_call_incoming";

export interface VoiceCallStreamEvent {
  channelId: string;
  callId?: string;
  initiatorEmployeeId?: string;
  action?: string;
  state?: string;
  participantCount?: number;
  notificationType: VoiceCallNotificationType;
  invitationId?: string;
  alreadyInAnotherCall?: boolean;
}

export type VoiceCallStateName = "ringing" | "active" | "ending" | "ended";

export interface VoiceJoinCredentialsPayload {
  livekitUrl: string;
  livekitToken: string;
  roomName: string;
  expiresAt?: string;
}

export interface AcceptedVoiceCallPayload {
  channelId: string;
  callId: string;
  state: VoiceCallStateName;
  participantCount: number;
  joinCredentials?: VoiceJoinCredentialsPayload;
}

const voiceCallNotificationTypes = new Set<string>([
  "voice_call_started",
  "voice_call_updated",
  "voice_call_ended",
  "voice_call_incoming",
]);

export function isVoiceCallNotificationType(
  value: string,
): value is VoiceCallNotificationType {
  return voiceCallNotificationTypes.has(value);
}

export function streamStateToVoiceState(state?: string): VoiceCallStateName {
  switch (state) {
    case "active":
    case "VOICE_CALL_STATE_ACTIVE":
      return "active";
    case "ending":
    case "VOICE_CALL_STATE_ENDING":
      return "ending";
    case "ended":
    case "VOICE_CALL_STATE_ENDED":
      return "ended";
    default:
      return "ringing";
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function voiceCallEventFromNotification(
  notification: Notification,
): VoiceCallStreamEvent | null {
  if (!isVoiceCallNotificationType(notification.notificationType)) {
    return null;
  }

  const voiceCall = notification.payload?.voiceCall;
  if (!voiceCall?.channelId) {
    return null;
  }

  return {
    channelId: voiceCall.channelId,
    callId: stringValue(voiceCall.callId),
    action: stringValue(voiceCall.action),
    state: stringValue(voiceCall.state),
    participantCount: voiceCall.participantCount || undefined,
    notificationType: notification.notificationType,
    invitationId: stringValue(voiceCall.invitationId),
    initiatorEmployeeId: stringValue(voiceCall.initiatorEmployeeId),
    alreadyInAnotherCall: voiceCall.alreadyInAnotherCall,
  };
}

export function voiceCallEventKey(event: VoiceCallStreamEvent): string {
  return [
    event.notificationType,
    event.channelId,
    event.callId ?? "",
    event.action ?? "",
    event.state ?? "",
    event.invitationId ?? "",
  ].join(":");
}

export function dispatchVoiceCallStreamEvent(event: VoiceCallStreamEvent) {
  window.dispatchEvent(
    new CustomEvent<VoiceCallStreamEvent>(VOICE_CALL_EVENT_NAME, {
      detail: event,
    }),
  );
}

export function dispatchAcceptedVoiceCall(payload: AcceptedVoiceCallPayload) {
  window.dispatchEvent(
    new CustomEvent<AcceptedVoiceCallPayload>(VOICE_CALL_ACCEPTED_EVENT_NAME, {
      detail: payload,
    }),
  );
}

export function storeAcceptedVoiceCall(payload: AcceptedVoiceCallPayload) {
  if (typeof window === "undefined") {
    return;
  }
  window.sessionStorage.setItem(
    VOICE_CALL_ACCEPTED_STORAGE_KEY,
    JSON.stringify(payload),
  );
}

export function consumeStoredAcceptedVoiceCall(
  channelId: string,
): AcceptedVoiceCallPayload | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(VOICE_CALL_ACCEPTED_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AcceptedVoiceCallPayload;
    if (parsed.channelId !== channelId) {
      return null;
    }
    window.sessionStorage.removeItem(VOICE_CALL_ACCEPTED_STORAGE_KEY);
    return parsed;
  } catch {
    window.sessionStorage.removeItem(VOICE_CALL_ACCEPTED_STORAGE_KEY);
    return null;
  }
}
