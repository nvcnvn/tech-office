/**
 * TaskDetailSidePanel Component
 * Compact side panel for quick task viewing and status changes
 * Feature: 017-realtime-task-collaboration-system (T149 - UX Optimization)
 *
 * Features:
 * - Compact horizontal layout inspired by TaskDetailDialog
 * - Status + Assignees in single row (60%/40% split)
 * - Side-by-side date pickers
 * - Minimal vertical spacing for better information density
 * - Quick actions: status change, date update, view full page
 * - Theme system colors (no hardcoded colors)
 * 
 * Design Goals:
 * - Efficient use of horizontal space in 480px width drawer
 * - Reduce vertical scrolling by combining related fields
 * - Quick glance at task details without opening full page
 * - Seamless transition to full task page for detailed editing
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
	Drawer,
	Box,
	Typography,
	IconButton,
	Select,
	MenuItem,
	FormControl,
	Chip,
	Divider,
	CircularProgress,
	Tooltip,
	Button,
	TextField,
} from '@mui/material';
import { UserCard } from '@/components/user';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useRouter } from 'next/navigation';
import { useThemeColors } from '@/theme/useThemeColors';
import { useProjectContext } from '../ProjectContext';
import {
	moveTask,
	updateTask,
	getDocument,
	listMessages,
	getFileMetadataBatch,
	type Task,
	type UpdateTaskParams,
	type Document,
	type FileMetadata,
} from 'apis';
import FileAttachment from '@/app/workspace/chat/components/FileAttachment';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DocumentEditor from '@/app/workspace/docs/components/DocumentEditor';

// =============================================================================
// Types
// =============================================================================

interface TaskDetailSidePanelProps {
	task: Task | null;
	open: boolean;
	onClose: () => void;
	onTaskUpdated?: () => void;
	projectId: string;
}

// =============================================================================
// Ritual state → next-action hint (keyed by StateCategory)
// =============================================================================
const RITUAL_STATE_HINTS: Record<string, string> = {
	scheduled:   'Not open yet — check back on the scheduled date',
	todo:        'Ready to start — open the task and submit evidence',
	in_progress: 'Submit all required evidence to complete',
	submitted:   'Awaiting reviewer approval',
	verified:    'Completed and verified',
	overdue:     'Past deadline — submit evidence immediately',
	missed:      'Deadline passed without completion',
	skipped:     'This instance was skipped',
};

// =============================================================================
// Main TaskDetailSidePanel Component
// =============================================================================

export function TaskDetailSidePanel({
	task,
	open,
	onClose,
	onTaskUpdated,
	projectId,
}: TaskDetailSidePanelProps) {
	const colors = useThemeColors();
	const router = useRouter();
	const { states, levels, refreshTasks } = useProjectContext();

	// Form state
	const [stateId, setStateId] = useState('');
	const [startDate, setStartDate] = useState('');
	const [dueDate, setDueDate] = useState('');

	// Description state
	const [document, setDocument] = useState<Document | null>(null);
	const [loadingDocument, setLoadingDocument] = useState(false);
	const [isEditingDescription, setIsEditingDescription] = useState(false);

	// Comments state
	const [commentCount, setCommentCount] = useState(0);
	const [loadingComments, setLoadingComments] = useState(false);

	// Attachments state
	const [fileAttachments, setFileAttachments] = useState<FileMetadata[]>([]);
	const [loadingAttachments, setLoadingAttachments] = useState(false);

	// UI state
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Reset form when task changes
	useEffect(() => {
		if (task) {
			setStateId(task.stateId);
			setStartDate(task.startDate ? formatDateForInput(task.startDate) : '');
			setDueDate(task.dueDate ? formatDateForInput(task.dueDate) : '');
			setError(null);
			setIsEditingDescription(false);

			// Fetch description document if available
			if (task.descriptionDocumentId) {
				setLoadingDocument(true);
				getDocument({ id: task.descriptionDocumentId, includeContent: true })
					.then((response) => {
						setDocument(response.document);
					})
					.catch((err) => {
						console.error('Failed to load task description:', err);
						setDocument(null);
					})
					.finally(() => {
						setLoadingDocument(false);
					});
			} else {
				setDocument(null);
			}

			// Fetch comments count from channel if available
			if (task.channelId) {
				setLoadingComments(true);
				listMessages({ channelId: task.channelId, pageSize: 1 })
					.then((response) => {
						// The response will have metadata about total count if available
						// For now, we could fetch all messages or show "View comments" link
						setCommentCount(response.messages?.length || 0);
					})
					.catch((err) => {
						console.error('Failed to load comments count:', err);
						setCommentCount(0);
					})
					.finally(() => {
						setLoadingComments(false);
					});
			} else {
				setCommentCount(0);
			}

			// Fetch file attachments if available
			if (task.fileIds && task.fileIds.length > 0) {
				setLoadingAttachments(true);
				getFileMetadataBatch(task.fileIds)
					.then((response) => {
						setFileAttachments(response.files || []);
					})
					.catch((err) => {
						console.error('Failed to load file attachments:', err);
						setFileAttachments([]);
					})
					.finally(() => {
						setLoadingAttachments(false);
					});
			} else {
				setFileAttachments([]);
			}
		}
	}, [task]);

	// Helper to format date for input[type="date"]
	function formatDateForInput(date: Date | string): string {
		const d = new Date(date);
		return d.toISOString().split('T')[0];
	}

	// Handle state change
	const handleStateChange = useCallback(
		async (newStateId: string) => {
			if (!task || newStateId === stateId) return;

			setSaving(true);
			setError(null);
			try {
				await moveTask(task.id, newStateId);
				setStateId(newStateId);
				await refreshTasks();
				onTaskUpdated?.();
			} catch (err) {
				setError('Failed to update status');
				console.error('Failed to update task state:', err);
			} finally {
				setSaving(false);
			}
		},
		[task, stateId, refreshTasks, onTaskUpdated]
	);

	// Handle date changes
	const handleStartDateChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!task) return;
		const newDate = e.target.value;
		setStartDate(newDate);
		
		setSaving(true);
		try {
			const params: UpdateTaskParams = {
				taskId: task.id,
				startDate: newDate || undefined,
			};
			await updateTask(params);
			await refreshTasks();
			onTaskUpdated?.();
		} catch (err) {
			setError('Failed to update start date');
			console.error('Failed to update start date:', err);
		} finally {
			setSaving(false);
		}
	}, [task, refreshTasks, onTaskUpdated]);

	const handleDueDateChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!task) return;
		const newDate = e.target.value;
		setDueDate(newDate);
		
		setSaving(true);
		try {
			const params: UpdateTaskParams = {
				taskId: task.id,
				dueDate: newDate || undefined,
			};
			await updateTask(params);
			await refreshTasks();
			onTaskUpdated?.();
		} catch (err) {
			setError('Failed to update due date');
			console.error('Failed to update due date:', err);
		} finally {
			setSaving(false);
		}
	}, [task, refreshTasks, onTaskUpdated]);

	// Navigate to full task page (redirect current tab)
	const handleOpenFullPage = useCallback(() => {
		if (!task) return;
		router.push(`/workspace/tasks/${projectId}/tasks/${task.id}`);
		onClose();
	}, [task, projectId, router, onClose]);

	// Open full task page in a new browser tab
	const handleOpenInNewTab = useCallback(() => {
		if (!task) return;
		window.open(`/workspace/tasks/${projectId}/tasks/${task.id}`, '_blank', 'noopener,noreferrer');
	}, [task, projectId]);

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

	if (!task) return null;

	const currentLevel = levels.find((l) => l.id === task.levelId);
	const currentState = states.find((s) => s.id === stateId);

	return (
		<Drawer
			anchor="right"
			open={open}
			onClose={onClose}
			PaperProps={{
				sx: {
					width: { xs: '100%', sm: 640 },
					...colors.bg.paper.style,
				},
			}}
			data-testid="task-detail-side-panel"
		>
			{/* Header */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					px: 3,
					py: 2,
					borderBottom: 1,
					...colors.border.default.style,
				}}
			>
				{/* Left: Identifier, Level */}
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
					<Typography
						variant="subtitle2"
						sx={{ ...colors.text.secondary.style, fontWeight: 600, fontSize: '0.875rem' }}
						data-testid="task-identifier"
					>
						{task.identifier}
					</Typography>
					{currentLevel && (
						<Chip
							label={currentLevel.name}
							size="small"
							sx={{
								backgroundColor: currentLevel.color,
								color: '#fff',
								height: 22,
								fontSize: '0.7rem',
								fontWeight: 500,
							}}
							data-testid="task-level-chip"
						/>
					)}
				</Box>

				{/* Right: Open full page, Close */}
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
					<Tooltip title="Open in new tab">
						<IconButton
							size="small"
							onClick={handleOpenInNewTab}
							data-testid="task-open-new-tab-btn"
						>
							<OpenInNewIcon fontSize="small" />
						</IconButton>
					</Tooltip>
					<IconButton size="small" onClick={onClose} data-testid="task-close-btn">
						<CloseIcon fontSize="small" />
					</IconButton>
				</Box>
			</Box>

			{/* Content */}
			<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', p: 2 }}>
				{error && (
					<Box sx={{ mb: 2, p: 1.5, borderRadius: 1, bgcolor: 'error.lighter' }}>
						<Typography color="error" variant="body2">
							{error}
						</Typography>
					</Box>
				)}

				{/* Title (read-only) */}
				<Box sx={{ mb: 2 }}>
					<Typography
						variant="h6"
						sx={{ ...colors.text.primary.style, fontWeight: 600, fontSize: '1rem' }}
					>
						{task.title}
					</Typography>
				</Box>

				{/* Compact Status + Assignees Row */}
				<Box sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'flex-start' }}>
					{/* Status - 60% width */}
					{task.taskKind === 'ritual_instance' ? (
						/* Ritual tasks: read-only status + next-action hint */
						<Box sx={{ flex: '0 0 60%' }}>
							{(() => {
								const state = states.find((s) => s.id === stateId);
								const hint = RITUAL_STATE_HINTS[state?.category ?? ''] ?? '';
								return (
									<>
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
											<Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 500 }} data-testid="task-status-display">
												{state?.name ?? '—'}
											</Typography>
										</Box>
										{hint && (
											<Typography
												variant="caption"
												sx={{ ...colors.text.secondary.style, fontSize: '0.7rem', mt: 0.25, display: 'block', lineHeight: 1.3 }}
											>
												{hint}
											</Typography>
										)}
									</>
								);
							})()}
						</Box>
					) : (
					<FormControl variant="outlined" size="small" sx={{ flex: '0 0 60%' }}>
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
												width: 8,
												height: 8,
												borderRadius: '50%',
												backgroundColor: state.color,
											}}
										/>
										<Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{state.name}</Typography>
									</Box>
								) : null;
							}}
							data-testid="task-status-select"
						>
							{states.map((state) => (
								<MenuItem key={state.id} value={state.id}>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										<Box
											sx={{
												width: 8,
												height: 8,
												borderRadius: '50%',
												backgroundColor: state.color,
											}}
										/>
										<Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{state.name}</Typography>
									</Box>
								</MenuItem>
							))}
						</Select>
					</FormControl>
					)}

					{/* Assignees + Add button - 40% width */}
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: '0 0 40%' }}>
						{task.assignees.length > 0 ? (
							<Box
								data-testid="task-assignees-avatars"
								sx={{ display: 'flex', alignItems: 'center' }}
							>
								{task.assignees.slice(0, 3).map((assignee, i) => (
									<Box key={assignee.employeeId} sx={{ ml: i > 0 ? -0.75 : 0, zIndex: 3 - i }}>
										<UserCard
											employeeId={assignee.employeeId}
											variant="avatar-only"
											avatarSize="xs"
											showPresence
										/>
									</Box>
								))}
								{task.assignees.length > 3 && (
									<Tooltip title={`${task.assignees.length - 3} more assignees`}>
										<Box sx={{ ml: -0.75, width: 24, height: 24, borderRadius: '50%', bgcolor: 'action.selected', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 600 }}>
											+{task.assignees.length - 3}
										</Box>
									</Tooltip>
								)}
							</Box>
						) : (
							<Typography variant="caption" sx={{ ...colors.text.secondary.style, fontSize: '0.7rem' }}>
								No assignees
							</Typography>
						)}
						<Tooltip title="Add assignee">
							<IconButton size="small" data-testid="task-add-assignee-btn">
								<PersonAddIcon fontSize="small" />
							</IconButton>
						</Tooltip>
					</Box>
				</Box>

				{/* Compact Dates Row (side-by-side) */}
				<Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
					<TextField
						label="Start"
						type="date"
						size="small"
						value={startDate}
						onChange={handleStartDateChange}
						InputLabelProps={{ shrink: true }}
						disabled={saving}
						data-testid="task-start-date-input"
						sx={{ flex: 1 }}
						inputProps={{ style: { fontSize: '0.8rem' } }}
					/>
					<TextField
						label="Due"
						type="date"
						size="small"
						value={dueDate}
						onChange={handleDueDateChange}
						InputLabelProps={{ shrink: true }}
						disabled={saving}
						data-testid="task-due-date-input"
						sx={{ flex: 1 }}
						inputProps={{ style: { fontSize: '0.8rem' } }}
					/>
				</Box>

				<Divider sx={{ my: 2 }} />

				{/* Description */}
				<Box sx={{ mb: 2, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
					<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
						<Typography
							variant="caption"
							sx={{ ...colors.text.secondary.style, fontWeight: 600, fontSize: '0.7rem' }}
						>
							DESCRIPTION
						</Typography>
						{document && !isEditingDescription && (
							<Button
								size="small"
								onClick={() => setIsEditingDescription(true)}
								data-testid="task-edit-description-btn"
								sx={{ fontSize: '0.7rem', py: 0.25, px: 0.75, minWidth: 'auto' }}
							>
								Edit
							</Button>
						)}
					</Box>
					{loadingDocument ? (
						<Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
							<CircularProgress size={16} />
						</Box>
					) : document ? (
						<Box
							sx={{
								p: 1,
								border: 1,
								borderRadius: 1,
								flex: 1,
								minHeight: 0,
								overflowY: 'auto',
								fontSize: '0.85rem',
								...colors.border.default.style,
								...colors.bg.default.style,
							}}
							data-testid="task-description-editor"
						>
							<DocumentEditor
								document={document}
								isEditing={isEditingDescription}
								onSaved={handleDescriptionSaved}
								showTitle={false}
							/>
						</Box>
					) : (
						<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic', fontSize: '0.8rem' }}>
							No description
						</Typography>
					)}
				</Box>

				<Divider sx={{ my: 2 }} />

				{/* Attachments Section - Compact */}
				<Box sx={{ mb: 2 }}>
					<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
						<Typography
							variant="caption"
							sx={{ ...colors.text.secondary.style, fontWeight: 600, fontSize: '0.7rem' }}
						>
							ATTACHMENTS ({fileAttachments.length})
						</Typography>
					</Box>
					{loadingAttachments ? (
						<Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
							<CircularProgress size={16} />
						</Box>
					) : fileAttachments.length > 0 ? (
						<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} data-testid="task-attachments-list">
							{fileAttachments.slice(0, 3).map((file) => (
								<FileAttachment
									key={file.id}
									fileId={file.id}
									filename={file.originalFilename}
									validationStatus={file.validationStatus}
									validationMessage={file.validationMessage}
								/>
							))}
							{fileAttachments.length > 3 && (
								<Button
									size="small"
									onClick={handleOpenFullPage}
									sx={{ fontSize: '0.75rem', alignSelf: 'flex-start' }}
									data-testid="task-view-all-attachments-btn"
								>
									+{fileAttachments.length - 3} more...
								</Button>
							)}
						</Box>
					) : (
						<Box
							sx={{
								display: 'flex',
								alignItems: 'center',
								gap: 1,
								p: 1,
								border: 1,
								borderRadius: 1,
								...colors.border.default.style,
								...colors.bg.default.style,
							}}
						>
							<AttachFileIcon fontSize="small" sx={{ ...colors.text.secondary.style, fontSize: '1rem' }} />
							<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic', fontSize: '0.8rem' }}>
								No attachments
							</Typography>
						</Box>
					)}
				</Box>

				<Divider sx={{ my: 2 }} />

				{/* Comments Summary - Compact */}
				<Box sx={{ mb: 2 }}>
					<Typography
						variant="caption"
						sx={{ ...colors.text.secondary.style, fontWeight: 600, mb: 1, display: 'block', fontSize: '0.7rem' }}
					>
						COMMENTS
					</Typography>
					{loadingComments ? (
						<Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
							<CircularProgress size={16} />
						</Box>
					) : (
						<Box
							sx={{
								display: 'flex',
								alignItems: 'center',
								gap: 1,
								p: 1,
								border: 1,
								borderRadius: 1,
								cursor: 'pointer',
								...colors.border.default.style,
								...colors.bg.default.style,
								'&:hover': {
									bgcolor: 'action.hover',
								},
							}}
							onClick={handleOpenFullPage}
							data-testid="task-comments-summary"
						>
							<ChatBubbleOutlineIcon fontSize="small" sx={{ ...colors.text.secondary.style, fontSize: '1rem' }} />
							<Typography variant="body2" sx={{ ...colors.text.primary.style, fontSize: '0.8rem' }}>
								{commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : 'No comments'}
							</Typography>
							<Typography variant="caption" sx={{ ...colors.text.secondary.style, ml: 'auto', fontSize: '0.7rem' }}>
								View →
							</Typography>
						</Box>
					)}
				</Box>

				<Divider sx={{ my: 2 }} />

				{/* Compact Metadata Row */}
				<Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
					<Box sx={{ flex: 1 }}>
						<Typography
							variant="caption"
							sx={{ ...colors.text.secondary.style, fontWeight: 600, fontSize: '0.65rem', display: 'block', mb: 0.5 }}
						>
							REPORTER
						</Typography>
						<UserCard
							employeeId={task.reporterEmployeeId}
							variant="compact"
							avatarSize="xs"
						/>
					</Box>
					<Box sx={{ flex: 1 }}>
						<Typography
							variant="caption"
							sx={{ ...colors.text.secondary.style, fontWeight: 600, fontSize: '0.65rem', display: 'block' }}
						>
							UPDATED
						</Typography>
						<Typography variant="body2" sx={{ ...colors.text.primary.style, fontSize: '0.75rem' }}>
							{task.updatedAt ? new Date(task.updatedAt).toLocaleDateString() : 'N/A'}
						</Typography>
					</Box>
				</Box>

				<Divider sx={{ my: 2 }} />

				{/* Action to open full page */}
				<Button
					fullWidth
					variant="outlined"
					startIcon={<OpenInNewIcon />}
					onClick={handleOpenFullPage}
					data-testid="task-view-details-btn"
				>
					View Full Details
				</Button>
			</Box>

			{/* Loading indicator */}
			{saving && (
				<Box
					sx={{
						position: 'absolute',
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						backgroundColor: 'rgba(0, 0, 0, 0.1)',
						zIndex: 1,
					}}
				>
					<CircularProgress size={32} />
				</Box>
			)}
		</Drawer>
	);
}

export default TaskDetailSidePanel;
