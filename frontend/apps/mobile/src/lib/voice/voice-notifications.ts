import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export const VOICE_CALL_NOTIFICATION_CHANNEL_ID = "voice-calls";

const incomingCallAlertWindowMs = 8_000;
const incomingCallAlertSeenAt = new Map<string, number>();

interface IncomingVoiceCallNotificationParams {
  title?: string | null;
  body?: string | null;
  targetHref?: string | null;
  sourceDomain?: string;
  channelId?: string;
  callId?: string;
  invitationId?: string;
  alreadyInAnotherCall?: boolean;
}

function chatHrefForChannel(channelId: string | undefined): string | null {
  return channelId ? `/(app)/(chat)/${channelId}` : null;
}

export async function ensureVoiceCallNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync(VOICE_CALL_NOTIFICATION_CHANNEL_ID, {
    name: "Voice calls",
    importance: Notifications.AndroidImportance.MAX,
    enableVibrate: true,
    vibrationPattern: [0, 250, 200, 250, 200, 450],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    audioAttributes: {
      usage: Notifications.AndroidAudioUsage.NOTIFICATION_COMMUNICATION_REQUEST,
      contentType: Notifications.AndroidAudioContentType.SONIFICATION,
    },
  });
}

export async function scheduleIncomingVoiceCallNotification({
  title,
  body,
  targetHref,
  sourceDomain = "chat",
  channelId,
  callId,
  invitationId,
  alreadyInAnotherCall = false,
}: IncomingVoiceCallNotificationParams): Promise<void> {
  const dedupeKey = invitationId ?? callId;
  const now = Date.now();

  if (dedupeKey) {
    const seenAt = incomingCallAlertSeenAt.get(dedupeKey);
    if (seenAt && now - seenAt <= incomingCallAlertWindowMs) {
      return;
    }
    incomingCallAlertSeenAt.set(dedupeKey, now);
  }

  incomingCallAlertSeenAt.forEach((seenAt, key) => {
    if (now - seenAt > incomingCallAlertWindowMs) {
      incomingCallAlertSeenAt.delete(key);
    }
  });

  await ensureVoiceCallNotificationChannel();

  const resolvedBody =
    body?.trim() ||
    (alreadyInAnotherCall
      ? "Switch to answer, or stay in your current call."
      : "Answer from this conversation.");

  await Notifications.scheduleNotificationAsync({
    content: {
      title: title?.trim() || "Incoming voice call",
      body: resolvedBody,
      data: {
        href: chatHrefForChannel(channelId) ?? targetHref ?? undefined,
        sourceDomain,
        notificationType: "voice_call_incoming",
        navigationDomain: sourceDomain,
        navigationResourceType: "channel",
        navigationResourceId: channelId,
        navigationSecondaryId: invitationId,
        navigationAction: "join_voice_call",
        channelId,
        callId,
        invitationId,
      },
      sound: "default",
      interruptionLevel: "timeSensitive",
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: [0, 250, 200, 250, 200, 450],
    },
    trigger:
      Platform.OS === "android"
        ? { channelId: VOICE_CALL_NOTIFICATION_CHANNEL_ID }
        : null,
  });
}