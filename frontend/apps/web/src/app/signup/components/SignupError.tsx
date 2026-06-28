'use client';

import { Alert, AlertTitle } from '@mui/material';
import { OrganizationError, ValidationError, NetworkError } from 'apis';

interface SignupErrorProps {
	error: Error | null;
	onClose?: () => void;
}

/**
 * Error alert banner for signup form errors
 * Maps different error types to user-friendly messages
 */
export function SignupError({ error, onClose }: SignupErrorProps) {
	if (!error) return null;

	// Determine error message and title based on error type
	let title = 'Registration Failed';
	let message = 'An unexpected error occurred. Please try again.';

	if (error instanceof OrganizationError) {
		if (error.statusCode === 409) {
			title = 'Already Registered';
			message = 'This subdomain or email is already registered. Please choose a different one.';
		} else {
			message = error.message;
		}
	} else if (error instanceof ValidationError) {
		title = 'Invalid Input';
		message = 'Please check your form fields and try again. ' + error.message;
	} else if (error instanceof NetworkError) {
		title = 'Connection Error';
		message = 'Unable to connect to the server. Please check your internet connection and try again.';
	}

	return (
		<Alert
			severity="error"
			onClose={onClose}
			sx={{ mb: 2 }}
			aria-live="assertive"
		>
			<AlertTitle>{title}</AlertTitle>
			{message}
		</Alert>
	);
}
