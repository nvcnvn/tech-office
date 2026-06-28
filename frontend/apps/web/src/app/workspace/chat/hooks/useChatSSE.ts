/**
 * Chat SSE Event Handler Hook
 * Subscribes to real-time chat events via SSE notification stream
 *
 * Event Types (from backend notification_type field):
 * - message: New message in channel (invalidate message list)
 * - mention: User mentioned in message (show notification + invalidate)
 * - reply: Reply to user's message (show notification + invalidate thread)
 * - typing: User typing in channel (NOT YET IMPLEMENTED - placeholder)
 * - reaction: Reaction added/removed (NOT YET IMPLEMENTED - placeholder)
 *
 * Architecture:
 * - Consumes shared NotificationStreamProvider SSE connection
 * - Filters notifications by source_domain === 'chat'
 * - Routes by notification_type to appropriate handler
 * - Integrates with React Query cache invalidation
 */

import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@tech-office/notifications";
import { useNotificationStream } from "../../providers/NotificationStreamProvider";
import { listMessages } from "apis";
import { isVoiceCallNotificationType } from "../../voice/voiceCallEvents";

/**
 * Chat action data structure
 * Parsed from notification.actionData for chat events
 */
interface ChatActionData {
  channelId: string;
  callId?: string;
  invitationId?: string;
  initiatorEmployeeId?: string;
  alreadyInAnotherCall?: string | boolean;
  state?: string;
  participantCount?: string;
  messageId?: string;
  action?:
    | "view_message"
    | "view_thread"
    | "added"
    | "removed"
    | "updated"
    | "start"
    | "stop"
    | string;
  parentMessageId?: string; // For reply events
  reactionEmoji?: string; // For reaction events
  emoji?: string; // alternate key
  emojiCode?: string; // alternate key (backend may send this)
  employeeId?: string; // For typing events - the person typing
}

// Lightweight reaction-like shape for optimistic patches
type ReactionLike = {
  emojiCode?: string;
  emoji?: string;
  count?: number;
  employeeIds?: string[];
  currentUserReacted?: boolean;
  firstReactedAt?: { seconds: string | number } | undefined;
};

/**
 * Typing event callback
 * Called when typing indicator event received
 */
export type OnTypingEvent = (data: {
  channelId: string;
  parentMessageId?: string; // Optional: for thread typing indicators
  userId: string;
  userName: string;
  isTyping: boolean;
}) => void;

/**
 * Reply event callback
 * Called when someone replies to the current user's message (view_thread action).
 * Only fired for the parent message author — not for every channel member.
 */
export type OnReplyEvent = (data: {
  channelId: string;
  parentMessageId: string;
  title: string;
}) => void;

interface UseChatSSEOptions {
  /**
   * Callback for typing indicator events
   * Optional: If not provided, typing events are ignored
   */
  onTypingEvent?: OnTypingEvent;

  /**
   * Callback fired when a reply arrives for the current user's own message.
   * Use this to show an in-channel toast/snackbar and open the thread.
   * Optional: If not provided, the event is handled silently.
   */
  onReplyEvent?: OnReplyEvent;

  /**
   * Enable/disable SSE subscription handling
   */
  enabled?: boolean;
}

/**
 * Hook to handle chat-specific SSE events
 *
 * Usage:
 * ```tsx
 * useChatSSE({
 *   onTypingEvent: (data) => {
 *     console.log(`${data.userName} is typing in ${data.channelId}`);
 *   },
 * });
 * ```
 */
export function useChatSSE(options: UseChatSSEOptions) {
  const { onTypingEvent, onReplyEvent, enabled = true } = options;
  const queryClient = useQueryClient();
  const { status, error, subscribe } = useNotificationStream();

  const handleNotification = useCallback(
    (notification: Notification) => {
      // Filter: Only handle chat domain events
      if (notification.sourceDomain !== "chat") {
        return;
      }

      // Parse action data
      const actionData = notification.actionData as ChatActionData | null;
      if (!actionData?.channelId) {
        console.warn(
          "[useChatSSE] Chat notification missing channelId",
          notification,
        );
        return;
      }

      // Route by notification type
      const notificationType = notification.notificationType;

      // Handle: message (new message in channel)
      if (notificationType === "message") {
        const channelId = actionData.channelId;
        console.log("[useChatSSE] New message in channel:", channelId);

        // Targeted update: fetch only messages newer than what is already in cache.
        // This avoids refetching ALL loaded pages (which causes N calls for N loaded pages).
        // pages[0] is the newest page; its messages are chronological (oldest→newest),
        // so the last element is the newest message we have.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cachedData = queryClient.getQueryData<any>([
          "messages",
          channelId,
        ]);
        const firstPage = cachedData?.pages?.[0];
        const newestMessageId: string | undefined =
          firstPage?.messages?.[firstPage.messages.length - 1]?.id;

        if (newestMessageId) {
          listMessages({
            channelId,
            pageSize: 50,
            pageToken: newestMessageId,
            direction: "NEWER",
          })
            .then((response) => {
              if (!response.messages?.length) return;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              queryClient.setQueryData(["messages", channelId], (old: any) => {
                if (!old?.pages?.length) return old;
                // Deduplicate: ignore messages already present in case both
                // SSE and sendMessageMutation.onSuccess trigger concurrently.
                const existingIds = new Set(
                  (old.pages[0].messages || []).map(
                    (m: { id?: string }) => m.id,
                  ),
                );
                const newMessages = response.messages.filter(
                  (m: { id?: string }) => m.id && !existingIds.has(m.id),
                );
                if (!newMessages.length) return old;
                return {
                  ...old,
                  pages: [
                    {
                      ...old.pages[0],
                      messages: [
                        ...(old.pages[0].messages || []),
                        ...newMessages,
                      ],
                    },
                    ...old.pages.slice(1),
                  ],
                };
              });
            })
            .catch(() => {
              // Fallback to full invalidation if targeted fetch fails
              queryClient.invalidateQueries({
                queryKey: ["messages", channelId],
              });
            });
        } else {
          // No cache yet — full invalidation
          queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
        }

        // Invalidate channel list to update last_message_at
        queryClient.invalidateQueries({ queryKey: ["channels"] });
      }

      // Handle: mention (user mentioned in message)
      else if (notificationType === "mention") {
        console.log(
          "[useChatSSE] User mentioned in message:",
          actionData.messageId,
        );

        // OPTIMIZATION: Only invalidate the specific message where mention occurred
        // The message itself doesn't change, but we might need to refetch to get
        // updated mention metadata. Most mentions are in new messages which will
        // be fetched via the 'message' event anyway.
        if (actionData.messageId) {
          queryClient.invalidateQueries({
            queryKey: ["message", actionData.messageId],
          });
        }

        // REMOVED: Full channel invalidation (too expensive for just a mention highlight)
        // Old: queryClient.invalidateQueries({ queryKey: ['messages', actionData.channelId] });

        // Note: Browser notification handled by workspace layout (T039)
      }

      // Handle: reply (reply to user's message)
      else if (notificationType === "reply") {
        console.log(
          "[useChatSSE] Reply to message:",
          actionData.parentMessageId,
        );

        const { channelId, parentMessageId } = actionData;

        // Invalidate replies for parent message (updates open ThreadView)
        if (parentMessageId) {
          queryClient.invalidateQueries({
            queryKey: ["replies", parentMessageId],
          });
        }

        // Invalidate the single-message query so standalone message fetches stay fresh
        if (parentMessageId) {
          queryClient.invalidateQueries({
            queryKey: ["message", parentMessageId],
          });
        }

        // Refresh the channel list entry so reply counts stay correct even when
        // thread send/invalidate paths and SSE land close together.
        if (channelId && parentMessageId) {
          queryClient.invalidateQueries({
            queryKey: ["messages", channelId],
          });
        }

        // Notify: action==='view_thread' means this is targeted at the parent message
        // author — i.e., someone replied specifically to the current user's message.
        if (
          actionData.action === "view_thread" &&
          onReplyEvent &&
          parentMessageId
        ) {
          onReplyEvent({
            channelId,
            parentMessageId,
            title: notification.title || "Someone replied to your message",
          });
        }
      }

      // Handle: typing (user typing indicator)
      else if (notificationType === "typing") {
        // Backend sends:
        // - actionData.employeeId: the person typing
        // - actionData.action: "start" or "stop"
        // - actionData.parentMessageId: optional, for thread typing
        // - notification.title: formatted name (fallback if not extracted)
        const employeeId = (actionData as { employeeId?: string }).employeeId;
        const action = actionData.action;
        const parentMessageId = actionData.parentMessageId;

        console.log("[useChatSSE] Typing event:", {
          channelId: actionData.channelId,
          parentMessageId,
          employeeId,
          action,
          title: notification.title,
          hasCallback: !!onTypingEvent,
        });

        if (onTypingEvent && employeeId) {
          // Extract user name from notification title (format: "John Doe is typing...")
          // or from actionData if backend adds it in future
          const userName =
            notification.title?.replace(" is typing...", "") || "Someone";
          const isTyping = action === "start";

          onTypingEvent({
            channelId: actionData.channelId,
            parentMessageId: parentMessageId,
            userId: employeeId,
            userName: userName,
            isTyping,
          });
        } else {
          console.warn("[useChatSSE] Typing event ignored:", {
            hasCallback: !!onTypingEvent,
            hasEmployeeId: !!employeeId,
          });
        }
      }
      // Handle: reaction (reaction added/removed - OPTIMIZED)
      else if (notificationType === "reaction") {
        console.log("[useChatSSE] Reaction event:", actionData);

        // Apply optimistic cache patch for immediate UI feedback
        const emojiCode =
          actionData.emojiCode || actionData.reactionEmoji || actionData.emoji;
        const action = actionData.action; // e.g., 'removed'
        const isRemove = action === "removed";
        const messageId = actionData.messageId;
        const channelId = actionData.channelId;

        // Helper: update reactions array for a message-like object (proto-shaped)
        function patchReactionsArray(reactions: ReactionLike[] | undefined) {
          if (!reactions) return reactions;
          const idx = reactions.findIndex(
            (r) => (r.emojiCode || r.emoji) === emojiCode,
          );
          if (isRemove) {
            if (idx === -1) return reactions;
            const updated = [...reactions];
            updated[idx] = {
              ...updated[idx],
              count: Math.max(0, (updated[idx].count || 1) - 1),
            };
            if ((updated[idx].count || 0) <= 0) {
              updated.splice(idx, 1);
            }
            return updated;
          } else {
            // Add
            if (idx === -1) {
              // push a lightweight proto-like object; server will reconcile
              return [
                ...reactions,
                {
                  emojiCode,
                  count: 1,
                  employeeIds: [],
                  currentUserReacted: false,
                  firstReactedAt: {
                    seconds: String(Math.floor(Date.now() / 1000)),
                  },
                },
              ];
            }
            const updated = [...reactions];
            updated[idx] = {
              ...updated[idx],
              count: (updated[idx].count || 0) + 1,
            };
            return updated;
          }
        }

        // Optimistic update: Patch infinite messages list (useInfiniteQuery data shape)
        // Note: If the message isn't in the cache (e.g., old message not yet loaded by this user),
        // the patch silently skips it. When the user later scrolls to that message, the backend
        // will return the correct reaction data, so no synchronization issues occur.
        if (channelId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          queryClient.setQueryData(["messages", channelId], (old: any) => {
            if (!old) return old;

            // Track if we found and updated the message
            let messageFound = false;

            // If data is paginated (pages), update each page.messages
            if (old.pages && Array.isArray(old.pages)) {
              const pages = old.pages.map(
                (page: {
                  messages?: Array<{ id: string; reactions?: ReactionLike[] }>;
                }) => {
                  if (!page.messages) return page;
                  return {
                    ...page,
                    messages: page.messages.map(
                      (m: { id: string; reactions?: ReactionLike[] }) => {
                        if (m.id !== messageId) return m;
                        messageFound = true;
                        return {
                          ...m,
                          reactions: patchReactionsArray(m.reactions),
                        };
                      },
                    ),
                  };
                },
              );

              // Debug log for edge case tracking
              if (!messageFound) {
                console.debug(
                  "[useChatSSE] Reaction event for message not in cache (user may not have loaded it yet):",
                  {
                    messageId,
                    channelId,
                    loadedPages: old.pages.length,
                    totalLoadedMessages: old.pages.reduce(
                      (sum: number, p: { messages?: unknown[] }) =>
                        sum + (p.messages?.length || 0),
                      0,
                    ),
                  },
                );
              }

              return { ...old, pages };
            }
            // Otherwise, if it's a single response with messages array
            if (old.messages && Array.isArray(old.messages)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const updated = old.messages.map((m: any) => {
                if (m.id === messageId) {
                  messageFound = true;
                  return { ...m, reactions: patchReactionsArray(m.reactions) };
                }
                return m;
              });

              if (!messageFound) {
                console.debug(
                  "[useChatSSE] Reaction event for message not in cache:",
                  messageId,
                );
              }

              return { ...old, messages: updated };
            }
            return old;
          });
        }

        // Optimistic update: Patch single message cache
        if (messageId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          queryClient.setQueryData(["message", messageId], (old: any) => {
            if (!old) return old;
            return { ...old, reactions: patchReactionsArray(old.reactions) };
          });
        }

        // OPTIMIZATION: Instead of invalidating entire message list (triggers full refetch),
        // invalidate only the specific message query. This limits backend load and UI updates
        // to just the affected message rather than refetching all 50+ messages in the channel.
        //
        // The optimistic update above provides immediate feedback, and this invalidation
        // ensures the cache stays in sync with the server's authoritative reaction data.
        //
        // Note: We keep the optimistic patching for instant UI response, but rely on
        // invalidation rather than explicit refetch to let React Query handle the update
        // when the user next views/interacts with the message. For visible messages,
        // the invalidation triggers near-instant background refetch.
        if (messageId) {
          queryClient.invalidateQueries({ queryKey: ["message", messageId] });
        }

        // REMOVED: Full channel message list invalidation (too expensive)
        // Old approach: queryClient.invalidateQueries({ queryKey: ['messages', channelId] });
        //
        // Why removed:
        // - Causes refetch of 50-100+ messages on every single reaction
        // - High backend load for multi-user channels with frequent reactions
        // - Optimistic update + single message invalidation is sufficient
      }

      // Handle: voice call live updates and targeted invites
      else if (isVoiceCallNotificationType(notificationType)) {
        const channelId = actionData.channelId;
        // Only invalidate the message list when a call ends — that is the only
        // event that posts a call-record system message to the channel.
        // Invalidating on started/updated/incoming causes every VoiceCallRecord
        // component to re-run listCallRecords on every participant update.
        if (notificationType === "voice_call_ended") {
          queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
        }
        queryClient.invalidateQueries({ queryKey: ["channels"] });
        queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
      }

      // Unknown notification type
      else {
        console.warn(
          "[useChatSSE] Unknown notification type:",
          notificationType,
          notification,
        );
      }
    },
    [onTypingEvent, onReplyEvent, queryClient],
  );

  useEffect(() => {
    if (!enabled) {
      console.log("[useChatSSE] Subscription disabled");
      return;
    }

    const unsubscribe = subscribe(handleNotification);
    return () => {
      unsubscribe();
    };
  }, [enabled, subscribe, handleNotification]);

  // Log connection status changes
  useEffect(() => {
    console.log("[useChatSSE] Connection status:", status);
  }, [status]);

  return {
    status,
    error,
  };
}
