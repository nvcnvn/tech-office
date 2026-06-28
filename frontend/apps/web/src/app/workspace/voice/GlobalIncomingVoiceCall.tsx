"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  getActiveVoiceCall,
  respondToVoiceCallInvite,
  voiceCallStateToString,
  type VoiceJoinCredentials as ApiVoiceJoinCredentials,
} from "apis";
import { IncomingCallDialog } from "../chat/components/voice/IncomingCallDialog";
import {
  dispatchAcceptedVoiceCall,
  storeAcceptedVoiceCall,
  streamStateToVoiceState,
  VOICE_CALL_EVENT_NAME,
  type AcceptedVoiceCallPayload,
  type VoiceCallStreamEvent,
  type VoiceJoinCredentialsPayload,
} from "./voiceCallEvents";
import { versionedPublicAssetPath } from "@/lib/publicAsset";

function timestampToIso(
  timestamp?: { seconds?: bigint | number | string; nanos?: number } | null,
): string | undefined {
  if (!timestamp?.seconds) {
    return undefined;
  }
  const seconds = Number(timestamp.seconds);
  const millis =
    seconds * 1000 + Math.floor((timestamp.nanos ?? 0) / 1_000_000);
  return new Date(millis).toISOString();
}

function toJoinCredentialsPayload(
  credentials: ApiVoiceJoinCredentials | undefined | null,
): VoiceJoinCredentialsPayload | undefined {
  if (!credentials?.livekitToken || !credentials.roomName) {
    return undefined;
  }
  return {
    livekitUrl: credentials.livekitUrl,
    livekitToken: credentials.livekitToken,
    roomName: credentials.roomName,
    expiresAt: timestampToIso(credentials.expiresAt),
  };
}

export function GlobalIncomingVoiceCall() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [incomingCall, setIncomingCall] = useState<VoiceCallStreamEvent | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleVoiceEvent = (event: Event) => {
      const detail = (event as CustomEvent<VoiceCallStreamEvent>).detail;
      if (!detail?.channelId) {
        return;
      }
      if (
        detail.notificationType === "voice_call_incoming" &&
        detail.invitationId
      ) {
        setIncomingCall(detail);
        return;
      }
      if (
        detail.notificationType === "voice_call_ended" ||
        detail.state === "VOICE_CALL_STATE_ENDED"
      ) {
        setIncomingCall((current) =>
          current?.callId === detail.callId ? null : current,
        );
      }
    };

    window.addEventListener(VOICE_CALL_EVENT_NAME, handleVoiceEvent);
    return () => {
      window.removeEventListener(VOICE_CALL_EVENT_NAME, handleVoiceEvent);
    };
  }, []);

  useEffect(() => {
    if (!incomingCall || isLoading) {
      return;
    }

    const audio = new Audio(versionedPublicAssetPath("/sounds/call.mp3"));
    audio.loop = true;
    audio.preload = "auto";
    void audio.play().catch(() => undefined);

    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, [incomingCall, isLoading]);

  const invalidateVoiceState = useCallback(
    (channelId: string) => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
      queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
    },
    [queryClient],
  );

  const handleAccept = useCallback(async () => {
    if (!incomingCall?.invitationId || !incomingCall.callId) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await respondToVoiceCallInvite({
        invitationId: incomingCall.invitationId,
        response: "accept",
      });
      const activeResponse = await getActiveVoiceCall(
        incomingCall.channelId,
      ).catch(() => null);
      const activeCall = activeResponse?.hasActiveCall
        ? activeResponse.call
        : null;
      const payload: AcceptedVoiceCallPayload = {
        channelId: incomingCall.channelId,
        callId: activeCall?.id || incomingCall.callId,
        state: activeCall
          ? voiceCallStateToString(activeCall.state)
          : streamStateToVoiceState(incomingCall.state),
        participantCount:
          activeCall?.participants?.length ??
          incomingCall.participantCount ??
          1,
        joinCredentials: toJoinCredentialsPayload(response.joinCredentials),
      };
      storeAcceptedVoiceCall(payload);
      dispatchAcceptedVoiceCall(payload);
      invalidateVoiceState(incomingCall.channelId);
      setIncomingCall(null);
      router.push(
        `/workspace/chat?channel=${encodeURIComponent(incomingCall.channelId)}`,
      );
    } finally {
      setIsLoading(false);
    }
  }, [incomingCall, invalidateVoiceState, router]);

  const handleDecline = useCallback(async () => {
    if (!incomingCall?.invitationId) {
      setIncomingCall(null);
      return;
    }
    setIsLoading(true);
    try {
      await respondToVoiceCallInvite({
        invitationId: incomingCall.invitationId,
        response: "decline",
      });
      invalidateVoiceState(incomingCall.channelId);
      setIncomingCall(null);
    } finally {
      setIsLoading(false);
    }
  }, [incomingCall, invalidateVoiceState]);

  return (
    <IncomingCallDialog
      open={Boolean(incomingCall)}
      alreadyInAnotherCall={incomingCall?.alreadyInAnotherCall}
      isLoading={isLoading}
      onAccept={handleAccept}
      onDecline={handleDecline}
      onClose={() => setIncomingCall(null)}
    />
  );
}
