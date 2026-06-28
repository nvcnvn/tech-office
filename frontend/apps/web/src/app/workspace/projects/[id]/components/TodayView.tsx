/**
 * TodayView Component
 * Shows ritual instances due today sorted by urgency (deadline soonest first)
 * Feature: 022-recurring-ritual-tasks-system-for
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import NextLink from 'next/link';
import {
	Box,
	Typography,
	Card,
	CardContent,
	CardActions,
	Button,
	Chip,
	Alert,
	CircularProgress,
	Grid,
} from '@mui/material';
import RepeatIcon from '@mui/icons-material/Repeat';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import { groupRitualWorklistBuckets, isRitualInstanceTask, listTasks, type Task } from 'apis';

// =============================================================================
// Urgency helpers
// =============================================================================

function hoursUntil(dateStr: string | undefined): number | null {
	if (!dateStr) return null;
	const dueMs = new Date(dateStr).getTime();
	const nowMs = Date.now();
	return (dueMs - nowMs) / 1_000 / 3600;
}

function urgencyColor(hours: number | null): 'error' | 'warning' | 'success' | 'default' {
	if (hours === null) return 'default';
	if (hours < 2) return 'error';
	if (hours < 8) return 'warning';
	return 'success';
}

function urgencyLabel(hours: number | null): string {
	if (hours === null) return 'No deadline';
	if (hours < 0) return 'Overdue';
	if (hours < 1) return 'Less than 1hr';
	return `${Math.round(hours)}h left`;
}

// =============================================================================
// Task Card (handles both ritual and standard tasks)
// =============================================================================

type RitualBucketId = 'overdue' | 'needsResubmission' | 'today' | 'upcoming';

const RITUAL_BUCKET_ORDER: RitualBucketId[] = ['overdue', 'needsResubmission', 'today', 'upcoming'];

const RITUAL_BUCKET_META: Record<
	RitualBucketId,
	{ title: string; description: string; empty: string }
> = {
	overdue: {
		title: 'Overdue',
		description: 'Ritual runs that are already past their completion window.',
		empty: 'Nothing is overdue right now.',
	},
	needsResubmission: {
		title: 'Needs Resubmission',
		description: 'Proof was rejected and needs an updated submission on the live instance.',
		empty: 'No ritual runs need resubmission.',
	},
	today: {
		title: 'Due Today',
		description: 'Live ritual runs that still need worker action today.',
		empty: 'No ritual runs need action today.',
	},
	upcoming: {
		title: 'Upcoming',
		description: 'Scheduled ritual runs you can review before they become urgent.',
		empty: 'No upcoming ritual runs yet.',
	},
};

interface TaskCardProps {
	task: Task;
	showKind: boolean;
	projectId: string;
	actionLabel?: string;
}

function getRitualFocusIntent(task: Task): 'view_instance' | 'submit_requirement' {
	if (task.taskKind !== 'ritual_instance') {
		return 'view_instance';
	}

	const progress = task.evidenceProgress;
	if ((progress?.rejectedCount ?? 0) > 0) {
		return 'submit_requirement';
	}

	const missingRequiredProof =
		(progress?.requiredCount ?? 0) > (progress?.approvedCount ?? 0) &&
		(progress?.pendingReviewCount ?? 0) === 0;

	return missingRequiredProof ? 'submit_requirement' : 'view_instance';
}

function buildTaskHref(projectId: string, task: Task): string {
	if (task.taskKind !== 'ritual_instance') {
		return `/workspace/tasks/${projectId}/tasks/${task.id}`;
	}

	const params = new URLSearchParams({ focusIntent: getRitualFocusIntent(task) });
	return `/workspace/tasks/${projectId}/tasks/${task.id}?${params.toString()}`;
}

function getRitualSummaryCue(task: Task): string | null {
	if (task.taskKind !== 'ritual_instance' || !task.evidenceProgress) {
		return null;
	}

	if (task.evidenceProgress.pendingReviewCount > 0) {
		return `${task.evidenceProgress.pendingReviewCount} waiting for review`;
	}

	if (task.evidenceProgress.rejectedCount > 0) {
		return `${task.evidenceProgress.rejectedCount} need resubmission`;
	}

	if (task.evidenceProgress.allRequiredApproved) {
		return 'All required proof approved';
	}

	const remaining = Math.max(task.evidenceProgress.requiredCount - task.evidenceProgress.approvedCount, 0);
	return remaining > 0 ? `${remaining} proof left` : 'Open the ritual instance';
}

function getTaskActionLabel(task: Task): string {
	if (task.taskKind !== 'ritual_instance') {
		return 'Open';
	}

	const progress = task.evidenceProgress;
	if ((progress?.rejectedCount ?? 0) > 0) {
		return 'Fix Proof';
	}

	if ((progress?.pendingReviewCount ?? 0) > 0) {
		return 'View Instance';
	}

	if ((progress?.requiredCount ?? 0) > (progress?.approvedCount ?? 0)) {
		return 'Complete Proof';
	}

	return 'Open Instance';
}

function TaskCard({ task, showKind, projectId, actionLabel }: TaskCardProps) {
	const colors = useThemeColors();
	const hours = hoursUntil(task.dueDate ?? undefined);
	const color = urgencyColor(hours);
	const isRitual = task.taskKind === 'ritual_instance';
	const ritualCue = getRitualSummaryCue(task);

	return (
		<Card
			variant="outlined"
			sx={{
				borderColor:
					color === 'error'
						? 'error.main'
						: color === 'warning'
						? 'warning.main'
						: 'divider',
			}}
			data-testid={`today-task-card-${task.id}`}
		>
			<CardContent sx={{ pb: '8px !important' }}>
				<Box
					sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
				>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
						{isRitual ? (
							<RepeatIcon sx={{ fontSize: 16, ...colors.text.secondary.style }} />
						) : (
							<AssignmentIcon sx={{ fontSize: 16, ...colors.text.secondary.style }} />
						)}
						<Typography variant="subtitle2" sx={{ ...colors.text.primary.style }}>
							{task.title}
						</Typography>
					</Box>
					<Box sx={{ display: 'flex', gap: 0.5 }}>
						{showKind && (
							<Chip
								label={isRitual ? 'Ritual' : 'Standard'}
								size="small"
								variant="outlined"
								color={isRitual ? 'warning' : 'default'}
								sx={{ height: 20, fontSize: '0.65rem' }}
							/>
						)}
						<Chip
							icon={<AccessTimeIcon />}
							label={urgencyLabel(hours)}
							color={color}
							size="small"
							data-testid={`urgency-chip-${task.id}`}
						/>
					</Box>
				</Box>
				{ritualCue && (
					<Typography variant="caption" sx={{ display: 'block', mt: 1, ...colors.text.secondary.style }}>
						{ritualCue}
					</Typography>
				)}
			</CardContent>
			<CardActions sx={{ px: 2, pt: 0 }}>
				<Button
					size="small"
					component={NextLink}
					href={buildTaskHref(projectId, task)}
					data-testid={`open-task-btn-${task.id}`}
				>
					{actionLabel ?? getTaskActionLabel(task)}
				</Button>
			</CardActions>
		</Card>
	);
}

// =============================================================================
// Main Component
// =============================================================================

export default function TodayView() {
	const colors = useThemeColors();
	const { project } = useProjectContext();
	const [tasks, setTasks] = useState<Task[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const isRitualOnly = project?.collaborationMode === 'ritual';
	const isMixed = project?.collaborationMode === 'mixed';

	const load = useCallback(async () => {
		if (!project) return;
		setLoading(true);
		setError(null);
		try {
			const { tasks: allTasks } = await listTasks({ projectId: project.id, rootOnly: false, limit: 100 });

			if (isRitualOnly) {
				setTasks(allTasks.filter(isRitualInstanceTask));
				return;
			}

			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const todayTasks = allTasks
				.filter((t) => {
					const dateStr = t.dueDate || t.scheduledDate;
					if (!dateStr) return false;
					const d = new Date(dateStr);
					if (!(d >= today && d < tomorrow)) return false;
					// For non-mixed projects, only show ritual instances
					if (!isMixed && t.taskKind !== 'ritual_instance') return false;
					return true;
				})
				.sort((a, b) => {
					// Ritual instances first, then standard
					if (a.taskKind !== b.taskKind) {
						return a.taskKind === 'ritual_instance' ? -1 : 1;
					}
					const ha = hoursUntil(a.dueDate ?? undefined) ?? Infinity;
					const hb = hoursUntil(b.dueDate ?? undefined) ?? Infinity;
					return ha - hb;
				});
			setTasks(todayTasks);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load tasks');
		} finally {
			setLoading(false);
		}
	}, [project, isMixed, isRitualOnly]);

	useEffect(() => {
		load();
	}, [load]);

	const { ritualGroups, ritualTasks, standardTasks } = useMemo(() => {
		const rituals = tasks.filter((t) => t.taskKind === 'ritual_instance');
		const standard = tasks.filter((t) => t.taskKind !== 'ritual_instance');

		const groups = new Map<string, Task[]>();
		rituals.forEach((t) => {
			const defId = t.ritualDefinitionId || 'unknown';
			const group = groups.get(defId) || [];
			group.push(t);
			groups.set(defId, group);
		});

		return { ritualGroups: groups, ritualTasks: rituals, standardTasks: standard };
	}, [tasks]);

	const ritualBuckets = useMemo(
		() => (isRitualOnly ? groupRitualWorklistBuckets(tasks) : null),
		[isRitualOnly, tasks]
	);

	const pendingReviewCount = ritualBuckets?.pendingReview.length ?? 0;
	const ritualPrimaryTaskCount = ritualBuckets
		? RITUAL_BUCKET_ORDER.reduce((total, bucketId) => total + ritualBuckets[bucketId].length, 0)
		: 0;

	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
				<CircularProgress />
			</Box>
		);
	}

	if (!project) {
		return null;
	}

	if (isRitualOnly && ritualBuckets) {
		return (
			<Box sx={{ p: 3 }} data-testid="today-view">
				<Typography variant="h6" sx={{ ...colors.text.primary.style, mb: 1 }}>
					Today&apos;s Ritual Work
				</Typography>
				<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 2.5 }}>
					Open the live ritual instance that needs action next. Rejected proof and overdue runs stay at the top.
				</Typography>

				{error && (
					<Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
						{error}
					</Alert>
				)}

				{pendingReviewCount > 0 && (
					<Alert severity="info" sx={{ mb: 2.5 }} data-testid="today-ritual-pending-review-alert">
						{pendingReviewCount} ritual run{pendingReviewCount === 1 ? '' : 's'} waiting for review. They stay visible as awareness on the live instance instead of replacing your action-first groups.
					</Alert>
				)}

				{ritualPrimaryTaskCount === 0 ? (
					<Box
						sx={{ textAlign: 'center', py: 6, ...colors.text.secondary.style }}
						data-testid="today-view-empty"
					>
						<RepeatIcon sx={{ fontSize: 48, mb: 2, opacity: 0.4 }} />
						<Typography>
							{pendingReviewCount > 0
								? 'No ritual runs need worker action right now.'
								: 'No ritual work needs attention right now.'}
						</Typography>
					</Box>
				) : (
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
						{RITUAL_BUCKET_ORDER.map((bucketId) => {
							const sectionTasks = ritualBuckets[bucketId];
							if (sectionTasks.length === 0) {
								return null;
							}

							const meta = RITUAL_BUCKET_META[bucketId];
							return (
								<Box key={bucketId} data-testid={`today-ritual-section-${bucketId}`}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
										<RepeatIcon sx={{ fontSize: 18, color: bucketId === 'needsResubmission' ? 'error.main' : bucketId === 'overdue' ? 'warning.main' : 'primary.main' }} />
										<Typography variant="subtitle1" sx={{ fontWeight: 600, ...colors.text.primary.style, flex: 1 }}>
											{meta.title}
										</Typography>
										<Chip label={sectionTasks.length} size="small" color={bucketId === 'needsResubmission' ? 'error' : bucketId === 'overdue' ? 'warning' : 'default'} />
									</Box>
									<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1.5 }}>
										{meta.description}
									</Typography>
									<Grid container spacing={2}>
										{sectionTasks.map((task) => (
											<Grid size={{ xs: 12, sm: 6, md: 4 }} key={task.id}>
												<TaskCard task={task} showKind={false} projectId={project.id} />
											</Grid>
										))}
									</Grid>
								</Box>
							);
						})}
					</Box>
				)}
			</Box>
		);
	}

	return (
		<Box sx={{ p: 3 }} data-testid="today-view">
			<Typography variant="h6" sx={{ ...colors.text.primary.style, mb: 1 }}>
				Today&apos;s Work
			</Typography>
			<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 2.5 }}>
				Mixed projects keep planned work and routine operations in separate sections so standard-task planning never blends into live ritual execution.
			</Typography>

			{error && (
				<Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
					{error}
				</Alert>
			)}

			{tasks.length === 0 ? (
				<Box
					sx={{ textAlign: 'center', py: 6, ...colors.text.secondary.style }}
					data-testid="today-view-empty"
				>
					<RepeatIcon sx={{ fontSize: 48, mb: 2, opacity: 0.4 }} />
					<Typography>No planned work or ritual runs need attention today.</Typography>
				</Box>
			) : (
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
					<Box data-testid="mixed-today-standard-section">
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
							<AssignmentIcon sx={{ fontSize: 18, ...colors.text.secondary.style }} />
							<Typography variant="subtitle2" sx={{ fontWeight: 600, ...colors.text.primary.style, flex: 1 }}>
								Standard Tasks Due Today
							</Typography>
							<Chip label={standardTasks.length} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.75rem' }} />
						</Box>
						<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1.5 }}>
							Planning-first work stays here so standard tasks do not compete with ritual evidence flows.
						</Typography>
						{standardTasks.length === 0 ? (
							<Alert severity="info" data-testid="mixed-today-standard-empty">
								No standard tasks are due today.
							</Alert>
						) : (
							<Grid container spacing={2}>
								{standardTasks.map((task) => (
									<Grid size={{ xs: 12, sm: 6, md: 4 }} key={task.id}>
										<TaskCard task={task} showKind={false} projectId={project.id} />
									</Grid>
								))}
							</Grid>
						)}
					</Box>

					<Box data-testid="mixed-today-ritual-section">
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
							<RepeatIcon sx={{ fontSize: 18, color: 'warning.main' }} />
							<Typography variant="subtitle2" sx={{ fontWeight: 600, ...colors.text.primary.style, flex: 1 }}>
								Ritual Runs Due Today
							</Typography>
							<Chip label={ritualTasks.length} size="small" color="warning" sx={{ height: 22, fontSize: '0.75rem' }} />
						</Box>
						<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1.5 }}>
							Routine operations stay instance-first here so workers always open the live ritual run instead of a planning surface or reusable template.
						</Typography>
						{ritualTasks.length === 0 ? (
							<Alert severity="info" data-testid="mixed-today-ritual-empty">
								No ritual runs are due today.
							</Alert>
						) : (
							<Grid container spacing={2}>
								{Array.from(ritualGroups.values()).flat().map((task) => (
									<Grid size={{ xs: 12, sm: 6, md: 4 }} key={task.id}>
										<TaskCard task={task} showKind={false} projectId={project.id} />
									</Grid>
								))}
							</Grid>
						)}
					</Box>
				</Box>
			)}
		</Box>
	);
}
