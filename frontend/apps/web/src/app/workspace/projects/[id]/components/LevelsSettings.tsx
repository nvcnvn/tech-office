/**
 * LevelsSettings Component - CRUD for task hierarchy levels
 * Feature: 017-realtime-task-collaboration-system
 *
 * Features:
 * - List all task levels with name, icon, color, depth
 * - Create new levels (Epic, Story, Task, Subtask, etc.)
 * - Edit existing level properties
 * - Delete levels (with validation that no tasks use it)
 * - Visual depth hierarchy display
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
	Alert,
	CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import BoltIcon from '@mui/icons-material/Bolt';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import ChecklistIcon from '@mui/icons-material/Checklist';
import WorkspacesIcon from '@mui/icons-material/Workspaces';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import {
	createTaskLevel,
	updateTaskLevel,
	deleteTaskLevel,
	type TaskLevel,
} from 'apis';

// =============================================================================
// Icon Options
// =============================================================================

const ICON_OPTIONS: { value: string; label: string; icon: React.ReactNode }[] = [
	{ value: 'bolt', label: 'Epic', icon: <BoltIcon /> },
	{ value: 'auto_stories', label: 'Story', icon: <AutoStoriesIcon /> },
	{ value: 'task_alt', label: 'Task', icon: <TaskAltIcon /> },
	{ value: 'checklist', label: 'Subtask', icon: <ChecklistIcon /> },
	{ value: 'workspaces', label: 'Generic', icon: <WorkspacesIcon /> },
];

const DEFAULT_COLORS = [
	'#9c27b0', // purple (Epic)
	'#2196f3', // blue (Story)
	'#4caf50', // green (Task)
	'#9e9e9e', // grey (Subtask)
	'#ff9800', // orange
	'#e91e63', // pink
	'#00bcd4', // cyan
	'#f44336', // red
];

const getIconComponent = (iconName: string) => {
	switch (iconName) {
		case 'bolt':
			return <BoltIcon />;
		case 'auto_stories':
			return <AutoStoriesIcon />;
		case 'task_alt':
			return <TaskAltIcon />;
		case 'checklist':
			return <ChecklistIcon />;
		case 'workspaces':
		default:
			return <WorkspacesIcon />;
	}
};

// =============================================================================
// Level Form Dialog
// =============================================================================

interface LevelFormDialogProps {
	open: boolean;
	onClose: () => void;
	onSubmit: (data: LevelFormData) => Promise<void>;
	initialData?: TaskLevel;
	existingLevels: TaskLevel[];
	isEdit: boolean;
}

interface LevelFormData {
	name: string;
	icon: string;
	color: string;
	depth: number;
}

function LevelFormDialog({
	open,
	onClose,
	onSubmit,
	initialData,
	existingLevels,
	isEdit,
}: LevelFormDialogProps) {
	const colors = useThemeColors();
	
	// Calculate next available depth for new levels
	const usedDepths = existingLevels.map((l) => l.depth);
	const nextAvailableDepth = isEdit
		? initialData?.depth || 0
		: Math.max(0, ...usedDepths, -1) + 1;
	
	const [formData, setFormData] = useState<LevelFormData>({
		name: initialData?.name || '',
		icon: initialData?.icon || 'workspaces',
		color: initialData?.color || '#2196f3',
		depth: initialData?.depth ?? nextAvailableDepth,
	});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		if (!formData.name.trim()) {
			setError('Level name is required');
			return;
		}

		// Check for duplicate names (excluding current level if editing)
		const isDuplicate = existingLevels.some(
			(l) =>
				l.name.toLowerCase() === formData.name.trim().toLowerCase() &&
				(!initialData || l.id !== initialData.id)
		);
		if (isDuplicate) {
			setError('A level with this name already exists');
			return;
		}

		// Check for duplicate depths (excluding current level if editing)
		if (!isEdit) {
			const depthTaken = existingLevels.some((l) => l.depth === formData.depth);
			if (depthTaken) {
				setError(`Depth ${formData.depth} is already used by another level`);
				return;
			}
		}

		setSaving(true);
		setError(null);

		try {
			await onSubmit(formData);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save level');
		} finally {
			setSaving(false);
		}
	};

	const handleClose = () => {
		if (!saving) {
			onClose();
		}
	};

	// Get available depths (0-4, excluding ones already used unless editing)
	const availableDepths = [0, 1, 2, 3, 4].filter((d) => {
		if (isEdit && d === initialData?.depth) return true;
		return !usedDepths.includes(d);
	});

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			maxWidth="sm"
			fullWidth
			data-testid="level-form-dialog"
		>
			<DialogTitle sx={{ ...colors.text.primary.style }}>
				{isEdit ? 'Edit Level' : 'Create New Level'}
			</DialogTitle>
			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}

					<TextField
						label="Level Name"
						value={formData.name}
						onChange={(e) => setFormData({ ...formData, name: e.target.value })}
						fullWidth
						required
						disabled={saving}
						placeholder="e.g., Epic, Story, Task"
						data-testid="level-name-input"
					/>

					<FormControl fullWidth>
						<InputLabel>Icon</InputLabel>
						<Select
							value={formData.icon}
							label="Icon"
							onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
							disabled={saving}
							data-testid="level-icon-select"
						>
							{ICON_OPTIONS.map((opt) => (
								<MenuItem key={opt.value} value={opt.value}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										{opt.icon}
										{opt.label}
									</Box>
								</MenuItem>
							))}
						</Select>
					</FormControl>

					{!isEdit && (
						<FormControl fullWidth>
							<InputLabel>Hierarchy Depth</InputLabel>
							<Select
								value={formData.depth}
								label="Hierarchy Depth"
								onChange={(e) =>
									setFormData({ ...formData, depth: Number(e.target.value) })
								}
								disabled={saving}
								data-testid="level-depth-select"
							>
								{availableDepths.map((d) => (
									<MenuItem key={d} value={d}>
										{d === 0 && 'Top Level (0)'}
										{d === 1 && 'Level 1'}
										{d === 2 && 'Level 2'}
										{d === 3 && 'Level 3'}
										{d === 4 && 'Bottom Level (4)'}
									</MenuItem>
								))}
							</Select>
						</FormControl>
					)}

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
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={handleClose} disabled={saving} data-testid="level-form-cancel">
					Cancel
				</Button>
				<Button
					onClick={handleSubmit}
					variant="contained"
					disabled={saving}
					data-testid="level-form-submit"
				>
					{saving ? <CircularProgress size={20} /> : isEdit ? 'Save Changes' : 'Create Level'}
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
	onConfirm: (migrateToLevelId: string) => Promise<void>;
	levelToDelete: TaskLevel | null;
	otherLevels: TaskLevel[];
}

function DeleteConfirmDialog({
	open,
	onClose,
	onConfirm,
	levelToDelete,
	otherLevels,
}: DeleteConfirmDialogProps) {
	const colors = useThemeColors();
	const [migrateToId, setMigrateToId] = useState('');
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleConfirm = async () => {
		if (!migrateToId) {
			setError('Please select a level to migrate tasks to');
			return;
		}

		setDeleting(true);
		setError(null);

		try {
			await onConfirm(migrateToId);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete level');
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
			data-testid="delete-level-dialog"
		>
			<DialogTitle sx={{ ...colors.text.primary.style }}>Delete Level</DialogTitle>
			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}

					<Alert severity="warning">
						Deleting the level &quot;{levelToDelete?.name}&quot; will require moving all tasks
						of this level to another level.
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
							{otherLevels.map((level) => (
								<MenuItem key={level.id} value={level.id}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										<Box
											sx={{
												width: 16,
												height: 16,
												borderRadius: 0.5,
												backgroundColor: level.color,
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												color: 'white',
											}}
										>
											{getIconComponent(level.icon)}
										</Box>
										{level.name} (Depth {level.depth})
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
					{deleting ? <CircularProgress size={20} /> : 'Delete Level'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Main Levels Settings Component
// =============================================================================

export default function LevelsSettings() {
	const colors = useThemeColors();
	const { project, levels, refreshProject } = useProjectContext();
	const [formOpen, setFormOpen] = useState(false);
	const [editingLevel, setEditingLevel] = useState<TaskLevel | null>(null);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [levelToDelete, setLevelToDelete] = useState<TaskLevel | null>(null);

	const handleCreate = useCallback(
		async (data: LevelFormData) => {
			if (!project) return;
			await createTaskLevel({
				projectId: project.id,
				name: data.name,
				icon: data.icon,
				color: data.color,
				depth: data.depth,
			});
			await refreshProject();
		},
		[project, refreshProject]
	);

	const handleUpdate = useCallback(
		async (data: LevelFormData) => {
			if (!editingLevel) return;
			await updateTaskLevel({
				levelId: editingLevel.id,
				name: data.name,
				icon: data.icon,
				color: data.color,
			});
			await refreshProject();
		},
		[editingLevel, refreshProject]
	);

	const handleDelete = useCallback(async (migrateToLevelId: string) => {
		if (!levelToDelete) return;
		await deleteTaskLevel(levelToDelete.id, migrateToLevelId);
		await refreshProject();
	}, [levelToDelete, refreshProject]);

	const openCreateDialog = () => {
		setEditingLevel(null);
		setFormOpen(true);
	};

	const openEditDialog = (level: TaskLevel) => {
		setEditingLevel(level);
		setFormOpen(true);
	};

	const openDeleteDialog = (level: TaskLevel) => {
		setLevelToDelete(level);
		setDeleteDialogOpen(true);
	};

	// Sort levels by depth
	const sortedLevels = [...levels].sort((a, b) => a.depth - b.depth);

	return (
		<Box sx={{ p: 3 }} data-testid="levels-settings">
			{/* Header */}
			<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
				<Box>
					<Typography variant="h6" sx={{ ...colors.text.primary.style }}>
						Task Levels
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						Define the hierarchy of tasks (Epic → Story → Task → Subtask)
					</Typography>
				</Box>
				<Button
					variant="contained"
					startIcon={<AddIcon />}
					onClick={openCreateDialog}
					disabled={levels.length >= 5} // Max 5 levels (0-4)
					data-testid="create-level-btn"
				>
					Add Level
				</Button>
			</Box>

			{/* Hierarchy Visualization */}
			<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
				{sortedLevels.map((level) => (
					<Paper
						key={level.id}
						sx={{
							display: 'flex',
							alignItems: 'center',
							p: 2,
							pl: 2 + level.depth * 3, // Indent based on depth
							gap: 2,
							...colors.bg.paper.style,
						}}
						data-testid={`level-item-${level.id}`}
					>
						{/* Depth indicator lines */}
						{level.depth > 0 && (
							<Box
								sx={{
									width: 2,
									height: 24,
									backgroundColor: 'divider',
									ml: -2 - level.depth * 1.5,
								}}
							/>
						)}

						{/* Icon with Color */}
						<Box
							sx={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								width: 36,
								height: 36,
								borderRadius: 1,
								backgroundColor: level.color,
								color: 'white',
								flexShrink: 0,
							}}
						>
							{getIconComponent(level.icon)}
						</Box>

						{/* Level Info */}
						<Box sx={{ flex: 1 }}>
							<Typography sx={{ fontWeight: 500, ...colors.text.primary.style }}>
								{level.name}
							</Typography>
							<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
								Depth: {level.depth}
								{level.depth === 0 && ' (Top level)'}
								{level.depth === 4 && ' (Bottom level)'}
							</Typography>
						</Box>

						{/* Actions */}
						<Box>
							<IconButton
								size="small"
								onClick={() => openEditDialog(level)}
								data-testid={`edit-level-${level.id}`}
							>
								<EditIcon fontSize="small" />
							</IconButton>
							<IconButton
								size="small"
								onClick={() => openDeleteDialog(level)}
								disabled={sortedLevels.length <= 1}
								data-testid={`delete-level-${level.id}`}
							>
								<DeleteIcon fontSize="small" />
							</IconButton>
						</Box>
					</Paper>
				))}

				{sortedLevels.length === 0 && (
					<Alert severity="info">
						No task levels configured. Click &quot;Add Level&quot; to create the first level.
					</Alert>
				)}

				{levels.length >= 5 && (
					<Alert severity="info">Maximum of 5 hierarchy levels reached.</Alert>
				)}
			</Box>

			{/* Form Dialog */}
			<LevelFormDialog
				open={formOpen}
				onClose={() => setFormOpen(false)}
				onSubmit={editingLevel ? handleUpdate : handleCreate}
				initialData={editingLevel || undefined}
				existingLevels={levels}
				isEdit={!!editingLevel}
			/>

			{/* Delete Confirmation Dialog */}
			<DeleteConfirmDialog
				open={deleteDialogOpen}
				onClose={() => setDeleteDialogOpen(false)}
				onConfirm={handleDelete}
				levelToDelete={levelToDelete}
				otherLevels={levels.filter((l) => l.id !== levelToDelete?.id)}
			/>
		</Box>
	);
}
