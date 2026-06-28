/**
 * CalendarView Component
 * Calendar visualization for task due dates
 * Feature: 017-realtime-task-collaboration-system (T126)
 *
 * Features:
 * - Monthly calendar grid
 * - Tasks shown on their due dates
 * - Navigate between months
 * - Click task to open detail
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { useMemo, useCallback, useState } from 'react';
import {
	Alert,
	Box,
	Button,
	Typography,
	CircularProgress,
	Paper,
	IconButton,
	Chip,
	Fab,
	Tooltip,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import RepeatIcon from '@mui/icons-material/Repeat';
import AddIcon from '@mui/icons-material/Add';
import { useRouter, useParams } from 'next/navigation';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import type { Task, ProjectState } from 'apis';

// =============================================================================
// Types
// =============================================================================

interface CalendarViewProps {
	onTaskClick?: (task: Task) => void;
	onTaskIdentifierClick?: (task: Task) => void;
}

interface CalendarDay {
	date: Date;
	isCurrentMonth: boolean;
	isToday: boolean;
	tasks: Task[];
}

// =============================================================================
// Utility Functions
// =============================================================================

function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function isSameDay(date1: Date, date2: Date): boolean {
	return (
		date1.getFullYear() === date2.getFullYear() &&
		date1.getMonth() === date2.getMonth() &&
		date1.getDate() === date2.getDate()
	);
}

function formatDateKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Extract ritual definition name from task title (format: "DefName — 2026-01-15") */
function getRitualDefName(task: Task): string {
	const sep = task.title.lastIndexOf(' — ');
	return sep > 0 ? task.title.substring(0, sep) : task.title;
}

function getRitualFocusIntent(task: Task): 'review_pending' | 'submit_requirement' | 'view_instance' {
	if ((task.evidenceProgress?.pendingReviewCount ?? 0) > 0) {
		return 'review_pending';
	}

	if ((task.evidenceProgress?.rejectedCount ?? 0) > 0 || !(task.evidenceProgress?.allRequiredApproved ?? false)) {
		return 'submit_requirement';
	}

	return 'view_instance';
}

// =============================================================================
// Constants
// =============================================================================

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CELL_MIN_HEIGHT = 100;

// =============================================================================
// Main CalendarView Component
// =============================================================================

export function CalendarView({ onTaskClick, onTaskIdentifierClick }: CalendarViewProps) {
	const colors = useThemeColors();
	const router = useRouter();
	const params = useParams();
	const { project, states, tasks, loading } = useProjectContext();
	const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));

	const isMixed = project?.collaborationMode === 'mixed';
	const isRitualOnly = project?.collaborationMode === 'ritual';
	const showRitualFab = project?.collaborationMode === 'ritual' || project?.collaborationMode === 'mixed';
	const displayedTasks = useMemo(
		() =>
			isMixed || isRitualOnly
				? tasks.filter((task) => task.taskKind === 'ritual_instance')
				: tasks,
		[isMixed, isRitualOnly, tasks]
	);

	// Create state lookup map
	const stateMap = useMemo(() => {
		const map = new Map<string, ProjectState>();
		states.forEach((s) => map.set(s.id, s));
		return map;
	}, [states]);

	// Build task map by date (use scheduledDate as fallback for ritual instances)
	const tasksByDate = useMemo(() => {
		const map = new Map<string, Task[]>();
		displayedTasks.forEach((task) => {
			const dateStr = task.dueDate || task.scheduledDate;
			if (dateStr) {
				const key = formatDateKey(new Date(dateStr));
				const existing = map.get(key) || [];
				existing.push(task);
				map.set(key, existing);
			}
		});
		return map;
	}, [displayedTasks]);

	// Build calendar grid
	const calendarDays = useMemo(() => {
		const days: CalendarDay[] = [];
		const today = new Date();
		const monthStart = startOfMonth(currentMonth);
		const monthEnd = endOfMonth(currentMonth);

		// Find the start of the calendar grid (Sunday before month start)
		const gridStart = new Date(monthStart);
		gridStart.setDate(gridStart.getDate() - gridStart.getDay());

		// Find the end of the calendar grid (Saturday after month end)
		const gridEnd = new Date(monthEnd);
		gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

		// Build the days
		const current = new Date(gridStart);
		while (current <= gridEnd) {
			const dateKey = formatDateKey(current);
			days.push({
				date: new Date(current),
				isCurrentMonth: current.getMonth() === currentMonth.getMonth(),
				isToday: isSameDay(current, today),
				tasks: tasksByDate.get(dateKey) || [],
			});
			current.setDate(current.getDate() + 1);
		}

		return days;
	}, [currentMonth, tasksByDate]);

	// Navigation handlers
	const goToPrevMonth = useCallback(() => {
		setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
	}, []);

	const goToNextMonth = useCallback(() => {
		setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
	}, []);

	const goToToday = useCallback(() => {
		setCurrentMonth(startOfMonth(new Date()));
	}, []);

	// Handle task click (opens side panel for quick view)
	const handleTaskClick = useCallback(
		(task: Task, e: React.MouseEvent) => {
			e.stopPropagation();
			if (isRitualOnly && task.taskKind === 'ritual_instance' && project) {
				router.push(`/workspace/tasks/${project.id}/tasks/${task.id}?focusIntent=${getRitualFocusIntent(task)}`);
				return;
			}
			onTaskClick?.(task);
		},
		[isRitualOnly, onTaskClick, project, router]
	);

	// Handle task identifier click (navigates to task page)
	const handleIdentifierClick = useCallback(
		(task: Task, e: React.MouseEvent) => {
			e.stopPropagation();
			if (isRitualOnly && task.taskKind === 'ritual_instance' && project) {
				router.push(`/workspace/tasks/${project.id}/tasks/${task.id}?focusIntent=${getRitualFocusIntent(task)}`);
				return;
			}
			onTaskIdentifierClick?.(task);
		},
		[isRitualOnly, onTaskIdentifierClick, project, router]
	);

	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}

	const monthLabel = currentMonth.toLocaleDateString(undefined, {
		month: 'long',
		year: 'numeric',
	});

	// Split days into weeks for grid
	const weeks: CalendarDay[][] = [];
	for (let i = 0; i < calendarDays.length; i += 7) {
		weeks.push(calendarDays.slice(i, i + 7));
	}

	return (
		<Box sx={{ p: 2 }} data-testid="project-calendar-view">
			{isMixed && (
				<Alert severity="info" sx={{ mb: 2 }} data-testid="mixed-routine-operations-guidance">
					Routine Operations only shows ritual runs. Planned standard-task work stays under the mixed Planned Work surfaces.
					<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
						<Button size="small" variant="outlined" onClick={() => router.push(`/workspace/tasks/${params.id}?view=today`)} data-testid="mixed-routine-operations-open-today">
							Open Today
						</Button>
						<Button size="small" variant="outlined" onClick={() => router.push(`/workspace/tasks/${params.id}?view=settings&tab=rituals`)} data-testid="mixed-routine-operations-open-settings">
							Open Ritual Templates
						</Button>
					</Box>
				</Alert>
			)}

			{isRitualOnly && (
				<Alert severity="info" sx={{ mb: 2 }} data-testid="ritual-calendar-guidance">
					Calendar is the schedule lens for ritual operations. Open any live run directly from here, and use Project Settings → Rituals when you need to edit the reusable template instead of the instance.
				</Alert>
			)}

			{/* Header with navigation */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					mb: 2,
				}}
			>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<IconButton onClick={goToPrevMonth} size="small" data-testid="calendar-prev-month">
						<ChevronLeftIcon />
					</IconButton>
					<Typography variant="h6" sx={{ minWidth: 180, textAlign: 'center' }}>
						{monthLabel}
					</Typography>
					<IconButton onClick={goToNextMonth} size="small" data-testid="calendar-next-month">
						<ChevronRightIcon />
					</IconButton>
				</Box>
				<IconButton onClick={goToToday} size="small" title="Go to today" data-testid="calendar-today">
					<TodayIcon />
				</IconButton>
			</Box>

			{/* Calendar Grid */}
			<Paper
				sx={{
					...colors.bg.paper.style,
					border: 1,
					...colors.border.default.style,
					overflow: 'hidden',
				}}
			>
				{/* Day headers */}
				<Box
					sx={{
						display: 'grid',
						gridTemplateColumns: 'repeat(7, 1fr)',
						borderBottom: 1,
						...colors.border.default.style,
						...colors.bg.elevated.style,
					}}
				>
					{DAY_NAMES.map((dayName) => (
						<Box
							key={dayName}
							sx={{
								py: 1,
								textAlign: 'center',
								borderRight: 1,
								...colors.border.default.style,
								'&:last-child': { borderRight: 0 },
							}}
						>
							<Typography variant="caption" sx={{ fontWeight: 600 }}>
								{dayName}
							</Typography>
						</Box>
					))}
				</Box>

				{/* Week rows */}
				{weeks.map((week, weekIdx) => (
					<Box
						key={weekIdx}
						sx={{
							display: 'grid',
							gridTemplateColumns: 'repeat(7, 1fr)',
							borderBottom: 1,
							...colors.border.default.style,
							'&:last-child': { borderBottom: 0 },
						}}
					>
						{week.map((day, dayIdx) => (
							<Box
								key={dayIdx}
								sx={{
									minHeight: CELL_MIN_HEIGHT,
									p: 0.5,
									borderRight: 1,
									...colors.border.default.style,
									'&:last-child': { borderRight: 0 },
									...(day.isCurrentMonth
										? colors.bg.paper.style
										: { backgroundColor: 'rgba(128,128,128,0.05)' }),
								}}
							>
									{/* Day number */}
								<Box
									sx={{
										display: 'flex',
										justifyContent: 'flex-end',
										mb: 0.5,
									}}
								>
									<Box
										sx={{
											width: 24,
											height: 24,
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											borderRadius: '50%',
											...(day.isToday
												? {
													backgroundColor: 'primary.main',
													color: '#fff',
												}
												: {}),
										}}
									>
										<Typography
											variant="caption"
											sx={{
												fontWeight: day.isToday ? 600 : 400,
												...(day.isCurrentMonth
													? colors.text.primary.style
													: colors.text.disabled.style),
												...(day.isToday ? { color: '#fff' } : {}),
											}}
										>
											{day.date.getDate()}
										</Typography>
									</Box>
								</Box>

								{/* Tasks */}
								<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
									{(() => {
										// For mixed projects, group ritual tasks by definition
										if (isMixed) {
											const ritualTasks = day.tasks.filter((t) => t.taskKind === 'ritual_instance');
											const standardTasks = day.tasks.filter((t) => t.taskKind !== 'ritual_instance');

											// Group rituals by definition
											const ritualGroups = new Map<string, Task[]>();
											ritualTasks.forEach((t) => {
												const defId = t.ritualDefinitionId || 'unknown';
												const group = ritualGroups.get(defId) || [];
												group.push(t);
												ritualGroups.set(defId, group);
											});

											const elements: React.ReactNode[] = [];
											let shown = 0;
											const maxVisible = 3;

											// Show ritual groups as compact summary chips
											ritualGroups.forEach((groupTasks, defId) => {
												if (shown >= maxVisible) return;
												shown++;
												const completedCount = groupTasks.filter((t) => {
													const s = stateMap.get(t.stateId);
													return s?.name === 'Verified' || s?.name === 'Done';
												}).length;
												const defName = getRitualDefName(groupTasks[0]);
												elements.push(
													<Chip
														key={`ritual-${defId}`}
														icon={<RepeatIcon sx={{ fontSize: 12, color: '#fff' }} />}
														label={`${defName} ${completedCount}/${groupTasks.length}`}
														title={defName}
														size="small"
														sx={{
															height: 20,
															fontSize: '0.7rem',
															backgroundColor: completedCount === groupTasks.length ? '#22c55e' : '#f59e0b',
															color: '#fff',
															cursor: 'pointer',
															'&:hover': { opacity: 0.8 },
														}}
																			data-testid={`calendar-ritual-group-${groupTasks[0]?.id}`}
														onClick={(e) => {
															e.stopPropagation();
																if (groupTasks[0]) handleTaskClick(groupTasks[0], e);
														}}
													/>
												);
											});

											// Show standard tasks
											standardTasks.slice(0, maxVisible - shown).forEach((task) => {
												shown++;
												const state = stateMap.get(task.stateId);
												elements.push(
													<Chip
														key={task.id}
														label={task.identifier}
														size="small"
															onClick={(e) => handleTaskClick(task, e)}
														sx={{
															height: 20,
															fontSize: '0.7rem',
															backgroundColor: state?.color || '#6b7280',
															color: '#fff',
															cursor: 'pointer',
															'&:hover': { opacity: 0.8 },
														}}
														data-testid={`calendar-task-${task.id}`}
													/>
												);
											});

											const totalTasks = day.tasks.length;
											if (totalTasks > maxVisible) {
												elements.push(
													<Typography
														key="more"
														variant="caption"
														sx={{ ...colors.text.secondary.style, pl: 0.5 }}
													>
														+{totalTasks - shown} more
													</Typography>
												);
											}

											return elements;
										}

										// Non-mixed: show all tasks as before
										return (
											<>
												{day.tasks.slice(0, 3).map((task) => {
													const state = stateMap.get(task.stateId);
													const label = task.taskKind === 'ritual_instance'
														? getRitualDefName(task)
														: task.identifier;
													return (
														<Chip
															key={task.id}
															icon={task.taskKind === 'ritual_instance' ? <RepeatIcon sx={{ fontSize: 12, color: '#fff' }} /> : undefined}
															label={label}
															title={task.taskKind === 'ritual_instance' ? task.title : undefined}
															size="small"
															onClick={(e) => handleTaskClick(task, e)}
															sx={{
																height: 20,
																fontSize: '0.7rem',
																backgroundColor: state?.color || '#6b7280',
																color: '#fff',
																cursor: 'pointer',
																'&:hover': { opacity: 0.8 },
															}}
															data-testid={`calendar-task-${task.id}`}
														/>
													);
												})}
												{day.tasks.length > 3 && (
													<Typography
														variant="caption"
														sx={{ ...colors.text.secondary.style, pl: 0.5 }}
													>
														+{day.tasks.length - 3} more
													</Typography>
												)}
											</>
										);
									})()}
								</Box>
							</Box>
						))}
					</Box>
				))}
			</Paper>

			{displayedTasks.length === 0 && (
				<Box sx={{ mt: 2 }} data-testid="routine-operations-empty-state">
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						{isMixed
							? 'No ritual runs are scheduled right now. Use Today for due-now work or Ritual Templates to plan the next recurring run.'
							: 'No ritual runs are scheduled right now.'}
					</Typography>
				</Box>
			)}

			{/* Tasks without due dates */}
			{displayedTasks.filter((t) => !t.dueDate && !t.scheduledDate).length > 0 && (
				<Box sx={{ mt: 2 }}>
					<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
						{displayedTasks.filter((t) => !t.dueDate && !t.scheduledDate).length} task
						{displayedTasks.filter((t) => !t.dueDate && !t.scheduledDate).length !== 1 ? 's' : ''} without due dates
					</Typography>
				</Box>
			)}

			{/* New Ritual FAB - helps users discover ritual creation from calendar */}
			{showRitualFab && (
				<Tooltip title="Create a new recurring ritual definition">
					<Fab
						color="primary"
						variant="extended"
						sx={{
							position: 'fixed',
							bottom: 24,
							right: 24,
							zIndex: 1000,
						}}
						onClick={() => router.push(`/workspace/tasks/${params.id}/rituals/new`)}
						data-testid="calendar-new-ritual-fab"
					>
						<AddIcon sx={{ mr: 1 }} />
						New Ritual
					</Fab>
				</Tooltip>
			)}
		</Box>
	);
}

export default CalendarView;
