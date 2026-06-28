/**
 * Thread replies screen — replies to a specific message
 *
 * UX goals (low-tech workers):
 * - Large reply bubbles with avatar + author name
 * - Real-time via SSE
 * - Simple reply composer at bottom
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  ActivityIndicator,
  Platform,
  Modal,
  Share,
  StyleSheet,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useNavigation, useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  getMessageById,
  listReplies,
  replyToMessage,
  startTyping,
  stopTyping,
  addReaction,
  removeReaction,
  DEFAULT_REACTION_EMOJIS,
  QUICK_REACTION_EMOJIS,
  emojiToCode,
  codeToEmoji,
  getProfile,
} from "apis";
import { useAuth } from "@/hooks/use-auth";
import { generateCanonicalUrl } from "@/lib/canonical-links";
import { ChatMessageBody } from "@/components/chat/chat-message-body";
import { SFIcon } from "@/components/ui/sf-icon";
import * as Haptics from "expo-haptics";
import { UserAvatar } from "@/components/common/user-avatar";
import { useNotificationStream } from "@/providers/notification-stream-provider";
import { formatMessageTime } from "@/lib/date-utils";
import { parseChatStreamEvent } from "@/lib/chat-stream-events";
import {
  parseNavigationContext,
  resolveNavigationBackHref,
  withNavigationContext,
} from "@/lib/mobile-navigation";
import {
  border,
  lightPalette,
  mobileTypography,
} from "@tech-office/theme-tokens";
import { API_BASE_URL } from "@/lib/constants";

interface ProtoTimestamp {
  seconds?: number | string;
}

interface ThreadReply {
  id?: string;
  messageId?: string;
  parentMessageId?: string | null;
  updatedAt?: ProtoTimestamp | null;
  authorName?: string | null;
  messageText?: string | null;
  fileIds?: string[];
  messageKind?: string;
  systemEventType?: string;
  metadataJson?: string;
  reactions?: Array<{
    emojiCode: string;
    count: number;
    currentUserReacted: boolean;
  }>;
}

interface ThreadRepliesResponse {
  replies?: ThreadReply[];
}

interface ThreadParentMessageResponse {
  message?: ThreadReply | null;
  channel?: {
    id?: string | null;
  } | null;
}

interface ChannelMessageListPage {
  messages?: Array<{
    id?: string;
    replyCount?: number;
    lastReplyAt?: ProtoTimestamp | null;
  }>;
}

const IOS_NAVIGATION_BAR_HEIGHT = 44;

function ReactionPicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.emojiSheet}>
          <Text style={styles.emojiSheetTitle}>React</Text>
          <View style={styles.emojiGrid}>
            {DEFAULT_REACTION_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => {
                  onSelect(emoji);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.emojiBtn,
                  pressed && { backgroundColor: lightPalette.background.default },
                ]}
              >
                <Text style={styles.emojiText}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

function ThreadMessageActionSheet({
  visible,
  onClose,
  onQuickReact,
  onMoreEmoji,
  onCopyLink,
  onMoveToChannel,
}: {
  visible: boolean;
  onClose: () => void;
  onQuickReact: (emoji: string) => void;
  onMoreEmoji: () => void;
  onCopyLink: () => void;
  onMoveToChannel: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.actionSheet}>
          <View style={styles.actionSheetHandle} />
          <Text style={styles.actionSheetTitle}>Message actions</Text>
          <Text style={styles.actionSheetSubtitle}>React or move back to the channel.</Text>

          <View style={styles.quickReactionRow}>
            {QUICK_REACTION_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onQuickReact(emoji)}
                style={({ pressed }) => [
                  styles.quickReactionBtn,
                  pressed && styles.quickReactionBtnPressed,
                ]}
              >
                <Text style={styles.quickReactionText}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={onMoreEmoji}
              style={({ pressed }) => [
                styles.quickReactionBtn,
                pressed && styles.quickReactionBtnPressed,
              ]}
              accessibilityLabel="Open reaction picker"
            >
              <SFIcon name="face.smiling" size={18} color={lightPalette.text.primary} />
            </Pressable>
          </View>

          <Pressable
            onPress={onCopyLink}
            style={({ pressed }) => [
              styles.actionSheetRow,
              pressed && styles.actionSheetRowPressed,
            ]}
          >
            <View style={styles.actionSheetIconWrap}>
              <SFIcon name="link" size={16} color={lightPalette.text.primary} />
            </View>
            <View style={styles.actionSheetRowBody}>
              <Text style={styles.actionSheetRowTitle}>Share canonical link</Text>
              <Text style={styles.actionSheetRowText}>
                Share a stable link that opens this message inside the thread.
              </Text>
            </View>
            <SFIcon name="square.and.arrow.up" size={14} color={lightPalette.text.secondary} />
          </Pressable>

          <Pressable
            onPress={onMoveToChannel}
            style={({ pressed }) => [
              styles.actionSheetRow,
              pressed && styles.actionSheetRowPressed,
            ]}
          >
            <View style={styles.actionSheetIconWrap}>
              <SFIcon name="arrow.right.circle" size={16} color={lightPalette.text.primary} />
            </View>
            <View style={styles.actionSheetRowBody}>
              <Text style={styles.actionSheetRowTitle}>Move to channel</Text>
              <Text style={styles.actionSheetRowText}>Jump back to the parent message in the channel timeline.</Text>
            </View>
            <SFIcon name="chevron.right" size={14} color={lightPalette.text.secondary} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Reply item ───────────────────────────────────────────────────────────────

function protoToDate(ts: ProtoTimestamp | null | undefined): Date | null {
  if (!ts) return null;
  const secs = Number(ts.seconds ?? 0);
  return secs > 0 ? new Date(secs * 1000) : null;
}

function ReplyItem({
  item,
  channelId,
  contentWidth,
  isHighlighted,
  onLongPress,
  onReactionPress,
}: {
  item: ThreadReply;
  channelId?: string | null;
  contentWidth: number;
  isHighlighted?: boolean;
  onLongPress: (message: ThreadReply) => void;
  onReactionPress: (messageId: string, emojiCode: string, currentlyReacted: boolean) => void;
}) {
  const msgDate = protoToDate(item.updatedAt);
  return (
    <Pressable
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress(item);
      }}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.replyPressable,
        isHighlighted && styles.messageHighlight,
        pressed && styles.replyPressablePressed,
      ]}
    >
      <View style={styles.replyItem}>
        <UserAvatar name={item.authorName || "?"} size={32} />
        <View style={styles.replyContent}>
          <View style={styles.replyHeader}>
            <Text style={styles.senderName}>{item.authorName || "Unknown"}</Text>
            {msgDate && (
              <Text style={styles.timestamp}>{formatMessageTime(msgDate)}</Text>
            )}
          </View>
          <ChatMessageBody
            messageText={item.messageText ?? ""}
            fileIds={item.fileIds ?? []}
            messageKind={item.messageKind}
            systemEventType={item.systemEventType}
            metadataJson={item.metadataJson}
            channelId={channelId ?? undefined}
            messageTimestamp={msgDate}
            contentWidth={contentWidth}
            textStyle={styles.replyText}
          />
          {(item.reactions ?? []).length > 0 ? (
            <View style={styles.reactionsRow}>
              {(item.reactions ?? []).map((reaction) => (
                <Pressable
                  key={reaction.emojiCode}
                  onPress={() => {
                    if (!item.id) {
                      return;
                    }
                    onReactionPress(item.id, reaction.emojiCode, reaction.currentUserReacted);
                  }}
                  style={[
                    styles.reactionChip,
                    reaction.currentUserReacted && styles.reactionChipActive,
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{codeToEmoji(reaction.emojiCode)}</Text>
                  <Text
                    style={[
                      styles.reactionCount,
                      reaction.currentUserReacted && styles.reactionCountActive,
                    ]}
                  >
                    {reaction.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function ParentMessageCard({
  item,
  channelId,
  contentWidth,
  isHighlighted,
  onPress,
  onLongPress,
  onReactionPress,
}: {
  item: ThreadReply;
  channelId?: string | null;
  contentWidth: number;
  isHighlighted?: boolean;
  onPress: () => void;
  onLongPress: (message: ThreadReply) => void;
  onReactionPress: (messageId: string, emojiCode: string, currentlyReacted: boolean) => void;
}) {
  const msgDate = protoToDate(item.updatedAt);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress(item);
      }}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.parentCard,
        isHighlighted && styles.messageHighlight,
        pressed && styles.parentCardPressed,
      ]}
    >
      <View style={styles.parentCardHeader}>
        <Text style={styles.parentCardLabel}>Message details</Text>
        <View style={styles.parentCardAction}>
          <Text style={styles.parentCardActionText}>Back to channel</Text>
          <SFIcon name="chevron.right" size={12} color={lightPalette.text.secondary} />
        </View>
      </View>
      <View style={styles.replyItem}>
        <UserAvatar name={item.authorName || "?"} size={32} />
        <View style={styles.replyContent}>
          <View style={styles.replyHeader}>
            <Text style={styles.senderName}>{item.authorName || "Unknown"}</Text>
            {msgDate && (
              <Text style={styles.timestamp}>{formatMessageTime(msgDate)}</Text>
            )}
          </View>
          <ChatMessageBody
            messageText={item.messageText ?? ""}
            fileIds={item.fileIds ?? []}
            messageKind={item.messageKind}
            systemEventType={item.systemEventType}
            metadataJson={item.metadataJson}
            channelId={channelId ?? undefined}
            messageTimestamp={msgDate}
            contentWidth={contentWidth}
            textStyle={styles.replyText}
          />
          {(item.reactions ?? []).length > 0 ? (
            <View style={styles.reactionsRow}>
              {(item.reactions ?? []).map((reaction) => (
                <Pressable
                  key={reaction.emojiCode}
                  onPress={() => {
                    if (!item.id) {
                      return;
                    }
                    onReactionPress(item.id, reaction.emojiCode, reaction.currentUserReacted);
                  }}
                  style={[
                    styles.reactionChip,
                    reaction.currentUserReacted && styles.reactionChipActive,
                  ]}
                >
                  <Text style={styles.reactionEmoji}>{codeToEmoji(reaction.emojiCode)}</Text>
                  <Text
                    style={[
                      styles.reactionCount,
                      reaction.currentUserReacted && styles.reactionCountActive,
                    ]}
                  >
                    {reaction.count}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ThreadScreen() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const { messageId, highlightedMessageId, navParent, navFallback, navTab, navLabel } = useLocalSearchParams<{
    messageId: string;
    highlightedMessageId?: string;
    navParent?: string;
    navFallback?: string;
    navTab?: string;
    navLabel?: string;
  }>();
  const navigation = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = windowWidth - 24 - 32 - 10;
  const [text, setText] = useState("");
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<ThreadReply | null>(null);
  const [pendingShareUrl, setPendingShareUrl] = useState<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const flatListRef = useRef<FlatList<ThreadReply>>(null);
  const shouldScrollToEndRef = useRef(false);
  const hasPerformedInitialScrollRef = useRef(false);
  const atBottomRef = useRef(true);
  const lastReplyIdRef = useRef<string | null>(null);
  const deepLinkAutoScrollDoneRef = useRef<string | null>(null);
  const highlightClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [showNewReplies, setShowNewReplies] = useState(false);
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const { setActiveThread, subscribe } = useNotificationStream();
  const navigationContext = useMemo(
    () => parseNavigationContext({ navParent, navFallback, navTab, navLabel }),
    [navFallback, navLabel, navParent, navTab],
  );
  const contextBackHref = resolveNavigationBackHref(navigationContext, "/(app)/(chat)");
  const showContextBackAction = !!navigationContext.backLabel && !navigation.canGoBack();
  const isSharedResourceRoute = segments[0] === "(shared)";
  const keyboardVerticalOffset =
    Platform.OS === "ios"
      ? insets.top + IOS_NAVIGATION_BAR_HEIGHT + (isSharedResourceRoute ? IOS_NAVIGATION_BAR_HEIGHT : 0)
      : 0;

  const activateHighlight = useCallback((targetMessageId: string) => {
    if (highlightClearTimerRef.current) {
      clearTimeout(highlightClearTimerRef.current);
    }

    setActiveHighlight(targetMessageId);
    highlightClearTimerRef.current = setTimeout(() => {
      setActiveHighlight((current) => (current === targetMessageId ? null : current));
      highlightClearTimerRef.current = null;
    }, 3000);
  }, []);

  const handleContextBack = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }

    router.replace(contextBackHref as never);
  }, [contextBackHref, navigation, router]);

  const { data: routeMessageData, isLoading: isLoadingRouteMessage } = useQuery<ThreadParentMessageResponse>({
    queryKey: ["thread-route-message", messageId],
    queryFn: async () => {
      const result = await getMessageById(messageId!);
      return result as ThreadParentMessageResponse;
    },
    enabled: !!messageId,
    staleTime: 60_000,
  });

  const threadRootId = routeMessageData?.message?.parentMessageId || messageId;
  const resolvedHighlightedMessageId = useMemo(() => {
    if (typeof highlightedMessageId === "string" && highlightedMessageId) {
      return highlightedMessageId;
    }

    if (routeMessageData?.message?.parentMessageId) {
      return messageId;
    }

    return null;
  }, [highlightedMessageId, messageId, routeMessageData?.message?.parentMessageId]);
  useFocusEffect(
    useCallback(() => {
      if (!threadRootId) {
        return undefined;
      }

      setActiveThread(threadRootId);

      return () => setActiveThread(null);
    }, [setActiveThread, threadRootId]),
  );

  const { data, isLoading } = useQuery<ThreadReply[]>({
    queryKey: ["thread", threadRootId],
    queryFn: async () => {
      const result = await listReplies({ parentMessageId: threadRootId! });
      return (result as ThreadRepliesResponse).replies ?? [];
    },
    enabled: !!threadRootId,
    refetchInterval: 30_000,
  });

  const { data: parentMessageData } = useQuery<ThreadParentMessageResponse>({
    queryKey: ["thread-parent-message", threadRootId],
    queryFn: async () => {
      const result = await getMessageById(threadRootId!);
      return result as ThreadParentMessageResponse;
    },
    enabled: !!threadRootId,
    staleTime: 60_000,
  });

  const parentChannelId = parentMessageData?.channel?.id ?? null;
  const parentMessage = parentMessageData?.message ?? null;
  const isInitialLoading = isLoadingRouteMessage || isLoading;
  const displayedReplies = data ?? [];

  const { data: profileData } = useQuery({
    queryKey: ["profile", "thread-share"],
    queryFn: () => getProfile(),
    enabled: auth.isAuthenticated,
    staleTime: 300_000,
  });

  const currentMembership = useMemo(
    () =>
      profileData?.organizations.find((org) => org.organizationId === auth.organizationId) ??
      profileData?.organizations[0],
    [auth.organizationId, profileData]
  );

  const handleShareThreadLink = useCallback(async () => {
    if (!currentMembership?.organizationSubdomain || !threadRootId) return;
    const url = await generateCanonicalUrl(currentMembership.organizationSubdomain, "thread", threadRootId);
    if (url) {
      await Share.share({ message: url, url });
    }
  }, [currentMembership, threadRootId]);

  const handleShareMessageLink = useCallback(async () => {
    if (!currentMembership?.organizationSubdomain || !threadRootId || !selectedMessage?.id) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/linking/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: {
            tenantKey: currentMembership.organizationSubdomain,
            resourceType: "thread",
            resourceId: threadRootId,
            anchorType: "message",
            anchorId: selectedMessage.id,
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { canonicalUrl?: string; error?: string }
        | null;

      if (!response.ok || !payload?.canonicalUrl) {
        throw new Error(payload?.error ?? "Failed to generate a canonical link.");
      }

      setPendingShareUrl(payload.canonicalUrl);
      setActionSheetVisible(false);
    } catch (error) {
      console.warn(
        "Failed to share canonical message link",
        error instanceof Error ? error.message : error,
      );
    }
  }, [currentMembership, selectedMessage, threadRootId]);

  useEffect(() => {
    if (actionSheetVisible || !pendingShareUrl) {
      return;
    }

    const timer = setTimeout(() => {
      void Share.share({ message: pendingShareUrl, url: pendingShareUrl })
        .catch((error) => {
          console.warn(
            "Failed to open canonical message share sheet",
            error instanceof Error ? error.message : error,
          );
        })
        .finally(() => {
          setPendingShareUrl(null);
        });
    }, 320);

    return () => clearTimeout(timer);
  }, [actionSheetVisible, pendingShareUrl]);

  const bumpChannelReplyCount = useCallback(() => {
    if (!parentChannelId || !threadRootId) {
      return;
    }

    queryClient.setQueryData<InfiniteData<ChannelMessageListPage>>(
      ["messages", parentChannelId],
      (old) => {
        if (!old?.pages?.length) {
          return old;
        }

        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            messages: (page.messages ?? []).map((message) =>
              message.id === threadRootId
                ? {
                    ...message,
                    replyCount: (message.replyCount ?? 0) + 1,
                    lastReplyAt: { seconds: Math.floor(Date.now() / 1000) },
                  }
                : message
            ),
          })),
        };
      }
    );
  }, [parentChannelId, queryClient, threadRootId]);

  useEffect(() => {
    hasPerformedInitialScrollRef.current = false;
    shouldScrollToEndRef.current = false;
    atBottomRef.current = true;
    lastReplyIdRef.current = null;
    deepLinkAutoScrollDoneRef.current = null;
    if (highlightClearTimerRef.current) {
      clearTimeout(highlightClearTimerRef.current);
      highlightClearTimerRef.current = null;
    }
    setAtBottom(true);
    setShowNewReplies(false);
  }, [threadRootId]);

  useEffect(() => {
    if (!resolvedHighlightedMessageId) {
      setActiveHighlight(null);
      deepLinkAutoScrollDoneRef.current = null;
      if (highlightClearTimerRef.current) {
        clearTimeout(highlightClearTimerRef.current);
        highlightClearTimerRef.current = null;
      }
      return;
    }

    deepLinkAutoScrollDoneRef.current = null;
    activateHighlight(resolvedHighlightedMessageId);
    return () => {
      if (highlightClearTimerRef.current) {
        clearTimeout(highlightClearTimerRef.current);
        highlightClearTimerRef.current = null;
      }
    };
  }, [activateHighlight, resolvedHighlightedMessageId, threadRootId]);

  useEffect(() => {
    if (!data?.length || hasPerformedInitialScrollRef.current) {
      return;
    }

    hasPerformedInitialScrollRef.current = true;
    if (resolvedHighlightedMessageId) {
      return;
    }

    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: false });
    });
  }, [data, resolvedHighlightedMessageId]);

  useEffect(() => {
    if (!shouldScrollToEndRef.current) {
      return;
    }

    shouldScrollToEndRef.current = false;
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
  }, [data]);

  useEffect(() => {
    if (!activeHighlight) {
      return;
    }

    if (deepLinkAutoScrollDoneRef.current === activeHighlight) {
      return;
    }

    if (parentMessage?.id === activeHighlight) {
      deepLinkAutoScrollDoneRef.current = activeHighlight;
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
      return;
    }

    const replyIndex = displayedReplies.findIndex((reply) => reply.id === activeHighlight);
    if (replyIndex < 0) {
      return;
    }

    deepLinkAutoScrollDoneRef.current = activeHighlight;
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToIndex({ index: replyIndex, animated: true, viewPosition: 0.5 });
    });
  }, [activeHighlight, displayedReplies, parentMessage?.id]);

  useEffect(() => {
    if (!resolvedHighlightedMessageId || activeHighlight === resolvedHighlightedMessageId) {
      return;
    }
    if (deepLinkAutoScrollDoneRef.current === resolvedHighlightedMessageId) {
      return;
    }
    if (
      parentMessage?.id === resolvedHighlightedMessageId ||
      displayedReplies.some((reply) => reply.id === resolvedHighlightedMessageId)
    ) {
      activateHighlight(resolvedHighlightedMessageId);
    }
  }, [activateHighlight, activeHighlight, displayedReplies, parentMessage?.id, resolvedHighlightedMessageId]);

  useEffect(() => {
    const newestReplyId = displayedReplies[displayedReplies.length - 1]?.id ?? null;
    if (newestReplyId && lastReplyIdRef.current && newestReplyId !== lastReplyIdRef.current) {
      if (atBottomRef.current) {
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      } else {
        setShowNewReplies(true);
      }
      Haptics.selectionAsync();
    }
    if (newestReplyId) lastReplyIdRef.current = newestReplyId;
  }, [displayedReplies]);

  useEffect(() => {
    return subscribe(({ type, rawData }) => {
      if (
        type !== "chat_message" &&
        type !== "chat_reaction" &&
        type !== "notification"
      ) {
        return;
      }

      try {
        const event = parseChatStreamEvent(rawData);
        const isCurrentThreadEvent =
          event?.parentMessageId === threadRootId || event?.messageId === threadRootId;

        if (isCurrentThreadEvent) {
          queryClient.invalidateQueries({ queryKey: ["thread", threadRootId] });
          queryClient.invalidateQueries({ queryKey: ["message", threadRootId] });
          if (parentChannelId) {
            queryClient.invalidateQueries({ queryKey: ["messages", parentChannelId] });
          }
        }
      } catch {
        // ignore parse errors
      }
    });
  }, [parentChannelId, queryClient, subscribe, threadRootId]);

  // ── Typing indicator ──────────────────────────────────────────────────────
  const stopTypingIndicator = useCallback(() => {
    if (isTypingRef.current && parentChannelId && threadRootId) {
      isTypingRef.current = false;
      stopTyping(parentChannelId, threadRootId).catch(() => {});
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, [parentChannelId, threadRootId]);

  const handleTextChange = useCallback(
    (val: string) => {
      setText(val);
      if (!val) {
        stopTypingIndicator();
        return;
      }
      if (!isTypingRef.current && parentChannelId && threadRootId) {
        isTypingRef.current = true;
        startTyping(parentChannelId, threadRootId).catch(() => {});
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(stopTypingIndicator, 4000);
    },
    [parentChannelId, stopTypingIndicator, threadRootId]
  );

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      await replyToMessage({
        parentMessageId: threadRootId!,
        messageText: content,
      });
    },
    onSuccess: () => {
      bumpChannelReplyCount();
      queryClient.invalidateQueries({ queryKey: ["thread", threadRootId] });
      queryClient.invalidateQueries({ queryKey: ["message", threadRootId] });
      if (parentChannelId) {
        queryClient.invalidateQueries({ queryKey: ["messages", parentChannelId] });
      }
      setText("");
      shouldScrollToEndRef.current = true;
      stopTypingIndicator();
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
  });

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  };

  const reactionMutation = useMutation({
    mutationFn: async ({
      messageId,
      emojiCode,
      remove,
    }: {
      messageId: string;
      emojiCode: string;
      remove: boolean;
    }) => {
      if (remove) {
        await removeReaction({ messageId, emojiCode });
      } else {
        await addReaction({ messageId, emojiCode });
      }
    },
    onSuccess: (_, variables) => {
      if (variables.messageId === threadRootId) {
        queryClient.invalidateQueries({ queryKey: ["message", threadRootId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["thread", threadRootId] });
      }
      if (parentChannelId) {
        queryClient.invalidateQueries({ queryKey: ["messages", parentChannelId] });
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  const openMessageActions = useCallback((message: ThreadReply) => {
    setSelectedMessage(message);
    setActionSheetVisible(true);
  }, []);

  const handleReactionPress = useCallback((messageId: string, emojiCode: string, currentlyReacted: boolean) => {
    reactionMutation.mutate({
      messageId,
      emojiCode,
      remove: currentlyReacted,
    });
  }, [reactionMutation]);

  const handleQuickReactAction = useCallback((emoji: string) => {
    if (!selectedMessage?.id) {
      return;
    }

    setActionSheetVisible(false);
    reactionMutation.mutate({
      messageId: selectedMessage.id,
      emojiCode: emojiToCode(emoji),
      remove: false,
    });
  }, [reactionMutation, selectedMessage]);

  const handleMoreEmojiAction = useCallback(() => {
    if (!selectedMessage?.id) {
      return;
    }

    setActionSheetVisible(false);
    setPickerVisible(true);
  }, [selectedMessage]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    if (!selectedMessage?.id) {
      return;
    }

    reactionMutation.mutate({
      messageId: selectedMessage.id,
      emojiCode: emojiToCode(emoji),
      remove: false,
    });
  }, [reactionMutation, selectedMessage]);

  const handleMoveToChannel = useCallback(() => {
    if (!parentChannelId || !threadRootId) {
      return;
    }

    setActionSheetVisible(false);
    router.push(
      withNavigationContext(`/(app)/(chat)/${parentChannelId}?highlightedMessageId=${threadRootId}`, {
        fallbackHref: navigationContext.fallbackHref,
        ownerTab: navigationContext.ownerTab ?? "chat",
        backLabel: navigationContext.backLabel ?? "Chat",
      }) as never,
    );
  }, [navigationContext.backLabel, navigationContext.fallbackHref, navigationContext.ownerTab, parentChannelId, router, threadRootId]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const isAtBottom = distanceFromBottom < 100;
    atBottomRef.current = isAtBottom;
    if (isAtBottom !== atBottom) {
      setAtBottom(isAtBottom);
      if (isAtBottom) setShowNewReplies(false);
    }
  }, [atBottom]);

  const scrollToLatestReply = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setShowNewReplies(false);
  }, []);

  return (
    <>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={keyboardVerticalOffset}
    >
      <Stack.Screen
        options={{
          title: "Message",
          headerLeft: showContextBackAction
            ? () => (
                <Pressable
                  onPress={handleContextBack}
                  hitSlop={12}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    minWidth: 44,
                    minHeight: 44,
                    paddingRight: 8,
                    justifyContent: "center",
                  }}
                  accessibilityLabel={`Back to ${navigationContext.backLabel}`}
                  accessibilityRole="button"
                >
                  <SFIcon name="chevron.left" size={18} color={lightPalette.text.primary} />
                  <Text style={{ fontSize: 16, fontWeight: "500", color: lightPalette.primary.main }}>
                    {navigationContext.backLabel}
                  </Text>
                </Pressable>
              )
            : undefined,
        }}
      />

      {isInitialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={lightPalette.text.secondary} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          contentInsetAdjustmentBehavior="automatic"
          data={displayedReplies}
          keyExtractor={(item) => item.id ?? item.messageId ?? String(Math.random())}
          contentContainerStyle={styles.list}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onScrollToIndexFailed={({ index }) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index,
                animated: true,
                viewPosition: 0.5,
              });
            }, 120);
          }}
          ListHeaderComponent={
            parentMessage ? (
              <ParentMessageCard
                item={parentMessage}
                channelId={parentChannelId}
                contentWidth={contentWidth}
                isHighlighted={parentMessage.id === activeHighlight}
                onPress={() => {
                  if (!parentChannelId || !parentMessage.id) {
                    return;
                  }

                  router.push(
                    withNavigationContext(
                      `/(app)/(chat)/${parentChannelId}?highlightedMessageId=${parentMessage.id}`,
                      {
                        fallbackHref: navigationContext.fallbackHref,
                        ownerTab: navigationContext.ownerTab ?? "chat",
                        backLabel: navigationContext.backLabel ?? "Chat",
                      },
                    ) as never,
                  );
                }}
                onLongPress={openMessageActions}
                onReactionPress={handleReactionPress}
              />
            ) : null
          }
          ListHeaderComponentStyle={parentMessage ? styles.listHeader : undefined}
          renderItem={({ item }) => (
            <ReplyItem
              item={item}
              channelId={parentChannelId}
              contentWidth={contentWidth}
              isHighlighted={item.id === activeHighlight}
              onLongPress={openMessageActions}
              onReactionPress={handleReactionPress}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No replies yet. Read here or start the thread below.</Text>
            </View>
          }
        />
      )}

      {showNewReplies && (
        <Pressable
          testID="new-replies-pill"
          onPress={scrollToLatestReply}
          style={styles.newMessagesPill}
          accessibilityRole="button"
          accessibilityLabel="Show new replies"
        >
          <Text style={styles.newMessagesPillText}>↓ New replies</Text>
        </Pressable>
      )}

      {/* Reply composer */}
      <View
        style={[
          styles.composer,
          { paddingBottom: Platform.OS === "ios" ? Math.max(insets.bottom, 10) : 12 },
        ]}
      >
        <TextInput
          style={styles.input}
          placeholder="Reply…"
          multiline
          value={text}
          onChangeText={handleTextChange}
          returnKeyType="default"
          placeholderTextColor={lightPalette.text.disabled}
          accessibilityLabel="Reply input"
        />
        <Pressable
          onPress={handleSend}
          disabled={!text.trim() || sendMutation.isPending}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: !text.trim()
                ? lightPalette.divider
                : pressed
                ? lightPalette.text.primary
                : lightPalette.primary.dark,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send reply"
        >
          {sendMutation.isPending ? (
            <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
          ) : (
            <SFIcon name="arrow.up" size={18} color={lightPalette.primary.contrastText} />
          )}
        </Pressable>
      </View>

      <ReactionPicker
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={handleEmojiSelect}
      />

      <ThreadMessageActionSheet
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        onQuickReact={handleQuickReactAction}
        onMoreEmoji={handleMoreEmojiAction}
        onCopyLink={() => {
          void handleShareMessageLink();
        }}
        onMoveToChannel={handleMoveToChannel}
      />
    </KeyboardAvoidingView>
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis.circle">
        <Stack.Toolbar.MenuAction
          icon="square.and.arrow.up"
          onPress={() => { void handleShareThreadLink(); }}
        >
          Share Link
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    padding: 12,
    gap: 16,
    paddingBottom: 20,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.28)",
    justifyContent: "flex-end",
  },
  listHeader: {
    marginBottom: 16,
  },
  parentCard: {
    backgroundColor: lightPalette.background.default,
    borderColor: lightPalette.divider,
    borderRadius: 16,
    borderWidth: border.thin,
    padding: 12,
  },
  parentCardPressed: {
    opacity: 0.88,
  },
  parentCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  parentCardLabel: {
    color: lightPalette.text.secondary,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  parentCardAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  parentCardActionText: {
    color: lightPalette.text.secondary,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600",
  },
  replyPressable: {
    borderRadius: 14,
    padding: 8,
    marginHorizontal: -8,
  },
  replyPressablePressed: {
    backgroundColor: lightPalette.background.default,
  },
  messageHighlight: {
    backgroundColor: lightPalette.primary.light + "24",
    borderWidth: border.thin,
    borderColor: lightPalette.primary.light,
  },
  replyItem: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  replyContent: {
    flex: 1,
    gap: 3,
  },
  replyHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  senderName: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700",
    color: lightPalette.text.primary,
  },
  timestamp: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  replyText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.primary,
    lineHeight: 22,
  },
  reactionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: lightPalette.background.default,
  },
  reactionChipActive: {
    backgroundColor: lightPalette.primary.light + "30",
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 12,
    fontWeight: "600",
    color: lightPalette.text.secondary,
  },
  reactionCountActive: {
    color: lightPalette.text.primary,
  },
  emptyState: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    borderRadius: 20,
    borderCurve: "continuous",
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: mobileTypography.listPrimary.fontSize as number,
    maxHeight: 120,
    backgroundColor: lightPalette.background.default,
    color: lightPalette.text.primary,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
  },
  newMessagesPill: {
    position: "absolute",
    bottom: 76,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: lightPalette.info.main,
    borderWidth: border.hairline,
    borderColor: lightPalette.info.dark,
  },
  newMessagesPillText: {
    color: lightPalette.info.contrastText,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700",
  },
  emojiSheet: {
    backgroundColor: lightPalette.background.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },
  emojiSheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: lightPalette.text.primary,
    textAlign: "center",
    marginBottom: 12,
  },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
  },
  emojiBtn: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  emojiText: {
    fontSize: 28,
  },
  actionSheet: {
    backgroundColor: lightPalette.background.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 12,
  },
  actionSheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: lightPalette.divider,
    marginBottom: 4,
  },
  actionSheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: lightPalette.text.primary,
    textAlign: "center",
  },
  actionSheetSubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 18,
    color: lightPalette.text.secondary,
    textAlign: "center",
    marginBottom: 4,
  },
  quickReactionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  quickReactionBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  quickReactionBtnPressed: {
    backgroundColor: lightPalette.primary.light + "20",
    borderColor: lightPalette.primary.light,
  },
  quickReactionText: {
    fontSize: 22,
  },
  actionSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: lightPalette.background.default,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  actionSheetRowPressed: {
    backgroundColor: lightPalette.primary.light + "20",
    borderColor: lightPalette.primary.light,
  },
  actionSheetIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.light + "30",
  },
  actionSheetRowBody: {
    flex: 1,
    gap: 2,
  },
  actionSheetRowTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  actionSheetRowText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 18,
    color: lightPalette.text.secondary,
  },
});
