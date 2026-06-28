/**
 * Thread View Component
 * Right sidebar showing message thread (replies)
 * 
 * Features:
 * - Display parent message at top
 * - List of replies below
 * - Reply composer at bottom
 * - Slide-in animation from right
 * - Close on Escape key
 */

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Box, IconButton, Typography, CircularProgress, Divider, Tooltip } from '@mui/material';
import { getMessage, listReplies, replyToMessage, addReaction, removeReaction } from 'apis';
import MessageItem from './MessageItem';
import MessageComposer from './MessageComposer';
import VirtualizedMessageList from './VirtualizedMessageList';
import TypingIndicator from './TypingIndicator';
import { emojiToCode, codeToEmoji } from '../utils/emoji';
import { useThemeColors } from '@/theme/useThemeColors';
import { useAuthState } from '@/lib/auth/hooks';

interface ThreadViewProps {
	messageId: string;
	channelId: string; // Required for copy link functionality
	highlightReplyId?: string | null; // For deep linking to specific reply
	onClose: () => void;
	typingUsers?: Array<{ userId: string; userName: string; expiresAt: Date }>; // Thread typing indicators
}

export default function ThreadView({ messageId, channelId, highlightReplyId, onClose, typingUsers = [] }: ThreadViewProps) {
	const queryClient = useQueryClient();
	const colors = useThemeColors();
	const { user } = useAuthState();
	const [copyLinkSuccess, setCopyLinkSuccess] = useState(false);

	const currentMembership = useMemo(
		() => user?.organizations.find((org) => org.organizationId === user.organizationId) ?? user?.organizations[0],
		[user]
	);

	const handleCopyThreadLink = async () => {
		try {
			if (!currentMembership?.organizationSubdomain) return;
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/generate`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						target: {
							tenantKey: currentMembership.organizationSubdomain,
							resourceType: 'thread',
							resourceId: messageId,
						},
					}),
				}
			);
			const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string } | null;
			if (response.ok && payload?.canonicalUrl) {
				await navigator.clipboard.writeText(payload.canonicalUrl);
				setCopyLinkSuccess(true);
				setTimeout(() => setCopyLinkSuccess(false), 2000);
			}
		} catch {
			// silently ignore
		}
	};

	// Debug: Log when thread opens
	useEffect(() => {
		console.log('[ThreadView] Opening thread for message:', messageId);
	}, [messageId]);

	// Handle Escape key to close
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [onClose]);

	// Fetch parent message
	const { data: parentMessageData, isLoading: isLoadingParent } = useQuery({
		queryKey: ['message', messageId],
		queryFn: async () => {
			const response = await getMessage(messageId);
			return response.message;
		},
		enabled: !!messageId,
	});

	// Fetch replies
	const { data: repliesData, isLoading: isLoadingReplies } = useQuery({
		queryKey: ['replies', messageId],
		queryFn: async () => {
			console.log('[ThreadView] Fetching replies for message:', messageId);
			// TODO: Fix type in apis package
			const response = await listReplies({
				parentMessageId: messageId,
				pageSize: 100,
				pageToken: '',
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			} as any);
			console.log('[ThreadView] Replies fetched:', response.replies?.length || 0);
			return response;
		},
		enabled: !!messageId,
	});

	// Send reply handler
	const handleSendReply = async (text: string, fileIds?: string[]) => {
		try {
			await replyToMessage({
				parentMessageId: messageId,
				messageText: text,
				fileIds,
			});

			// Refresh replies, the parent message (to update reply count/last-reply),
			// and the channel messages list so the main view reflects the change.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['replies', messageId] }),
				queryClient.invalidateQueries({ queryKey: ['message', messageId] }),
				queryClient.invalidateQueries({ queryKey: ['messages', channelId] }),
			]);
		} catch (err) {
			console.error('[ThreadView] Failed to send reply', err);
			throw err;
		}
	};

	// Reaction mutations (add / remove)
	// OPTIMIZATION: Target invalidation to minimize refetches
	// - For parent message reactions: invalidate parent message only
	// - For reply reactions: invalidate reply message + replies list
	// - REMOVED: channel message list invalidation (too expensive)
	// See: frontend/apps/web/docs/REACTION-SSE-OPTIMIZATION.md
	const addReactionMutation = useMutation({
		mutationFn: async ({ messageId: targetMessageId, emoji }: { messageId: string; emoji: string }) => {
			const emojiCode = emojiToCode(emoji);
			return await addReaction({ messageId: targetMessageId, emojiCode });
		},
		onSuccess: (_, variables) => {
			const targetMessageId = variables.messageId;

			// Always invalidate the specific message that was reacted to
			queryClient.invalidateQueries({ queryKey: ['message', targetMessageId] });

			// If this is a reply (not the parent), also invalidate the replies list
			// to update the thread view. The parent message ID is available in the closure.
			if (targetMessageId !== messageId) {
				queryClient.invalidateQueries({ queryKey: ['replies', messageId] });
			}

			// REMOVED: Full channel invalidation (too expensive)
			// queryClient.invalidateQueries({ queryKey: ['messages', channelId] });
		},
	});

	const removeReactionMutation = useMutation({
		mutationFn: async ({ messageId: targetMessageId, emoji }: { messageId: string; emoji: string }) => {
			const emojiCode = emojiToCode(emoji);
			return await removeReaction({ messageId: targetMessageId, emojiCode });
		},
		onSuccess: (_, variables) => {
			const targetMessageId = variables.messageId;

			// Always invalidate the specific message that was reacted to
			queryClient.invalidateQueries({ queryKey: ['message', targetMessageId] });

			// If this is a reply (not the parent), also invalidate the replies list
			// to update the thread view. The parent message ID is available in the closure.
			if (targetMessageId !== messageId) {
				queryClient.invalidateQueries({ queryKey: ['replies', messageId] });
			}

			// REMOVED: Full channel invalidation (too expensive)
			// queryClient.invalidateQueries({ queryKey: ['messages', channelId] });
		},
	});

	const handleReaction = async (targetMessageId: string, emoji: string, shouldRemove: boolean) => {
		if (shouldRemove) {
			await removeReactionMutation.mutateAsync({ messageId: targetMessageId, emoji });
		} else {
			await addReactionMutation.mutateAsync({ messageId: targetMessageId, emoji });
		}
	};

	const replies = repliesData?.replies || [];

	// Map parent message reactions to UI-friendly shape. Keep lightweight typed mapping until proto types regenerated.
	const mappedParentReactions = parentMessageData
		? (parentMessageData.reactions || []).map((r: { emojiCode?: string; count?: number; currentUserReacted?: boolean; firstReactedAt?: { seconds: bigint | string | number } }) => ({
			emoji: codeToEmoji(r.emojiCode || ''),
			count: r.count || 0,
			hasReacted: r.currentUserReacted || false,
			firstReactedAt: r.firstReactedAt ? new Date(Number(r.firstReactedAt.seconds) * 1000) : undefined,
		}))
		: [];

	return (
		// Grow to fill the parent grid column vertically so inner virtualized list gets height
		<div className={`w-full flex-1 min-h-0 min-w-0 ${colors.bg.paper.className} ${colors.border.default.className} border-l flex flex-col animate-slide-in-right`}>
			{/* Header */}
			<div className={`h-12 px-4 ${colors.border.default.className} border-b flex items-center justify-between shrink-0`}>
				<Typography variant="subtitle2" className="font-semibold">
					Thread
				</Typography>
				<div className="flex items-center gap-1">
					<Tooltip title={copyLinkSuccess ? 'Copied!' : 'Copy thread link'}>
						<IconButton size="small" onClick={() => { void handleCopyThreadLink(); }} data-testid="thread-copy-link-btn">
							<span style={{ fontSize: 14 }}>🔗</span>
						</IconButton>
					</Tooltip>
					<IconButton size="small" onClick={onClose}>
						<span style={colors.text.secondary.style}>✕</span>
					</IconButton>
				</div>
			</div>			{/* Thread Content */}
			<div className="flex-1 flex flex-col min-h-0">
				{isLoadingParent ? (
					<Box className="flex justify-center p-4">
						<CircularProgress size={24} />
					</Box>
				) : parentMessageData ? (
					<>
						{/* Parent Message */}
						<div className={`${colors.bg.hover} ${colors.border.default.className} border-b shrink-0`}>
							<MessageItem
								id={parentMessageData.id!}
								channelId={channelId}
								authorName={parentMessageData.authorName || 'Unknown'}
								authorEmail={parentMessageData.authorEmail || ''}
								messageText={parentMessageData.messageText || ''}
								timestamp={
									parentMessageData.updatedAt
										? new Date(Number(parentMessageData.updatedAt.seconds) * 1000)
										: new Date()
								}
								reactions={mappedParentReactions}
								replyCount={parentMessageData.replyCount ?? 0}
								threadParticipantIds={parentMessageData.threadParticipantIds || []}
								lastReplyAt={parentMessageData.lastReplyAt ? new Date(Number(parentMessageData.lastReplyAt.seconds) * 1000) : undefined}
								onReact={(emoji: string, shouldRemove: boolean) => handleReaction(parentMessageData.id!, emoji, shouldRemove)}
							/>
						</div>

						<Divider />

						{/* Replies - using VirtualizedMessageList for auto-scroll */}
						<div className="flex-1 min-h-0">
							<VirtualizedMessageList
								messages={replies}
								channelId={channelId}
								parentMessageId={messageId}
								isLoading={isLoadingReplies}
								highlightedMessageId={highlightReplyId}
								listId={messageId}
								onReact={handleReaction}
								emptyMessage="No replies yet. Be the first to respond!"
								emptyIcon="💬"
							/>
						</div>
					</>
				) : (
					<Box className="p-4 text-center">
						<Typography variant="body2" color="error">
							Failed to load message
						</Typography>
					</Box>
				)}
			</div>

			{/* Reply Composer with typing indicator */}
			<div className="relative shrink-0">
				{/* Typing indicator appears above composer */}
				{typingUsers.length > 0 && (
					<div className={`px-3 py-2 ${colors.bg.hover} ${colors.border.default.className} border-t`}>
						<TypingIndicator
							channelId={channelId}
							parentMessageId={messageId}
							typingUsers={typingUsers}
						/>
					</div>
				)}
				<div className={`p-3 ${colors.border.default.className} border-t`}>
					<MessageComposer
						channelId={channelId}
						parentMessageId={messageId}
						placeholder="Reply in thread..."
						onSend={handleSendReply}
						disabled={false}
					/>
				</div>
			</div>
		</div>
	);
}
