/**
 * AttendeeSelector Component
 * Employee search typeahead for selecting event attendees
 * Feature: 026-calendar-system (T023)
 *
 * Uses autocompleteEmployees for quick prefix-based search.
 * Shows selected attendees as chips.
 */

'use client';

import React, { useState, useCallback } from 'react';
import {
	Box,
	TextField,
	Chip,
	List,
	ListItem,
	ListItemText,
	Paper,
	Typography,
	ClickAwayListener,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import { autocompleteEmployees, type EmployeeSuggestion } from 'apis';

interface AttendeeSelectorProps {
	label: string;
	selectedIds: string[];
	onChange: (ids: string[]) => void;
}

interface SelectedEmployee {
	id: string;
	name: string;
}

export default function AttendeeSelector({ label, selectedIds, onChange }: AttendeeSelectorProps) {
	const [query, setQuery] = useState('');
	const [suggestions, setSuggestions] = useState<EmployeeSuggestion[]>([]);
	const [showDropdown, setShowDropdown] = useState(false);
	const [selected, setSelected] = useState<SelectedEmployee[]>([]);

	const handleInputChange = useCallback(async (value: string) => {
		setQuery(value);
		if (value.trim().length < 2) {
			setSuggestions([]);
			setShowDropdown(false);
			return;
		}
		try {
			const results = await autocompleteEmployees(value.trim(), 10);
			// Filter out already-selected employees
			const filtered = results.filter(r => !selectedIds.includes(r.id));
			setSuggestions(filtered);
			setShowDropdown(filtered.length > 0);
		} catch {
			setSuggestions([]);
			setShowDropdown(false);
		}
	}, [selectedIds]);

	const handleSelect = useCallback((emp: EmployeeSuggestion) => {
		const newIds = [...selectedIds, emp.id];
		const name = `${emp.givenName} ${emp.familyName}`.trim() || emp.email;
		setSelected(prev => [...prev, { id: emp.id, name }]);
		onChange(newIds);
		setQuery('');
		setSuggestions([]);
		setShowDropdown(false);
	}, [selectedIds, onChange]);

	const handleRemove = useCallback((id: string) => {
		onChange(selectedIds.filter(sid => sid !== id));
		setSelected(prev => prev.filter(s => s.id !== id));
	}, [selectedIds, onChange]);

	return (
		<Box data-testid="attendee-selector" sx={{ position: 'relative' }}>
			<Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
				{label}
			</Typography>

			{selected.length > 0 && (
				<Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
					{selected.map(emp => (
						<Chip
							key={emp.id}
							label={emp.name}
							size="small"
							icon={<PersonIcon />}
							onDelete={() => handleRemove(emp.id)}
						/>
					))}
				</Box>
			)}

			<ClickAwayListener onClickAway={() => setShowDropdown(false)}>
				<Box>
					<TextField
						value={query}
						onChange={(e) => handleInputChange(e.target.value)}
						onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
						placeholder="Search employees..."
						size="small"
						fullWidth
					/>
					{showDropdown && (
						<Paper
							sx={{
								position: 'absolute',
								zIndex: 10,
								width: '100%',
								maxHeight: 200,
								overflow: 'auto',
								mt: 0.5,
							}}
							elevation={0}
						>
							<List dense disablePadding>
								{suggestions.map(emp => (
									<ListItem
										key={emp.id}
										onClick={() => handleSelect(emp)}
										sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
									>
										<ListItemText
											primary={`${emp.givenName} ${emp.familyName}`.trim()}
											secondary={emp.email}
										/>
									</ListItem>
								))}
							</List>
						</Paper>
					)}
				</Box>
			</ClickAwayListener>
		</Box>
	);
}
