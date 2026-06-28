/**
 * Chat Page
 * 3-column layout for real-time team messaging
 * 
 * Layout:
 * - Left (w-56): Channel sidebar with unread badges
 * - Center (flex-1): Message list with virtual scrolling
 * - Right (w-80): Thread view (collapsible)
 * 
 * Features:
 * - Real-time message updates via SSE
 * - @mention notifications with deep linking
 * - Reply threading (1-level)
 * - Emoji reactions
 * - Typing indicators
 */

'use client';

import React, { useState, useEffect, useCallback, Suspense, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/hooks';
import { Box, CircularProgress } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addChannelToCategory, getMessageById, getUserChatConfig, listRecentChannels } from 'apis';
import MessageList from './components/MessageList';
import ThreadView from './components/ThreadView';
import { ChatContextRailSection } from './components/ChatContextRailSection';
import { useChatSSE, type OnTypingEvent, type OnReplyEvent } from './hooks/useChatSSE';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	createContextRailRegistrationToken,
	useRegisterContextRail,
} from '../providers/useContextRail';

export default function ChatPage() {
	const { isLoading, user } = useRequireAuth();

	// Auth gate
	if (isLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '100vh',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	if (!user) {
		return null;
	}

	return (
		<Suspense fallback={
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '100vh',
				}}
			>
				<CircularProgress />
			</Box>
		}>
			<ChatPageContent />
		</Suspense>
	);
}

function ChatPageContent() {
	const { isLoading, user } = useRequireAuth();
	const colors = useThemeColors();
	const searchParams = useSearchParams();
	const router = useRouter();
	const queryClient = useQueryClient();

	// Active channel from URL query param
	const activeChannelId = searchParams.get('channel');

	// Handle deep linking from notifications / shared links
	const highlightMessageId = searchParams.get('message');
	const threadParam = searchParams.get('thread');
	const handledDeeplinkRef = useRef<string | null>(null);

	const [railRegistrationToken] = useState(() =>
		createContextRailRegistrationToken('chat-context-rail')
	);

	// Fetch highlighted message metadata to validate channel/thread context
	const { data: highlightedMessageResponse } = useQuery({
		queryKey: ['chat', 'messageById', highlightMessageId],
		queryFn: () => getMessageById(highlightMessageId || ''),
		enabled: !!highlightMessageId,
		staleTime: 30_000,
	});

	const resolvedChannelId = activeChannelId || highlightedMessageResponse?.channel?.id || null;
	const listHighlightMessageId = threadParam || highlightMessageId;
	const highlightReplyId = threadParam && highlightMessageId && threadParam !== highlightMessageId
		? highlightMessageId
		: null;

	const highlightedMessageMetadata = highlightedMessageResponse?.message
		? {
			parentMessageId: highlightedMessageResponse.message.parentMessageId || null,
			channelId: highlightedMessageResponse.channel?.id || null,
		}
		: undefined;

	// Fetch user chat config to check if channel is already in categories
	const { data: config } = useQuery({
		queryKey: ['userChatConfig'],
		queryFn: getUserChatConfig,
	});

	// Fetch recent channels to get channel metadata (type)
	const { data: recentChannels } = useQuery({
		queryKey: ['recentChannels'],
		queryFn: listRecentChannels,
	});

	// Mutation to add channel to category
	const addToCategoryMutation = useMutation({
		mutationFn: ({ channelId, category }: { channelId: string; category: string }) =>
			addChannelToCategory(channelId, category),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['recentChannels'] });
			queryClient.invalidateQueries({ queryKey: ['userChatConfig'] });
		},
	});

	// Auto-add channel to category when it's viewed (via URL or navigation)
	useEffect(() => {
		if (!resolvedChannelId || !config || !recentChannels) return;

		// Check if channel is already in categories
		if (config.channelCategories[resolvedChannelId]) {
			return; // Already categorized
		}

		// Find channel metadata to determine category
		const channelData = recentChannels.find(ch => ch.channel.id === resolvedChannelId);
		if (!channelData) {
			return; // Channel not found in recent list (not a member)
		}

		// Determine category based on channel type
		const category = channelData.channel.channelType === 'direct_message'
			? 'direct_messages'
			: channelData.channel.isArchived
				? 'archived'
				: 'channels';

		// Add to category
		addToCategoryMutation.mutate({ channelId: resolvedChannelId, category });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resolvedChannelId, config, recentChannels]); // Intentionally exclude addToCategoryMutation to prevent infinite loop

	const channelData = recentChannels?.find(ch => ch.channel.id === resolvedChannelId);
	const channelName = channelData?.channel.displayName || '';
	const isDirectMessage = channelData?.channel.channelType === 'direct_message';

	const chatRailRegistration = useMemo(
		() =>
			user && resolvedChannelId && channelData
				? {
					routeKey: 'chat',
					registrationToken: railRegistrationToken,
					showGlobalBlocks: false,
					blocks: [
						{
							id: 'chat-channel-context',
							node: (
								<ChatContextRailSection
									channelId={resolvedChannelId}
									isDirectMessage={isDirectMessage}
								/>
							),
							priority: 0,
						},
					],
				}
				: null,
		[user, railRegistrationToken, resolvedChannelId, channelData, channelName, isDirectMessage]
	);

	useRegisterContextRail(chatRailRegistration);

	// Keep URL in sync with highlighted message metadata (channel + thread)
	useEffect(() => {
		if (!highlightMessageId || !highlightedMessageResponse) {
			handledDeeplinkRef.current = null;
			return;
		}

		if (handledDeeplinkRef.current === highlightMessageId) {
			return;
		}

		const params = new URLSearchParams();
		// Copy all existing params to avoid read-only issues
		searchParams.forEach((value, key) => {
			params.set(key, value);
		});
		let changed = false;

		const messageChannelId = highlightedMessageResponse.channel?.id;
		if (messageChannelId && messageChannelId !== activeChannelId) {
			params.set('channel', messageChannelId);
			changed = true;
		}

		const parentId = highlightedMessageResponse.message?.parentMessageId;
		if (parentId && parentId !== highlightMessageId && !threadParam) {
			params.set('thread', parentId);
			changed = true;
		}

		if (changed) {
			const next = params.toString();
			router.replace(next ? `/workspace/chat?${next}` : '/workspace/chat', { scroll: false });
		}

		handledDeeplinkRef.current = highlightMessageId;
	}, [highlightMessageId, highlightedMessageResponse, activeChannelId, threadParam, router, searchParams]);

	// In-channel reply notification (shown when someone replies to the current user's message)
	const [replyNotification, setReplyNotification] = useState<{
		title: string;
		parentMessageId: string;
		channelId: string;
	} | null>(null);

	// Typing indicator state (per channel and per thread)
	// Key format: channelId for channel typing, "thread:parentMessageId" for thread typing
	const [typingUsers, setTypingUsers] = useState<Record<string, Array<{ userId: string; userName: string; expiresAt: Date }>>>({});

	// Handle typing events from SSE
	const handleTypingEvent: OnTypingEvent = useCallback((data) => {
		const { channelId, parentMessageId, userId, userName, isTyping } = data;

		// Determine key: use thread key for thread typing, channel key for channel typing
		const key = parentMessageId ? `thread:${parentMessageId}` : channelId;

		console.log('[ChatPage] Typing event received:', {
			channelId,
			parentMessageId,
			userId,
			userName,
			isTyping,
			key,
		});

		setTypingUsers((prev) => {
			const currentTyping = prev[key] || [];

			if (isTyping) {
				// Add user to typing list with 5-second expiration
				const expiresAt = new Date(Date.now() + 5000);
				const existing = currentTyping.find((u) => u.userId === userId);

				if (existing) {
					// Update expiration time
					return {
						...prev,
						[key]: currentTyping.map((u) =>
							u.userId === userId ? { ...u, expiresAt } : u
						),
					};
				} else {
					// Add new typing user
					const updated = {
						...prev,
						[key]: [...currentTyping, { userId, userName, expiresAt }],
					};
					console.log('[ChatPage] Added typing user:', { key, userName, totalTyping: updated[key].length });
					return updated;
				}
			} else {
				// Remove user from typing list
				const updated = {
					...prev,
					[key]: currentTyping.filter((u) => u.userId !== userId),
				};
				console.log('[ChatPage] Removed typing user:', { key, userName, totalTyping: updated[key].length });
				return updated;
			}
		});
	}, []);

	const handleReplyEvent = useCallback<OnReplyEvent>((data) => {
		// Only show the toast if the user is on the channel where the reply happened.
		// If they're already viewing the thread for that message, skip it too.
		const currentThreadId = searchParams.get('thread');
		if (currentThreadId === data.parentMessageId) return;
		setReplyNotification(data);
	}, [searchParams]);

	// Subscribe to SSE events for real-time updates
	useChatSSE({
		onTypingEvent: handleTypingEvent,
		onReplyEvent: handleReplyEvent,
		enabled: !isLoading && !!user,
	});

	// Auto-dismiss reply notification after 6 s
	useEffect(() => {
		if (!replyNotification) return;
		const timer = setTimeout(() => setReplyNotification(null), 6000);
		return () => clearTimeout(timer);
	}, [replyNotification]);

	// Cleanup expired typing indicators
	useEffect(() => {
		const interval = setInterval(() => {
			const now = Date.now();
			setTypingUsers((prev) => {
				const updated = { ...prev };
				let changed = false;

				Object.keys(updated).forEach((key) => {
					const filtered = updated[key].filter((u) => u.expiresAt.getTime() > now);
					if (filtered.length !== updated[key].length) {
						updated[key] = filtered;
						changed = true;
					}
				});

				return changed ? updated : prev;
			});
		}, 1000);

		return () => clearInterval(interval);
	}, []);

	const handleOpenThread = useCallback((messageId: string) => {
		const params = new URLSearchParams();
		// Copy all existing params to avoid read-only issues
		searchParams.forEach((value, key) => {
			params.set(key, value);
		});
		const channelForUrl = resolvedChannelId || highlightedMessageResponse?.channel?.id;

		if (channelForUrl) {
			params.set('channel', channelForUrl);
		}
		params.set('thread', messageId);

		const next = params.toString();
		router.replace(next ? `/workspace/chat?${next}` : '/workspace/chat', { scroll: false });
	}, [router, searchParams, resolvedChannelId, highlightedMessageResponse]);

	const handleCloseThread = useCallback(() => {
		const params = new URLSearchParams();
		// Copy all existing params to avoid read-only issues
		searchParams.forEach((value, key) => {
			params.set(key, value);
		});
		params.delete('thread');
		const next = params.toString();
		router.replace(next ? `/workspace/chat?${next}` : '/workspace/chat', { scroll: false });
	}, [router, searchParams]);

	// Auth gate
	if (isLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '100vh',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	if (!user) {
		return null;
	}

	return (
		// Use a 5-column grid so we can make the center area 3/5 and the thread view 2/5
		<div className={`h-full grid grid-cols-5 ${colors.bg.default.className}`}>
			{/* Center: Message List (spans 3 cols when thread open, otherwise full width) */}
			<div className={(threadParam && resolvedChannelId) ? 'col-span-3 flex flex-col min-w-0' : 'col-span-5 flex flex-col min-w-0'}>
				{resolvedChannelId ? (
					<MessageList
						channelId={resolvedChannelId}
						highlightMessageId={listHighlightMessageId}
						highlightedMessageMetadata={highlightedMessageMetadata}
						onOpenThread={handleOpenThread}
						typingUsers={resolvedChannelId ? typingUsers[resolvedChannelId] || [] : []}
						replyNotification={replyNotification}
						onDismissReplyNotification={() => setReplyNotification(null)}
					/>
				) : (
					<div className={`flex-1 flex items-center justify-center ${colors.text.secondary.className}`}>
						<div className="text-center">
							<div className="text-4xl mb-4">💬</div>
							<p className="text-lg font-medium">Select a channel to start chatting</p>
							<p className="text-sm mt-2">Choose a channel from the sidebar or create a new one</p>
						</div>
					</div>
				)}
			</div>

			{/* Right: Thread View (collapsible) - spans 2 cols when present */}
			{threadParam && resolvedChannelId && (
				<div className="col-span-2 flex flex-col min-w-0">
					<ThreadView
						messageId={threadParam}
						channelId={resolvedChannelId}
						highlightReplyId={highlightReplyId}
						onClose={handleCloseThread}
						typingUsers={typingUsers[`thread:${threadParam}`] || []}
					/>
				</div>
			)}

		</div>
	);
}
