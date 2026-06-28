'use client';

import React, { useState, useCallback } from 'react';
import {
	Box,
	Typography,
	Paper,
	Button,
	Alert,
	CircularProgress,
	List,
	ListItem,
	ListItemText,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import * as XLSX from 'xlsx';

const MAX_EMPLOYEES = 100;

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

interface FileUploadFormProps {
	onChange: (employees: EmployeeFormData[]) => void;
}

export default function FileUploadForm({ onChange }: FileUploadFormProps) {
	const [isDragging, setIsDragging] = useState(false);
	const [fileName, setFileName] = useState<string | null>(null);
	const [parsing, setParsing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [parsedCount, setParsedCount] = useState<number>(0);

	const parseFile = useCallback(async (file: File) => {
		setParsing(true);
		setError(null);
		setFileName(file.name);

		try {
			const arrayBuffer = await file.arrayBuffer();
			const workbook = XLSX.read(arrayBuffer, { type: 'array' });

			// Get first sheet
			const firstSheetName = workbook.SheetNames[0];
			if (!firstSheetName) {
				throw new Error('Excel file has no sheets');
			}

			const worksheet = workbook.Sheets[firstSheetName];
			// XLSX returns array of arrays when header: 1
			const jsonData = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });

			if (jsonData.length === 0) {
				throw new Error('Excel file is empty');
			}

			// Get headers (first row)
			const headers = jsonData[0] as unknown[];

			// Find required column indices (case-insensitive, flexible naming)
			const emailColIdx = headers.findIndex(h =>
				h && /^email$/i.test(String(h).trim())
			);
			const givenNameColIdx = headers.findIndex(h =>
				h && /^(given_name|given name|first_name|first name|firstname)$/i.test(String(h).trim())
			);
			const familyNameColIdx = headers.findIndex(h =>
				h && /^(family_name|family name|last_name|last name|lastname)$/i.test(String(h).trim())
			);

			// Find optional column indices
			const hireDateColIdx = headers.findIndex(h =>
				h && /^(hire_date|hire date|hiredate|start_date|start date)$/i.test(String(h).trim())
			);
			const dateOfBirthColIdx = headers.findIndex(h =>
				h && /^(date_of_birth|date of birth|dob|birth_date|birth date|birthdate)$/i.test(String(h).trim())
			);
			const phoneNumberColIdx = headers.findIndex(h =>
				h && /^(phone|phone_number|phone number)$/i.test(String(h).trim())
			);
			const homeAddressColIdx = headers.findIndex(h =>
				h && /^(address|home_address|home address)$/i.test(String(h).trim())
			);

			if (emailColIdx === -1 || givenNameColIdx === -1 || familyNameColIdx === -1) {
				throw new Error(
					'Excel file must have columns: email, given_name (or first_name), and family_name (or last_name)'
				);
			}

			// Parse data rows (skip header)
			const employees: EmployeeFormData[] = [];
			for (let i = 1; i < jsonData.length; i++) {
				const row = jsonData[i];

				// Skip empty rows
				if (!row || !Array.isArray(row) || row.length === 0) continue;

				const email = row[emailColIdx] ? String(row[emailColIdx]).trim() : '';
				const givenName = row[givenNameColIdx] ? String(row[givenNameColIdx]).trim() : '';
				const familyName = row[familyNameColIdx] ? String(row[familyNameColIdx]).trim() : '';

				// Parse optional fields
				const hireDate = hireDateColIdx !== -1 && row[hireDateColIdx]
					? String(row[hireDateColIdx]).trim()
					: undefined;
				const dateOfBirth = dateOfBirthColIdx !== -1 && row[dateOfBirthColIdx]
					? String(row[dateOfBirthColIdx]).trim()
					: undefined;
				const phoneNumber = phoneNumberColIdx !== -1 && row[phoneNumberColIdx]
					? String(row[phoneNumberColIdx]).trim()
					: undefined;
				const homeAddress = homeAddressColIdx !== -1 && row[homeAddressColIdx]
					? String(row[homeAddressColIdx]).trim()
					: undefined;

				// Skip rows with all empty required fields
				if (!email && !givenName && !familyName) continue;

				employees.push({
					email,
					givenName,
					familyName,
					...(hireDate && { hireDate }),
					...(dateOfBirth && { dateOfBirth }),
					...(phoneNumber && { phoneNumber }),
					...(homeAddress && { homeAddress }),
				});

				// Enforce max limit
				if (employees.length >= MAX_EMPLOYEES) {
					break;
				}
			}

			if (employees.length === 0) {
				throw new Error('No valid employee data found in file');
			}

			setParsedCount(employees.length);
			onChange(employees);

		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to parse file';
			setError(errorMessage);
			setParsedCount(0);
			onChange([]);
		} finally {
			setParsing(false);
		}
	}, [onChange]);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
	}, []);

	const handleDrop = useCallback(async (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);

		const files = Array.from(e.dataTransfer.files);
		const xlsxFile = files.find(f => f.name.endsWith('.xlsx'));

		if (!xlsxFile) {
			setError('Please drop a .xlsx file');
			return;
		}

		await parseFile(xlsxFile);
	}, [parseFile]);

	const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || files.length === 0) return;

		const file = files[0];
		if (!file.name.endsWith('.xlsx')) {
			setError('Please select a .xlsx file');
			return;
		}

		await parseFile(file);
	}, [parseFile]);

	return (
		<Box>
			<Typography variant="h6" gutterBottom>
				File Upload
			</Typography>

			<Paper
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				sx={{
					p: 4,
					textAlign: 'center',
					border: '2px dashed',
					borderColor: isDragging ? 'primary.main' : 'divider',
					bgcolor: isDragging ? 'action.hover' : 'background.paper',
					transition: 'all 0.2s',
					cursor: 'pointer',
				}}
			>
				<input
					type="file"
					accept=".xlsx"
					onChange={handleFileInput}
					style={{ display: 'none' }}
					id="file-upload-input"
				/>
				<label htmlFor="file-upload-input" style={{ cursor: 'pointer', display: 'block' }}>
					<CloudUploadIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 2 }} />
					<Typography variant="h6" gutterBottom>
						Drop your Excel file here
					</Typography>
					<Typography variant="body2" color="text.secondary" paragraph>
						or click to browse
					</Typography>
					<Button variant="outlined" component="span" disabled={parsing}>
						Choose File
					</Button>
				</label>
			</Paper>

			{parsing && (
				<Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
					<CircularProgress size={20} />
					<Typography>Parsing file...</Typography>
				</Box>
			)}

			{error && (
				<Alert severity="error" sx={{ mt: 2 }}>
					{error}
				</Alert>
			)}

			{!error && fileName && parsedCount > 0 && (
				<Alert severity="success" sx={{ mt: 2 }}>
					Successfully parsed {parsedCount} employees from {fileName}
				</Alert>
			)}

			<Box sx={{ mt: 3 }}>
				<Typography variant="subtitle2" gutterBottom>
					Excel File Requirements:
				</Typography>
				<List dense>
					<ListItem>
						<ListItemText
							primary="• Must be .xlsx format (Excel 2007+)"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="• First row must contain column headers"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="• Required columns: 'email', 'given_name' (or 'first_name'), 'family_name' (or 'last_name')"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="• Optional columns: 'hire_date' (or 'start_date'), 'date_of_birth' (or 'dob'), 'phone_number' (or 'phone'), 'home_address' (or 'address')"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="• Date formats: YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="• Phone format: digits, +, and - only (7-20 characters)"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="• Address: max 500 characters"
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary={`• Maximum ${MAX_EMPLOYEES} employees per file`}
						/>
					</ListItem>
					<ListItem>
						<ListItemText
							primary="• Column names are case-insensitive"
						/>
					</ListItem>
				</List>
			</Box>
		</Box>
	);
}
