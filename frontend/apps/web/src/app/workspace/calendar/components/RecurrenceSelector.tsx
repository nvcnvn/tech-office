/**
 * RecurrenceSelector Component
 * RRULE builder UI for creating recurring events
 * Feature: 026-calendar-system (T030)
 *
 * Outputs an RFC 5545 RRULE string.
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
	Box,
	Typography,
	Select,
	MenuItem,
	FormControl,
	InputLabel,
	TextField,
	FormControlLabel,
	Checkbox,
	RadioGroup,
	Radio,
	FormLabel,
} from '@mui/material';

export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export type EndCondition = 'never' | 'until' | 'count';

const DAYS_OF_WEEK = [
	{ label: 'Mon', value: 'MO' },
	{ label: 'Tue', value: 'TU' },
	{ label: 'Wed', value: 'WE' },
	{ label: 'Thu', value: 'TH' },
	{ label: 'Fri', value: 'FR' },
	{ label: 'Sat', value: 'SA' },
	{ label: 'Sun', value: 'SU' },
] as const;

interface RecurrenceSelectorProps {
	value: string; // current RRULE string
	onChange: (rrule: string) => void;
}

function toDateString(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function RecurrenceSelector({ value, onChange }: RecurrenceSelectorProps) {
	const [frequency, setFrequency] = useState<RecurrenceFrequency>('none');
	const [interval, setInterval] = useState(1);
	const [selectedDays, setSelectedDays] = useState<string[]>([]);
	const [endCondition, setEndCondition] = useState<EndCondition>('never');
	const [untilDate, setUntilDate] = useState('');
	const [count, setCount] = useState(10);

	// Parse initial value on mount.
	useEffect(() => {
		if (!value) {
			setFrequency('none');
			return;
		}
		// Basic parse — just detect frequency.
		if (value.includes('FREQ=DAILY')) setFrequency('daily');
		else if (value.includes('INTERVAL=2') && value.includes('FREQ=WEEKLY')) setFrequency('biweekly');
		else if (value.includes('FREQ=WEEKLY')) setFrequency('weekly');
		else if (value.includes('FREQ=MONTHLY')) setFrequency('monthly');
		else if (value.includes('FREQ=YEARLY')) setFrequency('yearly');
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const buildRRule = useCallback(() => {
		if (frequency === 'none') return '';

		const parts: string[] = [];

		switch (frequency) {
			case 'daily':
				parts.push('FREQ=DAILY');
				if (interval > 1) parts.push(`INTERVAL=${interval}`);
				break;
			case 'weekly':
				parts.push('FREQ=WEEKLY');
				if (interval > 1) parts.push(`INTERVAL=${interval}`);
				if (selectedDays.length > 0) parts.push(`BYDAY=${selectedDays.join(',')}`);
				break;
			case 'biweekly':
				parts.push('FREQ=WEEKLY');
				parts.push('INTERVAL=2');
				if (selectedDays.length > 0) parts.push(`BYDAY=${selectedDays.join(',')}`);
				break;
			case 'monthly':
				parts.push('FREQ=MONTHLY');
				if (interval > 1) parts.push(`INTERVAL=${interval}`);
				break;
			case 'yearly':
				parts.push('FREQ=YEARLY');
				if (interval > 1) parts.push(`INTERVAL=${interval}`);
				break;
		}

		if (endCondition === 'until' && untilDate) {
			const d = untilDate.replace(/-/g, '');
			parts.push(`UNTIL=${d}T235959Z`);
		} else if (endCondition === 'count' && count > 0) {
			parts.push(`COUNT=${count}`);
		}

		return parts.join(';');
	}, [frequency, interval, selectedDays, endCondition, untilDate, count]);

	useEffect(() => {
		const rule = buildRRule();
		if (rule !== value) {
			onChange(rule);
		}
	}, [buildRRule]); // eslint-disable-line react-hooks/exhaustive-deps

	const toggleDay = (day: string) => {
		setSelectedDays(prev =>
			prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
		);
	};

	return (
		<Box data-testid="recurrence-selector" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
			<FormControl size="small" fullWidth>
				<InputLabel>Repeat</InputLabel>
				<Select
					value={frequency}
					label="Repeat"
					onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
				>
					<MenuItem value="none">Does not repeat</MenuItem>
					<MenuItem value="daily">Daily</MenuItem>
					<MenuItem value="weekly">Weekly</MenuItem>
					<MenuItem value="biweekly">Every 2 weeks</MenuItem>
					<MenuItem value="monthly">Monthly</MenuItem>
					<MenuItem value="yearly">Annually</MenuItem>
				</Select>
			</FormControl>

			{frequency !== 'none' && frequency !== 'biweekly' && (
				<TextField
					label="Every"
					type="number"
					value={interval}
					onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value) || 1))}
					size="small"
					slotProps={{ htmlInput: { min: 1, max: 365 } }}
					helperText={frequency === 'daily' ? 'days' : frequency === 'weekly' ? 'weeks' : frequency === 'monthly' ? 'months' : 'years'}
					sx={{ maxWidth: 150 }}
				/>
			)}

			{(frequency === 'weekly' || frequency === 'biweekly') && (
				<Box>
					<Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
						Repeat on
					</Typography>
					<Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
						{DAYS_OF_WEEK.map(({ label, value: day }) => (
							<FormControlLabel
								key={day}
								control={
									<Checkbox
										size="small"
										checked={selectedDays.includes(day)}
										onChange={() => toggleDay(day)}
									/>
								}
								label={label}
								sx={{ mr: 0 }}
							/>
						))}
					</Box>
				</Box>
			)}

			{frequency !== 'none' && (
				<Box>
					<FormControl component="fieldset" size="small">
						<FormLabel component="legend" sx={{ fontSize: '0.75rem' }}>Ends</FormLabel>
						<RadioGroup
							value={endCondition}
							onChange={(e) => setEndCondition(e.target.value as EndCondition)}
						>
							<FormControlLabel value="never" control={<Radio size="small" />} label="Never" />
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
								<FormControlLabel value="until" control={<Radio size="small" />} label="On" />
								{endCondition === 'until' && (
									<TextField
										type="date"
										value={untilDate}
										onChange={(e) => setUntilDate(e.target.value)}
										size="small"
										slotProps={{ inputLabel: { shrink: true } }}
										sx={{ maxWidth: 180 }}
									/>
								)}
							</Box>
							<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
								<FormControlLabel value="count" control={<Radio size="small" />} label="After" />
								{endCondition === 'count' && (
									<TextField
										type="number"
										value={count}
										onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
										size="small"
										slotProps={{ htmlInput: { min: 1, max: 999 } }}
										sx={{ maxWidth: 100 }}
										helperText="occurrences"
									/>
								)}
							</Box>
						</RadioGroup>
					</FormControl>
				</Box>
			)}
		</Box>
	);
}
