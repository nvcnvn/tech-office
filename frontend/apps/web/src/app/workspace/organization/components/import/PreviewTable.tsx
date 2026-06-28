'use client';

import React from 'react';
import {
	Box,
	Typography,
	Paper,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	Chip,
	Alert,
	Card,
	CardContent,
	Grid,
	Tooltip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import type { PreviewEmployeeImportResponse, EmployeePreviewItem } from 'apis';

interface PreviewTableProps {
	previewData: PreviewEmployeeImportResponse;
}

const formatDate = (isoDateString?: string): string => {
	if (!isoDateString) return '—';
	try {
		const date = new Date(isoDateString);
		return date.toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	} catch {
		return isoDateString; // Return original if parse fails
	}
};

const truncateAddress = (address?: string): string => {
	if (!address) return '—';
	return address.length > 50 ? address.substring(0, 50) + '...' : address;
};

export default function PreviewTable({ previewData }: PreviewTableProps) {
	const { items, stats } = previewData;

	if (!items || items.length === 0) {
		return (
			<Alert severity="info">
				No employee data to preview
			</Alert>
		);
	}

	const getStatusIcon = (item: EmployeePreviewItem) => {
		if (item.willBeImported) {
			return <CheckCircleIcon color="success" />;
		} else if (item.isDuplicate) {
			return <WarningIcon color="warning" />;
		} else {
			return <ErrorIcon color="error" />;
		}
	};

	const getStatusText = (item: EmployeePreviewItem) => {
		if (item.willBeImported) {
			return 'Valid';
		} else if (item.isDuplicate) {
			return 'Duplicate';
		} else {
			return 'Invalid';
		}
	};

	const getStatusColor = (item: EmployeePreviewItem): 'success' | 'warning' | 'error' => {
		if (item.willBeImported) {
			return 'success';
		} else if (item.isDuplicate) {
			return 'warning';
		} else {
			return 'error';
		}
	};

	return (
		<Box>
			{/* Summary Stats */}
			<Grid container spacing={2} sx={{ mb: 3 }}>
				<Grid size={{ xs: 12, sm: 6, md: 3 }}>
					<Card>
						<CardContent>
							<Typography variant="h4" component="div">
								{stats?.totalCount || 0}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Total Employees
							</Typography>
						</CardContent>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, sm: 6, md: 3 }}>
					<Card sx={{ bgcolor: 'success.light' }}>
						<CardContent>
							<Typography variant="h4" component="div">
								{stats?.validCount || 0}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Valid
							</Typography>
						</CardContent>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, sm: 6, md: 3 }}>
					<Card sx={{ bgcolor: 'warning.light' }}>
						<CardContent>
							<Typography variant="h4" component="div">
								{stats?.duplicateCount || 0}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Duplicates
							</Typography>
						</CardContent>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, sm: 6, md: 3 }}>
					<Card sx={{ bgcolor: 'error.light' }}>
						<CardContent>
							<Typography variant="h4" component="div">
								{stats?.invalidCount || 0}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Invalid
							</Typography>
						</CardContent>
					</Card>
				</Grid>
			</Grid>

			{/* Warning if any invalid */}
			{(stats?.duplicateCount || 0) > 0 && (
				<Alert severity="warning" sx={{ mb: 2 }}>
					{stats?.duplicateCount} duplicate email(s) found. These will be skipped during import.
				</Alert>
			)}

			{(stats?.invalidCount || 0) > 0 && (
				<Alert severity="error" sx={{ mb: 2 }}>
					{stats?.invalidCount} employee(s) have validation errors and will be skipped during import.
				</Alert>
			)}

			{(stats?.validCount || 0) === 0 && (
				<Alert severity="error" sx={{ mb: 2 }}>
					No valid employees to import. Please fix the errors and try again.
				</Alert>
			)}

			{/* Employee Table */}
			<TableContainer component={Paper} sx={{ maxHeight: 500, overflowX: 'auto' }}>
				<Table stickyHeader size="small">
					<TableHead>
						<TableRow>
							<TableCell width="100px">Status</TableCell>
							<TableCell width="180px">Email</TableCell>
							<TableCell width="120px">Given Name</TableCell>
							<TableCell width="120px">Family Name</TableCell>
							<TableCell width="120px">Hire Date</TableCell>
							<TableCell width="120px">Date of Birth</TableCell>
							<TableCell width="140px">Phone</TableCell>
							<TableCell width="180px">Address</TableCell>
							<TableCell width="200px">Issues</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{items.map((item, index) => (
							<TableRow
								key={index}
								sx={{
									bgcolor: item.willBeImported
										? 'inherit'
										: item.isDuplicate
											? 'warning.lighter'
											: 'error.lighter',
								}}
							>
								<TableCell>
									<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
										{getStatusIcon(item)}
										<Chip
											label={getStatusText(item)}
											color={getStatusColor(item)}
											size="small"
										/>
									</Box>
								</TableCell>
								<TableCell>{item.employee?.email || '-'}</TableCell>
								<TableCell>{item.employee?.givenName || '-'}</TableCell>
								<TableCell>{item.employee?.familyName || '-'}</TableCell>
								<TableCell>{formatDate(item.employee?.hireDate)}</TableCell>
								<TableCell>{formatDate(item.employee?.dateOfBirth)}</TableCell>
								<TableCell>{item.employee?.phoneNumber || '—'}</TableCell>
								<TableCell>
									{item.employee?.homeAddress ? (
										<Tooltip title={item.employee.homeAddress} arrow>
											<span>{truncateAddress(item.employee.homeAddress)}</span>
										</Tooltip>
									) : (
										'—'
									)}
								</TableCell>
								<TableCell>
									{item.isDuplicate && (
										<Typography variant="caption" color="warning.dark" display="block">
											⚠ {item.duplicateReason || 'Email already exists'}
										</Typography>
									)}
									{item.validationErrors && item.validationErrors.length > 0 && (
										<Box>
											{item.validationErrors.map((error, idx) => (
												<Typography
													key={idx}
													variant="caption"
													color="error.dark"
													display="block"
												>
													❌ {error}
												</Typography>
											))}
										</Box>
									)}
									{item.willBeImported && !item.isDuplicate && !item.validationErrors?.length && (
										<Typography variant="caption" color="success.dark">
											✓ Ready to import
										</Typography>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableContainer>

			<Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
				Only valid employees will be imported. Duplicates and invalid entries will be skipped.
			</Typography>
		</Box>
	);
}
