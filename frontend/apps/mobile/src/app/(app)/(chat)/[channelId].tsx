/**
 * Chat — message thread for a specific channel
 *
 * UX goals (low-tech workers):
 * - Large, readable messages with sender name and avatar
 * - Grouped messages (consecutive from same author share avatar)
 * - Real-time updates via SSE (auto-refresh on new message)
 * - Mark as read when entering the channel
 * - Visible message actions make rows feel interactive
 * - Tap reaction chip to toggle your own reaction
 * - Tap reply count to see thread
 * - Keyboard-aware input always visible
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  RefreshControl,
  StyleSheet,
  Share,
} from "react-native";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
  useSegments,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import {
  listMessages,
  sendMessage,
  addReaction,
  removeReaction,
  DEFAULT_REACTION_EMOJIS,
  QUICK_REACTION_EMOJIS,
  emojiToCode,
  codeToEmoji,
  startTyping,
  stopTyping,
  getChannel,
  markChannelAsRead,
  getProfile,
  getActiveVoiceCall,
  startVoiceCall,
  voiceCallErrorMessage,
  joinVoiceCall,
  leaveVoiceCall,
  respondToVoiceCallInvite,
  voiceCallStateToString,
  type LinkedResource,
  type VoiceCallSession,
  type VoiceJoinCredentials,
  listBlockedPeople,
} from "apis";
import { useAuth } from "@/hooks/use-auth";
import { BlockConfirm } from "@/components/compliance/block-confirm";
import { ReportSheet } from "@/components/compliance/report-sheet";
import { generateCanonicalUrl } from "@/lib/canonical-links";
import { API_BASE_URL } from "@/lib/constants";
import { isSameDay } from "date-fns";
import { ChatMessageBody } from "@/components/chat/chat-message-body";
import { TaskDiscussionContext } from "@/components/chat/task-discussion-context";
import {
  VoiceCallBanner,
  type MobileVoiceCallSummary,
} from "@/components/chat/voice-call-banner";
import { IncomingCallBanner } from "@/components/chat/incoming-call-banner";
import { VoiceMessageRecorder } from "@/components/chat/voice-message-recorder";
import { SFIcon } from "@/components/ui/sf-icon";
import * as Haptics from "expo-haptics";
import { useWindowDimensions } from "react-native";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import { useNotificationStream } from "@/providers/notification-stream-provider";
import { formatMessageTime } from "@/lib/date-utils";
import { parseChatStreamEvent } from "@/lib/chat-stream-events";
import {
  voiceClient,
  type VoiceClientSnapshot,
} from "@/lib/voice/voice-client";
import {
  parseNavigationContext,
  resolveNavigationBackHref,
  withNavigationContext,
} from "@/lib/mobile-navigation";
import {
  border,
  lightPalette,
  mobileTypography,
  opacity,
} from "@tech-office/theme-tokens";

// ── Timestamp helpers ────────────────────────────────────────────────────────

interface ProtoTimestamp {
  seconds?: number | string | bigint;
}

function protoToDate(ts: ProtoTimestamp | null | undefined): Date | null {
  if (!ts) return null;
  const secs = Number(ts.seconds ?? 0);
  return secs > 0 ? new Date(secs * 1000) : null;
}

// ── Type helpers ─────────────────────────────────────────────────────────────

type MessagesPageResponse = Awaited<ReturnType<typeof listMessages>>;
type ChatMessage = NonNullable<MessagesPageResponse["messages"]>[number];
type ClientMessageStatus = "sending" | "failed";
type RenderMessage = ChatMessage & {
  clientStatus?: ClientMessageStatus;
  clientError?: string;
  originalMessageText?: string;
  originalFileIds?: string[];
};
type OptimisticMessage = RenderMessage & {
  id: string;
  clientStatus: ClientMessageStatus;
  originalMessageText: string;
  originalFileIds: string[];
};
type MessagesInfiniteData = InfiniteData<
  MessagesPageResponse,
  string | undefined
>;

function createOptimisticMessageId(): string {
  return `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function chatSendErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to send message.";
}

function voiceCallIdForMessage(message: ChatMessage): string | null {
  if (message.messageKind !== "system" || !message.metadataJson) {
    return null;
  }
  try {
    const metadata = JSON.parse(message.metadataJson) as { callId?: string };
    return typeof metadata.callId === "string" && metadata.callId ? metadata.callId : null;
  } catch {
    return null;
  }
}

/**
 * What a screen reader announces for a message row, and what Maestro matches on.
 *
 * `message_text` is sanitised HTML; the renderer that draws it contributes nothing
 * to the accessibility tree, so without this the row is an unlabelled pressable.
 */
function messageAccessibilityLabel(message: ChatMessage): string {
  const body = (message.messageText ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const author = message.authorName ? `${message.authorName}: ` : "";
  return body ? `${author}${body}` : author.trim() || "Message";
}

function collapseVoiceCallTimelineMessages(messages: ChatMessage[]): ChatMessage[] {
  const terminalCallIds = new Set<string>();
  for (const message of messages) {
    const callId = voiceCallIdForMessage(message);
    if (callId && message.systemEventType && message.systemEventType !== "voice_call_started") {
      terminalCallIds.add(callId);
    }
  }
  if (!terminalCallIds.size) {
    return messages;
  }
  return messages.filter((message) => {
    const callId = voiceCallIdForMessage(message);
    return !(callId && terminalCallIds.has(callId) && message.systemEventType === "voice_call_started");
  });
}

interface ChannelSummary {
  displayName?: string | null;
  titleSlug?: string | null;
  /** 'chat' | 'direct_message' | ... — see chat.channel.channel_type. */
  channelType?: string | null;
}

interface GetChannelResponseShape {
  channel?: ChannelSummary;
  linkedResource?: LinkedResource;
}

interface IncomingVoiceCallInvite {
  channelId: string;
  callId: string;
  invitationId?: string;
  alreadyInAnotherCall?: boolean;
  participantCount?: number;
  state?: string;
}

function streamStateToMobileVoiceState(state?: string): MobileVoiceCallSummary["state"] {
  switch (state) {
    case "active":
    case "VOICE_CALL_STATE_ACTIVE":
      return "active";
    case "ending":
    case "VOICE_CALL_STATE_ENDING":
      return "ending";
    case "ended":
    case "VOICE_CALL_STATE_ENDED":
      return "ended";
    default:
      return "ringing";
  }
}

function toMobileVoiceCall(
  call: VoiceCallSession | undefined | null,
): MobileVoiceCallSummary | null {
  if (!call?.id) return null;
  return {
    id: call.id,
    state: voiceCallStateToString(call.state),
    participantCount: call.participants?.length ?? 0,
  };
}

function toMobileJoinCredentials(
  credentials: VoiceJoinCredentials | undefined | null,
  activeCallId?: string,
  activeChannelId?: string,
) {
  if (!credentials?.livekitToken || !credentials.roomName) return null;
  return {
    livekitUrl: credentials.livekitUrl,
    livekitToken: credentials.livekitToken,
    roomName: credentials.roomName,
    activeCallId,
    activeChannelId,
    expiresAt: credentials.expiresAt
      ? protoToDate(credentials.expiresAt)?.toISOString()
      : undefined,
  };
}

function mobileVoiceErrorMessage(error: unknown, fallback: string): string {
  return voiceCallErrorMessage(error, fallback);
}

// ── Reaction Picker ────────────────────────────────────────────────────────

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
                  pressed && {
                    backgroundColor: lightPalette.background.default,
                  },
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

/**
 * Stands in for messages hidden because their author is blocked (FR-021).
 *
 * A block hides direct history rather than deleting it, and the reveal is
 * per-group: somebody who blocked a colleague may still need to check what was
 * said, and making that possible is what keeps the block a filter on attention
 * rather than a hole in the record.
 */
function HiddenMessageGroup({
  count,
  onReveal,
}: {
  count: number;
  onReveal: () => void;
}) {
  return (
    <View style={styles.hiddenGroup} testID="hidden-message-group">
      <SFIcon name="hand.raised.fill" size={14} color={lightPalette.text.secondary} />
      <Text style={styles.hiddenGroupText}>
        {count === 1 ? "1 message hidden" : `${count} messages hidden`} — you blocked this
        person
      </Text>
      <Pressable onPress={onReveal} hitSlop={8} testID="hidden-message-reveal">
        <Text style={styles.hiddenGroupAction}>Show</Text>
      </Pressable>
    </View>
  );
}

function MessageActionSheet({
  visible,
  hasReplies,
  onClose,
  onQuickReact,
  onMoreEmoji,
  onCopyLink,
  onThread,
  onReport,
  onBlockAuthor,
  canBlockAuthor,
}: {
  visible: boolean;
  hasReplies: boolean;
  onClose: () => void;
  onQuickReact: (emoji: string) => void;
  onMoreEmoji: () => void;
  onCopyLink: () => void;
  onThread: () => void;
  onReport: () => void;
  onBlockAuthor: () => void;
  /** False for your own messages: blocking yourself is not a thing. */
  canBlockAuthor: boolean;
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
          <Text style={styles.actionSheetSubtitle}>
            Quick reactions first, then reply in thread.
          </Text>

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
              <SFIcon
                name="face.smiling"
                size={18}
                color={lightPalette.text.primary}
              />
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
              <Text style={styles.actionSheetRowTitle}>
                Share canonical link
              </Text>
              <Text style={styles.actionSheetRowText}>
                Share a stable link that opens this message from any device.
              </Text>
            </View>
            <SFIcon
              name="square.and.arrow.up"
              size={14}
              color={lightPalette.text.secondary}
            />
          </Pressable>

          <Pressable
            onPress={onThread}
            style={({ pressed }) => [
              styles.actionSheetRow,
              pressed && styles.actionSheetRowPressed,
            ]}
          >
            <View style={styles.actionSheetIconWrap}>
              <SFIcon
                name="bubble.left.and.bubble.right"
                size={16}
                color={lightPalette.text.primary}
              />
            </View>
            <View style={styles.actionSheetRowBody}>
              <Text style={styles.actionSheetRowTitle}>
                {hasReplies ? "Open thread" : "Reply in thread"}
              </Text>
              <Text style={styles.actionSheetRowText}>
                {hasReplies
                  ? "Open the reply thread for this message."
                  : "Reply in a side thread without crowding the channel."}
              </Text>
            </View>
            <SFIcon
              name="chevron.right"
              size={14}
              color={lightPalette.text.secondary}
            />
          </Pressable>

          {/* Reporting is two taps from here — long-press, Report, reason — which
              is what keeps the whole flow within three (SC-003). */}
          <Pressable
            onPress={onReport}
            style={({ pressed }) => [
              styles.actionSheetRow,
              pressed && styles.actionSheetRowPressed,
            ]}
            testID="message-action-report"
          >
            <View style={styles.actionSheetIconWrap}>
              <SFIcon name="flag" size={16} color={lightPalette.error.main} />
            </View>
            <View style={styles.actionSheetRowBody}>
              <Text style={styles.actionSheetRowTitle}>Report this message</Text>
              <Text style={styles.actionSheetRowText}>
                Tell the people who run this workspace that something here is wrong.
              </Text>
            </View>
            <SFIcon
              name="chevron.right"
              size={14}
              color={lightPalette.text.secondary}
            />
          </Pressable>

          {canBlockAuthor ? (
            <Pressable
              onPress={onBlockAuthor}
              style={({ pressed }) => [
                styles.actionSheetRow,
                pressed && styles.actionSheetRowPressed,
              ]}
              testID="message-action-block"
            >
              <View style={styles.actionSheetIconWrap}>
                <SFIcon name="hand.raised" size={16} color={lightPalette.error.main} />
              </View>
              <View style={styles.actionSheetRowBody}>
                <Text style={styles.actionSheetRowTitle}>Block this person</Text>
                <Text style={styles.actionSheetRowText}>
                  Stop them starting a direct conversation or calling you. They are not told.
                </Text>
              </View>
              <SFIcon
                name="chevron.right"
                size={14}
                color={lightPalette.text.secondary}
              />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// ── Date separator ────────────────────────────────────────────────────────────

function DateSeparator({ date }: { date: Date }) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  let label: string;
  if (isSameDay(date, today)) {
    label = "Today";
  } else if (isSameDay(date, yesterday)) {
    label = "Yesterday";
  } else {
    label = date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  return (
    <View style={styles.dateSep}>
      <View style={styles.dateLine} />
      <Text style={styles.dateText}>{label}</Text>
      <View style={styles.dateLine} />
    </View>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  messages,
  isHighlightedMessage,
  channelId,
  contentWidth,
  onPress,
  onLongPress,
  onReactionPress,
  onThreadPress,
  onRetry,
}: {
  messages: RenderMessage[];
  isHighlightedMessage?: (messageId: string) => boolean;
  channelId?: string;
  contentWidth: number;
  onPress: (id: string) => void;
  onLongPress: (id: string) => void;
  onReactionPress: (
    id: string,
    emojiCode: string,
    currentlyReacted: boolean,
  ) => void;
  onThreadPress: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const senderName = messages[0]?.authorName || "Unknown";

  return (
    <View style={styles.messageBubble}>
      <View style={styles.messageCard}>
        <View style={styles.messageHeader}>
          <View style={styles.senderBadge}>
            <View style={styles.senderInitialBadge}>
              <Text style={styles.senderInitialText}>
                {senderName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.senderName} numberOfLines={1}>
              {senderName}
            </Text>
          </View>
          {messages.length > 1 ? (
            <Text style={styles.groupCount}>{messages.length} sent</Text>
          ) : null}
        </View>

        <View style={styles.messageContent}>
          {[...messages].reverse().map((item, index) => {
            const msgDate = protoToDate(item.updatedAt);
            const isHighlighted = isHighlightedMessage?.(item.id) ?? false;

            return (
              <Pressable
                key={item.id}
                // Long-pressing a message is how reporting and blocking are
                // reached, so the bubble needs a stable handle for the Maestro
                // flows that cover them.
                testID={`message-bubble-${item.id}`}
                // The message body renders sanitised HTML through a renderer that
                // exposes no accessible text, so a screen reader on this row read
                // nothing at all and Maestro could not find a message by its words.
                // The label is what both of them read.
                accessibilityLabel={messageAccessibilityLabel(item)}
                disabled={Boolean(item.clientStatus)}
                onPress={() => {
                  if (!item.clientStatus) {
                    onPress(item.id);
                  }
                }}
                onLongPress={() => {
                  if (item.clientStatus) {
                    return;
                  }
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onLongPress(item.id);
                }}
                delayLongPress={350}
                style={({ pressed }) => [
                  styles.groupedMessageRow,
                  index > 0 && styles.groupedMessageRowSeparated,
                  pressed && styles.messageBubblePressed,
                  isHighlighted && styles.messageHighlight,
                ]}
              >
                <View style={styles.groupedMessageMeta}>
                  {msgDate ? (
                    <Text style={styles.timestamp}>
                      {formatMessageTime(msgDate)}
                    </Text>
                  ) : (
                    <View />
                  )}
                </View>

                <ChatMessageBody
                  messageText={item.messageText}
                  fileIds={item.fileIds ?? []}
                  messageKind={item.messageKind}
                  systemEventType={item.systemEventType}
                  metadataJson={item.metadataJson}
                  channelId={channelId}
                  messageTimestamp={msgDate}
                  contentWidth={contentWidth}
                  textStyle={styles.messageText}
                />

                {item.clientStatus ? (
                  <View style={styles.deliveryRow}>
                    <Text
                      style={
                        item.clientStatus === "failed"
                          ? styles.deliveryTextError
                          : styles.deliveryText
                      }
                    >
                      {item.clientStatus === "failed"
                        ? item.clientError || "Failed to send"
                        : "Sending..."}
                    </Text>
                    {item.clientStatus === "failed" ? (
                      <Pressable
                        onPress={() => onRetry(item.id)}
                        style={({ pressed }) => [
                          styles.deliveryRetryButton,
                          pressed && styles.deliveryRetryButtonPressed,
                        ]}
                      >
                        <Text style={styles.deliveryRetryText}>Retry</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {item.reactions.length > 0 && (
                  <View style={styles.reactionsRow}>
                    {item.reactions.map((r) => (
                      <Pressable
                        key={r.emojiCode}
                        onPress={() =>
                          onReactionPress(
                            item.id,
                            r.emojiCode,
                            r.currentUserReacted,
                          )
                        }
                        style={[
                          styles.reactionChip,
                          r.currentUserReacted && styles.reactionChipActive,
                        ]}
                      >
                        <Text style={styles.reactionEmoji}>
                          {codeToEmoji(r.emojiCode)}
                        </Text>
                        <Text
                          style={[
                            styles.reactionCount,
                            r.currentUserReacted && styles.reactionCountActive,
                          ]}
                        >
                          {r.count}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {item.replyCount > 0 && (
                  <Pressable
                    onPress={() => onThreadPress(item.id)}
                    style={styles.threadLink}
                  >
                    <SFIcon
                      name="bubble.left.and.bubble.right"
                      size={13}
                      color={lightPalette.primary.main}
                    />
                    <Text style={styles.threadLinkText}>
                      {item.replyCount}{" "}
                      {item.replyCount === 1 ? "reply" : "replies"}
                    </Text>
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ── Typing indicator ─────────────────────────────────────────────────────────

// ── Main screen ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 30;
const IOS_NAVIGATION_BAR_HEIGHT = 44;

export default function ChannelScreen() {
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const routeParams = useLocalSearchParams<{
    channelId?: string;
    id?: string;
    highlightedMessageId?: string;
    fromProjectId?: string;
    fromTaskId?: string;
    navParent?: string;
    navFallback?: string;
    navTab?: string;
    navLabel?: string;
  }>();
  const {
    highlightedMessageId: highlightedParam,
    fromProjectId,
    fromTaskId,
    navParent,
    navFallback,
    navTab,
    navLabel,
  } = routeParams;
  const channelId = routeParams.channelId ?? routeParams.id;
  const navigation = useNavigation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  // Content width for HTML renderer (screen - list padding - card padding)
  const htmlContentWidth = windowWidth - 24 - 28;

  const [text, setText] = useState("");
  const [voiceRecorderActive, setVoiceRecorderActive] = useState(false);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );
  const [pendingShareUrl, setPendingShareUrl] = useState<string | null>(null);
  // Feature 036: reporting and blocking, plus the direct-history hiding a block
  // implies. Shared channels are deliberately untouched — see below.
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const [blockTarget, setBlockTarget] = useState<{ id: string; name: string } | null>(null);
  const [revealedMessageIds, setRevealedMessageIds] = useState<Set<string>>(() => new Set());
  // ── Scroll behaviour (mirrors VirtualizedMessageList) ─────────────────────
  // In inverted FlatList, contentOffset.y = 0 means the user is at the bottom
  // (newest messages). We track this with both a ref (for stable SSE callbacks)
  // and state (for rendering the pill).
  const [atBottom, setAtBottom] = useState(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const atBottomRef = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null); // newest seen message ID
  const deepLinkFetchInFlightRef = useRef<string | null>(null);
  const deepLinkAutoScrollDoneRef = useRef<string | null>(null);
  const highlightClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const listItemCountRef = useRef(0);
  const pendingOlderLoadOffsetRef = useRef<number | null>(null);
  const pendingOlderLoadItemCountRef = useRef<number | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const [activeVoiceCall, setActiveVoiceCall] =
    useState<MobileVoiceCallSummary | null>(null);
  const [joinedVoiceCallId, setJoinedVoiceCallId] = useState<string | null>(null);
  const [incomingVoiceCall, setIncomingVoiceCall] =
    useState<IncomingVoiceCallInvite | null>(null);
  // When the user taps "Later" on the channel-call discovery banner we remember
  // the call ID so we don't re-show the prominent prompt for the same call.
  const [dismissedCallId, setDismissedCallId] = useState<string | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<
    OptimisticMessage[]
  >([]);
  const [voiceSnapshot, setVoiceSnapshot] = useState<VoiceClientSnapshot>(() =>
    voiceClient.getSnapshot(),
  );

  useEffect(() => voiceClient.subscribe(setVoiceSnapshot), []);

  // React to unexpected disconnects from the VoiceClient (e.g. network drop).
  // VoiceClient only records an error for disconnects that are genuine
  // failures, so an ordinary hang-up never lands here. Clear the joined state
  // and call the leave API so the backend doesn't keep a stale participant.
  useEffect(() => {
    if (
      voiceSnapshot.connectionState === "disconnected" &&
      voiceSnapshot.error &&
      joinedVoiceCallId
    ) {
      const callId = joinedVoiceCallId;
      setJoinedVoiceCallId(null);
      setVoiceError(voiceSnapshot.error);
      void leaveVoiceCall(callId).catch(() => undefined);
    }
  }, [voiceSnapshot.connectionState, voiceSnapshot.error]);

  useEffect(() => {
    if (!channelId) {
      setActiveVoiceCall(null);
      return;
    }

    let cancelled = false;
    getActiveVoiceCall(channelId)
      .then((response) => {
        if (!cancelled) {
          setActiveVoiceCall(
            response.hasActiveCall ? toMobileVoiceCall(response.call) : null,
          );
          setVoiceError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setVoiceError(
            mobileVoiceErrorMessage(error, "Unable to load active voice call."),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const handleStartVoiceCall = useCallback(async () => {
    if (!channelId || voiceLoading) return;
    setVoiceLoading(true);
    setVoiceError(null);
    try {
      const response = await startVoiceCall({ channelId });
      const nextCall = toMobileVoiceCall(response.call);
      setActiveVoiceCall(nextCall);
      setJoinedVoiceCallId(nextCall?.id ?? null);
      const credentials = toMobileJoinCredentials(
        response.joinCredentials,
        nextCall?.id,
        channelId,
      );
      if (credentials) {
        await voiceClient.connect(credentials);
      }
    } catch (error) {
      setVoiceError(
        mobileVoiceErrorMessage(error, "Unable to start voice call."),
      );
    } finally {
      setVoiceLoading(false);
    }
  }, [channelId, voiceLoading]);

  const handleJoinVoiceCall = useCallback(async () => {
    if (!activeVoiceCall || voiceLoading) return;
    setVoiceLoading(true);
    setVoiceError(null);
    try {
      const response = await joinVoiceCall(activeVoiceCall.id);
      const nextCall = toMobileVoiceCall(response.call);
      setActiveVoiceCall(nextCall);
      setJoinedVoiceCallId(nextCall?.id ?? activeVoiceCall.id);
      const credentials = toMobileJoinCredentials(
        response.joinCredentials,
        nextCall?.id ?? activeVoiceCall.id,
        channelId,
      );
      if (credentials) {
        await voiceClient.connect(credentials);
      }
    } catch (error) {
      setVoiceError(
        mobileVoiceErrorMessage(error, "Unable to join voice call."),
      );
    } finally {
      setVoiceLoading(false);
    }
  }, [activeVoiceCall, voiceLoading]);

  const handleAcceptIncomingVoiceCall = useCallback(async () => {
    if (!incomingVoiceCall || voiceLoading) return;
    setVoiceLoading(true);
    setVoiceError(null);
    try {
      let credentials = null;
      if (incomingVoiceCall.invitationId) {
        const response = await respondToVoiceCallInvite({
          invitationId: incomingVoiceCall.invitationId,
          response: "accept",
        });
        credentials = toMobileJoinCredentials(
          response.joinCredentials,
          incomingVoiceCall.callId,
          incomingVoiceCall.channelId,
        );
        setActiveVoiceCall({
          id: incomingVoiceCall.callId,
          state: streamStateToMobileVoiceState(incomingVoiceCall.state),
          participantCount: incomingVoiceCall.participantCount ?? 1,
        });
        setJoinedVoiceCallId(incomingVoiceCall.callId);
      } else {
        const response = await joinVoiceCall(incomingVoiceCall.callId);
        const nextCall = toMobileVoiceCall(response.call);
        setActiveVoiceCall(nextCall);
        setJoinedVoiceCallId(nextCall?.id ?? incomingVoiceCall.callId);
        credentials = toMobileJoinCredentials(
          response.joinCredentials,
          nextCall?.id ?? incomingVoiceCall.callId,
          incomingVoiceCall.channelId,
        );
      }
      if (credentials) {
        await voiceClient.disconnect();
        await voiceClient.connect(credentials);
      }
      setIncomingVoiceCall(null);
    } catch (error) {
      setVoiceError(
        mobileVoiceErrorMessage(error, "Unable to answer voice call."),
      );
    } finally {
      setVoiceLoading(false);
    }
  }, [incomingVoiceCall, voiceLoading]);

  const handleDeclineIncomingVoiceCall = useCallback(async () => {
    if (!incomingVoiceCall || voiceLoading) return;
    setVoiceLoading(true);
    setVoiceError(null);
    try {
      if (incomingVoiceCall.invitationId) {
        await respondToVoiceCallInvite({
          invitationId: incomingVoiceCall.invitationId,
          response: "decline",
        });
      }
      setIncomingVoiceCall(null);
    } catch (error) {
      setVoiceError(
        mobileVoiceErrorMessage(error, "Unable to decline voice call."),
      );
    } finally {
      setVoiceLoading(false);
    }
  }, [incomingVoiceCall, voiceLoading]);

  const handleLeaveVoiceCall = useCallback(async () => {
    if (!activeVoiceCall || (voiceLoading && joinedVoiceCallId !== activeVoiceCall.id)) return;
    setVoiceLoading(true);
    setVoiceError(null);
    try {
      await voiceClient.disconnect();
      const response = await leaveVoiceCall(activeVoiceCall.id);
      const nextCall = toMobileVoiceCall(response.call);
      setActiveVoiceCall(nextCall?.state === "ended" ? null : nextCall);
      setJoinedVoiceCallId(null);
      await queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
    } catch (error) {
      setVoiceError(
        mobileVoiceErrorMessage(error, "Unable to leave voice call."),
      );
    } finally {
      setVoiceLoading(false);
    }
  }, [activeVoiceCall, channelId, joinedVoiceCallId, queryClient, voiceLoading]);

  // ── Report active channel so notification provider can suppress local popups ──
  const {
    setActiveChannel,
    clearUnreadChannel,
    subscribe,
    incomingVoiceCall: globalIncomingVoiceCall,
  } = useNotificationStream();
  useFocusEffect(
    useCallback(() => {
      if (!channelId) {
        return undefined;
      }

      setActiveChannel(channelId);
      clearUnreadChannel(channelId);

      return () => setActiveChannel(null);
    }, [channelId, setActiveChannel, clearUnreadChannel]),
  );

  useEffect(() => {
    if (!incomingVoiceCall) {
      return;
    }
    if (globalIncomingVoiceCall?.callId === incomingVoiceCall.callId) {
      return;
    }
    setIncomingVoiceCall(null);
  }, [globalIncomingVoiceCall?.callId, incomingVoiceCall]);

  // ── Channel info ─────────────────────────────────────────────────────────
  const { data: channelData } = useQuery({
    queryKey: ["channel", channelId],
    queryFn: async () => {
      const resp = await getChannel(channelId!);
      return resp as GetChannelResponseShape;
    },
    enabled: !!channelId,
    staleTime: 60_000,
  });

  const channelTitle =
    channelData?.channel?.displayName ||
    channelData?.channel?.titleSlug ||
    channelId;
  const navigationContext = useMemo(() => {
    const contextualParams = parseNavigationContext({
      navParent,
      navFallback,
      navTab,
      navLabel,
    });

    if (
      contextualParams.parentHref ||
      contextualParams.fallbackHref ||
      contextualParams.ownerTab
    ) {
      return contextualParams;
    }

    if (fromProjectId && fromTaskId) {
      return {
        fallbackHref: "/(app)/(tasks)",
        ownerTab: "tasks" as const,
        backLabel: "Task",
      };
    }

    return contextualParams;
  }, [fromProjectId, fromTaskId, navFallback, navLabel, navParent, navTab]);
  const contextBackHref = resolveNavigationBackHref(
    navigationContext,
    "/(app)/(chat)",
  );
  const showContextBackAction =
    !!navigationContext.backLabel && !navigation.canGoBack();
  const isSharedResourceRoute = segments[0] === "(shared)";
  const keyboardVerticalOffset =
    Platform.OS === "ios"
      ? insets.top +
        IOS_NAVIGATION_BAR_HEIGHT +
        (isSharedResourceRoute ? IOS_NAVIGATION_BAR_HEIGHT : 0)
      : 0;
  const contextualChannelHref = useMemo(() => {
    const suffix = highlightedParam
      ? `?highlightedMessageId=${highlightedParam}`
      : "";
    return withNavigationContext(
      `/(app)/(chat)/${channelId}${suffix}`,
      navigationContext,
    );
  }, [channelId, highlightedParam, navigationContext]);

  const { data: profileData } = useQuery({
    queryKey: ["profile", "channel-share"],
    queryFn: () => getProfile(),
    enabled: auth.isAuthenticated,
    staleTime: 300_000,
  });

  // ── Blocked people (Feature 036) ─────────────────────────────────────────
  // Only used to hide *direct* history from the blocker's own view (FR-021).
  // Messages in a shared work channel stay visible whatever the block says
  // (FR-021a): hiding a colleague there would let someone silently conceal
  // instructions addressed to them.
  const { data: blockedData } = useQuery({
    queryKey: ["compliance", "blocked-people"],
    queryFn: () => listBlockedPeople(),
    enabled: auth.isAuthenticated,
    staleTime: 60_000,
  });

  const isDirectConversation =
    channelData?.channel?.channelType === "direct_message";

  const blockedAuthorIds = useMemo(() => {
    if (!isDirectConversation) return new Set<string>();
    return new Set((blockedData?.blocked ?? []).map((person) => person.employeeId));
  }, [blockedData, isDirectConversation]);

  const currentMembership = useMemo(
    () =>
      profileData?.organizations.find(
        (org) => org.organizationId === auth.organizationId,
      ) ?? profileData?.organizations[0],
    [auth.organizationId, profileData],
  );
  const currentUserDisplayName =
    profileData?.user.displayName || profileData?.user.email || "You";
  const currentUserEmail = profileData?.user.email || "";

  const handleShareChannelLink = useCallback(async () => {
    if (!currentMembership?.organizationSubdomain || !channelId) return;
    const url = await generateCanonicalUrl(
      currentMembership.organizationSubdomain,
      "chat",
      channelId,
    );
    if (url) {
      await Share.share({ message: url, url });
    }
  }, [currentMembership, channelId]);

  const handleShareMessageLink = useCallback(async () => {
    if (
      !currentMembership?.organizationSubdomain ||
      !channelId ||
      !selectedMessageId
    ) {
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
            resourceType: "chat",
            resourceId: channelId,
            anchorType: "message",
            anchorId: selectedMessageId,
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as {
        canonicalUrl?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.canonicalUrl) {
        throw new Error(
          payload?.error ?? "Failed to generate a canonical link.",
        );
      }

      setPendingShareUrl(payload.canonicalUrl);
      setActionSheetVisible(false);
    } catch (error) {
      console.warn(
        "Failed to share canonical message link",
        error instanceof Error ? error.message : error,
      );
    }
  }, [channelId, currentMembership, selectedMessageId]);

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

  const handleContextBack = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      router.replace(contextBackHref as never);
    }
  }, [contextBackHref, navigation, router]);

  // ── Mark as read on enter ────────────────────────────────────────────────
  useEffect(() => {
    if (channelId) {
      markChannelAsRead({ channelId }).catch(() => {});
    }
  }, [channelId]);

  // ── Infinite message query ────────────────────────────────────────────────
  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["messages", channelId],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      return await listMessages({
        channelId: channelId!,
        pageSize: PAGE_SIZE,
        pageToken: pageParam,
        direction: "OLDER",
        anchorMessageId: pageParam ? undefined : highlightedParam,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: MessagesPageResponse) =>
      lastPage?.previousPageToken || undefined,
    enabled: !!channelId,
  });
  const { isRefreshing, onRefresh } = useManualRefresh(refetch);

  const activateHighlight = useCallback((messageId: string) => {
    if (highlightClearTimerRef.current) {
      clearTimeout(highlightClearTimerRef.current);
    }

    setActiveHighlight(messageId);
    highlightClearTimerRef.current = setTimeout(() => {
      setActiveHighlight((current) => (current === messageId ? null : current));
      highlightClearTimerRef.current = null;
    }, 3000);
  }, []);

  const fetchNewerIntoCache = useCallback(async () => {
    if (!channelId) return;

    const cachedData = queryClient.getQueryData<MessagesInfiniteData>([
      "messages",
      channelId,
    ]);
    const firstPage = cachedData?.pages?.[0];
    const newestMessageId =
      firstPage?.messages?.[firstPage.messages.length - 1]?.id;

    if (!newestMessageId) {
      await queryClient.invalidateQueries({
        queryKey: ["messages", channelId],
      });
      return;
    }

    try {
      const response = await listMessages({
        channelId,
        pageSize: PAGE_SIZE,
        pageToken: newestMessageId,
        direction: "NEWER",
      });

      if (!response.messages?.length) return;

      queryClient.setQueryData<MessagesInfiniteData>(
        ["messages", channelId],
        (old) => {
          if (!old?.pages?.length) return old;

          const existingIds = new Set(
            old.pages.flatMap((page) =>
              (page.messages ?? []).map((message) => message.id),
            ),
          );
          const newMessages = response.messages.filter(
            (message) => message.id && !existingIds.has(message.id),
          );
          if (!newMessages.length) return old;

          return {
            ...old,
            pages: [
              {
                ...old.pages[0],
                messages: [...(old.pages[0].messages ?? []), ...newMessages],
                nextPageToken:
                  response.nextPageToken || old.pages[0].nextPageToken,
              },
              ...old.pages.slice(1),
            ],
          };
        },
      );
    } catch {
      await queryClient.invalidateQueries({
        queryKey: ["messages", channelId],
      });
    }
  }, [channelId, queryClient]);

  const insertMessageIntoCache = useCallback(
    (message: ChatMessage) => {
      const cacheKey = ["messages", channelId] as const;
      const cachedData = queryClient.getQueryData<MessagesInfiniteData>(cacheKey);

      if (!cachedData?.pages?.length) {
        void queryClient.invalidateQueries({ queryKey: cacheKey });
        void queryClient.invalidateQueries({ queryKey: ["channels"] });
        return;
      }

      queryClient.setQueryData<MessagesInfiniteData>(cacheKey, (old) => {
        if (!old?.pages?.length) return old;

        const alreadyPresent = old.pages.some((page) =>
          (page.messages ?? []).some((existing) => existing.id === message.id),
        );
        if (alreadyPresent) {
          return old;
        }

        return {
          ...old,
          pages: [
            {
              ...old.pages[0],
              messages: [...(old.pages[0].messages ?? []), message],
            },
            ...old.pages.slice(1),
          ],
        };
      });

      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
    [channelId, queryClient],
  );

  // FlatList is inverted: index 0 = bottom (newest). Backend returns each page
  // oldest→newest, so reverse each page to get newest→oldest for the inverted list.
  // Page 0 contains the most recent messages; subsequent pages are progressively older.
  const serverMessages: ChatMessage[] = React.useMemo(() => {
    const all: ChatMessage[] = [];
    (data?.pages ?? []).forEach((page: MessagesPageResponse) => {
      const pageMessages = (page?.messages ?? []) as ChatMessage[];
      for (let i = pageMessages.length - 1; i >= 0; i--) {
        all.push(pageMessages[i]);
      }
    });
    return collapseVoiceCallTimelineMessages(all);
  }, [data]);

  const messages: RenderMessage[] = React.useMemo(
    () => [...optimisticMessages, ...serverMessages],
    [optimisticMessages, serverMessages],
  );

  useEffect(() => {
    if (!channelId || !highlightedParam) return;
    if (messages.some((message) => message.id === highlightedParam)) return;
    if (deepLinkFetchInFlightRef.current === highlightedParam) return;

    deepLinkFetchInFlightRef.current = highlightedParam;
    let cancelled = false;

    void listMessages({
      channelId,
      pageSize: PAGE_SIZE,
      direction: "OLDER",
      anchorMessageId: highlightedParam,
    })
      .then(async (anchorPage) => {
        if (cancelled || !anchorPage.messages?.length) return;

        const newerPage = await listMessages({
          channelId,
          pageSize: PAGE_SIZE,
          pageToken: anchorPage.nextPageToken || highlightedParam,
          direction: "NEWER",
        }).catch(() => null);

        if (cancelled) return;

        const existingIds = new Set(
          (anchorPage.messages ?? []).map((message) => message.id),
        );
        const newerMessages = (newerPage?.messages ?? []).filter(
          (message) => message.id && !existingIds.has(message.id),
        );

        queryClient.setQueryData<MessagesInfiniteData>(
          ["messages", channelId],
          {
            pages: [
              {
                ...anchorPage,
                messages: [...(anchorPage.messages ?? []), ...newerMessages],
                nextPageToken:
                  newerPage?.nextPageToken || anchorPage.nextPageToken,
              },
            ],
            pageParams: [undefined],
          },
        );
        deepLinkAutoScrollDoneRef.current = null;
        activateHighlight(highlightedParam);
      })
      .finally(() => {
        if (deepLinkFetchInFlightRef.current === highlightedParam) {
          deepLinkFetchInFlightRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activateHighlight, channelId, highlightedParam, messages, queryClient]);

  useEffect(() => {
    if (!highlightedParam || activeHighlight === highlightedParam) return;
    if (deepLinkAutoScrollDoneRef.current === highlightedParam) return;
    if (messages.some((message) => message.id === highlightedParam)) {
      activateHighlight(highlightedParam);
    }
  }, [activateHighlight, activeHighlight, highlightedParam, messages]);

  const selectedMessage = React.useMemo(
    () => messages.find((message) => message.id === selectedMessageId) ?? null,
    [messages, selectedMessageId],
  );

  // ── Render item with date separators and message grouping ─────────────────
  type ListItem =
    | { kind: "date"; date: Date; key: string }
    | { kind: "group"; messages: ChatMessage[]; key: string };

  const listItems: ListItem[] = React.useMemo(() => {
    const items: ListItem[] = [];

    // messages are newest-first (inverted FlatList).
    // In inverted list: index 0 = visual bottom (newest), higher index = visual top (older).
    // Date separators should appear ABOVE their day's messages (at higher index).
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const msgDate = protoToDate(msg.updatedAt);

      const newerMsg = i > 0 ? messages[i - 1] : null;
      const msgMatchesNewer =
        !!newerMsg &&
        newerMsg.authorEmployeeId === msg.authorEmployeeId &&
        !!msgDate &&
        !!protoToDate(newerMsg.updatedAt) &&
        isSameDay(msgDate, protoToDate(newerMsg.updatedAt)!);

      if (msgMatchesNewer) {
        const lastItem = items[items.length - 1];
        if (lastItem?.kind === "group") {
          lastItem.messages.push(msg);
        }
      } else {
        items.push({ kind: "group", messages: [msg], key: `group-${msg.id}` });
      }

      // Date separator: insert AFTER this message (higher index = visually above)
      // when the next message (older, visually higher) is on a different day.
      // The separator labels the CURRENT day (the messages below it).
      const nextMsg = messages[i + 1];
      const nextDate = nextMsg ? protoToDate(nextMsg.updatedAt) : null;
      if (msgDate && nextDate && !isSameDay(msgDate, nextDate)) {
        items.push({ kind: "date", date: msgDate, key: `date-${i}` });
      }

      // For the oldest message (last in array, visual top), add a date header
      // so the topmost day group also has a label above it.
      if (i === messages.length - 1 && msgDate) {
        items.push({ kind: "date", date: msgDate, key: "date-last" });
      }
    }

    return items;
  }, [messages]);
  listItemCountRef.current = listItems.length;

  useEffect(() => {
    return subscribe(({ type, rawData }) => {
      if (!channelId) {
        return;
      }

      if (
        type !== "chat_message" &&
        type !== "chat_reaction" &&
        type !== "notification"
      ) {
        return;
      }

      try {
        const event = parseChatStreamEvent(rawData);
        if (event && event.channelId === channelId) {
          const isVoiceEvent = event.notificationType?.startsWith("voice_call_") ?? false;
          const isReactionEvent =
            type === "chat_reaction" || event.notificationType === "reaction";

          if (isVoiceEvent) {
            if (event.notificationType === "voice_call_incoming" && event.callId) {
              setIncomingVoiceCall({
                channelId,
                callId: event.callId,
                invitationId: event.invitationId,
                alreadyInAnotherCall: event.alreadyInAnotherCall,
                participantCount: event.participantCount,
                state: event.state,
              });
            }
            if (event.notificationType === "voice_call_ended" || event.state === "VOICE_CALL_STATE_ENDED") {
              const activeVoiceSnapshot = voiceClient.getSnapshot();
              if (!event.callId || activeVoiceSnapshot.activeCallId === event.callId) {
                void voiceClient.disconnect();
              }
              // A late "ended" for a previous call must not wipe the call that
              // replaced it.
              setActiveVoiceCall((current) =>
                event.callId && current && current.id !== event.callId ? current : null,
              );
              setJoinedVoiceCallId((current) => current === event.callId ? null : current);
              setIncomingVoiceCall((current) => current?.callId === event.callId ? null : current);
              setVoiceError(null);
              setDismissedCallId((current) => current === event.callId ? null : current);
              queryClient.invalidateQueries({
                queryKey: ["messages", channelId],
              });
            } else {
              getActiveVoiceCall(channelId)
                .then((response) => {
                  setActiveVoiceCall(
                    response.hasActiveCall ? toMobileVoiceCall(response.call) : null,
                  );
                })
                .catch(() => {});
              void fetchNewerIntoCache();
            }
          } else if (isReactionEvent) {
            queryClient.invalidateQueries({
              queryKey: ["messages", channelId],
            });
          } else {
            void fetchNewerIntoCache();
          }

          if (!isReactionEvent) {
            markChannelAsRead({ channelId }).catch(() => {});
          }

          if (!isReactionEvent && atBottomRef.current) {
            setTimeout(
              () =>
                flatListRef.current?.scrollToOffset({
                  offset: 0,
                  animated: true,
                }),
              300,
            );
          }
        }
      } catch {
        // ignore
      }
    });
  }, [channelId, fetchNewerIntoCache, queryClient, subscribe]);

  // ── Behavior 5: Reset transient state when switching channels ───────────
  useEffect(() => {
    setAtBottom(true);
    atBottomRef.current = true;
    setShowNewMessages(false);
    setJoinedVoiceCallId(null);
    setActiveHighlight(null);
    setOptimisticMessages([]);
    lastMessageIdRef.current = null;
    deepLinkFetchInFlightRef.current = null;
    deepLinkAutoScrollDoneRef.current = null;
    scrollOffsetRef.current = 0;
    contentHeightRef.current = 0;
    listItemCountRef.current = 0;
    pendingOlderLoadOffsetRef.current = null;
    pendingOlderLoadItemCountRef.current = null;
    if (highlightClearTimerRef.current) {
      clearTimeout(highlightClearTimerRef.current);
      highlightClearTimerRef.current = null;
    }
  }, [channelId]);

  // ── Deep-link highlight: highlight a specific message for 3 seconds ──────
  useEffect(() => {
    if (highlightedParam) {
      activateHighlight(highlightedParam);
      return () => {
        if (highlightClearTimerRef.current) {
          clearTimeout(highlightClearTimerRef.current);
          highlightClearTimerRef.current = null;
        }
      };
    }
  }, [activateHighlight, highlightedParam, channelId]);

  // ── Deep-link: scroll to highlighted message once data loads ───────────
  useEffect(() => {
    if (!activeHighlight || !flatListRef.current || listItems.length === 0)
      return;
    if (deepLinkAutoScrollDoneRef.current === activeHighlight) return;
    const index = listItems.findIndex(
      (item) =>
        item.kind === "group" &&
        item.messages.some((message) => message.id === activeHighlight),
    );
    if (index >= 0) {
      deepLinkAutoScrollDoneRef.current = activeHighlight;
      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });
      } catch {
        // scrollToIndex can throw if item layout is not yet computed
      }
    }
  }, [activeHighlight, listItems]);

  // ── Behavior 2 & 3: Detect new message at the bottom of the list ─────────
  // messages[0] is always the newest (pages ordered newest-first).
  // • If at bottom  → the new item is already visible; no pill needed.
  // • If scrolled up → show "↓ New messages" pill + haptic.
  useEffect(() => {
    const newestId = messages[0]?.id ?? null;
    if (
      newestId &&
      lastMessageIdRef.current &&
      newestId !== lastMessageIdRef.current
    ) {
      if (!atBottomRef.current) {
        setShowNewMessages(true);
      }
      Haptics.selectionAsync();
    }
    if (newestId) lastMessageIdRef.current = newestId;
  }, [messages]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const sendOptimisticMessage = useCallback(
    async (message: OptimisticMessage) => {
      if (!channelId) {
        return;
      }

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
          insertMessageIntoCache(response.message as ChatMessage);
        } else {
          await fetchNewerIntoCache();
        }
      } catch (error) {
        setOptimisticMessages((current) =>
          current.map((item) =>
            item.id === message.id
              ? {
                  ...item,
                  clientStatus: "failed",
                  clientError: chatSendErrorMessage(error),
                }
              : item,
          ),
        );
      }
    },
    [channelId, fetchNewerIntoCache, insertMessageIntoCache],
  );

  const retryOptimisticMessage = useCallback(
    (messageId: string) => {
      const currentMessage = optimisticMessages.find(
        (item) => item.id === messageId,
      );
      if (!currentMessage) {
        return;
      }

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

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || !channelId) return;

    const optimisticMessage: OptimisticMessage = {
      id: createOptimisticMessageId(),
      organizationId: auth.organizationId ?? "",
      channelId,
      messageText: trimmed,
      authorEmployeeId: auth.employeeId ?? "",
      parentMessageId: "",
      isDeleted: false,
      isEdited: false,
      updatedAt: { seconds: Math.floor(Date.now() / 1000) },
      authorName: currentUserDisplayName,
      authorEmail: currentUserEmail,
      replyCount: 0,
      reactions: [],
      mentionedEmployeeIds: [],
      mentionedEmails: [],
      threadParticipantIds: [],
      fileIds: [],
      messageKind: "text",
      systemEventType: "",
      metadataJson: "",
      clientStatus: "sending",
      originalMessageText: trimmed,
      originalFileIds: [],
    };

    setText("");
    stopTypingIndicator();
    setOptimisticMessages((current) => [optimisticMessage, ...current]);
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
    void sendOptimisticMessage(optimisticMessage);
  };

  const handleVoiceMessageSent = () => {
    void fetchNewerIntoCache();
    queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setTimeout(
      () => flatListRef.current?.scrollToOffset({ offset: 0, animated: true }),
      100,
    );
  };

  // ── Typing indicator ──────────────────────────────────────────────────────
  const stopTypingIndicator = useCallback(() => {
    if (isTypingRef.current) {
      isTypingRef.current = false;
      stopTyping(channelId!).catch(() => {});
    }
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  }, [channelId]);

  useEffect(() => {
    return () => {
      stopTypingIndicator();
    };
  }, [stopTypingIndicator]);

  const handleTextChange = useCallback(
    (val: string) => {
      setText(val);
      if (!val) {
        stopTypingIndicator();
        return;
      }
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        startTyping(channelId!).catch(() => {});
      }
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(stopTypingIndicator, 4000);
    },
    [channelId, stopTypingIndicator],
  );

  const handleVoiceRecorderActiveChange = useCallback(
    (active: boolean) => {
      setVoiceRecorderActive(active);
      if (active) {
        stopTypingIndicator();
      }
    },
    [stopTypingIndicator],
  );

  // ── Reactions ─────────────────────────────────────────────────────────────
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", channelId] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  const handleEmojiSelect = (emoji: string) => {
    if (!selectedMessageId) return;
    reactionMutation.mutate({
      messageId: selectedMessageId,
      emojiCode: emojiToCode(emoji),
      remove: false,
    });
  };

  const handleReactionPress = (
    messageId: string,
    emojiCode: string,
    currentlyReacted: boolean,
  ) => {
    reactionMutation.mutate({
      messageId,
      emojiCode,
      remove: currentlyReacted,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const openMessageActions = useCallback((messageId: string) => {
    setSelectedMessageId(messageId);
    setActionSheetVisible(true);
  }, []);

  const closeMessageActions = useCallback(() => {
    setActionSheetVisible(false);
  }, []);

  const handleThreadAction = useCallback(() => {
    if (!selectedMessageId) {
      return;
    }

    setActionSheetVisible(false);
    router.push(
      withNavigationContext(`/(app)/(chat)/thread/${selectedMessageId}`, {
        parentHref: contextualChannelHref,
        fallbackHref: contextBackHref,
        ownerTab: navigationContext.ownerTab ?? "chat",
        backLabel: navigationContext.backLabel ?? "Channel",
      }) as never,
    );
  }, [
    contextBackHref,
    contextualChannelHref,
    navigationContext.backLabel,
    navigationContext.ownerTab,
    router,
    selectedMessageId,
  ]);

  const handleMoreEmojiAction = useCallback(() => {
    if (!selectedMessageId) {
      return;
    }

    setActionSheetVisible(false);
    setPickerVisible(true);
  }, [selectedMessageId]);

  const handleQuickReactAction = useCallback(
    (emoji: string) => {
      if (!selectedMessageId) {
        return;
      }

      setActionSheetVisible(false);
      reactionMutation.mutate({
        messageId: selectedMessageId,
        emojiCode: emojiToCode(emoji),
        remove: false,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [reactionMutation, selectedMessageId],
  );

  const handleMessagePress = useCallback(
    (messageId: string) => {
      router.push(
        withNavigationContext(`/(app)/(chat)/thread/${messageId}`, {
          parentHref: contextualChannelHref,
          fallbackHref: contextBackHref,
          ownerTab: navigationContext.ownerTab ?? "chat",
          backLabel: navigationContext.backLabel ?? "Channel",
        }) as never,
      );
    },
    [
      contextBackHref,
      contextualChannelHref,
      navigationContext.backLabel,
      navigationContext.ownerTab,
      router,
    ],
  );

  // ── Behavior 2 & 3: Track scroll position ──────────────────────────────
  // In inverted FlatList, y=0 is the visual bottom (newest messages).
  // We use a ref to avoid stale closures in the SSE callback.
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      scrollOffsetRef.current = y;
      const isAtBottom = y < 80;
      atBottomRef.current = isAtBottom;
      if (isAtBottom !== atBottom) {
        setAtBottom(isAtBottom);
        if (isAtBottom) setShowNewMessages(false);
      }
    },
    [atBottom],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      pendingOlderLoadOffsetRef.current = scrollOffsetRef.current;
      pendingOlderLoadItemCountRef.current = listItemCountRef.current;
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      const previousHeight = contentHeightRef.current;
      contentHeightRef.current = height;

      const pendingOffset = pendingOlderLoadOffsetRef.current;
      const pendingItemCount = pendingOlderLoadItemCountRef.current;
      const olderItemsWereInserted =
        pendingItemCount !== null &&
        listItemCountRef.current > pendingItemCount;

      if (
        pendingOffset === null ||
        !olderItemsWereInserted ||
        height <= previousHeight
      ) {
        return;
      }

      pendingOlderLoadOffsetRef.current = null;
      pendingOlderLoadItemCountRef.current = null;
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToOffset({
          offset: pendingOffset,
          animated: false,
        });
      });
    },
    [],
  );

  useEffect(() => {
    if (isFetchingNextPage || pendingOlderLoadOffsetRef.current === null) {
      return;
    }

    const timer = setTimeout(() => {
      pendingOlderLoadOffsetRef.current = null;
      pendingOlderLoadItemCountRef.current = null;
    }, 500);

    return () => clearTimeout(timer);
  }, [isFetchingNextPage]);

  const isActiveVoiceCallJoined = Boolean(
    activeVoiceCall &&
      (joinedVoiceCallId === activeVoiceCall.id ||
        voiceSnapshot.activeCallId === activeVoiceCall.id),
  );

  return (
    <>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: lightPalette.background.default }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <Stack.Screen
          options={{
            title: channelTitle ?? "Channel",
            headerTransparent: false,
            headerBlurEffect: "none",
            headerStyle: { backgroundColor: lightPalette.background.paper },
            headerTitle: () => (
              <Text
                testID="channel-header-title"
                style={{
                  fontSize: 17,
                  fontWeight: "600",
                  color: lightPalette.text.primary,
                }}
              >
                {channelTitle ?? "Channel"}
              </Text>
            ),
            headerBackVisible: false,
            headerBackButtonDisplayMode: "minimal",
            headerLeft: () => (
              <Pressable
                testID="channel-back-button"
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
                accessibilityLabel={
                  showContextBackAction
                    ? `Back to ${navigationContext.backLabel}`
                    : "Back to chat"
                }
                accessibilityRole="button"
              >
                <SFIcon
                  name="chevron.left"
                  size={18}
                  color={lightPalette.text.primary}
                />
                {showContextBackAction ? (
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: "500",
                      color: lightPalette.primary.main,
                    }}
                  >
                    {navigationContext.backLabel}
                  </Text>
                ) : null}
              </Pressable>
            ),
          }}
        />

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator
              size="large"
              color={lightPalette.text.secondary}
            />
          </View>
        ) : (
          <View
            style={{
              flex: 1,
              backgroundColor: lightPalette.background.default,
            }}
          >
            {channelData?.linkedResource ? (
              <TaskDiscussionContext
                linkedResource={channelData.linkedResource}
              />
            ) : null}
            <FlatList
              ref={flatListRef}
              style={{ backgroundColor: lightPalette.background.default }}
              contentInsetAdjustmentBehavior="automatic"
              data={listItems}
              keyExtractor={(item) => item.key}
              inverted
              contentContainerStyle={styles.messageList}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={onRefresh}
                />
              }
              onScroll={handleScroll}
              scrollEventThrottle={16}
              onEndReached={handleEndReached}
              onEndReachedThreshold={0.3}
              onContentSizeChange={handleContentSizeChange}
              onScrollToIndexFailed={({ index }) => {
                setTimeout(() => {
                  flatListRef.current?.scrollToIndex({
                    index,
                    animated: true,
                    viewPosition: 0.5,
                  });
                }, 120);
              }}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <ActivityIndicator style={{ marginVertical: 16 }} />
                ) : null
              }
              renderItem={({ item }) => {
                if (item.kind === "date") {
                  return <DateSeparator date={item.date} />;
                }

                // Hide a blocked person's direct messages from the blocker's own
                // view, with a per-item reveal (FR-021). blockedAuthorIds is empty
                // outside a direct conversation, so this never touches a shared
                // work channel (FR-021a).
                const hidden = item.messages.filter(
                  (message: ChatMessage) =>
                    message.authorEmployeeId &&
                    blockedAuthorIds.has(message.authorEmployeeId) &&
                    !revealedMessageIds.has(message.id),
                );
                if (hidden.length === item.messages.length && hidden.length > 0) {
                  return (
                    <HiddenMessageGroup
                      count={hidden.length}
                      onReveal={() =>
                        setRevealedMessageIds((previous) => {
                          const next = new Set(previous);
                          for (const message of hidden) next.add(message.id);
                          return next;
                        })
                      }
                    />
                  );
                }

                return (
                  <MessageBubble
                    messages={item.messages}
                    isHighlightedMessage={(messageId) =>
                      messageId === activeHighlight
                    }
                    channelId={channelId}
                    contentWidth={htmlContentWidth}
                    onPress={handleMessagePress}
                    onLongPress={openMessageActions}
                    onReactionPress={handleReactionPress}
                    onRetry={retryOptimisticMessage}
                    onThreadPress={(id) =>
                      router.push(
                        withNavigationContext(`/(app)/(chat)/thread/${id}`, {
                          parentHref: contextualChannelHref,
                          fallbackHref: contextBackHref,
                          ownerTab: navigationContext.ownerTab ?? "chat",
                          backLabel: navigationContext.backLabel ?? "Channel",
                        }) as never,
                      )
                    }
                  />
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>
                    No messages yet. Say hello!
                  </Text>
                </View>
              }
            />
            {/* Behavior 3: "↓ New messages" pill — shown when scrolled up and
              a new message arrives. Tapping smooth-scrolls back to bottom. */}
            {showNewMessages && (
              <Pressable
                testID="new-messages-pill"
                onPress={() => {
                  flatListRef.current?.scrollToOffset({
                    offset: 0,
                    animated: true,
                  });
                  setShowNewMessages(false);
                }}
                style={styles.newMessagesPill}
              >
                <Text style={styles.newMessagesPillText}>↓ New messages</Text>
              </Pressable>
            )}
          </View>
        )}

        {(() => {
          // Compute whether we should show the prominent "channel call started"
          // prompt. Shown when there is an active call that the user hasn't
          // joined, there is no targeted invitation already displaying, and the
          // user hasn't dismissed this particular call.
          const showChannelCallPrompt =
            activeVoiceCall != null &&
            !isActiveVoiceCallJoined &&
            incomingVoiceCall == null &&
            dismissedCallId !== activeVoiceCall.id;

          const showInlineIncomingCall =
            incomingVoiceCall != null && globalIncomingVoiceCall?.callId !== incomingVoiceCall.callId;
          const idleVoiceCallError =
            activeVoiceCall == null && incomingVoiceCall == null
              ? voiceError ?? voiceSnapshot.error
              : null;

          if (showInlineIncomingCall) {
            return (
              <IncomingCallBanner
                alreadyInAnotherCall={incomingVoiceCall.alreadyInAnotherCall}
                loading={voiceLoading}
                onAccept={() => void handleAcceptIncomingVoiceCall()}
                onDecline={() => void handleDeclineIncomingVoiceCall()}
              />
            );
          }

          if (showChannelCallPrompt) {
            return (
              <IncomingCallBanner
                loading={voiceLoading}
                title="Voice call started"
                description="Someone started a voice call in this conversation."
                acceptLabel="Join"
                declineLabel="Later"
                onAccept={() => void handleJoinVoiceCall()}
                onDecline={() => setDismissedCallId(activeVoiceCall.id)}
              />
            );
          }

          if (activeVoiceCall) {
            return (
              <VoiceCallBanner
                call={activeVoiceCall}
                connectionState={voiceSnapshot.connectionState}
                connectionQuality={voiceSnapshot.connectionQuality}
                joined={isActiveVoiceCallJoined}
                loading={voiceLoading}
                error={voiceError ?? voiceSnapshot.error}
                onStart={handleStartVoiceCall}
                onJoin={handleJoinVoiceCall}
                onLeave={handleLeaveVoiceCall}
              />
            );
          }

          if (idleVoiceCallError) {
            return (
              <View testID="voice-call-inline-error" style={styles.voiceCallInlineError}>
                <Text selectable style={styles.voiceCallInlineErrorText}>
                  {idleVoiceCallError}
                </Text>
              </View>
            );
          }

          return null;
        })()}

        {/* Message composer */}
        <View
          style={[
            styles.composer,
            voiceRecorderActive && styles.composerVoiceMode,
            {
              paddingBottom:
                Platform.OS === "ios" ? Math.max(insets.bottom, 10) : 12,
            },
          ]}
        >
          <VoiceMessageRecorder
            channelId={channelId}
            onSent={handleVoiceMessageSent}
            onActiveChange={handleVoiceRecorderActiveChange}
            idleAccessory={
              activeVoiceCall == null && incomingVoiceCall == null ? (
                <Pressable
                  testID="voice-call-start-button"
                  onPress={handleStartVoiceCall}
                  disabled={voiceLoading || !channelId}
                  style={({ pressed }) => [
                    styles.composerAccessoryButton,
                    pressed && styles.composerAccessoryButtonPressed,
                    (voiceLoading || !channelId) && styles.composerAccessoryButtonDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Start voice call"
                >
                  {voiceLoading ? (
                    <ActivityIndicator
                      size="small"
                      color={lightPalette.primary.main}
                    />
                  ) : (
                    <SFIcon
                      name="phone.fill"
                      size={18}
                      color={lightPalette.primary.main}
                    />
                  )}
                </Pressable>
              ) : null
            }
          />
          {!voiceRecorderActive ? (
            <>
              <TextInput
                testID="message-input"
                style={styles.composerInput}
                placeholder="Message…"
                value={text}
                onChangeText={handleTextChange}
                multiline
                returnKeyType="default"
                placeholderTextColor={lightPalette.text.disabled}
                accessibilityLabel="Message input"
              />
              <Pressable
                testID="send-button"
                onPress={handleSend}
                disabled={!text.trim()}
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
                accessibilityLabel="Send message"
                accessibilityRole="button"
              >
                <SFIcon
                  name="arrow.up"
                  size={18}
                  color={lightPalette.primary.contrastText}
                />
              </Pressable>
            </>
          ) : null}
        </View>

        <ReactionPicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          onSelect={handleEmojiSelect}
        />

        <MessageActionSheet
          visible={actionSheetVisible}
          hasReplies={(selectedMessage?.replyCount ?? 0) > 0}
          onClose={closeMessageActions}
          onQuickReact={handleQuickReactAction}
          onMoreEmoji={handleMoreEmojiAction}
          onCopyLink={() => {
            void handleShareMessageLink();
          }}
          onThread={handleThreadAction}
          canBlockAuthor={
            !!selectedMessage?.authorEmployeeId &&
            selectedMessage.authorEmployeeId !== auth.employeeId
          }
          onReport={() => {
            const messageId = selectedMessageId;
            closeMessageActions();
            if (messageId) setReportTargetId(messageId);
          }}
          onBlockAuthor={() => {
            const target = selectedMessage?.authorEmployeeId
              ? {
                  id: selectedMessage.authorEmployeeId,
                  name: selectedMessage.authorName || "this person",
                }
              : null;
            closeMessageActions();
            if (target) setBlockTarget(target);
          }}
        />

        <ReportSheet
          visible={reportTargetId !== null}
          targetKind={isDirectConversation ? "direct_message" : "chat_message"}
          targetId={reportTargetId ?? ""}
          subjectLabel="this message"
          onClose={() => setReportTargetId(null)}
        />

        <BlockConfirm
          visible={blockTarget !== null}
          mode="block"
          employeeId={blockTarget?.id ?? ""}
          displayName={blockTarget?.name ?? "this person"}
          onClose={() => setBlockTarget(null)}
          onDone={() => {
            void queryClient.invalidateQueries({
              queryKey: ["compliance", "blocked-people"],
            });
          }}
        />
      </KeyboardAvoidingView>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="magnifyingglass"
          onPress={() => router.push("/(app)/(chat)/search")}
        />
        <Stack.Toolbar.Menu icon="ellipsis.circle">
          <Stack.Toolbar.MenuAction
            icon="square.and.arrow.up"
            onPress={() => {
              void handleShareChannelLink();
            }}
          >
            Share Link
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    </>
  );
}

const styles = StyleSheet.create({
  hiddenGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: lightPalette.background.default,
  },
  hiddenGroupText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: lightPalette.text.secondary,
  },
  hiddenGroupAction: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: lightPalette.primary.main,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  messageList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  messageBubble: {
    width: "100%",
  },
  messageBubblePressed: {
    backgroundColor: lightPalette.background.default,
  },
  messageHighlight: {
    backgroundColor: "#fff9c4",
    borderColor: "#fde68a",
  },
  messageContent: {
    flex: 1,
    gap: 0,
  },
  messageCard: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
  },
  messageHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  senderBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  senderInitialBadge: {
    width: 20,
    height: 20,
    borderRadius: 999,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
    borderWidth: border.hairline,
    borderColor: lightPalette.divider,
  },
  senderInitialText: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  senderName: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  groupCount: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  timestamp: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  groupedMessageRow: {
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  groupedMessageRowSeparated: {
    borderTopWidth: border.hairline,
    borderTopColor: lightPalette.divider,
    marginTop: 2,
    paddingTop: 10,
  },
  groupedMessageMeta: {
    alignItems: "flex-end",
    marginBottom: 4,
  },
  messageText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.primary,
    lineHeight: 22,
  },
  reactionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: lightPalette.background.default,
    borderRadius: 12,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  reactionChipActive: {
    backgroundColor: lightPalette.primary.light + "30",
    borderColor: lightPalette.primary.light,
  },
  reactionEmoji: {
    fontSize: 15,
  },
  reactionCount: {
    fontSize: 13,
    color: lightPalette.text.secondary,
    fontWeight: "600",
  },
  reactionCountActive: {
    color: lightPalette.text.primary,
  },
  threadLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  threadLinkText: {
    fontSize: 13,
    color: lightPalette.primary.main,
    fontWeight: "600",
  },
  deliveryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  deliveryText: {
    fontSize: 12,
    color: lightPalette.text.secondary,
  },
  deliveryTextError: {
    fontSize: 12,
    fontWeight: "600",
    color: lightPalette.error.main,
  },
  deliveryRetryButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: border.thin,
    borderColor: lightPalette.error.main,
    backgroundColor: lightPalette.background.paper,
  },
  deliveryRetryButtonPressed: {
    opacity: 0.8,
  },
  deliveryRetryText: {
    fontSize: 12,
    fontWeight: "600",
    color: lightPalette.error.main,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    borderTopWidth: border.hairline,
    borderTopColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
    gap: 8,
  },
  composerVoiceMode: {
    alignItems: "stretch",
  },
  composerAccessoryButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.default,
  },
  composerAccessoryButtonPressed: {
    backgroundColor: lightPalette.background.paper,
  },
  composerAccessoryButtonDisabled: {
    opacity: opacity.disabled,
  },
  composerInput: {
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
  voiceCallInlineError: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: border.thin,
    borderTopColor: lightPalette.divider,
    backgroundColor: "#fff7ed",
  },
  voiceCallInlineErrorText: {
    color: lightPalette.error.main,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600",
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  emojiSheet: {
    backgroundColor: lightPalette.background.paper,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 16,
  },
  emojiSheetTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "600",
    color: lightPalette.text.secondary,
    textAlign: "center",
  },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  emojiBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: lightPalette.background.default,
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
  dateSep: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 12,
    gap: 8,
  },
  dateLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
  },
  dateText: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
    fontWeight: "600",
  },
  emptyState: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  typingRow: {
    flexDirection: "row",
    gap: 4,
    paddingLeft: 56,
    paddingBottom: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: lightPalette.text.secondary,
  },
  dot1: {},
  dot2: {},
  dot3: {},
  // "↓ New messages" floating pill
  newMessagesPill: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    backgroundColor: lightPalette.primary.dark,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  newMessagesPillText: {
    color: lightPalette.primary.contrastText,
    fontSize: 14,
    fontWeight: "600",
  },
});
