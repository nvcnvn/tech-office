/**
 * CreateTaskFromMessageDialog — turn a chat message into a task without leaving the
 * conversation.
 *
 * Feature: 038-chat-task-quick-action
 *
 * Four inputs and no more: title, project, assignee, due date. Everything else a task can
 * have is reachable through "More options", which hands the entered values to the full
 * task form. The point of this dialog is that recording a piece of work costs a couple of
 * interactions rather than a trip to another part of the app; adding a fifth field would
 * defeat it.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Alert,
	Autocomplete,
	Box,
	Button,
	CircularProgress,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	TextField,
	Typography,
	type TextFieldProps,
} from '@mui/material';
import {
	channelDestinationUnsetExplanation,
	createTaskFromMessage,
	getChannelTaskDestination,
	listProjectMembers,
	listProjects,
	listTasksBySourceMessages,
	type MessageTaskLink,
	type Project,
	type ProjectMember,
	type Task,
} from 'apis';
import { UserCard } from '@/components/user';

/** Where a derived title is cut. Mirrors MaxTaskTitleLength on the server. */
const MAX_TITLE_LENGTH = 120;

/**
 * Derive the title the dialog opens with from a message body.
 *
 * The body is sanitized HTML, so formatting is stripped to plain text, runs of whitespace
 * collapse, and a long message is cut at a word boundary rather than mid-word. An
 * attachment-only or empty message yields an empty string: the dialog then opens with an
 * empty title for the user to fill in, which is not an error until they try to confirm.
 *
 * The server derives the same thing independently; this is what makes the field appear
 * filled in the instant the dialog opens, without a round trip.
 */
export function titleFromMessageText(body: string): string {
	// Tags become spaces rather than vanishing, so <p>a</p><p>b</p> reads "a b", not "ab".
	const text = body
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();

	// Spread rather than slice, so a multibyte character is never cut in half.
	const chars = [...text];
	if (chars.length <= MAX_TITLE_LENGTH) return text;

	const cut = chars.slice(0, MAX_TITLE_LENGTH).join('');
	const boundary = cut.lastIndexOf(' ');
	// A first word longer than the whole limit leaves no boundary to fall back to.
	return (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
}

interface CreateTaskFromMessageDialogProps {
	open: boolean;
	onClose: () => void;
	/** The channel the source message was posted in. */
	channelId: string;
	/** The message being turned into a task. */
	messageId: string;
	/** Plain-text title derived from the message body; may be empty. */
	initialTitle: string;
	/**
	 * Employees the source message mentions. Exactly one who is an employee in the
	 * organization is pre-selected as assignee; zero or several leave it empty, because
	 * guessing among several would be wrong as often as right.
	 */
	mentionedEmployeeIds?: string[];
	/** Called with the created task so the conversation can show its chip immediately. */
	onCreated?: (task: Task) => void;
	/**
	 * Opens the full task form carrying whatever has been entered so far. Nothing the
	 * user has typed is lost by reaching for more options.
	 */
	onMoreOptions?: (draft: CreateTaskFromMessageDraft) => void;
}

export interface CreateTaskFromMessageDraft {
	title: string;
	projectId?: string;
	assigneeEmployeeId?: string;
	dueDate?: string;
}

export default function CreateTaskFromMessageDialog({
	open,
	onClose,
	channelId,
	messageId,
	initialTitle,
	mentionedEmployeeIds = [],
	onCreated,
	onMoreOptions,
}: CreateTaskFromMessageDialogProps) {
	const [title, setTitle] = useState(initialTitle);
	const [project, setProject] = useState<Project | null>(null);
	const [assigneeId, setAssigneeId] = useState<string>('');
	const [dueDate, setDueDate] = useState('');

	const [projects, setProjects] = useState<Project[]>([]);
	const [members, setMembers] = useState<ProjectMember[]>([]);
	const [loadingProjects, setLoadingProjects] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	// Field-level errors are kept apart from the request-level one so a bad title marks
	// the title input rather than shouting at the whole form.
	const [titleError, setTitleError] = useState('');
	const [formError, setFormError] = useState('');

	// The channel's remembered destination. When it is usable the project field collapses
	// to one changeable line, which is what makes a second conversion in the same channel
	// cost two interactions instead of four.
	const [destinationReason, setDestinationReason] = useState<string | undefined>();
	const [projectFieldExpanded, setProjectFieldExpanded] = useState(true);

	// Tasks this message has already produced. Converting a message twice is allowed, but
	// it is nearly always a mistake, so it takes a second, explicit confirmation.
	const [existingTasks, setExistingTasks] = useState<MessageTaskLink[]>([]);
	const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);

	const titleRef = useRef<HTMLInputElement>(null);

	// Reset to the message's own text each time the dialog opens on a message, so
	// reopening never shows a stale draft from a previous conversion.
	useEffect(() => {
		if (!open) return;
		setTitle(initialTitle);
		setProject(null);
		setDueDate('');
		setTitleError('');
		setFormError('');
		setDestinationReason(undefined);
		setProjectFieldExpanded(true);
		setExistingTasks([]);
		setDuplicateAcknowledged(false);
		// Pre-select only when the message names exactly one person. Zero is nothing to
		// go on; several is a guess the user would have to check anyway.
		setAssigneeId(mentionedEmployeeIds.length === 1 ? mentionedEmployeeIds[0] : '');
	}, [open, initialTitle, mentionedEmployeeIds]);

	// The title opens focused with its text selected, so typing replaces the derived
	// title outright and the common case — a message that already says what to do — costs
	// no keystrokes at all.
	useEffect(() => {
		if (!open) return;
		const id = window.setTimeout(() => {
			titleRef.current?.focus();
			titleRef.current?.select();
		}, 0);
		return () => window.clearTimeout(id);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoadingProjects(true);
		listProjects({ includeArchived: false })
			.then((resp) => {
				if (!cancelled) setProjects(resp.projects.filter((p) => !p.isArchived));
			})
			.catch(() => {
				if (!cancelled) setFormError('Could not load your projects. Try again.');
			})
			.finally(() => {
				if (!cancelled) setLoadingProjects(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	// What this channel remembers. Resolved server-side against what this caller can
	// actually use, so an archived or unreachable project comes back unset with a reason
	// rather than pre-filling something that would be refused on submit.
	useEffect(() => {
		if (!open || projects.length === 0) return;
		let cancelled = false;
		getChannelTaskDestination(channelId)
			.then((dest) => {
				if (cancelled) return;
				if (dest.isSet) {
					const remembered = projects.find((p) => p.id === dest.projectId);
					if (remembered) {
						setProject(remembered);
						setProjectFieldExpanded(false);
						return;
					}
				}
				// Nothing usable: leave the picker open and say why, when there is a why.
				setDestinationReason(channelDestinationUnsetExplanation(dest.unsetReason));
				setProjectFieldExpanded(true);
			})
			.catch(() => {
				// A destination we cannot read is the same as none: the picker stays open.
				if (!cancelled) setProjectFieldExpanded(true);
			});
		return () => {
			cancelled = true;
		};
	}, [open, channelId, projects]);

	// Whether this message has already become a task. One batched call for the one
	// message the dialog is open on.
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		listTasksBySourceMessages([messageId])
			.then((links) => {
				if (!cancelled) setExistingTasks(links);
			})
			.catch(() => {
				// Not knowing is not a reason to block the conversion; the warning is a
				// courtesy, not a gate on the server.
				if (!cancelled) setExistingTasks([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, messageId]);

	// Assignee options follow the chosen project: you can only assign work to someone who
	// is on the project it lands in.
	useEffect(() => {
		if (!project) {
			setMembers([]);
			return;
		}
		let cancelled = false;
		listProjectMembers(project.id)
			.then((resp) => {
				if (!cancelled) setMembers(resp.members);
			})
			.catch(() => {
				if (!cancelled) setMembers([]);
			});
		return () => {
			cancelled = true;
		};
	}, [project]);

	const draft = useMemo<CreateTaskFromMessageDraft>(
		() => ({
			title,
			projectId: project?.id,
			assigneeEmployeeId: assigneeId || undefined,
			dueDate: dueDate || undefined,
		}),
		[title, project, assigneeId, dueDate],
	);

	const handleSubmit = useCallback(async () => {
		const trimmed = title.trim();
		if (!trimmed) {
			setTitleError('Give the task a title');
			titleRef.current?.focus();
			return;
		}
		if (!project) {
			setFormError('Choose a project for this task');
			setProjectFieldExpanded(true);
			return;
		}
		if (existingTasks.length > 0 && !duplicateAcknowledged) {
			// The first confirm only acknowledges the duplicate; the next one creates.
			setDuplicateAcknowledged(true);
			return;
		}

		setSubmitting(true);
		setTitleError('');
		setFormError('');
		try {
			const resp = await createTaskFromMessage({
				sourceChannelId: channelId,
				sourceMessageId: messageId,
				projectId: project.id,
				title: trimmed,
				assigneeEmployeeId: assigneeId || undefined,
				dueDate: dueDate || undefined,
			});
			onCreated?.(resp.task);
			onClose();
		} catch (err) {
			// The dialog stays open with everything the user entered still in it. A failed
			// conversion should cost them a retry, not their typing.
			setFormError(err instanceof Error ? err.message : 'Could not create the task. Try again.');
		} finally {
			setSubmitting(false);
		}
	}, [
		title,
		project,
		assigneeId,
		dueDate,
		channelId,
		messageId,
		existingTasks,
		duplicateAcknowledged,
		onCreated,
		onClose,
	]);

	return (
		<Dialog
			open={open}
			onClose={submitting ? undefined : onClose}
			fullWidth
			maxWidth="sm"
			data-testid="create-task-from-message-dialog"
		>
			<DialogTitle>Create task</DialogTitle>

			<DialogContent>
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
					{formError && (
						<Alert severity="error" data-testid="create-task-from-message-error">
							{formError}
						</Alert>
					)}

					{existingTasks.length > 0 && (
						<Alert severity="warning" data-testid="create-task-from-message-duplicate-warning">
							This message has already become{' '}
							{existingTasks.length === 1 ? 'a task' : `${existingTasks.length} tasks`}:{' '}
							{existingTasks.map((t) => t.identifier).join(', ')}. Creating another is
							allowed, but confirm twice so it is deliberate.
						</Alert>
					)}

					<TextField
						inputRef={titleRef}
						label="Title"
						value={title}
						onChange={(e) => {
							setTitle(e.target.value);
							if (titleError) setTitleError('');
						}}
						error={Boolean(titleError)}
						helperText={titleError || ' '}
						fullWidth
						autoComplete="off"
						slotProps={{ htmlInput: { 'data-testid': 'create-task-from-message-title' } }}
					/>

					{/*
					  * A channel that already knows where its tasks go shows one line, not a
					  * picker. Changing it here affects this task only — the channel keeps
					  * remembering what it remembered.
					  */}
					{!projectFieldExpanded && project ? (
						<Box
							sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
							data-testid="create-task-from-message-project-collapsed"
						>
							<Typography variant="body2">
								Project: <strong>{project.key}</strong> · {project.name}
							</Typography>
							<Button
								size="small"
								onClick={() => setProjectFieldExpanded(true)}
								data-testid="create-task-from-message-project-change"
							>
								Change
							</Button>
						</Box>
					) : (
						<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
							<Autocomplete
								options={projects}
								value={project}
								loading={loadingProjects}
								onChange={(_, value) => {
									setProject(value);
									// The previous project's members no longer apply.
									setAssigneeId('');
									if (formError) setFormError('');
								}}
								getOptionLabel={(option) => `${option.key} · ${option.name}`}
								isOptionEqualToValue={(a, b) => a.id === b.id}
								data-testid="create-task-from-message-project"
								renderInput={(params) => (
									<TextField
										{...(params as TextFieldProps)}
										label="Project"
										placeholder={loadingProjects ? 'Loading projects…' : 'Where should this task go?'}
									/>
								)}
							/>
							{destinationReason && (
								<Typography
									variant="caption"
									color="text.secondary"
									data-testid="create-task-from-message-destination-reason"
								>
									{destinationReason}
								</Typography>
							)}
						</Box>
					)}

					<Autocomplete
						options={members}
						value={members.find((m) => m.employeeId === assigneeId) ?? null}
						onChange={(_, value) => setAssigneeId(value?.employeeId ?? '')}
						disabled={!project}
						getOptionLabel={(option) => option.employeeId}
						isOptionEqualToValue={(a, b) => a.employeeId === b.employeeId}
						renderOption={(props, option) => {
							const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
							return (
								<li key={key} {...rest} data-testid={`create-task-assignee-${option.employeeId}`}>
									<UserCard employeeId={option.employeeId} variant="compact" avatarSize="xs" />
								</li>
							);
						}}
						data-testid="create-task-from-message-assignee"
						renderInput={(params) => (
							<TextField
								{...(params as TextFieldProps)}
								label="Assignee"
								placeholder={project ? 'Optional' : 'Choose a project first'}
							/>
						)}
					/>

					<TextField
						label="Due date"
						type="date"
						value={dueDate}
						onChange={(e) => setDueDate(e.target.value)}
						fullWidth
						slotProps={{
							inputLabel: { shrink: true },
							htmlInput: { 'data-testid': 'create-task-from-message-due-date' },
						}}
					/>

					<Typography variant="caption" color="text.secondary">
						Creates an ordinary task and leaves a note on this message.
					</Typography>
				</Box>
			</DialogContent>

			<DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
				<Button
					onClick={() => onMoreOptions?.(draft)}
					disabled={submitting || !onMoreOptions}
					data-testid="create-task-from-message-more-options"
				>
					More options
				</Button>
				<Box sx={{ display: 'flex', gap: 1 }}>
					<Button onClick={onClose} disabled={submitting} data-testid="create-task-from-message-cancel">
						Cancel
					</Button>
					<Button
						variant="contained"
						color={duplicateAcknowledged ? 'warning' : 'primary'}
						onClick={handleSubmit}
						disabled={submitting}
						data-testid="create-task-from-message-submit"
					>
						{submitting ? (
							<CircularProgress size={20} />
						) : duplicateAcknowledged ? (
							'Create anyway'
						) : (
							'Create task'
						)}
					</Button>
				</Box>
			</DialogActions>
		</Dialog>
	);
}
