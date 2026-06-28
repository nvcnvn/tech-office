/**
 * Overlay Toggle Bar
 * Toggles for showing/hiding overlay domains (tasks, rituals, doc deadlines)
 * on the calendar view. Persists toggle state in localStorage.
 * Feature: 026-calendar-system (T053)
 */

'use client';

import React, { useCallback } from 'react';
import { Box, Chip } from '@mui/material';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import RepeatIcon from '@mui/icons-material/Repeat';
import DescriptionIcon from '@mui/icons-material/Description';

// =============================================================================
// Types
// =============================================================================

export interface OverlayToggles {
	tasks: boolean;
	rituals: boolean;
	docDeadlines: boolean;
}

interface OverlayToggleBarProps {
	value: OverlayToggles;
	onChange: (next: OverlayToggles) => void;
}

// =============================================================================
// LocalStorage helpers
// =============================================================================

const STORAGE_KEY = 'calendar-overlay-toggles';

export function loadOverlayToggles(): OverlayToggles {
	if (typeof window === 'undefined') {
		return { tasks: false, rituals: false, docDeadlines: false };
	}
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw) as OverlayToggles;
	} catch {
		// ignore
	}
	return { tasks: false, rituals: false, docDeadlines: false };
}

export function saveOverlayToggles(toggles: OverlayToggles): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(toggles));
	} catch {
		// ignore
	}
}

// =============================================================================
// Component
// =============================================================================

export default function OverlayToggleBar({ value, onChange }: OverlayToggleBarProps) {
	const toggle = useCallback(
		(key: keyof OverlayToggles) => {
			const next = { ...value, [key]: !value[key] };
			saveOverlayToggles(next);
			onChange(next);
		},
		[value, onChange],
	);

	return (
		<Box data-testid="overlay-toggle-bar" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
			<Chip
				icon={<TaskAltIcon />}
				label="Tasks"
				variant={value.tasks ? 'filled' : 'outlined'}
				color={value.tasks ? 'primary' : 'default'}
				onClick={() => toggle('tasks')}
				size="small"
			/>
			<Chip
				icon={<RepeatIcon />}
				label="Rituals"
				variant={value.rituals ? 'filled' : 'outlined'}
				color={value.rituals ? 'secondary' : 'default'}
				onClick={() => toggle('rituals')}
				size="small"
			/>
			<Chip
				icon={<DescriptionIcon />}
				label="Doc Deadlines"
				variant={value.docDeadlines ? 'filled' : 'outlined'}
				color={value.docDeadlines ? 'info' : 'default'}
				onClick={() => toggle('docDeadlines')}
				size="small"
			/>
		</Box>
	);
}
