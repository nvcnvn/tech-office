'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
	Box,
	Container,
	Typography,
	Paper,
	TextField,
	Button,
	Alert,
	CircularProgress,
	List,
	ListItem,
	ListItemIcon,
	ListItemText,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { setPIN, PINValidationError, setAuthToken } from 'apis';
import { useAuthContext } from '@/lib/auth/AuthProvider';

function SetPINContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { refreshProfile } = useAuthContext();

	const pinChangeToken = searchParams.get('token') || '';

	const [newPin, setNewPin] = useState('');
	const [confirmPin, setConfirmPin] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState('');
	const [violations, setViolations] = useState<Array<{ field: string; description: string }>>([]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');
		setViolations([]);

		// Client-side validation
		if (newPin.length !== 6) {
			setError('PIN must be exactly 6 digits');
			return;
		}
		if (!/^\d{6}$/.test(newPin)) {
			setError('PIN must contain only numbers');
			return;
		}
		if (newPin !== confirmPin) {
			setError('PINs do not match');
			return;
		}

		setIsLoading(true);

		try {
			const result = await setPIN(newPin, { pinChangeToken });

			// Store the full JWT token
			setAuthToken(result.accessToken, Number(result.expiresAt));
			await refreshProfile();
			router.push('/workspace');
		} catch (err) {
			if (err instanceof PINValidationError) {
				setViolations(err.violations);
			} else {
				setError(err instanceof Error ? err.message : 'Failed to set PIN');
			}
		} finally {
			setIsLoading(false);
		}
	};

	if (!pinChangeToken) {
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
					<Paper elevation={0} sx={{ p: 4, textAlign: 'center' }}>
						<Typography variant="h6" gutterBottom color="error">
							Missing PIN Change Token
						</Typography>
						<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
							This page requires a valid PIN change token. Please log in first with your temporary PIN.
						</Typography>
						<Button variant="contained" href="/signin" data-testid="set-pin-go-login">
							Go to PIN Login
						</Button>
					</Paper>
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
					<Typography variant="h3" component="h1" gutterBottom fontWeight="bold">
						Tech Office
					</Typography>
					<Typography variant="subtitle1" color="text.secondary">
						Set Your Personal PIN
					</Typography>
				</Box>

				<Paper elevation={0} sx={{ p: 4 }}>
					<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
						You must set a personal 6-digit PIN to continue. Your PIN cannot match
						your date of birth or phone number.
					</Typography>

					<Box component="form" onSubmit={handleSubmit}>
						<TextField
							fullWidth
							label="New PIN"
							type="password"
							value={newPin}
							onChange={(e) => {
								const val = e.target.value.replace(/\D/g, '').slice(0, 6);
								setNewPin(val);
							}}
							disabled={isLoading}
							sx={{ mb: 2 }}
							autoFocus
							inputProps={{
								maxLength: 6,
								inputMode: 'numeric',
								pattern: '[0-9]*',
								'data-testid': 'set-pin-new',
							}}
							helperText="6 digits, numbers only"
						/>

						<TextField
							fullWidth
							label="Confirm PIN"
							type="password"
							value={confirmPin}
							onChange={(e) => {
								const val = e.target.value.replace(/\D/g, '').slice(0, 6);
								setConfirmPin(val);
							}}
							disabled={isLoading}
							sx={{ mb: 2 }}
							inputProps={{
								maxLength: 6,
								inputMode: 'numeric',
								pattern: '[0-9]*',
								'data-testid': 'set-pin-confirm',
							}}
						/>

						{/* Server-side field violations */}
						{violations.length > 0 && (
							<Alert severity="error" sx={{ mb: 2 }} data-testid="set-pin-violations">
								<Typography variant="body2" fontWeight="medium" sx={{ mb: 1 }}>
									PIN does not meet requirements:
								</Typography>
								<List dense disablePadding>
									{violations.map((v, i) => (
										<ListItem key={i} disablePadding sx={{ py: 0.25 }}>
											<ListItemIcon sx={{ minWidth: 28 }}>
												<ErrorOutlineIcon fontSize="small" color="error" />
											</ListItemIcon>
											<ListItemText primary={v.description} primaryTypographyProps={{ variant: 'body2' }} />
										</ListItem>
									))}
								</List>
							</Alert>
						)}

						{/* Generic error */}
						{error && (
							<Alert severity="error" sx={{ mb: 2 }} data-testid="set-pin-error">
								{error}
							</Alert>
						)}

						<Button
							fullWidth
							type="submit"
							variant="contained"
							size="large"
							disabled={isLoading}
							sx={{ py: 1.5 }}
							data-testid="set-pin-submit"
						>
							{isLoading ? <CircularProgress size={24} color="inherit" /> : 'Set PIN & Continue'}
						</Button>
					</Box>
				</Paper>
			</Box>
		</Container>
	);
}

export default function SetPINPage() {
	return (
		<Suspense
			fallback={
				<Container maxWidth="sm">
					<Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
						<CircularProgress />
					</Box>
				</Container>
			}
		>
			<SetPINContent />
		</Suspense>
	);
}
