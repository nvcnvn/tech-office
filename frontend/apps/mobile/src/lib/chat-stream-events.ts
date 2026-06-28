interface ChatStreamPayload {
  notification?: {
    sourceDomain?: string;
    notificationType?: string;
    actionData?: Record<string, string | undefined>;
  };
  sourceDomain?: string;
  notificationType?: string;
  actionData?: Record<string, string | undefined>;
  action_data?: Record<string, string | undefined>;
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
  const actionData =
    payload.notification?.actionData ?? payload.actionData ?? payload.action_data;

  return {
    sourceDomain: payload.notification?.sourceDomain ?? payload.sourceDomain,
    notificationType:
      payload.notification?.notificationType ?? payload.notificationType,
    channelId: actionData?.channelId ?? payload.channelId ?? payload.channel_id,
    callId: actionData?.callId ?? payload.callId ?? payload.call_id,
    invitationId:
      actionData?.invitationId ?? payload.invitationId ?? payload.invitation_id,
    initiatorEmployeeId:
      actionData?.initiatorEmployeeId ??
      payload.initiatorEmployeeId ??
      payload.initiator_employee_id,
    alreadyInAnotherCall:
      (actionData?.alreadyInAnotherCall ??
        payload.alreadyInAnotherCall ??
        payload.already_in_another_call) === "true",
    state: actionData?.state ?? payload.state,
    action: actionData?.action ?? payload.action,
    participantCount:
      actionData?.participantCount || payload.participantCount || payload.participant_count
        ? Number(actionData?.participantCount ?? payload.participantCount ?? payload.participant_count)
        : undefined,
    messageId: actionData?.messageId ?? payload.messageId ?? payload.message_id,
    parentMessageId:
      actionData?.parentMessageId ??
      payload.parentMessageId ??
      payload.parent_message_id,
  };
}