/**
 * EventDetailPanel Component
 * Displays event details, attendees with RSVP status, and RSVP buttons
 * Feature: 026-calendar-system (T024)
 *
 * Shows full event information with actionable RSVP for current user.
 */

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
	Box,
	Typography,
	Button,
	IconButton,
	Chip,
	Divider,
	Avatar,
	List,
	ListItem,
	ListItemAvatar,
	ListItemText,
	Alert,
	Tooltip,
	ButtonGroup,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	RadioGroup,
	Radio,
	FormControlLabel,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import LinkIcon from '@mui/icons-material/Link';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import RepeatIcon from '@mui/icons-material/Repeat';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthState } from '@/lib/auth/hooks';
import {
	calendarEventsQueryKey,
	type CalendarEvent,
	type RSVPStatus,
	type EventEditScope,
	respondToInvite,
	cancelEvent,
	editEventSeries,
} from 'apis';
import CheckInPanel from './CheckInPanel';

interface EventDetailPanelProps {
	event: CalendarEvent;
	currentUserId: string;
	onClose: () => void;
	onUpdated: () => void;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
	meeting: 'Meeting',
	shift: 'Shift',
	deadline: 'Deadline',
	reminder: 'Reminder',
	out_of_office: 'Out of Office',
	company_event: 'Company Event',
	training: 'Training',
	maintenance_window: 'Maintenance',
};

const RSVP_CONFIG: Record<RSVPStatus, { color: 'success' | 'error' | 'warning' | 'default'; label: string }> = {
	accepted: { color: 'success', label: 'Accepted' },
	declined: { color: 'error', label: 'Declined' },
	tentative: { color: 'warning', label: 'Tentative' },
	pending: { color: 'default', label: 'Pending' },
};

function formatDateTime(date?: Date): string {
	if (!date) return '—';
	return date.toLocaleString(undefined, {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}

function formatDate(date?: Date): string {
	if (!date) return '—';
	return date.toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
	});
}

export default function EventDetailPanel({ event, currentUserId, onClose, onUpdated }: EventDetailPanelProps) {
	const [error, setError] = useState<string | null>(null);
	const [scopeDialogOpen, setScopeDialogOpen] = useState(false);
	const [selectedScope, setSelectedScope] = useState<EventEditScope>('this_instance');
	const [copyEventLinkSuccess, setCopyEventLinkSuccess] = useState(false);
	const queryClient = useQueryClient();
	const { user } = useAuthState();

	const currentMembership = useMemo(
		() => user?.organizations.find((org) => org.organizationId === user.organizationId) ?? user?.organizations[0],
		[user]
	);

	const handleCopyEventLink = useCallback(async () => {
		try {
			if (!currentMembership?.organizationSubdomain) return;
			const response = await fetch(
				`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:18080'}/api/linking/generate`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						target: {
							tenantKey: currentMembership.organizationSubdomain,
							resourceType: 'calendar',
							resourceId: event.id,
						},
					}),
				}
			);
			const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string } | null;
			if (response.ok && payload?.canonicalUrl) {
				await navigator.clipboard.writeText(payload.canonicalUrl);
				setCopyEventLinkSuccess(true);
				setTimeout(() => setCopyEventLinkSuccess(false), 2000);
			}
		} catch {
			// silently ignore
		}
	}, [currentMembership, event.id]);

	const isOrganizer = event.organizerEmployeeId === currentUserId;
	const currentAttendee = event.attendees.find(a => a.employeeId === currentUserId);
	const isRecurring = !!event.recurrenceRule || event.isExceptionInstance;

	const rsvpMutation = useMutation({
		mutationFn: ({ status }: { status: RSVPStatus }) =>
			respondToInvite(event.id, status),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey });
			onUpdated();
		},
		onError: (err: Error) => setError(err.message),
	});

	const cancelMutation = useMutation({
		mutationFn: () => cancelEvent(event.id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey });
			onUpdated();
		},
		onError: (err: Error) => setError(err.message),
	});

	const skipInstanceMutation = useMutation({
		mutationFn: (scope: EventEditScope) =>
			editEventSeries({
				eventId: event.id,
				instanceStartTime: event.originalStartTime ?? event.startTime,
				changeScope: scope,
				skipInstance: true,
			}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey });
			onUpdated();
		},
		onError: (err: Error) => setError(err.message),
	});

	const handleRSVP = useCallback((status: RSVPStatus) => {
		setError(null);
		rsvpMutation.mutate({ status });
	}, [rsvpMutation]);

	const handleCancel = useCallback(() => {
		setError(null);
		if (isRecurring) {
			setScopeDialogOpen(true);
		} else {
			cancelMutation.mutate();
		}
	}, [cancelMutation, isRecurring]);

	const handleScopeConfirm = useCallback(() => {
		setScopeDialogOpen(false);
		setError(null);
		skipInstanceMutation.mutate(selectedScope);
	}, [skipInstanceMutation, selectedScope]);

	const isCancelled = !!event.cancelledAt;

	return (
		<Box data-testid="event-detail-panel" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
			{/* Header */}
			<Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
				<Box sx={{ flex: 1, mr: 1 }}>
					<Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
						{event.title}
					</Typography>
					<Chip
						label={EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
						size="small"
						sx={{ mt: 0.5 }}
					/>
					{isCancelled && (
						<Chip label="Cancelled" size="small" color="error" sx={{ mt: 0.5, ml: 0.5 }} />
					)}
				</Box>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
					<Tooltip title={copyEventLinkSuccess ? 'Copied!' : 'Copy event link'}>
						<IconButton size="small" onClick={() => { void handleCopyEventLink(); }} data-testid="event-copy-link-btn">
							<LinkIcon fontSize="small" />
						</IconButton>
					</Tooltip>
					<IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
				</Box>
			</Box>

			{error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

			{/* Time */}
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
				<AccessTimeIcon fontSize="small" color="action" />
				<Box>
					{event.allDay ? (
						<Typography variant="body2">{formatDate(event.startTime)} (All Day)</Typography>
					) : (
						<>
							<Typography variant="body2">{formatDateTime(event.startTime)}</Typography>
							<Typography variant="body2" color="text.secondary">
								to {formatDateTime(event.endTime)}
							</Typography>
						</>
					)}
				</Box>
			</Box>

			{/* Recurrence indicator */}
			{isRecurring && (
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<RepeatIcon fontSize="small" color="action" />
					<Typography variant="body2" color="text.secondary">
						{event.isExceptionInstance ? 'Modified instance' : 'Recurring event'}
					</Typography>
				</Box>
			)}

			{/* Location */}
			{event.locationText && (
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<LocationOnIcon fontSize="small" color="action" />
					<Typography variant="body2">{event.locationText}</Typography>
				</Box>
			)}

			{/* Virtual link */}
			{event.virtualLink && (
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<LinkIcon fontSize="small" color="action" />
					<Typography
						variant="body2"
						component="a"
						href={event.virtualLink}
						target="_blank"
						rel="noopener noreferrer"
						sx={{ color: 'primary.main', textDecoration: 'underline' }}
					>
						Join Meeting
					</Typography>
				</Box>
			)}

			{/* Description */}
			{event.description && (
				<>
					<Divider />
					<Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
						{event.description}
					</Typography>
				</>
			)}

			{/* RSVP Buttons for current user */}
			{currentAttendee && !isCancelled && (
				<>
					<Divider />
					<Box>
						<Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
							Your RSVP: {RSVP_CONFIG[currentAttendee.rsvpStatus]?.label ?? currentAttendee.rsvpStatus}
						</Typography>
						<ButtonGroup size="small" variant="outlined" disabled={rsvpMutation.isPending}>
							<Tooltip title="Accept">
								<Button
									onClick={() => handleRSVP('accepted')}
									color={currentAttendee.rsvpStatus === 'accepted' ? 'success' : 'inherit'}
									variant={currentAttendee.rsvpStatus === 'accepted' ? 'contained' : 'outlined'}
									startIcon={<CheckCircleIcon />}
								>
									Accept
								</Button>
							</Tooltip>
							<Tooltip title="Tentative">
								<Button
									onClick={() => handleRSVP('tentative')}
									color={currentAttendee.rsvpStatus === 'tentative' ? 'warning' : 'inherit'}
									variant={currentAttendee.rsvpStatus === 'tentative' ? 'contained' : 'outlined'}
									startIcon={<HelpOutlineIcon />}
								>
									Maybe
								</Button>
							</Tooltip>
							<Tooltip title="Decline">
								<Button
									onClick={() => handleRSVP('declined')}
									color={currentAttendee.rsvpStatus === 'declined' ? 'error' : 'inherit'}
									variant={currentAttendee.rsvpStatus === 'declined' ? 'contained' : 'outlined'}
									startIcon={<CancelIcon />}
								>
									Decline
								</Button>
							</Tooltip>
						</ButtonGroup>
					</Box>
				</>
			)}

			{/* Attendees */}
			{event.attendees.length > 0 && (
				<>
					<Divider />
					<Typography variant="caption" color="text.secondary">
						Attendees ({event.attendees.length})
					</Typography>
					<List dense disablePadding>
						{event.attendees.map((attendee) => (
							<ListItem key={attendee.id} disableGutters sx={{ py: 0.25 }}>
								<ListItemAvatar sx={{ minWidth: 36 }}>
									<Avatar
										src={attendee.employeeAvatarUrl || undefined}
										sx={{ width: 28, height: 28, fontSize: 14 }}
									>
										{attendee.employeeName?.[0]?.toUpperCase() ?? '?'}
									</Avatar>
								</ListItemAvatar>
								<ListItemText
									primary={
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
											<Typography variant="body2">
												{attendee.employeeName}
												{attendee.employeeId === currentUserId && ' (you)'}
											</Typography>
											{attendee.role === 'organizer' && (
												<Chip label="Organizer" size="small" variant="outlined" sx={{ height: 18, fontSize: 11 }} />
											)}
											{attendee.role === 'optional' && (
												<Chip label="Optional" size="small" variant="outlined" sx={{ height: 18, fontSize: 11 }} />
											)}
										</Box>
									}
									secondary={
										<Chip
											label={RSVP_CONFIG[attendee.rsvpStatus]?.label ?? attendee.rsvpStatus}
											size="small"
											color={RSVP_CONFIG[attendee.rsvpStatus]?.color ?? 'default'}
											sx={{ height: 18, fontSize: 11 }}
										/>
									}
								/>
							</ListItem>
						))}
					</List>
				</>
			)}

			{/* Cancel button for organizer */}
			{isOrganizer && !isCancelled && (
				<>
					<Divider />
					<Button
						color="error"
						size="small"
						startIcon={<DeleteIcon />}
						onClick={handleCancel}
						disabled={cancelMutation.isPending || skipInstanceMutation.isPending}
						sx={{ textTransform: 'none', alignSelf: 'flex-start' }}
					>
						{cancelMutation.isPending || skipInstanceMutation.isPending ? 'Cancelling...' : 'Cancel Event'}
					</Button>
				</>
			)}

			{/* Compliance check-in for shift/maintenance events */}
			{(event.requiresCheckIn || event.requiresEvidence) && (
				<>
					<Divider />
					<CheckInPanel
						eventId={event.id}
						requiresCheckIn={event.requiresCheckIn}
						requiresEvidence={event.requiresEvidence}
					/>
				</>
			)}

			{/* Edit scope dialog for recurring events */}
			<Dialog
				open={scopeDialogOpen}
				onClose={() => setScopeDialogOpen(false)}
				data-testid="edit-scope-dialog"
			>
				<DialogTitle>Cancel recurring event</DialogTitle>
				<DialogContent>
					<RadioGroup
						value={selectedScope}
						onChange={(e) => setSelectedScope(e.target.value as EventEditScope)}
					>
						<FormControlLabel
							value="this_instance"
							control={<Radio />}
							label="This event only"
						/>
						<FormControlLabel
							value="this_and_following"
							control={<Radio />}
							label="This and following events"
						/>
						<FormControlLabel
							value="all"
							control={<Radio />}
							label="All events in the series"
						/>
					</RadioGroup>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setScopeDialogOpen(false)}>Cancel</Button>
					<Button onClick={handleScopeConfirm} variant="contained" color="error">
						Confirm
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
}
