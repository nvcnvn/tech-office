'use client';

import { CircularProgress, Box } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useSubdomainCheck } from '../../../lib/hooks/useSubdomainCheck';

interface SubdomainCheckProps {
	subdomain: string;
}

/**
 * Real-time subdomain availability indicator
 * Shows loading, available, or taken status
 */
export function SubdomainCheck({ subdomain }: SubdomainCheckProps) {
	const { isChecking, isAvailable, error } = useSubdomainCheck(subdomain);

	// Don't show anything if subdomain is empty or too short
	if (!subdomain || subdomain.length < 3) {
		return null;
	}

	return (
		<Box
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 0.5,
				minWidth: 120,
			}}
		>
			{isChecking && (
				<>
					<CircularProgress size={16} aria-label="Checking availability" />
					<Box component="span" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
						Checking...
					</Box>
				</>
			)}
			{!isChecking && isAvailable === true && (
				<>
					<CheckCircleIcon color="success" fontSize="small" aria-label="Available" />
					<Box component="span" sx={{ fontSize: '0.875rem', color: 'success.main' }}>
						Available
					</Box>
				</>
			)}
			{!isChecking && isAvailable === false && (
				<>
					<ErrorIcon color="error" fontSize="small" aria-label="Taken" />
					<Box component="span" sx={{ fontSize: '0.875rem', color: 'error.main' }}>
						Already taken
					</Box>
				</>
			)}
			{!isChecking && error && (
				<>
					<ErrorIcon color="warning" fontSize="small" aria-label="Error checking" />
					<Box component="span" sx={{ fontSize: '0.875rem', color: 'warning.main' }}>
						Check failed
					</Box>
				</>
			)}
		</Box>
	);
}
