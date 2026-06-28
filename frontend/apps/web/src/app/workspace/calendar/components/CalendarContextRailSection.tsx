'use client';

import { Alert, Box, Button, Chip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	calendarEventsQueryKey,
	getCalendarEventsQueryKey,
	listEvents,
	respondToInvite,
	type CalendarEvent,
	type RSVPStatus,
} from 'apis';

import { ContextRailEmptyState } from '../../components/context-rail/ContextRailEmptyState';
import { ContextRailSection } from '../../components/context-rail/ContextRailSection';

export interface CalendarContextRailSectionProps {
	currentUserId: string;
	defaultedToToday: boolean;
	events?: CalendarEvent[];
	selectedDate: Date;
}

export default function CalendarContextRailSection({
	currentUserId,
	defaultedToToday,
	events = [],
	selectedDate,
}: CalendarContextRailSectionProps) {
	const queryClient = useQueryClient();
	const dayStart = startOfDay(selectedDate);
	const dayEnd = endOfDay(selectedDate);
	const dayQuery = useQuery({
		queryKey: getCalendarEventsQueryKey(dayStart, dayEnd),
		queryFn: () => listEvents(dayStart, dayEnd),
	});

	const rsvpMutation = useMutation({
		mutationFn: ({ eventId, status }: { eventId: string; status: RSVPStatus }) =>
			respondToInvite(eventId, status),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey });
		},
	});

	const dayEvents = resolveDayEvents(events, dayQuery.data ?? [], selectedDate);
	const pendingInvites = dayEvents.filter((event) => {
		const attendee = event.attendees.find((entry) => entry.employeeId === currentUserId);
		return attendee?.rsvpStatus === 'pending';
	});

	return (
		<>
			<ContextRailSection
				title="Selected Day"
				description={defaultedToToday ? 'Today' : formatDayLabel(selectedDate)}
				testId="workspace-context-rail-calendar-day"
			>
				{dayQuery.isLoading && dayEvents.length === 0 ? (
					<Typography variant="body2" color="text.secondary">
						Loading the day summary...
					</Typography>
				) : dayQuery.isError && dayEvents.length === 0 ? (
					<Typography variant="body2" color="error.main">
						Unable to load the selected day right now.
					</Typography>
				) : dayEvents.length > 0 ? (
					<Box sx={{ display: 'grid', gap: 1.25 }}>
						{dayEvents.map((event) => {
							const attendee = event.attendees.find((entry) => entry.employeeId === currentUserId);

							return (
								<Box
									key={event.id}
									data-testid={`workspace-context-rail-calendar-event-${event.id}`}
									sx={{ display: 'grid', gap: 0.5 }}
								>
									<Typography variant="body2" fontWeight={700} color="text.primary">
										{event.title}
									</Typography>
									<Typography variant="caption" color="text.secondary">
										{formatTimeRange(event.startTime, event.endTime, event.allDay)}
									</Typography>
									{attendee ? (
										<Chip
											label={formatRsvpLabel(attendee.rsvpStatus)}
											size="small"
											variant="outlined"
											sx={{ justifySelf: 'flex-start' }}
										/>
									) : null}
								</Box>
							);
						})}
					</Box>
				) : (
					<ContextRailEmptyState message="Nothing is scheduled for this day." />
				)}
			</ContextRailSection>

			<ContextRailSection
				title="Pending Invites"
				description={pendingInvites.length > 0 ? 'Respond without leaving the calendar view.' : undefined}
				testId="workspace-context-rail-calendar-pending-invites"
			>
				{rsvpMutation.isError ? (
					<Alert severity="error">
						{rsvpMutation.error instanceof Error
							? rsvpMutation.error.message
							: 'Unable to update your RSVP right now.'}
					</Alert>
				) : null}
				{dayQuery.isLoading ? (
					<Typography variant="body2" color="text.secondary">
						Checking your invites...
					</Typography>
				) : pendingInvites.length > 0 ? (
					<Box sx={{ display: 'grid', gap: 1.25 }}>
						{pendingInvites.map((event) => {
							const isPendingAction =
								rsvpMutation.isPending && rsvpMutation.variables?.eventId === event.id;

							return (
								<Box
									key={event.id}
									data-testid={`workspace-context-rail-calendar-invite-${event.id}`}
									sx={{ display: 'grid', gap: 0.75 }}
								>
									<Typography variant="body2" fontWeight={700} color="text.primary">
										{event.title}
									</Typography>
									<Typography variant="caption" color="text.secondary">
										{formatTimeRange(event.startTime, event.endTime, event.allDay)}
									</Typography>
									<Box sx={{ display: 'flex', gap: 1 }}>
										<Button
											disabled={rsvpMutation.isPending}
											onClick={() => rsvpMutation.mutate({ eventId: event.id, status: 'accepted' })}
											size="small"
											variant="contained"
										>
											Accept
										</Button>
										<Button
											color="inherit"
											disabled={rsvpMutation.isPending}
											onClick={() => rsvpMutation.mutate({ eventId: event.id, status: 'declined' })}
											size="small"
											variant="outlined"
										>
											Decline
										</Button>
									</Box>
									{isPendingAction ? (
										<Typography variant="caption" color="text.secondary">
											Saving your response...
										</Typography>
									) : null}
								</Box>
							);
						})}
					</Box>
				) : (
					<ContextRailEmptyState message="No invites are waiting on you." />
				)}
			</ContextRailSection>
		</>
	);
}

function resolveDayEvents(
	visibleEvents: CalendarEvent[],
	queriedDayEvents: CalendarEvent[],
	selectedDate: Date,
) {
	const visibleDayEvents = visibleEvents.filter((event) =>
		event.startTime ? isSameDay(event.startTime, selectedDate) : false
	);

	return visibleDayEvents.length > 0 ? visibleDayEvents : queriedDayEvents;
}

function isSameDay(left: Date, right: Date): boolean {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}

function startOfDay(value: Date): Date {
	const nextValue = new Date(value);
	nextValue.setHours(0, 0, 0, 0);
	return nextValue;
}

function endOfDay(value: Date): Date {
	const nextValue = new Date(value);
	nextValue.setHours(23, 59, 59, 999);
	return nextValue;
}

function formatDayLabel(value: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
	}).format(value);
}

function formatTimeRange(start?: Date, end?: Date, allDay?: boolean): string {
	if (allDay) {
		return 'All day';
	}

	if (!start) {
		return 'Time is still being finalized';
	}

	const formatter = new Intl.DateTimeFormat(undefined, {
		hour: 'numeric',
		minute: '2-digit',
	});

	if (!end) {
		return formatter.format(start);
	}

	return `${formatter.format(start)} - ${formatter.format(end)}`;
}

function formatRsvpLabel(status: RSVPStatus): string {
	switch (status) {
		case 'accepted':
			return 'Accepted';
		case 'declined':
			return 'Declined';
		case 'tentative':
			return 'Tentative';
		default:
			return 'Pending';
	}
}