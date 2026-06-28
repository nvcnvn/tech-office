/**
 * Task Detail Page
 * Full-width dedicated page for viewing task information
 * Feature: 017-realtime-task-collaboration-system (T146)
 *
 * Features:
 * - Full-width layout with sidebar and main content area
 * - Sidebar: metadata, assignees, watchers, custom fields
 * - Main area: title, description, comments, attachments, subtasks
 * - Breadcrumb navigation
 * - Deep linking support from notifications
 * - Shared components with TaskDetailDialog
 * - Create child tasks (subtasks) directly from task page
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import NextLink from 'next/link';
import {
	Box,
	Typography,
	Breadcrumbs,
	Link,
	TextField,
	Button,
	Select,
	MenuItem,
	FormControl,
	Chip,
	Divider,
	CircularProgress,
	Paper,
	IconButton,
	Tooltip,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	InputLabel,
	Alert,
	List,
	ListItem,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	Menu,
	Popover,
} from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import NotificationsIcon from '@mui/icons-material/Notifications';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import { useThemeColors } from '@/theme/useThemeColors';
import { useRequireAuth } from '@/lib/auth/hooks';
import {
	getTask,
	getProject,
	getDocument,
	updateTask,
	deleteTask,
	moveTask,
	watchTask,
	unwatchTask,
	listProjectStates,
	listTaskLevels,
	listTasks,
	createTask,
	getFileMetadataBatch,
	listCustomFields,
	getResourceSubscription,
	setResourceSubscriptionPreference,
	SubscriptionPreferenceLevel,
	assignTask,
	unassignTask,
	listProjectMembers,
	type Task,
	type Project,
	type Document as DocDocument,
	type ProjectState,
	type TaskLevel,
	type UpdateTaskParams,
	type FileMetadata,
	type CustomFieldDefinition,
	type ProjectMember,
	type ProjectMemberRole,
	hydrateRitualTask,
	type RitualDefinition,
} from 'apis';
import { UserCard, usePreloadOrgUsers } from '@/components/user';
import DocumentEditor from '@/app/workspace/docs/components/DocumentEditor';
import MessageList from '@/app/workspace/chat/components/MessageList';
import FileAttachment from '@/app/workspace/chat/components/FileAttachment';
import TaskFileUpload from './components/TaskFileUpload';
import CustomFieldEditor from './components/CustomFieldEditor';
import EvidenceChecklist from './components/EvidenceChecklist';
import RitualDefinitionSection from './components/RitualDefinitionSection';

const LINKING_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:18080';

// =============================================================================
// Main Component
// =============================================================================

type RitualFocusIntent = 'view_instance' | 'submit_requirement' | 'review_pending';

function parseRitualFocusIntent(value: string | null): RitualFocusIntent | null {
	if (value === 'view_instance' || value === 'submit_requirement' || value === 'review_pending') {
		return value;
	}

	return null;
}

export default function TaskDetailPage() {
	const colors = useThemeColors();
	const router = useRouter();
	const params = useParams();
	const searchParams = useSearchParams();
	const { isAuthenticated, isLoading: authLoading, user } = useRequireAuth();

	// Seed user profile cache so UserCard resolves names on fresh page load
	usePreloadOrgUsers(user?.organizationId);

	const projectId = params?.id as string;
	const taskId = params?.taskId as string;
	const ritualFocusIntent = useMemo(
		() => parseRitualFocusIntent(searchParams.get('focusIntent') ?? searchParams.get('intent')),
		[searchParams]
	);
	const ritualRequirementId = useMemo(
		() => searchParams.get('requirementId') ?? searchParams.get('evidenceRequirementId'),
		[searchParams]
	);
	const currentMembership = useMemo(
		() => user?.organizations.find((organization) => organization.organizationId === user.organizationId) ?? user?.organizations[0],
		[user]
	);

	// Data state
	const [project, setProject] = useState<Project | null>(null);
	const [task, setTask] = useState<Task | null>(null);
	const [states, setStates] = useState<ProjectState[]>([]);
	const [levels, setLevels] = useState<TaskLevel[]>([]);
	const [document, setDocument] = useState<DocDocument | null>(null);
	const [fileAttachments, setFileAttachments] = useState<FileMetadata[]>([]);
	const [subtasks, setSubtasks] = useState<Task[]>([]);
	const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
	const [ritualDefinition, setRitualDefinition] = useState<RitualDefinition | null>(null);
	const [currentUserRole, setCurrentUserRole] = useState<ProjectMemberRole>('viewer');

	// UI state
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [copyLinkMessage, setCopyLinkMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
	const [provisioningResources, setProvisioningResources] = useState(false);
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [isEditingDescription, setIsEditingDescription] = useState(false);
	const [isWatching, setIsWatching] = useState(false);
	const [preferenceLevel, setPreferenceLevel] = useState<number>(SubscriptionPreferenceLevel.ALL);
	const [prefMenuAnchor, setPrefMenuAnchor] = useState<HTMLElement | null>(null);
	const [isCreateSubtaskDialogOpen, setIsCreateSubtaskDialogOpen] = useState(false);
	const [subtaskLoading, setSubtaskLoading] = useState(false);

	// Form state
	const [title, setTitle] = useState('');
	const [stateId, setStateId] = useState('');
	const [startDate, setStartDate] = useState('');
	const [dueDate, setDueDate] = useState('');

	// Create subtask form state
	const [subtaskTitle, setSubtaskTitle] = useState('');
	const [subtaskLevelId, setSubtaskLevelId] = useState('');
	const [subtaskError, setSubtaskError] = useState<string | null>(null);
	const [creatingSubtask, setCreatingSubtask] = useState(false);

	// Assignee picker state
	const [assigneeAnchor, setAssigneeAnchor] = useState<HTMLElement | null>(null);
	const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
	const [assigneeSearchQuery, setAssigneeSearchQuery] = useState('');
	const [assigneeLoading, setAssigneeLoading] = useState(false);
	const instructionsPanelRef = useRef<HTMLDivElement | null>(null);
	const reviewSectionRef = useRef<HTMLDivElement | null>(null);
	const evidenceSectionRef = useRef<HTMLDivElement | null>(null);
	const definitionSectionRef = useRef<HTMLDivElement | null>(null);

	// Available levels for creating subtasks (must have depth > current task depth)
	const availableSubtaskLevels = useMemo(() => {
		if (!task) return [];
		// Subtasks should be at a deeper level than the parent
		return levels.filter((l) => l.depth > task.depth);
	}, [levels, task]);

	// Initial state for new tasks
	const initialState = useMemo(() => {
		return states.find((s) => s.isInitial);
	}, [states]);
	const ritualSectionTarget = useMemo(() => {
		if (ritualFocusIntent === 'review_pending') {
			return 'review';
		}

		if (ritualFocusIntent === 'submit_requirement' || ritualFocusIntent === 'view_instance') {
			return 'evidence';
		}

		return null;
	}, [ritualFocusIntent]);
	const canManageRitualDefinition = user?.permissionIds.includes('collab.manageRitualDefinition') ?? false;
	const canReviewRitualEvidence =
		(user?.permissionIds.includes('collab.reviewEvidence') ?? false) ||
		currentUserRole === 'owner' ||
		currentUserRole === 'admin';
	const ritualEntrySummary = useMemo(() => {
		if (!task || task.taskKind !== 'ritual_instance') {
			return null;
		}

		if (ritualSectionTarget === 'review') {
			return {
				severity: 'warning' as const,
				message:
					'Review the highlighted proof below. Approve or reject it inline on this live ritual instance.',
			};
		}

		const progress = task.evidenceProgress;
		if ((progress?.rejectedCount ?? 0) > 0) {
			return {
				severity: 'error' as const,
				message:
					'Fix the rejected proof below. The first rejected requirement is highlighted on this live ritual run.',
			};
		}

		if ((progress?.pendingReviewCount ?? 0) > 0 && (progress?.allRequiredApproved ?? false)) {
			return {
				severity: 'info' as const,
				message:
					'Your proof is waiting for review. Keep working from this live ritual instance if you need to inspect the submitted details.',
			};
		}

		if (!(progress?.allRequiredApproved ?? false)) {
			return {
				severity: 'info' as const,
				message:
					'Start with the highlighted proof step below and complete the missing required evidence on this live ritual run.',
			};
		}

		return {
			severity: 'success' as const,
			message: 'This live ritual instance already has the required proof in place. Review the recorded outcome below.',
		};
	}, [ritualSectionTarget, task]);

	// Re-triggers EnsureTaskResources on the backend by calling getTask again.
	// Used when a ritual instance task was opened but resource provisioning failed.
	const retryProvisionResources = useCallback(async () => {
		if (!taskId || provisioningResources) return;
		try {
			setProvisioningResources(true);
			const taskResp = await getTask(taskId, true);
			setTask(taskResp.task);
			if (taskResp.task.descriptionDocumentId) {
				const docResp = await getDocument({
					id: taskResp.task.descriptionDocumentId,
					includeContent: true,
				});
				setDocument(docResp.document);
			}
		} catch (err) {
			console.error('Failed to provision task resources:', err);
		} finally {
			setProvisioningResources(false);
		}
	}, [taskId, provisioningResources]);

	// Load subtasks function
	const loadSubtasks = useCallback(async () => {
		if (!projectId || !taskId) return;
		
		try {
			setSubtaskLoading(true);
			const response = await listTasks({
				projectId,
				parentTaskId: taskId,
			});
			console.log('Loaded subtasks:', response.tasks.length, 'tasks for parent:', taskId);
			setSubtasks(response.tasks);
		} catch (err) {
			console.error('Failed to load subtasks:', err);
			setSubtasks([]); // Clear subtasks on error
		} finally {
			setSubtaskLoading(false);
		}
	}, [projectId, taskId]);

	// Load data on mount
	useEffect(() => {
		if (!isAuthenticated || authLoading) return;

		async function loadData() {
			try {
				setLoading(true);
				setError(null);

				// Load project, task, states, levels, custom fields in parallel
				const [projectResp, taskResp, statesResp, levelsResp, fieldsResp] = await Promise.all([
				getProject(projectId),
				getTask(taskId, true), // Include custom fields
				listProjectStates(projectId),
				listTaskLevels(projectId),
				listCustomFields({ projectId, includeArchived: false }),
				]);

				setProject(projectResp.project);
				setCurrentUserRole(projectResp.currentUserRole);
				setTask(taskResp.task);
				setStates(statesResp.states);
				setLevels(levelsResp.levels);
				setCustomFields(fieldsResp.fields);

				// Initialize form
				setTitle(taskResp.task.title);
				setStateId(taskResp.task.stateId);
				setStartDate(taskResp.task.startDate ? formatDateForInput(taskResp.task.startDate) : '');
				setDueDate(taskResp.task.dueDate ? formatDateForInput(taskResp.task.dueDate) : '');

				// Load description document
				if (taskResp.task.descriptionDocumentId) {
					const docResp = await getDocument({
						id: taskResp.task.descriptionDocumentId,
						includeContent: true,
					});
					setDocument(docResp.document);
				}

				// Load ritual definition for ritual_instance tasks
				if (taskResp.task.taskKind === 'ritual_instance' && taskResp.task.ritualDefinitionId) {
					try {
						const hydrated = await hydrateRitualTask(taskResp.task, {
							includeEvidenceSubmissions: false,
						});
						setRitualDefinition(hydrated?.ritualDefinition ?? null);
					} catch (err) {
						console.error('Failed to load ritual definition:', err);
					}
				}

				// Load file attachments
				if (taskResp.task.fileIds && taskResp.task.fileIds.length > 0) {
					try {
						const filesResp = await getFileMetadataBatch(taskResp.task.fileIds);
						setFileAttachments(filesResp.files || []);
					} catch (err) {
						console.error('Failed to load file attachments:', err);
						setFileAttachments([]);
					}
				} else {
					setFileAttachments([]);
				}

				// Always attempt to load subtasks (don't rely on childCount which may be stale)
				console.log('Task childCount (may be stale):', taskResp.task.childCount);
				try {
					const subtasksResp = await listTasks({
						projectId,
						parentTaskId: taskId,
					});
					console.log('Initial subtasks load:', subtasksResp.tasks.length, 'tasks');
					setSubtasks(subtasksResp.tasks);
					// Update childCount with actual count from server
					if (subtasksResp.tasks.length !== taskResp.task.childCount) {
						console.warn('childCount mismatch: task has', taskResp.task.childCount, 'but server returned', subtasksResp.tasks.length, 'subtasks');
						setTask((prev) => prev ? { ...prev, childCount: subtasksResp.tasks.length } : prev);
					}
				} catch (err) {
					console.error('Failed to load subtasks:', err);
					setSubtasks([]);
				}
			} catch (err) {
				console.error('Failed to load task:', err);
				setError('Failed to load task. It may not exist or you may not have permission.');
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, [isAuthenticated, authLoading, projectId, taskId]);

	useEffect(() => {
		if (!task || task.taskKind !== 'ritual_instance' || (!ritualSectionTarget && !ritualRequirementId)) {
			if (!task || task.taskKind !== 'ritual_instance' || !ritualSectionTarget) {
				return;
			}
		}

		if (!task || task.taskKind !== 'ritual_instance' || !ritualSectionTarget) {
			return;
		}

		let attempts = 0;
		let timeoutId: number | undefined;

		const scrollToTarget = () => {
			const requirementSelector = ritualRequirementId
				? `[data-testid="evidence-req-row-${ritualRequirementId}"]`
				: ritualSectionTarget === 'evidence'
					? '[data-highlighted-requirement="true"]'
					: null;
			const requirementElement = requirementSelector
				? window.document.querySelector<HTMLElement>(requirementSelector)
				: null;
			const sectionElement =
				requirementElement ??
				(ritualSectionTarget === 'review'
					? reviewSectionRef.current ?? evidenceSectionRef.current
					: ritualSectionTarget === 'evidence'
						? evidenceSectionRef.current
						: instructionsPanelRef.current);

			if (sectionElement) {
				sectionElement.style.scrollMarginTop = '96px';
				sectionElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
				return;
			}

			attempts += 1;
			if (attempts <= 6) {
				timeoutId = window.setTimeout(scrollToTarget, 180);
			}
		};

		timeoutId = window.setTimeout(scrollToTarget, 80);

		return () => {
			if (timeoutId) {
				window.clearTimeout(timeoutId);
			}
		};
	}, [task, ritualRequirementId, ritualSectionTarget]);

	// Load subscription state for follow/preference
	useEffect(() => {
		if (!isAuthenticated || authLoading || !taskId) return;

		getResourceSubscription({ resourceDomain: 'task', resourceId: taskId })
			.then((resp) => {
				setIsWatching(resp.subscribed);
				if (resp.subscribed) {
					setPreferenceLevel(resp.preferenceLevel);
				}
			})
			.catch((err) => console.error('Failed to load subscription:', err));
	}, [isAuthenticated, authLoading, taskId]);

	// Helper to format date for input[type="date"]
	function formatDateForInput(date: Date | string): string {
		const d = new Date(date);
		return d.toISOString().split('T')[0];
	}

	// Handle create subtask
	const handleCreateSubtask = useCallback(async () => {
		if (!task || !project) return;

		// Validation
		if (!subtaskTitle.trim()) {
			setSubtaskError('Subtask title is required');
			return;
		}

		if (!subtaskLevelId) {
			setSubtaskError('Subtask level is required');
			return;
		}

		setSubtaskError(null);
		setCreatingSubtask(true);

		try {
			await createTask({
				projectId: project.id,
				title: subtaskTitle.trim(),
				levelId: subtaskLevelId,
				parentTaskId: task.id,
				stateId: initialState?.id,
			});

			// Reload subtasks to get fresh data
			await loadSubtasks();

			// Update parent task's child count
			setTask((prev) => prev ? { ...prev, childCount: prev.childCount + 1 } : prev);

			// Reset form and close dialog
			setSubtaskTitle('');
			setSubtaskLevelId('');
			setIsCreateSubtaskDialogOpen(false);
		} catch (err) {
			console.error('Failed to create subtask:', err);
			setSubtaskError(err instanceof Error ? err.message : 'Failed to create subtask');
		} finally {
			setCreatingSubtask(false);
		}
	}, [task, project, subtaskTitle, subtaskLevelId, initialState, loadSubtasks]);

	// Handle open create subtask dialog
	const handleOpenCreateSubtaskDialog = useCallback(() => {
		// Pre-select first available level
		if (availableSubtaskLevels.length > 0) {
			setSubtaskLevelId(availableSubtaskLevels[0].id);
		}
		setSubtaskTitle('');
		setSubtaskError(null);
		setIsCreateSubtaskDialogOpen(true);
	}, [availableSubtaskLevels]);

	// Handle title update
	const handleTitleSave = useCallback(async () => {
		if (!task || title === task.title) {
			setIsEditingTitle(false);
			return;
		}

		setSaving(true);
		try {
			await updateTask({ taskId: task.id, title });
			setTask({ ...task, title });
			setIsEditingTitle(false);
		} catch (err) {
			console.error('Failed to update title:', err);
			setError('Failed to update title');
		} finally {
			setSaving(false);
		}
	}, [task, title]);

	// Handle state change
	const handleStateChange = useCallback(
		async (newStateId: string) => {
			if (!task || newStateId === stateId) return;

			setSaving(true);
			setError(null);
			try {
				await moveTask(task.id, newStateId);
				setStateId(newStateId);
				if (task) {
					setTask({ ...task, stateId: newStateId });
				}
			} catch (err) {
				setError('Failed to update status');
				console.error('Failed to update task state:', err);
			} finally {
				setSaving(false);
			}
		},
		[task, stateId]
	);

	// Handle date updates
	const handleDateUpdate = useCallback(
		async (field: 'startDate' | 'dueDate', value: string) => {
			if (!task) return;

			setSaving(true);
			try {
				const params: UpdateTaskParams = {
					taskId: task.id,
					[field]: value || undefined,
				};
				await updateTask(params);
				setTask({ ...task, [field]: value ? new Date(value) : undefined });
			} catch (err) {
				console.error(`Failed to update ${field}:`, err);
				setError(`Failed to update ${field}`);
			} finally {
				setSaving(false);
			}
		},
		[task]
	);

	// Handle watch/unwatch
	const handleToggleWatch = useCallback(async () => {
		if (!task) return;

		setSaving(true);
		try {
			if (isWatching) {
				await unwatchTask(task.id);
				setIsWatching(false);
				setPreferenceLevel(SubscriptionPreferenceLevel.ALL);
			} else {
				await watchTask(task.id);
				setIsWatching(true);
				setPreferenceLevel(SubscriptionPreferenceLevel.ALL);
			}
		} catch (err) {
			console.error('Failed to toggle watch:', err);
		} finally {
			setSaving(false);
		}
	}, [task, isWatching]);

	// Handle preference change
	const handlePreferenceChange = useCallback(async (level: number) => {
		if (!task) return;
		setPrefMenuAnchor(null);

		setSaving(true);
		try {
			const resp = await setResourceSubscriptionPreference({
				resourceDomain: 'task',
				resourceId: task.id,
				preferenceLevel: level,
			});
			setPreferenceLevel(resp.preferenceLevel);
		} catch (err) {
			console.error('Failed to update preference:', err);
		} finally {
			setSaving(false);
		}
	}, [task]);

	// Handle description save
	const handleDescriptionSaved = useCallback(async () => {
		if (task?.descriptionDocumentId) {
			try {
				const response = await getDocument({
					id: task.descriptionDocumentId,
					includeContent: true,
				});
				setDocument(response.document);
				setIsEditingDescription(false);
			} catch (err) {
				console.error('Failed to refresh document:', err);
			}
		}
	}, [task]);

	// Handle delete
	const handleDelete = useCallback(async () => {
		if (!task || !project) return;

		const confirmed = window.confirm(
			`Are you sure you want to delete "${task.identifier}: ${task.title}"?`
		);
		if (!confirmed) return;

		setSaving(true);
		try {
			await deleteTask(task.id);
			router.push(`/workspace/tasks/${project.id}`);
		} catch (err) {
			setError('Failed to delete task');
			console.error('Failed to delete task:', err);
		} finally {
			setSaving(false);
		}
	}, [task, project, router]);

	const handleCopyCanonicalLink = useCallback(async () => {
		if (!task) {
			return;
		}

		if (!currentMembership?.organizationSubdomain) {
			setCopyLinkMessage({ severity: 'error', text: 'Current organization subdomain is unavailable.' });
			return;
		}

		try {
			const response = await fetch(`${LINKING_API_BASE_URL}/api/linking/generate`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					target: {
						tenantKey: currentMembership.organizationSubdomain,
						resourceType: 'task',
						resourceId: task.id,
						focusIntent: ritualFocusIntent ?? undefined,
						requirementId: ritualRequirementId ?? undefined,
					},
				}),
			});

			const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string; error?: string } | null;
			if (!response.ok || !payload?.canonicalUrl) {
				throw new Error(payload?.error ?? 'Failed to generate a canonical link.');
			}

			await navigator.clipboard.writeText(payload.canonicalUrl);
			setCopyLinkMessage({ severity: 'success', text: 'Canonical link copied to clipboard.' });
		} catch (err) {
			console.error('Failed to copy canonical link:', err);
			setCopyLinkMessage({
				severity: 'error',
				text: err instanceof Error ? err.message : 'Failed to copy canonical link.',
			});
		}
	}, [currentMembership?.organizationSubdomain, ritualFocusIntent, ritualRequirementId, task]);

	// Handle file upload completion
	const handleFileUploadComplete = useCallback(
		async (fileMetadata: FileMetadata) => {
			// Add the new file to the attachments list
			setFileAttachments((prev) => [...prev, fileMetadata]);
			// Update task's fileIds if needed (the server already updated the task)
			if (task) {
				setTask({
					...task,
					fileIds: [...(task.fileIds || []), fileMetadata.id],
				});
			}
		},
		[task]
	);

	// Handle file upload error
	const handleFileUploadError = useCallback((errorMessage: string) => {
		setError(errorMessage);
	}, []);

	// Handle custom field value change
	const handleCustomFieldValueChanged = useCallback((fieldId: string, newValue: unknown) => {
		console.log('[TaskDetailPage] Custom field value changed:', { fieldId, newValue });
		// Update task's custom field values in local state
		setTask((prevTask) => {
			if (!prevTask) return prevTask;
			
			const existingFieldIndex = prevTask.customFieldValues.findIndex(
				(cfv) => cfv.fieldId === fieldId
			);
			
			const field = customFields.find((f) => f.id === fieldId);
			if (!field) {
				console.warn('[TaskDetailPage] Field not found in customFields:', fieldId);
				return prevTask;
			}
			
			const newFieldValue = {
				fieldId,
				fieldName: field.name,
				fieldType: field.fieldType,
				value: newValue,
			};
			
			console.log('[TaskDetailPage] Creating new field value:', newFieldValue);
			
			if (existingFieldIndex >= 0) {
				// Update existing field value
				const updatedValues = [...prevTask.customFieldValues];
				updatedValues[existingFieldIndex] = newFieldValue;
				console.log('[TaskDetailPage] Updated existing value at index', existingFieldIndex);
				return { ...prevTask, customFieldValues: updatedValues };
			} else {
				// Add new field value
				console.log('[TaskDetailPage] Adding new field value');
				return {
					...prevTask,
					customFieldValues: [...prevTask.customFieldValues, newFieldValue],
				};
			}
		});
	}, [customFields]);

	// Open assignee picker
	const handleOpenAssigneePicker = useCallback(
		async (event: React.MouseEvent<HTMLElement>) => {
			setAssigneeAnchor(event.currentTarget);
			setAssigneeSearchQuery('');
			if (projectMembers.length === 0 && projectId) {
				setAssigneeLoading(true);
				try {
					const resp = await listProjectMembers(projectId);
					setProjectMembers(resp.members);
				} catch (err) {
					console.error('Failed to load project members:', err);
				} finally {
					setAssigneeLoading(false);
				}
			}
		},
		[projectId, projectMembers.length]
	);

	// Toggle assignee on task
	const handleToggleAssignee = useCallback(
		async (member: ProjectMember) => {
			if (!task) return;
			const isAssigned = task.assignees.some((a) => a.employeeId === member.employeeId);
			try {
				if (isAssigned) {
					const resp = await unassignTask(task.id, member.employeeId);
					setTask(resp.task);
				} else {
					const resp = await assignTask(task.id, member.employeeId, 'assignee');
					setTask(resp.task);
				}
			} catch (err) {
				console.error('Failed to toggle assignee:', err);
				setError(isAssigned ? 'Failed to remove assignee' : 'Failed to add assignee');
			}
		},
		[task]
	);

	// Filtered project members for assignee search
	const filteredMembers = useMemo(() => {
		if (!assigneeSearchQuery) return projectMembers;
		const q = assigneeSearchQuery.toLowerCase();
		return projectMembers.filter(
			(m) => m.employeeId.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)
		);
	}, [projectMembers, assigneeSearchQuery]);

	// Render loading state
	if (authLoading || loading) {
		return (
			<Box
				sx={{
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
					minHeight: '60vh',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	// Render error state
	if (error && !task) {
		return (
			<Box sx={{ p: 4 }}>
				<Typography color="error">{error}</Typography>
				<Button onClick={() => router.back()} sx={{ mt: 2 }}>
					Go Back
				</Button>
			</Box>
		);
	}

	if (!task || !project) return null;

	const currentLevel = levels.find((l) => l.id === task.levelId);
	const currentTaskState = states.find((s) => s.id === task.stateId);
	const isAssignedToRitualInstance = task.assignees.some((assignee) => assignee.employeeId === user?.sub);
	const isDualRoleRitualUser = task.taskKind === 'ritual_instance' && isAssignedToRitualInstance && canReviewRitualEvidence;

	return (
		<Box sx={{ p: 3 }}>
			{/* Breadcrumbs */}
			<Breadcrumbs
				separator={<NavigateNextIcon fontSize="small" />}
				sx={{ mb: 3 }}
				data-testid="task-breadcrumbs"
			>
				<Link
					href="/workspace/tasks"
					underline="hover"
					sx={{ ...colors.text.secondary.style, cursor: 'pointer' }}
				>
					Projects
				</Link>
				<Link
					href={`/workspace/tasks/${project.id}`}
					underline="hover"
					sx={{ ...colors.text.secondary.style, cursor: 'pointer' }}
				>
					{project.name}
				</Link>
				<Typography sx={{ ...colors.text.primary.style }}>{task.identifier}</Typography>
			</Breadcrumbs>

			{error && (
				<Box sx={{ mb: 2, p: 1.5, borderRadius: 1, bgcolor: 'error.lighter' }}>
					<Typography color="error" variant="body2">
						{error}
					</Typography>
				</Box>
			)}

			{copyLinkMessage && (
				<Alert severity={copyLinkMessage.severity} sx={{ mb: 2 }} onClose={() => setCopyLinkMessage(null)}>
					{copyLinkMessage.text}
				</Alert>
			)}

			<Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
				{/* Main Content Area */}
				<Box sx={{ flex: { xs: '1 1 100%', md: '1 1 66%' } }}>
					<Paper sx={{ p: 3, ...colors.bg.paper.style }}>
						{/* Header */}
						<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
							<Typography
								variant="h6"
								sx={{ ...colors.text.secondary.style, fontWeight: 600 }}
								data-testid="task-identifier-header"
							>
								{task.identifier}
							</Typography>
							<Tooltip title="Copy canonical link" arrow>
								<IconButton
									onClick={handleCopyCanonicalLink}
									size="small"
									aria-label="Copy canonical task link"
									data-testid="task-copy-canonical-link"
								>
									<ContentCopyIcon fontSize="small" />
								</IconButton>
							</Tooltip>
							{currentLevel && (
								<Chip
									label={task.taskKind === 'ritual_instance' ? 'Ritual' : currentLevel.name}
									size="small"
									sx={{
										backgroundColor: currentLevel.color,
										color: '#fff',
										fontWeight: 500,
									}}
									data-testid="task-level-chip-header"
								/>
							)}
							{task.detachedFromRitual && (
								<Chip
									label="Detached from ritual"
									size="small"
									variant="outlined"
									color="warning"
									data-testid="task-detached-chip"
								/>
							)}
						</Box>

						{/* Title */}
						<Box sx={{ mb: 3 }}>
							{isEditingTitle ? (
								<Box sx={{ display: 'flex', gap: 1 }}>
									<TextField
										fullWidth
										value={title}
										onChange={(e) => setTitle(e.target.value)}
										autoFocus
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												handleTitleSave();
											} else if (e.key === 'Escape') {
												setTitle(task.title);
												setIsEditingTitle(false);
											}
										}}
										data-testid="task-title-edit-input"
									/>
									<Button onClick={handleTitleSave} disabled={saving} size="small">
										Save
									</Button>
									<Button
										onClick={() => {
											setTitle(task.title);
											setIsEditingTitle(false);
										}}
										disabled={saving}
										size="small"
									>
										Cancel
									</Button>
								</Box>
							) : (
								<Box
									sx={{
										display: 'flex',
										alignItems: 'center',
										gap: 1,
										cursor: 'pointer',
										'&:hover .edit-icon': {
											opacity: 1,
										},
									}}
									onClick={() => setIsEditingTitle(true)}
									data-testid="task-title-display"
								>
									<Typography variant="h5" sx={{ fontWeight: 500 }}>
										{task.title}
									</Typography>
									<IconButton className="edit-icon" size="small" sx={{ opacity: 0, transition: 'opacity 0.2s' }}>
										<EditIcon fontSize="small" />
									</IconButton>
								</Box>
							)}
						</Box>

						{/* Description */}
						<Box sx={{ mb: 3 }}>
							<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
								<Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
									Description
								</Typography>
								{document && !isEditingDescription && (
									<Button
										size="small"
										onClick={() => setIsEditingDescription(true)}
										data-testid="task-page-edit-description-btn"
									>
										Edit
									</Button>
								)}
							</Box>
							{document ? (
								<Box
									sx={{
										p: 2,
										border: 1,
										borderRadius: 1,
										...colors.border.default.style,
										...colors.bg.default.style,
									}}
									data-testid="task-page-description-editor"
								>
									<DocumentEditor
										document={document}
										isEditing={isEditingDescription}
										onSaved={handleDescriptionSaved}
									/>
								</Box>
							) : task?.taskKind === 'ritual_instance' ? (
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
									<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }}>
										Work notes not yet initialized.
									</Typography>
									<Button
										size="small"
										variant="outlined"
										disabled={provisioningResources}
										onClick={retryProvisionResources}
										data-testid="task-page-init-description-btn"
									>
										{provisioningResources ? 'Initializing…' : 'Initialize'}
									</Button>
								</Box>
							) : (
								<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }}>
									No description available
								</Typography>
							)}
						</Box>

						{/* Placeholder sections for future implementation */}
						<Divider sx={{ my: 3 }} />
						
						{/* Attachments Section */}
						<Box sx={{ mb: 3 }}>
							<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
								<Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
									Attachments ({fileAttachments.length})
								</Typography>
							</Box>
							
							{/* Upload Component */}
							<Box sx={{ mb: 2 }}>
								<TaskFileUpload
									taskId={task.id}
									onUploadComplete={handleFileUploadComplete}
									onUploadError={handleFileUploadError}
								/>
							</Box>
							
							{fileAttachments.length > 0 && (
								<Box
									sx={{
										display: 'grid',
										gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
										gap: 1.5,
									}}
									data-testid="task-page-attachments-list"
								>
									{fileAttachments.map((file) => (
										<FileAttachment
											key={file.id}
											fileId={file.id}
											filename={file.originalFilename}
											validationStatus={file.validationStatus}
											validationMessage={file.validationMessage}
										/>
									))}
								</Box>
							)}
						</Box>

						<Divider sx={{ my: 3 }} />

						{/* Instructions Panel - SOP from ritual definition, shown for ritual_instance tasks */}
						{task.taskKind === 'ritual_instance' && ritualDefinition && (
							<Box
								ref={instructionsPanelRef}
								sx={{
									p: 2,
									borderRadius: 1,
									...colors.bg.active.style,
									border: ritualSectionTarget === 'evidence' && !ritualRequirementId ? '1px solid' : undefined,
									borderColor: ritualSectionTarget === 'evidence' && !ritualRequirementId ? 'primary.main' : undefined,
									mb: 3,
								}}
								data-testid="ritual-instructions-panel"
							>
								<Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
									What to do
								</Typography>
								<Typography variant="body2" sx={{ ...colors.text.secondary.style, mb: ritualDefinition.description ? 1 : 0 }}>
									Live ritual instance: {ritualDefinition.name}
								</Typography>
								{ritualDefinition.description && (
									<Typography
										variant="body2"
										sx={{
											...colors.text.primary.style,
											whiteSpace: 'pre-wrap',
											mt: 0.5,
										}}
										data-testid="ritual-instructions-description"
									>
										{ritualDefinition.description}
									</Typography>
								)}
							</Box>
						)}

						{task.taskKind === 'ritual_instance' && ritualEntrySummary && (
							<Alert severity={ritualEntrySummary.severity} sx={{ mb: 2 }} data-testid="ritual-worker-flow-summary">
								{ritualEntrySummary.message}
							</Alert>
						)}

						{task.taskKind === 'ritual_instance' && (task.skipReason || task.detachedFromRitual || isDualRoleRitualUser) && (
							<Box sx={{ mb: 2 }}>
								{isDualRoleRitualUser && (
									<Alert severity="info" sx={{ mb: task.skipReason || task.detachedFromRitual ? 1.5 : 0 }} data-testid="ritual-dual-role-alert">
										This live ritual instance keeps worker proof and reviewer decisions in the same checklist because you hold both roles here.
									</Alert>
								)}
								{task.skipReason && (
									<Alert severity="warning" sx={{ mb: task.detachedFromRitual ? 1.5 : 0 }} data-testid="ritual-skip-context-alert">
										This run was skipped for this instance: {task.skipReason}. Template edits do not rewrite this recorded outcome.
									</Alert>
								)}
								{task.detachedFromRitual && (
									<Alert severity="info" data-testid="ritual-detached-context-alert">
										This run is detached from the template schedule. Future template changes stay separate from this instance history.
									</Alert>
								)}
							</Box>
						)}

						{/* Evidence Section - only for ritual_instance tasks */}
								{task.taskKind === 'ritual_instance' && task.ritualDefinitionId && (() => {
									const canSubmitEvidence = isAssignedToRitualInstance && !(currentTaskState?.isClosed ?? false);
									return (
										<>
											{canReviewRitualEvidence && ritualFocusIntent === 'review_pending' && (
												<Alert ref={reviewSectionRef} severity="warning" sx={{ mb: 2 }}>
													Open the highlighted proof below to approve or reject it inline without leaving this task.
												</Alert>
											)}
											<Box
												ref={evidenceSectionRef}
												data-testid="ritual-evidence-section"
												sx={{
													borderRadius: 1,
													outline: ritualSectionTarget === 'evidence' ? '2px solid' : 'none',
													outlineColor: ritualSectionTarget === 'evidence' ? 'primary.main' : undefined,
												}}
											>
												<EvidenceChecklist
													ritualDefinitionId={task.ritualDefinitionId}
													taskId={taskId}
													canSubmit={canSubmitEvidence}
														canReview={canReviewRitualEvidence}
													isDualRole={isDualRoleRitualUser}
													autoOpenRequirementId={ritualRequirementId}
													highlightedRequirementId={ritualRequirementId}
													autoFocusFirstActionable={ritualFocusIntent === 'view_instance' || ritualFocusIntent === 'submit_requirement'}
												/>
											</Box>
											<Divider sx={{ my: 3 }} />
										</>
									);
								})()}
						{/* Subtasks Section - hidden when empty */}
						{(subtasks.length > 0 || availableSubtaskLevels.length > 0) && (
						<Box sx={{ mb: 3 }}>
							<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
								<Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
									Subtasks ({subtasks.length})
								</Typography>
								{availableSubtaskLevels.length > 0 && (
									<Button
										size="small"
										startIcon={<AddIcon />}
										onClick={handleOpenCreateSubtaskDialog}
										data-testid="task-page-add-subtask-btn"
									>
										Add Subtask
									</Button>
								)}
							</Box>
							
							{subtaskLoading ? (
								<Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
									<CircularProgress size={24} />
								</Box>
							) : subtasks.length > 0 ? (
								<List disablePadding data-testid="task-page-subtasks-list">
									{subtasks.map((subtask) => {
										const subtaskLevel = levels.find((l) => l.id === subtask.levelId);
										const subtaskState = states.find((s) => s.id === subtask.stateId);
										return (
											<ListItem
												key={subtask.id}
												disablePadding
												sx={{
													border: 1,
													borderRadius: 1,
													mb: 1,
													...colors.border.default.style,
												}}
											>
												<ListItemButton
													component={NextLink}
													href={`/workspace/tasks/${projectId}/tasks/${subtask.id}`}
													sx={{ py: 1.5 }}
													data-testid={`subtask-item-${subtask.id}`}
												>
													<ListItemIcon sx={{ minWidth: 36 }}>
														<SubdirectoryArrowRightIcon 
															fontSize="small" 
															sx={{ ...colors.text.secondary.style }} 
														/>
													</ListItemIcon>
													<ListItemText
														primaryTypographyProps={{ component: 'span' }}
														secondaryTypographyProps={{ component: 'span' }}
														primary={
															<Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
																<Typography
																	component="span"
																	variant="body2"
																	sx={{ fontWeight: 500, ...colors.text.secondary.style }}
																>
																	{subtask.identifier}
																</Typography>
																<Typography component="span" variant="body2" sx={{ fontWeight: 500 }}>
																	{subtask.title}
																</Typography>
															</Box>
														}
														secondary={
															<Box component="span" sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
																{subtaskLevel && (
																	<Chip
																		label={subtaskLevel.name}
																		size="small"
																		sx={{
																			height: 20,
																			fontSize: '0.7rem',
																			backgroundColor: subtaskLevel.color,
																			color: '#fff',
																		}}
																	/>
																)}
																{subtaskState && (
																	<Chip
																		label={subtaskState.name}
																		size="small"
																		sx={{
																			height: 20,
																			fontSize: '0.7rem',
																			backgroundColor: subtaskState.color,
																			color: '#fff',
																		}}
																	/>
																)}
															</Box>
															}
														/>
													{subtask.childCount > 0 && (
														<Chip
															label={`${subtask.childCount} subtask${subtask.childCount > 1 ? 's' : ''}`}
															size="small"
															sx={{ height: 20, fontSize: '0.7rem' }}
														/>
													)}
												</ListItemButton>
											</ListItem>
										);
									})}
								</List>
							) : (
								<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }}>
									No subtasks yet. Click &quot;Add Subtask&quot; to create one.
								</Typography>
							)}
						</Box>
						)}

						<Divider sx={{ my: 3 }} />

						{/* Comments Section - Integrated Chat */}
						<Box sx={{ mb: 3 }}>
							<Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600, mb: 2 }}>
								Comments
							</Typography>
							{task.channelId ? (
								<Box
									sx={{
										border: 1,
										borderRadius: 1,
										overflow: 'hidden',
										...colors.border.default.style,
										height: '500px', // Fixed height for chat area
										display: 'flex',
										flexDirection: 'column',
									}}
									data-testid="task-comments-section"
								>
									<MessageList
										channelId={task.channelId}
										highlightMessageId={null}
										onOpenThread={() => {}} // Thread functionality not yet implemented
										typingUsers={[]} // Typing indicators can be added later with SSE
									/>
								</Box>
							) : task?.taskKind === 'ritual_instance' ? (
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
									<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }}>
										Comments not yet initialized.
									</Typography>
									<Button
										size="small"
										variant="outlined"
										disabled={provisioningResources}
										onClick={retryProvisionResources}
										data-testid="task-page-init-comments-btn"
									>
										{provisioningResources ? 'Initializing…' : 'Initialize'}
									</Button>
								</Box>
							) : (
								<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }}>
									No chat channel available for this task
								</Typography>
							)}
						</Box>
					</Paper>
				</Box>

				{/* Sidebar */}
				<Box sx={{ flex: { xs: '1 1 100%', md: '1 1 33%' } }}>
					<Paper sx={{ p: 2, ...colors.bg.paper.style, position: 'sticky', top: 80 }}>
						{/* Actions */}
						<Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
							<Button
								fullWidth
								variant={isWatching ? 'contained' : 'outlined'}
								size="small"
								startIcon={isWatching ? <VisibilityIcon /> : <VisibilityOffIcon />}
								onClick={handleToggleWatch}
								disabled={saving}
								data-testid="task-page-watch-btn"
							>
								{isWatching ? 'Following' : 'Follow'}
							</Button>
							{isWatching && (
								<>
									<Tooltip title="Notification preference">
										<IconButton
											size="small"
											onClick={(e) => setPrefMenuAnchor(e.currentTarget)}
											disabled={saving}
											data-testid="task-page-pref-btn"
										>
											{preferenceLevel === SubscriptionPreferenceLevel.MUTED ? (
												<NotificationsOffIcon fontSize="small" />
											) : preferenceLevel === SubscriptionPreferenceLevel.MENTIONS ? (
												<AlternateEmailIcon fontSize="small" />
											) : (
												<NotificationsIcon fontSize="small" />
											)}
										</IconButton>
									</Tooltip>
									<Menu
										anchorEl={prefMenuAnchor}
										open={Boolean(prefMenuAnchor)}
										onClose={() => setPrefMenuAnchor(null)}
									>
										<MenuItem
											selected={preferenceLevel === SubscriptionPreferenceLevel.ALL}
											onClick={() => handlePreferenceChange(SubscriptionPreferenceLevel.ALL)}
										>
											<ListItemIcon><NotificationsIcon fontSize="small" /></ListItemIcon>
											<ListItemText primary="All activity" secondary="Get notified for everything" />
										</MenuItem>
										<MenuItem
											selected={preferenceLevel === SubscriptionPreferenceLevel.MENTIONS}
											onClick={() => handlePreferenceChange(SubscriptionPreferenceLevel.MENTIONS)}
										>
											<ListItemIcon><AlternateEmailIcon fontSize="small" /></ListItemIcon>
											<ListItemText primary="Mentions only" secondary="Only when you're @mentioned" />
										</MenuItem>
										<MenuItem
											selected={preferenceLevel === SubscriptionPreferenceLevel.MUTED}
											onClick={() => handlePreferenceChange(SubscriptionPreferenceLevel.MUTED)}
										>
											<ListItemIcon><NotificationsOffIcon fontSize="small" /></ListItemIcon>
											<ListItemText primary="Muted" secondary="No notifications" />
										</MenuItem>
									</Menu>
								</>
							)}
							<Button
								fullWidth
								variant="outlined"
								color="error"
								size="small"
								startIcon={<DeleteOutlineIcon />}
								onClick={handleDelete}
								disabled={saving}
								data-testid="task-page-delete-btn"
							>
								Delete
							</Button>
						</Box>

						<Divider sx={{ my: 2 }} />

						{/* Status */}
						<Box sx={{ mb: 3 }}>
							<Typography variant="subtitle2" sx={{ mb: 1, fontSize: '0.875rem', fontWeight: 600 }}>
								Status
							</Typography>
							{task.taskKind === 'ritual_instance' ? (
								/* Ritual tasks: display status as read-only (automated via evidence/approval) */
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
									{(() => {
										const state = states.find((s) => s.id === stateId);
										return state ? (
											<>
												<Box
													sx={{
														width: 10,
														height: 10,
														borderRadius: '50%',
														backgroundColor: state.color,
													}}
												/>
												<Typography variant="body2" data-testid="task-page-status-display">{state.name}</Typography>
											</>
										) : null;
									})()}
									<Typography variant="caption" sx={{ ...colors.text.secondary.style, ml: 0.5 }}>
										(automated)
									</Typography>
								</Box>
							) : (
								<FormControl fullWidth size="small">
									<Select
										value={stateId}
										onChange={(e) => handleStateChange(e.target.value)}
										disabled={saving}
										displayEmpty
										renderValue={(selected) => {
											const state = states.find((s) => s.id === selected);
											return state ? (
												<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
													<Box
														sx={{
															width: 10,
															height: 10,
															borderRadius: '50%',
															backgroundColor: state.color,
														}}
													/>
													<Typography variant="body2">{state.name}</Typography>
												</Box>
											) : null;
										}}
										data-testid="task-page-status-select"
									>
										{states.map((state) => (
											<MenuItem key={state.id} value={state.id}>
												<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
													<Box
														sx={{
															width: 10,
															height: 10,
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
						</Box>

						{/* Dates */}
						<Box sx={{ mb: 3 }}>
							<Typography variant="subtitle2" sx={{ mb: 1, fontSize: '0.875rem', fontWeight: 600 }}>
								Start Date
							</Typography>
							<TextField
								fullWidth
								type="date"
								size="small"
								value={startDate}
								onChange={(e) => {
									setStartDate(e.target.value);
									handleDateUpdate('startDate', e.target.value);
								}}
								InputLabelProps={{ shrink: true }}
								data-testid="task-page-start-date-input"
							/>
						</Box>

						<Box sx={{ mb: 3 }}>
							<Typography variant="subtitle2" sx={{ mb: 1, fontSize: '0.875rem', fontWeight: 600 }}>
								Due Date
							</Typography>
							<TextField
								fullWidth
								type="date"
								size="small"
								value={dueDate}
								onChange={(e) => {
									setDueDate(e.target.value);
									handleDateUpdate('dueDate', e.target.value);
								}}
								InputLabelProps={{ shrink: true }}
								data-testid="task-page-due-date-input"
							/>
						</Box>

						<Divider sx={{ my: 2 }} />

						{/* Assignees */}
						<Box sx={{ mb: 3 }}>
							<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
								<Typography variant="subtitle2" sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
									Assignees
								</Typography>
								<Tooltip title="Add assignee">
									<IconButton
										size="small"
										onClick={handleOpenAssigneePicker}
										data-testid="task-page-add-assignee-btn"
									>
										<PersonAddIcon fontSize="small" />
									</IconButton>
								</Tooltip>
								<Popover
									open={Boolean(assigneeAnchor)}
									anchorEl={assigneeAnchor}
									onClose={() => setAssigneeAnchor(null)}
									anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
									transformOrigin={{ vertical: 'top', horizontal: 'left' }}
								>
									<Box sx={{ p: 1.5, width: 280 }}>
										<TextField
											fullWidth
											size="small"
											placeholder="Search members..."
											value={assigneeSearchQuery}
											onChange={(e) => setAssigneeSearchQuery(e.target.value)}
											autoFocus
											data-testid="assignee-search-input"
											sx={{ mb: 1 }}
										/>
										{assigneeLoading ? (
											<Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
												<CircularProgress size={20} />
											</Box>
										) : filteredMembers.length === 0 ? (
											<Typography variant="body2" sx={{ ...colors.text.secondary.style, py: 1, textAlign: 'center' }}>
												No members found
											</Typography>
										) : (
											<List dense disablePadding sx={{ maxHeight: 240, overflow: 'auto' }}>
												{filteredMembers.map((member) => {
													const isAssigned = task?.assignees.some((a) => a.employeeId === member.employeeId);
													return (
														<ListItemButton
															key={member.employeeId}
															onClick={() => handleToggleAssignee(member)}
															data-testid={`assignee-option-${member.employeeId}`}
															sx={{ borderRadius: 1, py: 0.5 }}
														>
															<UserCard
																employeeId={member.employeeId}
																variant="compact"
																avatarSize="xs"
																sx={{ flex: 1 }}
															/>
															<Typography variant="caption" color="text.secondary" sx={{ mx: 1 }}>
																{member.role}
															</Typography>
															{isAssigned && (
																<CheckIcon fontSize="small" color="primary" />
															)}
														</ListItemButton>
													);
												})}
											</List>
										)}
									</Box>
								</Popover>
							</Box>
							{task.assignees.length > 0 ? (
								<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
									{task.assignees.map((assignee) => (
										<Box key={assignee.employeeId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
											<UserCard
												employeeId={assignee.employeeId}
												variant="compact"
												avatarSize="sm"
												showPresence
												sx={{ flex: 1 }}
											/>
											<IconButton
												size="small"
												onClick={() => handleToggleAssignee({ employeeId: assignee.employeeId } as ProjectMember)}
												data-testid={`remove-assignee-${assignee.employeeId}`}
											>
												<CloseIcon fontSize="small" sx={{ fontSize: 14 }} />
											</IconButton>
										</Box>
									))}
								</Box>
							) : (
								<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
									No assignees
								</Typography>
							)}
						</Box>

						<Divider sx={{ my: 2 }} />

						{/* Custom Fields */}
						{customFields.length > 0 && (
							<>
								<Box sx={{ mb: 3 }}>
									<Typography variant="subtitle2" sx={{ fontSize: '0.875rem', fontWeight: 600, mb: 2 }}>
										Custom Fields
									</Typography>
									{customFields.map((field) => {
										const currentValue = task.customFieldValues.find(
											(cfv) => cfv.fieldId === field.id
										);
										return (
											<CustomFieldEditor
												key={field.id}
												taskId={task.id}
												field={field}
												currentValue={currentValue}
												onValueChanged={handleCustomFieldValueChanged}
												disabled={saving}
											/>
										);
									})}
								</Box>
								<Divider sx={{ my: 2 }} />
							</>
						)}

						{/* Ritual Definition Section - only for ritual_instance tasks */}
						{task.taskKind === 'ritual_instance' && ritualDefinition && (
							<>
								<Box ref={definitionSectionRef} data-testid="ritual-definition-section-wrapper">
									<RitualDefinitionSection
										definition={ritualDefinition}
										detachedFromRitual={task.detachedFromRitual ?? false}
												canEdit={canManageRitualDefinition}
										onUpdated={(updated) => setRitualDefinition(updated)}
									/>
								</Box>
								<Box sx={{ mb: 2 }} />
							</>
						)}

						{/* Metadata */}
						<Box>
							<Typography variant="caption" sx={{ ...colors.text.secondary.style, display: 'block', mb: 0.5 }}>
								REPORTER
							</Typography>
							<UserCard
								employeeId={task.reporterEmployeeId}
								variant="compact"
								avatarSize="sm"
								sx={{ mb: 2 }}
							/>

							<Typography variant="caption" sx={{ ...colors.text.secondary.style, display: 'block', mb: 0.5 }}>
								CREATED
							</Typography>
							<Typography variant="body2" sx={{ mb: 2 }}>
								{task.updatedAt ? new Date(task.updatedAt).toLocaleDateString() : 'N/A'}
							</Typography>

							<Typography variant="caption" sx={{ ...colors.text.secondary.style, display: 'block', mb: 0.5 }}>
								UPDATED
							</Typography>
							<Typography variant="body2">
								{task.updatedAt ? new Date(task.updatedAt).toLocaleString() : 'N/A'}
							</Typography>
						</Box>
					</Paper>
				</Box>
			</Box>

			{/* Create Subtask Dialog */}
			<Dialog
				open={isCreateSubtaskDialogOpen}
				onClose={() => !creatingSubtask && setIsCreateSubtaskDialogOpen(false)}
				maxWidth="sm"
				fullWidth
				data-testid="create-subtask-dialog"
			>
				<DialogTitle>Create Subtask</DialogTitle>
				<DialogContent>
					{subtaskError && (
						<Alert severity="error" sx={{ mb: 2 }}>
							{subtaskError}
						</Alert>
					)}

					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
						{/* Parent task info */}
						<Alert severity="info" sx={{ fontSize: '0.875rem' }}>
							This subtask will be created under: <strong>{task.identifier} - {task.title}</strong>
						</Alert>

						{/* Title (required) */}
						<TextField
							label="Title"
							value={subtaskTitle}
							onChange={(e) => setSubtaskTitle(e.target.value)}
							placeholder="Enter subtask title..."
							required
							fullWidth
							autoFocus
							disabled={creatingSubtask}
							data-testid="subtask-title-input"
						/>

						{/* Level (required) */}
						<FormControl fullWidth required disabled={creatingSubtask}>
							<InputLabel>Level</InputLabel>
							<Select
								value={subtaskLevelId}
								onChange={(e) => setSubtaskLevelId(e.target.value)}
								label="Level"
								data-testid="subtask-level-select"
							>
								{availableSubtaskLevels.map((level) => (
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
											<Typography variant="caption" sx={{ ...colors.text.secondary.style }}>
												(Depth {level.depth})
											</Typography>
										</Box>
									</MenuItem>
								))}
							</Select>
						</FormControl>

						<Typography variant="caption" color="text.secondary">
							* Required fields
						</Typography>
					</Box>
				</DialogContent>
				<DialogActions>
					<Button
						onClick={() => setIsCreateSubtaskDialogOpen(false)}
						disabled={creatingSubtask}
						data-testid="subtask-cancel-btn"
					>
						Cancel
					</Button>
					<Button
						onClick={handleCreateSubtask}
						variant="contained"
						disabled={creatingSubtask}
						data-testid="subtask-create-btn"
					>
						{creatingSubtask ? 'Creating...' : 'Create Subtask'}
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
}
