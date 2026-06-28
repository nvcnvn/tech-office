'use client';

import { useState } from 'react';
import { Box, Container, Typography, Paper, TextField, Button, Alert, CircularProgress, Link as MuiLink } from '@mui/material';
import { requestPasswordReset } from 'apis';

export default function ForgotPasswordPage() {
	const [email, setEmail] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email) {
			setError('Please enter your email address');
			return;
		}

		setIsLoading(true);
		setError('');

		try {
			await requestPasswordReset(email);
			setSuccess(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send reset email');
		} finally {
			setIsLoading(false);
		}
	};

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
						Reset Password
					</Typography>
					<Typography variant="subtitle1" color="text.secondary">
						Enter your email to receive a password reset link
					</Typography>
				</Box>

				<Paper elevation={0} sx={{ p: 4 }}>
					{success ? (
						<Alert severity="success" data-testid="success-message">
							If an account with that email exists, a password reset link has been sent.
							Check your inbox.
						</Alert>
					) : (
						<Box component="form" onSubmit={handleSubmit}>
							<TextField
								fullWidth
								label="Email"
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								disabled={isLoading}
								sx={{ mb: 3 }}
								autoComplete="email"
								autoFocus
								inputProps={{ 'data-testid': 'email-input' }}
							/>

							<Button
								fullWidth
								variant="contained"
								type="submit"
								disabled={isLoading}
								data-testid="submit-button"
							>
								{isLoading ? <CircularProgress size={24} color="inherit" /> : 'Send Reset Link'}
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
