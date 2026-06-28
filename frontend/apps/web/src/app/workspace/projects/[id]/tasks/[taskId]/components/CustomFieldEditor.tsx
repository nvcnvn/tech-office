/**
 * CustomFieldEditor Component
 * Feature: 017-realtime-task-collaboration-system
 * 
 * Displays and allows editing of custom field values on task detail page
 * Supports all 7 field types: text, number, single_select, multi_select, date, user, checkbox
 */

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
	Box,
	Typography,
	TextField,
	Select,
	MenuItem,
	FormControl,
	Checkbox,
	FormControlLabel,
	CircularProgress,
	Chip,
	Autocomplete,
	type TextFieldProps,
} from '@mui/material';
import { useThemeColors } from '@/theme/useThemeColors';
import {
	setCustomFieldValue,
	type CustomFieldDefinition,
	type CustomFieldValue,
	type CustomFieldType,
} from 'apis';

// =============================================================================
// Props
// =============================================================================

interface CustomFieldEditorProps {
	taskId: string;
	field: CustomFieldDefinition;
	currentValue?: CustomFieldValue;
	onValueChanged: (fieldId: string, newValue: unknown) => void;
	disabled?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

function parseFieldValue(fieldType: CustomFieldType, value: unknown): unknown {
	if (value === null || value === undefined) return null;
	
	switch (fieldType) {
		case 'text':
			return String(value);
		case 'number':
			return typeof value === 'number' ? value : parseFloat(String(value));
		case 'single_select':
			return String(value);
		case 'multi_select':
			if (Array.isArray(value)) return value.map(String);
			return [String(value)];
		case 'date':
			return String(value); // ISO date string
		case 'user':
			return String(value); // employee ID
		case 'checkbox':
			return Boolean(value);
		default:
			return value;
	}
}

function formatDateForInput(dateStr: string | undefined): string {
	if (!dateStr) return '';
	try {
		const d = new Date(dateStr);
		return d.toISOString().split('T')[0];
	} catch {
		return '';
	}
}

// =============================================================================
// Main Component
// =============================================================================

export default function CustomFieldEditor({
	taskId,
	field,
	currentValue,
	onValueChanged,
	disabled = false,
}: CustomFieldEditorProps) {
	const colors = useThemeColors();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	
	// Local state for text/number fields (for debouncing)
	const [localTextValue, setLocalTextValue] = useState<string>('');
	const [localNumberValue, setLocalNumberValue] = useState<string>('');
	
	// Debounce timer ref
	const debounceTimer = useRef<NodeJS.Timeout | null>(null);

	// Get current value from currentValue prop or use default
	const value = currentValue?.value ?? field.defaultValue ?? null;

	// Initialize local values when currentValue changes
	useEffect(() => {
		if (field.fieldType === 'text') {
			setLocalTextValue(String(value || ''));
		} else if (field.fieldType === 'number') {
			setLocalNumberValue(typeof value === 'number' ? String(value) : '');
		}
	}, [field.fieldType, value]);

	// Cleanup debounce timer on unmount
	useEffect(() => {
		return () => {
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current);
			}
		};
	}, []);

	// Handle value change with API call
	const handleValueChange = useCallback(
		async (newValue: unknown) => {
			console.log(`[CustomFieldEditor ${field.name}] handleValueChange called with:`, newValue);
			setSaving(true);
			setError(null);

			try {
				// Parse value based on field type
				const parsedValue = parseFieldValue(field.fieldType, newValue);
				console.log(`[CustomFieldEditor ${field.name}] Parsed value:`, parsedValue);

				// Call API to save value
				console.log(`[CustomFieldEditor ${field.name}] Calling API with taskId=${taskId}, fieldId=${field.id}`);
				const response = await setCustomFieldValue(taskId, field.id, parsedValue);
				console.log(`[CustomFieldEditor ${field.name}] API response:`, response);
				console.log(`[CustomFieldEditor ${field.name}] API response task customFieldValues:`, response.task.customFieldValues);

				// Notify parent component
				onValueChanged(field.id, parsedValue);
				console.log(`[CustomFieldEditor ${field.name}] Parent notified of change`);
			} catch (err) {
				console.error(`[CustomFieldEditor ${field.name}] Failed to save:`, err);
				setError(err instanceof Error ? err.message : 'Failed to save field value');
			} finally {
				setSaving(false);
			}
		},
		[taskId, field.id, field.fieldType, field.name, onValueChanged]
	);

	// Debounced change handler for text/number fields
	const handleDebouncedChange = useCallback(
		(newValue: unknown) => {
			// Clear existing timer
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current);
			}

			// Set new timer
			debounceTimer.current = setTimeout(() => {
				handleValueChange(newValue);
			}, 500); // 500ms debounce
		},
		[handleValueChange]
	);

	// Render different input based on field type
	const renderFieldInput = () => {
		if (saving) {
			return (
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<CircularProgress size={16} />
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						Saving...
					</Typography>
				</Box>
			);
		}

		switch (field.fieldType) {
			case 'text':
				return (
					<TextField
						fullWidth
						size="small"
						value={localTextValue}
						onChange={(e) => {
							setLocalTextValue(e.target.value);
							handleDebouncedChange(e.target.value);
						}}
						placeholder={field.description || `Enter ${field.name.toLowerCase()}`}
						disabled={disabled}
						error={!!error}
						helperText={error}
						data-testid={`custom-field-${field.id}-text-input`}
					/>
				);

			case 'number':
				return (
					<TextField
						fullWidth
						size="small"
						type="number"
						value={localNumberValue}
						onChange={(e) => {
							setLocalNumberValue(e.target.value);
							const numValue = e.target.value ? parseFloat(e.target.value) : null;
							handleDebouncedChange(numValue);
						}}
						placeholder={field.description || `Enter ${field.name.toLowerCase()}`}
						disabled={disabled}
						error={!!error}
						helperText={error}
						inputProps={{
							min: field.minValue,
							max: field.maxValue,
							step: 'any',
						}}
						data-testid={`custom-field-${field.id}-number-input`}
					/>
				);

			case 'single_select': {
				// Ensure value is a string that exists in options
				const stringValue = value ? String(value) : '';
				const selectedValue = field.options.includes(stringValue) ? stringValue : '';
				
				return (
					<FormControl fullWidth size="small" error={!!error}>
						<Select
							value={selectedValue}
							onChange={(e) => handleValueChange(e.target.value)}
							displayEmpty
							disabled={disabled}
							data-testid={`custom-field-${field.id}-single-select`}
						>
							<MenuItem value="">
								<em>None</em>
							</MenuItem>
							{field.options.map((option) => (
								<MenuItem key={option} value={option}>
									{option}
								</MenuItem>
							))}
						</Select>
						{error && (
							<Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
								{error}
							</Typography>
						)}
					</FormControl>
				);
			}

			case 'multi_select': {
				// Ensure value is an array of strings that exist in options
				const arrayValue = Array.isArray(value) ? value.map(String) : [];
				const selectedValues = arrayValue.filter((v) => field.options.includes(v));
				
				return (
					<FormControl fullWidth size="small" error={!!error}>
						<Autocomplete
							multiple
							options={field.options}
							value={selectedValues}
							onChange={(_, newValue) => handleValueChange(newValue)}
							disabled={disabled}
							renderInput={(params) => (
								<TextField
									{...(params as TextFieldProps)}
									size="small"
									placeholder={selectedValues.length === 0 ? 'Select options' : undefined}
									error={!!error}
								/>
							)}
							renderTags={(tagValue, getTagProps) =>
								tagValue.map((option, index) => (
									<Chip
										label={option}
										size="small"
										{...getTagProps({ index })}
										key={option}
									/>
								))
							}
							data-testid={`custom-field-${field.id}-multi-select`}
						/>
						{error && (
							<Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
								{error}
							</Typography>
						)}
					</FormControl>
				);
			}

			case 'date':
				return (
					<TextField
						fullWidth
						size="small"
						type="date"
						value={formatDateForInput(String(value || ''))}
						onChange={(e) => handleValueChange(e.target.value)}
						disabled={disabled}
						error={!!error}
						helperText={error}
						InputLabelProps={{ shrink: true }}
						data-testid={`custom-field-${field.id}-date-input`}
					/>
				);

			case 'user':
				// TODO: Implement employee picker when needed
				// For now, show employee ID as read-only text
				return (
					<TextField
						fullWidth
						size="small"
						value={String(value || '')}
						disabled
						placeholder="Employee picker (coming soon)"
						helperText="Employee picker integration coming soon"
						data-testid={`custom-field-${field.id}-user-input`}
					/>
				);

			case 'checkbox':
				return (
					<FormControlLabel
						control={
							<Checkbox
								checked={Boolean(value)}
								onChange={(e) => handleValueChange(e.target.checked)}
								disabled={disabled}
								data-testid={`custom-field-${field.id}-checkbox`}
							/>
						}
						label={field.description || field.name}
					/>
				);

			default:
				return (
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, fontStyle: 'italic' }}>
						Unsupported field type: {field.fieldType}
					</Typography>
				);
		}
	};

	return (
		<Box sx={{ mb: 2 }} data-testid={`custom-field-${field.id}`}>
			{field.fieldType !== 'checkbox' && (
				<Typography
					variant="subtitle2"
					sx={{
						mb: 1,
						fontSize: '0.875rem',
						fontWeight: 600,
						display: 'flex',
						alignItems: 'center',
						gap: 0.5,
					}}
				>
					{field.name}
					{field.isRequired && (
						<Typography component="span" color="error" sx={{ fontSize: '1rem' }}>
							*
						</Typography>
					)}
				</Typography>
			)}
			{renderFieldInput()}
			{field.description && field.fieldType !== 'checkbox' && (
				<Typography
					variant="caption"
					sx={{ ...colors.text.secondary.style, display: 'block', mt: 0.5 }}
				>
					{field.description}
				</Typography>
			)}
		</Box>
	);
}
