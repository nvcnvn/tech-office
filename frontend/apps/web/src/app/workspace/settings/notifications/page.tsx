/**
 * Push Token Management UI
 * Allows users to view and revoke registered push notification tokens
 * Constitution v5.4.0 compliant - includes data-testid for accessibility testing
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
	Box,
	Card,
	CardContent,
	Typography,
	Button,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	Paper,
	Chip,
	IconButton,
	Dialog,
	DialogActions,
	DialogContent,
	DialogContentText,
	DialogTitle,
	Alert,
	CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import { listPushTokens, revokePushToken, type PushToken } from 'apis';

export default function PushTokenManagementPage() {
	const [tokens, setTokens] = useState<PushToken[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isRevoking, setIsRevoking] = useState(false);
	const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
	const [tokenToRevoke, setTokenToRevoke] = useState<PushToken | null>(null);
	const [successMessage, setSuccessMessage] = useState('');
	const [errorMessage, setErrorMessage] = useState('');

	// Load push tokens
	const loadTokens = async () => {
		setIsLoading(true);
		setErrorMessage('');

		try {
			const tokensList = await listPushTokens();
			setTokens(tokensList);
		} catch (err) {
			console.error('[PushTokenManagement] Failed to load tokens:', err);
			setErrorMessage('Failed to load push tokens. Please try again.');
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		loadTokens();
	}, []);

	// Handle revoke token
	const handleRevokeClick = (token: PushToken) => {
		setTokenToRevoke(token);
		setRevokeDialogOpen(true);
	};

	const handleRevokeConfirm = async () => {
		if (!tokenToRevoke) return;

		setIsRevoking(true);
		setSuccessMessage('');
		setErrorMessage('');

		try {
			await revokePushToken(tokenToRevoke.tokenId);
			setSuccessMessage(`Token for ${tokenToRevoke.deviceIdentifier} revoked successfully!`);

			// Refresh token list
			await loadTokens();

			// Clear success message after 3 seconds
			setTimeout(() => setSuccessMessage(''), 3000);
		} catch (err) {
			console.error('[PushTokenManagement] Failed to revoke token:', err);
			setErrorMessage('Failed to revoke token. Please try again.');
		} finally {
			setIsRevoking(false);
			setRevokeDialogOpen(false);
			setTokenToRevoke(null);
		}
	};

	const handleRevokeCancel = () => {
		setRevokeDialogOpen(false);
		setTokenToRevoke(null);
	};

	// Format date for display
	const formatDate = (date: Date | undefined): string => {
		if (!date) return 'Never';
		return date.toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	};

	// Check if token is still valid (based on backend's isValid flag)
	const isTokenValid = (token: PushToken): boolean => {
		return token.isValid;
	};

	return (
		<Box sx={{ maxW: '6xl', mx: 'auto', p: 6 }}>
			<Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
				<div>
					<Typography variant="h4" gutterBottom fontWeight="bold">
						Push Notification Tokens
					</Typography>
					<Typography variant="body1" color="text.secondary">
						Manage devices registered for push notifications
					</Typography>
				</div>
				<Button
					variant="outlined"
					startIcon={<RefreshIcon />}
					onClick={loadTokens}
					disabled={isLoading}
					data-testid="push-token-refresh-btn"
				>
					Refresh
				</Button>
			</Box>

			{successMessage && (
				<Alert severity="success" sx={{ mb: 3 }}>
					{successMessage}
				</Alert>
			)}

			{errorMessage && (
				<Alert severity="error" sx={{ mb: 3 }}>
					{errorMessage}
				</Alert>
			)}

			<Card>
				<CardContent>
					{isLoading ? (
						<Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
							<CircularProgress />
						</Box>
					) : tokens.length === 0 ? (
						<Box textAlign="center" py={6}>
							<Typography variant="body1" color="text.secondary" gutterBottom>
								No push tokens registered
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Enable push notifications on a device to see tokens here
							</Typography>
						</Box>
					) : (
						<TableContainer component={Paper} elevation={0} data-testid="push-token-list">
							<Table>
								<TableHead>
									<TableRow>
										<TableCell><strong>Device</strong></TableCell>
										<TableCell><strong>Status</strong></TableCell>
										<TableCell><strong>Registered</strong></TableCell>
										<TableCell><strong>Last Used</strong></TableCell>
										<TableCell><strong>Validity</strong></TableCell>
										<TableCell align="right"><strong>Actions</strong></TableCell>
									</TableRow>
								</TableHead>
								<TableBody>
									{tokens.map((token) => (
										<TableRow key={token.tokenId} hover>
											<TableCell>
												<Typography variant="body2" fontWeight="medium">
													{token.deviceIdentifier}
												</Typography>
											</TableCell>
											<TableCell>
												{isTokenValid(token) ? (
													<Chip
														label="Active"
														color="success"
														size="small"
													/>
												) : (
													<Chip
														label="Expired"
														color="error"
														size="small"
													/>
												)}
											</TableCell>
											<TableCell>
												<Typography variant="body2" color="text.secondary">
													{formatDate(token.registeredAt)}
												</Typography>
											</TableCell>
											<TableCell>
												<Typography variant="body2" color="text.secondary">
													{formatDate(token.lastUsedAt)}
												</Typography>
											</TableCell>
											<TableCell>
												<Typography variant="body2" color="text.secondary">
													{token.isValid ? 'Valid' : 'Invalid'}
												</Typography>
											</TableCell>
											<TableCell align="right">
												<IconButton
													size="small"
													color="error"
													onClick={() => handleRevokeClick(token)}
													disabled={isRevoking}
													data-testid={`push-token-revoke-btn-${token.tokenId}`}
													title="Revoke token"
												>
													<DeleteIcon />
												</IconButton>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</TableContainer>
					)}
				</CardContent>
			</Card>

			<Card sx={{ mt: 3 }}>
				<CardContent>
					<Typography variant="h6" gutterBottom>
						About Push Tokens
					</Typography>
					<Typography variant="body2" color="text.secondary" paragraph>
						Push tokens allow this application to send notifications to your devices even when
						the app is not open. Each device you use will have its own token.
					</Typography>
					<Typography variant="body2" color="text.secondary" paragraph>
						<strong>Device Identifier:</strong> A unique identifier for each device/browser
						(based on user agent and registration time)
					</Typography>
					<Typography variant="body2" color="text.secondary" paragraph>
						<strong>Registered:</strong> When the token was first created
					</Typography>
					<Typography variant="body2" color="text.secondary" paragraph>
						<strong>Last Used:</strong> Most recent notification delivery to this device
					</Typography>
					<Typography variant="body2" color="text.secondary">
						<strong>Validity:</strong> Whether the token is currently valid and active for receiving notifications
					</Typography>

					<Box sx={{ mt: 3, p: 2, bgcolor: 'warning.light', borderRadius: 1 }}>
						<Typography variant="body2" fontWeight="medium" gutterBottom>
							Security Note
						</Typography>
						<Typography variant="body2">
							Revoking a token will immediately stop push notifications to that device.
							You can re-enable notifications by granting permission again in your browser settings.
						</Typography>
					</Box>
				</CardContent>
			</Card>

			{/* Revoke Confirmation Dialog */}
			<Dialog
				open={revokeDialogOpen}
				onClose={handleRevokeCancel}
				data-testid="push-token-revoke-dialog"
			>
				<DialogTitle>Revoke Push Token?</DialogTitle>
				<DialogContent>
					<DialogContentText>
						Are you sure you want to revoke the push token for <strong>{tokenToRevoke?.deviceIdentifier}</strong>?
						<br /><br />
						This will immediately stop push notifications to this device. You can re-enable
						notifications by granting permission again in your browser settings.
					</DialogContentText>
				</DialogContent>
				<DialogActions>
					<Button
						onClick={handleRevokeCancel}
						disabled={isRevoking}
						data-testid="push-token-revoke-cancel-btn"
					>
						Cancel
					</Button>
					<Button
						onClick={handleRevokeConfirm}
						color="error"
						variant="contained"
						disabled={isRevoking}
						data-testid="push-token-revoke-confirm-btn"
					>
						{isRevoking ? 'Revoking...' : 'Revoke Token'}
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
}
