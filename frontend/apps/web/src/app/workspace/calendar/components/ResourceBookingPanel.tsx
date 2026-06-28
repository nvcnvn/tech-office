/**
 * ResourceBookingPanel Component
 * Resource browser for booking resources with events
 * Feature: 026-calendar-system (T037)
 *
 * Shows available resources with filter controls and add/remove to event.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
	Box,
	Typography,
	TextField,
	Select,
	MenuItem,
	FormControl,
	InputLabel,
	List,
	ListItem,
	ListItemText,
	IconButton,
	Chip,
	CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import { useQuery } from '@tanstack/react-query';
import { listResources, type CalendarResource } from 'apis';

interface ResourceBookingPanelProps {
	selectedResourceIds: string[];
	onChange: (ids: string[]) => void;
}

const RESOURCE_TYPES = [
	{ value: '', label: 'All Types' },
	{ value: 'room', label: 'Room' },
	{ value: 'vehicle', label: 'Vehicle' },
	{ value: 'equipment', label: 'Equipment' },
	{ value: 'desk', label: 'Desk' },
	{ value: 'lab', label: 'Lab' },
] as const;

export default function ResourceBookingPanel({ selectedResourceIds, onChange }: ResourceBookingPanelProps) {
	const [typeFilter, setTypeFilter] = useState('');
	const [minCapacity, setMinCapacity] = useState<number | ''>('');

	const { data: resources, isLoading } = useQuery({
		queryKey: ['calendar-resources', typeFilter, minCapacity],
		queryFn: () => listResources(typeFilter || undefined, typeof minCapacity === 'number' ? minCapacity : undefined),
	});

	const handleAdd = useCallback((id: string) => {
		if (!selectedResourceIds.includes(id)) {
			onChange([...selectedResourceIds, id]);
		}
	}, [selectedResourceIds, onChange]);

	const handleRemove = useCallback((id: string) => {
		onChange(selectedResourceIds.filter(rid => rid !== id));
	}, [selectedResourceIds, onChange]);

	const isSelected = (id: string) => selectedResourceIds.includes(id);

	return (
		<Box data-testid="resource-booking-panel" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
			<Typography variant="caption" color="text.secondary">Resources</Typography>

			<Box sx={{ display: 'flex', gap: 1 }}>
				<FormControl size="small" sx={{ flex: 1 }}>
					<InputLabel>Type</InputLabel>
					<Select value={typeFilter} label="Type" onChange={(e) => setTypeFilter(e.target.value)}>
						{RESOURCE_TYPES.map(t => (
							<MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
						))}
					</Select>
				</FormControl>

				<TextField
					label="Min Capacity"
					type="number"
					value={minCapacity}
					onChange={(e) => setMinCapacity(e.target.value ? Number(e.target.value) : '')}
					size="small"
					sx={{ width: 120 }}
					slotProps={{ inputLabel: { shrink: true } }}
				/>
			</Box>

			{isLoading && <CircularProgress size={20} />}

			{resources && resources.length > 0 && (
				<List dense disablePadding sx={{ maxHeight: 200, overflow: 'auto' }}>
					{resources.map(resource => (
						<ListItem
							key={resource.id}
							disableGutters
							sx={{ py: 0.25 }}
							secondaryAction={
								isSelected(resource.id) ? (
									<IconButton size="small" onClick={() => handleRemove(resource.id)} color="error">
										<RemoveIcon fontSize="small" />
									</IconButton>
								) : (
									<IconButton size="small" onClick={() => handleAdd(resource.id)} color="primary">
										<AddIcon fontSize="small" />
									</IconButton>
								)
							}
						>
							<ListItemText
								primary={
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
										<Typography variant="body2">{resource.name}</Typography>
										{isSelected(resource.id) && (
											<Chip label="Selected" size="small" color="primary" sx={{ height: 18, fontSize: 11 }} />
										)}
									</Box>
								}
								secondary={
									<Typography variant="caption" color="text.secondary">
										{resource.resourceType}{resource.capacity ? ` · Cap: ${resource.capacity}` : ''}
										{resource.location ? ` · ${resource.location}` : ''}
									</Typography>
								}
							/>
						</ListItem>
					))}
				</List>
			)}

			{resources && resources.length === 0 && !isLoading && (
				<Typography variant="caption" color="text.secondary">No resources found</Typography>
			)}
		</Box>
	);
}
