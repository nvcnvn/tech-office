/**
 * Team Calendar View
 * Displays side-by-side schedules for team members with delegation badge.
 * Feature: 026-calendar-system (T045)
 *
 * Respects privacy: private events show as "Busy", personal_shared show time only.
 * Backend handles redaction — this component renders whatever the API returns.
 */

'use client';

import React, { useMemo } from 'react';
import {
	Box,
	Typography,
	Chip,
	Paper,
	Tooltip,
} from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import BadgeIcon from '@mui/icons-material/Badge';
import { useQuery } from '@tanstack/react-query';
import { listEvents, listDelegations, type CalendarEvent } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

// =============================================================================
// Types
// =============================================================================

export interface TeamMember {
	employeeId: string;
	name: string;
}

interface TeamCalendarViewProps {
	date: Date;
	members: TeamMember[];
}

// =============================================================================
// Helpers
// =============================================================================

function startOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function endOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(23, 59, 59, 999);
	return d;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function eventTop(event: CalendarEvent, dayStart: Date): number {
	if (!event.startTime) return 0;
	const diff = event.startTime.getTime() - dayStart.getTime();
	return (diff / (1000 * 60 * 60)) * 60; // 60px per hour
}

function eventHeight(event: CalendarEvent): number {
	if (!event.startTime || !event.endTime) return 60;
	const diff = event.endTime.getTime() - event.startTime.getTime();
	return Math.max((diff / (1000 * 60 * 60)) * 60, 15);
}

function formatTime(d?: Date): string {
	if (!d) return '';
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// =============================================================================
// Component
// =============================================================================

export default function TeamCalendarView({ date, members }: TeamCalendarViewProps) {
	const colors = useThemeColors();
	const dayStart = useMemo(() => startOfDay(date), [date]);
	const dayEnd = useMemo(() => endOfDay(date), [date]);

	// Fetch delegations for current user
	const { data: delegations } = useQuery({
		queryKey: ['calendar', 'delegations'],
		queryFn: () => listDelegations(),
	});

	const delegateIds = useMemo(() => {
		if (!delegations) return new Set<string>();
		return new Set(delegations.grantedToMe.map(d => d.delegatorEmployeeId));
	}, [delegations]);

	return (
		<Box data-testid="team-calendar-view" sx={{ display: 'flex', gap: 0, overflow: 'auto' }}>
			{/* Time gutter */}
			<Box sx={{ width: 56, flexShrink: 0, pt: '32px' }}>
				{HOURS.map(h => (
					<Box key={h} sx={{ height: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', pr: 1 }}>
						<Typography variant="caption" color="text.secondary">
							{h === 0 ? '' : `${h}:00`}
						</Typography>
					</Box>
				))}
			</Box>

			{/* One column per team member */}
			{members.map(member => (
				<MemberColumn
					key={member.employeeId}
					member={member}
					dayStart={dayStart}
					dayEnd={dayEnd}
					isDelegateOf={delegateIds.has(member.employeeId)}
					colors={colors}
				/>
			))}
		</Box>
	);
}

// =============================================================================
// Member Column
// =============================================================================

function MemberColumn({
	member,
	dayStart,
	dayEnd,
	isDelegateOf,
	colors,
}: {
	member: TeamMember;
	dayStart: Date;
	dayEnd: Date;
	isDelegateOf: boolean;
	colors: ReturnType<typeof useThemeColors>;
}) {
	const { data: events, isLoading } = useQuery({
		queryKey: ['calendar', 'events', member.employeeId, dayStart.toISOString()],
		queryFn: () => listEvents(dayStart, dayEnd, member.employeeId),
	});

	return (
		<Box sx={{ flexShrink: 0, width: 200, borderLeft: 1, borderColor: 'divider' }}>
			{/* Header */}
			<Box sx={{ height: 32, display: 'flex', alignItems: 'center', px: 1, gap: 0.5 }}>
				<PeopleIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
				<Typography variant="caption" noWrap sx={{ flex: 1 }}>
					{member.name}
				</Typography>
				{isDelegateOf && (
					<Tooltip title="You are a delegate for this person">
						<BadgeIcon sx={{ fontSize: 14, color: 'primary.main' }} />
					</Tooltip>
				)}
			</Box>

			{/* Day grid */}
			<Box sx={{ position: 'relative', height: 24 * 60 }}>
				{/* Hour lines */}
				{HOURS.map(h => (
					<Box
						key={h}
						sx={{
							position: 'absolute',
							top: h * 60,
							left: 0,
							right: 0,
							borderTop: 1,
							borderColor: 'divider',
							height: 60,
						}}
					/>
				))}

				{/* Events */}
				{isLoading ? (
					<Typography variant="caption" sx={{ p: 1 }}>
						Loading…
					</Typography>
				) : (
					(events ?? []).map(ev => (
						<EventBlock key={ev.id} event={ev} dayStart={dayStart} />
					))
				)}
			</Box>
		</Box>
	);
}

// =============================================================================
// Event Block
// =============================================================================

function EventBlock({ event, dayStart }: { event: CalendarEvent; dayStart: Date }) {
	const isBusy = event.title === 'Busy';

	return (
		<Paper
			elevation={0}
			sx={{
				position: 'absolute',
				top: eventTop(event, dayStart),
				left: 4,
				right: 4,
				height: eventHeight(event),
				overflow: 'hidden',
				px: 0.5,
				py: 0.25,
				fontSize: 11,
				bgcolor: isBusy ? 'action.disabledBackground' : 'primary.light',
				color: isBusy ? 'text.disabled' : 'primary.contrastText',
				borderLeft: 3,
				borderColor: isBusy ? 'text.disabled' : 'primary.main',
				cursor: isBusy ? 'default' : 'pointer',
			}}
		>
			<Typography variant="caption" noWrap>
				{event.title}
			</Typography>
			{!isBusy && event.startTime && (
				<Typography variant="caption" display="block" noWrap sx={{ opacity: 0.8 }}>
					{formatTime(event.startTime)} – {formatTime(event.endTime)}
				</Typography>
			)}
		</Paper>
	);
}
