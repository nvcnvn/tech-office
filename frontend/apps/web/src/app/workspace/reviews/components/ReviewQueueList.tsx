'use client';

import React from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import type { ReviewQueueEntry } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import ReviewQueueRow from './ReviewQueueRow';

export interface ReviewQueueListProps {
	entries: ReviewQueueEntry[];
	loading: boolean;
	loadingMore: boolean;
	error?: string;
	hasMore: boolean;
	/** Submission ids whose decision is in flight. */
	busyIds: Set<string>;
	onLoadMore: () => void;
	onApprove: (entry: ReviewQueueEntry) => void;
	onReject: (entry: ReviewQueueEntry) => void;
}

/**
 * The queue itself. Loading, empty and failure are three visibly different states: a blank
 * screen that could mean any of them is what FR-008 forbids.
 */
export default function ReviewQueueList({
	entries,
	loading,
	loadingMore,
	error,
	hasMore,
	busyIds,
	onLoadMore,
	onApprove,
	onReject,
}: ReviewQueueListProps) {
	const colors = useThemeColors();

	if (loading) {
		return (
			<Box
				sx={{ display: 'flex', justifyContent: 'center', py: 6 }}
				data-testid="review-queue-loading"
			>
				<CircularProgress />
			</Box>
		);
	}

	if (error) {
		return (
			<Alert severity="error" data-testid="review-queue-error">
				{error}
			</Alert>
		);
	}

	if (entries.length === 0) {
		return (
			<Box sx={{ textAlign: 'center', py: 6 }} data-testid="review-queue-empty-state">
				<Typography variant="h6" sx={{ mb: 0.5, ...colors.text.primary.style }}>
					Nothing to review
				</Typography>
				<Typography variant="body2" sx={colors.text.secondary.style}>
					Every submission you can decide has been decided.
				</Typography>
			</Box>
		);
	}

	return (
		<Stack spacing={1.5} data-testid="review-queue-list">
			{entries.map((entry) => (
				<ReviewQueueRow
					key={entry.evidenceSubmissionId}
					entry={entry}
					busy={busyIds.has(entry.evidenceSubmissionId)}
					onApprove={onApprove}
					onReject={onReject}
				/>
			))}

			{hasMore && (
				<Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
					<Button
						variant="outlined"
						onClick={onLoadMore}
						disabled={loadingMore}
						data-testid="review-queue-load-more-btn"
					>
						{loadingMore ? 'Loading…' : 'Load more'}
					</Button>
				</Box>
			)}
		</Stack>
	);
}
