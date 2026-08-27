import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ConnectionQuality,
  type DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from "livekit-client";
import {
  endVoiceCall,
  getActiveVoiceCall,
  isExpectedVoiceDisconnect,
  joinVoiceCall,
  leaveVoiceCall,
  respondToVoiceCallInvite,
  startVoiceCall,
  voiceCallErrorMessage,
  voiceCallStateToString,
  type VoiceCallSession as ApiVoiceCallSession,
  type VoiceJoinCredentials as ApiVoiceJoinCredentials,
} from "apis";
import {
  consumeStoredAcceptedVoiceCall,
  VOICE_CALL_ACCEPTED_EVENT_NAME,
  VOICE_CALL_EVENT_NAME,
  type AcceptedVoiceCallPayload,
  type VoiceCallStreamEvent,
} from "../../voice/voiceCallEvents";

export type VoiceCallState = "idle" | "ringing" | "active" | "ending" | "ended";
export type VoiceConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";
export type VoiceConnectionQuality = "unknown" | "good" | "degraded";

export interface VoiceCallSessionSummary {
  id: string;
  channelId: string;
  state: Exclude<VoiceCallState, "idle">;
  participantCount: number;
  startedAt?: string;
  endedAt?: string;
}

export interface VoiceJoinCredentials {
  livekitUrl: string;
  livekitToken: string;
  roomName: string;
  expiresAt?: string;
}

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

function toSessionSummary(
  call: ApiVoiceCallSession | undefined | null,
): VoiceCallSessionSummary | null {
  if (!call?.id || !call.channelId) {
    return null;
  }
  return {
    id: call.id,
    channelId: call.channelId,
    state: voiceCallStateToString(call.state),
    participantCount: call.participants?.length ?? 0,
    startedAt: timestampToIso(call.startedAt),
    endedAt: timestampToIso(call.endedAt),
  };
}

function toJoinCredentials(
  credentials: ApiVoiceJoinCredentials | undefined | null,
): VoiceJoinCredentials | null {
  if (!credentials?.livekitToken || !credentials.roomName) {
    return null;
  }
  return {
    livekitUrl: credentials.livekitUrl,
    livekitToken: credentials.livekitToken,
    roomName: credentials.roomName,
    expiresAt: timestampToIso(credentials.expiresAt),
  };
}

function acceptedCallToSessionSummary(
  acceptedCall: AcceptedVoiceCallPayload,
): VoiceCallSessionSummary {
  return {
    id: acceptedCall.callId,
    channelId: acceptedCall.channelId,
    state: acceptedCall.state,
    participantCount: acceptedCall.participantCount,
  };
}

function normalizeLiveKitQuality(quality: unknown): VoiceConnectionQuality {
  if (
    quality === ConnectionQuality.Poor ||
    quality === ConnectionQuality.Lost
  ) {
    return "degraded";
  }
  if (
    quality === ConnectionQuality.Good ||
    quality === ConnectionQuality.Excellent
  ) {
    return "good";
  }

  const normalized = String(quality).toLowerCase();
  if (normalized.includes("poor") || normalized.includes("lost")) {
    return "degraded";
  }
  if (normalized.includes("good") || normalized.includes("excellent")) {
    return "good";
  }
  return "unknown";
}

function toVoiceCallError(error: unknown, fallback: string): Error {
  return new Error(voiceCallErrorMessage(error, fallback));
}

export interface UseVoiceCallOptions {
  channelId?: string;
  enabled?: boolean;
}

export interface UseVoiceCallResult {
  call: VoiceCallSessionSummary | null;
  state: VoiceCallState;
  connectionState: VoiceConnectionState;
  connectionQuality: VoiceConnectionQuality;
  connectedParticipantCount: number;
  joinCredentials: VoiceJoinCredentials | null;
  isLoading: boolean;
  error: Error | null;
  canStart: boolean;
  canJoin: boolean;
  canLeave: boolean;
  isConnected: boolean;
  /** True when the browser's autoplay policy has blocked remote audio playback. */
  isAudioPlaybackBlocked: boolean;
  setActiveCall: (call: VoiceCallSessionSummary | null) => void;
  setConnectionQuality: (quality: VoiceConnectionQuality) => void;
  startCall: () => Promise<void>;
  joinCall: () => Promise<void>;
  acceptInvite: (
    invitationId: string,
    incomingCall?: VoiceCallSessionSummary | null,
  ) => Promise<void>;
  leaveCall: () => Promise<void>;
  endCall: () => Promise<void>;
  reset: () => void;
  /** Call from a user interaction to unlock blocked remote audio playback. */
  startAudio: () => void;
}

export function useVoiceCall(
  options: UseVoiceCallOptions = {},
): UseVoiceCallResult {
  const { channelId, enabled = true } = options;
  const queryClient = useQueryClient();
  const [call, setCall] = useState<VoiceCallSessionSummary | null>(null);
  const [joinCredentials, setJoinCredentials] =
    useState<VoiceJoinCredentials | null>(null);
  const [connectionState, setConnectionState] =
    useState<VoiceConnectionState>("idle");
  const [connectionQuality, setConnectionQuality] =
    useState<VoiceConnectionQuality>("unknown");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [joinedCallId, setJoinedCallId] = useState<string | null>(null);
  const [connectedParticipantCount, setConnectedParticipantCount] = useState(0);
  const [isAudioPlaybackBlocked, setIsAudioPlaybackBlocked] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const mediaConnectionAttemptRef = useRef(0);
  const remoteAudioElementsRef = useRef<Set<HTMLMediaElement>>(new Set());
  // Ref to track the current call ID and joinedCallId inside event handler closures.
  const callIdRef = useRef<string | null>(null);
  const joinedCallIdRef = useRef<string | null>(null);

  const state = call?.state ?? "idle";

  // Keep refs in sync so event handlers can read the latest values without
  // being recreated on every render.
  callIdRef.current = call?.id ?? null;
  joinedCallIdRef.current = joinedCallId;

  const invalidateChannelVoiceState = useCallback(() => {
    if (!channelId) {
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
    queryClient.invalidateQueries({ queryKey: ["channels"] });
    queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
  }, [channelId, queryClient]);

  const detachRemoteAudio = useCallback(() => {
    for (const element of remoteAudioElementsRef.current) {
      element.remove();
    }
    remoteAudioElementsRef.current.clear();
  }, []);

  const disconnectMedia = useCallback(
    async (nextConnectionState: VoiceConnectionState = "disconnected") => {
      mediaConnectionAttemptRef.current += 1;
      const room = roomRef.current;
      roomRef.current = null;
      if (room) {
        await room.localParticipant
          .setMicrophoneEnabled(false)
          .catch(() => undefined);
        await room.disconnect();
      }
      detachRemoteAudio();
      setJoinCredentials(null);
      setConnectionState(nextConnectionState);
      setConnectionQuality("unknown");
      setConnectedParticipantCount(0);
    },
    [detachRemoteAudio],
  );

  const connectMedia = useCallback(
    async (credentials: VoiceJoinCredentials) => {
      await disconnectMedia();

      const livekitUrl = credentials.livekitUrl.trim();
      if (!livekitUrl) {
        throw new Error("Voice call is missing a LiveKit URL.");
      }

      // adaptiveStream and dynacast are video-optimisation features that trigger
      // extra SDP renegotiations.  Disable them for audio-only calls to avoid
      // spurious NegotiationError timeouts.
      const room = new Room({ adaptiveStream: false, dynacast: false });
      const attemptId = mediaConnectionAttemptRef.current + 1;
      mediaConnectionAttemptRef.current = attemptId;

      const isCurrentAttempt = () =>
        mediaConnectionAttemptRef.current === attemptId &&
        roomRef.current === room;

      const attachRemoteAudioTrack = (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) {
          return;
        }

        const element = track.attach();
        element.autoplay = true;
        element.hidden = true;
        element.dataset.techOfficeVoice = "remote-audio";
        document.body.appendChild(element);
        remoteAudioElementsRef.current.add(element);
        void element.play().catch(() => undefined);
      };

      const detachRemoteAudioTrack = (track: RemoteTrack) => {
        for (const element of track.detach()) {
          remoteAudioElementsRef.current.delete(element);
          element.remove();
        }
      };

      room
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          setIsAudioPlaybackBlocked(!room.canPlaybackAudio);
        })
        .on(RoomEvent.Reconnecting, () => {
          setConnectionState("reconnecting");
        })
        .on(RoomEvent.Reconnected, () => {
          setConnectionState("connected");
          setConnectionQuality("good");
          // Re-attempt audio unlock after reconnect in case context was lost.
          void room.startAudio();
        })
        .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
          if (roomRef.current === room) {
            // A disconnect we did not route through disconnectMedia: either the
            // call ended server-side (room deleted/closed) or the transport
            // failed. Clean up and tell the backend we left either way, but only
            // the failure is worth showing to the user.
            roomRef.current = null;
            detachRemoteAudio();
            setJoinCredentials(null);
            setConnectionState("disconnected");
            setConnectionQuality("unknown");
            setConnectedParticipantCount(0);
            const callId = callIdRef.current;
            if (joinedCallIdRef.current && callId) {
              setJoinedCallId(null);
              setError(
                isExpectedVoiceDisconnect(reason)
                  ? null
                  : new Error("Disconnected from call"),
              );
              void leaveVoiceCall(callId).catch(() => undefined);
            }
          }
        })
        .on(RoomEvent.ParticipantConnected, () => {
          setConnectedParticipantCount(1 + room.remoteParticipants.size);
        })
        .on(RoomEvent.ParticipantDisconnected, () => {
          setConnectedParticipantCount(1 + room.remoteParticipants.size);
        })
        .on(
          RoomEvent.ConnectionQualityChanged,
          (quality: ConnectionQuality, participant: Participant) => {
            if (participant === room.localParticipant) {
              setConnectionQuality(normalizeLiveKitQuality(quality));
            }
          },
        )
        .on(RoomEvent.TrackSubscribed, attachRemoteAudioTrack)
        .on(RoomEvent.TrackUnsubscribed, detachRemoteAudioTrack);

      roomRef.current = room;
      setJoinCredentials({ ...credentials, livekitUrl });
      setConnectionState("connecting");
      setConnectionQuality("unknown");
      // Unlock the browser's AudioContext while we are still within the user-
      // gesture callback chain.  This must happen before the async connect so
      // that remote audio elements created after the room connects are allowed
      // to autoplay by the browser's autoplay policy.
      void room.startAudio();
      try {
        await room.connect(livekitUrl, credentials.livekitToken, {
          autoSubscribe: true,
          // 30 s instead of the default 15 s — the extra headroom prevents
          // spurious NegotiationError timeouts when the browser tab is in the
          // background and setTimeout gets throttled by the engine.
          peerConnectionTimeout: 30_000,
        });
        if (!isCurrentAttempt()) {
          room.disconnect();
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!isCurrentAttempt()) {
          await room.localParticipant
            .setMicrophoneEnabled(false)
            .catch(() => undefined);
          room.disconnect();
          return;
        }
        // Attempt audio unlock again after all async setup is complete.  The
        // browser may have suspended the AudioContext during the await chain;
        // calling startAudio() here ensures playback resumes.
        await room.startAudio();
        setIsAudioPlaybackBlocked(!room.canPlaybackAudio);
        setConnectionState("connected");
        setConnectionQuality("good");
        setConnectedParticipantCount(1 + room.remoteParticipants.size);
      } catch (nextError) {
        if (!isCurrentAttempt()) {
          // Torn down on purpose while connecting — the call ended, or a newer
          // attempt replaced this one. LiveKit rejects the pending connect with
          // "Client initiated disconnect"; that is bookkeeping, not an error.
          return;
        }
        await disconnectMedia();
        throw nextError;
      }
    },
    [detachRemoteAudio, disconnectMedia],
  );

  const connectMediaInBackground = useCallback(
    (credentials: VoiceJoinCredentials) => {
      void connectMedia(credentials).catch((nextError: unknown) => {
        setError(toVoiceCallError(nextError, "Failed to connect voice audio."));
      });
    },
    [connectMedia],
  );

  const reset = useCallback(() => {
    void disconnectMedia("idle");
    setCall(null);
    setJoinedCallId(null);
    setConnectionState("idle");
    setConnectionQuality("unknown");
    setIsLoading(false);
    setError(null);
  }, [disconnectMedia]);

  const setActiveCall = useCallback(
    (nextCall: VoiceCallSessionSummary | null) => {
      if (!enabled) {
        return;
      }

      setCall(nextCall);
      setError(null);
    },
    [enabled],
  );

  const adoptAcceptedVoiceCall = useCallback(
    (acceptedCall: AcceptedVoiceCallPayload) => {
      if (!enabled || acceptedCall.channelId !== channelId) {
        return;
      }
      const nextCall = acceptedCallToSessionSummary(acceptedCall);
      setCall(nextCall);
      setJoinedCallId(nextCall.id);
      setError(null);
      setIsLoading(false);
      if (acceptedCall.joinCredentials) {
        connectMediaInBackground(acceptedCall.joinCredentials);
      } else {
        setConnectionState("disconnected");
        setConnectionQuality("unknown");
      }
      invalidateChannelVoiceState();
    },
    [channelId, connectMediaInBackground, enabled, invalidateChannelVoiceState],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleQualityEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ quality?: string }>).detail;
      if (detail?.quality === "poor" || detail?.quality === "degraded") {
        setConnectionQuality("degraded");
      } else if (detail?.quality === "good") {
        setConnectionQuality("good");
      }
    };

    window.addEventListener("tech-office:voice-quality", handleQualityEvent);
    return () => {
      window.removeEventListener(
        "tech-office:voice-quality",
        handleQualityEvent,
      );
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !channelId) {
      reset();
      return;
    }

    const acceptedCall = consumeStoredAcceptedVoiceCall(channelId);
    if (acceptedCall) {
      adoptAcceptedVoiceCall(acceptedCall);
    }

    let cancelled = false;
    setIsLoading(true);
    getActiveVoiceCall(channelId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setCall(
          response.hasActiveCall ? toSessionSummary(response.call) : null,
        );
        setError(null);
      })
      .catch((nextError: unknown) => {
        if (!cancelled) {
          setError(
            toVoiceCallError(nextError, "Failed to load active voice call."),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adoptAcceptedVoiceCall, channelId, enabled, reset]);

  useEffect(() => {
    if (!enabled || !channelId) {
      return;
    }

    const handleAcceptedVoiceCall = (event: Event) => {
      const detail = (event as CustomEvent<AcceptedVoiceCallPayload>).detail;
      if (detail?.channelId === channelId) {
        adoptAcceptedVoiceCall(detail);
      }
    };

    window.addEventListener(
      VOICE_CALL_ACCEPTED_EVENT_NAME,
      handleAcceptedVoiceCall,
    );
    return () => {
      window.removeEventListener(
        VOICE_CALL_ACCEPTED_EVENT_NAME,
        handleAcceptedVoiceCall,
      );
    };
  }, [adoptAcceptedVoiceCall, channelId, enabled]);

  useEffect(() => {
    if (!enabled || !channelId) {
      return;
    }

    let cancelled = false;
    const refreshActiveCall = () => {
      getActiveVoiceCall(channelId)
        .then((response) => {
          if (cancelled) {
            return;
          }
          setCall(
            response.hasActiveCall ? toSessionSummary(response.call) : null,
          );
          setError(null);
        })
        .catch((nextError: unknown) => {
          if (!cancelled) {
            setError(
              toVoiceCallError(nextError, "Failed to refresh voice call."),
            );
          }
        });
    };

    const handleVoiceEvent = (event: Event) => {
      const detail = (event as CustomEvent<VoiceCallStreamEvent>).detail;
      if (detail?.channelId !== channelId) {
        return;
      }
      if (
        detail.notificationType === "voice_call_ended" ||
        detail.state === "VOICE_CALL_STATE_ENDED"
      ) {
        if (
          detail.callId &&
          callIdRef.current &&
          detail.callId !== callIdRef.current
        ) {
          // A late "ended" for a previous call in this channel must not wipe
          // the call that replaced it.
          return;
        }
        setCall(null);
        setJoinedCallId(null);
        setError(null);
        void disconnectMedia();
        invalidateChannelVoiceState();
        return;
      }
      invalidateChannelVoiceState();
      refreshActiveCall();
    };

    window.addEventListener(VOICE_CALL_EVENT_NAME, handleVoiceEvent);
    return () => {
      cancelled = true;
      window.removeEventListener(VOICE_CALL_EVENT_NAME, handleVoiceEvent);
    };
  }, [channelId, disconnectMedia, enabled, invalidateChannelVoiceState]);

  const startCall = useCallback(async () => {
    if (!enabled || !channelId) {
      return;
    }

    setIsLoading(true);
    setConnectionState("connecting");
    setError(null);
    try {
      const response = await startVoiceCall({ channelId });
      const credentials = toJoinCredentials(response.joinCredentials);
      const nextCall = toSessionSummary(response.call);
      setCall(nextCall);
      if (nextCall) {
        setJoinedCallId(nextCall.id);
      }
      if (credentials) {
        connectMediaInBackground(credentials);
      } else {
        setConnectionState("disconnected");
        setConnectionQuality("unknown");
      }
      invalidateChannelVoiceState();
    } catch (nextError) {
      setConnectionState("disconnected");
      setError(toVoiceCallError(nextError, "Failed to start voice call."));
    } finally {
      setIsLoading(false);
    }
  }, [
    channelId,
    connectMediaInBackground,
    enabled,
    invalidateChannelVoiceState,
  ]);

  const joinCall = useCallback(async () => {
    if (!enabled || !call) {
      return;
    }

    setIsLoading(true);
    setConnectionState("connecting");
    setError(null);
    try {
      const response = await joinVoiceCall(call.id);
      const credentials = toJoinCredentials(response.joinCredentials);
      const nextCall = toSessionSummary(response.call);
      setCall(nextCall);
      if (nextCall) {
        setJoinedCallId(nextCall.id);
      }
      if (credentials) {
        connectMediaInBackground(credentials);
      } else {
        setConnectionState("disconnected");
        setConnectionQuality("unknown");
      }
      invalidateChannelVoiceState();
    } catch (nextError) {
      setConnectionState("disconnected");
      setError(toVoiceCallError(nextError, "Failed to join voice call."));
    } finally {
      setIsLoading(false);
    }
  }, [call, connectMediaInBackground, enabled, invalidateChannelVoiceState]);

  const acceptInvite = useCallback(
    async (
      invitationId: string,
      incomingCall?: VoiceCallSessionSummary | null,
    ) => {
      if (!enabled || !invitationId) {
        return;
      }

      setIsLoading(true);
      setConnectionState("connecting");
      setError(null);
      try {
        const response = await respondToVoiceCallInvite({
          invitationId,
          response: "accept",
        });
        const nextCredentials = toJoinCredentials(response.joinCredentials);
        let nextCall: VoiceCallSessionSummary | null = incomingCall ?? null;
        if (incomingCall) {
          setCall(incomingCall);
        } else if (channelId) {
          const activeResponse = await getActiveVoiceCall(channelId);
          nextCall = activeResponse.hasActiveCall
            ? toSessionSummary(activeResponse.call)
            : null;
          setCall(nextCall);
        }
        if (nextCall) {
          setJoinedCallId(nextCall.id);
        }
        if (nextCredentials) {
          connectMediaInBackground(nextCredentials);
        } else {
          setConnectionState("disconnected");
          setConnectionQuality("unknown");
        }
        invalidateChannelVoiceState();
      } catch (nextError) {
        setConnectionState("disconnected");
        setError(toVoiceCallError(nextError, "Failed to answer voice call."));
        throw nextError;
      } finally {
        setIsLoading(false);
      }
    },
    [channelId, connectMediaInBackground, enabled, invalidateChannelVoiceState],
  );

  const leaveCall = useCallback(async () => {
    if (!enabled || !call) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await leaveVoiceCall(call.id);
      const nextCall = toSessionSummary(response.call);
      setCall(nextCall?.state === "ended" ? null : nextCall);
      setJoinedCallId(null);
      await disconnectMedia();
      invalidateChannelVoiceState();
    } catch (nextError) {
      setError(toVoiceCallError(nextError, "Failed to leave voice call."));
    } finally {
      setIsLoading(false);
    }
  }, [call, disconnectMedia, enabled, invalidateChannelVoiceState]);

  const endCall = useCallback(async () => {
    if (!enabled || !call) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await endVoiceCall(call.id);
      setCall(null);
      setJoinedCallId(null);
      await disconnectMedia();
      invalidateChannelVoiceState();
    } catch (nextError) {
      setError(toVoiceCallError(nextError, "Failed to end voice call."));
    } finally {
      setIsLoading(false);
    }
  }, [call, disconnectMedia, enabled, invalidateChannelVoiceState]);

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (room) {
        room.disconnect();
      }
      detachRemoteAudio();
      // If the component unmounts while still joined (e.g. page navigation),
      // call the leave API so the backend doesn't keep a stale participant.
      const callId = callIdRef.current;
      if (joinedCallIdRef.current && callId) {
        void leaveVoiceCall(callId).catch(() => undefined);
      }
    };
  }, [detachRemoteAudio]);

  const canStart = Boolean(enabled && channelId && !call && !isLoading);
  const canJoin = Boolean(
    enabled &&
      call &&
      !joinedCallId &&
      connectionState !== "connecting" &&
      !isLoading,
  );
  const canLeave = Boolean(enabled && call && joinedCallId === call.id);
  const isConnected = connectionState === "connected";

  const startAudio = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      void room.startAudio();
    }
  }, []);

  return useMemo(
    () => ({
      call,
      state,
      connectionState,
      connectionQuality,
      connectedParticipantCount,
      joinCredentials,
      isLoading,
      error,
      canStart,
      canJoin,
      canLeave,
      isConnected,
      isAudioPlaybackBlocked,
      setActiveCall,
      setConnectionQuality,
      startCall,
      joinCall,
      acceptInvite,
      leaveCall,
      endCall,
      reset,
      startAudio,
    }),
    [
      call,
      state,
      connectionState,
      connectionQuality,
      connectedParticipantCount,
      joinCredentials,
      isLoading,
      error,
      canStart,
      canJoin,
      canLeave,
      isConnected,
      isAudioPlaybackBlocked,
      setActiveCall,
      setConnectionQuality,
      startCall,
      joinCall,
      acceptInvite,
      leaveCall,
      endCall,
      reset,
      startAudio,
    ],
  );
}
