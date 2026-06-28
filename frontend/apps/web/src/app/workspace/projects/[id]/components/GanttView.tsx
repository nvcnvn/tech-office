/**
 * GanttView Component
 * Timeline visualization for task scheduling
 * Feature: 017-realtime-task-collaboration-system (T125)
 *
 * Features:
 * - Horizontal timeline with date headers (weeks)
 * - Task bars positioned by start/due dates
 * - Ritual definitions shown as a single band row with per-instance color ticks
 * - Visual indicator for tasks without dates
 * - Click task bar / tick to open detail
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { useMemo, useCallback, useEffect, useState } from 'react';
import {
	Alert,
	Box,
	Typography,
	CircularProgress,
	Paper,
	Tooltip,
	Chip,
} from '@mui/material';
import RepeatIcon from '@mui/icons-material/Repeat';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import type { Task, ProjectState } from 'apis';
import { listRitualDefinitions } from 'apis';

// =============================================================================
// Types
// =============================================================================

interface GanttViewProps {
	onTaskClick?: (task: Task) => void;
	onTaskIdentifierClick?: (task: Task) => void;
}

interface WeekColumn {
	date: Date;
	label: string;
}

interface RitualBand {
	definitionId: string;
	definitionName: string;
	instances: Task[]; // sorted by scheduledDate ascending
	completedCount: number;
}

type TickColor = string; // MUI color token or hex

// =============================================================================
// Utility Functions
// =============================================================================

function startOfWeek(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay();
	const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
	d.setDate(diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

function addDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + days);
	return result;
}

function formatWeekLabel(date: Date): string {
	const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
	return date.toLocaleDateString(undefined, options);
}

function getWeeksBetween(start: Date, end: Date): WeekColumn[] {
	const weeks: WeekColumn[] = [];
	let current = startOfWeek(start);
	const endWeek = startOfWeek(end);

	while (current <= endWeek) {
		weeks.push({
			date: new Date(current),
			label: formatWeekLabel(current),
		});
		current = addDays(current, 7);
	}

	return weeks;
}

// =============================================================================
// Constants
// =============================================================================

const ROW_HEIGHT = 36;
const BAND_ROW_HEIGHT = 44; // taller to fit tick track + hover area
const TICK_SIZE = 12;
const HEADER_HEIGHT = 60;
const WEEK_WIDTH = 100;
const TASK_ID_WIDTH = 200;

const TICK_LEGEND = [
	{ label: 'Completed', color: 'success.main' },
	{ label: 'In progress', color: 'warning.main' },
	{ label: 'Touched', color: 'primary.main' },
	{ label: 'Scheduled', color: 'action.disabled' },
	{ label: 'Overdue / missed', color: 'error.main' },
	{ label: 'Skipped', color: 'text.disabled' },
] as const;

// =============================================================================
// Main GanttView Component
// =============================================================================

export function GanttView({ onTaskClick, onTaskIdentifierClick }: GanttViewProps) {
	const colors = useThemeColors();
	const { project, states, tasks, loading } = useProjectContext();

	const isMixed = project?.collaborationMode === 'mixed';
	const isRitual = project?.collaborationMode === 'ritual';
	const hasRituals = isRitual;
	const timelineTasks = useMemo(
		() => (isMixed ? tasks.filter((task) => task.taskKind !== 'ritual_instance') : tasks),
		[isMixed, tasks]
	);

	// Fetch ritual definition names for band labels
	const [defNameMap, setDefNameMap] = useState<Map<string, string>>(new Map());
	useEffect(() => {
		if (!hasRituals || !project?.id) return;
		listRitualDefinitions(project.id).then((defs) => {
			setDefNameMap(new Map(defs.map((d) => [d.id, d.name])));
		}).catch(() => {/* ignore — fallback to parsing task title */});
	}, [hasRituals, project?.id]);

	// Create state lookup map
	const stateMap = useMemo(() => {
		const map = new Map<string, ProjectState>();
		states.forEach((s) => map.set(s.id, s));
		return map;
	}, [states]);

	// Derive tick color from state category
	const getTickColor = useCallback(
		(task: Task): TickColor => {
			const state = stateMap.get(task.stateId);
			const category = state?.category;
			switch (category) {
				case 'done':
				case 'verified':
					return 'success.main';
				case 'in_progress':
					return 'warning.main';
				case 'overdue':
				case 'missed':
					return 'error.main';
				case 'skipped':
					return 'text.disabled';
				default:
					// scheduled/todo — touched vs untouched
					return task.channelId ? 'primary.main' : 'action.disabled';
			}
		},
		[stateMap]
	);

	// Separate and group tasks
	const { ritualBands, standardRows, tasksWithoutDates, dateRange, weeks } = useMemo(() => {
		const ritualInstanceMap = new Map<string, Task[]>();
		const standardWithDates: Task[] = [];
		const withoutDates: Task[] = [];

		timelineTasks.forEach((task) => {
			if (hasRituals && task.taskKind === 'ritual_instance' && !task.detachedFromRitual && task.ritualDefinitionId) {
				if (task.scheduledDate || task.startDate || task.dueDate) {
					const defId = task.ritualDefinitionId;
					if (!ritualInstanceMap.has(defId)) ritualInstanceMap.set(defId, []);
					ritualInstanceMap.get(defId)!.push(task);
				} else {
					withoutDates.push(task);
				}
			} else {
				if (task.startDate || task.dueDate) {
					standardWithDates.push(task);
				} else {
					withoutDates.push(task);
				}
			}
		});

		// Build ritual bands, sorted by scheduledDate
		const bands: RitualBand[] = [];
		ritualInstanceMap.forEach((instances, definitionId) => {
			const sorted = [...instances].sort((a, b) => {
				const da = a.scheduledDate || a.startDate || '';
				const db = b.scheduledDate || b.startDate || '';
				return da < db ? -1 : da > db ? 1 : 0;
			});
			const state0 = stateMap.get(sorted[0]?.stateId);
			const completedCount = sorted.filter((t) => {
				const cat = stateMap.get(t.stateId)?.category;
				return cat === 'done' || cat === 'verified';
			}).length;

			// Derive definition name: prefer fetched name, fallback to stripping date from title
			let definitionName = defNameMap.get(definitionId) || '';
			if (!definitionName && sorted[0]) {
				// Title format: "Def Name — 2026-03-16"
				const parts = sorted[0].title.split(' — ');
				definitionName = parts.length > 1 ? parts.slice(0, -1).join(' — ') : sorted[0].title;
			}

			bands.push({ definitionId, definitionName, instances: sorted, completedCount });
		});

		// Compute overall date range
		const allDates: Date[] = [];
		bands.forEach(({ instances }) => {
			instances.forEach((t) => {
				if (t.scheduledDate) allDates.push(new Date(t.scheduledDate));
				if (t.startDate) allDates.push(new Date(t.startDate));
				if (t.dueDate) allDates.push(new Date(t.dueDate));
			});
		});
		standardWithDates.forEach((t) => {
			if (t.startDate) allDates.push(new Date(t.startDate));
			if (t.dueDate) allDates.push(new Date(t.dueDate));
		});

		let minDate = new Date();
		let maxDate = new Date();
		if (allDates.length > 0) {
			minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
			maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
		}

		const rangeStart = addDays(startOfWeek(minDate), -14);
		const rangeEnd = addDays(startOfWeek(maxDate), 21);

		return {
			ritualBands: bands,
			standardRows: standardWithDates,
			tasksWithoutDates: withoutDates,
			dateRange: { start: rangeStart, end: rangeEnd },
			weeks: getWeeksBetween(rangeStart, rangeEnd),
		};
	}, [timelineTasks, hasRituals, stateMap, defNameMap]);

	// Calculate pixel offset for a date within the timeline
	const dateToPixel = useCallback(
		(date: Date): number => {
			const rangeStartTime = dateRange.start.getTime();
			const totalDays = (dateRange.end.getTime() - rangeStartTime) / (1000 * 60 * 60 * 24);
			const dayWidth = (weeks.length * WEEK_WIDTH) / totalDays;
			const days = (date.getTime() - rangeStartTime) / (1000 * 60 * 60 * 24);
			return days * dayWidth;
		},
		[dateRange, weeks]
	);

	// Calculate task bar position (standard tasks)
	const getTaskBarStyle = useCallback(
		(task: Task) => {
			const startDate = task.startDate ? new Date(task.startDate) : new Date(task.dueDate!);
			const endDate = task.dueDate ? new Date(task.dueDate) : startDate;

			const left = dateToPixel(startDate);

			const rangeStartTime = dateRange.start.getTime();
			const totalDays = (dateRange.end.getTime() - rangeStartTime) / (1000 * 60 * 60 * 24);
			const dayWidth = (weeks.length * WEEK_WIDTH) / totalDays;
			const durationDays = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24) + 1);
			const width = durationDays * dayWidth;

			const state = stateMap.get(task.stateId);
			const barColor = state?.color || '#6b7280';

			return {
				left: `${left}px`,
				width: `${Math.max(width, 20)}px`,
				backgroundColor: barColor,
			};
		},
		[dateToPixel, dateRange, weeks, stateMap]
	);

	// Handle task click
	const handleTaskClick = useCallback(
		(task: Task) => onTaskClick?.(task),
		[onTaskClick]
	);

	// Handle task identifier click
	const handleIdentifierClick = useCallback(
		(e: React.MouseEvent, task: Task) => {
			e.stopPropagation();
			onTaskIdentifierClick?.(task);
		},
		[onTaskIdentifierClick]
	);

	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}

	if (timelineTasks.length === 0) {
		return (
			<Box sx={{ p: 4, textAlign: 'center' }} data-testid="project-gantt-view">
				<Typography sx={{ ...colors.text.secondary.style }}>
					{isMixed
						? 'No planned-work tasks have dates yet. Routine ritual operations stay in the mixed Routine Operations surface.'
						: 'No tasks to display. Create tasks with dates to see the timeline.'}
				</Typography>
			</Box>
		);
	}

	const totalRows = ritualBands.length + standardRows.length;
	const chartWidth = weeks.length * WEEK_WIDTH;

	return (
		<Box sx={{ p: 2, overflow: 'auto' }} data-testid="project-gantt-view">
			{isMixed && (
				<Alert severity="info" sx={{ mb: 2 }} data-testid="mixed-planned-work-gantt-alert">
					Planned Timeline is reserved for standard-task scheduling. Recurring ritual runs stay in Today and Routine Operations so mixed projects do not blur planning with live operations.
				</Alert>
			)}

			{/* Tasks without dates notice */}
			{tasksWithoutDates.length > 0 && (
				<Box sx={{ mb: 2 }}>
					<Chip
						label={`${tasksWithoutDates.length} task${tasksWithoutDates.length !== 1 ? 's' : ''} without dates`}
						size="small"
						variant="outlined"
						sx={{ ...colors.text.secondary.style }}
					/>
				</Box>
			)}

			{/* Gantt Chart */}
			<Paper
				sx={{
					...colors.bg.paper.style,
					border: 1,
					...colors.border.default.style,
					overflow: 'auto',
				}}
			>
				<Box sx={{ display: 'flex', minWidth: TASK_ID_WIDTH + chartWidth }}>
					{/* Task ID Column */}
					<Box
						sx={{
							width: TASK_ID_WIDTH,
							flexShrink: 0,
							borderRight: 1,
							...colors.border.default.style,
							position: 'sticky',
							left: 0,
							zIndex: 2,
							...colors.bg.paper.style,
						}}
					>
						{/* Header */}
						<Box
							sx={{
								height: HEADER_HEIGHT,
								display: 'flex',
								alignItems: 'center',
								px: 2,
								borderBottom: 1,
								...colors.border.default.style,
								...colors.bg.elevated.style,
							}}
						>
							<Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
								Task
							</Typography>
						</Box>

						{/* Ritual band label rows */}
						{ritualBands.map((band) => (
							<Box
								key={band.definitionId}
								sx={{
									height: BAND_ROW_HEIGHT,
									display: 'flex',
									alignItems: 'center',
									px: 2,
									borderBottom: 1,
									...colors.border.default.style,
									gap: 0.75,
								}}
							>
								<RepeatIcon sx={{ fontSize: 14, color: 'secondary.main', flexShrink: 0 }} />
								<Typography variant="body2" noWrap sx={{ ...colors.text.primary.style, flex: 1 }}>
									{band.definitionName || 'Ritual'}
								</Typography>
								<Chip
									label={`${band.completedCount}/${band.instances.length}`}
									size="small"
									sx={{
										height: 18,
										fontSize: '0.65rem',
										flexShrink: 0,
										bgcolor: 'success.main',
										color: '#fff',
									}}
								/>
							</Box>
						))}

						{/* Standard task rows */}
						{standardRows.map((task) => (
							<Box
								key={task.id}
								sx={{
									height: ROW_HEIGHT,
									display: 'flex',
									alignItems: 'center',
									px: 2,
									borderBottom: 1,
									...colors.border.default.style,
									cursor: 'pointer',
									'&:hover': colors.bg.active.style,
								}}
								onClick={() => handleTaskClick(task)}
							>
								{isMixed && task.detachedFromRitual && (
									<RepeatIcon sx={{ fontSize: 14, color: 'text.disabled', mr: 0.5 }} />
								)}
								<Typography
									variant="body2"
									noWrap
									sx={{
										...colors.text.secondary.style,
										cursor: 'pointer',
										mr: 1,
										fontWeight: 500,
										color: 'primary.main',
										'&:hover': { textDecoration: 'underline' },
									}}
									onClick={(e) => handleIdentifierClick(e, task)}
								>
									{task.identifier}
								</Typography>
								<Typography variant="body2" noWrap sx={{ ...colors.text.primary.style }}>
									{task.title}
								</Typography>
							</Box>
						))}
					</Box>

					{/* Timeline Area */}
					<Box sx={{ flex: 1, overflow: 'hidden' }}>
						{/* Week Headers */}
						<Box
							sx={{
								display: 'flex',
								height: HEADER_HEIGHT,
								borderBottom: 1,
								...colors.border.default.style,
								...colors.bg.elevated.style,
							}}
						>
							{weeks.map((week, idx) => (
								<Box
									key={idx}
									sx={{
										width: WEEK_WIDTH,
										flexShrink: 0,
										display: 'flex',
										flexDirection: 'column',
										alignItems: 'center',
										justifyContent: 'center',
										borderRight: 1,
										...colors.border.default.style,
									}}
								>
									<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
										{week.date.toLocaleDateString(undefined, { month: 'short' })}
									</Typography>
									<Typography variant="body2" sx={{ fontWeight: 500 }}>
										{week.date.getDate()}
									</Typography>
								</Box>
							))}
						</Box>

						{/* Chart Rows */}
						<Box sx={{ position: 'relative' }}>
							{/* Grid lines */}
							<Box sx={{ display: 'flex', position: 'absolute', top: 0, left: 0, right: 0 }}>
								{weeks.map((_, idx) => (
									<Box
										key={idx}
										sx={{
											width: WEEK_WIDTH,
											height: totalRows * ROW_HEIGHT,
											borderRight: 1,
											...colors.border.default.style,
											opacity: 0.5,
										}}
									/>
								))}
							</Box>

							{/* Ritual Band Rows */}
							{ritualBands.map((band) => {
								if (band.instances.length === 0) return null;
								const firstDate = new Date(band.instances[0].scheduledDate || band.instances[0].startDate || band.instances[0].dueDate!);
								const lastDate = new Date(band.instances[band.instances.length - 1].scheduledDate || band.instances[band.instances.length - 1].startDate || band.instances[band.instances.length - 1].dueDate!);
								const trackLeft = dateToPixel(firstDate);
								const trackRight = dateToPixel(lastDate);

								return (
									<Box
										key={band.definitionId}
										sx={{
											height: BAND_ROW_HEIGHT,
											position: 'relative',
											borderBottom: 1,
											...colors.border.default.style,
										}}
									>
										{/* Track line connecting ticks */}
										<Box
											sx={{
												position: 'absolute',
												top: BAND_ROW_HEIGHT / 2 - 1,
												left: trackLeft + TICK_SIZE / 2,
												width: Math.max(0, trackRight - trackLeft),
												height: 2,
												bgcolor: 'divider',
											}}
										/>

										{/* Instance ticks */}
										{band.instances.map((instance) => {
											const tickDate = new Date(instance.scheduledDate || instance.startDate || instance.dueDate!);
											const left = dateToPixel(tickDate);
											const tickColor = getTickColor(instance);
											const state = stateMap.get(instance.stateId);
											const isCompleted = state?.category === 'done' || state?.category === 'verified';

											return (
												<Tooltip
													key={instance.id}
													title={`${instance.identifier}: ${instance.title} (${state?.name ?? ''})`}
													arrow
												>
													<Box
														onClick={() => handleTaskClick(instance)}
														sx={{
															position: 'absolute',
															top: BAND_ROW_HEIGHT / 2 - TICK_SIZE / 2,
															left,
															width: TICK_SIZE,
															height: TICK_SIZE,
															borderRadius: '50%',
															bgcolor: tickColor,
															cursor: 'pointer',
															border: isCompleted ? '2px solid' : '1.5px solid',
															borderColor: tickColor,
															transition: 'transform 0.1s',
															'&:hover': { transform: 'scale(1.4)' },
														}}
													/>
												</Tooltip>
											);
										})}
									</Box>
								);
							})}

							{/* Standard Task Bars */}
							{standardRows.map((task) => (
								<Box
									key={task.id}
									sx={{
										height: ROW_HEIGHT,
										position: 'relative',
										borderBottom: 1,
										...colors.border.default.style,
									}}
								>
									<Tooltip title={`${task.identifier}: ${task.title}`} arrow>
										<Box
											sx={{
												position: 'absolute',
												top: 6,
												height: ROW_HEIGHT - 12,
												borderRadius: 1,
												cursor: 'pointer',
												display: 'flex',
												alignItems: 'center',
												px: 1,
												color: '#fff',
												fontSize: '0.75rem',
												fontWeight: 500,
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
												...getTaskBarStyle(task),
											}}
											onClick={() => handleTaskClick(task)}
										>
											{task.title}
										</Box>
									</Tooltip>
								</Box>
							))}
						</Box>
					</Box>
				</Box>
			</Paper>

			{/* Legend */}
			<Box sx={{ mt: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
				{hasRituals && (
					<>
						<Typography variant="caption" sx={{ ...colors.text.secondary.style, mr: 0.5 }}>
							Ritual instances:
						</Typography>
						{TICK_LEGEND.map(({ label, color }) => (
							<Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
								<Box
									sx={{
										width: TICK_SIZE,
										height: TICK_SIZE,
										borderRadius: '50%',
										bgcolor: color,
									}}
								/>
								<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
									{label}
								</Typography>
							</Box>
						))}
						<Box sx={{ width: 1, height: 1 }} />
					</>
				)}
				{states.map((state) => (
					<Box key={state.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
						<Box
							sx={{
								width: 12,
								height: 12,
								borderRadius: 0.5,
								backgroundColor: state.color,
							}}
						/>
						<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
							{state.name}
						</Typography>
					</Box>
				))}
			</Box>
		</Box>
	);
}

export default GanttView;
