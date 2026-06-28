'use client';

import React, { useMemo } from 'react';
import NextLink from 'next/link';
import {
	Alert,
	Box,
	Button,
	Card,
	CardActions,
	CardContent,
	Chip,
	Grid,
	List,
	ListItem,
	ListItemButton,
	ListItemText,
	Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import RepeatIcon from '@mui/icons-material/Repeat';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import { buildMixedOverviewSummary, type Task } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';

function buildTaskHref(projectId: string, task: Task): string {
	if (task.taskKind !== 'ritual_instance') {
		return `/workspace/tasks/${projectId}/tasks/${task.id}`;
	}

	const focusIntent = (() => {
		if ((task.evidenceProgress?.pendingReviewCount ?? 0) > 0) {
			return 'review_pending';
		}

		if ((task.evidenceProgress?.rejectedCount ?? 0) > 0 || !(task.evidenceProgress?.allRequiredApproved ?? false)) {
			return 'submit_requirement';
		}

		return 'view_instance';
	})();

	return `/workspace/tasks/${projectId}/tasks/${task.id}?focusIntent=${focusIntent}`;
}

export default function OverviewView() {
	const colors = useThemeColors();
	const { project, tasks } = useProjectContext();

	const overview = useMemo(() => {
		if (!project) {
			return null;
		}

		return buildMixedOverviewSummary(project.id, tasks);
	}, [project, tasks]);

	const todayStandardTasks = useMemo(() => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return tasks.filter((task) => {
			if (task.taskKind !== 'standard' || !task.dueDate) {
				return false;
			}

			const dueDate = new Date(task.dueDate);
			dueDate.setHours(0, 0, 0, 0);
			return dueDate.getTime() === today.getTime();
		});
	}, [tasks]);

	const attentionTasks = useMemo(() => {
		if (!overview) {
			return [];
		}

		const taskById = new Map(tasks.map((task) => [task.id, task]));
		return overview.needsAttentionNow
			.map((item) => taskById.get(item.taskId))
			.filter((task): task is Task => !!task)
			.slice(0, 6);
	}, [overview, tasks]);

	if (!project || !overview) {
		return null;
	}

	return (
		<Box sx={{ p: 3 }} data-testid="mixed-overview-view">
			<Typography variant="h6" sx={{ ...colors.text.primary.style, mb: 1 }}>
				Mixed Project Overview
			</Typography>
			<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 2.5 }}>
				Start here when a project mixes planned work and recurring ritual operations. Use this surface to choose the right downstream workflow before you drill into details.
			</Typography>

			{overview.needsAttentionNow.length > 0 ? (
				<Alert severity="warning" sx={{ mb: 2.5 }} data-testid="mixed-overview-attention-alert">
					{overview.needsAttentionNow.length} item{overview.needsAttentionNow.length === 1 ? '' : 's'} need attention now across planned work and routine operations.
				</Alert>
			) : (
				<Alert severity="info" sx={{ mb: 2.5 }} data-testid="mixed-overview-attention-alert">
					No urgent cross-stream items are blocking right now. Planned work and routine operations remain separated below.
				</Alert>
			)}

			<Grid container spacing={2.5} sx={{ mb: 2.5 }}>
				<Grid size={{ xs: 12, md: 4 }}>
					<Card variant="outlined" data-testid="overview-summary-planned-work-card">
						<CardContent>
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
								<AssignmentOutlinedIcon color="primary" />
								<Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
									Planned Work
								</Typography>
							</Box>
							<Typography variant="h4" sx={{ ...colors.text.primary.style }}>
								{overview.standardTaskCount}
							</Typography>
							<Typography variant="body2" sx={{ ...colors.text.secondary.style, mt: 1 }}>
								{todayStandardTasks.length} standard task{todayStandardTasks.length === 1 ? '' : 's'} due today. Use the planning surfaces when you need standard-task progress, sequencing, and timeline views.
							</Typography>
						</CardContent>
						<CardActions>
							<Button component={NextLink} href={`/workspace/tasks/${project.id}?view=board`} endIcon={<ArrowForwardIcon />} data-testid="overview-open-planned-work-btn">
								Open Planned Work
							</Button>
						</CardActions>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, md: 4 }}>
					<Card variant="outlined" data-testid="overview-summary-routine-operations-card">
						<CardContent>
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
								<RepeatIcon color="warning" />
								<Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
									Routine Operations
								</Typography>
							</Box>
							<Typography variant="h4" sx={{ ...colors.text.primary.style }}>
								{overview.ritualTaskCount}
							</Typography>
							<Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
								<Chip label={`${overview.overdueRitualCount} overdue`} size="small" color={overview.overdueRitualCount > 0 ? 'warning' : 'default'} />
								<Chip label={`${overview.todayRitualCount} due today`} size="small" color={overview.todayRitualCount > 0 ? 'primary' : 'default'} />
							</Box>
							<Typography variant="body2" sx={{ ...colors.text.secondary.style, mt: 1 }}>
								Keep recurring ritual execution in the operations lane so workers land on live instances instead of standard planning views.
							</Typography>
						</CardContent>
						<CardActions>
							<Button component={NextLink} href={`/workspace/tasks/${project.id}?view=calendar`} endIcon={<ArrowForwardIcon />} data-testid="overview-open-routine-operations-btn">
								Open Routine Operations
							</Button>
						</CardActions>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, md: 4 }}>
					<Card variant="outlined" data-testid="overview-summary-review-card">
						<CardContent>
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
								<FactCheckOutlinedIcon color="success" />
								<Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
									Review Pressure
								</Typography>
							</Box>
							<Typography variant="h4" sx={{ ...colors.text.primary.style }}>
								{overview.pendingReviewCount}
							</Typography>
							<Typography variant="body2" sx={{ ...colors.text.secondary.style, mt: 1 }}>
								Pending ritual submissions stay separate from worker execution and standard planning. Review from the dedicated backlog when follow-up is needed.
							</Typography>
						</CardContent>
						<CardActions>
							<Button component={NextLink} href={`/workspace/tasks/${project.id}?view=review`} endIcon={<ArrowForwardIcon />} data-testid="overview-open-review-btn">
								Open Review
							</Button>
						</CardActions>
					</Card>
				</Grid>
			</Grid>

			<Card variant="outlined" data-testid="overview-needs-attention-card">
				<CardContent>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
						<AssignmentTurnedInOutlinedIcon color="warning" />
						<Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
							Needs Attention Now
						</Typography>
					</Box>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: 1.5 }}>
						These links open the correct downstream task context without flattening the two workstreams into one primary list.
					</Typography>
					{attentionTasks.length === 0 ? (
						<Typography sx={{ ...colors.text.secondary.style }} data-testid="overview-needs-attention-empty">
							Nothing urgent needs immediate action.
						</Typography>
					) : (
						<List disablePadding data-testid="overview-needs-attention-list">
							{attentionTasks.map((task) => (
								<ListItem key={task.id} disablePadding>
									<ListItemButton component={NextLink} href={buildTaskHref(project.id, task)} data-testid={`overview-needs-attention-item-${task.id}`}>
										<ListItemText
											primary={task.title}
											secondary={task.identifier}
											primaryTypographyProps={{ sx: colors.text.primary.style }}
											secondaryTypographyProps={{ sx: colors.text.secondary.style }}
										/>
										<Chip
											label={task.taskKind === 'ritual_instance' ? 'Routine Operations' : 'Planned Work'}
											size="small"
											color={task.taskKind === 'ritual_instance' ? 'warning' : 'primary'}
										/>
									</ListItemButton>
								</ListItem>
							))}
						</List>
					)}
				</CardContent>
			</Card>
		</Box>
	);
}