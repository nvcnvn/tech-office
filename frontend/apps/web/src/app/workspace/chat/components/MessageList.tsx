/**
 * Message List Component
 * Center area displaying messages with virtual scrolling
 *
 * Features:
 * - Virtual scrolling for performance with large message lists
 * - Messages ordered chronologically (oldest to newest, newest at bottom)
 * - Auto-scroll to bottom on new messages (unless user scrolled up)
 * - "New messages" indicator when user is scrolled up
 * - Load more on scroll up
 * - Message highlighting for deep linking
 * - Typing indicators
 */

"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CircularProgress,
  Typography,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  getChannel,
  listMessages,
  sendMessage,
  addReaction,
  removeReaction,
} from "apis";
import VirtualizedMessageList, {
  type VirtualizedMessage,
} from "./VirtualizedMessageList";
import MessageComposer from "./MessageComposer";
import { VoiceCallBar } from "./voice/VoiceCallBar";
import { VoiceCallAnnouncement } from "./voice/VoiceCallAnnouncement";
import TypingIndicator from "./TypingIndicator";
import InviteMemberDialog from "./InviteMemberDialog";
import { emojiToCode } from "../utils/emoji";
import { useThemeColors } from "@/theme/useThemeColors";
import { useRegisterActiveChannel } from "@/hooks/useActiveChannelRegistry";
import { useAuthState } from "@/lib/auth/hooks";
import { useVoiceCall } from "../hooks/useVoiceCall";

interface MessageListProps {
  channelId: string;
  highlightMessageId: string | null;
  highlightedMessageMetadata?: {
    parentMessageId: string | null;
    channelId: string | null;
  };
  onOpenThread: (messageId: string) => void;
  typingUsers: Array<{ userId: string; userName: string; expiresAt: Date }>;
  replyNotification?: { title: string; parentMessageId: string } | null;
  onDismissReplyNotification?: () => void;
}

export default function MessageList({
  channelId,
  highlightMessageId,
  highlightedMessageMetadata,
  onOpenThread,
  typingUsers,
  replyNotification,
  onDismissReplyNotification,
}: MessageListProps) {
  type ServerMessage = NonNullable<
    Awaited<ReturnType<typeof listMessages>>["messages"]
  >[number];
  type OptimisticMessage = VirtualizedMessage & {
    id: string;
    clientStatus: "sending" | "failed";
    clientError?: string;
    originalMessageText: string;
    originalFileIds: string[];
  };

  const queryClient = useQueryClient();
  const colors = useThemeColors();
  const { user } = useAuthState();
  const voiceCall = useVoiceCall({ channelId, enabled: Boolean(channelId) });

  // Register this channel as actively visible so notification popups are suppressed
  useRegisterActiveChannel(channelId);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [copyChannelLinkSuccess, setCopyChannelLinkSuccess] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<
    OptimisticMessage[]
  >([]);
  const deepLinkFetchInFlightRef = useRef(false);
  const deepLinkAutoScrollDoneRef = useRef(false);

  const currentMembership = useMemo(
    () =>
      user?.organizations.find(
        (org) => org.organizationId === user.organizationId,
      ) ?? user?.organizations[0],
    [user],
  );
  const currentAuthorName = user?.name || user?.email || "You";
  const currentAuthorEmail = user?.email || "";
  const currentAuthorAvatar = user?.picture;

  useEffect(() => {
    setOptimisticMessages([]);
  }, [channelId]);

  const handleCopyChannelLink = async () => {
    try {
      if (!currentMembership?.organizationSubdomain) return;
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:18080"}/api/linking/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: {
              tenantKey: currentMembership.organizationSubdomain,
              resourceType: "chat",
              resourceId: channelId,
            },
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        canonicalUrl?: string;
      } | null;
      if (response.ok && payload?.canonicalUrl) {
        await navigator.clipboard.writeText(payload.canonicalUrl);
        setCopyChannelLinkSuccess(true);
        setTimeout(() => setCopyChannelLinkSuccess(false), 2000);
      }
    } catch {
      // silently ignore
    }
  };
  const [shouldAutoScrollToHighlight, setShouldAutoScrollToHighlight] =
    useState(false);

  // Fetch channel details
  const { data: channelData } = useQuery({
    queryKey: ["channel", channelId],
    queryFn: async () => {
      const response = await getChannel(channelId);
      return response.channel;
    },
    enabled: !!channelId,
  });

  // Fetch messages with infinite scroll
  // Backend returns messages newest-first per page, but reversed to oldest-first
  // First page: most recent messages (oldest to newest in display order)
  // Subsequent pages: older messages (load more on scroll up)
  const {
    data: messagesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingMessages,
  } = useInfiniteQuery({
    queryKey: ["messages", channelId],
    queryFn: async ({ pageParam = "" }) => {
      const response = await listMessages({
        channelId,
        pageSize: 50,
        pageToken: pageParam,
        direction: "OLDER",
      });
      return response;
    },
    getNextPageParam: (lastPage) => {
      console.log("[MessageList] getNextPageParam called:", {
        messagesInPage: lastPage.messages?.length || 0,
        previousPageToken: lastPage.previousPageToken,
        hasToken: !!lastPage.previousPageToken,
      });
      return lastPage.previousPageToken || undefined;
    },
    enabled: !!channelId,
    initialPageParam: "",
  });

  // Flatten all messages from pages
  // Pages come in reverse chronological order (newest page first, then older pages)
  // But messages within each page are already in chronological order (oldest to newest)
  // So we need to reverse the page order to get full chronological list
  const allMessages = useMemo(() => {
    return messagesData?.pages
      ? [...messagesData.pages].reverse().flatMap((page) => page.messages || [])
      : [];
  }, [messagesData?.pages]);

  const insertMessageIntoCache = React.useCallback(
    (message: ServerMessage) => {
      const cacheKey = ["messages", channelId];
      const cachedData = queryClient.getQueryData<{
        pages?: Array<{ messages?: ServerMessage[] }>;
      }>(cacheKey);

      if (!cachedData?.pages?.length) {
        queryClient.invalidateQueries({ queryKey: cacheKey });
        queryClient.invalidateQueries({ queryKey: ["channels"] });
        return;
      }

      queryClient.setQueryData(cacheKey, (old: {
        pages?: Array<{ messages?: ServerMessage[] }>;
      } | undefined) => {
        if (!old?.pages?.length) return old;
        const alreadyPresent = old.pages.some((page) =>
          (page.messages || []).some((existing) => existing.id === message.id),
        );
        if (alreadyPresent) return old;
        return {
          ...old,
          pages: [
            {
              ...old.pages[0],
              messages: [...(old.pages[0].messages || []), message],
            },
            ...old.pages.slice(1),
          ],
        };
      });

      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
    [channelId, queryClient],
  );

  const sendOptimisticMessage = React.useCallback(
    async (message: OptimisticMessage) => {
      try {
        const response = await sendMessage({
          channelId,
          messageText: message.originalMessageText,
          fileIds: message.originalFileIds,
        });

        setOptimisticMessages((current) =>
          current.filter((item) => item.id !== message.id),
        );

        if (response.message) {
          insertMessageIntoCache(response.message as ServerMessage);
        } else {
          queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
          queryClient.invalidateQueries({ queryKey: ["channels"] });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unable to send message.";
        setOptimisticMessages((current) =>
          current.map((item) =>
            item.id === message.id
              ? {
                  ...item,
                  clientStatus: "failed",
                  clientError: errorMessage,
                }
              : item,
          ),
        );
      }
    },
    [channelId, insertMessageIntoCache, queryClient],
  );

  const retryOptimisticMessage = React.useCallback(
    (messageId: string) => {
      const currentMessage = optimisticMessages.find(
        (item) => item.id === messageId,
      );
      if (!currentMessage) return;

      const retryMessage: OptimisticMessage = {
        ...currentMessage,
        clientStatus: "sending",
        clientError: undefined,
      };

      setOptimisticMessages((current) =>
        current.map((item) =>
          item.id === messageId ? retryMessage : item,
        ),
      );
      void sendOptimisticMessage(retryMessage);
    },
    [optimisticMessages, sendOptimisticMessage],
  );

  const displayMessages = useMemo(
    () => [...allMessages, ...optimisticMessages],
    [allMessages, optimisticMessages],
  );

  // Debug pagination state
  console.log("[MessageList] Pagination state:", {
    channelId,
    totalMessages: allMessages.length,
    pageCount: messagesData?.pages.length,
    hasNextPage,
    isFetchingNextPage,
    firstMessageId: allMessages[0]?.id,
    lastMessageId: allMessages[allMessages.length - 1]?.id,
    pages: messagesData?.pages.map((page, idx) => ({
      pageIndex: idx,
      messageCount: page.messages?.length || 0,
      previousPageToken: page.previousPageToken,
      firstMessageId: page.messages?.[0]?.id,
      lastMessageId: page.messages?.[page.messages.length - 1]?.id,
    })),
  });

  const handleSendMessage = async (messageText: string, fileIds?: string[]) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage: OptimisticMessage = {
      id: optimisticId,
      authorName: currentAuthorName,
      authorEmail: currentAuthorEmail,
      authorAvatar: currentAuthorAvatar,
      messageText,
      updatedAt: { seconds: nowSeconds },
      replyCount: 0,
      threadParticipantIds: [],
      reactions: [],
      fileIds: fileIds || [],
      messageKind: "text",
      systemEventType: "",
      metadataJson: "",
      clientStatus: "sending",
      originalMessageText: messageText,
      originalFileIds: fileIds || [],
      onRetry: () => retryOptimisticMessage(optimisticId),
    };

    setOptimisticMessages((current) => [...current, optimisticMessage]);
    void sendOptimisticMessage(optimisticMessage);
  };

  const handleVoiceMessageSent = () => {
    queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
  };

  // Reaction mutations
  // OPTIMIZATION: Only invalidate the specific message, not the entire channel
  // This prevents refetching 50-100+ messages on every reaction
  // See: frontend/apps/web/docs/REACTION-SSE-OPTIMIZATION.md
  const addReactionMutation = useMutation({
    mutationFn: async ({
      messageId,
      emoji,
    }: {
      messageId: string;
      emoji: string;
    }) => {
      // Convert Unicode emoji to :code: format for backend
      const emojiCode = emojiToCode(emoji);
      return await addReaction({
        messageId,
        emojiCode,
      });
    },
    onSuccess: (_, variables) => {
      // Only invalidate the specific message that was reacted to
      queryClient.invalidateQueries({
        queryKey: ["message", variables.messageId],
      });
      // REMOVED: Full channel invalidation (too expensive)
      // queryClient.invalidateQueries({ queryKey: ['messages', channelId] });
    },
  });

  const removeReactionMutation = useMutation({
    mutationFn: async ({
      messageId,
      emoji,
    }: {
      messageId: string;
      emoji: string;
    }) => {
      // Convert Unicode emoji to :code: format for backend
      const emojiCode = emojiToCode(emoji);
      return await removeReaction({
        messageId,
        emojiCode,
      });
    },
    onSuccess: (_, variables) => {
      // Only invalidate the specific message that was reacted to
      queryClient.invalidateQueries({
        queryKey: ["message", variables.messageId],
      });
      // REMOVED: Full channel invalidation (too expensive)
      // queryClient.invalidateQueries({ queryKey: ['messages', channelId] });
    },
  });

  const handleReaction = async (
    messageId: string,
    emoji: string,
    shouldRemove: boolean,
  ) => {
    if (shouldRemove) {
      await removeReactionMutation.mutateAsync({ messageId, emoji });
    } else {
      await addReactionMutation.mutateAsync({ messageId, emoji });
    }
  };

  // Ensure deep-linked messages that live far in history are loaded by fetching older pages.
  useEffect(() => {
    if (!highlightMessageId) {
      deepLinkFetchInFlightRef.current = false;
      // Reset one-time auto-scroll when deep-link cleared
      deepLinkAutoScrollDoneRef.current = false;
      setShouldAutoScrollToHighlight(false);
      return;
    }

    // Skip if metadata indicates this is a reply (handled via thread view) or different channel
    if (
      highlightedMessageMetadata?.parentMessageId &&
      highlightedMessageMetadata.parentMessageId !== highlightMessageId
    ) {
      return;
    }
    if (
      highlightedMessageMetadata?.channelId &&
      highlightedMessageMetadata.channelId !== channelId
    ) {
      return;
    }

    const alreadyLoaded = allMessages.some(
      (message) => message.id === highlightMessageId,
    );
    if (alreadyLoaded) {
      deepLinkFetchInFlightRef.current = false;
      // If we haven't auto-scrolled yet for this deep-link, ask the list to do it once
      if (!deepLinkAutoScrollDoneRef.current) {
        setShouldAutoScrollToHighlight(true);
      }
      return;
    }

    if (!hasNextPage || deepLinkFetchInFlightRef.current) {
      return;
    }

    deepLinkFetchInFlightRef.current = true;
    fetchNextPage().finally(() => {
      deepLinkFetchInFlightRef.current = false;
    });
  }, [
    highlightMessageId,
    highlightedMessageMetadata,
    channelId,
    allMessages,
    hasNextPage,
    fetchNextPage,
  ]);

  if (isLoadingMessages) {
    return (
      <div
        className={`flex-1 flex items-center justify-center ${colors.bg.paper.className}`}
      >
        <CircularProgress />
      </div>
    );
  }

  return (
    <div
      className={`flex-1 flex flex-col ${colors.bg.paper.className} min-w-0`}
    >
      {/* Channel Header */}
      <div
        className={`h-12 px-4 ${colors.border.default.className} border-b flex items-center justify-between shrink-0`}
      >
        <div className="flex items-center flex-1 min-w-0">
          <Typography variant="h6" className="shrink-0">
            {channelData?.isPrivate ? "🔒" : "#"}{" "}
            {channelData?.displayName || "Channel"}
          </Typography>
          {channelData?.description && (
            <Typography
              variant="body2"
              color="text.secondary"
              className="ml-4 truncate"
            >
              {channelData.description}
            </Typography>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Tooltip
            title={copyChannelLinkSuccess ? "Copied!" : "Copy channel link"}
          >
            <IconButton
              size="small"
              onClick={() => {
                void handleCopyChannelLink();
              }}
              data-testid="channel-copy-link-btn"
            >
              <span className="text-lg">🔗</span>
            </IconButton>
          </Tooltip>
          <IconButton
            size="small"
            onClick={() => setInviteDialogOpen(true)}
            title="Invite members to channel"
            sx={{
              "&:hover": {
                backgroundColor: "rgba(0, 0, 0, 0.04)",
              },
            }}
          >
            <span className="text-lg">👥</span>
          </IconButton>
        </div>
      </div>

      {/* Messages Area with Virtual Scrolling */}
      <div className="flex-1 min-h-0 relative">
        <VirtualizedMessageList
          messages={displayMessages}
          channelId={channelId}
          isLoading={isLoadingMessages}
          hasMore={hasNextPage}
          isFetchingMore={isFetchingNextPage}
          onLoadMore={fetchNextPage}
          highlightedMessageId={highlightMessageId}
          listId={channelId}
          onReply={onOpenThread}
          onReact={handleReaction}
          onEdit={(messageId) => {
            // TODO: Implement message editing
            console.log("Edit message:", messageId);
          }}
          onDelete={(messageId) => {
            // TODO: Implement message deletion
            console.log("Delete message:", messageId);
          }}
          emptyMessage="No messages yet. Start the conversation!"
          emptyIcon="💬"
          headerComponent={<VoiceCallAnnouncement voiceCall={voiceCall} />}
          autoScrollToHighlighted={shouldAutoScrollToHighlight}
          onAutoScrolled={() => {
            deepLinkAutoScrollDoneRef.current = true;
            setShouldAutoScrollToHighlight(false);
          }}
          replyNotification={replyNotification}
          onDismissReplyNotification={onDismissReplyNotification}
        />
      </div>

      {/* Typing Indicator - positioned above composer */}
      {typingUsers.length > 0 && (
        <div
          className={`shrink-0 px-4 py-2 ${colors.bg.hover} ${colors.border.default.className} border-t`}
        >
          <TypingIndicator channelId={channelId} typingUsers={typingUsers} />
        </div>
      )}

      <VoiceCallBar voiceCall={voiceCall} />

      {/* Message Composer */}
      <div className="shrink-0">
        <MessageComposer
          channelId={channelId}
          onSend={handleSendMessage}
          voiceCall={voiceCall}
          onVoiceMessageSent={handleVoiceMessageSent}
        />
      </div>

      {/* Invite Member Dialog */}
      {channelData && (
        <InviteMemberDialog
          open={inviteDialogOpen}
          onClose={() => setInviteDialogOpen(false)}
          channelId={channelId}
          channelName={
            channelData.displayName || channelData.titleSlug || "Channel"
          }
        />
      )}
    </div>
  );
}
