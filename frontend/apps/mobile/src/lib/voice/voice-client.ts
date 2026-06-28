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

  async connect(credentials: VoiceJoinCredentials): Promise<void> {
    await this.disconnect();

    this.update({
      connectionState: "connecting",
      credentials,
      activeCallId: credentials.activeCallId ?? null,
      activeChannelId: credentials.activeChannelId ?? null,
      error: null,
    });

    try {
      const liveKit = (await import("@livekit/react-native")) as any;
      const liveKitClient = (await import("livekit-client")) as any;
      liveKit.registerGlobals?.();

      this.audioSession = liveKit.AudioSession ?? null;
      await this.audioSession?.startAudioSession?.();

      const Room = liveKit.Room ?? liveKitClient.Room;
      if (!Room) {
        throw new Error("LiveKit Room is unavailable in this runtime.");
      }

      const room = new Room({ adaptiveStream: true, dynacast: true });
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
      room.on?.(roomEvent.Disconnected ?? "disconnected", () => {
        if (this.deliberateDisconnect) {
          // Handled by disconnect() itself; suppress duplicate update.
          return;
        }
        // Unexpected disconnect: network drop, server closed the room, etc.
        this.room = null;
        this.update({
          connectionState: "disconnected",
          credentials: null,
          activeCallId: null,
          activeChannelId: null,
          connectionQuality: "unknown",
          error: "Disconnected from call",
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

      this.room = room;
      await room.connect(credentials.livekitUrl, credentials.livekitToken, {
        autoSubscribe: true,
      });
      await room.localParticipant?.setMicrophoneEnabled?.(
        !this.snapshot.isMuted,
      );

      this.update({
        connectionState: "connected",
        connectionQuality: "good",
        credentials,
        activeCallId: credentials.activeCallId ?? null,
        activeChannelId: credentials.activeChannelId ?? null,
        error: null,
      });
    } catch (error) {
      await this.disconnect();
      this.update({
        connectionState: "disconnected",
        credentials: null,
        activeCallId: null,
        activeChannelId: null,
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

export function createVoiceClient(): VoiceClient {
  return new VoiceClient();
}

export const voiceClient = createVoiceClient();
