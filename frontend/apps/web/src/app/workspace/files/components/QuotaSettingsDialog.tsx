/**
 * QuotaSettingsDialog Component
 * Dialog for owner/operator to update storage quota limits
 * 
 * Features:
 * - Input for quota bytes (with unlimited checkbox)
 * - Input for max file size bytes
 * - Validation: quota >= current usage, max file size > 0
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Button,
	TextField,
	FormControlLabel,
	Checkbox,
	Box,
	Typography,
	CircularProgress,
	Alert,
} from '@mui/material';
import { useThemeColors } from '@/theme/useThemeColors';
import { getQuota, updateQuota } from 'apis';
import type { QuotaInfo } from 'apis';

export interface QuotaSettingsDialogProps {
	open: boolean;
	onClose: () => void;
	onSuccess?: () => void;
}

export default function QuotaSettingsDialog({ open, onClose, onSuccess }: QuotaSettingsDialogProps) {
	const colors = useThemeColors();
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Quota state
	const [currentQuota, setCurrentQuota] = useState<QuotaInfo | null>(null);
	const [isUnlimited, setIsUnlimited] = useState(false);
	const [quotaGB, setQuotaGB] = useState<string>('100');
	const [maxFileSizeMB, setMaxFileSizeMB] = useState<string>('100');

	// Load current quota when dialog opens
	useEffect(() => {
		if (open) {
			loadQuota();
		}
	}, [open]);

	const loadQuota = async () => {
		try {
			setLoading(true);
			setError(null);

			const response = await getQuota();
			setCurrentQuota(response.quota);

			// Set form values
			if (response.quota.quotaBytes === undefined) {
				setIsUnlimited(true);
				setQuotaGB('100');
			} else {
				setIsUnlimited(false);
				setQuotaGB((response.quota.quotaBytes / (1024 * 1024 * 1024)).toFixed(2));
			}

			setMaxFileSizeMB((response.quota.maxFileSizeBytes / (1024 * 1024)).toFixed(2));
		} catch (err) {
			console.error('Failed to load quota:', err);
			setError(err instanceof Error ? err.message : 'Failed to load quota');
		} finally {
			setLoading(false);
		}
	};

	const handleSave = async () => {
		try {
			setSaving(true);
			setError(null);

			// Validate inputs
			const quotaBytes = isUnlimited ? undefined : parseFloat(quotaGB) * 1024 * 1024 * 1024;
			const maxFileSizeBytes = parseFloat(maxFileSizeMB) * 1024 * 1024;

			if (!isUnlimited && quotaBytes !== undefined) {
				if (quotaBytes <= 0) {
					setError('Quota must be greater than 0 GB');
					return;
				}

				// Validate quota >= current usage
				if (currentQuota && quotaBytes < currentQuota.currentUsageBytes) {
					setError(
						`Quota (${formatBytes(quotaBytes)}) must be at least equal to current usage (${formatBytes(currentQuota.currentUsageBytes)})`
					);
					return;
				}
			}

			if (maxFileSizeBytes <= 0) {
				setError('Max file size must be greater than 0 MB');
				return;
			}

			// Update quota
			await updateQuota({
				quotaBytes: quotaBytes !== undefined ? BigInt(Math.floor(quotaBytes)) : undefined,
				maxFileSizeBytes: BigInt(Math.floor(maxFileSizeBytes)),
			});			// Success
			onSuccess?.();
			onClose();
		} catch (err) {
			console.error('Failed to update quota:', err);
			setError(err instanceof Error ? err.message : 'Failed to update quota');
		} finally {
			setSaving(false);
		}
	};

	const formatBytes = (bytes: number): string => {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
	};

	return (
		<Dialog
			open={open}
			onClose={() => !saving && onClose()}
			maxWidth="sm"
			fullWidth
			data-testid="quota-dialog"
		>
			<DialogTitle sx={colors.text.primary.style}>Storage Quota Settings</DialogTitle>
			<DialogContent>
				{loading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', padding: 4 }}>
						<CircularProgress />
					</Box>
				) : (
					<Box sx={{ paddingTop: 2 }}>
						{error && (
							<Alert severity="error" sx={{ marginBottom: 2 }} onClose={() => setError(null)}>
								{error}
							</Alert>
						)}

						{currentQuota && (
							<Alert severity="info" sx={{ marginBottom: 2 }}>
								Current usage: {formatBytes(currentQuota.currentUsageBytes)}
							</Alert>
						)}

						{/* Unlimited quota checkbox */}
						<FormControlLabel
							control={
								<Checkbox
									checked={isUnlimited}
									onChange={(e) => setIsUnlimited(e.target.checked)}
								/>
							}
							label="Unlimited Storage"
						/>

						{/* Quota bytes input */}
						{!isUnlimited && (
							<TextField
								label="Storage Quota (GB)"
								type="number"
								value={quotaGB}
								onChange={(e) => setQuotaGB(e.target.value)}
								fullWidth
								margin="normal"
								inputProps={{ min: 0, step: 0.1 }}
								helperText={
									currentQuota
										? `Must be at least ${formatBytes(currentQuota.currentUsageBytes)}`
										: undefined
								}
								data-testid="quota-bytes-input"
							/>
						)}

						{/* Max file size input */}
						<TextField
							label="Max File Size (MB)"
							type="number"
							value={maxFileSizeMB}
							onChange={(e) => setMaxFileSizeMB(e.target.value)}
							fullWidth
							margin="normal"
							inputProps={{ min: 1, step: 1 }}
							helperText="Maximum size for individual file uploads"
							data-testid="max-file-size-input"
						/>

						{/* Explanation */}
						<Typography variant="caption" sx={{ ...colors.text.secondary.style, marginTop: 2, display: 'block' }}>
							These settings control storage limits for your organization. Reducing the quota below current usage will prevent new uploads until space is freed.
						</Typography>
					</Box>
				)}
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={loading || saving}>
					Cancel
				</Button>
				<Button
					onClick={handleSave}
					variant="contained"
					color="primary"
					disabled={loading || saving}
					startIcon={saving ? <CircularProgress size={16} /> : undefined}
				>
					{saving ? 'Saving...' : 'Save'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
