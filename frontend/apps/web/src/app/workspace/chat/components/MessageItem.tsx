/**
 * Message Item Component
 * Individual message display with reactions, threading, and actions
 * 
 * Features:
 * - Author avatar, name, timestamp
 * - Message text with Markdown rendering
 * - Reactions display (emoji + count)
 * - Hover menu (Reply, React, More)
 * - @mention highlighting
 * - Reply count badge
 * - Message highlight effect for deep linking
 */

'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Avatar, IconButton, Typography, Menu, MenuItem, Tooltip, Button, Box, alpha } from '@mui/material';
import { type Theme, useTheme } from '@mui/material/styles';
import EmojiEmotionsIcon from '@mui/icons-material/EmojiEmotions';
import ReactionPicker from './ReactionPicker';
import { codeToEmoji, QUICK_REACTION_EMOJIS } from '../utils/emoji';
import MentionPreview from './MentionPreview';
import FileAttachment from './FileAttachment';
import VoiceMessagePlayer from './voice/VoiceMessagePlayer';
import { VoiceCallRecord, voiceCallOutcomeHintFromText } from './voice/VoiceCallRecord';
import { getAuthToken, getFileMetadataBatch } from 'apis';
import type { FileMetadata } from 'apis';
import { useAuthState } from '@/lib/auth/hooks';
import {
	extractFirstCanonicalResourceLink,
	getCanonicalLinkPreviewDisplay,
	removeCanonicalResourceLinksFromContent,
	splitTextByCanonicalResourceLinks,
	type CanonicalLinkPreviewDisplay,
	type CanonicalLinkPreview,
	type CanonicalPreviewResponse,
} from '@tech-office/links';

/**
 * FileAttachments Component
 * Batch fetches and displays multiple file attachments in a 4-column compact grid
 */
function FileAttachments({ fileIds }: { fileIds: string[] }) {
	const [filesMap, setFilesMap] = React.useState<Map<string, FileMetadata>>(new Map());
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const fileIdsKey = useMemo(() => fileIds.join(','), [fileIds]);
	const stableFileIds = useMemo(() => (fileIdsKey ? fileIdsKey.split(',') : []), [fileIdsKey]);

	React.useEffect(() => {
		let mounted = true;

		async function fetchFiles() {
			if (stableFileIds.length === 0) {
				setLoading(false);
				return;
			}

			try {
				setLoading(true);
				const { files } = await getFileMetadataBatch(stableFileIds);
				if (mounted) {
					const map = new Map<string, FileMetadata>();
					files.forEach(file => map.set(file.id, file));
					setFilesMap(map);
				}
			} catch (err) {
				console.error('[FileAttachments] Failed to fetch files:', err);
				if (mounted) {
					setError(err instanceof Error ? err.message : 'Failed to load files');
				}
			} finally {
				if (mounted) {
					setLoading(false);
				}
			}
		}

		fetchFiles();

		return () => {
			mounted = false;
		};
	}, [stableFileIds]);

	if (loading) {
		return <Box sx={{ padding: 1 }}>Loading files...</Box>;
	}

	if (error) {
		return <Box sx={{ padding: 1, color: 'error.main' }}>Failed to load files</Box>;
	}

	if (filesMap.size === 0) {
		return null;
	}

	return (
		<Box
			sx={{
				display: 'grid',
				gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
				gap: 1,
				marginTop: 1,
				maxWidth: '100%',
			}}
		>
			{stableFileIds.map(fileId => {
				const file = filesMap.get(fileId);
				if (!file) return null;
				return (
					<FileAttachment
						key={fileId}
						fileId={fileId}
						filename={file.originalFilename}
						validationStatus={file.validationStatus}
						validationMessage={file.validationMessage}
					/>
				);
			})}
		</Box>
	);
}

interface VoiceTimelineMetadata {
	callId?: string;
	voiceMessageId?: string;
	durationMs?: number | string;
	mimeType?: string;
	waveformPeaks?: number[];
	sizeBytes?: number | string;
	outcome?: string;
	status?: string;
	state?: string;
	startedAt?: string;
	endedAt?: string;
	participantCount?: number | string;
	recordingStatus?: string;
	transcriptStatus?: string;
}

function parseTimelineMetadata(metadataJson?: string): VoiceTimelineMetadata | null {
	if (!metadataJson) {
		return null;
	}
	try {
		const parsed = JSON.parse(metadataJson) as VoiceTimelineMetadata;
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

function metadataWaveformPeaks(metadata: VoiceTimelineMetadata | null): number[] | null {
	const peaks = metadata?.waveformPeaks;
	if (!Array.isArray(peaks)) {
		return null;
	}
	return peaks.filter((peak) => Number.isFinite(peak));
}

function CanonicalPreviewCard({ display }: { display: CanonicalLinkPreviewDisplay }) {
	return (
		<Box
			data-testid="canonical-link-preview-card"
			component="a"
			href={display.href}
			sx={(theme) => ({
				display: 'block',
				mt: 1.5,
				px: 1.5,
				py: 1.25,
				borderRadius: 2,
				border: '1px solid',
				borderColor: alpha(theme.palette.primary.main, 0.18),
				backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.05),
				textDecoration: 'none',
				transition: 'border-color 120ms ease, background-color 120ms ease',
				'&:hover': {
					borderColor: alpha(theme.palette.primary.main, 0.4),
					backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.09),
				},
			})}
		>
			<Typography variant="caption" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'primary.main', fontWeight: 700 }}>
				{display.badge}
			</Typography>
			<Typography variant="subtitle2" sx={{ mt: 0.5, fontWeight: 700, color: 'text.primary' }}>
				{display.title}
			</Typography>
			{display.subtitle ? (
				<Typography variant="body2" sx={{ mt: 0.25, color: 'text.secondary' }}>
					{display.subtitle}
				</Typography>
			) : null}
		</Box>
	);
}

interface MessageItemProps {
	id: string;
	channelId: string; // Required for copy link functionality
	parentMessageId?: string; // For thread replies
	authorName: string;
	authorEmail: string;
	authorAvatar?: string;
	messageText: string;
	timestamp: Date;
	isHighlighted?: boolean;
	replyCount?: number;
	threadParticipantIds?: string[]; // Employee IDs who replied to this message
	lastReplyAt?: Date; // Timestamp of most recent reply
	reactions?: Array<{ emoji: string; count: number; hasReacted: boolean; firstReactedAt?: Date }>;
	fileIds?: string[]; // File attachment IDs from files.file_metadata table
	messageKind?: string;
	systemEventType?: string;
	metadataJson?: string;
	deliveryState?: 'sending' | 'failed';
	deliveryError?: string;
	onRetry?: () => void;
	onReply?: () => void;
	onReact?: (emoji: string, shouldRemove: boolean) => void; // Pass emoji and whether to add/remove
	onEdit?: () => void;
	onDelete?: () => void;
}

export default function MessageItem({
	id,
	channelId,
	parentMessageId,
	authorName,
	authorEmail,
	authorAvatar,
	messageText,
	timestamp,
	isHighlighted = false,
	replyCount = 0,
	threadParticipantIds = [],
	lastReplyAt,
	reactions = [],
	fileIds = [],
	messageKind,
	systemEventType,
	metadataJson,
	deliveryState,
	deliveryError,
	onRetry,
	onReply,
	onReact,
	onEdit,
	onDelete,
}: MessageItemProps) {
	const { user } = useAuthState();
	const [isHovered, setIsHovered] = useState(false);
	const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);
	const [copyLinkSuccess, setCopyLinkSuccess] = useState(false);
	const [reactionPickerAnchor, setReactionPickerAnchor] = useState<null | HTMLElement>(null);
	// Local state to control the visual pulse animation so it self-expires
	// instead of relying solely on the parent prop. This prevents a stuck
	// blinking state when navigating between threads/pages.
	const [showPulse, setShowPulse] = useState<boolean>(isHighlighted);
	const pulseTimeoutRef = useRef<number | null>(null);

	// Mention preview state
	const [mentionAnchor, setMentionAnchor] = useState<HTMLElement | null>(null);
	const [mentionAnchorPosition, setMentionAnchorPosition] = useState<{ top: number; left: number } | null>(null);
	const [mentionData, setMentionData] = useState<{ id: string; type: 'employee' | 'department'; label: string } | null>(null);
	const messageContainerRef = useRef<HTMLDivElement | null>(null);

	const theme = useTheme();
	const mentionId = mentionData?.id;
	const canonicalLink = useMemo(() => extractFirstCanonicalResourceLink(messageText), [messageText]);
	const currentMembership = useMemo(
		() => user?.organizations.find((organization) => organization.organizationId === user.organizationId) ?? user?.organizations[0],
		[user]
	);
	const [canonicalPreview, setCanonicalPreview] = useState<CanonicalLinkPreview | null>(null);
	const [canonicalPreviewLoaded, setCanonicalPreviewLoaded] = useState(false);
	const canonicalPreviewDisplay = useMemo(
		() => getCanonicalLinkPreviewDisplay(canonicalPreview, canonicalPreviewLoaded ? canonicalLink : null),
		[canonicalLink, canonicalPreview, canonicalPreviewLoaded]
	);
	const isHtmlMessage = useMemo(() => /<[a-z][\s\S]*>/i.test(messageText), [messageText]);
	const displayMessageText = useMemo(
		() => canonicalPreviewDisplay ? removeCanonicalResourceLinksFromContent(messageText) : messageText,
		[canonicalPreviewDisplay, messageText]
	);
	const timelineMetadata = useMemo(() => parseTimelineMetadata(metadataJson), [metadataJson]);
	const plainTextSegments = useMemo(() => splitTextByCanonicalResourceLinks(displayMessageText), [displayMessageText]);
	const hasDisplayMessageText = displayMessageText.trim().length > 0;
	const isVoiceMessage = (messageKind === 'voice' || messageText.trim() === 'Voice message') && fileIds.length === 1;
	const voiceCallOutcomeHint = voiceCallOutcomeHintFromText(displayMessageText);
	const isVoiceCallRecord = Boolean(
		voiceCallOutcomeHint ||
		(messageKind === 'system' && systemEventType?.startsWith('voice_call_') && timelineMetadata?.callId)
	);
	const isLocalOnly = Boolean(deliveryState);

	// Shared compact button style (uses theme tokens)
	const compactButtonSx = (t: Theme, hasReacted = false, compact = false) => ({
		// Start without a visible border so controls don't look 'disabled'.
		// Show a clear border and subtle lift on hover/focus to indicate
		// interactivity and focus state.
		border: '1px solid',
		borderColor: hasReacted ? alpha(t.palette.primary.main, 0.3) : alpha(t.palette.divider, 0.2),
		borderRadius: '4px',
		backgroundColor: hasReacted ? alpha(t.palette.primary.main, 0.08) : alpha(t.palette.action.hover, 0.02),
		// Keep compact size but add a little horizontal breathing room so counts
		// don't sit flush to the border. Also use an internal gap between
		// children (emoji + count) to ensure consistent spacing.
		minWidth: compact ? t.spacing(4) : 'auto',
		height: t.spacing(3.5),
		px: compact ? t.spacing(0.5) : t.spacing(0.75),
		py: compact ? 0 : t.spacing(0.5),
		fontSize: compact ? '0.95rem' : '0.85rem',
		display: 'inline-flex',
		alignItems: 'center',
		gap: compact ? t.spacing(0.5) : t.spacing(0.5),
		color: hasReacted ? t.palette.primary.main : t.palette.text.primary,
		transition: 'background-color 120ms ease, border-color 120ms ease',
		// Hover and keyboard focus styles
		'&:hover, &:focus-visible': {
			backgroundColor: hasReacted ? alpha(t.palette.primary.main, 0.15) : alpha(t.palette.action.hover, 0.12),
			borderColor: hasReacted ? t.palette.primary.main : t.palette.divider,
		},
		// Reduce visual noise when disabled/hidden but keep keyboard focus visible
		'&.Mui-disabled': {
			opacity: 0.6,
		},
	});
	// Quick reaction shortcuts surfaced on hover
	const quickReactions = useMemo(() => [...QUICK_REACTION_EMOJIS], []);

	// Local, optimistic reactions state. We mirror incoming `reactions`
	// but allow immediate UI updates when the current user reacts so
	// counts increment/decrement instantly while the server round-trip
	// happens. Keep this in sync with prop updates.
	// Helper: normalize incoming reaction payloads from backend to the
	// component's internal shape. Backend may provide fields like
	// `emojiCode`, `currentUserReacted`, and `firstReactedAt` as strings.
	// We convert `firstReactedAt` to Date and map emoji codes to glyphs
	// using `DEFAULT_REACTION_EMOJIS` so sorting and rendering behave
	// deterministically.
	const normalizeReactions = useCallback((incoming: Array<Record<string, unknown>> | undefined): Array<{ emoji: string; count: number; hasReacted: boolean; firstReactedAt?: Date }> => {
		if (!incoming) return [];
		return incoming.map((r: Record<string, unknown>) => {
			// Accept multiple possible property names and fall back safely
			const code = String(r.emoji ?? r.emojiCode ?? r.code ?? r.name ?? '');
			// If code is in :emoji_code: format, convert to Unicode emoji, otherwise use as-is
			const emojiStr: string = code.startsWith(':') && code.endsWith(':') ? codeToEmoji(code) : code;
			const count = Number(r.count ?? 0);
			const hasReacted = Boolean(r.hasReacted ?? r.currentUserReacted ?? false);
			const firstReactedAt = r.firstReactedAt ? new Date(r.firstReactedAt as string) : undefined;
			return { emoji: emojiStr, count, hasReacted, firstReactedAt };
		});
	}, []);

	// Memoize normalized reactions to prevent unnecessary recalculations
	const normalizedReactions = useMemo(() => normalizeReactions(reactions), [reactions, normalizeReactions]);

	const [localReactions, setLocalReactions] = useState(() => normalizedReactions);

	useEffect(() => {
		// Only update if reactions have actually changed (deep comparison by stringifying)
		const newNormalized = normalizedReactions;
		const currentStr = JSON.stringify(localReactions);
		const newStr = JSON.stringify(newNormalized);
		if (currentStr !== newStr) {
			setLocalReactions(newNormalized);
		}
	}, [normalizedReactions, localReactions]);

	const reactionMap = useMemo(() => {
		const map: Record<string, { count: number; hasReacted: boolean }> = {};
		for (const reaction of localReactions) {
			map[reaction.emoji] = {
				count: reaction.count,
				hasReacted: reaction.hasReacted,
			};
		}
		return map;
	}, [localReactions]);

	// Maintain a stable, client-side ordering for reactions. Prefer server
	// provided `firstReactedAt` if available; otherwise fall back to insertion
	// ordering recorded locally so optimistic adds preserve UI position.
	const reactionOrderRef = useRef<Record<string, number>>({});
	const orderCounterRef = useRef<number>(0);

	useEffect(() => {
		// Assign an insertion index for any emoji we haven't seen yet. We only
		// need this when server doesn't provide `firstReactedAt` for ordering.
		localReactions.forEach((r) => {
			if (!(r.emoji in reactionOrderRef.current)) {
				reactionOrderRef.current[r.emoji] = orderCounterRef.current++;
			}
		});
	}, [localReactions]);

	const sortedReactions = useMemo(() => {
		// If server provides firstReactedAt values (as Date objects after
		// normalization), sort by that ascending (older reactions first).
		const serverHasTimestamps = localReactions.some(r => r.firstReactedAt instanceof Date);
		if (serverHasTimestamps) {
			return [...localReactions].sort((a, b) => {
				if (a.firstReactedAt && b.firstReactedAt) return a.firstReactedAt.getTime() - b.firstReactedAt.getTime();
				if (a.firstReactedAt) return -1;
				if (b.firstReactedAt) return 1;
				// fallback deterministic
				return a.emoji.localeCompare(b.emoji);
			});
		}
		// Fallback: use insertion indices to preserve optimistic UI ordering
		return [...localReactions].sort((a, b) => {
			const ia = reactionOrderRef.current[a.emoji];
			const ib = reactionOrderRef.current[b.emoji];
			if (ia === undefined && ib === undefined) return 0;
			if (ia === undefined) return 1;
			if (ib === undefined) return -1;
			return ia - ib;
		});
	}, [localReactions]);

	useEffect(() => {
		if (!canonicalLink) {
			setCanonicalPreview(null);
			setCanonicalPreviewLoaded(false);
			return;
		}
		let cancelled = false;
		const previewUrl = canonicalLink;
		setCanonicalPreviewLoaded(false);

		async function loadPreview() {
			try {
				const token = await getAuthToken();
				const response = await fetch(
					`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/preview?url=${encodeURIComponent(previewUrl)}`,
					{
						headers: token ? { Authorization: `Bearer ${token}` } : undefined,
						cache: 'no-store',
					}
				);
				if (!response.ok) {
					if (!cancelled) {
						setCanonicalPreview(null);
						setCanonicalPreviewLoaded(true);
					}
					return;
				}
				const payload = (await response.json()) as CanonicalPreviewResponse;
				if (!cancelled) {
					setCanonicalPreview(payload.preview ?? null);
					setCanonicalPreviewLoaded(true);
				}
			} catch {
				if (!cancelled) {
					setCanonicalPreview(null);
					setCanonicalPreviewLoaded(true);
				}
			}
		}

		void loadPreview();
		return () => {
			cancelled = true;
		};
	}, [canonicalLink]);

	// Copy message link to clipboard
	const handleCopyLink = async () => {
		try {
			if (!currentMembership?.organizationSubdomain) {
				throw new Error('Current organization subdomain is unavailable.');
			}

			const target = parentMessageId
				? {
						tenantKey: currentMembership.organizationSubdomain,
						resourceType: 'thread',
						resourceId: parentMessageId,
						anchorType: 'message',
						anchorId: id,
					}
				: {
						tenantKey: currentMembership.organizationSubdomain,
						resourceType: 'chat',
						resourceId: channelId,
						anchorType: 'message',
						anchorId: id,
					};

			const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/generate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					target,
				}),
			});

			const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string; error?: string } | null;
			if (!response.ok || !payload?.canonicalUrl) {
				throw new Error(payload?.error ?? 'Failed to generate a canonical link.');
			}

			await navigator.clipboard.writeText(payload.canonicalUrl);
			setCopyLinkSuccess(true);
			setTimeout(() => setCopyLinkSuccess(false), 2000);
		} catch (error) {
			console.error('Failed to copy canonical link:', error);
		}
	};

	// Handle emoji selection from picker
	const handleEmojiSelect = (emoji: string) => {
		// Optimistically update local state so the UI reflects the change
		// immediately. Then call the parent handler which will persist the
		// change and eventually sync back via props.
		const existing = localReactions.find(r => r.emoji === emoji);
		if (existing) {
			// Toggle user's reaction presence
			const shouldRemove = existing.hasReacted;
			setLocalReactions((prev) => {
				return prev.map((r) => {
					if (r.emoji !== emoji) return r;
					const newCount = shouldRemove ? Math.max(0, r.count - 1) : r.count + 1;
					return { ...r, count: newCount, hasReacted: !shouldRemove };
				}).filter(r => r.count > 0);
			});
			if (onReact) onReact(emoji, shouldRemove);
		} else {
			// New emoji added - set firstReactedAt to now for optimistic ordering
			setLocalReactions((prev) => [...prev, { emoji, count: 1, hasReacted: true, firstReactedAt: new Date() }]);
			if (onReact) onReact(emoji, false);
		}
		setReactionPickerAnchor(null);
	};

	// Handle reaction button click (on existing reaction)
	const handleReactionClick = (emoji: string, hasReacted: boolean) => {
		// Optimistically update local reactions
		setLocalReactions((prev) => {
			const existing = prev.find(r => r.emoji === emoji);
			if (!existing) {
				// Add as first reaction (rare path when UI shows quick button for emoji not in list)
				return [...prev, { emoji, count: 1, hasReacted: true, firstReactedAt: new Date() }];
			}
			// Toggle
			const shouldRemove = hasReacted;
			const updated = prev.map((r) => {
				if (r.emoji !== emoji) return r;
				const newCount = shouldRemove ? Math.max(0, r.count - 1) : r.count + 1;
				return { ...r, count: newCount, hasReacted: !shouldRemove };
			}).filter(r => r.count > 0);
			return updated;
		});

		if (onReact) {
			onReact(emoji, hasReacted); // parent will persist the change
		}
	};

	// Format last-reply display according to rules:
	// - within 1 minute => "just now"
	// - same day => local time (HH:MM)
	// - yesterday => "Yesterday HH:MM"
	// - same week => weekday name + time (e.g., "Monday 14:05")
	// - otherwise => YYYY-MM-DD HH:MM
	const formatLastReplyTime = (date?: Date) => {
		if (!date) return '';
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();

		// within 1 minute
		if (Math.abs(diffMs) < 60 * 1000) return 'just now';

		const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
		const timeStr = timeFormatter.format(date);

		// start of today (local)
		const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

		if (date >= startOfToday) {
			// same day: show time only
			return `today at ${timeStr}`;
		}

		if (date >= startOfYesterday) {
			// yesterday
			return `yesterday at ${timeStr}`;
		}

		// start of week (Sunday as start)
		const startOfWeek = new Date(startOfToday);
		startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

		if (date >= startOfWeek) {
			const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(date);
			return `${weekday} ${timeStr}`;
		}

		// fallback: YYYY-MM-DD HH:MM
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${d} ${timeStr}`;
	};

	// Format timestamp
	const formattedTime = formatLastReplyTime(timestamp);
	// Message text now contains server-sanitized HTML
	// Safe to render with dangerouslySetInnerHTML because backend strips XSS vectors
	// Note: Backend sanitizer allows: b, strong, i, em, u, code, pre, a[href], ul, ol, li, p, br


	useEffect(() => {
		if (isHighlighted) {
			// start the pulse and clear it after 3s
			setShowPulse(true);
			if (pulseTimeoutRef.current) {
				window.clearTimeout(pulseTimeoutRef.current);
			}
			pulseTimeoutRef.current = window.setTimeout(() => {
				setShowPulse(false);
				pulseTimeoutRef.current = null;
			}, 3000);
		} else {
			// if parent cleared highlight, stop pulse immediately
			if (pulseTimeoutRef.current) {
				window.clearTimeout(pulseTimeoutRef.current);
				pulseTimeoutRef.current = null;
			}
			setShowPulse(false);
		}
		return () => {
			if (pulseTimeoutRef.current) {
				window.clearTimeout(pulseTimeoutRef.current);
				pulseTimeoutRef.current = null;
			}
		};
	}, [isHighlighted]);

	// Attach click handlers to mention spans for preview popup
	useEffect(() => {
		const container = messageContainerRef.current;
		if (!container) return;

		const handleMentionClick = (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			// Check if clicked element or its parent is a mention span
			const mentionSpan = target.closest('span[data-type="mention"]') as HTMLElement | null;
			if (!mentionSpan) return;

			event.preventDefault();
			event.stopPropagation();

			const mentionId = mentionSpan.getAttribute('data-id');
			const mentionLabel = mentionSpan.getAttribute('data-label');
			if (!mentionId || !mentionLabel) return;

			// Determine mention type from ID format
			const type = mentionId.startsWith('dept-') ? 'department' : 'employee';
			setMentionData({ id: mentionId, type, label: mentionLabel });
			// Use the actual clicked element to ensure accurate positioning
			const rect = mentionSpan.getBoundingClientRect();
			setMentionAnchor(mentionSpan);
			setMentionAnchorPosition({
				top: rect.bottom + window.scrollY,
				left: rect.left + window.scrollX,
			});
		};

		container.addEventListener('click', handleMentionClick);
		return () => {
			container.removeEventListener('click', handleMentionClick);
		};
	}, [messageText]);

	const updateMentionAnchorFromDom = useCallback(() => {
		if (!mentionId) {
			setMentionAnchor(null);
			setMentionAnchorPosition(null);
			return;
		}

		const container = messageContainerRef.current;
		if (!container) return;

		const selector = `span[data-type="mention"][data-id="${mentionId}"]`;
		const refreshedAnchor = container.querySelector(selector) as HTMLElement | null;
		if (!refreshedAnchor) {
			setMentionAnchor(null);
			setMentionAnchorPosition(null);
			return;
		}

		const rect = refreshedAnchor.getBoundingClientRect();
		setMentionAnchor((prev) => (prev === refreshedAnchor ? prev : refreshedAnchor));
		setMentionAnchorPosition((prev) => {
			const next = {
				top: rect.bottom + window.scrollY,
				left: rect.left + window.scrollX,
			};
			if (prev && prev.top === next.top && prev.left === next.left) {
				return prev;
			}
			return next;
		});
	}, [mentionId]);

	useEffect(() => {
		if (!mentionData) {
			setMentionAnchor(null);
			setMentionAnchorPosition(null);
			return;
		}

		updateMentionAnchorFromDom();
		const handleReposition = () => updateMentionAnchorFromDom();
		window.addEventListener('scroll', handleReposition, true);
		window.addEventListener('resize', handleReposition);
		return () => {
			window.removeEventListener('scroll', handleReposition, true);
			window.removeEventListener('resize', handleReposition);
		};
	}, [mentionData, updateMentionAnchorFromDom]);

	const handleCloseMentionPreview = () => {
		setMentionAnchor(null);
		setMentionAnchorPosition(null);
		setMentionData(null);
	};

	const hoverBgColor = showPulse
		? (theme.palette.mode === 'dark' ? alpha(theme.palette.warning.main, 0.15) : alpha(theme.palette.warning.light, 0.3))
		: alpha(theme.palette.action.hover, 0.04);

	return (
		<Box
			className={`group px-4 py-2 transition-colors ${showPulse ? 'animate-pulse' : ''}`}
			sx={{
				backgroundColor: showPulse
					? (theme.palette.mode === 'dark' ? alpha(theme.palette.warning.main, 0.15) : alpha(theme.palette.warning.light, 0.3))
					: 'transparent',
				'&:hover': {
					backgroundColor: hoverBgColor
				}
			}}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<div className="flex gap-3">
				{/* Author Avatar */}
				<Tooltip title={authorEmail} arrow>
					<Avatar
						src={authorAvatar}
						alt={authorName}
						sx={{ width: 36, height: 36 }}
					>
						{authorName[0]?.toUpperCase()}
					</Avatar>
				</Tooltip>

				{/* Message Content */}
				<div className="flex-1 min-w-0">
					{/* Header: Author + Timestamp */}
					<div className="flex items-baseline gap-2 mb-1">
						<Typography variant="subtitle2" sx={{ fontWeight: 600, color: theme.palette.text.primary }}>
							{authorName}
						</Typography>
						<Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
							{formattedTime}
						</Typography>
					</div>

					{/* Message Text (Sanitized HTML from Backend or canonical-linkified plain text) */}
					{hasDisplayMessageText && !isVoiceCallRecord && !isVoiceMessage ? (
						<Typography
							ref={messageContainerRef}
							variant="body2"
							component="div"
							className="prose prose-sm max-w-none"
							sx={{
								color: theme.palette.text.primary,
								position: 'relative',
								whiteSpace: isHtmlMessage ? undefined : 'pre-wrap',
								wordBreak: 'break-word',
								'& span[data-type="mention"]': {
									cursor: 'pointer',
									color: theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main,
									backgroundColor: theme.palette.mode === 'dark'
										? alpha(theme.palette.primary.main, 0.15)
										: alpha(theme.palette.primary.main, 0.08),
									padding: '1px 4px',
									borderRadius: '3px',
									fontWeight: 500,
									textDecoration: 'none',
									display: 'inline',
									'&:hover': {
										backgroundColor: theme.palette.mode === 'dark'
											? alpha(theme.palette.primary.main, 0.25)
											: alpha(theme.palette.primary.main, 0.12),
										textDecoration: 'underline',
									},
								},
							}}
						>
							{isHtmlMessage ? (
								<span dangerouslySetInnerHTML={{ __html: displayMessageText }} />
							) : (
								plainTextSegments.map((segment, index) => {
									if (segment.kind === 'link') {
										return (
											<Box
												key={`${id}-canonical-link-${index}`}
												component="a"
												href={segment.value}
												sx={{ color: 'primary.main', textDecoration: 'underline' }}
											>
												{segment.value}
											</Box>
										);
									}
									return <React.Fragment key={`${id}-text-${index}`}>{segment.value}</React.Fragment>;
								})
							)}
						</Typography>
					) : null}
					{canonicalPreviewDisplay ? <CanonicalPreviewCard display={canonicalPreviewDisplay} /> : null}

					{isVoiceCallRecord ? (
						<VoiceCallRecord
							label={displayMessageText.trim() || 'Voice call'}
							callId={timelineMetadata?.callId}
							metadata={timelineMetadata}
							outcomeHint={voiceCallOutcomeHint ?? undefined}
						/>
					) : isVoiceMessage ? (
						<VoiceMessagePlayer
							fileId={fileIds[0]}
							durationMs={timelineMetadata?.durationMs}
							waveformPeaks={metadataWaveformPeaks(timelineMetadata)}
						/>
					) : fileIds && fileIds.length > 0 ? (
						<FileAttachments fileIds={fileIds} />
					) : null}
					{deliveryState ? (
						<div className="flex items-center gap-2 mt-2">
							<Typography
								variant="caption"
								sx={{
									color:
										deliveryState === 'failed'
											? theme.palette.error.main
											: theme.palette.text.secondary,
									fontWeight: deliveryState === 'failed' ? 600 : 400,
								}}
							>
								{deliveryState === 'failed'
									? deliveryError || 'Failed to send'
									: 'Sending...'}
							</Typography>
							{deliveryState === 'failed' && onRetry ? (
								<Button size="small" onClick={onRetry} sx={{ minWidth: 'auto', px: 1, textTransform: 'none' }}>
									Retry
								</Button>
							) : null}
						</div>
					) : null}
					{sortedReactions.length > 0 && (
						<div className="flex gap-1 mt-2 flex-wrap">
							{sortedReactions.map((reaction) => (
								<Tooltip
									key={`tt-${reaction.emoji}`}
									title={`${reaction.hasReacted ? 'Remove' : 'Add'} ${reaction.emoji} — ${reaction.count}`}
									arrow
								>
									<IconButton
										size="small"
										aria-pressed={reaction.hasReacted}
										aria-label={`${reaction.hasReacted ? 'Remove' : 'Add'} reaction ${reaction.emoji}. ${reaction.count} total`}
										onClick={() => handleReactionClick(reaction.emoji, reaction.hasReacted)}
										className="text-sm"
										sx={(t) => compactButtonSx(t, reaction.hasReacted, true)}
									>
										<span aria-hidden style={{ marginRight: 6 }}>{reaction.emoji}</span>
										<Typography component="span" variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.65rem' }} aria-hidden>
											{reaction.count}
										</Typography>
										<span className="sr-only">{reaction.hasReacted ? 'You reacted' : 'Not reacted'}</span>
									</IconButton>
								</Tooltip>
							))}
							<Tooltip title="Open reaction picker" arrow>
								<IconButton
									size="small"
									aria-label="Open reaction picker"
									aria-haspopup="dialog"
									onClick={(e) => setReactionPickerAnchor(e.currentTarget)}
									sx={(t) => compactButtonSx(t, false, true)}
								>
									<EmojiEmotionsIcon fontSize="small" sx={{ color: 'inherit' }} />
								</IconButton>
							</Tooltip>
						</div>
					)}

					{/* Thread Reply Information */}
					{replyCount > 0 && (
						<Button
							variant="text"
							size="small"
							onClick={onReply}
							sx={{
								mt: 2,
								display: 'flex',
								alignItems: 'center',
								gap: 1,
								fontSize: '0.875rem',
								color: theme.palette.primary.main,
								textTransform: 'none',
								'&:hover': { textDecoration: 'underline', backgroundColor: 'transparent' },
							}}
						>
							{/* Show avatars of thread participants (max 3) */}
							{threadParticipantIds.length > 0 && (
								<div className="flex -space-x-2">
									{threadParticipantIds.slice(0, 3).map((participantId, index) => (
										<Avatar
											key={participantId}
											sx={{ width: 20, height: 20, border: '1px solid white', fontSize: '0.75rem', bgcolor: theme.palette.grey[400] }}
										>
											{/* Show first letter - in real app, fetch participant details */}
											{String.fromCharCode(65 + index)}
										</Avatar>
									))}
								</div>
							)}
							<span>
								{replyCount} {replyCount === 1 ? 'reply' : 'replies'}
								{lastReplyAt && (
									<Typography
										component="span"
										variant="caption"
										sx={{ color: theme.palette.text.secondary, ml: 1, fontSize: '0.7rem', lineHeight: 1 }}
									>
										• Last reply {formatLastReplyTime(lastReplyAt)}
									</Typography>
								)}
							</span>
						</Button>
					)}
				</div>

				{/* Hover Actions */}
				{isHovered && !isLocalOnly && (
					<div className="flex gap-1 items-start opacity-0 group-hover:opacity-100 transition-opacity">
						{quickReactions.map((emoji) => {
							const quickReaction = reactionMap[emoji];
							const hasReacted = quickReaction?.hasReacted ?? false;
							return (
								<Tooltip key={`qt-${emoji}`} title={hasReacted ? 'Remove reaction' : 'Add quick reaction'} arrow>
									<IconButton
										size="small"
										onClick={() => handleReactionClick(emoji, hasReacted)}
										aria-label={`${hasReacted ? 'Remove' : 'Add'} reaction ${emoji}`}
										sx={(t) => compactButtonSx(t, hasReacted, true)}
									>
										<span style={{ fontSize: '0.95rem' }}>{emoji}</span>
									</IconButton>
								</Tooltip>
							);
						})}
						<Tooltip title="Open reaction picker" arrow>
							<IconButton
								size="small"
								onClick={(e) => setReactionPickerAnchor(e.currentTarget)}
								aria-label="Open reaction picker"
								sx={(t) => compactButtonSx(t, false, true)}
							>
								<EmojiEmotionsIcon fontSize="small" />
							</IconButton>
						</Tooltip>
						<Tooltip title="Reply in thread" arrow>
							<IconButton size="small" onClick={onReply} aria-label="Reply in thread" sx={(t) => compactButtonSx(t, false, true)}>
								<span className="text-base" style={{ fontSize: '0.95rem' }}>💬</span>
							</IconButton>
						</Tooltip>
						<Tooltip title={copyLinkSuccess ? 'Canonical link copied!' : 'Copy canonical link'} arrow>
							<IconButton
								size="small"
								onClick={handleCopyLink}
								aria-label={copyLinkSuccess ? 'Canonical link copied' : 'Copy canonical link'}
								sx={(t) => ({
									...compactButtonSx(t, false, true),
									color: copyLinkSuccess ? t.palette.success.main : 'inherit',
								})}
							>
								<span className="text-base" style={{ fontSize: '0.95rem' }}>{copyLinkSuccess ? '✓' : '🔗'}</span>
							</IconButton>
						</Tooltip>
						<Tooltip title="More actions" arrow>
							<IconButton
								size="small"
								onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
								aria-label="More actions"
								sx={(t) => compactButtonSx(t, false, true)}
							>
								<span className="text-base" style={{ fontSize: '0.95rem' }}>⋮</span>
							</IconButton>
						</Tooltip>
					</div>
				)}

				{/* More Menu */}
				{!isLocalOnly ? (
					<>
						<Menu
							anchorEl={moreMenuAnchor}
							open={Boolean(moreMenuAnchor)}
							onClose={() => setMoreMenuAnchor(null)}
						>
							<MenuItem onClick={onEdit}>Edit message</MenuItem>
							<MenuItem onClick={onDelete} sx={{ color: theme.palette.error.main }}>
								Delete message
							</MenuItem>
						</Menu>

						<ReactionPicker
							open={Boolean(reactionPickerAnchor)}
							anchorEl={reactionPickerAnchor}
							onClose={() => setReactionPickerAnchor(null)}
							onSelect={(emoji) => handleEmojiSelect(emoji)}
						/>
					</>
				) : null}

				{/* Mention Preview Popup */}
				{mentionData && (
					<MentionPreview
						anchorEl={mentionAnchor}
						anchorPosition={mentionAnchorPosition}
						mentionType={mentionData.type}
						mentionLabel={mentionData.label}
						onClose={handleCloseMentionPreview}
					/>
				)}
			</div>
		</Box>
	);
}
