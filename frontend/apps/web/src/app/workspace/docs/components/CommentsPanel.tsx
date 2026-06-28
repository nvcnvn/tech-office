/**
 * CommentsPanel Component
 * Lists and manages document comments
 */

'use client';

import React, { useState } from 'react';
import {
	Box,
	Typography,
	TextField,
	Button,
	List,
	ListItem,
	IconButton,
	Chip,
	CircularProgress,
	Collapse,
} from '@mui/material';
import {
	Reply as ReplyIcon,
	Check as ResolveIcon,
	Delete as DeleteIcon,
	ExpandMore as ExpandIcon,
	ExpandLess as CollapseIcon,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
	listComments,
	addComment,
	addCommentReply,
	resolveComment,
	deleteComment,
	type Comment,
} from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

interface CommentsPanelProps {
	documentId: string;
}

export default function CommentsPanel({ documentId }: CommentsPanelProps) {
	const colors = useThemeColors();
	const queryClient = useQueryClient();
	const [newComment, setNewComment] = useState('');
	const [showResolved, setShowResolved] = useState(false);
	const [replyingTo, setReplyingTo] = useState<string | null>(null);
	const [replyText, setReplyText] = useState('');

	// Fetch comments
	const { data: commentsData, isLoading } = useQuery({
		queryKey: ['docs', 'comments', documentId, showResolved],
		queryFn: () => listComments({ documentId, includeResolved: showResolved }),
		staleTime: 30000,
	});

	// Add comment mutation
	const addMutation = useMutation({
		mutationFn: () =>
			addComment({
				documentId,
				// blockId omitted for document-level comments
				commentText: newComment.trim(),
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs', 'comments', documentId] });
			setNewComment('');
		},
	});

	// Add reply mutation
	const replyMutation = useMutation({
		mutationFn: () =>
			addCommentReply({ commentId: replyingTo!, replyText: replyText.trim() }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs', 'comments', documentId] });
			setReplyingTo(null);
			setReplyText('');
		},
	});

	// Resolve mutation
	const resolveMutation = useMutation({
		mutationFn: (commentId: string) => resolveComment(commentId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs', 'comments', documentId] });
		},
	});

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: (commentId: string) => deleteComment(commentId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['docs', 'comments', documentId] });
		},
	});

	const handleAddComment = (e: React.FormEvent) => {
		e.preventDefault();
		if (newComment.trim()) {
			addMutation.mutate();
		}
	};

	const handleAddReply = (e: React.FormEvent) => {
		e.preventDefault();
		if (replyText.trim() && replyingTo) {
			replyMutation.mutate();
		}
	};

	const comments = commentsData?.comments || [];

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
			{/* Add comment form */}
			<Box
				component="form"
				onSubmit={handleAddComment}
				sx={{ p: 2, borderBottom: 1, ...colors.border.default.style }}
			>
				<TextField
					fullWidth
					size="small"
					multiline
					minRows={2}
					placeholder="Add a comment..."
					value={newComment}
					onChange={(e) => setNewComment(e.target.value)}
					disabled={addMutation.isPending}
					data-testid="new-comment-input"
				/>
				<Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
					<Button
						type="submit"
						size="small"
						variant="contained"
						disabled={!newComment.trim() || addMutation.isPending}
						data-testid="add-comment-btn"
					>
						{addMutation.isPending ? <CircularProgress size={16} /> : 'Comment'}
					</Button>
				</Box>
			</Box>

			{/* Toggle resolved */}
			<Box sx={{ px: 2, py: 1 }}>
				<Button
					size="small"
					onClick={() => setShowResolved(!showResolved)}
					endIcon={showResolved ? <CollapseIcon /> : <ExpandIcon />}
				>
					{showResolved ? 'Hide resolved' : 'Show resolved'}
				</Button>
			</Box>

			{/* Comments list */}
			<Box sx={{ flex: 1, overflow: 'auto', px: 1 }}>
				{isLoading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
						<CircularProgress size={24} />
					</Box>
				) : comments.length === 0 ? (
					<Box sx={{ py: 4, textAlign: 'center' }}>
						<Typography variant="body2" sx={colors.text.secondary.style}>
							No comments yet
						</Typography>
					</Box>
				) : (
					<List dense>
						{comments.map((comment) => (
							<CommentItem
								key={comment.id}
								comment={comment}
								isReplying={replyingTo === comment.id}
								replyText={replyText}
								onReplyClick={() => setReplyingTo(comment.id)}
								onReplyChange={setReplyText}
								onReplySubmit={handleAddReply}
								onReplyCancel={() => { setReplyingTo(null); setReplyText(''); }}
								onResolve={() => resolveMutation.mutate(comment.id)}
								onDelete={() => {
									if (confirm('Delete this comment?')) {
										deleteMutation.mutate(comment.id);
									}
								}}
								isPending={replyMutation.isPending}
							/>
						))}
					</List>
				)}
			</Box>
		</Box>
	);
}

interface CommentItemProps {
	comment: Comment;
	isReplying: boolean;
	replyText: string;
	onReplyClick: () => void;
	onReplyChange: (text: string) => void;
	onReplySubmit: (e: React.FormEvent) => void;
	onReplyCancel: () => void;
	onResolve: () => void;
	onDelete: () => void;
	isPending: boolean;
}

function CommentItem({
	comment,
	isReplying,
	replyText,
	onReplyClick,
	onReplyChange,
	onReplySubmit,
	onReplyCancel,
	onResolve,
	onDelete,
	isPending,
}: CommentItemProps) {
	const colors = useThemeColors();

	return (
		<ListItem
			sx={{
				flexDirection: 'column',
				alignItems: 'stretch',
				py: 1.5,
				borderBottom: 1,
				...colors.border.default.style,
			}}
			data-testid={`comment-item-${comment.id}`}
		>
			{/* Comment header */}
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
				<Typography variant="subtitle2" fontWeight={600}>
					{comment.authorName}
				</Typography>
				<Typography variant="caption" sx={colors.text.secondary.style}>
					{comment.updatedAt.toLocaleDateString()}
				</Typography>
				{comment.isResolved && (
					<Chip label="Resolved" size="small" color="success" variant="outlined" />
				)}
			</Box>

			{/* Comment text */}
			<Typography variant="body2" sx={{ mb: 1 }}>
				{comment.commentText}
			</Typography>

			{/* Actions */}
			<Box sx={{ display: 'flex', gap: 0.5 }}>
				{!comment.isResolved && (
					<>
						<IconButton size="small" onClick={onReplyClick} title="Reply">
							<ReplyIcon fontSize="small" />
						</IconButton>
						<IconButton size="small" onClick={onResolve} title="Resolve">
							<ResolveIcon fontSize="small" />
						</IconButton>
					</>
				)}
				<IconButton size="small" onClick={onDelete} title="Delete">
					<DeleteIcon fontSize="small" />
				</IconButton>
			</Box>

			{/* Reply form */}
			<Collapse in={isReplying}>
				<Box
					component="form"
					onSubmit={onReplySubmit}
					sx={{ mt: 1.5, pl: 2, borderLeft: 2, ...colors.border.default.style }}
				>
					<TextField
						fullWidth
						size="small"
						placeholder="Write a reply..."
						value={replyText}
						onChange={(e) => onReplyChange(e.target.value)}
						disabled={isPending}
						autoFocus
					/>
					<Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
						<Button
							size="small"
							type="submit"
							variant="contained"
							disabled={!replyText.trim() || isPending}
						>
							Reply
						</Button>
						<Button size="small" onClick={onReplyCancel}>
							Cancel
						</Button>
					</Box>
				</Box>
			</Collapse>

			{/* Replies count */}
			{comment.replyCount > 0 && (
				<Typography variant="caption" sx={{ mt: 1, ...colors.text.secondary.style }}>
					{comment.replyCount} repl{comment.replyCount === 1 ? 'y' : 'ies'}
				</Typography>
			)}
		</ListItem>
	);
}
