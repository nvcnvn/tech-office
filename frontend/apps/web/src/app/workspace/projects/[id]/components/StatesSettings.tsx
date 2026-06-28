/**
 * StatesSettings Component - CRUD for project workflow states
 * Feature: 017-realtime-task-collaboration-system
 *
 * Features:
 * - List all project states with color, category, position
 * - Create new states with name, color, category selection
 * - Edit existing state properties
 * - Delete states with task migration to another state
 * - Reorder states via drag and drop
 * - Mark states as initial or closed
 */

'use client';

import React, { useState, useCallback } from 'react';
import {
	Box,
	Typography,
	Button,
	IconButton,
	TextField,
	Select,
	MenuItem,
	FormControl,
	InputLabel,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Paper,
	Chip,
	Switch,
	FormControlLabel,
	Alert,
	CircularProgress,
	Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import FlagIcon from '@mui/icons-material/Flag';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import {
	createProjectState,
	updateProjectState,
	deleteProjectState,
	type ProjectState,
	type StateCategory,
} from 'apis';

// =============================================================================
// Category Options
// =============================================================================

const CATEGORY_OPTIONS: { value: StateCategory; label: string; color: string }[] = [
	{ value: 'todo', label: 'To Do', color: '#9e9e9e' },
	{ value: 'in_progress', label: 'In Progress', color: '#2196f3' },
	{ value: 'done', label: 'Done', color: '#4caf50' },
	{ value: 'cancelled', label: 'Cancelled', color: '#f44336' },
	{ value: 'scheduled', label: 'Scheduled', color: '#6b7280' },
	{ value: 'submitted', label: 'Submitted', color: '#8b5cf6' },
	{ value: 'verified', label: 'Verified', color: '#10b981' },
	{ value: 'overdue', label: 'Overdue', color: '#ef4444' },
	{ value: 'missed', label: 'Missed', color: '#dc2626' },
	{ value: 'skipped', label: 'Skipped', color: '#9ca3af' },
];

const DEFAULT_COLORS = [
	'#9e9e9e', // grey
	'#2196f3', // blue
	'#4caf50', // green
	'#f44336', // red
	'#ff9800', // orange
	'#9c27b0', // purple
	'#00bcd4', // cyan
	'#e91e63', // pink
];

// =============================================================================
// State Form Dialog
// =============================================================================

interface StateFormDialogProps {
	open: boolean;
	onClose: () => void;
	onSubmit: (data: StateFormData) => Promise<void>;
	initialData?: ProjectState;
	existingStates: ProjectState[];
}

interface StateFormData {
	name: string;
	color: string;
	category: StateCategory;
	isInitial: boolean;
	isClosed: boolean;
}

function StateFormDialog({
	open,
	onClose,
	onSubmit,
	initialData,
	existingStates,
}: StateFormDialogProps) {
	const colors = useThemeColors();
	const [formData, setFormData] = useState<StateFormData>({
		name: initialData?.name || '',
		color: initialData?.color || '#2196f3',
		category: initialData?.category || 'todo',
		isInitial: initialData?.isInitial || false,
		isClosed: initialData?.isClosed || false,
	});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isEdit = !!initialData;

	const handleSubmit = async () => {
		if (!formData.name.trim()) {
			setError('State name is required');
			return;
		}

		// Check for duplicate names (excluding current state if editing)
		const isDuplicate = existingStates.some(
			(s) => s.name.toLowerCase() === formData.name.trim().toLowerCase() &&
				(!initialData || s.id !== initialData.id)
		);
		if (isDuplicate) {
			setError('A state with this name already exists');
			return;
		}

		setSaving(true);
		setError(null);

		try {
			await onSubmit(formData);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save state');
		} finally {
			setSaving(false);
		}
	};

	const handleClose = () => {
		if (!saving) {
			onClose();
		}
	};

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			maxWidth="sm"
			fullWidth
			data-testid="state-form-dialog"
		>
			<DialogTitle sx={{ ...colors.text.primary.style }}>
				{isEdit ? 'Edit State' : 'Create New State'}
			</DialogTitle>
			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}

					<TextField
						label="State Name"
						value={formData.name}
						onChange={(e) => setFormData({ ...formData, name: e.target.value })}
						fullWidth
						required
						disabled={saving}
						data-testid="state-name-input"
					/>

					<FormControl fullWidth>
						<InputLabel>Category</InputLabel>
						<Select
							value={formData.category}
							label="Category"
							onChange={(e) =>
								setFormData({ ...formData, category: e.target.value as StateCategory })
							}
							disabled={saving}
							data-testid="state-category-select"
						>
							{CATEGORY_OPTIONS.map((opt) => (
								<MenuItem key={opt.value} value={opt.value}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										<Box
											sx={{
												width: 12,
												height: 12,
												borderRadius: '50%',
												backgroundColor: opt.color,
											}}
										/>
										{opt.label}
									</Box>
								</MenuItem>
							))}
						</Select>
					</FormControl>

					<Box>
						<Typography variant="subtitle2" sx={{ mb: 1, ...colors.text.secondary.style }}>
							Color
						</Typography>
						<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
							{DEFAULT_COLORS.map((color) => (
								<Box
									key={color}
									onClick={() => setFormData({ ...formData, color })}
									sx={{
										width: 32,
										height: 32,
										borderRadius: 1,
										backgroundColor: color,
										cursor: 'pointer',
										border: formData.color === color ? '3px solid' : '1px solid',
										borderColor: formData.color === color ? 'primary.main' : 'divider',
										transition: 'transform 0.1s',
										'&:hover': { transform: 'scale(1.1)' },
									}}
									data-testid={`color-option-${color}`}
								/>
							))}
						</Box>
					</Box>

					<Box sx={{ display: 'flex', gap: 3 }}>
						<FormControlLabel
							control={
								<Switch
									checked={formData.isInitial}
									onChange={(e) => setFormData({ ...formData, isInitial: e.target.checked })}
									disabled={saving}
								/>
							}
							label={
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
									<FlagIcon fontSize="small" />
									Initial State
								</Box>
							}
							data-testid="state-initial-switch"
						/>
						<FormControlLabel
							control={
								<Switch
									checked={formData.isClosed}
									onChange={(e) => setFormData({ ...formData, isClosed: e.target.checked })}
									disabled={saving}
								/>
							}
							label={
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
									<CheckCircleIcon fontSize="small" />
									Closed State
								</Box>
							}
							data-testid="state-closed-switch"
						/>
					</Box>
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={handleClose} disabled={saving} data-testid="state-form-cancel">
					Cancel
				</Button>
				<Button
					onClick={handleSubmit}
					variant="contained"
					disabled={saving}
					data-testid="state-form-submit"
				>
					{saving ? <CircularProgress size={20} /> : isEdit ? 'Save Changes' : 'Create State'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Delete Confirmation Dialog
// =============================================================================

interface DeleteConfirmDialogProps {
	open: boolean;
	onClose: () => void;
	onConfirm: (migrateToStateId: string) => Promise<void>;
	stateToDelete: ProjectState | null;
	otherStates: ProjectState[];
}

function DeleteConfirmDialog({
	open,
	onClose,
	onConfirm,
	stateToDelete,
	otherStates,
}: DeleteConfirmDialogProps) {
	const colors = useThemeColors();
	const [migrateToId, setMigrateToId] = useState('');
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleConfirm = async () => {
		if (!migrateToId) {
			setError('Please select a state to migrate tasks to');
			return;
		}

		setDeleting(true);
		setError(null);

		try {
			await onConfirm(migrateToId);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete state');
		} finally {
			setDeleting(false);
		}
	};

	return (
		<Dialog
			open={open}
			onClose={() => !deleting && onClose()}
			maxWidth="sm"
			fullWidth
			data-testid="delete-state-dialog"
		>
			<DialogTitle sx={{ ...colors.text.primary.style }}>Delete State</DialogTitle>
			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}

					<Alert severity="warning">
						Deleting the state &quot;{stateToDelete?.name}&quot; will require moving all tasks
						in this state to another state.
					</Alert>

					<FormControl fullWidth>
						<InputLabel>Migrate Tasks To</InputLabel>
						<Select
							value={migrateToId}
							label="Migrate Tasks To"
							onChange={(e) => setMigrateToId(e.target.value)}
							disabled={deleting}
							data-testid="migrate-to-select"
						>
							{otherStates.map((state) => (
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
										{state.name}
									</Box>
								</MenuItem>
							))}
						</Select>
					</FormControl>
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={deleting} data-testid="delete-cancel">
					Cancel
				</Button>
				<Button
					onClick={handleConfirm}
					variant="contained"
					color="error"
					disabled={deleting || !migrateToId}
					data-testid="delete-confirm"
				>
					{deleting ? <CircularProgress size={20} /> : 'Delete State'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Main States Settings Component
// =============================================================================

export default function StatesSettings() {
	const colors = useThemeColors();
	const { project, states, refreshProject } = useProjectContext();
	const [formOpen, setFormOpen] = useState(false);
	const [editingState, setEditingState] = useState<ProjectState | null>(null);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [stateToDelete, setStateToDelete] = useState<ProjectState | null>(null);

	const handleCreate = useCallback(async (data: StateFormData) => {
		if (!project) return;
		await createProjectState({
			projectId: project.id,
			name: data.name,
			color: data.color,
			category: data.category,
			isInitial: data.isInitial,
			isClosed: data.isClosed,
		});
		await refreshProject();
	}, [project, refreshProject]);

	const handleUpdate = useCallback(async (data: StateFormData) => {
		if (!editingState) return;
		await updateProjectState({
			stateId: editingState.id,
			name: data.name,
			color: data.color,
			category: data.category,
			isInitial: data.isInitial,
			isClosed: data.isClosed,
		});
		await refreshProject();
	}, [editingState, refreshProject]);

	const handleDelete = useCallback(async (migrateToStateId: string) => {
		if (!stateToDelete) return;
		await deleteProjectState(stateToDelete.id, migrateToStateId);
		await refreshProject();
	}, [stateToDelete, refreshProject]);

	const openCreateDialog = () => {
		setEditingState(null);
		setFormOpen(true);
	};

	const openEditDialog = (state: ProjectState) => {
		setEditingState(state);
		setFormOpen(true);
	};

	const openDeleteDialog = (state: ProjectState) => {
		setStateToDelete(state);
		setDeleteDialogOpen(true);
	};

	// Sort states by position
	const sortedStates = [...states].sort((a, b) => a.position - b.position);

	const getCategoryInfo = (category: StateCategory) => {
		return CATEGORY_OPTIONS.find((c) => c.value === category) || CATEGORY_OPTIONS[0];
	};

	return (
		<Box sx={{ p: 3 }} data-testid="states-settings">
			{/* Header */}
			<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
				<Box>
					<Typography variant="h6" sx={{ ...colors.text.primary.style }}>
						Workflow States
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						Define the states tasks can be in throughout their lifecycle
					</Typography>
				</Box>
				<Button
					variant="contained"
					startIcon={<AddIcon />}
					onClick={openCreateDialog}
					data-testid="create-state-btn"
				>
					Add State
				</Button>
			</Box>

			{/* States List */}
			<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
				{sortedStates.map((state) => {
					const categoryInfo = getCategoryInfo(state.category);
					return (
						<Paper
							key={state.id}
							sx={{
								display: 'flex',
								alignItems: 'center',
								p: 2,
								gap: 2,
								...colors.bg.paper.style,
							}}
							data-testid={`state-item-${state.id}`}
						>
							<DragIndicatorIcon sx={{ ...colors.text.secondary.style, cursor: 'grab' }} />

							{/* Color Indicator */}
							<Box
								sx={{
									width: 24,
									height: 24,
									borderRadius: 1,
									backgroundColor: state.color,
									flexShrink: 0,
								}}
							/>

							{/* State Info */}
							<Box sx={{ flex: 1 }}>
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
									<Typography sx={{ fontWeight: 500, ...colors.text.primary.style }}>
										{state.name}
									</Typography>
									{state.isInitial && (
										<Tooltip title="Initial state for new tasks">
											<Chip
												icon={<FlagIcon />}
												label="Initial"
												size="small"
												color="primary"
												variant="outlined"
											/>
										</Tooltip>
									)}
									{state.isClosed && (
										<Tooltip title="Tasks in this state are considered closed">
											<Chip
												icon={<CheckCircleIcon />}
												label="Closed"
												size="small"
												color="success"
												variant="outlined"
											/>
										</Tooltip>
									)}
								</Box>
								<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
									Category: {categoryInfo.label}
								</Typography>
							</Box>

							{/* Actions */}
							<Box>
								<IconButton
									size="small"
									onClick={() => openEditDialog(state)}
									data-testid={`edit-state-${state.id}`}
								>
									<EditIcon fontSize="small" />
								</IconButton>
								<IconButton
									size="small"
									onClick={() => openDeleteDialog(state)}
									disabled={sortedStates.length <= 1}
									data-testid={`delete-state-${state.id}`}
								>
									<DeleteIcon fontSize="small" />
								</IconButton>
							</Box>
						</Paper>
					);
				})}

				{sortedStates.length === 0 && (
					<Alert severity="info">
						No states configured. Click &quot;Add State&quot; to create the first workflow state.
					</Alert>
				)}
			</Box>

			{/* Form Dialog */}
			<StateFormDialog
				open={formOpen}
				onClose={() => setFormOpen(false)}
				onSubmit={editingState ? handleUpdate : handleCreate}
				initialData={editingState || undefined}
				existingStates={states}
			/>

			{/* Delete Confirmation Dialog */}
			<DeleteConfirmDialog
				open={deleteDialogOpen}
				onClose={() => setDeleteDialogOpen(false)}
				onConfirm={handleDelete}
				stateToDelete={stateToDelete}
				otherStates={states.filter((s) => s.id !== stateToDelete?.id)}
			/>
		</Box>
	);
}
