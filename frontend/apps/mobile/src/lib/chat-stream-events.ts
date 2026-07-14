import type { notification as NotificationProto } from "rpc";

type RawNotificationPayload = {
  chat?: Partial<NotificationProto.ChatNotificationPayload>;
  voiceCall?: Partial<NotificationProto.VoiceCallNotificationPayload>;
};

interface ChatStreamPayload {
  notification?: {
    sourceDomain?: string;
    notificationType?: string;
    payload?: RawNotificationPayload;
  };
  sourceDomain?: string;
  notificationType?: string;
  channelId?: string;
  channel_id?: string;
  callId?: string;
  call_id?: string;
  invitationId?: string;
  invitation_id?: string;
  initiatorEmployeeId?: string;
  initiator_employee_id?: string;
  alreadyInAnotherCall?: string;
  already_in_another_call?: string;
  state?: string;
  action?: string;
  participantCount?: string;
  participant_count?: string;
  messageId?: string;
  message_id?: string;
  parentMessageId?: string;
  parent_message_id?: string;
}

export interface ChatStreamEventMeta {
  sourceDomain?: string;
  notificationType?: string;
  channelId?: string;
  callId?: string;
  invitationId?: string;
  initiatorEmployeeId?: string;
  alreadyInAnotherCall?: boolean;
  state?: string;
  action?: string;
  participantCount?: number;
  messageId?: string;
  parentMessageId?: string;
}

export function parseChatStreamEvent(rawData: string): ChatStreamEventMeta | null {
  const payload = JSON.parse(rawData) as ChatStreamPayload;
  const typedPayload = payload.notification?.payload;
  const typedChat = typedPayload?.chat;
  const typedVoiceCall = typedPayload?.voiceCall;

  return {
    sourceDomain: payload.notification?.sourceDomain ?? payload.sourceDomain,
    notificationType:
      payload.notification?.notificationType ?? payload.notificationType,
    channelId:
      typedVoiceCall?.channelId ??
      typedChat?.channelId ??
      payload.channelId ??
      payload.channel_id,
    callId: typedVoiceCall?.callId ?? payload.callId ?? payload.call_id,
    invitationId:
      typedVoiceCall?.invitationId ??
      payload.invitationId ??
      payload.invitation_id,
    initiatorEmployeeId:
      typedVoiceCall?.initiatorEmployeeId ??
      payload.initiatorEmployeeId ??
      payload.initiator_employee_id,
    alreadyInAnotherCall:
      typedVoiceCall?.alreadyInAnotherCall ??
      ((payload.alreadyInAnotherCall ?? payload.already_in_another_call) === "true"),
    state: typedVoiceCall?.state ?? payload.state,
    action: typedVoiceCall?.action ?? typedChat?.action ?? payload.action,
    participantCount:
      typedVoiceCall?.participantCount ??
      (payload.participantCount || payload.participant_count
        ? Number(payload.participantCount ?? payload.participant_count)
        : undefined),
    messageId:
      typedChat?.messageId ?? payload.messageId ?? payload.message_id,
    parentMessageId:
      typedChat?.parentMessageId ??
      payload.parentMessageId ??
      payload.parent_message_id,
  };
}