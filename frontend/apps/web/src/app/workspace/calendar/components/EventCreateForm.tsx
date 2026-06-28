/**
 * EventCreateForm Component
 * Form for creating a new calendar event
 * Feature: 026-calendar-system (T022)
 *
 * Fields: title, description, event_type, visibility, start/end datetime,
 * all_day toggle, location_text, virtual_link, attendees
 */

'use client';

import React, { useState, useCallback } from 'react';
import {
	Box,
	Typography,
	TextField,
	Button,
	Select,
	MenuItem,
	FormControl,
	InputLabel,
	FormControlLabel,
	Switch,
	IconButton,
	Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useMutation } from '@tanstack/react-query';
import { createEvent, type CreateEventInput, type EventType, type EventVisibility } from 'apis';
import AttendeeSelector from './AttendeeSelector';
import RecurrenceSelector from './RecurrenceSelector';
import ResourceBookingPanel from './ResourceBookingPanel';

interface EventCreateFormProps {
	defaultDate?: Date;
	onCreated: () => void;
	onCancel: () => void;
}

function roundToNext15(date: Date): Date {
	const d = new Date(date);
	const mins = d.getMinutes();
	d.setMinutes(Math.ceil(mins / 15) * 15, 0, 0);
	return d;
}

function toDatetimeLocalString(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function EventCreateForm({ defaultDate, onCreated, onCancel }: EventCreateFormProps) {
	const defaultStart = defaultDate ? new Date(defaultDate.getFullYear(), defaultDate.getMonth(), defaultDate.getDate(), 9, 0) : roundToNext15(new Date());
	const defaultEnd = new Date(defaultStart.getTime() + 60 * 60 * 1000); // +1 hour

	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [eventType, setEventType] = useState<EventType>('meeting');
	const [visibility, setVisibility] = useState<EventVisibility>('team');
	const [startTime, setStartTime] = useState(toDatetimeLocalString(defaultStart));
	const [endTime, setEndTime] = useState(toDatetimeLocalString(defaultEnd));
	const [allDay, setAllDay] = useState(false);
	const [locationText, setLocationText] = useState('');
	const [virtualLink, setVirtualLink] = useState('');
	const [requiredAttendeeIds, setRequiredAttendeeIds] = useState<string[]>([]);
	const [optionalAttendeeIds, setOptionalAttendeeIds] = useState<string[]>([]);
	const [recurrenceRule, setRecurrenceRule] = useState('');
	const [resourceIds, setResourceIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);

	const createMutation = useMutation({
		mutationFn: (input: CreateEventInput) => createEvent(input),
		onSuccess: () => onCreated(),
		onError: (err: Error) => setError(err.message),
	});

	const handleSubmit = useCallback(() => {
		if (!title.trim()) {
			setError('Title is required');
			return;
		}
		setError(null);
		createMutation.mutate({
			title: title.trim(),
			description: description.trim(),
			eventType,
			visibility,
			startTime: new Date(startTime),
			endTime: new Date(endTime),
			allDay,
			locationText: locationText.trim(),
			virtualLink: virtualLink.trim(),
			recurrenceRule: recurrenceRule || undefined,
			requiredAttendeeIds,
			optionalAttendeeIds,
			resourceIds: resourceIds.length > 0 ? resourceIds : undefined,
		});
	}, [title, description, eventType, visibility, startTime, endTime, allDay, locationText, virtualLink, recurrenceRule, requiredAttendeeIds, optionalAttendeeIds, resourceIds, createMutation]);

	return (
		<Box data-testid="event-create-form" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
			<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<Typography variant="subtitle1" sx={{ fontWeight: 600 }}>New Event</Typography>
				<IconButton size="small" onClick={onCancel}><CloseIcon fontSize="small" /></IconButton>
			</Box>

			{error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

			<TextField
				label="Title"
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				size="small"
				fullWidth
				required
				autoFocus
			/>

			<TextField
				label="Description"
				value={description}
				onChange={(e) => setDescription(e.target.value)}
				size="small"
				fullWidth
				multiline
				rows={2}
			/>

			<Box sx={{ display: 'flex', gap: 1 }}>
				<FormControl size="small" sx={{ flex: 1 }}>
					<InputLabel>Type</InputLabel>
					<Select value={eventType} label="Type" onChange={(e) => setEventType(e.target.value as EventType)}>
						<MenuItem value="meeting">Meeting</MenuItem>
						<MenuItem value="shift">Shift</MenuItem>
						<MenuItem value="deadline">Deadline</MenuItem>
						<MenuItem value="reminder">Reminder</MenuItem>
						<MenuItem value="out_of_office">Out of Office</MenuItem>
						<MenuItem value="company_event">Company Event</MenuItem>
						<MenuItem value="training">Training</MenuItem>
						<MenuItem value="maintenance_window">Maintenance</MenuItem>
					</Select>
				</FormControl>

				<FormControl size="small" sx={{ flex: 1 }}>
					<InputLabel>Visibility</InputLabel>
					<Select value={visibility} label="Visibility" onChange={(e) => setVisibility(e.target.value as EventVisibility)}>
						<MenuItem value="private">Private</MenuItem>
						<MenuItem value="personal_shared">Free/Busy</MenuItem>
						<MenuItem value="team">Team</MenuItem>
						<MenuItem value="org_wide">Organization</MenuItem>
					</Select>
				</FormControl>
			</Box>

			<FormControlLabel
				control={<Switch checked={allDay} onChange={(e) => setAllDay(e.target.checked)} size="small" />}
				label="All day"
			/>

			{!allDay && (
				<Box sx={{ display: 'flex', gap: 1 }}>
					<TextField
						label="Start"
						type="datetime-local"
						value={startTime}
						onChange={(e) => setStartTime(e.target.value)}
						size="small"
						fullWidth
						slotProps={{ inputLabel: { shrink: true } }}
					/>
					<TextField
						label="End"
						type="datetime-local"
						value={endTime}
						onChange={(e) => setEndTime(e.target.value)}
						size="small"
						fullWidth
						slotProps={{ inputLabel: { shrink: true } }}
					/>
				</Box>
			)}

			{allDay && (
				<Box sx={{ display: 'flex', gap: 1 }}>
					<TextField
						label="Date"
						type="date"
						value={startTime.split('T')[0]}
						onChange={(e) => {
							setStartTime(`${e.target.value}T00:00`);
							setEndTime(`${e.target.value}T23:59`);
						}}
						size="small"
						fullWidth
						slotProps={{ inputLabel: { shrink: true } }}
					/>
				</Box>
			)}

			<TextField
				label="Location"
				value={locationText}
				onChange={(e) => setLocationText(e.target.value)}
				size="small"
				fullWidth
				placeholder="Room name, address, or leave blank"
			/>

			<TextField
				label="Virtual Link"
				value={virtualLink}
				onChange={(e) => setVirtualLink(e.target.value)}
				size="small"
				fullWidth
				placeholder="Meeting URL (Zoom, Meet, etc.)"
			/>

			<RecurrenceSelector value={recurrenceRule} onChange={setRecurrenceRule} />

			<ResourceBookingPanel selectedResourceIds={resourceIds} onChange={setResourceIds} />

			<AttendeeSelector
				label="Required Attendees"
				selectedIds={requiredAttendeeIds}
				onChange={setRequiredAttendeeIds}
			/>

			<AttendeeSelector
				label="Optional Attendees"
				selectedIds={optionalAttendeeIds}
				onChange={setOptionalAttendeeIds}
			/>

			<Button
				variant="contained"
				onClick={handleSubmit}
				disabled={createMutation.isPending || !title.trim()}
				sx={{ textTransform: 'none', mt: 1 }}
			>
				{createMutation.isPending ? 'Creating...' : 'Create Event'}
			</Button>
		</Box>
	);
}
