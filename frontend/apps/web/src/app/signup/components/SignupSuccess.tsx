'use client';

import { Alert, AlertTitle, Box, Button } from '@mui/material';
import Link from 'next/link';

interface SignupSuccessProps {
	organizationName: string;
}

/**
 * Success confirmation UI after successful registration
 * Shows next steps and link to login page
 */
export function SignupSuccess({ organizationName }: SignupSuccessProps) {
	return (
		<Alert
			severity="success"
			sx={{ mb: 2 }}
			aria-live="polite"
		>
			<AlertTitle>Registration Successful!</AlertTitle>
			<Box sx={{ mt: 1 }}>
				Your organization <strong>{organizationName}</strong> has been successfully registered.
			</Box>
			<Box sx={{ mt: 2 }}>
				<Button
					component={Link}
					href="/signin"
					variant="contained"
					color="success"
					size="small"
				>
					Go to Sign In
				</Button>
			</Box>
		</Alert>
	);
}
