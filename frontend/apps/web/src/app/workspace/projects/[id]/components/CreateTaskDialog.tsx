/**
 * CreateTaskDialog Component - Dialog for creating new tasks
 * Feature: 017-realtime-task-collaboration-system
 *
 * Features:
 * - Required fields: title, level
 * - Optional fields: state, parent task, start date, due date, estimated hours, assignees
 * - Validation: title required, date range validation
 * - Default state: initial state from project states
 * - Assignee multi-select
 * - Custom field value inputs (for future extension)
 */

'use client';

import React, { useState, useMemo } from 'react';
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Button,
	TextField,
	MenuItem,
	Box,
	Typography,
	Alert,
	Autocomplete,
	Chip,
	FormControl,
	InputLabel,
	Select,
	type TextFieldProps,
	type SelectChangeEvent,
} from '@mui/material';
import { useProjectContext } from '../ProjectContext';
import { createTask, type ProjectMember } from 'apis';

// =============================================================================
// Props
// =============================================================================

interface CreateTaskDialogProps {
	open: boolean;
	onClose: () => void;
	onTaskCreated?: () => void;
	defaultParentTaskId?: string;
}

// =============================================================================
// Main Component
// =============================================================================

export default function CreateTaskDialog({
	open,
	onClose,
	onTaskCreated,
	defaultParentTaskId,
}: CreateTaskDialogProps) {
	const { project, states, levels, tasks, refreshTasks } = useProjectContext();

	// Form state
	const [title, setTitle] = useState('');
	const [levelId, setLevelId] = useState('');
	const [parentTaskId, setParentTaskId] = useState<string>(defaultParentTaskId || '');
	const [stateId, setStateId] = useState('');
	const [startDate, setStartDate] = useState('');
	const [dueDate, setDueDate] = useState('');
	const [estimatedHours, setEstimatedHours] = useState('');
	const [selectedAssignees, setSelectedAssignees] = useState<ProjectMember[]>([]);

	// UI state
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Derived data
	const initialState = useMemo(() => {
		return states.find((s) => s.isInitial);
	}, [states]);

	const parentTaskOptions = useMemo(() => {
		// Only show tasks that are not deeply nested (allow parent up to depth 3)
		return tasks.filter((t) => t.depth <= 3);
	}, [tasks]);

	const parentTask = useMemo(() => {
		return parentTaskId ? tasks.find((t) => t.id === parentTaskId) : null;
	}, [parentTaskId, tasks]);

	// Available members (dummy data for now - would need to fetch from project members API)
	const availableMembers = useMemo<ProjectMember[]>(() => {
		// TODO: Load from actual project members API
		return [];
	}, []);

	// Reset form when dialog opens/closes
	React.useEffect(() => {
		if (open) {
			setTitle('');
			setLevelId(levels[0]?.id || '');
			setParentTaskId(defaultParentTaskId || '');
			setStateId(initialState?.id || '');
			setStartDate('');
			setDueDate('');
			setEstimatedHours('');
			setSelectedAssignees([]);
			setError(null);
		}
	}, [open, levels, initialState, defaultParentTaskId]);

	// Handlers
	const handleSubmit = async () => {
		// Validation
		if (!title.trim()) {
			setError('Task title is required');
			return;
		}

		if (!levelId) {
			setError('Task level is required');
			return;
		}

		if (startDate && dueDate && startDate > dueDate) {
			setError('Start date must be before or equal to due date');
			return;
		}

		if (estimatedHours && (parseFloat(estimatedHours) < 0 || isNaN(parseFloat(estimatedHours)))) {
			setError('Estimated hours must be a positive number');
			return;
		}

		setError(null);
		setLoading(true);

		try {
			await createTask({
				projectId: project!.id,
				title: title.trim(),
				levelId,
				parentTaskId: parentTaskId || undefined,
				stateId: stateId || undefined,
				startDate: startDate || undefined,
				dueDate: dueDate || undefined,
				estimatedHours: estimatedHours ? parseFloat(estimatedHours) : undefined,
				assigneeEmployeeIds: selectedAssignees.map((m) => m.employeeId),
			});

			// Refresh tasks list
			await refreshTasks();

			// Notify parent
			if (onTaskCreated) {
				onTaskCreated();
			}

			// Close dialog
			onClose();
		} catch (err) {
			console.error('Failed to create task:', err);
			setError(err instanceof Error ? err.message : 'Failed to create task');
		} finally {
			setLoading(false);
		}
	};

	const handleCancel = () => {
		if (!loading) {
			onClose();
		}
	};

	const handleLevelChange = (event: SelectChangeEvent<string>) => {
		setLevelId(event.target.value);
	};

	const handleStateChange = (event: SelectChangeEvent<string>) => {
		setStateId(event.target.value);
	};

	const handleParentTaskChange = (event: SelectChangeEvent<string>) => {
		setParentTaskId(event.target.value);
	};

	if (!project) {
		return null;
	}

	return (
		<Dialog
			open={open}
			onClose={handleCancel}
			maxWidth="sm"
			fullWidth
			data-testid="create-task-dialog"
		>
			<DialogTitle>Create New Task</DialogTitle>
			<DialogContent>
				{error && (
					<Alert severity="error" sx={{ mb: 2 }}>
						{error}
					</Alert>
				)}

				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{/* Title (required) */}
					<TextField
						label="Title"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Enter task title..."
						required
						fullWidth
						autoFocus
						disabled={loading}
						data-testid="task-title-input"
					/>

					{/* Level (required) */}
					<FormControl fullWidth required disabled={loading}>
						<InputLabel>Level</InputLabel>
						<Select
							value={levelId}
							onChange={handleLevelChange}
							label="Level"
							data-testid="task-level-select"
						>
							{levels.map((level) => (
								<MenuItem key={level.id} value={level.id}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										<Box
											sx={{
												width: 12,
												height: 12,
												borderRadius: '50%',
												backgroundColor: level.color,
											}}
										/>
										<Typography>{level.name}</Typography>
									</Box>
								</MenuItem>
							))}
						</Select>
					</FormControl>

					{/* State (optional - defaults to initial state) */}
					<FormControl fullWidth disabled={loading}>
						<InputLabel>State</InputLabel>
						<Select
							value={stateId}
							onChange={handleStateChange}
							label="State"
							data-testid="task-state-select"
						>
							{states.map((state) => (
								<MenuItem key={state.id} value={state.id}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										<Box
											sx={{
												width: 12,
												height: 12,
												borderRadius: '50%',
												backgroundColor: state.color,
											}}
										/>
										<Typography>{state.name}</Typography>
									</Box>
								</MenuItem>
							))}
						</Select>
					</FormControl>

					{/* Parent Task (optional) */}
					{parentTaskOptions.length > 0 && (
						<FormControl fullWidth disabled={loading}>
							<InputLabel>Parent Task</InputLabel>
							<Select
								value={parentTaskId}
								onChange={handleParentTaskChange}
								label="Parent Task"
								data-testid="task-parent-select"
							>
								<MenuItem value="">
									<em>None (top-level task)</em>
								</MenuItem>
								{parentTaskOptions.map((task) => (
									<MenuItem key={task.id} value={task.id}>
										<Box sx={{ pl: task.depth * 2 }}>
											{task.identifier} - {task.title}
										</Box>
									</MenuItem>
								))}
							</Select>
						</FormControl>
					)}

					{parentTask && (
						<Alert severity="info" sx={{ fontSize: '0.875rem' }}>
							This task will be created as a subtask of: <strong>{parentTask.identifier}</strong>
						</Alert>
					)}

					{/* Date Range */}
					<Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
						<TextField
							label="Start Date"
							type="date"
							value={startDate}
							onChange={(e) => setStartDate(e.target.value)}
							InputLabelProps={{ shrink: true }}
							fullWidth
							disabled={loading}
							data-testid="task-start-date-input"
						/>
						<TextField
							label="Due Date"
							type="date"
							value={dueDate}
							onChange={(e) => setDueDate(e.target.value)}
							InputLabelProps={{ shrink: true }}
							inputProps={{ min: startDate || undefined }}
							fullWidth
							disabled={loading}
							data-testid="task-due-date-input"
						/>
					</Box>

					{/* Estimated Hours */}
					<TextField
						label="Estimated Hours"
						type="number"
						value={estimatedHours}
						onChange={(e) => setEstimatedHours(e.target.value)}
						placeholder="0"
						inputProps={{ min: 0, step: 0.5 }}
						fullWidth
						disabled={loading}
						data-testid="task-estimated-hours-input"
					/>

					{/* Assignees (multi-select) */}
					{availableMembers.length > 0 && (
						<Autocomplete
							multiple
							options={availableMembers}
							value={selectedAssignees}
							onChange={(_event, newValue) => setSelectedAssignees(newValue)}
							getOptionLabel={(option) => option.employeeId}
							renderInput={(params) => (
								<TextField
									{...(params as TextFieldProps)}
									label="Assignees"
									placeholder="Select assignees..."
									data-testid="task-assignees-input"
								/>
							)}
							renderTags={(value, getTagProps) =>
								value.map((option, index) => (
									<Chip
										{...getTagProps({ index })}
										key={option.employeeId}
										label={option.employeeId}
										size="small"
									/>
								))
							}
							disabled={loading}
						/>
					)}

					<Typography variant="caption" color="text.secondary">
						* Required fields
					</Typography>
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={handleCancel} disabled={loading} data-testid="cancel-button">
					Cancel
				</Button>
				<Button
					onClick={handleSubmit}
					variant="contained"
					disabled={loading}
					data-testid="create-button"
				>
					{loading ? 'Creating...' : 'Create Task'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
