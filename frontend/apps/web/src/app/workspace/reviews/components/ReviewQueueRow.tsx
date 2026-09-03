'use client';

import React from 'react';
import Link from 'next/link';
import { Box, Button, Chip, Paper, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import type { ReviewQueueEntry } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import ReviewQueueEvidence from './ReviewQueueEvidence';

/** Relative age of the submission, from the server's clock rather than the device's. */
function formatAge(at: Date | undefined): string {
	if (!at) return 'Unknown age';
	const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000));
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} h ago`;
	return `${Math.round(hours / 24)} d ago`;
}

function formatDeadline(at: Date | undefined): string | undefined {
	if (!at) return undefined;
	return at.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

export interface ReviewQueueRowProps {
	entry: ReviewQueueEntry;
	/** True while this row's decision is in flight, so the actions cannot be double-fired. */
	busy?: boolean;
	onApprove: (entry: ReviewQueueEntry) => void;
	onReject: (entry: ReviewQueueEntry) => void;
}

/**
 * One queue row: everything needed to judge the submission, and the two decisions, without
 * leaving the queue.
 */
export default function ReviewQueueRow({ entry, busy, onApprove, onReject }: ReviewQueueRowProps) {
	const colors = useThemeColors();
	const isLate = entry.urgency === 'late';
	const deadline = formatDeadline(entry.instanceCompletionDeadline);

	return (
		<Paper
			variant="outlined"
			sx={{ p: 2, borderRadius: 2, ...colors.bg.paper.style }}
			data-testid={`review-queue-row-${entry.evidenceSubmissionId}`}
		>
			<Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
				<Box sx={{ minWidth: 0, flex: 1 }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
						{isLate && (
							<Chip
								label={entry.instanceStateCategory === 'missed' ? 'Missed' : 'Overdue'}
								color="error"
								size="small"
								data-testid={`review-queue-late-badge-${entry.evidenceSubmissionId}`}
							/>
						)}
						<Chip label={entry.ritualName || 'Ritual'} size="small" variant="outlined" />
						<Typography variant="subtitle2" sx={{ fontWeight: 700, ...colors.text.primary.style }}>
							<Link href={`/workspace/tasks/${entry.projectId}/tasks/${entry.taskId}`}>
								{entry.taskIdentifier}
							</Link>
						</Typography>
						<Typography variant="body2" sx={colors.text.secondary.style}>
							{entry.projectName}
						</Typography>
					</Box>

					<Typography variant="body1" sx={{ fontWeight: 600, mb: 0.5, ...colors.text.primary.style }}>
						{entry.taskTitle}
					</Typography>

					<Typography variant="caption" sx={{ display: 'block', mb: 1, ...colors.text.secondary.style }}>
						{entry.requirementUnresolved ? (
							<span data-testid={`review-queue-requirement-unresolved-${entry.evidenceSubmissionId}`}>
								This requirement is no longer defined
							</span>
						) : (
							<>
								#{entry.evidenceRequirementPosition + 1} {entry.evidenceRequirementName}
								{entry.evidenceRequirementIsRequired ? ' · required' : ' · optional'}
							</>
						)}
						{' · '}
						{entry.submittedByDisplayName} · {formatAge(entry.serverTimestamp)}
						{deadline ? ` · due ${deadline}` : ''}
					</Typography>

					<ReviewQueueEvidence entry={entry} />
				</Box>

				<Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
					<Button
						variant="contained"
						color="success"
						size="small"
						disabled={busy}
						startIcon={<CheckCircleOutlineIcon fontSize="small" />}
						onClick={() => onApprove(entry)}
						data-testid="review-queue-approve-btn"
					>
						Approve
					</Button>
					<Button
						variant="outlined"
						color="error"
						size="small"
						disabled={busy}
						startIcon={<HighlightOffIcon fontSize="small" />}
						onClick={() => onReject(entry)}
						data-testid="review-queue-reject-btn"
					>
						Reject
					</Button>
				</Box>
			</Box>
		</Paper>
	);
}
