/**
 * Presence Visibility Settings Page
 * Allows users to configure who can see their online status
 * Constitution v5.4.0 compliant - includes data-testid for accessibility testing
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
	Box,
	Card,
	CardContent,
	Typography,
	Radio,
	RadioGroup,
	FormControlLabel,
	FormControl,
	TextField,
	Button,
	Alert,
	CircularProgress,
	Divider,
} from '@mui/material';
import {
	setPresenceVisibility,
	getPresenceSettings,
	type VisibilityMode,
} from 'apis';

export default function PresenceSettingsPage() {
	const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>('everyone');
	const [customStatusText, setCustomStatusText] = useState('');
	const [customStatusEmoji, setCustomStatusEmoji] = useState('');
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [successMessage, setSuccessMessage] = useState('');
	const [errorMessage, setErrorMessage] = useState('');

	// Load current settings
	useEffect(() => {
		let mounted = true;

		getPresenceSettings()
			.then(settings => {
				if (!mounted) return;
				setVisibilityMode(settings.visibilityMode);
				setCustomStatusText(settings.customStatusText || '');
				setCustomStatusEmoji(settings.customStatusEmoji || '');
			})
			.catch(err => {
				console.error('[PresenceSettings] Failed to load settings:', err);
				if (mounted) {
					setErrorMessage('Failed to load settings. Please try again.');
				}
			})
			.finally(() => {
				if (mounted) {
					setIsLoading(false);
				}
			});

		return () => {
			mounted = false;
		};
	}, []);

	// Save settings
	const handleSave = async () => {
		setIsSaving(true);
		setSuccessMessage('');
		setErrorMessage('');

		try {
			await setPresenceVisibility({
				visibilityMode,
				customStatusText: customStatusText.trim() || undefined,
				customStatusEmoji: customStatusEmoji.trim() || undefined,
			});

			setSuccessMessage('Settings saved successfully!');

			// Clear success message after 3 seconds
			setTimeout(() => setSuccessMessage(''), 3000);
		} catch (err) {
			console.error('[PresenceSettings] Failed to save settings:', err);
			setErrorMessage('Failed to save settings. Please try again.');
		} finally {
			setIsSaving(false);
		}
	};

	if (isLoading) {
		return (
			<Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
				<CircularProgress />
			</Box>
		);
	}

	return (
		<Box sx={{ maxW: '4xl', mx: 'auto', p: 6 }}>
			<Typography variant="h4" gutterBottom fontWeight="bold">
				Presence Settings
			</Typography>
			<Typography variant="body1" color="text.secondary" gutterBottom>
				Control who can see your online status and activity
			</Typography>

			{successMessage && (
				<Alert severity="success" sx={{ mt: 3 }}>
					{successMessage}
				</Alert>
			)}

			{errorMessage && (
				<Alert severity="error" sx={{ mt: 3 }}>
					{errorMessage}
				</Alert>
			)}

			<Card sx={{ mt: 4 }} data-testid="presence-settings-form">
				<CardContent>
					<Typography variant="h6" gutterBottom>
						Visibility Mode
					</Typography>
					<Typography variant="body2" color="text.secondary" gutterBottom>
						Choose who can see when you&apos;re online
					</Typography>

					<FormControl component="fieldset" sx={{ mt: 2, width: '100%' }}>
						<RadioGroup
							value={visibilityMode}
							onChange={(e) => setVisibilityMode(e.target.value as VisibilityMode)}
						>
							<FormControlLabel
								value="everyone"
								control={<Radio data-testid="visibility-everyone-radio" />}
								label={
									<Box>
										<Typography variant="body1" fontWeight="medium">
											Everyone
										</Typography>
										<Typography variant="body2" color="text.secondary">
											All team members can see your online status
										</Typography>
									</Box>
								}
							/>

							<FormControlLabel
								value="departments"
								control={<Radio data-testid="visibility-departments-radio" />}
								label={
									<Box>
										<Typography variant="body1" fontWeight="medium">
											Departments Only
										</Typography>
										<Typography variant="body2" color="text.secondary">
											Only members in your departments can see your status
										</Typography>
									</Box>
								}
								sx={{ mt: 2 }}
							/>

							<FormControlLabel
								value="offline"
								control={<Radio data-testid="visibility-offline-radio" />}
								label={
									<Box>
										<Typography variant="body1" fontWeight="medium">
											Appear Offline
										</Typography>
										<Typography variant="body2" color="text.secondary">
											You&apos;ll always appear offline to others
										</Typography>
									</Box>
								}
								sx={{ mt: 2 }}
							/>
						</RadioGroup>
					</FormControl>

					<Divider sx={{ my: 4 }} />

					<Typography variant="h6" gutterBottom>
						Custom Status (Optional)
					</Typography>
					<Typography variant="body2" color="text.secondary" gutterBottom>
						Set a custom status message and emoji
					</Typography>

					<Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
						<TextField
							label="Emoji"
							value={customStatusEmoji}
							onChange={(e) => setCustomStatusEmoji(e.target.value)}
							placeholder="😊"
							inputProps={{
								maxLength: 2,
								'data-testid': 'custom-status-emoji-input',
							}}
							sx={{ width: '100px' }}
						/>
						<TextField
							label="Status Text"
							value={customStatusText}
							onChange={(e) => setCustomStatusText(e.target.value)}
							placeholder="In a meeting"
							fullWidth
							inputProps={{
								maxLength: 100,
								'data-testid': 'custom-status-text-input',
							}}
						/>
					</Box>

					<Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
						Examples: &quot;In a meeting&quot;, &quot;On vacation&quot;, &quot;Focusing&quot;, &quot;Available for questions&quot;
					</Typography>

					<Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
						<Button
							variant="contained"
							onClick={handleSave}
							disabled={isSaving}
							data-testid="presence-settings-save-btn"
						>
							{isSaving ? 'Saving...' : 'Save Changes'}
						</Button>

						<Button
							variant="outlined"
							onClick={() => {
								setCustomStatusText('');
								setCustomStatusEmoji('');
							}}
							disabled={isSaving || (!customStatusText && !customStatusEmoji)}
							data-testid="presence-settings-clear-status-btn"
						>
							Clear Custom Status
						</Button>
					</Box>
				</CardContent>
			</Card>

			<Card sx={{ mt: 3 }}>
				<CardContent>
					<Typography variant="h6" gutterBottom>
						About Presence
					</Typography>
					<Typography variant="body2" color="text.secondary" paragraph>
						Your presence status helps team members know when you&apos;re available for collaboration.
						We automatically detect when you&apos;re active, idle, or away based on your activity.
					</Typography>
					<Typography variant="body2" color="text.secondary" paragraph>
						<strong>Active:</strong> You&apos;re currently using the application
					</Typography>
					<Typography variant="body2" color="text.secondary" paragraph>
						<strong>Idle:</strong> No activity detected for 5 minutes
					</Typography>
					<Typography variant="body2" color="text.secondary">
						<strong>Offline:</strong> You&apos;ve closed the app or your visibility is set to &quot;Appear Offline&quot;
					</Typography>
				</CardContent>
			</Card>
		</Box>
	);
}
