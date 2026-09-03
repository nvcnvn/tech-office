'use client';

export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Alert, Box, CircularProgress, Snackbar, Typography } from '@mui/material';
import {
	approveEvidenceSubmission,
	classifyReviewDecisionError,
	listEvidenceReviewQueue,
	rejectEvidenceSubmission,
	reviewDecisionRefusalMessage,
	type ReviewQueueEntry,
} from 'apis';
import { useRequireAuth } from '@/lib/auth/hooks';
import { useThemeColors } from '@/theme/useThemeColors';
import ReviewQueueList from './components/ReviewQueueList';
import RejectReasonDialog from './components/RejectReasonDialog';

export default function ReviewQueuePage() {
	const { isLoading, user } = useRequireAuth();

	if (isLoading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}
	if (!user) return null;

	return (
		<Suspense
			fallback={
				<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
					<CircularProgress />
				</Box>
			}
		>
			<ReviewQueueContent />
		</Suspense>
	);
}

function ReviewQueueContent() {
	const colors = useThemeColors();
	const searchParams = useSearchParams();
	const projectId = searchParams.get('projectId') ?? undefined;

	const [entries, setEntries] = useState<ReviewQueueEntry[]>([]);
	const [cursor, setCursor] = useState<string | undefined>();
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | undefined>();
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
	const [rejecting, setRejecting] = useState<ReviewQueueEntry | undefined>();
	const [message, setMessage] = useState<string | undefined>();

	// A decision that fails must put the row back exactly where it was, so the optimistic
	// removal keeps the entry and its index rather than re-fetching the page (FR-018).
	const removedRef = useRef<Map<string, { entry: ReviewQueueEntry; index: number }>>(new Map());

	const load = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			const page = await listEvidenceReviewQueue({ projectId });
			setEntries(page.entries);
			setCursor(page.nextCursor);
		} catch {
			setError('The review queue could not be loaded. Try again.');
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => {
		void load();
	}, [load]);

	const loadMore = useCallback(async () => {
		if (!cursor) return;
		setLoadingMore(true);
		try {
			const page = await listEvidenceReviewQueue({ projectId, cursor });
			setEntries((prev) => [...prev, ...page.entries]);
			setCursor(page.nextCursor);
		} catch {
			setMessage('The next page could not be loaded. Try again.');
		} finally {
			setLoadingMore(false);
		}
	}, [cursor, projectId]);

	const setBusy = (id: string, busy: boolean) =>
		setBusyIds((prev) => {
			const next = new Set(prev);
			if (busy) next.add(id);
			else next.delete(id);
			return next;
		});

	const removeOptimistically = (entry: ReviewQueueEntry) => {
		setEntries((prev) => {
			const index = prev.findIndex((e) => e.evidenceSubmissionId === entry.evidenceSubmissionId);
			if (index === -1) return prev;
			removedRef.current.set(entry.evidenceSubmissionId, { entry, index });
			return prev.filter((e) => e.evidenceSubmissionId !== entry.evidenceSubmissionId);
		});
	};

	const restore = (submissionId: string) => {
		const removed = removedRef.current.get(submissionId);
		if (!removed) return;
		removedRef.current.delete(submissionId);
		setEntries((prev) => {
			if (prev.some((e) => e.evidenceSubmissionId === submissionId)) return prev;
			const next = [...prev];
			next.splice(Math.min(removed.index, next.length), 0, removed.entry);
			return next;
		});
	};

	const decide = async (entry: ReviewQueueEntry, run: () => Promise<void>) => {
		const id = entry.evidenceSubmissionId;
		setBusy(id, true);
		removeOptimistically(entry);
		try {
			await run();
			removedRef.current.delete(id);
		} catch (err) {
			const refusal = classifyReviewDecisionError(err);
			// An already-decided submission is genuinely gone from the queue, so it stays
			// removed — restoring it would offer the reviewer an action that cannot succeed.
			if (refusal.kind === 'already_decided') {
				removedRef.current.delete(id);
			} else {
				restore(id);
			}
			setMessage(reviewDecisionRefusalMessage(refusal));
		} finally {
			setBusy(id, false);
		}
	};

	const handleApprove = (entry: ReviewQueueEntry) =>
		void decide(entry, () => approveEvidenceSubmission(entry.evidenceSubmissionId));

	const handleRejectConfirm = (reason: string) => {
		const entry = rejecting;
		if (!entry) return;
		setRejecting(undefined);
		void decide(entry, () => rejectEvidenceSubmission(entry.evidenceSubmissionId, reason));
	};

	return (
		<Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }} data-testid="review-queue-page">
			<Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, ...colors.text.primary.style }}>
				Needs your review
			</Typography>
			<Typography variant="body2" sx={{ mb: 3, ...colors.text.secondary.style }}>
				{projectId
					? 'Pending evidence for this project, oldest first. Late instances come first.'
					: 'Every pending evidence submission you can decide, across all projects. Late instances come first.'}
			</Typography>

			<ReviewQueueList
				entries={entries}
				loading={loading}
				loadingMore={loadingMore}
				error={error}
				hasMore={!!cursor}
				busyIds={busyIds}
				onLoadMore={() => void loadMore()}
				onApprove={handleApprove}
				onReject={setRejecting}
			/>

			<RejectReasonDialog
				entry={rejecting}
				submitting={!!rejecting && busyIds.has(rejecting.evidenceSubmissionId)}
				onCancel={() => setRejecting(undefined)}
				onConfirm={handleRejectConfirm}
			/>

			<Snackbar
				open={!!message}
				autoHideDuration={8000}
				onClose={() => setMessage(undefined)}
				anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
			>
				<Alert severity="warning" onClose={() => setMessage(undefined)} data-testid="review-queue-decision-error">
					{message}
				</Alert>
			</Snackbar>
		</Box>
	);
}
