/**
 * ScheduleChangeConfirmDialog
 * Shows impact preview and confirmation for changing a ritual definition's recurrence schedule.
 * Feature: 023-ritual-tasks-improvement-lazy-resource
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Button,
	Typography,
	Box,
	Alert,
	CircularProgress,
	Select,
	MenuItem,
	FormControl,
	InputLabel,
	Chip,
	ToggleButton,
	ToggleButtonGroup,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
	getScheduleChangeImpact,
	changeRitualDefinitionSchedule,
	type RecurrenceRule,
	type RecurrenceType,
	type RitualDefinition,
	type ScheduleChangeImpact,
} from 'apis';

interface ScheduleChangeConfirmDialogProps {
	open: boolean;
	onClose: () => void;
	definition: RitualDefinition;
	onSuccess: (updated: RitualDefinition) => void;
}

const DAYS_OF_WEEK = [
	{ value: 1, label: 'Mon' },
	{ value: 2, label: 'Tue' },
	{ value: 3, label: 'Wed' },
	{ value: 4, label: 'Thu' },
	{ value: 5, label: 'Fri' },
	{ value: 6, label: 'Sat' },
	{ value: 7, label: 'Sun' },
];

export default function ScheduleChangeConfirmDialog({
	open,
	onClose,
	definition,
	onSuccess,
}: ScheduleChangeConfirmDialogProps) {
	const currentRule = definition.recurrenceRule;

	const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>(
		currentRule?.type ?? 'daily'
	);
	const [interval, setInterval] = useState(currentRule?.interval ?? 1);
	const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
		currentRule?.daysOfWeek ?? [1]
	);
	const [dayOfMonth, setDayOfMonth] = useState(currentRule?.dayOfMonth ?? 1);

	const [impact, setImpact] = useState<ScheduleChangeImpact | null>(null);
	const [impactLoading, setImpactLoading] = useState(false);
	const [impactError, setImpactError] = useState<string | null>(null);
	const [applying, setApplying] = useState(false);
	const [applyError, setApplyError] = useState<string | null>(null);

	const buildRule = useCallback((): RecurrenceRule => {
		return {
			type: recurrenceType,
			interval,
			daysOfWeek: recurrenceType === 'weekly' ? daysOfWeek : [],
			dayOfMonth: recurrenceType === 'monthly' ? dayOfMonth : 0,
		};
	}, [recurrenceType, interval, daysOfWeek, dayOfMonth]);

	// Debounced impact preview
	useEffect(() => {
		if (!open) return;
		const rule = buildRule();
		const timer = setTimeout(async () => {
			setImpactLoading(true);
			setImpactError(null);
			try {
				const result = await getScheduleChangeImpact(definition.id, rule);
				setImpact(result);
			} catch (err) {
				setImpactError(
					err instanceof Error ? err.message : 'Failed to load impact preview'
				);
			} finally {
				setImpactLoading(false);
			}
		}, 400);
		return () => clearTimeout(timer);
	}, [open, definition.id, buildRule]);

	const handleApply = async () => {
		setApplying(true);
		setApplyError(null);
		try {
			const result = await changeRitualDefinitionSchedule(
				definition.id,
				buildRule(),
				true
			);
			onSuccess(result.ritualDefinition);
			onClose();
		} catch (err) {
			setApplyError(
				err instanceof Error ? err.message : 'Failed to apply schedule change'
			);
		} finally {
			setApplying(false);
		}
	};

	return (
		<Dialog
			open={open}
			onClose={onClose}
			maxWidth="sm"
			fullWidth
			data-testid="schedule-change-dialog"
		>
			<DialogTitle>Change Recurrence Schedule</DialogTitle>
			<DialogContent>
				<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
					Changing the schedule for <strong>{definition.name}</strong>.
					Untouched future instances will be removed and new ones generated.
				</Typography>

				{/* Recurrence Type Selector */}
				<FormControl fullWidth size="small" sx={{ mb: 2 }}>
					<InputLabel>Recurrence Type</InputLabel>
					<Select
						value={recurrenceType}
						label="Recurrence Type"
						onChange={(e) =>
							setRecurrenceType(e.target.value as RecurrenceType)
						}
						data-testid="schedule-recurrence-type"
					>
						<MenuItem value="daily">Daily</MenuItem>
						<MenuItem value="weekly">Weekly</MenuItem>
						<MenuItem value="monthly">Monthly</MenuItem>
					</Select>
				</FormControl>

				{/* Interval */}
				<FormControl fullWidth size="small" sx={{ mb: 2 }}>
					<InputLabel>Interval</InputLabel>
					<Select
						value={interval}
						label="Interval"
						onChange={(e) => setInterval(Number(e.target.value))}
						data-testid="schedule-interval"
					>
						{[1, 2, 3, 4, 5, 6].map((v) => (
							<MenuItem key={v} value={v}>
								Every {v === 1 ? '' : v + ' '}
								{recurrenceType === 'daily'
									? v === 1
										? 'day'
										: 'days'
									: recurrenceType === 'weekly'
									? v === 1
										? 'week'
										: 'weeks'
									: v === 1
									? 'month'
									: 'months'}
							</MenuItem>
						))}
					</Select>
				</FormControl>

				{/* Days of Week (weekly only) */}
				{recurrenceType === 'weekly' && (
					<Box sx={{ mb: 2 }}>
						<Typography variant="body2" sx={{ mb: 0.5 }}>
							Days of week
						</Typography>
						<ToggleButtonGroup
							value={daysOfWeek}
							onChange={(_, newDays) => {
								if (newDays.length > 0) setDaysOfWeek(newDays);
							}}
							size="small"
							data-testid="schedule-days-of-week"
						>
							{DAYS_OF_WEEK.map((d) => (
								<ToggleButton key={d.value} value={d.value}>
									{d.label}
								</ToggleButton>
							))}
						</ToggleButtonGroup>
					</Box>
				)}

				{/* Day of Month (monthly only) */}
				{recurrenceType === 'monthly' && (
					<FormControl fullWidth size="small" sx={{ mb: 2 }}>
						<InputLabel>Day of Month</InputLabel>
						<Select
							value={dayOfMonth}
							label="Day of Month"
							onChange={(e) => setDayOfMonth(Number(e.target.value))}
							data-testid="schedule-day-of-month"
						>
							{Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
								<MenuItem key={d} value={d}>
									{d}
								</MenuItem>
							))}
						</Select>
					</FormControl>
				)}

				{/* Impact Preview */}
				<Box
					sx={{
						p: 2,
						borderRadius: 1,
						bgcolor: 'action.hover',
						mt: 1,
					}}
					data-testid="schedule-impact-preview"
				>
					<Typography
						variant="subtitle2"
						sx={{ fontWeight: 600, mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}
					>
						<WarningAmberIcon fontSize="small" color="warning" />
						Impact Preview
					</Typography>

					{impactLoading ? (
						<Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
							<CircularProgress size={20} />
						</Box>
					) : impactError ? (
						<Alert severity="error" sx={{ py: 0 }}>
							{impactError}
						</Alert>
					) : impact ? (
						<Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
							<Chip
								label={`${impact.instancesToRemove} removed`}
								size="small"
								color="error"
								variant="outlined"
								data-testid="impact-remove-count"
							/>
							<Chip
								label={`${impact.instancesToDetach} detached`}
								size="small"
								color="warning"
								variant="outlined"
								data-testid="impact-detach-count"
							/>
							<Chip
								label={`${impact.instancesToCreate} new`}
								size="small"
								color="success"
								variant="outlined"
								data-testid="impact-create-count"
							/>
						</Box>
					) : null}
				</Box>

				{applyError && (
					<Alert severity="error" sx={{ mt: 2 }}>
						{applyError}
					</Alert>
				)}
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={applying}>
					Cancel
				</Button>
				<Button
					onClick={handleApply}
					variant="contained"
					color="warning"
					disabled={applying || impactLoading}
					data-testid="schedule-change-confirm-btn"
				>
					{applying ? <CircularProgress size={20} /> : 'Apply Schedule Change'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
