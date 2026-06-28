/**
 * WorkflowRulesSettings Component - CRUD for project workflow automation rules
 * Feature: 017-realtime-task-collaboration-system
 *
 * Features:
 * - List all workflow rules with trigger and action details
 * - Create new automation rules (triggers: state_entered, state_exited, field_changed, task_created)
 * - Configure actions (set_state, set_field, assign_user, notify, close_task)
 * - Enable/disable rules
 * - Delete rules with confirmation
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
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import EditNoteIcon from '@mui/icons-material/EditNote';
import AddTaskIcon from '@mui/icons-material/AddTask';
import CategoryIcon from '@mui/icons-material/Category';
import TuneIcon from '@mui/icons-material/Tune';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import {
	listWorkflowRules,
	createWorkflowRule,
	updateWorkflowRule,
	deleteWorkflowRule,
	listCustomFields,
	type WorkflowRule,
	type WorkflowTriggerType,
	type WorkflowActionType,
	type CustomFieldDefinition,
} from 'apis';

// =============================================================================
// Trigger and Action Type Options
// =============================================================================

interface TriggerTypeOption {
	value: WorkflowTriggerType;
	label: string;
	icon: React.ReactNode;
	description: string;
	requiresState: boolean;
	requiresField: boolean;
}

const TRIGGER_TYPE_OPTIONS: TriggerTypeOption[] = [
	{ value: 'state_entered', label: 'State Entered', icon: <LoginIcon />, description: 'When a task enters a specific state', requiresState: true, requiresField: false },
	{ value: 'state_exited', label: 'State Exited', icon: <LogoutIcon />, description: 'When a task leaves a specific state', requiresState: true, requiresField: false },
	{ value: 'field_changed', label: 'Field Changed', icon: <EditNoteIcon />, description: 'When a custom field value changes', requiresState: false, requiresField: true },
	{ value: 'task_created', label: 'Task Created', icon: <AddTaskIcon />, description: 'When a new task is created', requiresState: false, requiresField: false },
];

interface ActionTypeOption {
	value: WorkflowActionType;
	label: string;
	icon: React.ReactNode;
	description: string;
}

const ACTION_TYPE_OPTIONS: ActionTypeOption[] = [
	{ value: 'set_state', label: 'Set State', icon: <CategoryIcon />, description: 'Change the task state' },
	{ value: 'set_field', label: 'Set Field', icon: <TuneIcon />, description: 'Set a custom field value' },
	{ value: 'assign_user', label: 'Assign User', icon: <PersonAddIcon />, description: 'Assign an employee to the task' },
	{ value: 'notify', label: 'Send Notification', icon: <NotificationsActiveIcon />, description: 'Send a notification' },
	{ value: 'close_task', label: 'Close Task', icon: <DoneAllIcon />, description: 'Mark the task as closed' },
];

const getTriggerIcon = (triggerType: WorkflowTriggerType): React.ReactNode => {
	const option = TRIGGER_TYPE_OPTIONS.find((opt) => opt.value === triggerType);
	return option?.icon || <PlayArrowIcon />;
};

const getTriggerLabel = (triggerType: WorkflowTriggerType): string => {
	const option = TRIGGER_TYPE_OPTIONS.find((opt) => opt.value === triggerType);
	return option?.label || triggerType;
};

const getActionIcon = (actionType: WorkflowActionType): React.ReactNode => {
	const option = ACTION_TYPE_OPTIONS.find((opt) => opt.value === actionType);
	return option?.icon || <ArrowForwardIcon />;
};

const getActionLabel = (actionType: WorkflowActionType): string => {
	const option = ACTION_TYPE_OPTIONS.find((opt) => opt.value === actionType);
	return option?.label || actionType;
};

// =============================================================================
// Rule Form Dialog
// =============================================================================

interface RuleFormDialogProps {
	open: boolean;
	onClose: () => void;
	onSubmit: (data: RuleFormData) => Promise<void>;
	initialData?: WorkflowRule;
	existingRules: WorkflowRule[];
	isEdit: boolean;
	customFields: CustomFieldDefinition[];
}

interface RuleFormData {
	name: string;
	description: string;
	triggerType: WorkflowTriggerType;
	triggerStateId?: string;
	triggerFieldId?: string;
	actionType: WorkflowActionType;
	actionPayload: Record<string, unknown>;
	isEnabled: boolean;
}

function RuleFormDialog({
	open,
	onClose,
	onSubmit,
	initialData,
	existingRules,
	isEdit,
	customFields,
}: RuleFormDialogProps) {
	const { states } = useProjectContext();
	
	const [formData, setFormData] = useState<RuleFormData>({
		name: initialData?.name || '',
		description: initialData?.description || '',
		triggerType: initialData?.triggerType || 'state_entered',
		triggerStateId: initialData?.triggerStateId || '',
		triggerFieldId: initialData?.triggerFieldId || '',
		actionType: initialData?.actionType || 'set_state',
		actionPayload: initialData?.actionPayload || {},
		isEnabled: initialData?.isEnabled ?? true,
	});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			setFormData({
				name: initialData?.name || '',
				description: initialData?.description || '',
				triggerType: initialData?.triggerType || 'state_entered',
				triggerStateId: initialData?.triggerStateId || '',
				triggerFieldId: initialData?.triggerFieldId || '',
				actionType: initialData?.actionType || 'set_state',
				actionPayload: initialData?.actionPayload || {},
				isEnabled: initialData?.isEnabled ?? true,
			});
			setError(null);
		}
	}, [open, initialData]);

	const handleSubmit = async () => {
		if (!formData.name.trim()) {
			setError('Rule name is required');
			return;
		}

		// Check for duplicate names (excluding current rule if editing)
		const isDuplicate = existingRules.some(
			(r) =>
				r.name.toLowerCase() === formData.name.trim().toLowerCase() &&
				(!initialData || r.id !== initialData.id)
		);
		if (isDuplicate) {
			setError('A rule with this name already exists');
			return;
		}

		// Validate trigger requirements
		const triggerOption = TRIGGER_TYPE_OPTIONS.find((t) => t.value === formData.triggerType);
		if (triggerOption?.requiresState && !formData.triggerStateId) {
			setError('Please select a trigger state');
			return;
		}
		if (triggerOption?.requiresField && !formData.triggerFieldId) {
			setError('Please select a trigger field');
			return;
		}

		try {
			setSaving(true);
			setError(null);
			await onSubmit(formData);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save rule');
		} finally {
			setSaving(false);
		}
	};

	const selectedTrigger = TRIGGER_TYPE_OPTIONS.find((t) => t.value === formData.triggerType);

	return (
		<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
			<DialogTitle>{isEdit ? 'Edit Workflow Rule' : 'Create Workflow Rule'}</DialogTitle>
			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
					{error && <Alert severity="error">{error}</Alert>}

					<TextField
						label="Rule Name"
						value={formData.name}
						onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
						fullWidth
						required
						autoFocus
						placeholder="e.g., Auto-assign on review, Notify on completion"
					/>

					<TextField
						label="Description"
						value={formData.description}
						onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
						fullWidth
						multiline
						rows={2}
						placeholder="Optional description of what this rule does"
					/>

					<Divider>
						<Typography variant="caption" color="text.secondary">
							WHEN (Trigger)
						</Typography>
					</Divider>

					<FormControl fullWidth>
						<InputLabel>Trigger Type</InputLabel>
						<Select
							value={formData.triggerType}
							label="Trigger Type"
							onChange={(e) =>
								setFormData((prev) => ({
									...prev,
									triggerType: e.target.value as WorkflowTriggerType,
									triggerStateId: '',
									triggerFieldId: '',
								}))
							}
						>
							{TRIGGER_TYPE_OPTIONS.map((option) => (
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

					{selectedTrigger?.requiresState && states && states.length > 0 && (
						<FormControl fullWidth>
							<InputLabel>Trigger State</InputLabel>
							<Select
								value={formData.triggerStateId || ''}
								label="Trigger State"
								onChange={(e) =>
									setFormData((prev) => ({ ...prev, triggerStateId: e.target.value }))
								}
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
											{state.name}
										</Box>
									</MenuItem>
								))}
							</Select>
						</FormControl>
					)}

					{selectedTrigger?.requiresField && customFields && customFields.length > 0 && (
						<FormControl fullWidth>
							<InputLabel>Trigger Field</InputLabel>
							<Select
								value={formData.triggerFieldId || ''}
								label="Trigger Field"
								onChange={(e) =>
									setFormData((prev) => ({ ...prev, triggerFieldId: e.target.value }))
								}
							>
								{customFields.filter(f => !f.isArchived).map((field) => (
									<MenuItem key={field.id} value={field.id}>
										{field.name}
									</MenuItem>
								))}
							</Select>
						</FormControl>
					)}

					<Divider>
						<Typography variant="caption" color="text.secondary">
							THEN (Action)
						</Typography>
					</Divider>

					<FormControl fullWidth>
						<InputLabel>Action Type</InputLabel>
						<Select
							value={formData.actionType}
							label="Action Type"
							onChange={(e) =>
								setFormData((prev) => ({
									...prev,
									actionType: e.target.value as WorkflowActionType,
									actionPayload: {},
								}))
							}
						>
							{ACTION_TYPE_OPTIONS.map((option) => (
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

					{/* Action payload based on action type */}
					{formData.actionType === 'set_state' && states && states.length > 0 && (
						<FormControl fullWidth>
							<InputLabel>Target State</InputLabel>
							<Select
								value={(formData.actionPayload.stateId as string) || ''}
								label="Target State"
								onChange={(e) =>
									setFormData((prev) => ({
										...prev,
										actionPayload: { stateId: e.target.value },
									}))
								}
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
											{state.name}
										</Box>
									</MenuItem>
								))}
							</Select>
						</FormControl>
					)}

					{formData.actionType === 'notify' && (
						<TextField
							label="Notification Message"
							value={(formData.actionPayload.message as string) || ''}
							onChange={(e) =>
								setFormData((prev) => ({
									...prev,
									actionPayload: { message: e.target.value },
								}))
							}
							fullWidth
							multiline
							rows={2}
							placeholder="Message to include in the notification"
						/>
					)}

					<Divider />

					<FormControlLabel
						control={
							<Switch
								checked={formData.isEnabled}
								onChange={(e) =>
									setFormData((prev) => ({ ...prev, isEnabled: e.target.checked }))
								}
							/>
						}
						label="Enable rule"
					/>
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={saving}>
					Cancel
				</Button>
				<Button onClick={handleSubmit} variant="contained" disabled={saving}>
					{saving ? <CircularProgress size={20} /> : isEdit ? 'Save Changes' : 'Create Rule'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Delete Confirm Dialog
// =============================================================================

interface DeleteConfirmDialogProps {
	open: boolean;
	onClose: () => void;
	onConfirm: () => Promise<void>;
	rule: WorkflowRule | null;
}

function DeleteConfirmDialog({
	open,
	onClose,
	onConfirm,
	rule,
}: DeleteConfirmDialogProps) {
	const [processing, setProcessing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleConfirm = async () => {
		try {
			setProcessing(true);
			setError(null);
			await onConfirm();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete rule');
		} finally {
			setProcessing(false);
		}
	};

	if (!rule) return null;

	return (
		<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
			<DialogTitle>Delete Workflow Rule</DialogTitle>
			<DialogContent>
				<Box sx={{ pt: 1 }}>
					{error && (
						<Alert severity="error" sx={{ mb: 2 }}>
							{error}
						</Alert>
					)}
					<Typography>
						Are you sure you want to delete &quot;{rule.name}&quot;? This action cannot be undone.
					</Typography>
				</Box>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={processing}>
					Cancel
				</Button>
				<Button onClick={handleConfirm} variant="contained" color="error" disabled={processing}>
					{processing ? <CircularProgress size={20} /> : 'Delete'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

// =============================================================================
// Main Component
// =============================================================================

export default function WorkflowRulesSettings() {
	const colors = useThemeColors();
	const { project, states } = useProjectContext();
	
	const [rules, setRules] = useState<WorkflowRule[]>([]);
	const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showDisabled, setShowDisabled] = useState(false);

	// Dialog states
	const [formDialogOpen, setFormDialogOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<WorkflowRule | null>(null);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletingRule, setDeletingRule] = useState<WorkflowRule | null>(null);

	// Load rules and custom fields
	const loadData = useCallback(async () => {
		if (!project?.id) return;
		
		try {
			setLoading(true);
			setError(null);
			const [rulesResponse, fieldsResponse] = await Promise.all([
				listWorkflowRules({
					projectId: project.id,
					includeDisabled: showDisabled,
				}),
				listCustomFields({
					projectId: project.id,
					includeArchived: false,
				}),
			]);
			// Sort by position
			const sorted = [...rulesResponse.rules].sort((a, b) => a.position - b.position);
			setRules(sorted);
			setCustomFields(fieldsResponse.fields);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load workflow rules');
		} finally {
			setLoading(false);
		}
	}, [project?.id, showDisabled]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	// Handlers
	const handleCreateClick = () => {
		setEditingRule(null);
		setFormDialogOpen(true);
	};

	const handleEditClick = (rule: WorkflowRule) => {
		setEditingRule(rule);
		setFormDialogOpen(true);
	};

	const handleDeleteClick = (rule: WorkflowRule) => {
		setDeletingRule(rule);
		setDeleteDialogOpen(true);
	};

	const handleToggleEnabled = async (rule: WorkflowRule) => {
		try {
			const updated = await updateWorkflowRule({
				ruleId: rule.id,
				isEnabled: !rule.isEnabled,
			});
			setRules((prev) =>
				prev.map((r) => (r.id === rule.id ? updated.rule : r))
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update rule');
		}
	};

	const handleFormSubmit = async (data: RuleFormData) => {
		if (editingRule) {
			// Update existing rule
			const updated = await updateWorkflowRule({
				ruleId: editingRule.id,
				name: data.name,
				description: data.description,
				triggerType: data.triggerType,
				triggerStateId: data.triggerStateId,
				triggerFieldId: data.triggerFieldId,
				actionType: data.actionType,
				actionPayload: data.actionPayload,
				isEnabled: data.isEnabled,
			});
			setRules((prev) =>
				prev.map((r) => (r.id === editingRule.id ? updated.rule : r))
			);
		} else {
			// Create new rule
			const created = await createWorkflowRule({
				projectId: project!.id,
				name: data.name,
				description: data.description,
				triggerType: data.triggerType,
				triggerStateId: data.triggerStateId,
				triggerFieldId: data.triggerFieldId,
				actionType: data.actionType,
				actionPayload: data.actionPayload,
			});
			setRules((prev) => [...prev, created.rule]);
		}
	};

	const handleDeleteConfirm = async () => {
		if (!deletingRule) return;
		await deleteWorkflowRule(deletingRule.id);
		setRules((prev) => prev.filter((r) => r.id !== deletingRule.id));
	};

	// Helper to get state name by ID
	const getStateName = (stateId: string): string => {
		const state = states?.find((s) => s.id === stateId);
		return state?.name || 'Unknown State';
	};

	// Filter rules based on disabled toggle
	const displayedRules = showDisabled ? rules : rules.filter((r) => r.isEnabled);

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
					<Typography variant="h6">Workflow Automation</Typography>
					<Typography variant="body2" color="text.secondary">
						Configure rules to automate task workflows
					</Typography>
				</Box>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
					<FormControlLabel
						control={
							<Switch
								checked={showDisabled}
								onChange={(e) => setShowDisabled(e.target.checked)}
								size="small"
							/>
						}
						label="Show disabled"
					/>
					<Button
						variant="contained"
						startIcon={<AddIcon />}
						onClick={handleCreateClick}
					>
						Add Rule
					</Button>
				</Box>
			</Box>

			{error && (
				<Alert severity="error" sx={{ mb: 2 }}>
					{error}
				</Alert>
			)}

			{/* Rules List */}
			{displayedRules.length === 0 ? (
				<Paper sx={{ p: 4, textAlign: 'center', ...colors.bg.paper.style }}>
					<Typography color="text.secondary">
						{showDisabled
							? 'No workflow rules defined yet'
							: 'No active workflow rules. Add a rule or enable "Show disabled" to see disabled rules.'}
					</Typography>
				</Paper>
			) : (
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
					{displayedRules.map((rule) => (
						<Paper
							key={rule.id}
							sx={{
								p: 2,
								display: 'flex',
								alignItems: 'center',
								gap: 2,
								...colors.bg.paper.style,
								opacity: rule.isEnabled ? 1 : 0.6,
							}}
						>
							{/* Enable/Disable Toggle */}
							<IconButton
								size="small"
								onClick={() => handleToggleEnabled(rule)}
								title={rule.isEnabled ? 'Disable rule' : 'Enable rule'}
								color={rule.isEnabled ? 'success' : 'default'}
							>
								{rule.isEnabled ? <PlayArrowIcon /> : <StopIcon />}
							</IconButton>

							{/* Rule Info */}
							<Box sx={{ flex: 1, minWidth: 0 }}>
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
									<Typography variant="subtitle1" noWrap>
										{rule.name}
									</Typography>
									{!rule.isEnabled && (
										<Chip label="Disabled" size="small" color="default" />
									)}
								</Box>
								{rule.description && (
									<Typography variant="body2" color="text.secondary" noWrap>
										{rule.description}
									</Typography>
								)}
								{/* Trigger → Action summary */}
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
									<Chip
										icon={<Box sx={{ display: 'flex', pl: 0.5 }}>{getTriggerIcon(rule.triggerType)}</Box>}
										label={
											rule.triggerStateId
												? `${getTriggerLabel(rule.triggerType)}: ${getStateName(rule.triggerStateId)}`
												: getTriggerLabel(rule.triggerType)
										}
										size="small"
										variant="outlined"
									/>
									<ArrowForwardIcon fontSize="small" color="action" />
									<Chip
										icon={<Box sx={{ display: 'flex', pl: 0.5 }}>{getActionIcon(rule.actionType)}</Box>}
										label={
											rule.actionType === 'set_state' && rule.actionPayload.stateId
												? `${getActionLabel(rule.actionType)}: ${getStateName(rule.actionPayload.stateId as string)}`
												: getActionLabel(rule.actionType)
										}
										size="small"
										variant="outlined"
									/>
								</Box>
							</Box>

							{/* Actions */}
							<Box sx={{ display: 'flex', gap: 1 }}>
								<IconButton
									size="small"
									onClick={() => handleEditClick(rule)}
									title="Edit rule"
								>
									<EditIcon />
								</IconButton>
								<IconButton
									size="small"
									onClick={() => handleDeleteClick(rule)}
									title="Delete rule"
									color="error"
								>
									<DeleteIcon />
								</IconButton>
							</Box>
						</Paper>
					))}
				</Box>
			)}

			{/* Dialogs */}
			<RuleFormDialog
				open={formDialogOpen}
				onClose={() => setFormDialogOpen(false)}
				onSubmit={handleFormSubmit}
				initialData={editingRule || undefined}
				existingRules={rules}
				isEdit={!!editingRule}
				customFields={customFields}
			/>

			<DeleteConfirmDialog
				open={deleteDialogOpen}
				onClose={() => setDeleteDialogOpen(false)}
				onConfirm={handleDeleteConfirm}
				rule={deletingRule}
			/>
		</Box>
	);
}
