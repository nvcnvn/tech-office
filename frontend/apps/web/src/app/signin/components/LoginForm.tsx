'use client';

// T029: LoginForm Component
// Triggers OIDC login with organization-specific scope

import { useState } from 'react';
import { Button, Box, Alert, CircularProgress, Typography } from '@mui/material';

export interface LoginFormProps {
	/** Organization ID (UUID) to log into */
	organizationId: string | null;
	/** Organization name for display */
	organizationName?: string;
	/** Organization-specific Zitadel client ID */
	clientId?: string;
	/** Callback when login is initiated */
	onLoginStart?: () => void;
}

/**
 * LoginForm Component
 * 
 * Triggers Zitadel OIDC login with organization-specific scope and client_id
 * Uses @zitadel/react via custom auth hooks
 */
export function LoginForm({ organizationId, organizationName, clientId: applicationId, onLoginStart }: LoginFormProps) {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string>('');

	/**
	 * Handle login button click
	 * OIDC login is not currently wired into the active auth provider.
	 */
	const handleLogin = async () => {
		if (!organizationId) {
			setError('Please select an organization first');
			return;
		}

		if (!applicationId) {
			setError('Organization client_id not available. Please contact support.');
			return;
		}

		setIsLoading(true);
		setError('');

		if (onLoginStart) {
			onLoginStart();
		}

		try {
			console.warn('OIDC login is not configured for the current auth implementation', {
				organizationId,
				applicationId,
			});
			setError('Zitadel login is not configured in this environment. Use the main sign-in page instead.');
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to initiate login';
			console.error('Login error:', err);
			setError(errorMessage);
		}

		setIsLoading(false);
	};

	return (
		<Box sx={{ width: '100%', maxWidth: 400 }}>
			{/* Organization info */}
			{organizationName && organizationId && (
				<Box sx={{ mb: 3, p: 2, bgcolor: 'grey.100', borderRadius: 1 }}>
					<Typography variant="subtitle2" color="text.secondary">
						Logging into:
					</Typography>
					<Typography variant="h6">{organizationName}</Typography>
				</Box>
			)}

			{/* Login button */}
			<Button
				fullWidth
				variant="contained"
				size="large"
				onClick={handleLogin}
				disabled={!organizationId || isLoading}
				sx={{ py: 1.5 }}
			>
				{isLoading ? (
					<>
						<CircularProgress size={20} sx={{ mr: 1 }} color="inherit" />
						Redirecting to Zitadel...
					</>
				) : (
					'Login with Zitadel'
				)}
			</Button>

			{/* Error message */}
			{error && (
				<Alert severity="error" sx={{ mt: 2 }}>
					{error}
				</Alert>
			)}

			{/* Organization not selected message */}
			{!organizationId && !error && (
				<Alert severity="info" sx={{ mt: 2 }}>
					Please select an organization first
				</Alert>
			)}

			{/* Loading state during redirect */}
			{isLoading && (
				<Box sx={{ mt: 2, textAlign: 'center' }}>
					<Typography variant="caption" color="text.secondary">
						You will be redirected to Zitadel for authentication...
					</Typography>
				</Box>
			)}
		</Box>
	);
}
