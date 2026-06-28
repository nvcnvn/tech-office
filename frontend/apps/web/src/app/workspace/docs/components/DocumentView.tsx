/**
 * DocumentView Component
 * Main document viewer with title, content, and toolbar
 * 
 * Features:
 * - View document content (JSON rendered as HTML)
 * - Edit mode toggle
 * - Status indicator (active/outdated/archived)
 * - Quick actions (history, comments, follow)
 */

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
	Box,
	Typography,
	IconButton,
	Tooltip,
	Chip,
	CircularProgress,
	Alert,
	Breadcrumbs,
	Link,
	Divider,
	Menu,
	MenuItem,
	ListItemIcon,
	ListItemText,
} from '@mui/material';
import {
	History as HistoryIcon,
	Comment as CommentIcon,
	BookmarkBorder as FollowIcon,
	Bookmark as FollowingIcon,
	MoreVert as MoreIcon,
	Edit as EditIcon,
	Delete as DeleteIcon,
	Archive as ArchiveIcon,
	Share as ShareIcon,
	FormatQuote as CitationsIcon,
	Notifications as NotificationsIcon,
	NotificationsOff as NotificationsOffIcon,
	AlternateEmail as AlternateEmailIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	getDocument,
	resolveSlug,
	followDocument,
	unfollowDocument,
	updateDocumentStatus,
	deleteDocument,
	listIncomingCitations,
	getResourceSubscription,
	setResourceSubscriptionPreference,
	SubscriptionPreferenceLevel,
	type DocumentStatus,
} from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import { useAuthState } from '@/lib/auth/hooks';
import DocumentEditor from './DocumentEditor';
import ReactionsBar from './ReactionsBar';
import CitationBanner from './CitationBanner';

interface DocumentViewProps {
	documentId?: string;
	documentSlug?: string;
	onOpenComments: () => void;
	onOpenHistory: () => void;
	onOpenCitations: () => void;
	onDocumentResolved?: (documentId: string) => void;
	onSlugResolved?: (documentSlug: string) => void;
}

export default function DocumentView({
	documentId,
	documentSlug,
	onOpenComments,
	onOpenHistory,
	onOpenCitations,
	onDocumentResolved,
	onSlugResolved,
}: DocumentViewProps) {
	const colors = useThemeColors();
	const router = useRouter();
	const searchParams = useSearchParams();
	const queryClient = useQueryClient();
	const { user } = useAuthState();
	const [isEditing, setIsEditing] = useState(false);
	const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
	const [prefMenuAnchor, setPrefMenuAnchor] = useState<HTMLElement | null>(null);
	const [copyLinkSuccess, setCopyLinkSuccess] = useState(false);

	const currentMembership = useMemo(
		() => user?.organizations.find((org) => org.organizationId === user.organizationId) ?? user?.organizations[0],
		[user]
	);

	// Resolve slug to ID if needed
	const { data: resolvedData } = useQuery({
		queryKey: ['docs', 'resolve', documentSlug],
		queryFn: () => resolveSlug(documentSlug!),
		enabled: !!documentSlug && !documentId,
		staleTime: 60000,
	});

	const effectiveId = documentId || resolvedData?.documentId;

	useEffect(() => {
		const shouldEdit = searchParams.get('edit') === '1';
		setIsEditing(shouldEdit);
	}, [effectiveId, searchParams]);

	// Notify parent of resolved ID
	useEffect(() => {
		if (effectiveId && onDocumentResolved) {
			onDocumentResolved(effectiveId);
		}
	}, [effectiveId, onDocumentResolved]);

	// Fetch document
	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ['docs', 'get', effectiveId],
		queryFn: () => getDocument({ id: effectiveId!, includeContent: true }),
		enabled: !!effectiveId,
		staleTime: 30000,
	});

	const document = data?.document;
	const isFollowing = data?.isFollowing || false;
	const hasAccess = data?.effectiveAccess !== 'none';

	// Fetch incoming citations for sidebar markers
	const { data: citationsData } = useQuery({
		queryKey: ['docs', 'incoming-citations', effectiveId],
		queryFn: () => listIncomingCitations(effectiveId!),
		enabled: !!effectiveId && !isEditing,
		staleTime: 60000, // Cache for 1 minute
	});

	const citedLineRanges = citationsData?.citedLineRanges || [];

	// Notify parent of resolved slug
	useEffect(() => {
		if (document?.slug && onSlugResolved) {
			onSlugResolved(document.slug);
		}
	}, [document?.slug, onSlugResolved]);

	// Follow mutation
	const followMutation = useMutation({
		mutationFn: () =>
			isFollowing
				? unfollowDocument(effectiveId!)
				: followDocument(effectiveId!),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs', 'get', effectiveId] });
			queryClient.invalidateQueries({ queryKey: ['notification', 'subscription', 'document', effectiveId] });
		},
	});

	// Subscription query for preference level
	const { data: subscriptionData } = useQuery({
		queryKey: ['notification', 'subscription', 'document', effectiveId],
		queryFn: () => getResourceSubscription({ resourceDomain: 'document', resourceId: effectiveId! }),
		enabled: !!effectiveId && isFollowing,
		staleTime: 30000,
	});

	const preferenceLevel = subscriptionData?.preferenceLevel ?? SubscriptionPreferenceLevel.ALL;

	// Preference mutation
	const prefMutation = useMutation({
		mutationFn: (level: number) =>
			setResourceSubscriptionPreference({
				resourceDomain: 'document',
				resourceId: effectiveId!,
				preferenceLevel: level,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['notification', 'subscription', 'document', effectiveId] });
			setPrefMenuAnchor(null);
		},
	});

	// Status mutation
	const statusMutation = useMutation({
		mutationFn: (status: DocumentStatus) =>
			updateDocumentStatus(effectiveId!, status),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs'] });
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: () => deleteDocument(effectiveId!),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs'] });
			router.push('/workspace/docs');
		},
	});

	const handleMenuClick = (e: React.MouseEvent<HTMLElement>) => {
		setMenuAnchor(e.currentTarget);
	};

	const handleMenuClose = () => {
		setMenuAnchor(null);
	};

	const handleCopyLink = async () => {
		try {
			if (!currentMembership?.organizationSubdomain || !effectiveId) {
				await navigator.clipboard.writeText(window.location.href);
				return;
			}
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/generate`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						target: {
							tenantKey: currentMembership.organizationSubdomain,
							resourceType: 'document',
							resourceId: effectiveId,
						},
					}),
				}
			);
			const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string } | null;
			if (response.ok && payload?.canonicalUrl) {
				await navigator.clipboard.writeText(payload.canonicalUrl);
			} else {
				await navigator.clipboard.writeText(window.location.href);
			}
			setCopyLinkSuccess(true);
			setTimeout(() => setCopyLinkSuccess(false), 2000);
		} catch {
			// silently ignore
		}
		handleMenuClose();
	};

	const handleStatusChange = (status: DocumentStatus) => {
		statusMutation.mutate(status);
		handleMenuClose();
	};

	const handleDelete = () => {
		if (confirm('Are you sure you want to delete this document?')) {
			deleteMutation.mutate();
		}
		handleMenuClose();
	};

	const getStatusColor = (status: DocumentStatus) => {
		switch (status) {
			case 'active':
				return 'success';
			case 'outdated':
				return 'warning';
			case 'archived':
				return 'default';
		}
	};

	if (isLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	if (error || !document) {
		return (
			<Box sx={{ p: 3 }}>
				<Alert severity="error">
					{error instanceof Error ? error.message : 'Failed to load document'}
				</Alert>
			</Box>
		);
	}

	if (!hasAccess) {
		return (
			<Box sx={{ p: 3 }}>
				<Alert severity="warning">
					You don&apos;t have access to this document.
				</Alert>
			</Box>
		);
	}

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				overflow: 'hidden',
			}}
		>
			{/* Toolbar */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 1,
					p: 2,
					borderBottom: 1,
					...colors.border.default.style,
				}}
			>
				{/* Breadcrumb */}
				{document.path.length > 0 && (
					<Breadcrumbs sx={{ flex: 1 }}>
						{document.path.map((ancestorId) => (
							<Link
								key={ancestorId}
								component="button"
								underline="hover"
								onClick={() => router.push(`/workspace/docs?doc=${ancestorId}`)}
								sx={colors.text.secondary.style}
							>
								...
							</Link>
						))}
						<Typography sx={colors.text.primary.style}>
							{document.title}
						</Typography>
					</Breadcrumbs>
				)}

				{document.path.length === 0 && (
					<Typography variant="h6" sx={{ flex: 1 }} noWrap>
						{document.title}
					</Typography>
				)}

				{/* Status chip */}
				<Chip
					label={document.status}
					size="small"
					color={getStatusColor(document.status)}
					variant="outlined"
				/>

				{/* Actions */}
				<Tooltip title={isFollowing ? 'Unfollow' : 'Follow'}>
					<IconButton
						onClick={() => followMutation.mutate()}
						disabled={followMutation.isPending}
						data-testid="doc-follow-btn"
					>
						{isFollowing ? <FollowingIcon /> : <FollowIcon />}
					</IconButton>
				</Tooltip>

				{isFollowing && (
					<>
						<Tooltip title="Notification preference">
							<IconButton
								size="small"
								onClick={(e) => setPrefMenuAnchor(e.currentTarget)}
								disabled={prefMutation.isPending}
								data-testid="doc-pref-btn"
							>
								{preferenceLevel === SubscriptionPreferenceLevel.MUTED ? (
									<NotificationsOffIcon fontSize="small" />
								) : preferenceLevel === SubscriptionPreferenceLevel.MENTIONS ? (
									<AlternateEmailIcon fontSize="small" />
								) : (
									<NotificationsIcon fontSize="small" />
								)}
							</IconButton>
						</Tooltip>
						<Menu
							anchorEl={prefMenuAnchor}
							open={Boolean(prefMenuAnchor)}
							onClose={() => setPrefMenuAnchor(null)}
						>
							<MenuItem
								selected={preferenceLevel === SubscriptionPreferenceLevel.ALL}
								onClick={() => prefMutation.mutate(SubscriptionPreferenceLevel.ALL)}
							>
								<ListItemIcon><NotificationsIcon fontSize="small" /></ListItemIcon>
								<ListItemText primary="All activity" secondary="Get notified for everything" />
							</MenuItem>
							<MenuItem
								selected={preferenceLevel === SubscriptionPreferenceLevel.MENTIONS}
								onClick={() => prefMutation.mutate(SubscriptionPreferenceLevel.MENTIONS)}
							>
								<ListItemIcon><AlternateEmailIcon fontSize="small" /></ListItemIcon>
								<ListItemText primary="Mentions only" secondary="Only when you're @mentioned" />
							</MenuItem>
							<MenuItem
								selected={preferenceLevel === SubscriptionPreferenceLevel.MUTED}
								onClick={() => prefMutation.mutate(SubscriptionPreferenceLevel.MUTED)}
							>
								<ListItemIcon><NotificationsOffIcon fontSize="small" /></ListItemIcon>
								<ListItemText primary="Muted" secondary="No notifications" />
							</MenuItem>
						</Menu>
					</>
				)}

				<Tooltip title="Comments">
					<IconButton onClick={onOpenComments} data-testid="doc-comments-btn">
						<CommentIcon />
					</IconButton>
				</Tooltip>

				<Tooltip title="History">
					<IconButton onClick={onOpenHistory} data-testid="doc-history-btn">
						<HistoryIcon />
					</IconButton>
				</Tooltip>

				<Tooltip title="Citations">
					<IconButton onClick={onOpenCitations} data-testid="doc-citations-btn">
						<CitationsIcon />
					</IconButton>
				</Tooltip>

				<Tooltip title={isEditing ? 'View mode' : 'Edit mode'}>
					<IconButton
						onClick={() => setIsEditing(!isEditing)}
						color={isEditing ? 'primary' : 'default'}
						data-testid="doc-edit-toggle-btn"
					>
						<EditIcon />
					</IconButton>
				</Tooltip>

				<IconButton onClick={handleMenuClick}>
					<MoreIcon />
				</IconButton>

				<Menu
					anchorEl={menuAnchor}
					open={Boolean(menuAnchor)}
					onClose={handleMenuClose}
				>
					<MenuItem onClick={() => { void handleCopyLink(); }}>
					<ListItemIcon><ShareIcon fontSize="small" /></ListItemIcon>
					<ListItemText>{copyLinkSuccess ? 'Copied!' : 'Copy link'}</ListItemText>
				</MenuItem>
					<Divider />
					{document.status !== 'active' && (
						<MenuItem onClick={() => handleStatusChange('active')}>
							<ListItemText>Mark as Active</ListItemText>
						</MenuItem>
					)}
					{document.status !== 'outdated' && (
						<MenuItem onClick={() => handleStatusChange('outdated')}>
							<ListItemText>Mark as Outdated</ListItemText>
						</MenuItem>
					)}
					{document.status !== 'archived' && (
						<MenuItem onClick={() => handleStatusChange('archived')}>
							<ListItemIcon><ArchiveIcon fontSize="small" /></ListItemIcon>
							<ListItemText>Archive</ListItemText>
						</MenuItem>
					)}
					<Divider />
					<MenuItem onClick={handleDelete} sx={{ color: 'error.main' }}>
						<ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
						<ListItemText>Delete</ListItemText>
					</MenuItem>
				</Menu>
			</Box>

			{/* Citation Banner - only show when document has incoming citations */}
			{citedLineRanges.length > 0 && citationsData && (
				<CitationBanner
					citationCount={citationsData.totalCount}
					citedLineRanges={citedLineRanges}
					onViewAll={onOpenCitations}
				/>
			)}

			{/* Reactions Bar */}
			<ReactionsBar documentId={effectiveId!} />

			{/* Content */}
			<Box
				sx={{
					flex: 1,
					overflow: 'auto',
					p: 3,
				}}
			>
				<DocumentEditor
					document={document}
					isEditing={isEditing}
					onSaved={() => refetch()}
					citedLineRanges={citedLineRanges}
					onOpenCitations={onOpenCitations}
				/>
			</Box>

			{/* Footer metadata */}
			<Box
				sx={{
					p: 1.5,
					borderTop: 1,
					...colors.border.default.style,
					display: 'flex',
					gap: 2,
					alignItems: 'center',
				}}
			>
				<Typography variant="caption" sx={colors.text.secondary.style}>
					By {document.ownerName}
				</Typography>
				<Typography variant="caption" sx={colors.text.secondary.style}>
					Updated {document.updatedAt.toLocaleDateString()}
				</Typography>
				<Typography variant="caption" sx={colors.text.secondary.style}>
					{document.versionCount} version{document.versionCount !== 1 ? 's' : ''}
				</Typography>
				<Typography variant="caption" sx={colors.text.secondary.style}>
					{document.followerCount} follower{document.followerCount !== 1 ? 's' : ''}
				</Typography>
			</Box>
		</Box>
	);
}
