'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
	Alert,
	Box,
	Button,
	Chip,
	CircularProgress,
	Divider,
	Paper,
	Typography,
} from '@mui/material';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { listRitualReviewBacklog, type RitualReviewBacklogItem } from 'apis/dst/src/collaboration-ritual';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';

function formatDeadline(value: Date | undefined): string {
	if (!value) {
		return 'No deadline';
	}

	return value.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

function isOverdueReview(item: RitualReviewBacklogItem): boolean {
	return !!item.completionDeadline && item.completionDeadline.getTime() < Date.now();
}

function BacklogRow({ item }: { item: RitualReviewBacklogItem }) {
	const colors = useThemeColors();
	const router = useRouter();

	const focusQuery = new URLSearchParams({ focusIntent: 'review_pending' });
	if (item.focusRequirementId) {
		focusQuery.set('requirementId', item.focusRequirementId);
	}

	return (
		<Paper
			variant="outlined"
			sx={{
				p: 2,
				borderRadius: 2,
				...colors.bg.paper.style,
			}}
			data-testid={`ritual-review-backlog-row-${item.taskId}`}
		>
			<Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
				<Box sx={{ minWidth: 0, flex: 1 }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
						<Typography variant="subtitle2" sx={{ fontWeight: 700 }} data-testid={`ritual-review-backlog-identifier-${item.taskId}`}>
							{item.taskIdentifier}
						</Typography>
						<Chip
							label={`${item.pendingReviewCount} pending`}
							color={isOverdueReview(item) ? 'error' : 'warning'}
							size="small"
							data-testid={`ritual-review-backlog-pending-chip-${item.taskId}`}
						/>
						<Chip
							label={isOverdueReview(item) ? 'Overdue review' : 'Review now'}
							size="small"
							variant="outlined"
							color={isOverdueReview(item) ? 'error' : 'info'}
							data-testid={`ritual-review-backlog-urgency-chip-${item.taskId}`}
						/>
						<Chip
							label={item.ritualName}
							variant="outlined"
							size="small"
							data-testid={`ritual-review-backlog-ritual-chip-${item.taskId}`}
						/>
					</Box>
					<Typography variant="body1" sx={{ ...colors.text.primary.style, fontWeight: 600, mb: 0.5 }} data-testid={`ritual-review-backlog-title-${item.taskId}`}>
						{item.taskTitle}
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1 }} data-testid={`ritual-review-backlog-requirements-${item.taskId}`}>
						{item.pendingRequirementNames.join(', ')}
					</Typography>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }} data-testid={`ritual-review-backlog-deadline-${item.taskId}`}>
						<AccessTimeIcon sx={{ fontSize: 16, ...colors.text.secondary.style }} />
						<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
							{formatDeadline(item.completionDeadline)}
						</Typography>
						{item.latestPendingSubmission?.serverTimestamp && (
							<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
								Latest proof: {formatDeadline(item.latestPendingSubmission.serverTimestamp)}
							</Typography>
						)}
					</Box>
				</Box>
				<Button
					variant="contained"
					size="small"
					endIcon={<OpenInNewIcon fontSize="small" />}
					onClick={() =>
						router.push(
							`/workspace/tasks/${item.projectId}/tasks/${item.taskId}?${focusQuery.toString()}`
						)
					}
					data-testid={`open-review-backlog-item-${item.taskId}`}
				>
					Open Instance
				</Button>
			</Box>
		</Paper>
	);
}

function ReviewSection({
	title,
	description,
	items,
	testId,
}: {
	title: string;
	description: string;
	items: RitualReviewBacklogItem[];
	testId: string;
}) {
	const colors = useThemeColors();

	if (items.length === 0) {
		return null;
	}

	return (
		<Box data-testid={testId}>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
				<Typography variant="subtitle1" sx={{ ...colors.text.primary.style, fontWeight: 700 }}>
					{title}
				</Typography>
				<Chip label={items.length} size="small" variant="outlined" />
			</Box>
			<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1.5 }}>
				{description}
			</Typography>
			<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
				{items.map((item) => (
					<BacklogRow key={item.taskId} item={item} />
				))}
			</Box>
		</Box>
	);
}

export default function RitualReviewBacklog() {
	const colors = useThemeColors();
	const { project } = useProjectContext();
	const [items, setItems] = useState<RitualReviewBacklogItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		if (!project) {
			return;
		}

		setLoading(true);
		setError(null);
		try {
			setItems(await listRitualReviewBacklog(project.id));
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load pending ritual reviews');
		} finally {
			setLoading(false);
		}
	}, [project]);

	useEffect(() => {
		void load();
	}, [load]);

	const overdueItems = items.filter(isOverdueReview);
	const readyItems = items.filter((item) => !isOverdueReview(item));

	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}

	return (
		<Box sx={{ p: 3 }} data-testid="ritual-review-backlog">
			<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, mb: 2 }}>
				<Box>
					<Typography variant="h6" sx={{ fontWeight: 700, ...colors.text.primary.style }} data-testid="ritual-review-backlog-heading">
						Review Queue
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, mt: 0.5 }}>
						Triage proof waiting on reviewer decisions. Every row opens the live ritual instance with the pending evidence highlighted.
					</Typography>
				</Box>
				<Button size="small" onClick={() => void load()} data-testid="ritual-review-backlog-refresh-btn">
					Refresh
				</Button>
			</Box>

			{error && (
				<Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
					{error}
				</Alert>
			)}

			{overdueItems.length > 0 && (
				<Alert severity="warning" sx={{ mb: 2.5 }} icon={<WarningAmberIcon fontSize="inherit" />} data-testid="ritual-review-backlog-overdue-alert">
					{overdueItems.length} review item{overdueItems.length === 1 ? '' : 's'} already missed the ritual deadline. Resolve those live instances first.
				</Alert>
			)}

			{items.length === 0 ? (
				<Paper
					variant="outlined"
					sx={{ p: 3, borderRadius: 2, textAlign: 'center', ...colors.bg.paper.style }}
					data-testid="ritual-review-backlog-empty"
				>
					<FactCheckOutlinedIcon sx={{ fontSize: 36, ...colors.text.secondary.style, mb: 1 }} />
					<Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
						No pending ritual reviews
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						New evidence waiting for review will appear here.
					</Typography>
				</Paper>
			) : (
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="ritual-review-backlog-list">
					<ReviewSection
						title="Overdue Reviewer Decisions"
						description="Instances already past deadline. These are the fastest way to reduce operational risk."
						items={overdueItems}
						testId="ritual-review-section-overdue"
					/>
					<ReviewSection
						title="Ready for Review"
						description="Open the live instance to inspect the exact proof that is waiting for review."
						items={readyItems}
						testId="ritual-review-section-ready"
					/>
				</Box>
			)}
		</Box>
	);
}