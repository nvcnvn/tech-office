'use client';

import { Box, LinearProgress, Typography, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { calculatePasswordStrength, getPasswordValidationDetails, PASSWORD_MIN_LENGTH } from '@tech-office/validations';

interface PasswordStrengthProps {
	password: string;
}

/**
 * Visual password strength indicator with validation checklist
 */
export function PasswordStrength({ password }: PasswordStrengthProps) {
	const strength = calculatePasswordStrength(password);
	const details = getPasswordValidationDetails(password);

	// Determine color and progress value based on strength
	const strengthConfig: Record<string, { color: 'error' | 'warning' | 'success'; value: number; label: string }> = {
		weak: { color: 'error' as const, value: 33, label: 'Weak' },
		medium: { color: 'warning' as const, value: 66, label: 'Medium' },
		strong: { color: 'success' as const, value: 100, label: 'Strong' },
	};

	const config = strengthConfig[strength];

	return (
		<Box sx={{ mt: 1 }}>
			{/* Strength meter */}
			{password.length > 0 && (
				<Box sx={{ mb: 1 }}>
					<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
						<LinearProgress
							variant="determinate"
							value={config.value}
							color={config.color}
							sx={{ flexGrow: 1, height: 6, borderRadius: 1 }}
							aria-label={`Password strength: ${config.label}`}
						/>
						<Chip
							label={config.label}
							size="small"
							color={config.color}
							sx={{ minWidth: 70 }}
						/>
					</Box>
				</Box>
			)}

			{/* Validation checklist */}
			{password.length > 0 && (
				<Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
					<ChecklistItem
						met={details.minLength}
						label={`At least ${PASSWORD_MIN_LENGTH} characters`}
					/>
					<ChecklistItem
						met={details.hasNumber}
						label="Contains at least one number"
					/>
					<ChecklistItem
						met={details.hasLetter}
						label="Contains at least one letter"
					/>
				</Box>
			)}
		</Box>
	);
}

interface ChecklistItemProps {
	met: boolean;
	label: string;
}

function ChecklistItem({ met, label }: ChecklistItemProps) {
	return (
		<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
			{met ? (
				<CheckCircleIcon color="success" fontSize="small" aria-label="Requirement met" />
			) : (
				<CancelIcon color="error" fontSize="small" aria-label="Requirement not met" />
			)}
			<Typography
				variant="body2"
				color={met ? 'text.secondary' : 'text.primary'}
				sx={{ fontSize: '0.875rem' }}
			>
				{label}
			</Typography>
		</Box>
	);
}
