import { isExpectedVoiceDisconnect } from "apis";

export type VoiceClientConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "disconnected";

export type VoiceClientConnectionQuality = "unknown" | "good" | "degraded";

export interface VoiceJoinCredentials {
  livekitUrl: string;
  livekitToken: string;
  roomName: string;
  expiresAt?: string;
  activeCallId?: string;
  activeChannelId?: string;
}

export interface VoiceClientSnapshot {
  connectionState: VoiceClientConnectionState;
  connectionQuality: VoiceClientConnectionQuality;
  credentials: VoiceJoinCredentials | null;
  activeCallId: string | null;
  activeChannelId: string | null;
  isMuted: boolean;
  /**
   * How many other people are in the room right now. Zero on a call the caller
   * started means it is still ringing: the caller is alone in a room nobody has
   * answered, which is a different thing to say than "in voice call".
   */
  remoteParticipantCount: number;
  error: string | null;
}

export type VoiceClientListener = (snapshot: VoiceClientSnapshot) => void;
export type VoiceClientUnsubscribe = () => void;

export class VoiceClient {
  private room: any | null = null;
  private audioSession: any | null = null;
  // True while disconnect() is actively closing the room (deliberate hangup).
  private deliberateDisconnect = false;

  private snapshot: VoiceClientSnapshot = {
    connectionState: "idle",
    connectionQuality: "unknown",
    credentials: null,
    activeCallId: null,
    activeChannelId: null,
    isMuted: false,
    remoteParticipantCount: 0,
    error: null,
  };

  private readonly listeners = new Set<VoiceClientListener>();

  getSnapshot(): VoiceClientSnapshot {
    return this.snapshot;
  }

  subscribe(listener: VoiceClientListener): VoiceClientUnsubscribe {
    this.listeners.add(listener);
    listener(this.snapshot);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * When true, the native call framework (CallKit / Telecom) owns the audio session
   * and LiveKit must not touch it. Both frameworks want the session, and whichever
   * loses produces a call that connects with nobody able to hear.
   */
  private audioSessionOwnedExternally = false;

  setAudioSessionOwnedExternally(owned: boolean): void {
    this.audioSessionOwnedExternally = owned;
  }

  async connect(credentials: VoiceJoinCredentials): Promise<void> {
    await this.disconnect();

    this.update({
      connectionState: "connecting",
      credentials,
      activeCallId: credentials.activeCallId ?? null,
      activeChannelId: credentials.activeChannelId ?? null,
      error: null,
    });

    let room: any = null;
    try {
      const liveKit = (await import("@livekit/react-native")) as any;
      const liveKitClient = (await import("livekit-client")) as any;
      liveKit.registerGlobals?.();

      // Skipped entirely for a call the OS is presenting: CallKit activates the
      // AVAudioSession itself, and Telecom owns Android's routing. Starting LiveKit's
      // own session here races them and loses silently.
      if (!this.audioSessionOwnedExternally) {
        this.audioSession = liveKit.AudioSession ?? null;
        await this.audioSession?.startAudioSession?.();
      }

      const Room = liveKit.Room ?? liveKitClient.Room;
      if (!Room) {
        throw new Error("LiveKit Room is unavailable in this runtime.");
      }

      room = new Room({ adaptiveStream: true, dynacast: true });
      this.room = room;
      const roomEvent = liveKit.RoomEvent ?? liveKitClient.RoomEvent ?? {};
      room.on?.(roomEvent.Reconnecting ?? "reconnecting", () => {
        this.update({ connectionState: "reconnecting" });
      });
      room.on?.(roomEvent.Reconnected ?? "reconnected", () => {
        this.update({
          connectionState: "connected",
          connectionQuality: "good",
        });
      });
      const publishParticipantCount = () => {
        this.update({
          remoteParticipantCount: room?.remoteParticipants?.size ?? 0,
        });
      };
      room.on?.(
        roomEvent.ParticipantConnected ?? "participantConnected",
        publishParticipantCount,
      );
      room.on?.(
        roomEvent.ParticipantDisconnected ?? "participantDisconnected",
        publishParticipantCount,
      );
      room.on?.(roomEvent.Disconnected ?? "disconnected", (reason?: unknown) => {
        if (this.deliberateDisconnect) {
          // Handled by disconnect() itself; suppress duplicate update.
          return;
        }
        // A disconnect we did not ask for. The call ending server-side closes
        // the room too, so only a genuine transport failure is an error.
        this.room = null;
        this.update({
          connectionState: "disconnected",
          credentials: null,
          activeCallId: null,
          activeChannelId: null,
          connectionQuality: "unknown",
          remoteParticipantCount: 0,
          error: isExpectedVoiceDisconnect(reason)
            ? null
            : "Disconnected from call",
        });
      });
      room.on?.(
        roomEvent.ConnectionQualityChanged ?? "connectionQualityChanged",
        (quality: unknown) => {
          const normalized = String(quality).toLowerCase();
          this.update({
            connectionQuality:
              normalized.includes("poor") || normalized.includes("lost")
                ? "degraded"
                : "good",
          });
        },
      );

      await room.connect(credentials.livekitUrl, credentials.livekitToken, {
        autoSubscribe: true,
      });
      if (this.room !== room) {
        // Superseded while connecting; drop this room instead of publishing it
        // as the active call.
        await room.disconnect?.();
        return;
      }
      await room.localParticipant?.setMicrophoneEnabled?.(
        !this.snapshot.isMuted,
      );

      this.update({
        connectionState: "connected",
        connectionQuality: "good",
        credentials,
        activeCallId: credentials.activeCallId ?? null,
        activeChannelId: credentials.activeChannelId ?? null,
        remoteParticipantCount: room.remoteParticipants?.size ?? 0,
        error: null,
      });
    } catch (error) {
      if (room && this.room !== room) {
        // Torn down on purpose while connecting — the call ended, or a newer
        // connect replaced this one. LiveKit rejects the pending connect with
        // "Client initiated disconnect"; that is bookkeeping, not an error.
        return;
      }
      await this.disconnect();
      this.update({
        connectionState: "disconnected",
        credentials: null,
        activeCallId: null,
        activeChannelId: null,
        remoteParticipantCount: 0,
        error:
          error instanceof Error ? error.message : "Unable to join voice call.",
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.deliberateDisconnect = true;
    try {
      const room = this.room;
      this.room = null;
      if (room) {
        this.update({ connectionState: "disconnecting" });
        await room.disconnect?.();
      }
      await this.audioSession?.stopAudioSession?.();
      this.audioSession = null;

      this.update({
        connectionState: "disconnected",
        credentials: null,
        activeCallId: null,
        activeChannelId: null,
        connectionQuality: "unknown",
        remoteParticipantCount: 0,
        error: null,
      });
    } finally {
      this.deliberateDisconnect = false;
    }
  }

  async setMuted(isMuted: boolean): Promise<void> {
    await this.room?.localParticipant?.setMicrophoneEnabled?.(!isMuted);
    this.update({ isMuted });
  }

  setConnectionQuality(connectionQuality: VoiceClientConnectionQuality): void {
    this.update({ connectionQuality });
  }

  private update(patch: Partial<VoiceClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };

    for (const listener of this.listeners) {
      listener(this.snapshot);
    }
  }
}

function protoToDate(
  ts: { seconds?: number | bigint | string } | null | undefined,
): Date | null {
  if (!ts) return null;
  const secs = Number(ts.seconds ?? 0);
  return secs > 0 ? new Date(secs * 1000) : null;
}

/**
 * Maps the RPC's join credentials onto what the client connects with.
 *
 * Shared by every answer path — the in-app prompt and the lock-screen answer alike —
 * so a call answered from the phone's own UI joins exactly the same room, the same way,
 * as one answered inside the app.
 */
export function toVoiceJoinCredentials(
  credentials:
    | {
        livekitUrl?: string;
        livekitToken?: string;
        roomName?: string;
        expiresAt?: { seconds?: number | bigint | string } | null;
      }
    | null
    | undefined,
  activeCallId?: string,
  activeChannelId?: string,
): VoiceJoinCredentials | null {
  if (!credentials?.livekitToken || !credentials.roomName) return null;
  return {
    livekitUrl: credentials.livekitUrl ?? "",
    livekitToken: credentials.livekitToken,
    roomName: credentials.roomName,
    activeCallId,
    activeChannelId,
    expiresAt: credentials.expiresAt
      ? (protoToDate(credentials.expiresAt)?.toISOString() ?? undefined)
      : undefined,
  };
}

export function createVoiceClient(): VoiceClient {
  return new VoiceClient();
}

export const voiceClient = createVoiceClient();
