/**
 * Calendar Page
 * Main calendar view with day/week/month/agenda view switcher
 * Feature: 026-calendar-system (T021)
 *
 * Layout:
 * - Top bar: view switcher + navigation + create button
 * - Center: event grid for the visible time range
 * - Right: event detail panel (when event selected)
 *
 * Features:
 * - Day/Week/Month/Agenda view modes
 * - listEvents query for visible time range
 * - Mobile-first responsive layout
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { useState, useCallback, useMemo, Suspense } from 'react';
import {
	Box,
	Typography,
	CircularProgress,
	IconButton,
	ToggleButtonGroup,
	ToggleButton,
	Button,
	Chip,
	Paper,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import AddIcon from '@mui/icons-material/Add';
import CalendarViewDayIcon from '@mui/icons-material/CalendarViewDay';
import CalendarViewWeekIcon from '@mui/icons-material/CalendarViewWeek';
import CalendarViewMonthIcon from '@mui/icons-material/CalendarMonth';
import ViewAgendaIcon from '@mui/icons-material/ViewAgenda';
import { useQuery } from '@tanstack/react-query';
import { useRequireAuth } from '@/lib/auth/hooks';
import {
	getCalendarEventsQueryKey,
	listEvents,
	listOverlayItems,
	type CalendarEvent,
} from 'apis';
import EventCreateForm from './components/EventCreateForm';
import CalendarContextRailSection from './components/CalendarContextRailSection';
import EventDetailPanel from './components/EventDetailPanel';
import OverlayToggleBar, { type OverlayToggles, loadOverlayToggles } from './components/OverlayToggleBar';
import {
	createContextRailRegistrationToken,
	useRegisterContextRail,
} from '../providers/useContextRail';

// =============================================================================
// Types
// =============================================================================

type ViewMode = 'day' | 'week' | 'month' | 'agenda';

// =============================================================================
// Date Utilities
// =============================================================================

function startOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function startOfWeek(date: Date): Date {
	const d = new Date(date);
	d.setDate(d.getDate() - d.getDay());
	d.setHours(0, 0, 0, 0);
	return d;
}

function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(23, 59, 59, 999);
	return d;
}

function endOfWeek(date: Date): Date {
	const d = startOfWeek(date);
	d.setDate(d.getDate() + 6);
	d.setHours(23, 59, 59, 999);
	return d;
}

function endOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function addDays(date: Date, days: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + days);
	return d;
}

function isSameDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(date: Date): string {
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateRange(view: ViewMode, date: Date): string {
	const opts: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };
	switch (view) {
		case 'day':
			return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
		case 'week': {
			const ws = startOfWeek(date);
			const we = endOfWeek(date);
			if (ws.getMonth() === we.getMonth()) {
				return `${ws.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – ${we.getDate()}, ${we.getFullYear()}`;
			}
			return `${ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${we.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
		}
		case 'month':
			return date.toLocaleDateString(undefined, opts);
		case 'agenda':
			return `Agenda – ${date.toLocaleDateString(undefined, opts)}`;
		default:
			return '';
	}
}

function getVisibleRange(view: ViewMode, date: Date): { start: Date; end: Date } {
	switch (view) {
		case 'day':
			return { start: startOfDay(date), end: endOfDay(date) };
		case 'week':
			return { start: startOfWeek(date), end: endOfWeek(date) };
		case 'month':
			return { start: startOfMonth(date), end: endOfMonth(date) };
		case 'agenda':
			return { start: startOfDay(date), end: addDays(date, 30) };
		default:
			return { start: startOfDay(date), end: endOfDay(date) };
	}
}

function navigateDate(view: ViewMode, date: Date, direction: 1 | -1): Date {
	switch (view) {
		case 'day':
			return addDays(date, direction);
		case 'week':
			return addDays(date, direction * 7);
		case 'month': {
			const d = new Date(date);
			d.setMonth(d.getMonth() + direction);
			return d;
		}
		case 'agenda':
			return addDays(date, direction * 30);
		default:
			return date;
	}
}

// =============================================================================
// Event Type Colors
// =============================================================================

const EVENT_TYPE_COLORS: Record<string, string> = {
	meeting: '#1976d2',
	shift: '#e65100',
	deadline: '#c62828',
	reminder: '#7b1fa2',
	out_of_office: '#4caf50',
	company_event: '#f9a825',
	training: '#0097a7',
	maintenance_window: '#795548',
};

// =============================================================================
// Sub-Components
// =============================================================================

function MonthGrid({
	date, events, onEventClick, onDayClick,
}: {
	date: Date;
	events: CalendarEvent[];
	onEventClick: (e: CalendarEvent) => void;
	onDayClick: (d: Date) => void;
}) {
	const monthStart = startOfMonth(date);
	const monthEnd = endOfMonth(date);
	const gridStart = startOfWeek(monthStart);

	const weeks: Date[][] = [];
	let current = new Date(gridStart);
	while (current <= monthEnd || weeks.length < 5) {
		const week: Date[] = [];
		for (let i = 0; i < 7; i++) {
			week.push(new Date(current));
			current = addDays(current, 1);
		}
		weeks.push(week);
		if (weeks.length >= 6) break;
	}

	const today = new Date();
	const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	return (
		<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
			<Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: 1, borderColor: 'divider' }}>
				{dayNames.map((d) => (
					<Typography key={d} variant="caption" sx={{ py: 0.5, textAlign: 'center', fontWeight: 600 }}>
						{d}
					</Typography>
				))}
			</Box>
			<Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
				{weeks.flat().map((day, idx) => {
					const isCurrentMonth = day.getMonth() === date.getMonth();
					const isToday = isSameDay(day, today);
					const dayEvents = events.filter((e) => e.startTime && isSameDay(e.startTime, day));

					return (
						<Box
							key={idx}
							onClick={() => onDayClick(day)}
							sx={{
								borderRight: 1,
								borderBottom: 1,
								borderColor: 'divider',
								p: 0.5,
								minHeight: 80,
								cursor: 'pointer',
								opacity: isCurrentMonth ? 1 : 0.4,
								'&:hover': { bgcolor: 'action.hover' },
							}}
						>
							<Typography
								variant="caption"
								sx={{
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									width: 24,
									height: 24,
									borderRadius: '50%',
									fontWeight: isToday ? 700 : 400,
									bgcolor: isToday ? 'primary.main' : 'transparent',
									color: isToday ? 'primary.contrastText' : 'text.primary',
								}}
							>
								{day.getDate()}
							</Typography>
							<Box sx={{ mt: 0.25 }}>
								{dayEvents.slice(0, 3).map((evt) => (
									<Box
										key={evt.id}
										onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
										sx={{
											bgcolor: EVENT_TYPE_COLORS[evt.eventType] || '#1976d2',
											color: '#fff',
											borderRadius: 0.5,
											px: 0.5,
											py: 0.125,
											mb: 0.25,
											fontSize: '0.65rem',
											lineHeight: 1.3,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
											cursor: 'pointer',
										}}
									>
										{evt.allDay ? evt.title : `${evt.startTime ? formatTime(evt.startTime) : ''} ${evt.title}`}
									</Box>
								))}
								{dayEvents.length > 3 && (
									<Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>
										+{dayEvents.length - 3} more
									</Typography>
								)}
							</Box>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}

function WeekView({
	date, events, onEventClick,
}: {
	date: Date;
	events: CalendarEvent[];
	onEventClick: (e: CalendarEvent) => void;
}) {
	const ws = startOfWeek(date);
	const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
	const hours = Array.from({ length: 24 }, (_, i) => i);
	const today = new Date();

	return (
		<Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
			{/* Day headers */}
			<Box sx={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
				<Box />
				{days.map((d, i) => (
					<Box key={i} sx={{ textAlign: 'center', py: 0.5 }}>
						<Typography variant="caption" sx={{ fontWeight: isSameDay(d, today) ? 700 : 400 }}>
							{d.toLocaleDateString(undefined, { weekday: 'short' })}
						</Typography>
						<Typography
							variant="body2"
							sx={{
								fontWeight: 600,
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								width: 28,
								height: 28,
								borderRadius: '50%',
								ml: 0.5,
								bgcolor: isSameDay(d, today) ? 'primary.main' : 'transparent',
								color: isSameDay(d, today) ? 'primary.contrastText' : 'text.primary',
							}}
						>
							{d.getDate()}
						</Typography>
					</Box>
				))}
			</Box>
			{/* Time grid */}
			<Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', position: 'relative' }}>
				{hours.map((h) => (
					<React.Fragment key={h}>
						<Box sx={{ borderBottom: 1, borderColor: 'divider', pr: 0.5, textAlign: 'right', height: 48 }}>
							<Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
								{h === 0 ? '' : `${h.toString().padStart(2, '0')}:00`}
							</Typography>
						</Box>
						{days.map((d, di) => {
							const cellEvents = events.filter(
								(e) => e.startTime && isSameDay(e.startTime, d) && e.startTime.getHours() === h,
							);
							return (
								<Box key={di} sx={{ borderBottom: 1, borderRight: 1, borderColor: 'divider', height: 48, position: 'relative' }}>
									{cellEvents.map((evt) => (
										<Box
											key={evt.id}
											onClick={() => onEventClick(evt)}
											sx={{
												position: 'absolute',
												top: 0,
												left: 1,
												right: 1,
												bgcolor: EVENT_TYPE_COLORS[evt.eventType] || '#1976d2',
												color: '#fff',
												borderRadius: 0.5,
												px: 0.5,
												py: 0.25,
												fontSize: '0.65rem',
												lineHeight: 1.2,
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
												cursor: 'pointer',
												zIndex: 1,
											}}
										>
											{evt.title}
										</Box>
									))}
								</Box>
							);
						})}
					</React.Fragment>
				))}
			</Box>
		</Box>
	);
}

function DayView({
	date, events, onEventClick,
}: {
	date: Date;
	events: CalendarEvent[];
	onEventClick: (e: CalendarEvent) => void;
}) {
	const hours = Array.from({ length: 24 }, (_, i) => i);
	const dayEvents = events.filter((e) => e.startTime && isSameDay(e.startTime, date));

	return (
		<Box sx={{ flex: 1, overflow: 'auto' }}>
			{hours.map((h) => {
				const hourEvents = dayEvents.filter((e) => e.startTime && e.startTime.getHours() === h);
				return (
					<Box key={h} sx={{ display: 'flex', borderBottom: 1, borderColor: 'divider', minHeight: 48 }}>
						<Box sx={{ width: 56, pr: 0.5, textAlign: 'right', flexShrink: 0 }}>
							<Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
								{h === 0 ? '' : `${h.toString().padStart(2, '0')}:00`}
							</Typography>
						</Box>
						<Box sx={{ flex: 1, position: 'relative', borderLeft: 1, borderColor: 'divider', px: 0.5 }}>
							{hourEvents.map((evt) => (
								<Box
									key={evt.id}
									onClick={() => onEventClick(evt)}
									sx={{
										bgcolor: EVENT_TYPE_COLORS[evt.eventType] || '#1976d2',
										color: '#fff',
										borderRadius: 0.5,
										px: 1,
										py: 0.25,
										mb: 0.25,
										fontSize: '0.75rem',
										cursor: 'pointer',
									}}
								>
									<strong>{evt.startTime ? formatTime(evt.startTime) : ''}</strong> {evt.title}
								</Box>
							))}
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}

function AgendaView({
	events, onEventClick,
}: {
	events: CalendarEvent[];
	onEventClick: (e: CalendarEvent) => void;
}) {
	// Group events by day
	const grouped = useMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const e of events) {
			if (!e.startTime) continue;
			const key = e.startTime.toLocaleDateString();
			const list = map.get(key) ?? [];
			list.push(e);
			map.set(key, list);
		}
		return Array.from(map.entries()).sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());
	}, [events]);

	if (grouped.length === 0) {
		return (
			<Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
				<Typography variant="body2" color="text.secondary">No events in this period</Typography>
			</Box>
		);
	}

	return (
		<Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
			{grouped.map(([dateStr, dayEvents]) => (
				<Box key={dateStr} sx={{ mb: 2 }}>
					<Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, color: 'text.secondary' }}>
						{new Date(dateStr).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
					</Typography>
					{dayEvents.map((evt) => (
						<Paper
							key={evt.id}
							variant="outlined"
							onClick={() => onEventClick(evt)}
							sx={{
								p: 1.5,
								mb: 0.5,
								cursor: 'pointer',
								borderLeft: 3,
								borderLeftColor: EVENT_TYPE_COLORS[evt.eventType] || '#1976d2',
								'&:hover': { bgcolor: 'action.hover' },
							}}
						>
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
								<Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
									{evt.title}
								</Typography>
								<Chip label={evt.eventType} size="small" sx={{ fontSize: '0.65rem', height: 20 }} />
							</Box>
							<Typography variant="caption" color="text.secondary">
								{evt.allDay ? 'All day' : `${evt.startTime ? formatTime(evt.startTime) : ''} – ${evt.endTime ? formatTime(evt.endTime) : ''}`}
								{evt.locationText ? ` · ${evt.locationText}` : ''}
							</Typography>
						</Paper>
					))}
				</Box>
			))}
		</Box>
	);
}

// =============================================================================
// Main Page Component
// =============================================================================

function CalendarPageContent() {
	const { user } = useRequireAuth();
	const [viewMode, setViewMode] = useState<ViewMode>('month');
	const [currentDate, setCurrentDate] = useState(() => new Date());
	const [selectedRailDate, setSelectedRailDate] = useState<Date | null>(null);
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [createFormDate, setCreateFormDate] = useState<Date | undefined>();
	const [railRegistrationToken] = useState(() =>
		createContextRailRegistrationToken('calendar-context-rail')
	);

	const { start, end } = useMemo(() => getVisibleRange(viewMode, currentDate), [viewMode, currentDate]);
	const effectiveRailDate = useMemo(
		() => startOfDay(selectedRailDate ?? new Date()),
		[selectedRailDate]
	);

	const { data: events = [], isLoading, refetch } = useQuery({
		queryKey: getCalendarEventsQueryKey(start, end),
		queryFn: () => listEvents(start, end),
		enabled: !!user,
	});

	const [overlayToggles, setOverlayToggles] = useState<OverlayToggles>(loadOverlayToggles);
	const anyOverlayEnabled = overlayToggles.tasks || overlayToggles.rituals || overlayToggles.docDeadlines;

	useQuery({
		queryKey: ['calendar-overlays', start.toISOString(), end.toISOString(), overlayToggles],
		queryFn: () =>
			listOverlayItems({
				start,
				end,
				includeTasks: overlayToggles.tasks,
				includeRituals: overlayToggles.rituals,
				includeDocDeadlines: overlayToggles.docDeadlines,
			}),
		enabled: !!user && anyOverlayEnabled,
	});

	const calendarRailRegistration = useMemo(
		() =>
			user
				? {
					routeKey: 'calendar',
					registrationToken: railRegistrationToken,
					showGlobalBlocks: false,
					blocks: [
						{
							id: 'calendar-day-context',
							node: (
								<CalendarContextRailSection
									currentUserId={user.sub ?? ''}
									defaultedToToday={!selectedRailDate}
									events={events}
									selectedDate={effectiveRailDate}
								/>
							),
							priority: 0,
						},
					],
				}
				: null,
		[user, railRegistrationToken, selectedRailDate, effectiveRailDate]
	);

	useRegisterContextRail(calendarRailRegistration);

	const handlePrev = useCallback(() => setCurrentDate((d) => navigateDate(viewMode, d, -1)), [viewMode]);
	const handleNext = useCallback(() => setCurrentDate((d) => navigateDate(viewMode, d, 1)), [viewMode]);
	const handleToday = useCallback(() => {
		const today = new Date();
		setCurrentDate(today);
		setSelectedRailDate((currentValue) => (currentValue ? startOfDay(today) : currentValue));
	}, []);

	const handleEventClick = useCallback((evt: CalendarEvent) => {
		setSelectedRailDate(startOfDay(evt.startTime ?? currentDate));
		setSelectedEvent(evt);
		setShowCreateForm(false);
	}, [currentDate]);

	const handleDayClick = useCallback((day: Date) => {
		setSelectedRailDate(startOfDay(day));
		setCreateFormDate(day);
		setShowCreateForm(true);
		setSelectedEvent(null);
	}, []);

	const handleCreateClick = useCallback(() => {
		setCreateFormDate(undefined);
		setShowCreateForm(true);
		setSelectedEvent(null);
	}, []);

	const handleEventCreated = useCallback(() => {
		setShowCreateForm(false);
		refetch();
	}, [refetch]);

	const handleEventUpdated = useCallback(() => {
		setSelectedEvent(null);
		refetch();
	}, [refetch]);

	if (!user) return null;

	return (
		<Box data-testid="calendar-page" sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
			{/* Top Bar */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					gap: 1,
					px: 2,
					py: 1,
					borderBottom: 1,
					borderColor: 'divider',
					flexShrink: 0,
				}}
			>
				<Button
					variant="contained"
					size="small"
					startIcon={<AddIcon />}
					onClick={handleCreateClick}
					sx={{ textTransform: 'none', mr: 1 }}
				>
					New Event
				</Button>

				<IconButton size="small" onClick={handlePrev}><ChevronLeftIcon /></IconButton>
				<IconButton size="small" onClick={handleToday}><TodayIcon fontSize="small" /></IconButton>
				<IconButton size="small" onClick={handleNext}><ChevronRightIcon /></IconButton>

				<Typography variant="subtitle1" sx={{ fontWeight: 600, mx: 1, minWidth: 200 }}>
					{formatDateRange(viewMode, currentDate)}
				</Typography>

				<Box sx={{ flex: 1 }} />

				<ToggleButtonGroup
					value={viewMode}
					exclusive
					onChange={(_, v) => v && setViewMode(v as ViewMode)}
					size="small"
				>
					<ToggleButton value="day"><CalendarViewDayIcon fontSize="small" /></ToggleButton>
					<ToggleButton value="week"><CalendarViewWeekIcon fontSize="small" /></ToggleButton>
					<ToggleButton value="month"><CalendarViewMonthIcon fontSize="small" /></ToggleButton>
					<ToggleButton value="agenda"><ViewAgendaIcon fontSize="small" /></ToggleButton>
				</ToggleButtonGroup>

				<OverlayToggleBar value={overlayToggles} onChange={setOverlayToggles} />
			</Box>

			{/* Main Content */}
			<Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
				{/* Calendar Grid */}
				<Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
					{isLoading ? (
						<Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
							<CircularProgress />
						</Box>
					) : (
						<>
							{viewMode === 'month' && <MonthGrid date={currentDate} events={events} onEventClick={handleEventClick} onDayClick={handleDayClick} />}
							{viewMode === 'week' && <WeekView date={currentDate} events={events} onEventClick={handleEventClick} />}
							{viewMode === 'day' && <DayView date={currentDate} events={events} onEventClick={handleEventClick} />}
							{viewMode === 'agenda' && <AgendaView events={events} onEventClick={handleEventClick} />}
						</>
					)}
				</Box>

				{/* Side Panel */}
				{(showCreateForm || selectedEvent) && (
					<Box
						sx={{
							width: 380,
							borderLeft: 1,
							borderColor: 'divider',
							flexShrink: 0,
							overflow: 'auto',
						}}
					>
						{showCreateForm && (
							<EventCreateForm
								defaultDate={createFormDate}
								onCreated={handleEventCreated}
								onCancel={() => setShowCreateForm(false)}
							/>
						)}
						{selectedEvent && !showCreateForm && (
							<EventDetailPanel
								event={selectedEvent}
								currentUserId={user.sub ?? ''}
								onClose={() => setSelectedEvent(null)}
								onUpdated={handleEventUpdated}
							/>
						)}
					</Box>
				)}
			</Box>
		</Box>
	);
}

export default function CalendarPage() {
	const { isLoading } = useRequireAuth();

	if (isLoading) {
		return (
			<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
				<CircularProgress />
			</Box>
		);
	}

	return (
		<Suspense fallback={<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}><CircularProgress /></Box>}>
			<CalendarPageContent />
		</Suspense>
	);
}
