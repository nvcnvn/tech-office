'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Container, Typography, Paper, TextField, Button, Alert, CircularProgress, Link as MuiLink } from '@mui/material';
import { resetPassword } from 'apis';

function ResetPasswordContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const token = searchParams.get('token') || '';

	const [newPassword, setNewPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!token) {
			setError('Invalid or missing reset token');
			return;
		}
		if (newPassword.length < 8) {
			setError('Password must be at least 8 characters');
			return;
		}
		if (newPassword !== confirmPassword) {
			setError('Passwords do not match');
			return;
		}

		setIsLoading(true);
		setError('');

		try {
			await resetPassword(token, newPassword);
			setSuccess(true);
			setTimeout(() => router.push('/signin'), 3000);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to reset password');
		} finally {
			setIsLoading(false);
		}
	};

	if (!token) {
		return (
			<Container maxWidth="sm">
				<Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
					<Alert severity="error">
						Invalid password reset link. Please request a new one from the{' '}
						<MuiLink href="/forgot-password">forgot password page</MuiLink>.
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
						Set New Password
					</Typography>
				</Box>

				<Paper elevation={0} sx={{ p: 4 }}>
					{success ? (
						<Alert severity="success">
							Password reset successfully! Redirecting to sign in...
						</Alert>
					) : (
						<Box component="form" onSubmit={handleSubmit}>
							<TextField
								fullWidth
								label="New Password"
								type="password"
								value={newPassword}
								onChange={(e) => setNewPassword(e.target.value)}
								disabled={isLoading}
								sx={{ mb: 2 }}
								autoComplete="new-password"
								autoFocus
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
								{isLoading ? <CircularProgress size={24} color="inherit" /> : 'Reset Password'}
							</Button>

							{error && (
								<Alert severity="error" sx={{ mt: 2 }}>
									{error}
								</Alert>
							)}
						</Box>
					)}
				</Paper>

				<Box sx={{ mt: 3, textAlign: 'center' }}>
					<MuiLink href="/signin" variant="body2" underline="hover">
						Back to sign in
					</MuiLink>
				</Box>
			</Box>
		</Container>
	);
}

export default function ResetPasswordPage() {
	return (
		<Suspense fallback={
			<Container maxWidth="sm">
				<Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
					<CircularProgress />
				</Box>
			</Container>
		}>
			<ResetPasswordContent />
		</Suspense>
	);
}
