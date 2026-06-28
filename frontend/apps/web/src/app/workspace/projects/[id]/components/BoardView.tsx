/**
 * BoardView Component
 * Kanban board with drag-and-drop task management
 * Feature: 017-realtime-task-collaboration-system (T123)
 *
 * Features:
 * - Drag-and-drop tasks between state columns
 * - Task cards with identifier, title, assignees
 * - Add task button per column
 * - Column header with task count
 * - Theme system colors (no hardcoded colors)
 * - Uses @dnd-kit for smooth DnD experience
 */

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
	DndContext,
	DragOverlay,
	closestCorners,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragStartEvent,
	type DragEndEvent,
	type DragOverEvent,
	type UniqueIdentifier,
} from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
	Alert,
	Box,
	Typography,
	Chip,
	IconButton,
	TextField,
	Button,
	CircularProgress,
	Avatar,
	AvatarGroup,
	Paper,
	Tooltip,
	LinearProgress,
	Select,
	MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import RepeatIcon from '@mui/icons-material/Repeat';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import { useRouter, useParams } from 'next/navigation';
import { moveTask, createTask, listProjectMembers, type Task, type ProjectState, type ProjectMember } from 'apis';

// =============================================================================
// Types
// =============================================================================

interface TasksByState {
	[stateId: string]: Task[];
}

// =============================================================================
// Task Card Component
// =============================================================================

interface TaskCardProps {
	task: Task;
	onClick?: () => void;
	onIdentifierClick?: () => void;
	isDragging?: boolean;
}

function TaskCard({ task, onClick, onIdentifierClick, isDragging }: TaskCardProps) {
	const colors = useThemeColors();

	const handleIdentifierClick = (e: React.MouseEvent) => {
		e.stopPropagation(); // Prevent card click
		onIdentifierClick?.();
	};

	return (
		<Box
			onClick={onClick}
			sx={{
				p: 2,
				borderRadius: 1,
				...colors.bg.paper.style,
				border: 1,
				...colors.border.default.style,
				cursor: isDragging ? 'grabbing' : 'pointer',
				opacity: isDragging ? 0.8 : 1,
				boxShadow: isDragging ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
				'&:hover': {
					...colors.border.primary.style,
				},
			}}
			data-testid={`task-card-${task.id}`}
		>
			{/* Task Identifier - Click to navigate to task page */}
			<Typography
				variant="caption"
				onClick={handleIdentifierClick}
				sx={{ 
					...colors.text.secondary.style, 
					fontWeight: 500,
					cursor: 'pointer',
					'&:hover': {
						color: 'primary.main',
						textDecoration: 'underline',
					},
				}}
				data-testid={`task-identifier-link-${task.id}`}
			>
				{task.identifier}
			</Typography>

			{/* Task Title */}
			<Typography
				variant="body2"
				sx={{
					...colors.text.primary.style,
					mt: 0.5,
					display: '-webkit-box',
					WebkitLineClamp: 2,
					WebkitBoxOrient: 'vertical',
					overflow: 'hidden',
				}}
			>
				{task.title}
			</Typography>

			{/* Task Meta (Assignees, Due Date) */}
			{(task.assignees.length > 0 || task.dueDate) && (
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
					{task.assignees.length > 0 && (
						<AvatarGroup max={3} sx={{ '& .MuiAvatar-root': { width: 24, height: 24, fontSize: '0.75rem' } }}>
							{task.assignees.map((a) => (
								<Avatar key={a.employeeId} sx={{ width: 24, height: 24 }}>
									{a.employeeId.slice(0, 2).toUpperCase()}
								</Avatar>
							))}
						</AvatarGroup>
					)}
					{task.dueDate && (
						<Typography variant="caption" sx={{ ...colors.text.hint.style, ml: 'auto' }}>
							{new Date(task.dueDate).toLocaleDateString()}
						</Typography>
					)}
				</Box>
			)}
		</Box>
	);
}

// =============================================================================
// Sortable Task Card Wrapper
// =============================================================================

interface SortableTaskCardProps {
	task: Task;
	onClick?: () => void;
	onIdentifierClick?: () => void;
}

function SortableTaskCard({ task, onClick, onIdentifierClick }: SortableTaskCardProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: task.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<Box ref={setNodeRef} style={style} {...attributes} {...listeners} sx={{ mb: 1 }}>
			<TaskCard task={task} onClick={onClick} onIdentifierClick={onIdentifierClick} isDragging={isDragging} />
		</Box>
	);
}

// =============================================================================
// Column Component
// =============================================================================

interface BoardColumnProps {
	state: ProjectState;
	tasks: Task[];
	onAddTask: (stateId: string, title: string, assigneeIds?: string[]) => Promise<void>;
	onTaskClick: (task: Task) => void;
	onTaskIdentifierClick: (task: Task) => void;
	members: ProjectMember[];
}

function BoardColumn({ state, tasks, onAddTask, onTaskClick, onTaskIdentifierClick, members }: BoardColumnProps) {
	const colors = useThemeColors();
	const [isAddingTask, setIsAddingTask] = useState(false);
	const [newTaskTitle, setNewTaskTitle] = useState('');
	const [selectedAssignee, setSelectedAssignee] = useState<string>('');
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleAddTask = async () => {
		if (!newTaskTitle.trim()) return;

		setIsSubmitting(true);
		try {
			const assigneeIds = selectedAssignee ? [selectedAssignee] : undefined;
			await onAddTask(state.id, newTaskTitle.trim(), assigneeIds);
			setNewTaskTitle('');
			setSelectedAssignee('');
			setIsAddingTask(false);
		} catch (error) {
			console.error('Failed to create task:', error);
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleAddTask();
		} else if (e.key === 'Escape') {
			setIsAddingTask(false);
			setNewTaskTitle('');
		}
	};

	const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

	return (
		<Box
			sx={{
				width: 300,
				flexShrink: 0,
				display: 'flex',
				flexDirection: 'column',
				maxHeight: '100%',
				borderRadius: 2,
				...colors.bg.default.style,
			}}
			data-testid={`board-column-${state.id}`}
		>
			{/* Column Header */}
			<Box
				sx={{
					p: 2,
					display: 'flex',
					alignItems: 'center',
					gap: 1,
				}}
			>
				<Box
					sx={{
						width: 12,
						height: 12,
						borderRadius: '50%',
						backgroundColor: state.color,
						flexShrink: 0,
					}}
				/>
				<Typography
					variant="subtitle2"
					sx={{ ...colors.text.primary.style, fontWeight: 600, flex: 1 }}
				>
					{state.name}
				</Typography>
				<Chip
					label={tasks.length}
					size="small"
					variant="outlined"
					sx={{ height: 20, '& .MuiChip-label': { px: 1, fontSize: '0.75rem' } }}
				/>
			</Box>

			{/* Tasks Container */}
			<Box
				sx={{
					flex: 1,
					overflow: 'auto',
					px: 1,
					pb: 1,
					minHeight: 100,
				}}
			>
				<SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
					{tasks.map((task) => (
						<SortableTaskCard
							key={task.id}
							task={task}
							onClick={() => onTaskClick(task)}
							onIdentifierClick={() => onTaskIdentifierClick(task)}
						/>
					))}
				</SortableContext>

				{tasks.length === 0 && !isAddingTask && (
					<Typography
						variant="body2"
						sx={{
							...colors.text.disabled.style,
							textAlign: 'center',
							py: 4,
						}}
					>
						No tasks
					</Typography>
				)}
			</Box>

			{/* Add Task Section */}
			<Box sx={{ p: 1 }}>
				{isAddingTask ? (
					<Paper
						sx={{
							p: 1,
							...colors.bg.paper.style,
							border: 1,
							...colors.border.default.style,
						}}
					>
						<TextField
							fullWidth
							autoFocus
							size="small"
							placeholder="Task title..."
							value={newTaskTitle}
							onChange={(e) => setNewTaskTitle(e.target.value)}
							onKeyDown={handleKeyDown}
							disabled={isSubmitting}
							sx={{ mb: 1 }}
							data-testid="new-task-input"
						/>
						{/* Assignee quick-pick */}
						{members.length > 0 && (
							<Select
								size="small"
								displayEmpty
								value={selectedAssignee}
								onChange={(e) => setSelectedAssignee(e.target.value)}
								disabled={isSubmitting}
								data-testid="new-task-assignee-select"
								sx={{ mb: 1, width: '100%', fontSize: '0.8rem' }}
								renderValue={(val) => {
									if (!val) return (
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ...colors.text.hint.style }}>
											<PersonAddIcon sx={{ fontSize: 14 }} />
											<span>Assignee (optional)</span>
										</Box>
									);
									const m = members.find((mm) => mm.employeeId === val);
									return m ? m.employeeId.slice(0, 8) : val;
								}}
							>
								<MenuItem value="">
									<Typography variant="body2" sx={{ ...colors.text.hint.style, fontSize: '0.8rem' }}>No assignee</Typography>
								</MenuItem>
								{members.map((m) => (
									<MenuItem key={m.employeeId} value={m.employeeId}>
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
											<Avatar sx={{ width: 20, height: 20, fontSize: '0.65rem' }}>
												{m.employeeId.slice(0, 2).toUpperCase()}
											</Avatar>
											<Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{m.employeeId.slice(0, 8)}</Typography>
										</Box>
									</MenuItem>
								))}
							</Select>
						)}
						<Box sx={{ display: 'flex', gap: 1 }}>
							<Button
								size="small"
								variant="contained"
								onClick={handleAddTask}
								disabled={!newTaskTitle.trim() || isSubmitting}
								data-testid="add-task-submit-btn"
							>
								{isSubmitting ? <CircularProgress size={16} /> : 'Add'}
							</Button>
							<IconButton
								size="small"
								onClick={() => {
									setIsAddingTask(false);
									setNewTaskTitle('');
									setSelectedAssignee('');
								}}
								disabled={isSubmitting}
								data-testid="add-task-cancel-btn"
							>
								<CloseIcon fontSize="small" />
							</IconButton>
						</Box>
					</Paper>
				) : (
					<Button
						fullWidth
						size="small"
						startIcon={<AddIcon />}
						onClick={() => setIsAddingTask(true)}
						sx={{
							justifyContent: 'flex-start',
							...colors.text.secondary.style,
							'&:hover': {
								...colors.bg.active.style,
							},
						}}
						data-testid={`add-task-btn-${state.id}`}
					>
						Add task
					</Button>
				)}
			</Box>
		</Box>
	);
}

// =============================================================================
// Sprint Date Range Helpers
// =============================================================================

type SprintRange = 'this-week' | 'next-week' | 'this-month' | 'all';

function getMonday(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay();
	const diff = d.getDate() - day + (day === 0 ? -6 : 1);
	d.setDate(diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

function getSprintDateRange(range: SprintRange): { start: Date; end: Date } | null {
	if (range === 'all') return null;

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	if (range === 'this-week') {
		const start = getMonday(today);
		const end = new Date(start);
		end.setDate(end.getDate() + 6);
		end.setHours(23, 59, 59, 999);
		return { start, end };
	}
	if (range === 'next-week') {
		const start = getMonday(today);
		start.setDate(start.getDate() + 7);
		const end = new Date(start);
		end.setDate(end.getDate() + 6);
		end.setHours(23, 59, 59, 999);
		return { start, end };
	}
	// this-month
	const start = new Date(today.getFullYear(), today.getMonth(), 1);
	const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
	return { start, end };
}

function formatRangeLabel(range: SprintRange): string {
	const dr = getSprintDateRange(range);
	if (!dr) return 'All Tasks';
	const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	return `${fmt(dr.start)} – ${fmt(dr.end)}`;
}

function getTaskDeadline(task: Task): Date | null {
	const dateStr = task.dueDate || task.scheduledDate;
	if (!dateStr) return null;
	return new Date(dateStr);
}

function isTaskInRange(task: Task, range: { start: Date; end: Date } | null): boolean {
	if (!range) return true;
	const d = getTaskDeadline(task);
	if (!d) return true; // tasks without dates always show
	return d >= range.start && d <= range.end;
}

// =============================================================================
// Daily Load Cell Types
// =============================================================================

interface DailyLoad {
	date: Date;
	dayLabel: string;
	totalTasks: number;
	ritualTasks: number;
	standardTasks: number;
	uniqueAssigneeIds: string[];
	ratio: number; // tasks per assignee
	severity: 'low' | 'medium' | 'high';
	isToday: boolean;
}

function computeDailyLoads(tasks: Task[], range: { start: Date; end: Date }): DailyLoad[] {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const days: DailyLoad[] = [];
	const current = new Date(range.start);

	while (current <= range.end) {
		const dayStart = new Date(current);
		dayStart.setHours(0, 0, 0, 0);
		const dayEnd = new Date(current);
		dayEnd.setHours(23, 59, 59, 999);

		// Skip weekends
		const dow = current.getDay();
		if (dow !== 0 && dow !== 6) {
			const dayTasks = tasks.filter((t) => {
				const d = getTaskDeadline(t);
				return d && d >= dayStart && d <= dayEnd;
			});

			const assigneeSet = new Set<string>();
			dayTasks.forEach((t) => t.assignees.forEach((a) => assigneeSet.add(a.employeeId)));
			const uniqueAssigneeIds = Array.from(assigneeSet);

			const ritual = dayTasks.filter((t) => t.taskKind === 'ritual_instance').length;
			const total = dayTasks.length;
			const assigneeCount = uniqueAssigneeIds.length || 1; // avoid div by 0
			const ratio = total / assigneeCount;

			let severity: 'low' | 'medium' | 'high' = 'low';
			if (ratio > 3) severity = 'high';
			else if (ratio > 1.5) severity = 'medium';

			days.push({
				date: new Date(current),
				dayLabel: current.toLocaleDateString(undefined, { weekday: 'short' }),
				totalTasks: total,
				ritualTasks: ritual,
				standardTasks: total - ritual,
				uniqueAssigneeIds,
				ratio,
				severity,
				isToday: dayStart.getTime() === today.getTime(),
			});
		}

		current.setDate(current.getDate() + 1);
	}

	return days;
}

// =============================================================================
// Sprint Capacity Banner
// =============================================================================

interface SprintCapacityBannerProps {
	tasks: Task[];
	sprintRange: SprintRange;
	onSprintRangeChange: (range: SprintRange) => void;
}

function SprintCapacityBanner({ tasks, sprintRange, onSprintRangeChange }: SprintCapacityBannerProps) {
	const colors = useThemeColors();
	const router = useRouter();
	const params = useParams();
	const projectId = params.id as string;

	const dateRange = getSprintDateRange(sprintRange);

	const dailyLoads = useMemo(() => {
		if (!dateRange) return [];
		return computeDailyLoads(tasks, dateRange);
	}, [tasks, dateRange]);

	const summary = useMemo(() => {
		const tasksInRange = tasks.filter((t) => isTaskInRange(t, dateRange));
		const ritual = tasksInRange.filter((t) => t.taskKind === 'ritual_instance').length;
		const standard = tasksInRange.length - ritual;
		const peakDay = dailyLoads.reduce<DailyLoad | null>(
			(peak, d) => (!peak || d.totalTasks > peak.totalTasks ? d : peak),
			null
		);
		return { ritual, standard, total: tasksInRange.length, peakDay };
	}, [tasks, dateRange, dailyLoads]);

	const severityColor = (s: 'low' | 'medium' | 'high') =>
		s === 'high' ? 'error.main' : s === 'medium' ? 'warning.main' : 'success.main';

	return (
		<Paper
			sx={{
				...colors.bg.paper.style,
				border: 1,
				...colors.border.default.style,
				borderRadius: 2,
				overflow: 'hidden',
			}}
			data-testid="sprint-capacity-banner"
		>
			{/* Header row: selector + summary + calendar link */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					px: 2,
					py: 1,
					gap: 2,
					flexWrap: 'wrap',
				}}
			>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<Select
						size="small"
						value={sprintRange}
						onChange={(e) => onSprintRangeChange(e.target.value as SprintRange)}
						sx={{ fontSize: '0.8rem', height: 32, minWidth: 120 }}
						data-testid="sprint-range-selector"
					>
						<MenuItem value="this-week">This Week</MenuItem>
						<MenuItem value="next-week">Next Week</MenuItem>
						<MenuItem value="this-month">This Month</MenuItem>
						<MenuItem value="all">All Tasks</MenuItem>
					</Select>
					{dateRange && (
						<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
							{formatRangeLabel(sprintRange)}
						</Typography>
					)}
				</Box>

				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
					{summary.total > 0 && (
						<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
							{summary.standard} standard{summary.ritual > 0 && (
								<>
									{' · '}
									<Box component="span" sx={{ color: 'warning.main' }}>
										{summary.ritual} ritual
									</Box>
								</>
							)}
							{summary.peakDay && summary.peakDay.totalTasks > 0 && (
								<>
									{' · peak '}
									<Box component="span" sx={{ color: severityColor(summary.peakDay.severity), fontWeight: 600 }}>
										{summary.peakDay.dayLabel} ({summary.peakDay.totalTasks})
									</Box>
								</>
							)}
						</Typography>
					)}
					<Button
						size="small"
						startIcon={<CalendarMonthIcon sx={{ fontSize: 16 }} />}
						onClick={() => router.push(`/workspace/tasks/${projectId}?view=calendar`)}
						sx={{ ...colors.text.secondary.style, textTransform: 'none', fontSize: '0.75rem' }}
						data-testid="capacity-calendar-link"
					>
						Calendar
					</Button>
				</Box>
			</Box>

			{/* Daily load cells */}
			{dailyLoads.length > 0 && (
				<Box
					sx={{
						display: 'flex',
						gap: 0,
						px: 2,
						pb: 1.5,
						overflowX: 'auto',
					}}
				>
					{dailyLoads.map((day) => (
						<Tooltip
							key={day.date.toISOString()}
							title={`${day.totalTasks} tasks (${day.ritualTasks} ritual, ${day.standardTasks} standard) · ${day.uniqueAssigneeIds.length} assignee${day.uniqueAssigneeIds.length !== 1 ? 's' : ''}`}
						>
							<Box
								sx={{
									flex: 1,
									minWidth: 56,
									maxWidth: 100,
									textAlign: 'center',
									py: 0.5,
									px: 0.5,
									borderRadius: 1,
									...(day.isToday ? { border: 2, borderColor: 'primary.main' } : {}),
								}}
								data-testid={`load-cell-${day.dayLabel}`}
							>
								{/* Day label */}
								<Typography
									variant="caption"
									sx={{
										fontWeight: day.isToday ? 700 : 500,
										...colors.text.secondary.style,
										fontSize: '0.65rem',
									}}
								>
									{day.dayLabel}
								</Typography>

								{/* Assignee avatars */}
								<Box sx={{ display: 'flex', justifyContent: 'center', my: 0.25, minHeight: 20 }}>
									{day.uniqueAssigneeIds.length > 0 ? (
										<AvatarGroup
											max={3}
											sx={{
												'& .MuiAvatar-root': {
													width: 16,
													height: 16,
													fontSize: '0.55rem',
													border: '1px solid',
													borderColor: 'background.paper',
												},
											}}
										>
											{day.uniqueAssigneeIds.map((id) => (
												<Avatar key={id} sx={{ width: 16, height: 16 }}>
													{id.slice(0, 1).toUpperCase()}
												</Avatar>
											))}
										</AvatarGroup>
									) : (
										<Box sx={{ height: 16 }} />
									)}
								</Box>

								{/* Task count */}
								<Typography
									variant="caption"
									sx={{ fontWeight: 600, fontSize: '0.7rem', ...colors.text.primary.style }}
								>
									{day.totalTasks}
									{day.ritualTasks > 0 && (
										<Box component="span" sx={{ color: 'warning.main', fontSize: '0.6rem' }}>
											<RepeatIcon sx={{ fontSize: 10, verticalAlign: 'middle', mx: 0.25 }} />
											{day.ritualTasks}
										</Box>
									)}
								</Typography>

								{/* Density bar */}
								<LinearProgress
									variant="determinate"
									value={Math.min(day.ratio * 33, 100)}
									color={day.severity === 'high' ? 'error' : day.severity === 'medium' ? 'warning' : 'success'}
									sx={{ height: 3, borderRadius: 1, mt: 0.25 }}
								/>
							</Box>
						</Tooltip>
					))}
				</Box>
			)}
		</Paper>
	);
}

// =============================================================================
// Main BoardView Component
// =============================================================================

interface BoardViewProps {
	onTaskClick?: (task: Task) => void;
	onTaskIdentifierClick?: (task: Task) => void;
}

export function BoardView({ onTaskClick, onTaskIdentifierClick }: BoardViewProps) {
	const { project, states, levels, tasks, loading, refreshTasks } = useProjectContext();
	const [activeTask, setActiveTask] = useState<Task | null>(null);
	const [isMoving, setIsMoving] = useState(false);
	const [sprintRange, setSprintRange] = useState<SprintRange>('this-week');
	const [members, setMembers] = useState<ProjectMember[]>([]);

	const isMixed = project?.collaborationMode === 'mixed';
	const isRitualOnly = project?.collaborationMode === 'ritual';

	// Fetch project members for assignee picker
	React.useEffect(() => {
		if (project?.id) {
			listProjectMembers(project.id)
				.then((resp) => setMembers(resp.members))
				.catch(() => setMembers([]));
		}
	}, [project?.id]);

	// Separate states by lane for mixed projects
	const standardStates = useMemo(() => {
		if (!isMixed) return states;
		return states.filter((s) => s.stateType === 'standard');
	}, [states, isMixed]);

	// Configure DnD sensors
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 8,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		})
	);

	// Group tasks by state (filtered by sprint range for mixed projects)
	const dateRange = useMemo(() => getSprintDateRange(sprintRange), [sprintRange]);

	const tasksByState = useMemo<TasksByState>(() => {
		const grouped: TasksByState = {};
		states.forEach((s) => {
			grouped[s.id] = [];
		});
		tasks.forEach((t) => {
			if (!grouped[t.stateId]) return;
			// In mixed mode, filter standard tasks by sprint range
			// Ritual tasks are excluded from board columns (shown in banner only)
			if (isMixed) {
				if (t.taskKind === 'ritual_instance') return; // don't show rituals in columns
				if (!isTaskInRange(t, dateRange)) return;
			}
			grouped[t.stateId].push(t);
		});
		return grouped;
	}, [states, tasks, isMixed, dateRange]);

	// Find container (state) for a task
	const findContainer = useCallback(
		(id: UniqueIdentifier): string | undefined => {
			if (states.some((s) => s.id === id)) {
				return id as string;
			}
			return Object.keys(tasksByState).find((stateId) =>
				tasksByState[stateId].some((t) => t.id === id)
			);
		},
		[states, tasksByState]
	);

	// Handle drag start
	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const { active } = event;
			const task = tasks.find((t) => t.id === active.id);
			if (task) {
				setActiveTask(task);
			}
		},
		[tasks]
	);

	// Handle drag over (for visual feedback)
	const handleDragOver = useCallback((_event: DragOverEvent) => {
		// Optional: implement real-time position updates
	}, []);

	// Helper: get state type for cross-lane validation
	const getStateType = useCallback(
		(stateId: string): string | undefined => {
			return states.find((s) => s.id === stateId)?.stateType;
		},
		[states]
	);

	// Handle drag end
	const handleDragEnd = useCallback(
		async (event: DragEndEvent) => {
			const { active, over } = event;
			setActiveTask(null);

			if (!over || !project) return;

			const activeId = active.id as string;
			const overId = over.id as string;

			const activeContainer = findContainer(activeId);
			const overContainer = findContainer(overId);

			if (!activeContainer || !overContainer) return;

			// Block cross-lane DnD in mixed projects
			if (isMixed && getStateType(activeContainer) !== getStateType(overContainer)) {
				return;
			}

			// Check if task is moved to a different state
			if (activeContainer !== overContainer) {
				// Moving to different column
				setIsMoving(true);
				try {
					await moveTask(activeId, overContainer);
					await refreshTasks();
				} catch (error) {
					console.error('Failed to move task:', error);
				} finally {
					setIsMoving(false);
				}
			}
			// TODO: Handle reordering within same column if needed
		},
		[findContainer, project, refreshTasks, isMixed, getStateType]
	);

	// Handle add task
	const handleAddTask = useCallback(
		async (stateId: string, title: string, assigneeIds?: string[]) => {
			if (!project) return;

			// Find the initial level (depth 0) or first available level
			const initialLevel = levels.find((l) => l.depth === 0) || levels[0];
			if (!initialLevel) {
				console.error('No levels configured for this project');
				return;
			}

			await createTask({
				projectId: project.id,
				title,
				levelId: initialLevel.id,
				stateId: stateId,
				assigneeEmployeeIds: assigneeIds,
			});
			await refreshTasks();
		},
		[project, levels, refreshTasks]
	);

	// Handle task click
	const handleTaskClick = useCallback(
		(task: Task) => {
			onTaskClick?.(task);
		},
		[onTaskClick]
	);

	// Handle task identifier click
	const handleTaskIdentifierClick = useCallback(
		(task: Task) => {
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

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCorners}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragEnd={handleDragEnd}
		>
			<Box
				sx={{
					display: 'flex',
					flexDirection: isMixed ? 'column' : 'row',
					gap: 2,
					p: 2,
					overflowX: isMixed ? 'hidden' : 'auto',
					overflowY: isMixed ? 'auto' : 'hidden',
					minHeight: '400px',
					height: '100%',
				}}
				data-testid="project-board-view"
			>
				{isRitualOnly && (
					<Alert severity="info" sx={{ mb: 1, width: '100%', flexBasis: '100%' }} data-testid="ritual-board-secondary-alert">
						This board is secondary for ritual projects. Use Today, Review, Health, Calendar, and Worklist to run daily ritual operations, then return here only if you need kanban context.
					</Alert>
				)}

				{isMixed && (
					<SprintCapacityBanner
						tasks={tasks}
						sprintRange={sprintRange}
						onSprintRangeChange={setSprintRange}
					/>
				)}

				<Box
					sx={{
						display: 'flex',
						gap: 2,
						overflowX: 'auto',
						flex: 1,
						minHeight: 0,
					}}
				>
					{(isMixed ? standardStates : states).map((state) => (
						<BoardColumn
							key={state.id}
							state={state}
							tasks={tasksByState[state.id] || []}
							onAddTask={handleAddTask}
							onTaskClick={handleTaskClick}
							onTaskIdentifierClick={handleTaskIdentifierClick}
							members={members}
						/>
					))}
				</Box>
			</Box>

			{/* Drag Overlay */}
			<DragOverlay>
				{activeTask && <TaskCard task={activeTask} isDragging />}
			</DragOverlay>

			{/* Loading overlay when moving */}
			{isMoving && (
				<Box
					sx={{
						position: 'fixed',
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						backgroundColor: 'rgba(0,0,0,0.3)',
						zIndex: 9999,
					}}
				>
					<CircularProgress />
				</Box>
			)}
		</DndContext>
	);
}

export default BoardView;
