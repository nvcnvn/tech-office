/**
 * ListView Component
 * Task list view with sortable table/DataGrid display
 * Feature: 017-realtime-task-collaboration-system (T124)
 *
 * Features:
 * - Sortable columns: identifier, title, state, assignees, due date
 * - Inline status change via select dropdown
 * - Click to open task detail
 * - Search/filter integration
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
	Alert,
	Box,
	Table,
	TableHead,
	TableBody,
	TableRow,
	TableCell,
	TableSortLabel,
	Typography,
	Select,
	MenuItem,
	Chip,
	Avatar,
	AvatarGroup,
	CircularProgress,
	TextField,
	InputAdornment,
	Paper,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import RepeatIcon from '@mui/icons-material/Repeat';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import { isRitualInstanceTask, moveTask, type Task, type ProjectState } from 'apis';

// =============================================================================
// Ritual state → next-action hint (keyed by StateCategory)
// =============================================================================
const RITUAL_STATE_HINTS: Record<string, string> = {
	scheduled:   'Opens on scheduled date',
	todo:        'Submit evidence to begin',
	in_progress: 'Submit all required evidence',
	submitted:   'Awaiting reviewer approval',
	verified:    'Completed and verified',
	overdue:     'Past deadline — submit now',
	missed:      'Deadline passed',
	skipped:     'Skipped',
};

// =============================================================================
// Types
// =============================================================================

type SortField = 'identifier' | 'title' | 'state' | 'dueDate' | 'updatedAt';
type SortDirection = 'asc' | 'desc';

interface ListViewProps {
	onTaskClick?: (task: Task) => void;
	onTaskIdentifierClick?: (task: Task) => void;
}

function startOfDay(date: Date): Date {
	const normalized = new Date(date);
	normalized.setHours(0, 0, 0, 0);
	return normalized;
}

function getRitualTemplateName(task: Task): string {
	const separatorIndex = task.title.lastIndexOf(' — ');
	return separatorIndex > 0 ? task.title.slice(0, separatorIndex) : task.title;
}

function getTaskDueTimestamp(task: Task): number {
	const dueValue = task.completionDeadline ?? (task.dueDate ? new Date(task.dueDate) : undefined);
	if (dueValue) {
		return dueValue.getTime();
	}

	if (task.scheduledDate) {
		return new Date(task.scheduledDate).getTime();
	}

	return Number.MAX_SAFE_INTEGER;
}

function getRitualOperationalBucket(task: Task): 'needs_resubmission' | 'pending_review' | 'overdue' | 'today' | 'upcoming' {
	if ((task.evidenceProgress?.rejectedCount ?? 0) > 0) {
		return 'needs_resubmission';
	}

	if ((task.evidenceProgress?.pendingReviewCount ?? 0) > 0) {
		return 'pending_review';
	}

	const now = new Date();
	const today = startOfDay(now).getTime();
	const scheduledDate = task.scheduledDate ? startOfDay(new Date(task.scheduledDate)).getTime() : undefined;
	const deadline = task.completionDeadline?.getTime();

	if ((deadline !== undefined && deadline < now.getTime()) || (scheduledDate !== undefined && scheduledDate < today)) {
		return 'overdue';
	}

	if (scheduledDate !== undefined && scheduledDate === today) {
		return 'today';
	}

	return 'upcoming';
}

function getRitualOperationalLabel(task: Task): string {
	switch (getRitualOperationalBucket(task)) {
		case 'needs_resubmission':
			return 'Needs Resubmission';
		case 'pending_review':
			return 'Pending Review';
		case 'overdue':
			return 'Overdue';
		case 'today':
			return 'Due Today';
		default:
			return 'Upcoming';
	}
}

function getRitualOperationalRank(task: Task): number {
	switch (getRitualOperationalBucket(task)) {
		case 'needs_resubmission':
			return 0;
		case 'overdue':
			return 1;
		case 'today':
			return 2;
		case 'pending_review':
			return 3;
		default:
			return 4;
	}
}

function getRitualReviewSignal(task: Task): string {
	const progress = task.evidenceProgress;
	if (!progress) {
		return 'No evidence yet';
	}

	if (progress.rejectedCount > 0) {
		return `${progress.rejectedCount} rejected proof item${progress.rejectedCount === 1 ? '' : 's'}`;
	}

	if (progress.pendingReviewCount > 0) {
		return `${progress.pendingReviewCount} item${progress.pendingReviewCount === 1 ? '' : 's'} waiting for review`;
	}

	if (progress.allRequiredApproved) {
		return 'All required proof approved';
	}

	const remainingRequired = Math.max(progress.requiredCount - progress.approvedCount, 0);
	return remainingRequired > 0
		? `${remainingRequired} required proof item${remainingRequired === 1 ? '' : 's'} still open`
		: 'No review signal yet';
}

function buildRitualInstanceHref(projectId: string, task: Task): string {
	// Mirrors TodayView.getRitualFocusIntent: generic list entries open the live instance,
	// and only nudge towards proof when something is actually outstanding. Review focus is
	// carried by notification deep links, not by the list surface.
	const focusIntent = (() => {
		const progress = task.evidenceProgress;
		if ((progress?.rejectedCount ?? 0) > 0) {
			return 'submit_requirement';
		}

		const missingRequiredProof =
			(progress?.requiredCount ?? 0) > (progress?.approvedCount ?? 0) &&
			(progress?.pendingReviewCount ?? 0) === 0;

		return missingRequiredProof ? 'submit_requirement' : 'view_instance';
	})();

	return `/workspace/tasks/${projectId}/tasks/${task.id}?focusIntent=${focusIntent}`;
}

// =============================================================================
// Main ListView Component
// =============================================================================

export function ListView({ onTaskClick, onTaskIdentifierClick }: ListViewProps) {
	const colors = useThemeColors();
	const router = useRouter();
	const { project, states, tasks, loading, refreshTasks } = useProjectContext();
	const [sortField, setSortField] = useState<SortField>('updatedAt');
	const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
	const [searchQuery, setSearchQuery] = useState('');
	const [changingTaskId, setChangingTaskId] = useState<string | null>(null);

	const isMixed = project?.collaborationMode === 'mixed';
	const isRitualOnly = project?.collaborationMode === 'ritual';

	useEffect(() => {
		if (isRitualOnly) {
			setSortField('dueDate');
			setSortDirection('asc');
		}
	}, [isRitualOnly]);

	// Create state lookup map
	const stateMap = useMemo(() => {
		const map = new Map<string, ProjectState>();
		states.forEach((s) => map.set(s.id, s));
		return map;
	}, [states]);

	// Filter and sort tasks
	const filteredTasks = useMemo(() => {
		let result = [...tasks];

		if (isRitualOnly) {
			result = result.filter(isRitualInstanceTask);
		}

		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(task) =>
					task.identifier.toLowerCase().includes(query) ||
					task.title.toLowerCase().includes(query) ||
					getRitualTemplateName(task).toLowerCase().includes(query)
			);
		}

		// Sort tasks
		result.sort((a, b) => {
			let comparison = 0;
			switch (sortField) {
				case 'identifier':
					comparison = a.identifier.localeCompare(b.identifier);
					break;
				case 'title':
					comparison = a.title.localeCompare(b.title);
					break;
				case 'state':
					if (isRitualOnly) {
						comparison = getRitualOperationalRank(a) - getRitualOperationalRank(b);
						if (comparison === 0) {
							comparison = getRitualOperationalLabel(a).localeCompare(getRitualOperationalLabel(b));
						}
						break;
					}

					const stateA = stateMap.get(a.stateId)?.name || '';
					const stateB = stateMap.get(b.stateId)?.name || '';
					comparison = stateA.localeCompare(stateB);
					break;
				case 'dueDate':
					const dateA = getTaskDueTimestamp(a);
					const dateB = getTaskDueTimestamp(b);
					comparison = dateA - dateB;
					if (comparison === 0 && isRitualOnly) {
						comparison = getRitualOperationalRank(a) - getRitualOperationalRank(b);
					}
					break;
				case 'updatedAt':
					const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
					const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
					comparison = updatedA - updatedB;
					break;
			}
			return sortDirection === 'asc' ? comparison : -comparison;
		});

		return result;
	}, [isRitualOnly, tasks, searchQuery, sortField, sortDirection, stateMap]);

	// Handle sort click
	const handleSortClick = useCallback((field: SortField) => {
		setSortField((prev) => {
			if (prev === field) {
				setSortDirection((dir) => (dir === 'asc' ? 'desc' : 'asc'));
				return prev;
			} else {
				setSortDirection('asc');
				return field;
			}
		});
	}, []);

	// Handle state change
	const handleStateChange = useCallback(
		async (taskId: string, newStateId: string) => {
			setChangingTaskId(taskId);
			try {
				await moveTask(taskId, newStateId);
				await refreshTasks();
			} catch (error) {
				console.error('Failed to change task state:', error);
			} finally {
				setChangingTaskId(null);
			}
		},
		[refreshTasks]
	);

	// Handle row click
	const handleRowClick = useCallback(
		(task: Task) => {
			if (task.taskKind === 'ritual_instance' && project) {
				router.push(buildRitualInstanceHref(project.id, task));
				return;
			}

			onTaskClick?.(task);
		},
		[onTaskClick, project, router]
	);

	// Handle identifier click
	const handleIdentifierClick = useCallback(
		(e: React.MouseEvent, task: Task) => {
			e.stopPropagation(); // Prevent row click
			if (task.taskKind === 'ritual_instance' && project) {
				router.push(buildRitualInstanceHref(project.id, task));
				return;
			}

			onTaskIdentifierClick?.(task);
		},
		[onTaskIdentifierClick, project, router]
	);

	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}

	if (isRitualOnly) {
		return (
			<Box sx={{ p: 2 }} data-testid="ritual-worklist-view">
				<Box sx={{ mb: 2.5 }}>
					<Typography variant="h6" sx={{ ...colors.text.primary.style, mb: 0.5 }}>
						Operational Worklist
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						Browse live ritual runs by execution state, review pressure, and deadline. This worklist stays instance-first, while template changes live in ritual settings.
					</Typography>
				</Box>

				<Alert severity="info" sx={{ mb: 2 }} data-testid="ritual-worklist-guidance">
					Open the live ritual instance from here. Use Project Settings → Rituals to edit reusable templates.
				</Alert>

				<Box sx={{ mb: 2 }}>
					<TextField
						size="small"
						placeholder="Search ritual runs..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						InputProps={{
							startAdornment: (
								<InputAdornment position="start">
									<SearchIcon sx={{ ...colors.text.secondary.style }} />
								</InputAdornment>
							),
						}}
						sx={{ minWidth: 320 }}
						data-testid="task-search-input"
					/>
				</Box>

				<Paper
					sx={{
						...colors.bg.paper.style,
						border: 1,
						...colors.border.default.style,
						overflow: 'hidden',
					}}
				>
					<Table size="small">
						<TableHead>
							<TableRow sx={{ ...colors.bg.elevated.style }}>
								<TableCell sx={{ width: 130 }}>
									<TableSortLabel
										active={sortField === 'identifier'}
										direction={sortField === 'identifier' ? sortDirection : 'asc'}
										onClick={() => handleSortClick('identifier')}
									>
										Instance
									</TableSortLabel>
								</TableCell>
								<TableCell>Template</TableCell>
								<TableCell sx={{ width: 180 }}>
									<TableSortLabel
										active={sortField === 'state'}
										direction={sortField === 'state' ? sortDirection : 'asc'}
										onClick={() => handleSortClick('state')}
									>
										Operational Status
									</TableSortLabel>
								</TableCell>
								<TableCell sx={{ width: 220 }}>Review Signal</TableCell>
								<TableCell sx={{ width: 120 }}>Scheduled</TableCell>
								<TableCell sx={{ width: 150 }}>
									<TableSortLabel
										active={sortField === 'dueDate'}
										direction={sortField === 'dueDate' ? sortDirection : 'asc'}
										onClick={() => handleSortClick('dueDate')}
									>
										Deadline
									</TableSortLabel>
								</TableCell>
								<TableCell sx={{ width: 150 }}>Assignees</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{filteredTasks.length === 0 ? (
								<TableRow>
									<TableCell colSpan={7}>
										<Typography sx={{ ...colors.text.secondary.style, textAlign: 'center', py: 4 }}>
											{searchQuery ? 'No ritual runs match your search' : 'No ritual runs are available yet'}
										</Typography>
									</TableCell>
								</TableRow>
							) : (
								filteredTasks.map((task) => {
									const statusLabel = getRitualOperationalLabel(task);
									const statusColor =
										statusLabel === 'Needs Resubmission'
											? 'error'
											: statusLabel === 'Overdue'
												? 'warning'
												: statusLabel === 'Pending Review'
													? 'info'
													: 'default';

									return (
										<TableRow
											key={task.id}
											hover
											onClick={() => handleRowClick(task)}
											sx={{
												cursor: 'pointer',
												'&:hover': {
													...colors.bg.active.style,
												},
											}}
											data-testid={`task-row-${task.id}`}
										>
											<TableCell onClick={(e) => handleIdentifierClick(e, task)} sx={{ cursor: 'pointer' }}>
												<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontWeight: 600 }} data-testid={`task-identifier-link-${task.id}`}>
													{task.identifier}
												</Typography>
											</TableCell>
											<TableCell>
												<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
													<RepeatIcon sx={{ fontSize: 16, color: 'warning.main' }} />
													<Box>
														<Typography variant="body2" sx={{ ...colors.text.primary.style, fontWeight: 500 }}>
															{getRitualTemplateName(task)}
														</Typography>
														<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
															Live ritual run
														</Typography>
													</Box>
												</Box>
											</TableCell>
											<TableCell>
												<Chip label={statusLabel} size="small" color={statusColor} variant={statusLabel === 'Due Today' || statusLabel === 'Upcoming' ? 'outlined' : 'filled'} data-testid={`ritual-worklist-status-${task.id}`} />
											</TableCell>
											<TableCell>
												<Typography variant="body2" sx={{ ...colors.text.primary.style }}>
													{getRitualReviewSignal(task)}
												</Typography>
											</TableCell>
											<TableCell>
												<Typography variant="body2" sx={{ ...colors.text.primary.style }}>
													{task.scheduledDate ? new Date(task.scheduledDate).toLocaleDateString() : 'Unscheduled'}
												</Typography>
											</TableCell>
											<TableCell>
												<Typography variant="body2" sx={{ ...colors.text.primary.style }}>
													{task.completionDeadline ? task.completionDeadline.toLocaleString() : 'No deadline'}
												</Typography>
											</TableCell>
											<TableCell>
												{task.assignees.length > 0 ? (
													<AvatarGroup
														max={3}
														sx={{ '& .MuiAvatar-root': { width: 24, height: 24, fontSize: '0.75rem' } }}
													>
														{task.assignees.map((assignee) => (
															<Avatar key={assignee.employeeId}>{assignee.employeeId.slice(0, 2).toUpperCase()}</Avatar>
														))}
													</AvatarGroup>
												) : (
													<Typography variant="caption" sx={{ ...colors.text.disabled.style }}>
														Unassigned
													</Typography>
												)}
											</TableCell>
										</TableRow>
									);
								})
							)}
						</TableBody>
					</Table>
				</Paper>

				<Box sx={{ mt: 2 }}>
					<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
						{filteredTasks.length} ritual run{filteredTasks.length !== 1 ? 's' : ''}
						{searchQuery && ` matching "${searchQuery}"`}
					</Typography>
				</Box>
			</Box>
		);
	}

	return (
		<Box sx={{ p: 2 }} data-testid="project-list-view">
			{/* Search Bar */}
			<Box sx={{ mb: 2 }}>
				<TextField
					size="small"
					placeholder="Search tasks..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					InputProps={{
						startAdornment: (
							<InputAdornment position="start">
								<SearchIcon sx={{ ...colors.text.secondary.style }} />
							</InputAdornment>
						),
					}}
					sx={{ minWidth: 300 }}
					data-testid="task-search-input"
				/>
			</Box>

			{/* Task Table */}
			<Paper
				sx={{
					...colors.bg.paper.style,
					border: 1,
					...colors.border.default.style,
					overflow: 'hidden',
				}}
			>
				<Table size="small">
					<TableHead>
						<TableRow sx={{ ...colors.bg.elevated.style }}>
							<TableCell sx={{ width: 120 }}>
								<TableSortLabel
									active={sortField === 'identifier'}
									direction={sortField === 'identifier' ? sortDirection : 'asc'}
									onClick={() => handleSortClick('identifier')}
								>
									ID
								</TableSortLabel>
							</TableCell>
							{isMixed && <TableCell sx={{ width: 80 }}>Kind</TableCell>}
							<TableCell>
								<TableSortLabel
									active={sortField === 'title'}
									direction={sortField === 'title' ? sortDirection : 'asc'}
									onClick={() => handleSortClick('title')}
								>
									Title
								</TableSortLabel>
							</TableCell>
							<TableCell sx={{ width: 160 }}>
								<TableSortLabel
									active={sortField === 'state'}
									direction={sortField === 'state' ? sortDirection : 'asc'}
									onClick={() => handleSortClick('state')}
								>
									Status
								</TableSortLabel>
							</TableCell>
							<TableCell sx={{ width: 150 }}>Assignees</TableCell>
							<TableCell sx={{ width: 120 }}>
								<TableSortLabel
									active={sortField === 'dueDate'}
									direction={sortField === 'dueDate' ? sortDirection : 'asc'}
									onClick={() => handleSortClick('dueDate')}
								>
									Due Date
								</TableSortLabel>
							</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{filteredTasks.length === 0 ? (
							<TableRow>
								<TableCell colSpan={isMixed ? 6 : 5}>
									<Typography
										sx={{
											...colors.text.secondary.style,
											textAlign: 'center',
											py: 4,
										}}
									>
										{searchQuery ? 'No tasks match your search' : 'No tasks yet'}
									</Typography>
								</TableCell>
							</TableRow>
						) : (
							filteredTasks.map((task) => {
								const isChanging = changingTaskId === task.id;

								return (
									<TableRow
										key={task.id}
										hover
										onClick={() => handleRowClick(task)}
										sx={{
											cursor: 'pointer',
											'&:hover': {
												...colors.bg.active.style,
											},
										}}
										data-testid={`task-row-${task.id}`}
									>
										<TableCell 
											onClick={(e) => handleIdentifierClick(e, task)}
											sx={{
												cursor: 'pointer',
												'&:hover': {
												color: 'primary.main',
													textDecoration: 'underline',
												},
											}}
										>
											<Typography
												variant="body2"
												sx={{ ...colors.text.secondary.style, fontWeight: 500 }}
												data-testid={`task-identifier-link-${task.id}`}
											>
												{task.identifier}
											</Typography>
										</TableCell>
										{isMixed && (
											<TableCell>
												{task.taskKind === 'ritual_instance' ? (
													<Chip
														icon={<RepeatIcon sx={{ fontSize: 14 }} />}
														label="Ritual"
														size="small"
														color="warning"
														variant="outlined"
														sx={{ height: 22, fontSize: '0.7rem' }}
													/>
												) : (
													<Chip
														label="Standard"
														size="small"
														variant="outlined"
														sx={{ height: 22, fontSize: '0.7rem' }}
													/>
												)}
											</TableCell>
										)}
										<TableCell>
											<Typography variant="body2" sx={{ ...colors.text.primary.style }}>
												{task.title}
											</Typography>
										</TableCell>
										<TableCell>
											{task.taskKind === 'ritual_instance' ? (
												/* Ritual tasks: read-only status — state is driven by evidence/approval */
												(() => {
													const state = states.find((s) => s.id === task.stateId);
													const hint = RITUAL_STATE_HINTS[state?.category ?? ''] ?? '';
													return (
														<Box>
															<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
																<Box
																	sx={{
																		width: 8,
																		height: 8,
																		borderRadius: '50%',
																		flexShrink: 0,
																		backgroundColor: state?.color ?? 'grey.400',
																	}}
																/>
																<Typography variant="body2">{state?.name ?? '—'}</Typography>
															</Box>
															{hint && (
																<Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
																	{hint}
																</Typography>
															)}
															{task.evidenceProgress && (
																<Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
																	{task.evidenceProgress.pendingReviewCount > 0
																		? `${task.evidenceProgress.pendingReviewCount} waiting for review`
																		: task.evidenceProgress.rejectedCount > 0
																			? `${task.evidenceProgress.rejectedCount} need resubmission`
																			: task.evidenceProgress.allRequiredApproved
																				? 'All required proof approved'
																				: `${Math.max(task.evidenceProgress.requiredCount - task.evidenceProgress.approvedCount, 0)} proof left`}
																</Typography>
															)}
														</Box>
													);
												})()
											) : (
											<Select
												size="small"
												value={task.stateId}
												onChange={(e) => handleStateChange(task.id, e.target.value)}
												onClick={(e) => e.stopPropagation()}
												disabled={isChanging}
												sx={{ minWidth: 120 }}
												data-testid={`task-state-select-${task.id}`}
											>
												{(isMixed
													? states.filter((s) => s.stateType === 'standard')
													: states
												).map((s) => (
													<MenuItem key={s.id} value={s.id}>
														<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
															<Box
																sx={{
																	width: 8,
																	height: 8,
																	borderRadius: '50%',
																	backgroundColor: s.color,
																}}
															/>
															{s.name}
														</Box>
													</MenuItem>
												))}
											</Select>
											)}
										</TableCell>
										<TableCell>
											{task.assignees.length > 0 ? (
												<AvatarGroup
													max={3}
													sx={{
														'& .MuiAvatar-root': {
															width: 24,
															height: 24,
															fontSize: '0.75rem',
														},
													}}
												>
													{task.assignees.map((a) => (
														<Avatar key={a.employeeId} sx={{ width: 24, height: 24 }}>
															{a.employeeId.slice(0, 2).toUpperCase()}
														</Avatar>
													))}
												</AvatarGroup>
											) : (
												<Typography
													variant="caption"
													sx={{ ...colors.text.disabled.style }}
												>
													Unassigned
												</Typography>
											)}
										</TableCell>
										<TableCell>
											{task.dueDate ? (
												<Chip
													label={new Date(task.dueDate).toLocaleDateString()}
													size="small"
													variant="outlined"
												/>
											) : (
												<Typography
													variant="caption"
													sx={{ ...colors.text.disabled.style }}
												>
													No due date
												</Typography>
											)}
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
			</Paper>

			{/* Task count */}
			<Box sx={{ mt: 2 }}>
				<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
					{filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
					{searchQuery && ` matching "${searchQuery}"`}
				</Typography>
			</Box>
		</Box>
	);
}

export default ListView;
