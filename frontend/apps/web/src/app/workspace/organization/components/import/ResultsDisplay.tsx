'use client';
import {
	Box,
	Typography,
	Paper,
	Alert,
	List,
	ListItem,
	ListItemText,
	ListItemIcon,
	Card,
	CardContent,
	Grid,
	Divider,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import type { ExecuteEmployeeImportResponse } from 'apis';

interface ResultsDisplayProps {
	importResults: ExecuteEmployeeImportResponse;
}

export default function ResultsDisplay({ importResults }: ResultsDisplayProps) {
	const { results, totalAttempted, successCount, failedCount } = importResults;

	const successResults = results?.filter(r => r.success) || [];
	const failedResults = results?.filter(r => !r.success) || [];

	return (
		<Box>
			{/* Summary Stats */}
			<Grid container spacing={2} sx={{ mb: 3 }}>
				<Grid size={{ xs: 12, sm: 4 }}>
					<Card>
						<CardContent>
							<Typography variant="h4" component="div">
								{totalAttempted}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Total Attempted
							</Typography>
						</CardContent>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, sm: 4 }}>
					<Card sx={{ bgcolor: 'success.light' }}>
						<CardContent>
							<Typography variant="h4" component="div">
								{successCount}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Successfully Imported
							</Typography>
						</CardContent>
					</Card>
				</Grid>
				<Grid size={{ xs: 12, sm: 4 }}>
					<Card sx={{ bgcolor: 'error.light' }}>
						<CardContent>
							<Typography variant="h4" component="div">
								{failedCount}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Failed
							</Typography>
						</CardContent>
					</Card>
				</Grid>
			</Grid>

			{/* Overall Status Alert */}
			{successCount === totalAttempted ? (
				<Alert severity="success" sx={{ mb: 3 }}>
					🎉 All {successCount} employee(s) were successfully imported!
				</Alert>
			) : failedCount === totalAttempted ? (
				<Alert severity="error" sx={{ mb: 3 }}>
					❌ All import attempts failed. Please review the errors below and try again.
				</Alert>
			) : (
				<Alert severity="warning" sx={{ mb: 3 }}>
					⚠ Partial success: {successCount} of {totalAttempted} employee(s) imported successfully.
					{failedCount} failed.
				</Alert>
			)}

			{/* Successful Imports */}
			{successResults.length > 0 && (
				<Paper sx={{ p: 2, mb: 3 }}>
					<Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<CheckCircleIcon color="success" />
						Successfully Imported ({successCount})
					</Typography>
					<Divider sx={{ mb: 2 }} />
					<List dense>
						{successResults.map((result, index) => (
							<ListItem key={index}>
								<ListItemIcon>
									<CheckCircleIcon color="success" fontSize="small" />
								</ListItemIcon>
								<ListItemText
									primary={result.email}
									secondary={
										<>
											Imported successfully
											{result.identityId && (
												<Typography component="span" variant="caption" display="block" color="text.secondary">
													Identity ID: {result.identityId}
												</Typography>
											)}
										</>
									}
								/>
							</ListItem>
						))}
					</List>
				</Paper>
			)}

			{/* Failed Imports */}
			{failedResults.length > 0 && (
				<Paper sx={{ p: 2 }}>
					<Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
						<ErrorIcon color="error" />
						Failed Imports ({failedCount})
					</Typography>
					<Divider sx={{ mb: 2 }} />
					<List dense>
						{failedResults.map((result, index) => (
							<ListItem key={index}>
								<ListItemIcon>
									<ErrorIcon color="error" fontSize="small" />
								</ListItemIcon>
								<ListItemText
									primary={result.email}
									secondary={
										<>
											Import failed
											{result.errorMessage && (
												<Typography component="span" variant="caption" display="block" color="error">
													Error: {result.errorMessage}
												</Typography>
											)}
										</>
									}
								/>
							</ListItem>
						))}
					</List>
				</Paper>
			)}

			{/* Next Steps */}
			<Box sx={{ mt: 3 }}>
				<Typography variant="body2" color="text.secondary">
					{failedCount > 0
						? 'Review the failed imports above. You can try importing them again by clicking "Import More Employees".'
						: 'All employees have been successfully imported. Click "Import More Employees" to add more.'}
				</Typography>
			</Box>
		</Box>
	);
}
