/**
 * Settings Page
 * User preferences and appearance settings
 * 
 * Features:
 * - Theme selection (Light/Dark)
 * - Display preference source (Manual/OS Default)
 * - Reset to OS Default button
 * - Save button for manual theme changes
 * - data-testid attributes for accessibility testing
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRequireAuth } from '@/lib/auth/hooks';
import {
	Box,
	Container,
	Paper,
	Typography,
	Radio,
	RadioGroup,
	FormControlLabel,
	FormControl,
	FormLabel,
	Button,
	Alert,
	CircularProgress,
	Divider,
	Chip,
} from '@mui/material';
import { Settings as SettingsIcon, Brightness4, Brightness7, Refresh } from '@mui/icons-material';
import { useTheme } from '@/components/ThemeProvider';
import { getUserPreference, updateUserPreference, resetUserPreference, ThemeMode } from 'apis';
import { DeleteAccountSection } from './components/DeleteAccountSection';
import { LegalAndSafetySection } from './components/LegalAndSafetySection';

export default function SettingsPage() {
	const { isLoading, user } = useRequireAuth();
	const { themeMode, loading: themeLoading } = useTheme();

	const [selectedTheme, setSelectedTheme] = useState<ThemeMode>(themeMode);
	const [preferenceSource, setPreferenceSource] = useState<'manual' | 'os_default'>('os_default');
	const [saving, setSaving] = useState(false);
	const [resetting, setResetting] = useState(false);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Load current preference from server on mount
	useEffect(() => {
		async function loadPreference() {
			try {
				const pref = await getUserPreference();
				if (pref.exists) {
					setSelectedTheme(pref.themeMode);
					setPreferenceSource(pref.preferenceSource);
				}
			} catch (err) {
				console.error('[SettingsPage] Failed to load preference:', err);
			}
		}
		loadPreference();
	}, []);

	// Update selected theme when theme context changes
	useEffect(() => {
		setSelectedTheme(themeMode);
	}, [themeMode]);

	const handleThemeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		setSelectedTheme(event.target.value as ThemeMode);
		setSuccessMessage(null);
		setErrorMessage(null);
	};

	const handleSave = async () => {
		setSaving(true);
		setSuccessMessage(null);
		setErrorMessage(null);

		try {
			await updateUserPreference(selectedTheme, 'manual');
			setPreferenceSource('manual');
			setSuccessMessage('Theme preference saved successfully');
		} catch (err) {
			console.error('[SettingsPage] Failed to save preference:', err);
			setErrorMessage('Failed to save theme preference. Please try again.');
		} finally {
			setSaving(false);
		}
	};

	const handleReset = async () => {
		setResetting(true);
		setSuccessMessage(null);
		setErrorMessage(null);

		try {
			await resetUserPreference();
			setPreferenceSource('os_default');
			setSuccessMessage('Theme reset to OS default successfully');

			// Reload preference to get OS default theme
			const pref = await getUserPreference();
			setSelectedTheme(pref.themeMode);
		} catch (err) {
			console.error('[SettingsPage] Failed to reset preference:', err);
			setErrorMessage('Failed to reset theme preference. Please try again.');
		} finally {
			setResetting(false);
		}
	};

	// Show loading state while checking authentication
	if (isLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '100vh',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	// If not authenticated, useRequireAuth will handle redirect
	if (!user) {
		return null;
	}

	return (
		<Container maxWidth="md" sx={{ py: 4 }}>
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
				<SettingsIcon sx={{ fontSize: 32, color: 'primary.main' }} />
				<Typography variant="h4" component="h1" color="text.primary">
					Settings
				</Typography>
			</Box>

			{/* Success/Error Messages */}
			{successMessage && (
				<Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMessage(null)}>
					{successMessage}
				</Alert>
			)}
			{errorMessage && (
				<Alert severity="error" sx={{ mb: 3 }} onClose={() => setErrorMessage(null)}>
					{errorMessage}
				</Alert>
			)}

			{/* Appearance Settings */}
			<Paper sx={{ p: 3, bgcolor: 'background.paper', borderColor: 'divider', border: 1 }}>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
					<Typography variant="h6" component="h2" color="text.primary">
						Appearance
					</Typography>
					<Chip
						label={preferenceSource === 'manual' ? 'Manual' : 'OS Default'}
						size="small"
						color={preferenceSource === 'manual' ? 'primary' : 'default'}
						data-testid="preference-source-chip"
					/>
				</Box>

				<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
					Choose your preferred theme for the application. You can either manually select a theme or follow your operating system&apos;s preference.
				</Typography>

				<Divider sx={{ mb: 3, borderColor: 'divider' }} />

				{/* Theme Selection */}
				<FormControl component="fieldset" sx={{ mb: 3 }}>
					<FormLabel component="legend" sx={{ color: 'text.primary' }}>Theme Mode</FormLabel>
					<RadioGroup
						value={selectedTheme}
						onChange={handleThemeChange}
						data-testid="theme-mode-radio-group"
					>
						<FormControlLabel
							value="light"
							control={<Radio data-testid="theme-light-radio" />}
							label={
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.primary' }}>
									<Brightness7 fontSize="small" />
									<span>Light</span>
								</Box>
							}
						/>
						<FormControlLabel
							value="dark"
							control={<Radio data-testid="theme-dark-radio" />}
							label={
								<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.primary' }}>
									<Brightness4 fontSize="small" />
									<span>Dark</span>
								</Box>
							}
						/>
					</RadioGroup>
				</FormControl>

				<Divider sx={{ mb: 3, borderColor: 'divider' }} />

				{/* Action Buttons */}
				<Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
					<Button
						variant="outlined"
						startIcon={<Refresh />}
						onClick={handleReset}
						disabled={resetting || saving || themeLoading}
						data-testid="reset-to-os-default-button"
					>
						{resetting ? 'Resetting...' : 'Reset to OS Default'}
					</Button>
					<Button
						variant="contained"
						onClick={handleSave}
						disabled={saving || resetting || themeLoading || selectedTheme === themeMode}
						data-testid="save-theme-button"
					>
						{saving ? 'Saving...' : 'Save Changes'}
					</Button>
				</Box>

				{/* Helper Text */}
				<Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
					Tip: Use the theme toggle button in the header for quick switching.
				</Typography>
			</Paper>

			<LegalAndSafetySection />

			<DeleteAccountSection />
		</Container>
	);
}
