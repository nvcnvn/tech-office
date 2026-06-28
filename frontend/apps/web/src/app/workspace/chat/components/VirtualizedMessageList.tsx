/**
 * Virtualized Message List Component
 * Shared component for displaying message lists with virtual scrolling.
 * Used by both the main channel view (MessageList) and thread reply view (ThreadView).
 *
 * ## Scroll behaviour
 *
 * 1. **Initial load** — `initialTopMostItemIndex` starts the view at the bottom
 *    so the latest messages are visible immediately.
 *
 * 2. **At bottom (normal)** — `followOutput` returns `'smooth'` when the user is
 *    at the bottom. New messages auto-scroll into view right above the input box.
 *
 * 3. **Scrolled up (reading history)** — `atBottomStateChange` tracks when the
 *    user leaves the bottom (`atBottom = false`). `followOutput` returns `false`,
 *    so the viewport stays put. If a new message arrives (detected by comparing
 *    the last message ID), a "↓ New messages" pill appears. Clicking it
 *    smooth-scrolls back to the latest message.
 *
 * 4. **Loading older messages (prepend)** — When the user scrolls near the top,
 *    `startReached` fires `onLoadMore`. Older messages are prepended.
 *    `firstItemIndexRef` is decremented **synchronously during render** (not in
 *    an effect) so Virtuoso sees the correct index in the same frame — no
 *    flicker or scroll jump.
 *
 * 5. **Channel / thread switch** — When `listId` changes, all transient state
 *    (scroll position, indicators, prepend index) is reset.
 *
 * 6. **Deep-link highlight** — A `highlightedMessageId` prop triggers a one-time
 *    smooth scroll to that message (centered), with a 3-second highlight that
 *    auto-clears.
 */

'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { Box, CircularProgress, Button } from '@mui/material';
import MessageItem from './MessageItem';
import { codeToEmoji } from '../utils/emoji';

// Local type for proto reaction objects until generated types are available
interface ReactionProto {
	emojiCode?: string;
	count?: number;
	employeeIds?: string[];
	currentUserReacted?: boolean;
	firstReactedAt?: { seconds: bigint | string | number } | undefined;
}

export interface VirtualizedMessage {
	id?: string;
	authorName?: string;
	authorEmail?: string;
	authorAvatar?: string;
	messageText?: string;
	updatedAt?: { seconds: bigint | string | number };
	clientStatus?: 'sending' | 'failed';
	clientError?: string;
	onRetry?: () => void;
	replyCount?: number;
	threadParticipantIds?: string[];
	lastReplyAt?: { seconds: bigint | string | number };
	reactions?: Array<{
		emojiCode?: string;
		count?: number;
		employeeIds?: string[];
		currentUserReacted?: boolean;
	}>;
	fileIds?: string[];
	messageKind?: string;
	systemEventType?: string;
	metadataJson?: string;
}

interface VirtualizedMessageListProps {
	messages: VirtualizedMessage[];
	channelId: string;
	parentMessageId?: string;
	isLoading?: boolean;
	hasMore?: boolean;
	isFetchingMore?: boolean;
	onLoadMore?: () => void;
	highlightedMessageId?: string | null;
	onReply?: (messageId: string) => void;
	onReact?: (messageId: string, emoji: string, shouldRemove: boolean) => void;
	onEdit?: (messageId: string) => void;
	onDelete?: (messageId: string) => void;
	emptyMessage?: string;
	emptyIcon?: string;
	headerComponent?: React.ReactNode;
	/** Identifier for the current list context (e.g., channel or thread ID). Resets scroll state on change. */
	listId?: string;
	/** If true, the list will auto-scroll to `highlightedMessageId` once. */
	autoScrollToHighlighted?: boolean;
	/** Called after the one-time auto-scroll to the highlighted message. */
	onAutoScrolled?: () => void;
	/** In-channel reply notification — shown when someone replies to the current user's message. */
	replyNotification?: { title: string; parentMessageId: string } | null;
	/** Dismiss the reply notification pill. */
	onDismissReplyNotification?: () => void;
}

// Convert protobuf Timestamp → JS Date
function convertTimestamp(ts?: { seconds: bigint | string | number }): Date {
	if (!ts) return new Date();
	return new Date(Number(ts.seconds) * 1000);
}

function voiceCallIdForMessage(message: VirtualizedMessage): string | null {
	if (message.messageKind !== 'system' || !message.metadataJson) {
		return null;
	}
	try {
		const metadata = JSON.parse(message.metadataJson) as { callId?: string };
		return typeof metadata.callId === 'string' && metadata.callId ? metadata.callId : null;
	} catch {
		return null;
	}
}

function collapseVoiceCallTimelineMessages(messages: VirtualizedMessage[]): VirtualizedMessage[] {
	const terminalCallIds = new Set<string>();
	for (const message of messages) {
		const callId = voiceCallIdForMessage(message);
		if (callId && message.systemEventType && message.systemEventType !== 'voice_call_started') {
			terminalCallIds.add(callId);
		}
	}
	if (!terminalCallIds.size) {
		return messages;
	}
	return messages.filter((message) => {
		const callId = voiceCallIdForMessage(message);
		return !(callId && terminalCallIds.has(callId) && message.systemEventType === 'voice_call_started');
	});
}

export default function VirtualizedMessageList({
	messages,
	channelId,
	parentMessageId,
	isLoading = false,
	hasMore = false,
	isFetchingMore = false,
	onLoadMore,
	highlightedMessageId = null,
	onReply,
	onReact,
	onEdit,
	onDelete,
	emptyMessage = 'No messages yet.',
	emptyIcon = '💬',
	headerComponent,
	listId,
	autoScrollToHighlighted = false,
	onAutoScrolled,
	replyNotification = null,
	onDismissReplyNotification,
}: VirtualizedMessageListProps) {
	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const visibleMessages = React.useMemo(() => collapseVoiceCallTimelineMessages(messages), [messages]);

	// ── Scroll / bottom tracking ──────────────────────────────────────
	const [atBottom, setAtBottom] = useState(true);
	const [showNewMessages, setShowNewMessages] = useState(false);
	const lastMessageIdRef = useRef<string | null>(null);

	// ── Prepend support ───────────────────────────────────────────────
	// Virtuoso needs a stable `firstItemIndex` that decreases when older
	// messages are prepended so it can keep the viewport in place.
	// We use a ref (not state) so the adjustment is synchronous within the
	// same render frame — avoids a one-frame flicker where Virtuoso sees
	// new data but the old firstItemIndex.
	const firstItemIndexRef = useRef(10_000);
	const prevMessageCountRef = useRef(0);
	const prevFirstMessageIdRef = useRef<string | null>(null);

	// ── Highlight (deep-link) ─────────────────────────────────────────
	const [highlightedId, setHighlightedId] = useState<string | null>(null);
	const prevHighlightPropRef = useRef<string | null>(null);
	const clearHighlightTimer = useRef<number | null>(null);
	const hasAutoScrolledRef = useRef(false);

	// ── List-id reset (channel / thread switch) ───────────────────────
	const prevListIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!listId || prevListIdRef.current === listId) return;
		prevListIdRef.current = listId;
		// Reset all transient state for the new list
		setAtBottom(true);
		setShowNewMessages(false);
		firstItemIndexRef.current = 10_000;
		prevMessageCountRef.current = 0;
		prevFirstMessageIdRef.current = null;
		lastMessageIdRef.current = null;
		hasAutoScrolledRef.current = false;
	}, [listId]);

	// ── Detect new message at end → show indicator when scrolled up ───
	useEffect(() => {
		const lastId = visibleMessages[visibleMessages.length - 1]?.id;
		if (lastId && lastMessageIdRef.current && lastId !== lastMessageIdRef.current && !atBottom) {
			setShowNewMessages(true);
		}
		if (lastId) lastMessageIdRef.current = lastId;
	}, [visibleMessages, atBottom]);

	// ── Adjust firstItemIndex synchronously during render ─────────────
	// Runs in the same render frame as the new data so Virtuoso never
	// sees a stale firstItemIndex (which would cause a scroll flicker).
	const curCount = visibleMessages.length;
	const curFirstId = visibleMessages[0]?.id ?? null;
	if (curCount > prevMessageCountRef.current && prevMessageCountRef.current > 0 && curFirstId !== prevFirstMessageIdRef.current) {
		firstItemIndexRef.current -= curCount - prevMessageCountRef.current;
	}
	prevMessageCountRef.current = curCount;
	prevFirstMessageIdRef.current = curFirstId;

	// ── Highlight effect (auto-clear after 3 s) ──────────────────────
	useEffect(() => {
		if (!highlightedMessageId) {
			if (clearHighlightTimer.current) window.clearTimeout(clearHighlightTimer.current);
			setHighlightedId(null);
			prevHighlightPropRef.current = null;
			return;
		}
		if (prevHighlightPropRef.current === highlightedMessageId) return;
		prevHighlightPropRef.current = highlightedMessageId;

		if (clearHighlightTimer.current) window.clearTimeout(clearHighlightTimer.current);
		setHighlightedId(highlightedMessageId);
		clearHighlightTimer.current = window.setTimeout(() => {
			setHighlightedId(null);
			clearHighlightTimer.current = null;
		}, 3000);
		return () => {
			if (clearHighlightTimer.current) window.clearTimeout(clearHighlightTimer.current);
		};
	}, [highlightedMessageId]);

	// ── One-time scroll to highlighted message ────────────────────────
	useEffect(() => {
		if (!autoScrollToHighlighted || hasAutoScrolledRef.current || !highlightedMessageId || visibleMessages.length === 0) return;
		const idx = visibleMessages.findIndex((m) => m.id === highlightedMessageId);
		if (idx === -1) return;
		hasAutoScrolledRef.current = true;
		setTimeout(() => {
			virtuosoRef.current?.scrollToIndex({ index: idx, behavior: 'smooth', align: 'center' });
			onAutoScrolled?.();
		}, 100);
	}, [visibleMessages, highlightedMessageId, autoScrollToHighlighted, onAutoScrolled]);

	// ── Scroll-to-bottom handler (used by the "New messages" pill) ────
	const scrollToBottom = useCallback(() => {
		virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
		setShowNewMessages(false);
	}, []);

	// ── Early returns: loading / empty ────────────────────────────────
	if (isLoading) {
		return (
			<Box className="flex justify-center items-center h-full">
				<CircularProgress />
			</Box>
		);
	}

	if (visibleMessages.length === 0) {
		return (
			<Box className="flex items-center justify-center h-full">
				<div className="text-center">
					<div className="text-4xl mb-2">{emptyIcon}</div>
					<p className="text-sm text-gray-600">{emptyMessage}</p>
				</div>
			</Box>
		);
	}

	return (
		<div className="relative h-full">
			<Virtuoso
				ref={virtuosoRef}
				data={visibleMessages}
				initialTopMostItemIndex={visibleMessages.length - 1}
				firstItemIndex={firstItemIndexRef.current}
				defaultItemHeight={80}
				increaseViewportBy={{ top: 800, bottom: 200 }}
				computeItemKey={(index, item) => item.id ?? `virtualized-item-${index}`}
				atTopThreshold={200}
				atBottomThreshold={30}
				startReached={() => {
					if (hasMore && !isFetchingMore && onLoadMore) onLoadMore();
				}}
				followOutput={(isAtBottom) => {
					// Virtuoso calls this when new items are appended.
					// Return 'smooth' to auto-scroll, or false to stay put.
					return isAtBottom ? 'smooth' : false;
				}}
				atBottomStateChange={(bottom) => {
					setAtBottom(bottom);
					if (bottom) setShowNewMessages(false);
				}}
				itemContent={(_index, message) => {
					const messageId = message.id || '';
					if (!messageId) return null;
					const isLocalOnly = Boolean(message.clientStatus);

					const timestamp = convertTimestamp(message.updatedAt);
					const lastReplyAt = message.lastReplyAt ? convertTimestamp(message.lastReplyAt) : undefined;

					const mappedReactions = (message.reactions || []).map((r: ReactionProto) => ({
						emoji: codeToEmoji(r.emojiCode || ''),
						count: r.count || 0,
						hasReacted: r.currentUserReacted || false,
						firstReactedAt: r.firstReactedAt ? new Date(Number(r.firstReactedAt.seconds) * 1000) : undefined,
					}));

					return (
						<MessageItem
							key={messageId}
							id={messageId}
							channelId={channelId}
							parentMessageId={parentMessageId}
							authorName={message.authorName || 'Unknown'}
							authorEmail={message.authorEmail || ''}
							authorAvatar={message.authorAvatar}
							messageText={message.messageText || ''}
							timestamp={timestamp}
							isHighlighted={messageId === highlightedId}
							deliveryState={message.clientStatus}
							deliveryError={message.clientError}
							onRetry={message.onRetry}
							replyCount={message.replyCount || 0}
							threadParticipantIds={message.threadParticipantIds || []}
							lastReplyAt={lastReplyAt}
							reactions={mappedReactions}
							fileIds={message.fileIds || []}
							messageKind={message.messageKind}
							systemEventType={message.systemEventType}
							metadataJson={message.metadataJson}
							onReply={!isLocalOnly && onReply ? () => onReply(messageId) : undefined}
							onReact={!isLocalOnly && onReact ? (emoji, shouldRemove) => onReact(messageId, emoji, shouldRemove) : undefined}
							onEdit={!isLocalOnly && onEdit ? () => onEdit(messageId) : undefined}
							onDelete={!isLocalOnly && onDelete ? () => onDelete(messageId) : undefined}
						/>
					);
				}}
				components={{
					Header: () =>
						isFetchingMore ? (
							<Box className="flex justify-center p-4">
								<CircularProgress size={24} />
							</Box>
						) : headerComponent ? (
							<>{headerComponent}</>
						) : null,
				}}
			/>

			{/* Reply notification pill — shown when someone replies to the current user's message */}
			{replyNotification && (
				<Box
					sx={{
						position: 'absolute',
						bottom: showNewMessages ? 60 : 16,
						left: '50%',
						transform: 'translateX(-50%)',
						zIndex: 10,
						whiteSpace: 'nowrap',
					}}
				>
					<Button
						variant="contained"
						size="small"
						onClick={() => {
							if (replyNotification.parentMessageId) onReply?.(replyNotification.parentMessageId);
							onDismissReplyNotification?.();
						}}
						sx={{
							bgcolor: 'info.main',
							color: 'info.contrastText',
							textTransform: 'none',
							boxShadow: 'none',
							'&:hover': { bgcolor: 'info.dark' },
							px: 2,
							py: 0.5,
							borderRadius: 1.5,
							maxWidth: 360,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
						}}
					>
						💬 {replyNotification.title}
					</Button>
				</Box>
			)}

			{/* "New messages" pill — shown when user is scrolled up and new messages arrive */}
			{showNewMessages && (
				<Box
					sx={{
						position: 'absolute',
						bottom: 16,
						left: '50%',
						transform: 'translateX(-50%)',
						zIndex: 10,
					}}
				>
					<Button
						variant="contained"
						size="small"
						onClick={scrollToBottom}
						sx={{
							bgcolor: 'info.main',
							color: 'info.contrastText',
							textTransform: 'none',
							boxShadow: 'none',
							'&:hover': { bgcolor: 'info.dark' },
							px: 2,
							py: 0.5,
							borderRadius: 1.5,
						}}
					>
						↓ New messages
					</Button>
				</Box>
			)}
		</div>
	);
}
