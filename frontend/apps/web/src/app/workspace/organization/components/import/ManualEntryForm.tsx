'use client';

import React, { useState, useCallback } from 'react';
import {
	Box,
	TextField,
	Button,
	IconButton,
	Typography,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	Paper,
	Alert,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';

const MAX_EMPLOYEES = 100;
const INITIAL_ROWS = 3;

// Plain interface for form data (not proto message)
interface EmployeeFormData {
	email: string;
	givenName: string;
	familyName: string;
	hireDate?: string;
	dateOfBirth?: string;
	phoneNumber?: string;
	homeAddress?: string;
}

interface EmployeeRow {
	id: string;
	email: string;
	givenName: string;
	familyName: string;
	hireDate?: string;
	dateOfBirth?: string;
	phoneNumber?: string;
	homeAddress?: string;
	emailError?: string;
	givenNameError?: string;
	familyNameError?: string;
	hireDateError?: string;
	dateOfBirthError?: string;
	phoneNumberError?: string;
	homeAddressError?: string;
}

interface ManualEntryFormProps {
	onChange: (employees: EmployeeFormData[]) => void;
}

const validateEmail = (email: string): string | undefined => {
	if (!email) return undefined;
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email) ? undefined : 'Invalid email format';
};

const validateRequired = (value: string, fieldName: string): string | undefined => {
	return value.trim() ? undefined : `${fieldName} is required`;
};

const validateDateFormat = (date: string): string | undefined => {
	if (!date || !date.trim()) return undefined;
	// Accept multiple formats - validation happens server-side
	// Just check it looks like a date
	const datePattern = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$/;
	return datePattern.test(date.trim()) ? undefined : 'Invalid date format (use YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY)';
};

const validatePhoneNumber = (phone: string): string | undefined => {
	if (!phone || !phone.trim()) return undefined;
	const phonePattern = /^[0-9+\-]{7,20}$/;
	return phonePattern.test(phone.trim()) ? undefined : 'Phone must be 7-20 characters (digits, +, - only)';
};

const validateAddress = (address: string): string | undefined => {
	if (!address || !address.trim()) return undefined;
	const runeCount = [...address.trim()].length; // Count UTF-8 characters properly
	return runeCount <= 500 ? undefined : `Address exceeds 500 characters (${runeCount})`;
};

export default function ManualEntryForm({ onChange }: ManualEntryFormProps) {
	const [rows, setRows] = useState<EmployeeRow[]>(() => {
		return Array.from({ length: INITIAL_ROWS }, (_, i) => ({
			id: `row-${i}`,
			email: '',
			givenName: '',
			familyName: '',
			hireDate: '',
			dateOfBirth: '',
			phoneNumber: '',
			homeAddress: '',
		}));
	});

	const updateEmployeeData = useCallback((updatedRows: EmployeeRow[]) => {
		// Filter out empty rows and validate
		const validEmployees: EmployeeFormData[] = updatedRows
			.filter(row => row.email || row.givenName || row.familyName)
			.map(row => ({
				email: row.email,
				givenName: row.givenName,
				familyName: row.familyName,
				// Only include optional fields if they have values
				...(row.hireDate?.trim() && { hireDate: row.hireDate.trim() }),
				...(row.dateOfBirth?.trim() && { dateOfBirth: row.dateOfBirth.trim() }),
				...(row.phoneNumber?.trim() && { phoneNumber: row.phoneNumber.trim() }),
				...(row.homeAddress?.trim() && { homeAddress: row.homeAddress.trim() }),
			}));

		// Defer the onChange call to avoid setState during render
		queueMicrotask(() => {
			onChange(validEmployees);
		});
	}, [onChange]);

	const handleFieldChange = (id: string, field: keyof EmployeeRow, value: string) => {
		setRows(prevRows => {
			const newRows = prevRows.map(row => {
				if (row.id !== id) return row;

				const updatedRow = { ...row, [field]: value };

				// Validate on change
				if (field === 'email') {
					updatedRow.emailError = value ? validateEmail(value) : undefined;
				} else if (field === 'givenName') {
					updatedRow.givenNameError = value ? validateRequired(value, 'Given name') : undefined;
				} else if (field === 'familyName') {
					updatedRow.familyNameError = value ? validateRequired(value, 'Family name') : undefined;
				} else if (field === 'hireDate') {
					updatedRow.hireDateError = value ? validateDateFormat(value) : undefined;
				} else if (field === 'dateOfBirth') {
					updatedRow.dateOfBirthError = value ? validateDateFormat(value) : undefined;
				} else if (field === 'phoneNumber') {
					updatedRow.phoneNumberError = value ? validatePhoneNumber(value) : undefined;
				} else if (field === 'homeAddress') {
					updatedRow.homeAddressError = value ? validateAddress(value) : undefined;
				}

				return updatedRow;
			});

			updateEmployeeData(newRows);
			return newRows;
		});
	};

	const handleAddRow = () => {
		if (rows.length >= MAX_EMPLOYEES) return;

		const newRow: EmployeeRow = {
			id: `row-${Date.now()}`,
			email: '',
			givenName: '',
			familyName: '',
			hireDate: '',
			dateOfBirth: '',
			phoneNumber: '',
			homeAddress: '',
		};

		setRows(prevRows => [...prevRows, newRow]);
	};

	const handleRemoveRow = (id: string) => {
		if (rows.length <= 1) return; // Keep at least one row

		setRows(prevRows => {
			const newRows = prevRows.filter(row => row.id !== id);
			updateEmployeeData(newRows);
			return newRows;
		});
	};

	const hasErrors = rows.some(
		row => row.emailError || row.givenNameError || row.familyNameError ||
			row.hireDateError || row.dateOfBirthError || row.phoneNumberError || row.homeAddressError
	);

	const filledRowCount = rows.filter(
		row => row.email || row.givenName || row.familyName
	).length;

	return (
		<Box>
			<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
				<Typography variant="h6">
					Manual Entry
				</Typography>
				<Typography variant="body2" color="text.secondary">
					{filledRowCount} / {MAX_EMPLOYEES} employees
				</Typography>
			</Box>

			{hasErrors && (
				<Alert severity="error" sx={{ mb: 2 }}>
					Please fix validation errors before proceeding
				</Alert>
			)}

			{rows.length >= MAX_EMPLOYEES && (
				<Alert severity="warning" sx={{ mb: 2 }}>
					Maximum of {MAX_EMPLOYEES} employees reached
				</Alert>
			)}

			<TableContainer component={Paper} sx={{ maxHeight: 500, overflowX: 'auto' }}>
				<Table stickyHeader size="small">
					<TableHead>
						<TableRow>
							<TableCell width="180px">Email *</TableCell>
							<TableCell width="120px">Given Name *</TableCell>
							<TableCell width="120px">Family Name *</TableCell>
							<TableCell width="130px">Hire Date</TableCell>
							<TableCell width="130px">Date of Birth</TableCell>
							<TableCell width="150px">Phone Number</TableCell>
							<TableCell width="200px">Address</TableCell>
							<TableCell width="80px" align="center">Actions</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{rows.map((row) => (
							<TableRow key={row.id}>
								<TableCell>
									<TextField
										fullWidth
										size="small"
										value={row.email}
										onChange={(e) => handleFieldChange(row.id, 'email', e.target.value)}
										error={!!row.emailError}
										helperText={row.emailError}
										placeholder="employee@example.com"
									/>
								</TableCell>
								<TableCell>
									<TextField
										fullWidth
										size="small"
										value={row.givenName}
										onChange={(e) => handleFieldChange(row.id, 'givenName', e.target.value)}
										error={!!row.givenNameError}
										helperText={row.givenNameError}
										placeholder="John"
									/>
								</TableCell>
								<TableCell>
									<TextField
										fullWidth
										size="small"
										value={row.familyName}
										onChange={(e) => handleFieldChange(row.id, 'familyName', e.target.value)}
										error={!!row.familyNameError}
										helperText={row.familyNameError}
										placeholder="Doe"
									/>
								</TableCell>
								<TableCell>
									<TextField
										fullWidth
										size="small"
										value={row.hireDate || ''}
										onChange={(e) => handleFieldChange(row.id, 'hireDate', e.target.value)}
										error={!!row.hireDateError}
										helperText={row.hireDateError}
										placeholder="YYYY-MM-DD"
									/>
								</TableCell>
								<TableCell>
									<TextField
										fullWidth
										size="small"
										value={row.dateOfBirth || ''}
										onChange={(e) => handleFieldChange(row.id, 'dateOfBirth', e.target.value)}
										error={!!row.dateOfBirthError}
										helperText={row.dateOfBirthError}
										placeholder="YYYY-MM-DD"
									/>
								</TableCell>
								<TableCell>
									<TextField
										fullWidth
										size="small"
										value={row.phoneNumber || ''}
										onChange={(e) => handleFieldChange(row.id, 'phoneNumber', e.target.value)}
										error={!!row.phoneNumberError}
										helperText={row.phoneNumberError}
										placeholder="+1-555-123-4567"
									/>
								</TableCell>
								<TableCell>
									<TextField
										fullWidth
										size="small"
										value={row.homeAddress || ''}
										onChange={(e) => handleFieldChange(row.id, 'homeAddress', e.target.value)}
										error={!!row.homeAddressError}
										helperText={row.homeAddressError}
										placeholder="123 Main St..."
										multiline
										rows={2}
										inputProps={{ maxLength: 500 }}
									/>
								</TableCell>
								<TableCell align="center">
									<IconButton
										size="small"
										onClick={() => handleRemoveRow(row.id)}
										disabled={rows.length <= 1}
										color="error"
									>
										<DeleteIcon fontSize="small" />
									</IconButton>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableContainer>

			<Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
				<Button
					variant="outlined"
					startIcon={<AddIcon />}
					onClick={handleAddRow}
					disabled={rows.length >= MAX_EMPLOYEES}
				>
					Add Row
				</Button>
			</Box>

			<Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
				* Required fields. Optional fields: Hire Date, Date of Birth, Phone Number, Address.
				All optional fields can be left empty.
			</Typography>
		</Box>
	);
}
