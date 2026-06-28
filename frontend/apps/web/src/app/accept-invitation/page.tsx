'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Container, Typography, Paper, TextField, Button, Alert, CircularProgress, Divider, Link as MuiLink } from '@mui/material';
import { acceptInvitation, AuthError } from 'apis';
import { useAuthContext } from '@/lib/auth/AuthProvider';

function AcceptInvitationContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { refreshProfile } = useAuthContext();
	const token = searchParams.get('token') || '';

	const [displayName, setDisplayName] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [showMismatchFallback, setShowMismatchFallback] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!token) {
			setError('Invalid or missing invitation token');
			return;
		}
		if (password && password.length < 8) {
			setError('Password must be at least 8 characters');
			return;
		}
		if (password && password !== confirmPassword) {
			setError('Passwords do not match');
			return;
		}

		setIsLoading(true);
		setError('');
		setShowMismatchFallback(false);

		try {
			await acceptInvitation(token, {
				displayName: displayName || undefined,
				password: password || undefined,
			});
			await refreshProfile();
			router.push('/workspace');
		} catch (err) {
			if (err instanceof AuthError && err.code === 'INVITATION_SSO_EMAIL_MISMATCH') {
				setShowMismatchFallback(true);
			}
			setError(err instanceof Error ? err.message : 'Failed to accept invitation');
		} finally {
			setIsLoading(false);
		}
	};

	if (!token) {
		return (
			<Container maxWidth="sm">
				<Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
					<Alert severity="error">
						Invalid invitation link. Please check your email for the correct link.
					</Alert>
				</Box>
			</Container>
		);
	}

	return (
		<Container maxWidth="sm">
			<Box
				sx={{
					minHeight: '100vh',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					py: 4,
				}}
			>
				<Box sx={{ mb: 4, textAlign: 'center' }}>
					<Typography variant="h4" component="h1" gutterBottom fontWeight="bold">
						Accept Invitation
					</Typography>
					<Typography variant="subtitle1" color="text.secondary">
						Set up your account to join the organization
					</Typography>
				</Box>

				<Paper elevation={0} sx={{ p: 4 }}>
					<Box component="form" onSubmit={handleSubmit}>
						{showMismatchFallback && (
							<Alert severity="warning" sx={{ mb: 2 }}>
								Your social sign-in used a different email than the invitation. Finish setup with your invited email and password here, then link Apple or Google later from Security.
							</Alert>
						)}

						<Alert severity="info" sx={{ mb: 2 }}>
							Use the same email address from your invitation. If you later sign in with Google or Apple using that same email, it will connect to this account instead of creating a second one.
						</Alert>

						<TextField
							fullWidth
							label="Display Name"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
							disabled={isLoading}
							sx={{ mb: 2 }}
							autoFocus
						/>

						<Divider sx={{ my: 2 }}>
							<Typography variant="caption" color="text.secondary">
								Set a password for this invited account
							</Typography>
						</Divider>

						<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
							Password sign-in works immediately after you accept. SSO can be added later from your account security settings when it is available in this environment.
						</Typography>

						<TextField
							fullWidth
							label="Password"
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							disabled={isLoading}
							sx={{ mb: 2 }}
							autoComplete="new-password"
						/>

						<TextField
							fullWidth
							label="Confirm Password"
							type="password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							disabled={isLoading}
							sx={{ mb: 3 }}
							autoComplete="new-password"
						/>

						<Button
							fullWidth
							type="submit"
							variant="contained"
							size="large"
							disabled={isLoading}
							sx={{ py: 1.5 }}
						>
							{isLoading ? <CircularProgress size={24} color="inherit" /> : showMismatchFallback ? 'Continue With Invited Email' : 'Accept & Join'}
						</Button>

						{error && (
							<Alert severity="error" sx={{ mt: 2 }}>
								{error}
							</Alert>
						)}
					</Box>
				</Paper>

				<Box sx={{ mt: 3, textAlign: 'center' }}>
					<MuiLink href="/signin" variant="body2" underline="hover">
						Already have an account? Sign in with email or PIN
					</MuiLink>
				</Box>
			</Box>
		</Container>
	);
}

export default function AcceptInvitationPage() {
	return (
		<Suspense fallback={
			<Container maxWidth="sm">
				<Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
					<CircularProgress />
				</Box>
			</Container>
		}>
			<AcceptInvitationContent />
		</Suspense>
	);
}
