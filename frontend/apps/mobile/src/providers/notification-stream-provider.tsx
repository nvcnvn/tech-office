/**
 * NotificationStreamProvider — T2.3
 *
 * Manages a single SSE connection for the authenticated app and broadcasts
 * events to React Query cache via invalidation (keeping caches in sync
 * with live server events).
 *
 * Wire: wrap `(app)/_layout.tsx` with this provider so the SSE connection
 * is established once, across all tabs.
 */

import React, {
  createContext,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import EventSource from "react-native-sse";
import { confirmNotificationReceipt } from "apis";
import { API_BASE_URL } from "@/lib/constants";
import { AuthContext } from "@/hooks/use-auth";
import {
  resolveNotificationPayloadHref,
  resolveNotificationTaskNavigation,
} from "@/lib/linking";
import { notificationStreamBehavior } from "@/lib/notification-stream-behavior";
import { invalidateTaskQueries } from "@/lib/task-query-invalidation";
import { voiceClient } from "@/lib/voice/voice-client";
import { scheduleIncomingVoiceCallNotification } from "@/lib/voice/voice-notifications";

interface LiveNotificationBanner {
  id: string;
  title: string;
  body: string;
  count: number;
  targetHref: string | null;
  senderNames: string[];
  kind: "chat-channel" | "chat-thread" | "chat-dm" | "default";
}

export interface IncomingVoiceCallAlert {
  id: string;
  title: string;
  body: string;
  channelId: string;
  callId: string;
  invitationId?: string;
  alreadyInAnotherCall?: boolean;
  participantCount?: number;
  state?: string;
  targetHref: string;
}

interface PendingLiveNotification {
  dedupeKey: string;
  groupKey: string;
  title: string;
  body: string;
  count: number;
  targetHref: string | null;
  summaryLabel: string;
  kind: "chat-channel" | "chat-thread" | "chat-dm" | "default";
  senderNames: string[];
  hasSurfaced: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastActivityAt: number;
}

interface StreamEventPayload {
  data?: string | null;
}

interface NotificationStreamEvent {
  type: string;
  rawData: string;
  payload: Record<string, unknown>;
}

type NotificationStreamListener = (event: NotificationStreamEvent) => void;

const LIVE_NOTIFICATION_DEDUP_WINDOW_MS = 8_000;
const LIVE_NOTIFICATION_CHAT_SPAM_WINDOW_MS = 12_000;
const LIVE_NOTIFICATION_GROUP_WINDOW_MS = 2_500;
const LIVE_NOTIFICATION_CHAT_GROUP_WINDOW_MS = 4_000;
const LIVE_NOTIFICATION_DM_BURST_WINDOW_MS = 5_000;
const LIVE_NOTIFICATION_AUTOHIDE_MS = 4_500;
const RECEIPT_BATCH_WINDOW_MS = 250;
const shouldDebugNotificationStream =
  __DEV__ || process.env.EXPO_PUBLIC_DEBUG_NOTIFICATION_STREAM === "true";

function sanitizeNotificationDebugValue(value: unknown): unknown {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNotificationDebugValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        sanitizeNotificationDebugValue(entryValue),
      ]),
    );
  }

  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  }

  return value;
}

function debugNotificationStream(
  message: string,
  details?: Record<string, unknown>,
) {
  if (!shouldDebugNotificationStream) {
    return;
  }

  if (details) {
    console.warn(
      `[notification-stream] ${message} ${JSON.stringify(
        sanitizeNotificationDebugValue(details),
      )}`,
    );
    return;
  }

  console.warn(`[notification-stream] ${message}`);
}

interface StreamNotificationMetadata {
  channelId?: string;
  channelType?: string;
  channelName?: string;
  messageId?: string;
  parentMessageId?: string;
  senderEmployeeId?: string;
  senderName?: string;
  action?: string;
  employeeId?: string;
  emojiCode?: string;
  projectId?: string;
  taskId?: string;
  taskTitle?: string;
  requirementId?: string;
  focusIntent?: string;
  entryContext?: string;
  eventId?: string;
  eventTitle?: string;
  documentId?: string;
  documentSlug?: string;
  callId?: string;
  invitationId?: string;
  initiatorEmployeeId?: string;
  state?: string;
  participantCount?: number;
  alreadyInAnotherCall?: boolean;
}

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanFromUnknown(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function metadataFromStreamNotification(
  notification: Record<string, unknown>,
): StreamNotificationMetadata {
  const payload =
    notification.payload && typeof notification.payload === "object"
      ? (notification.payload as Record<string, unknown>)
      : undefined;
  const chat =
    payload?.chat && typeof payload.chat === "object"
      ? (payload.chat as Record<string, unknown>)
      : undefined;
  const voiceCall =
    payload?.voiceCall && typeof payload.voiceCall === "object"
      ? (payload.voiceCall as Record<string, unknown>)
      : undefined;
  const task =
    payload?.task && typeof payload.task === "object"
      ? (payload.task as Record<string, unknown>)
      : undefined;
  const document =
    payload?.document && typeof payload.document === "object"
      ? (payload.document as Record<string, unknown>)
      : undefined;
  const calendar =
    payload?.calendar && typeof payload.calendar === "object"
      ? (payload.calendar as Record<string, unknown>)
      : undefined;

  return {
    channelId: stringFromUnknown(voiceCall?.channelId) ?? stringFromUnknown(chat?.channelId),
    channelType: stringFromUnknown(voiceCall?.channelType) ?? stringFromUnknown(chat?.channelType),
    channelName: stringFromUnknown(voiceCall?.channelName) ?? stringFromUnknown(chat?.channelName),
    messageId: stringFromUnknown(chat?.messageId),
    parentMessageId: stringFromUnknown(chat?.parentMessageId),
    senderEmployeeId:
      stringFromUnknown(voiceCall?.senderEmployeeId) ??
      stringFromUnknown(chat?.senderEmployeeId),
    senderName: stringFromUnknown(voiceCall?.senderName) ?? stringFromUnknown(chat?.senderName),
    action: stringFromUnknown(voiceCall?.action) ?? stringFromUnknown(chat?.action),
    employeeId: stringFromUnknown(chat?.employeeId),
    emojiCode: stringFromUnknown(chat?.emojiCode),
    projectId: stringFromUnknown(task?.projectId),
    taskId: stringFromUnknown(task?.taskId),
    taskTitle: stringFromUnknown(task?.taskTitle),
    requirementId: stringFromUnknown(task?.requirementId),
    focusIntent: stringFromUnknown(task?.focusIntent),
    entryContext: stringFromUnknown(task?.entryContext),
    eventId: stringFromUnknown(calendar?.eventId),
    eventTitle: stringFromUnknown(calendar?.eventTitle),
    documentId: stringFromUnknown(document?.documentId),
    documentSlug: stringFromUnknown(document?.slug),
    callId: stringFromUnknown(voiceCall?.callId),
    invitationId: stringFromUnknown(voiceCall?.invitationId),
    initiatorEmployeeId: stringFromUnknown(voiceCall?.initiatorEmployeeId),
    state: stringFromUnknown(voiceCall?.state),
    participantCount: numberFromUnknown(voiceCall?.participantCount),
    alreadyInAnotherCall: booleanFromUnknown(voiceCall?.alreadyInAnotherCall),
  };
}

function stringRecordFromUnknown(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entryValue === "string") {
      record[key] = entryValue;
    } else if (typeof entryValue === "number" || typeof entryValue === "boolean") {
      record[key] = String(entryValue);
    }
  }

  return Object.keys(record).length > 0 ? record : undefined;
}

function playForegroundNotificationSound() {
  Notifications.scheduleNotificationAsync({
    content: {
      data: { soundOnly: "true" },
      sound: "default",
    },
    trigger: null,
  }).catch(() => {});
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function buildGroupedSummary(group: PendingLiveNotification): {
  title: string;
  body: string;
} {
  if (group.count <= 1) {
    return { title: group.title, body: group.body };
  }

  const actorSummary = summarizeActorNames(group.senderNames);

  if (group.kind === "chat-dm") {
    return {
      title: `${group.count} new messages`,
      body: `${actorSummary} messaged you`,
    };
  }

  if (group.kind === "chat-thread") {
    return {
      title: `${group.count} new replies`,
      body: `${actorSummary} replied in ${group.summaryLabel}`,
    };
  }

  if (group.kind === "chat-channel") {
    return {
      title: `${group.count} new messages`,
      body: `${actorSummary} talking in ${group.summaryLabel}`,
    };
  }

  return {
    title: `${group.count} new updates`,
    body: `New activity in ${group.summaryLabel}`,
  };
}

function summarizeActorNames(senderNames: string[]): string {
  const uniqueNames = Array.from(
    new Set(senderNames.map((name) => name.trim()).filter(Boolean)),
  );

  if (uniqueNames.length === 0) {
    return "People";
  }

  if (uniqueNames.length <= 3) {
    return uniqueNames.join(", ");
  }

  return `${uniqueNames.slice(0, 3).join(", ")} +${uniqueNames.length - 3}`;
}

function buildNotificationGroupKey(
  sourceDomain: string | undefined,
  notificationType: string | undefined,
  metadata: StreamNotificationMetadata,
): string {
  if (sourceDomain === "chat") {
    if (metadata.channelType === "direct_message" && metadata.channelId) {
      return `dm:${metadata.channelId}`;
    }

    if (metadata.parentMessageId) {
      return `thread:${metadata.parentMessageId}`;
    }

    if (metadata.channelId) {
      return `chat:${metadata.channelId}`;
    }
  }

  if (metadata.projectId && metadata.taskId) {
    return `task:${metadata.projectId}:${metadata.taskId}`;
  }

  return `${sourceDomain ?? "notification"}:${notificationType ?? "unknown"}`;
}

function buildNotificationDedupeKey(
  sourceDomain: string | undefined,
  notificationType: string | undefined,
  metadata: StreamNotificationMetadata,
  title: string,
  body: string,
): string {
  return [
    sourceDomain ?? "notification",
    notificationType ?? "unknown",
    metadata.messageId,
    metadata.channelId,
    metadata.taskId,
    metadata.eventId,
    title,
    body,
  ]
    .filter(Boolean)
    .join(":");
}

function buildNotificationSpamKey(
  sourceDomain: string | undefined,
  metadata: StreamNotificationMetadata,
  body: string,
): string | null {
  if (sourceDomain !== "chat") {
    return null;
  }

  const normalizedBody = body.trim().toLowerCase().replace(/\s+/g, " ");
  if (!metadata.channelId || !metadata.senderEmployeeId || !normalizedBody) {
    return null;
  }

  return [metadata.channelId, metadata.senderEmployeeId, normalizedBody].join(":");
}

function buildNotificationKind(
  sourceDomain: string | undefined,
  notificationType: string | undefined,
  metadata: StreamNotificationMetadata,
): PendingLiveNotification["kind"] {
  if (sourceDomain === "chat") {
    if (metadata.channelType === "direct_message") {
      return "chat-dm";
    }

    if (notificationType === "reply" || metadata.parentMessageId) {
      return "chat-thread";
    }

    return "chat-channel";
  }

  return "default";
}

function buildNotificationGroupWindowMs(kind: PendingLiveNotification["kind"]): number {
  if (kind === "chat-dm") {
    return LIVE_NOTIFICATION_DM_BURST_WINDOW_MS;
  }

  if (kind === "chat-channel" || kind === "chat-thread") {
    return LIVE_NOTIFICATION_CHAT_GROUP_WINDOW_MS;
  }

  return LIVE_NOTIFICATION_GROUP_WINDOW_MS;
}

function buildNotificationSummaryLabel(
  sourceDomain: string | undefined,
  metadata: StreamNotificationMetadata,
  title: string,
): string {
  if (sourceDomain === "chat") {
    if (metadata.parentMessageId) {
      return `thread in ${metadata.channelName ?? title}`;
    }

    return metadata.channelName ?? title;
  }

  if (metadata.taskTitle) {
    return metadata.taskTitle;
  }

  if (metadata.eventTitle) {
    return metadata.eventTitle;
  }

  return title;
}

interface NotificationStreamContextValue {
  /** Whether the SSE connection is currently open */
  isConnected: boolean;
  /** Current SSE connection identifier announced by the backend */
  connectionId: string | null;
  /** Whether the UI should surface a visible reconnecting state */
  showReconnectingIndicator: boolean;
  /** Whether focused screens should poll until SSE recovers */
  shouldUseFallbackPolling: boolean;
  /** Bumps whenever screens should run a one-shot reconciliation fetch */
  reconnectGeneration: number;
  /** Channel currently reported as active by the UI */
  activeChannelId: string | null;
  /** Report which channel the user is currently viewing (null = none) */
  setActiveChannel: (channelId: string | null) => void;
  /** Report which thread the user is currently viewing (null = none) */
  setActiveThread: (parentMessageId: string | null) => void;
  /** Subscribe to the shared mobile notification stream without opening a new SSE session */
  subscribe: (listener: NotificationStreamListener) => () => void;
  /** Set of channel IDs that have received new messages since last viewed */
  unreadChannelIds: Set<string>;
  /** Clear unread state for a channel (call when entering it) */
  clearUnreadChannel: (channelId: string) => void;
  /** Live banner surfaced while the app is active */
  liveNotification: LiveNotificationBanner | null;
  /** Dismiss the currently visible live banner */
  dismissLiveNotification: () => void;
  /** Persistent incoming voice-call prompt while the app is active */
  incomingVoiceCall: IncomingVoiceCallAlert | null;
  /** Clear the persistent incoming voice-call prompt */
  clearIncomingVoiceCall: (callId?: string) => void;
}

// ── Context ──────────────────────────────────────────────────────────────────

export const NotificationStreamContext =
  createContext<NotificationStreamContextValue>({
    isConnected: false,
    connectionId: null,
    showReconnectingIndicator: false,
    shouldUseFallbackPolling: false,
    reconnectGeneration: 0,
    activeChannelId: null,
    setActiveChannel: () => {},
    setActiveThread: () => {},
    subscribe: () => () => {},
    unreadChannelIds: new Set(),
    clearUnreadChannel: () => {},
    liveNotification: null,
    dismissLiveNotification: () => {},
    incomingVoiceCall: null,
    clearIncomingVoiceCall: () => {},
  });

export function useNotificationStream() {
  return React.use(NotificationStreamContext);
}

// ── Provider ─────────────────────────────────────────────────────────────────

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function NotificationStreamProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = React.use(AuthContext);
  const queryClient = useQueryClient();

  const esRef = useRef<EventSource<string> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRotationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receiptFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReceiptIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const intentionalCloseRef = useRef(false);
  const connectionAttemptRef = useRef(0);
  const reconnectCycleRef = useRef(0);
  const connectionIdRef = useRef<string | null>(null);
  const isConnectedRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const connectRef = useRef<() => void>(() => {});
  const streamListenersRef = useRef<Map<number, NotificationStreamListener>>(new Map());
  const nextStreamListenerIdRef = useRef(0);
  const liveNotificationGroupsRef = useRef<Map<string, PendingLiveNotification>>(
    new Map(),
  );
  const liveNotificationDedupeRef = useRef<Map<string, number>>(new Map());
  const liveNotificationSpamRef = useRef<Map<string, number>>(new Map());
  const liveNotificationDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [isConnected, setIsConnected] = React.useState(false);
  const [connectionId, setConnectionId] = React.useState<string | null>(null);
  const [showReconnectingIndicator, setShowReconnectingIndicator] = React.useState(false);
  const [shouldUseFallbackPolling, setShouldUseFallbackPolling] = React.useState(false);
  const [reconnectGeneration, setReconnectGeneration] = React.useState(0);
  const [activeChannelId, setActiveChannelId] = React.useState<string | null>(null);
  const [unreadChannelIds, setUnreadChannelIds] = React.useState<Set<string>>(new Set());
  const [liveNotification, setLiveNotification] = React.useState<LiveNotificationBanner | null>(
    null,
  );
  const [incomingVoiceCall, setIncomingVoiceCall] = React.useState<IncomingVoiceCallAlert | null>(
    null,
  );

  useEffect(() => {
    debugNotificationStream("provider mounted", {
      isAuthenticated: auth?.isAuthenticated ?? false,
      hasToken: !!auth?.token,
      appState: AppState.currentState,
      debugEnabled: shouldDebugNotificationStream,
    });
  }, [auth?.isAuthenticated, auth?.token]);

  // Track which channel the user is currently viewing
  const activeChannelRef = useRef<string | null>(null);
  const activeThreadRef = useRef<string | null>(null);

  /** Expose setter so child screens can report which channel they're viewing */
  const setActiveChannel = useCallback((channelId: string | null) => {
    activeChannelRef.current = channelId;
    setActiveChannelId(channelId);
  }, []);

  const setActiveThread = useCallback((parentMessageId: string | null) => {
    activeThreadRef.current = parentMessageId;
  }, []);

  const subscribe = useCallback((listener: NotificationStreamListener) => {
    const listenerId = nextStreamListenerIdRef.current;
    nextStreamListenerIdRef.current += 1;
    streamListenersRef.current.set(listenerId, listener);

    return () => {
      streamListenersRef.current.delete(listenerId);
    };
  }, []);

  const publishStreamEvent = useCallback((event: NotificationStreamEvent) => {
    streamListenersRef.current.forEach((listener) => {
      try {
        listener(event);
      } catch {}
    });
  }, []);

  const markChannelUnread = useCallback((channelId: string) => {
    setUnreadChannelIds((prev) => {
      if (prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.add(channelId);
      return next;
    });
  }, []);

  const clearUnreadChannel = useCallback((channelId: string) => {
    setUnreadChannelIds((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
  }, []);

  const clearLiveNotificationDismissTimer = useCallback(() => {
    if (liveNotificationDismissTimerRef.current) {
      clearTimeout(liveNotificationDismissTimerRef.current);
      liveNotificationDismissTimerRef.current = null;
    }
  }, []);

  const dismissLiveNotification = useCallback(() => {
    debugNotificationStream("dismiss banner", {
      currentBannerId: liveNotification?.id ?? null,
    });
    clearLiveNotificationDismissTimer();
    setLiveNotification(null);
  }, [clearLiveNotificationDismissTimer, liveNotification]);

  const clearIncomingVoiceCall = useCallback((callId?: string) => {
    setIncomingVoiceCall((current) => {
      if (!current) {
        return null;
      }
      if (callId && current.callId !== callId) {
        return current;
      }
      return null;
    });
  }, []);

  const scheduleNativeNotification = useCallback(
    (group: PendingLiveNotification) => {
      const summary = buildGroupedSummary(group);
      debugNotificationStream("schedule native notification request", {
        groupKey: group.groupKey,
        kind: group.kind,
        count: group.count,
        targetHref: group.targetHref,
        title: summary.title,
        body: summary.body,
      });
      Notifications.scheduleNotificationAsync({
        content: {
          title: summary.title,
          body: summary.body,
          data: group.targetHref ? { href: group.targetHref } : {},
          sound: "default",
        },
        trigger: null,
      }).catch(() => {});
    },
    [],
  );

  const surfaceLiveNotification = useCallback(
    (group: PendingLiveNotification) => {
      const summary = buildGroupedSummary(group);
      playForegroundNotificationSound();
      debugNotificationStream("surface banner", {
        groupKey: group.groupKey,
        kind: group.kind,
        count: group.count,
        targetHref: group.targetHref,
        title: summary.title,
        body: summary.body,
      });
      clearLiveNotificationDismissTimer();
      setLiveNotification({
        id: `${group.groupKey}:${group.lastActivityAt}`,
        title: summary.title,
        body: summary.body,
        count: group.count,
        targetHref: group.targetHref,
        senderNames: group.senderNames,
        kind: group.kind,
      });
      liveNotificationDismissTimerRef.current = setTimeout(() => {
        setLiveNotification((current) =>
          current?.id === `${group.groupKey}:${group.lastActivityAt}` ? null : current,
        );
      }, LIVE_NOTIFICATION_AUTOHIDE_MS);
    },
    [clearLiveNotificationDismissTimer],
  );

  const flushNotificationGroup = useCallback(
    (groupKey: string, delivery: "banner" | "native") => {
      const group = liveNotificationGroupsRef.current.get(groupKey);
      if (!group) {
        debugNotificationStream("flush group skipped missing group", {
          groupKey,
          delivery,
        });
        return;
      }

      if (group.timer) {
        clearTimeout(group.timer);
      }

      debugNotificationStream("flush group", {
        groupKey,
        delivery,
        kind: group.kind,
        count: group.count,
        hasSurfaced: group.hasSurfaced,
      });

      liveNotificationGroupsRef.current.delete(groupKey);

      if (delivery === "native") {
        if (group.hasSurfaced) {
          debugNotificationStream("skip native flush already surfaced", {
            groupKey,
            kind: group.kind,
          });
          return;
        }
        scheduleNativeNotification(group);
        return;
      }

      surfaceLiveNotification(group);
    },
    [scheduleNativeNotification, surfaceLiveNotification],
  );

  const flushAllNotificationGroups = useCallback(
    (delivery: "banner" | "native") => {
      Array.from(liveNotificationGroupsRef.current.keys()).forEach((groupKey) => {
        flushNotificationGroup(groupKey, delivery);
      });
    },
    [flushNotificationGroup],
  );

  const enqueueLiveNotification = useCallback(
    ({
      dedupeKey,
      groupKey,
      title,
      body,
      targetHref,
      summaryLabel,
      kind,
      senderName,
    }: {
      dedupeKey: string;
      groupKey: string;
      title: string;
      body: string;
      targetHref: string | null;
      summaryLabel: string;
      kind: PendingLiveNotification["kind"];
      senderName: string | null;
    }) => {
      const now = Date.now();
      liveNotificationDedupeRef.current.forEach((timestamp, key) => {
        if (now - timestamp > LIVE_NOTIFICATION_DEDUP_WINDOW_MS) {
          liveNotificationDedupeRef.current.delete(key);
        }
      });
      liveNotificationSpamRef.current.forEach((timestamp, key) => {
        if (now - timestamp > LIVE_NOTIFICATION_CHAT_SPAM_WINDOW_MS) {
          liveNotificationSpamRef.current.delete(key);
        }
      });

      if (liveNotificationDedupeRef.current.has(dedupeKey)) {
        debugNotificationStream("drop duplicate notification", {
          dedupeKey,
          groupKey,
          kind,
        });
        return;
      }

      liveNotificationDedupeRef.current.set(dedupeKey, now);

      debugNotificationStream("enqueue live notification", {
        dedupeKey,
        groupKey,
        kind,
        title,
        body,
        targetHref,
        senderName,
        appState: appStateRef.current,
        existingGroupCount:
          liveNotificationGroupsRef.current.get(groupKey)?.count ?? 0,
      });

      if (appStateRef.current !== "active") {
        debugNotificationStream("schedule native notification", {
          groupKey,
          kind,
          title,
          targetHref,
        });
        scheduleNativeNotification({
          dedupeKey,
          groupKey,
          title,
          body,
          count: 1,
          targetHref,
          summaryLabel,
          kind,
          senderNames: senderName ? [senderName] : [],
          hasSurfaced: false,
          timer: null,
          lastActivityAt: now,
        });
        return;
      }

      const existing = liveNotificationGroupsRef.current.get(groupKey);
      const senderNames = Array.from(
        new Set([...(existing?.senderNames ?? []), ...(senderName ? [senderName] : [])]),
      );

      if (kind === "chat-dm") {
        if (existing?.timer) {
          clearTimeout(existing.timer);
        }

        const dmGroup: PendingLiveNotification = {
          dedupeKey,
          groupKey,
          title,
          body,
          count:
            existing && now - existing.lastActivityAt <= LIVE_NOTIFICATION_DM_BURST_WINDOW_MS
              ? existing.count + 1
              : 1,
          targetHref,
          summaryLabel,
          kind,
          senderNames,
          hasSurfaced: true,
          timer: null,
          lastActivityAt: now,
        };

        dmGroup.timer = setTimeout(() => {
          liveNotificationGroupsRef.current.delete(groupKey);
        }, LIVE_NOTIFICATION_DM_BURST_WINDOW_MS);

        liveNotificationGroupsRef.current.set(groupKey, dmGroup);
        debugNotificationStream("surface dm banner immediately", {
          groupKey,
          count: dmGroup.count,
          senderNames,
          targetHref,
        });
        surfaceLiveNotification(dmGroup);
        return;
      }

      if (kind === "chat-channel" || kind === "chat-thread") {
        if (existing?.timer) {
          clearTimeout(existing.timer);
        }

        const liveChatGroup: PendingLiveNotification = {
          dedupeKey,
          groupKey,
          title,
          body,
          count: (existing?.count ?? 0) + 1,
          targetHref,
          summaryLabel,
          kind,
          senderNames,
          hasSurfaced: true,
          timer: null,
          lastActivityAt: now,
        };

        liveChatGroup.timer = setTimeout(() => {
          liveNotificationGroupsRef.current.delete(groupKey);
        }, buildNotificationGroupWindowMs(kind));

        liveNotificationGroupsRef.current.set(groupKey, liveChatGroup);
        debugNotificationStream("surface chat banner immediately", {
          groupKey,
          kind,
          count: liveChatGroup.count,
          senderNames,
          targetHref,
        });
        surfaceLiveNotification(liveChatGroup);
        return;
      }

      if (existing?.timer) {
        clearTimeout(existing.timer);
      }

      const nextGroup: PendingLiveNotification = {
        dedupeKey,
        groupKey,
        title,
        body,
        count: (existing?.count ?? 0) + 1,
        targetHref,
        summaryLabel,
        kind,
        senderNames,
        hasSurfaced: false,
        timer: null,
        lastActivityAt: now,
      };

      nextGroup.timer = setTimeout(() => {
        flushNotificationGroup(groupKey, "banner");
      }, buildNotificationGroupWindowMs(kind));

      liveNotificationGroupsRef.current.set(groupKey, nextGroup);
      debugNotificationStream("queue grouped banner", {
        groupKey,
        kind,
        count: nextGroup.count,
        delayMs: buildNotificationGroupWindowMs(kind),
        targetHref,
      });
    },
    [flushNotificationGroup, scheduleNativeNotification],
  );

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearReconnectGraceTimer = useCallback(() => {
    if (reconnectGraceTimerRef.current) {
      clearTimeout(reconnectGraceTimerRef.current);
      reconnectGraceTimerRef.current = null;
    }
  }, []);

  const clearSessionRotationTimer = useCallback(() => {
    if (sessionRotationTimerRef.current) {
      clearTimeout(sessionRotationTimerRef.current);
      sessionRotationTimerRef.current = null;
    }
  }, []);

  const flushReceiptBatch = useCallback(() => {
    if (receiptFlushTimerRef.current) {
      clearTimeout(receiptFlushTimerRef.current);
      receiptFlushTimerRef.current = null;
    }

    const connectionId = connectionIdRef.current;
    const recipientIds = Array.from(pendingReceiptIdsRef.current);
    pendingReceiptIdsRef.current.clear();

    if (!connectionId || recipientIds.length === 0 || appStateRef.current !== "active") {
      return;
    }

    confirmNotificationReceipt({
      notificationRecipientIds: recipientIds,
      connectionId,
      platform: "mobile",
      appState: "foreground",
      receivedAt: new Date(),
    }).catch((error) => {
      debugNotificationStream("receipt confirm failed", {
        error: error instanceof Error ? error.message : String(error),
        count: recipientIds.length,
      });
    });
  }, []);

  const enqueueNotificationReceipt = useCallback(
    (payload: Record<string, unknown>) => {
      if (appStateRef.current !== "active") {
        return;
      }

      const notification = payload.notification as Record<string, unknown> | undefined;
      const recipientId =
        typeof notification?.notificationRecipientId === "string"
          ? notification.notificationRecipientId.trim()
          : "";
      if (!recipientId || !connectionIdRef.current) {
        return;
      }

      pendingReceiptIdsRef.current.add(recipientId);
      if (receiptFlushTimerRef.current) {
        return;
      }

      receiptFlushTimerRef.current = setTimeout(
        flushReceiptBatch,
        RECEIPT_BATCH_WINDOW_MS,
      );
    },
    [flushReceiptBatch],
  );

  const closeStream = useCallback(
    ({ intentional }: { intentional: boolean }) => {
      intentionalCloseRef.current = intentional;
      clearSessionRotationTimer();
      flushReceiptBatch();
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {}
        esRef.current = null;
      }
      isConnectedRef.current = false;
      setIsConnected(false);
    },
    [clearSessionRotationTimer, flushReceiptBatch],
  );

  const runRecoveryRefetch = useCallback(() => {
    setReconnectGeneration((prev) => prev + 1);
  }, []);

  const enterReconnectWindow = useCallback((showIndicator: boolean) => {
    reconnectCycleRef.current += 1;
    const reconnectCycle = reconnectCycleRef.current;

    runRecoveryRefetch();
    setShowReconnectingIndicator(showIndicator);
    setShouldUseFallbackPolling(false);
    clearReconnectGraceTimer();

    reconnectGraceTimerRef.current = setTimeout(() => {
      if (
        mountedRef.current &&
        reconnectCycleRef.current === reconnectCycle &&
        AppState.currentState === "active" &&
        auth?.isAuthenticated &&
        !isConnectedRef.current
      ) {
        setShowReconnectingIndicator(false);
        setIsConnected(false);
        setShouldUseFallbackPolling(true);
      }
    }, notificationStreamBehavior.reconnectGraceMs);
  }, [auth?.isAuthenticated, clearReconnectGraceTimer, runRecoveryRefetch]);

  const scheduleSessionRotation = useCallback(() => {
    clearSessionRotationTimer();
    sessionRotationTimerRef.current = setTimeout(() => {
      if (
        !mountedRef.current ||
        AppState.currentState !== "active" ||
        !auth?.isAuthenticated
      ) {
        return;
      }

      closeStream({ intentional: true });
      enterReconnectWindow(false);
      connectRef.current();
    }, notificationStreamBehavior.sessionMaxAgeMs);
  }, [auth?.isAuthenticated, clearSessionRotationTimer, closeStream, enterReconnectWindow]);

  const markConnectionHealthy = useCallback(() => {
    backoffRef.current = INITIAL_BACKOFF_MS;
    isConnectedRef.current = true;
    setIsConnected(true);
    setShowReconnectingIndicator(false);
    setShouldUseFallbackPolling(false);
    clearReconnectGraceTimer();
    scheduleSessionRotation();
  }, [clearReconnectGraceTimer, scheduleSessionRotation]);

  const invalidateForEvent = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      switch (type) {
        case "chat_message":
        case "chat_reaction":
        case "chat_typing": {
          const channelId = payload.channel_id as string | undefined;
          if (channelId) {
            queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
            queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
            if (type === "chat_message" && activeChannelRef.current !== channelId) {
              markChannelUnread(channelId);
            }
          }
          break;
        }
        case "notification":
        case "notification_read": {
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
          queryClient.invalidateQueries({ queryKey: ["unread-count"] });

          // Backend sends ALL SSE events as event type "notification".
          // Inspect the nested notification payload to invalidate domain-specific queries.
          const notification = payload.notification as
            | Record<string, unknown>
            | undefined;
          if (notification) {
            const metadata = metadataFromStreamNotification(notification);
            const typedPayload =
              notification.payload && typeof notification.payload === "object"
                ? (notification.payload as Record<string, unknown>)
                : undefined;
            const sourceDomain = notification.sourceDomain as string | undefined;
            const notificationType = notification.notificationType as
              | string
              | undefined;
            const notificationTitle =
              stripHtml(
                (notification.title as string | undefined) ??
                  metadata.channelName ??
                  "New update",
              ) || "New update";
            const notificationBody = stripHtml(
              (notification.message as string | undefined) ??
                (notification.body as string | undefined) ??
                (notification.summary as string | undefined) ??
                "",
            );
            const targetHref = resolveNotificationPayloadHref({
              sourceDomain,
              notificationType,
              payload: typedPayload as never,
              navigationTarget: notification.navigationTarget as
                | Record<string, string>
                | undefined,
            });
            const voiceCallTargetHref =
              notificationType === "voice_call_incoming" && metadata.channelId
                ? `/(app)/(chat)/${metadata.channelId}`
                : targetHref;
            const taskNavigation = resolveNotificationTaskNavigation({
              sourceDomain,
              notificationType,
              payload: typedPayload as never,
              navigationTarget: notification.navigationTarget as
                | Record<string, string>
                | undefined,
            });
            const groupKey = buildNotificationGroupKey(
              sourceDomain,
              notificationType,
              metadata,
            );
            const dedupeKey = buildNotificationDedupeKey(
              sourceDomain,
              notificationType,
              metadata,
              notificationTitle,
              notificationBody,
            );
            const summaryLabel = buildNotificationSummaryLabel(
              sourceDomain,
              metadata,
              notificationTitle,
            );
            const kind = buildNotificationKind(
              sourceDomain,
              notificationType,
              metadata,
            );
            const senderName = metadata.senderName ?? null;
            const spamKey = buildNotificationSpamKey(
              sourceDomain,
              metadata,
              notificationBody,
            );
            const channelId = metadata.channelId;
            const isIncomingVoiceCall = notificationType === "voice_call_incoming";
            const isVoiceCallEnded =
              notificationType === "voice_call_ended" || metadata.state === "VOICE_CALL_STATE_ENDED";
            const isActiveChannel = !!channelId && activeChannelRef.current === channelId;
            const isActiveThread =
              !!metadata.parentMessageId &&
              activeThreadRef.current === metadata.parentMessageId;

      if (taskNavigation) {
        void invalidateTaskQueries(queryClient, {
          projectId: taskNavigation.projectId,
          taskId: taskNavigation.taskId,
        });
      }

            if (spamKey) {
              const seenAt = liveNotificationSpamRef.current.get(spamKey);
              if (seenAt && Date.now() - seenAt <= LIVE_NOTIFICATION_CHAT_SPAM_WINDOW_MS) {
                debugNotificationStream("drop chat spam duplicate", {
                  spamKey,
                  notificationType,
                  channelId,
                });
                return;
              }
              liveNotificationSpamRef.current.set(spamKey, Date.now());
            }

            if (sourceDomain === "chat" && metadata.channelId) {
              if (isVoiceCallEnded && metadata.callId) {
                clearIncomingVoiceCall(metadata.callId);
                if (voiceClient.getSnapshot().activeCallId === metadata.callId) {
                  void voiceClient.disconnect();
                }
              }

              if (isIncomingVoiceCall) {
                if (appStateRef.current === "active" && metadata.callId) {
                  setIncomingVoiceCall({
                    id: metadata.invitationId ?? metadata.callId,
                    title: notificationTitle || "Incoming voice call",
                    body:
                      notificationBody ||
                      (metadata.alreadyInAnotherCall
                        ? "Switch to answer, or stay in your current call."
                        : "Answer from this conversation."),
                    channelId: metadata.channelId,
                    callId: metadata.callId,
                    invitationId: metadata.invitationId,
                    alreadyInAnotherCall: metadata.alreadyInAnotherCall,
                    participantCount: metadata.participantCount,
                    state: metadata.state,
                    targetHref: voiceCallTargetHref,
                  });
                } else if (appStateRef.current !== "active") {
                  void scheduleIncomingVoiceCallNotification({
                    title: notificationTitle,
                    body: notificationBody,
                    targetHref: voiceCallTargetHref,
                    sourceDomain,
                    channelId: metadata.channelId,
                    callId: metadata.callId,
                    invitationId: metadata.invitationId,
                    alreadyInAnotherCall: metadata.alreadyInAnotherCall ?? false,
                  }).catch(() => {});
                }
              }

              queryClient.invalidateQueries({
                queryKey: ["messages", metadata.channelId],
              });
              queryClient.invalidateQueries({
                queryKey: ["recentChannels"],
              });

              const shouldSuppressChatPopup =
                !isIncomingVoiceCall &&
                (isActiveThread ||
                  (isActiveChannel && notificationType !== "reply"));

              debugNotificationStream("chat notification received", {
                notificationType,
                channelId: metadata.channelId,
                parentMessageId: metadata.parentMessageId,
                isActiveChannel,
                isActiveThread,
                shouldSuppressChatPopup,
                suppressionReason: shouldSuppressChatPopup
                  ? isActiveThread
                    ? "active-thread"
                    : "active-channel-non-reply"
                  : null,
                groupKey,
                dedupeKey,
                targetHref: voiceCallTargetHref,
                notificationTitle,
                notificationBody,
                senderName,
              });

              if (!isActiveChannel && !isActiveThread) {
                markChannelUnread(metadata.channelId);
              }

              if (isIncomingVoiceCall) {
                debugNotificationStream("surface incoming voice call prompt", {
                  channelId: metadata.channelId,
                  callId: metadata.callId,
                  invitationId: metadata.invitationId,
                  isActiveChannel,
                  appState: appStateRef.current,
                });
                return;
              }

              if (shouldSuppressChatPopup) {
                debugNotificationStream("suppress chat popup", {
                  channelId: metadata.channelId,
                  parentMessageId: metadata.parentMessageId,
                  notificationType,
                  suppressionReason: isActiveThread
                    ? "active-thread"
                    : "active-channel-non-reply",
                });
              } else {
                enqueueLiveNotification({
                  dedupeKey,
                  groupKey,
                  title: notificationTitle,
                  body: notificationBody,
                  targetHref: voiceCallTargetHref,
                  summaryLabel,
                  kind,
                  senderName,
                });
              }
            }

            if (
              sourceDomain !== "chat" &&
              notificationType !== "notification_read" &&
              (notificationTitle || notificationBody)
            ) {
              debugNotificationStream("enqueue non-chat popup", {
                sourceDomain,
                notificationType,
                groupKey,
                dedupeKey,
                targetHref,
                notificationTitle,
                notificationBody,
              });
              enqueueLiveNotification({
                dedupeKey,
                groupKey,
                title: notificationTitle,
                body: notificationBody,
                targetHref,
                summaryLabel,
                kind,
                senderName,
              });
            }

            if (notificationType === "task_update" || notificationType === "task_assigned") {
              const projectId = metadata.projectId;
              const taskId = metadata.taskId;
              void invalidateTaskQueries(queryClient, { projectId, taskId });
            }
          }
          break;
        }
        case "task_update":
        case "task_assigned":
        case "task_status_changed": {
          const projectId = payload.project_id as string | undefined;
          const taskId = payload.task_id as string | undefined;
          void invalidateTaskQueries(queryClient, { projectId, taskId });
          break;
        }
        case "presence": {
          const employeeId = payload.employee_id as string | undefined;
          if (employeeId) {
            queryClient.setQueryData(["presence", employeeId], {
              employeeId,
              status: payload.status as string,
              lastInteractionAt: new Date(),
              lastHeartbeat: new Date(),
            });
          } else {
            queryClient.invalidateQueries({ queryKey: ["presence"] });
          }
          break;
        }
        case "calendar_event_created":
        case "calendar_event_updated":
        case "calendar_event_cancelled":
        case "calendar_rsvp_updated": {
          queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
          const eventId = payload.event_id as string | undefined;
          if (eventId) {
            queryClient.invalidateQueries({ queryKey: ["event", eventId] });
          }
          break;
        }
        default:
          break;
      }
    },
    [clearIncomingVoiceCall, enqueueLiveNotification, markChannelUnread, queryClient]
  );

  const connect = useCallback(() => {
    if (!mountedRef.current) {
      debugNotificationStream("connect skipped", {
        reason: "provider-unmounted",
      });
      return;
    }

    if (!auth?.isAuthenticated || !auth.token) {
      debugNotificationStream("connect skipped", {
        reason: "auth-not-ready",
        isAuthenticated: auth?.isAuthenticated ?? false,
        hasToken: !!auth?.token,
      });
      return;
    }

    connectionAttemptRef.current += 1;
    const attemptId = connectionAttemptRef.current;
    intentionalCloseRef.current = false;

    // Clean up any existing connection
    if (esRef.current) {
      try { esRef.current.close(); } catch {}
      esRef.current = null;
    }

    const url = `${API_BASE_URL}/api/notifications/stream?token=${encodeURIComponent(
      auth.token
    )}`;

    const es = new EventSource<string>(url);
    esRef.current = es;

    debugNotificationStream("connect stream", {
      url,
      attemptId,
    });

    es.addEventListener("open", () => {
      if (!mountedRef.current || connectionAttemptRef.current !== attemptId) return;
      debugNotificationStream("stream open", { attemptId });
      markConnectionHealthy();
    });

    const handleEvent = (eventType: string) => (event: StreamEventPayload) => {
      if (!mountedRef.current || connectionAttemptRef.current !== attemptId) return;
      markConnectionHealthy();

      try {
        const rawData = event.data ?? "";
        const payload = event.data
          ? (JSON.parse(event.data) as Record<string, unknown>)
          : {};
        const eventConnectionId =
          typeof payload.connectionId === "string" && payload.connectionId.trim().length > 0
            ? payload.connectionId.trim()
            : null;

        if (eventConnectionId && connectionIdRef.current !== eventConnectionId) {
          connectionIdRef.current = eventConnectionId;
          setConnectionId(eventConnectionId);
        }

        debugNotificationStream("stream event", {
          eventType,
          keys: Object.keys(payload),
          payloadPreview:
            eventType === "notification"
              ? payload.notification ?? payload
              : payload,
        });
        if (eventType === "notification" || payload.eventType === "notification") {
          enqueueNotificationReceipt(payload);
        }
        invalidateForEvent(eventType, payload);
        publishStreamEvent({ type: eventType, rawData, payload });
      } catch {
        publishStreamEvent({ type: eventType, rawData: event.data ?? "", payload: {} });
        // Ignore JSON parse errors from ping frames
      }
    };

    const namedEvents = [
      "message",
      "connection_established",
      "heartbeat",
      "notification",
      "notification_read",
      "chat_message",
      "chat_reaction",
      "chat_typing",
      "task_update",
      "task_assigned",
      "task_status_changed",
      "presence",
      "calendar_event_created",
      "calendar_event_updated",
      "calendar_event_cancelled",
      "calendar_rsvp_updated",
      "ping",
    ];

    namedEvents.forEach((evtType) => {
      es.addEventListener(evtType, handleEvent(evtType));
    });

    es.addEventListener("error", (event) => {
      if (!mountedRef.current || connectionAttemptRef.current !== attemptId) return;

      debugNotificationStream("stream error", {
        attemptId,
        eventType: event.type,
        intentional: intentionalCloseRef.current,
      });

      if (intentionalCloseRef.current) {
        intentionalCloseRef.current = false;
        return;
      }

      isConnectedRef.current = false;
      setIsConnected(false);
      setShowReconnectingIndicator(true);
      clearSessionRotationTimer();
      enterReconnectWindow(true);

      // Exponential backoff reconnect
      const delay = Math.min(backoffRef.current, MAX_BACKOFF_MS);
      backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);

      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current && AppState.currentState === "active") {
          connectRef.current();
        }
      }, delay);
    });
  }, [
    auth?.isAuthenticated,
    auth?.token,
    clearReconnectGraceTimer,
    clearReconnectTimer,
    clearSessionRotationTimer,
    enqueueNotificationReceipt,
    enterReconnectWindow,
    invalidateForEvent,
    markConnectionHealthy,
    publishStreamEvent,
    scheduleSessionRotation,
  ]);

  connectRef.current = connect;

  // Reconnect/disconnect based on AppState
  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (state: AppStateStatus) => {
        const previousState = appStateRef.current;
        if (state !== "active" && previousState === "active") {
          flushReceiptBatch();
        }
        appStateRef.current = state;
        if (state === "active") {
          connectRef.current();
        } else {
          flushAllNotificationGroups("native");
          // Pause SSE when app goes to background to preserve battery
          clearReconnectTimer();
          clearReconnectGraceTimer();
          clearSessionRotationTimer();
          setShowReconnectingIndicator(false);
          setShouldUseFallbackPolling(false);
          closeStream({ intentional: true });
        }
      }
    );
    return () => subscription.remove();
  }, [
    clearReconnectGraceTimer,
    clearReconnectTimer,
    clearSessionRotationTimer,
    closeStream,
    flushReceiptBatch,
    flushAllNotificationGroups,
  ]);

  // Initial connection when auth changes
  useEffect(() => {
    mountedRef.current = true;

    if (auth?.isAuthenticated) {
      connectRef.current();
    } else {
      clearReconnectTimer();
      clearReconnectGraceTimer();
      clearSessionRotationTimer();
      connectionIdRef.current = null;
      activeChannelRef.current = null;
      activeThreadRef.current = null;
      setConnectionId(null);
      setActiveChannelId(null);
      setShowReconnectingIndicator(false);
      setShouldUseFallbackPolling(false);
      closeStream({ intentional: true });
    }

    return () => {
      flushAllNotificationGroups("native");
      flushReceiptBatch();
      liveNotificationGroupsRef.current.clear();
      liveNotificationDedupeRef.current.clear();
      liveNotificationSpamRef.current.clear();
      clearLiveNotificationDismissTimer();
      clearReconnectTimer();
      clearReconnectGraceTimer();
      clearSessionRotationTimer();
      setShowReconnectingIndicator(false);
      closeStream({ intentional: true });
    };
  }, [auth?.isAuthenticated, auth?.token]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return (
    <NotificationStreamContext.Provider
      value={{
        isConnected,
        connectionId,
        showReconnectingIndicator,
        shouldUseFallbackPolling,
        reconnectGeneration,
        activeChannelId,
        setActiveChannel,
        setActiveThread,
        subscribe,
        unreadChannelIds,
        clearUnreadChannel,
        liveNotification,
        dismissLiveNotification,
        incomingVoiceCall,
        clearIncomingVoiceCall,
      }}
    >
      {children}
    </NotificationStreamContext.Provider>
  );
}
