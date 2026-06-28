/**
 * AnalyticsView Component - Project metrics and analytics dashboard
 * Feature: 017-realtime-task-collaboration-system
 *
 * Features:
 * - Overview metrics (total tasks, completion rate, state breakdown)
 * - Task distribution by state (donut chart)
 * - Task distribution by level (bar chart)
 * - Recent activity summary
 * - Assignee workload summary
 */

'use client';

import React, { useMemo } from 'react';
import {
	Box,
	Typography,
	Paper,
	LinearProgress,
	Chip,
} from '@mui/material';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GroupIcon from '@mui/icons-material/Group';
import RepeatIcon from '@mui/icons-material/Repeat';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';

// =============================================================================
// Metric Card Component
// =============================================================================

interface MetricCardProps {
	title: string;
	value: string | number;
	icon: React.ReactNode;
	subtitle?: string;
	color?: string;
}

function MetricCard({ title, value, icon, subtitle, color = 'primary.main' }: MetricCardProps) {
	const colors = useThemeColors();
	
	return (
		<Paper sx={{ p: 2, ...colors.bg.paper.style }}>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
				<Box
					sx={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 40,
						height: 40,
						borderRadius: 1,
						backgroundColor: color,
						color: 'white',
					}}
				>
					{icon}
				</Box>
				<Typography variant="body2" color="text.secondary">
					{title}
				</Typography>
			</Box>
			<Typography variant="h4" sx={{ mb: 0.5 }}>
				{value}
			</Typography>
			{subtitle && (
				<Typography variant="caption" color="text.secondary">
					{subtitle}
				</Typography>
			)}
		</Paper>
	);
}

// =============================================================================
// Main Analytics View Component
// =============================================================================

export default function AnalyticsView() {
	const colors = useThemeColors();
	const { project, tasks, states, levels } = useProjectContext();

	// Compute metrics
	const metrics = useMemo(() => {
		if (!tasks || !states) {
			return {
				totalTasks: 0,
				completedTasks: 0,
				inProgressTasks: 0,
				completionRate: 0,
				stateBreakdown: [],
				levelBreakdown: [],
			};
		}

		// Find closed states (done, cancelled categories)
		const closedStates = states.filter((s) => s.isClosed);
		const closedStateIds = new Set(closedStates.map((s) => s.id));

		const completedTasks = tasks.filter((t) => closedStateIds.has(t.stateId)).length;
		const totalTasks = tasks.length;
		const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

		// Count tasks in progress (in_progress category states)
		const inProgressStates = states.filter((s) => s.category === 'in_progress');
		const inProgressStateIds = new Set(inProgressStates.map((s) => s.id));
		const inProgressTasks = tasks.filter((t) => inProgressStateIds.has(t.stateId)).length;

		// State breakdown
		const stateCounts = new Map<string, number>();
		tasks.forEach((task) => {
			const count = stateCounts.get(task.stateId) || 0;
			stateCounts.set(task.stateId, count + 1);
		});

		const stateBreakdown = states
			.map((state) => ({
				name: state.name,
				color: state.color,
				count: stateCounts.get(state.id) || 0,
				percentage:
					totalTasks > 0 ? Math.round(((stateCounts.get(state.id) || 0) / totalTasks) * 100) : 0,
			}))
			.filter((item) => item.count > 0)
			.sort((a, b) => b.count - a.count);

		// Level breakdown
		const levelCounts = new Map<string, number>();
		tasks.forEach((task) => {
			const count = levelCounts.get(task.levelId) || 0;
			levelCounts.set(task.levelId, count + 1);
		});

		const levelBreakdown = levels
			.map((level) => ({
				name: level.name,
				color: level.color,
				count: levelCounts.get(level.id) || 0,
				percentage:
					totalTasks > 0 ? Math.round(((levelCounts.get(level.id) || 0) / totalTasks) * 100) : 0,
			}))
			.filter((item) => item.count > 0)
			.sort((a, b) => b.count - a.count);

		return {
			totalTasks,
			completedTasks,
			inProgressTasks,
			completionRate,
			stateBreakdown,
			levelBreakdown,
		};
	}, [tasks, states, levels]);

	const isMixed = project?.collaborationMode === 'mixed';

	// Kind breakdown for mixed projects
	const kindMetrics = useMemo(() => {
		if (!isMixed || !tasks || !states) return null;

		const closedStateIds = new Set(states.filter((s) => s.isClosed).map((s) => s.id));

		const ritualTasks = tasks.filter((t) => t.taskKind === 'ritual_instance');
		const standardTasks = tasks.filter((t) => t.taskKind === 'standard');

		const ritualCompleted = ritualTasks.filter((t) => closedStateIds.has(t.stateId)).length;
		const standardCompleted = standardTasks.filter((t) => closedStateIds.has(t.stateId)).length;

		return {
			ritual: {
				total: ritualTasks.length,
				completed: ritualCompleted,
				rate: ritualTasks.length > 0 ? Math.round((ritualCompleted / ritualTasks.length) * 100) : 0,
			},
			standard: {
				total: standardTasks.length,
				completed: standardCompleted,
				rate: standardTasks.length > 0 ? Math.round((standardCompleted / standardTasks.length) * 100) : 0,
			},
		};
	}, [isMixed, tasks, states]);

	return (
		<Box sx={{ p: 3 }} data-testid="project-analytics-view">
			<Box sx={{ mb: 3 }}>
				<Typography variant="h5" sx={{ mb: 1 }}>
					Project Analytics
				</Typography>
				<Typography variant="body2" color="text.secondary">
					Overview of {project?.name || 'project'} metrics and insights
				</Typography>
			</Box>

			{/* Metric Cards */}
			<Box
				sx={{
					display: 'grid',
					gridTemplateColumns: {
						xs: '1fr',
						sm: 'repeat(2, 1fr)',
						md: 'repeat(4, 1fr)',
					},
					gap: 2,
					mb: 3,
				}}
			>
				<MetricCard
					title="Total Tasks"
					value={metrics.totalTasks}
					icon={<TaskAltIcon />}
					subtitle={`${project?.taskCount || 0} in project`}
					color="primary.main"
				/>
				<MetricCard
					title="Completed"
					value={metrics.completedTasks}
					icon={<TaskAltIcon />}
					subtitle={`${metrics.completionRate}% completion rate`}
					color="success.main"
				/>
				<MetricCard
					title="In Progress"
					value={metrics.inProgressTasks}
					icon={<PendingActionsIcon />}
					subtitle={`${metrics.totalTasks - metrics.completedTasks - metrics.inProgressTasks} pending`}
					color="info.main"
				/>
				<MetricCard
					title="Team Members"
					value={project?.memberCount || 0}
					icon={<GroupIcon />}
					subtitle="Active contributors"
					color="secondary.main"
				/>
			</Box>

			{/* Completion Progress */}
			<Paper sx={{ p: 2, mb: 3, ...colors.bg.paper.style }}>
				<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
					<Typography variant="subtitle1">Overall Completion</Typography>
					<Typography variant="h6" color="primary">
						{metrics.completionRate}%
					</Typography>
				</Box>
				<LinearProgress
					variant="determinate"
					value={metrics.completionRate}
					sx={{ height: 8, borderRadius: 1 }}
				/>
				<Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
					{metrics.completedTasks} of {metrics.totalTasks} tasks completed
				</Typography>
			</Paper>

			{/* Kind Breakdown (mixed projects only) */}
			{isMixed && kindMetrics && (
				<Box
					sx={{
						display: 'grid',
						gridTemplateColumns: 'repeat(2, 1fr)',
						gap: 2,
						mb: 3,
					}}
				>
					<Paper sx={{ p: 2, ...colors.bg.paper.style }}>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
							<RepeatIcon sx={{ color: 'warning.main', fontSize: 20 }} />
							<Typography variant="subtitle1">Ritual Tasks</Typography>
						</Box>
						<Typography variant="h4" sx={{ mb: 0.5 }}>
							{kindMetrics.ritual.total}
						</Typography>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
							<LinearProgress
								variant="determinate"
								value={kindMetrics.ritual.rate}
								color="warning"
								sx={{ flex: 1, height: 6, borderRadius: 1 }}
							/>
							<Typography variant="caption" color="text.secondary">
								{kindMetrics.ritual.rate}%
							</Typography>
						</Box>
						<Typography variant="caption" color="text.secondary">
							{kindMetrics.ritual.completed} of {kindMetrics.ritual.total} completed
						</Typography>
					</Paper>
					<Paper sx={{ p: 2, ...colors.bg.paper.style }}>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
							<AssignmentIcon sx={{ color: 'info.main', fontSize: 20 }} />
							<Typography variant="subtitle1">Standard Tasks</Typography>
						</Box>
						<Typography variant="h4" sx={{ mb: 0.5 }}>
							{kindMetrics.standard.total}
						</Typography>
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
							<LinearProgress
								variant="determinate"
								value={kindMetrics.standard.rate}
								color="info"
								sx={{ flex: 1, height: 6, borderRadius: 1 }}
							/>
							<Typography variant="caption" color="text.secondary">
								{kindMetrics.standard.rate}%
							</Typography>
						</Box>
						<Typography variant="caption" color="text.secondary">
							{kindMetrics.standard.completed} of {kindMetrics.standard.total} completed
						</Typography>
					</Paper>
				</Box>
			)}

			{/* State and Level Breakdown */}
			<Box
				sx={{
					display: 'grid',
					gridTemplateColumns: {
						xs: '1fr',
						md: 'repeat(2, 1fr)',
					},
					gap: 2,
				}}
			>
				{/* Tasks by State */}
				<Paper sx={{ p: 2, ...colors.bg.paper.style }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
						<TrendingUpIcon color="action" />
						<Typography variant="subtitle1">Tasks by State</Typography>
					</Box>
					{metrics.stateBreakdown.length > 0 ? (
						<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
							{metrics.stateBreakdown.map((item) => (
								<Box key={item.name}>
									<Box
										sx={{
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'space-between',
											mb: 0.5,
										}}
									>
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
											<Box
												sx={{
													width: 12,
													height: 12,
													borderRadius: '50%',
													backgroundColor: item.color,
												}}
											/>
											<Typography variant="body2">{item.name}</Typography>
										</Box>
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
											<Typography variant="body2" color="text.secondary">
												{item.count}
											</Typography>
											<Chip
												label={`${item.percentage}%`}
												size="small"
												variant="outlined"
											/>
										</Box>
									</Box>
									<LinearProgress
										variant="determinate"
										value={item.percentage}
										sx={{
											height: 6,
											borderRadius: 1,
											backgroundColor: 'action.hover',
											'& .MuiLinearProgress-bar': {
												backgroundColor: item.color,
											},
										}}
									/>
								</Box>
							))}
						</Box>
					) : (
						<Typography variant="body2" color="text.secondary">
							No tasks yet
						</Typography>
					)}
				</Paper>

				{/* Tasks by Level */}
				<Paper sx={{ p: 2, ...colors.bg.paper.style }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
						<TrendingUpIcon color="action" />
						<Typography variant="subtitle1">Tasks by Level</Typography>
					</Box>
					{metrics.levelBreakdown.length > 0 ? (
						<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
							{metrics.levelBreakdown.map((item) => (
								<Box key={item.name}>
									<Box
										sx={{
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'space-between',
											mb: 0.5,
										}}
									>
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
											<Box
												sx={{
													width: 12,
													height: 12,
													borderRadius: '50%',
													backgroundColor: item.color,
												}}
											/>
											<Typography variant="body2">{item.name}</Typography>
										</Box>
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
											<Typography variant="body2" color="text.secondary">
												{item.count}
											</Typography>
											<Chip
												label={`${item.percentage}%`}
												size="small"
												variant="outlined"
											/>
										</Box>
									</Box>
									<LinearProgress
										variant="determinate"
										value={item.percentage}
										sx={{
											height: 6,
											borderRadius: 1,
											backgroundColor: 'action.hover',
											'& .MuiLinearProgress-bar': {
												backgroundColor: item.color,
											},
										}}
									/>
								</Box>
							))}
						</Box>
					) : (
						<Typography variant="body2" color="text.secondary">
							No tasks yet
						</Typography>
					)}
				</Paper>
			</Box>
		</Box>
	);
}
