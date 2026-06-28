/**
 * CustomFieldsSettings Component - CRUD for project custom field definitions
 * Feature: 017-realtime-task-collaboration-system
 *
 * Features:
 * - List all custom field definitions with name, type, and configuration
 * - Create new fields (text, number, single_select, multi_select, date, user, checkbox)
 * - Edit existing field properties
 * - Archive/unarchive fields (soft delete to preserve task data)
 * - Configure field-specific options (min/max for numbers, options for selects)
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
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
	Chip,
	Switch,
	FormControlLabel,
	Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import NumbersIcon from '@mui/icons-material/Numbers';
import ListIcon from '@mui/icons-material/List';
import ChecklistRtlIcon from '@mui/icons-material/ChecklistRtl';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PersonIcon from '@mui/icons-material/Person';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import {
	listCustomFields,
	createCustomField,
	updateCustomField,
	archiveCustomField,
	type CustomFieldDefinition,
	type CustomFieldType,
} from 'apis';

// =============================================================================
// Field Type Options
// =============================================================================

interface FieldTypeOption {
	value: CustomFieldType;
	label: string;
	icon: React.ReactNode;
	description: string;
}

const FIELD_TYPE_OPTIONS: FieldTypeOption[] = [
	{ value: 'text', label: 'Text', icon: <TextFieldsIcon />, description: 'Single line text' },
	{ value: 'number', label: 'Number', icon: <NumbersIcon />, description: 'Numeric values' },
	{ value: 'single_select', label: 'Single Select', icon: <ListIcon />, description: 'Choose one option' },
	{ value: 'multi_select', label: 'Multi Select', icon: <ChecklistRtlIcon />, description: 'Choose multiple options' },
	{ value: 'date', label: 'Date', icon: <CalendarMonthIcon />, description: 'Date picker' },
	{ value: 'user', label: 'User', icon: <PersonIcon />, description: 'Employee picker' },
	{ value: 'checkbox', label: 'Checkbox', icon: <CheckBoxIcon />, description: 'True/false toggle' },
];

const getFieldTypeIcon = (fieldType: CustomFieldType): React.ReactNode => {
	const option = FIELD_TYPE_OPTIONS.find((opt) => opt.value === fieldType);
	return option?.icon || <TextFieldsIcon />;
};

const getFieldTypeLabel = (fieldType: CustomFieldType): string => {
	const option = FIELD_TYPE_OPTIONS.find((opt) => opt.value === fieldType);
	return option?.label || fieldType;
};

// =============================================================================
// Field Form Dialog
// =============================================================================

interface FieldFormDialogProps {
	open: boolean;
	onClose: () => void;
	onSubmit: (data: FieldFormData) => Promise<void>;
	initialData?: CustomFieldDefinition;
	existingFields: CustomFieldDefinition[];
	isEdit: boolean;
}

interface FieldFormData {
	name: string;
	description: string;
	fieldType: CustomFieldType;
	options: string[];
	isRequired: boolean;
	minValue?: number;
	maxValue?: number;
	defaultValue?: string;
}

function FieldFormDialog({
	open,
	onClose,
	onSubmit,
	initialData,
	existingFields,
	isEdit,
}: FieldFormDialogProps) {
	const [formData, setFormData] = useState<FieldFormData>({
		name: initialData?.name || '',
		description: initialData?.description || '',
		fieldType: initialData?.fieldType || 'text',
		options: initialData?.options || [],
		isRequired: initialData?.isRequired || false,
		minValue: initialData?.minValue,
		maxValue: initialData?.maxValue,
		defaultValue: initialData?.defaultValue ? String(initialData.defaultValue) : '',
	});
	const [newOption, setNewOption] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			setFormData({
				name: initialData?.name || '',
				description: initialData?.description || '',
				fieldType: initialData?.fieldType || 'text',
				options: initialData?.options || [],
				isRequired: initialData?.isRequired || false,
				minValue: initialData?.minValue,
				maxValue: initialData?.maxValue,
				defaultValue: initialData?.defaultValue ? String(initialData.defaultValue) : '',
			});
			setNewOption('');
			setError(null);
		}
	}, [open, initialData]);

	const handleSubmit = async () => {
		if (!formData.name.trim()) {
			setError('Field name is required');
			return;
		}

		// Check for duplicate names (excluding current field if editing)
		const isDuplicate = existingFields.some(
			(f) =>
				f.name.toLowerCase() === formData.name.trim().toLowerCase() &&
				(!initialData || f.id !== initialData.id)
		);
		if (isDuplicate) {
			setError('A field with this name already exists');
			return;
		}

		// Validate select fields have options
		if ((formData.fieldType === 'single_select' || formData.fieldType === 'multi_select') && formData.options.length === 0) {
			setError('Select fields must have at least one option');
			return;
		}

		// Validate number field min/max
		if (formData.fieldType === 'number' && formData.minValue !== undefined && formData.maxValue !== undefined) {
			if (formData.minValue > formData.maxValue) {
				setError('Minimum value cannot be greater than maximum value');
				return;
			}
		}

		try {
			setSaving(true);
			setError(null);
			await onSubmit(formData);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save field');
		} finally {
			setSaving(false);
		}
	};

	const handleAddOption = () => {
		const trimmed = newOption.trim();
		if (trimmed && !formData.options.includes(trimmed)) {
			setFormData((prev) => ({
				...prev,
				options: [...prev.options, trimmed],
			}));
			setNewOption('');
		}
	};

	const handleRemoveOption = (optionToRemove: string) => {
		setFormData((prev) => ({
			...prev,
			options: prev.options.filter((opt) => opt !== optionToRemove),
		}));
	};

	const showOptionsEditor = formData.fieldType === 'single_select' || formData.fieldType === 'multi_select';
	const showNumberConfig = formData.fieldType === 'number';

	return (
		<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
			<DialogTitle>{isEdit ? 'Edit Custom Field' : 'Create Custom Field'}</DialogTitle>
			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}

					<TextField
						label="Field Name"
						value={formData.name}
						onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
						fullWidth
						required
						autoFocus
						placeholder="e.g., Story Points, Priority, Sprint"
					/>

					<TextField
						label="Description"
						value={formData.description}
						onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
						fullWidth
						multiline
						rows={2}
						placeholder="Optional description of this field"
					/>

					<FormControl fullWidth disabled={isEdit}>
						<InputLabel>Field Type</InputLabel>
						<Select
							value={formData.fieldType}
							label="Field Type"
							onChange={(e) =>
								setFormData((prev) => ({
									...prev,
									fieldType: e.target.value as CustomFieldType,
									options: [], // Reset options when type changes
									minValue: undefined,
									maxValue: undefined,
								}))
							}
						>
							{FIELD_TYPE_OPTIONS.map((option) => (
								<MenuItem key={option.value} value={option.value}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										{option.icon}
										<Box>
											<Typography variant="body2">{option.label}</Typography>
											<Typography variant="caption" color="text.secondary">
												{option.description}
											</Typography>
										</Box>
									</Box>
								</MenuItem>
							))}
						</Select>
					</FormControl>
					{isEdit && (
						<Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
							Field type cannot be changed after creation
						</Typography>
					)}

					{showOptionsEditor && (
						<Box>
							<Typography variant="subtitle2" sx={{ mb: 1 }}>
								Options
							</Typography>
							<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
								{formData.options.map((option) => (
									<Chip
										key={option}
										label={option}
										onDelete={() => handleRemoveOption(option)}
										size="small"
									/>
								))}
								{formData.options.length === 0 && (
									<Typography variant="body2" color="text.secondary">
										No options defined yet
									</Typography>
								)}
							</Box>
							<Box sx={{ display: 'flex', gap: 1 }}>
								<TextField
									size="small"
									placeholder="Add option"
									value={newOption}
									onChange={(e) => setNewOption(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											handleAddOption();
										}
									}}
									sx={{ flex: 1 }}
								/>
								<Button
									variant="outlined"
									size="small"
									onClick={handleAddOption}
									disabled={!newOption.trim()}
								>
									Add
								</Button>
							</Box>
						</Box>
					)}

					{showNumberConfig && (
						<Box sx={{ display: 'flex', gap: 2 }}>
							<TextField
								label="Min Value"
								type="number"
								value={formData.minValue ?? ''}
								onChange={(e) =>
									setFormData((prev) => ({
										...prev,
										minValue: e.target.value ? Number(e.target.value) : undefined,
									}))
								}
								sx={{ flex: 1 }}
							/>
							<TextField
								label="Max Value"
								type="number"
								value={formData.maxValue ?? ''}
								onChange={(e) =>
									setFormData((prev) => ({
										...prev,
										maxValue: e.target.value ? Number(e.target.value) : undefined,
									}))
								}
								sx={{ flex: 1 }}
							/>
						</Box>
					)}

					<Divider />

					<FormControlLabel
						control={
							<Switch
								checked={formData.isRequired}
								onChange={(e) =>
									setFormData((prev) => ({ ...prev, isRequired: e.target.checked }))
								}
							/>
						}
						label="Required field"
					/>

					{!isEdit && formData.fieldType === 'text' && (
						<TextField
							label="Default Value"
							value={formData.defaultValue}
							onChange={(e) => setFormData((prev) => ({ ...prev, defaultValue: e.target.value }))}
							fullWidth
							placeholder="Optional default value"
						/>
					)}
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={saving}>
					Cancel
				</Button>
				<Button onClick={handleSubmit} variant="contained" disabled={saving}>
					{saving ? <CircularProgress size={20} /> : isEdit ? 'Save Changes' : 'Create Field'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Archive Confirm Dialog
// =============================================================================

interface ArchiveConfirmDialogProps {
	open: boolean;
	onClose: () => void;
	onConfirm: () => Promise<void>;
	field: CustomFieldDefinition | null;
	isArchiving: boolean;
}

function ArchiveConfirmDialog({
	open,
	onClose,
	onConfirm,
	field,
	isArchiving,
}: ArchiveConfirmDialogProps) {
	const [processing, setProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleConfirm = async () => {
		try {
			setProcessing(true);
			setError(null);
			await onConfirm();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Operation failed');
		} finally {
			setProcessing(false);
		}
	};

	if (!field) return null;

	return (
		<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
			<DialogTitle>{isArchiving ? 'Archive Field' : 'Restore Field'}</DialogTitle>
			<DialogContent>
				<Box sx={{ pt: 1 }}>
					{error && (
						<Alert severity="error" sx={{ mb: 2 }}>
							{error}
						</Alert>
					)}
					<Typography>
						{isArchiving
							? `Are you sure you want to archive "${field.name}"? Existing task data will be preserved but the field will be hidden from new tasks.`
							: `Are you sure you want to restore "${field.name}"? The field will be available on all tasks again.`}
					</Typography>
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={processing}>
					Cancel
				</Button>
				<Button
					onClick={handleConfirm}
					variant="contained"
					color={isArchiving ? 'warning' : 'primary'}
					disabled={processing}
				>
					{processing ? <CircularProgress size={20} /> : isArchiving ? 'Archive' : 'Restore'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Main Component
// =============================================================================

export default function CustomFieldsSettings() {
	const colors = useThemeColors();
	const { project } = useProjectContext();
	
	const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showArchived, setShowArchived] = useState(false);

	// Dialog states
	const [formDialogOpen, setFormDialogOpen] = useState(false);
	const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
	const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
	const [archivingField, setArchivingField] = useState<CustomFieldDefinition | null>(null);
	const [isArchiving, setIsArchiving] = useState(true);

	// Load fields
	const loadFields = useCallback(async () => {
		if (!project?.id) return;
		
		try {
			setLoading(true);
			setError(null);
			const response = await listCustomFields({
				projectId: project.id,
				includeArchived: showArchived,
			});
			// Sort by position
			const sorted = [...response.fields].sort((a, b) => a.position - b.position);
			setFields(sorted);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load custom fields');
		} finally {
			setLoading(false);
		}
	}, [project?.id, showArchived]);

	useEffect(() => {
		loadFields();
	}, [loadFields]);

	// Handlers
	const handleCreateClick = () => {
		setEditingField(null);
		setFormDialogOpen(true);
	};

	const handleEditClick = (field: CustomFieldDefinition) => {
		setEditingField(field);
		setFormDialogOpen(true);
	};

	const handleArchiveClick = (field: CustomFieldDefinition) => {
		setArchivingField(field);
		setIsArchiving(!field.isArchived);
		setArchiveDialogOpen(true);
	};

	const handleFormSubmit = async (data: FieldFormData) => {
		if (editingField) {
			// Update existing field
			const updated = await updateCustomField({
				fieldId: editingField.id,
				name: data.name,
				description: data.description,
				options: data.options,
				isRequired: data.isRequired,
				minValue: data.minValue,
				maxValue: data.maxValue,
			});
			setFields((prev) =>
				prev.map((f) => (f.id === editingField.id ? updated.field : f))
			);
		} else {
			// Create new field
			const created = await createCustomField({
				projectId: project!.id,
				name: data.name,
				description: data.description,
				fieldType: data.fieldType,
				options: data.options,
				isRequired: data.isRequired,
				minValue: data.minValue,
				maxValue: data.maxValue,
				defaultValue: data.defaultValue,
			});
			setFields((prev) => [...prev, created.field]);
		}
	};

	const handleArchiveConfirm = async () => {
		if (!archivingField) return;
		
		const updated = await archiveCustomField(archivingField.id, isArchiving);
		
		if (isArchiving && !showArchived) {
			// Remove from list if archiving and not showing archived
			setFields((prev) => prev.filter((f) => f.id !== archivingField.id));
		} else {
			// Update in list
			setFields((prev) =>
				prev.map((f) => (f.id === archivingField.id ? updated.field : f))
			);
		}
	};

	// Filter fields based on archive toggle
	const displayedFields = showArchived ? fields : fields.filter((f) => !f.isArchived);

	// Render
	if (loading) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
				<CircularProgress />
			</Box>
		);
	}

	return (
		<Box>
			{/* Header */}
			<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
				<Box>
					<Typography variant="h6">Custom Fields</Typography>
					<Typography variant="body2" color="text.secondary">
						Define custom fields to capture additional task information
					</Typography>
				</Box>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
					<FormControlLabel
						control={
							<Switch
								checked={showArchived}
								onChange={(e) => setShowArchived(e.target.checked)}
								size="small"
							/>
						}
						label="Show archived"
					/>
					<Button
						variant="contained"
						startIcon={<AddIcon />}
						onClick={handleCreateClick}
					>
						Add Field
					</Button>
				</Box>
			</Box>

			{error && (
				<Alert severity="error" sx={{ mb: 2 }}>
					{error}
				</Alert>
			)}

			{/* Fields List */}
			{displayedFields.length === 0 ? (
				<Paper sx={{ p: 4, textAlign: 'center', ...colors.bg.paper.style }}>
					<Typography color="text.secondary">
						{showArchived
							? 'No custom fields defined yet'
							: 'No active custom fields. Add a field or enable "Show archived" to see archived fields.'}
					</Typography>
				</Paper>
			) : (
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
					{displayedFields.map((field) => (
						<Paper
							key={field.id}
							sx={{
								p: 2,
								display: 'flex',
								alignItems: 'center',
								gap: 2,
								...colors.bg.paper.style,
								opacity: field.isArchived ? 0.6 : 1,
							}}
						>
							{/* Type Icon */}
							<Box
								sx={{
									width: 40,
									height: 40,
									borderRadius: 1,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									backgroundColor: 'action.hover',
								}}
							>
								{getFieldTypeIcon(field.fieldType)}
							</Box>

							{/* Field Info */}
							<Box sx={{ flex: 1, minWidth: 0 }}>
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
									<Typography variant="subtitle1" noWrap>
										{field.name}
									</Typography>
									{field.isRequired && (
										<Chip label="Required" size="small" color="primary" variant="outlined" />
									)}
									{field.isArchived && (
										<Chip label="Archived" size="small" color="default" />
									)}
								</Box>
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
									<Chip
										label={getFieldTypeLabel(field.fieldType)}
										size="small"
										variant="outlined"
									/>
									{field.description && (
										<Typography variant="body2" color="text.secondary" noWrap>
											{field.description}
										</Typography>
									)}
								</Box>
								{/* Show options for select fields */}
								{(field.fieldType === 'single_select' || field.fieldType === 'multi_select') &&
									field.options.length > 0 && (
										<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
											{field.options.slice(0, 5).map((opt) => (
												<Chip key={opt} label={opt} size="small" variant="outlined" />
											))}
											{field.options.length > 5 && (
												<Chip
													label={`+${field.options.length - 5} more`}
													size="small"
													variant="outlined"
												/>
											)}
										</Box>
									)}
								{/* Show min/max for number fields */}
								{field.fieldType === 'number' &&
									(field.minValue !== undefined || field.maxValue !== undefined) && (
										<Typography variant="caption" color="text.secondary">
											Range: {field.minValue ?? '-∞'} to {field.maxValue ?? '∞'}
										</Typography>
									)}
							</Box>

							{/* Actions */}
							<Box sx={{ display: 'flex', gap: 1 }}>
								<IconButton
									size="small"
									onClick={() => handleEditClick(field)}
									title="Edit field"
								>
									<EditIcon />
								</IconButton>
								<IconButton
									size="small"
									onClick={() => handleArchiveClick(field)}
									title={field.isArchived ? 'Restore field' : 'Archive field'}
									color={field.isArchived ? 'primary' : 'default'}
								>
									{field.isArchived ? <UnarchiveIcon /> : <ArchiveIcon />}
								</IconButton>
							</Box>
						</Paper>
					))}
				</Box>
			)}

			{/* Dialogs */}
			<FieldFormDialog
				open={formDialogOpen}
				onClose={() => setFormDialogOpen(false)}
				onSubmit={handleFormSubmit}
				initialData={editingField || undefined}
				existingFields={fields}
				isEdit={!!editingField}
			/>

			<ArchiveConfirmDialog
				open={archiveDialogOpen}
				onClose={() => setArchiveDialogOpen(false)}
				onConfirm={handleArchiveConfirm}
				field={archivingField}
				isArchiving={isArchiving}
			/>
		</Box>
	);
}
