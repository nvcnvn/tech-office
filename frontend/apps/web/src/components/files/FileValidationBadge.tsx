/**
 * File Validation Badge Component
 * 
 * Feature: 015-file-storage-security-and-access
 * 
 * Displays validation status badge for file attachments.
 * Shows warnings when declared MIME type doesn't match detected type.
 * 
 * Usage:
 * ```tsx
 * <FileValidationBadge 
 *   validationStatus="warning" 
 *   validationMessage="Declared type: image/png, Detected: application/pdf"
 * />
 * ```
 */

'use client';

import React from 'react';
import { Box, Tooltip, CircularProgress } from '@mui/material';
import WarningIcon from '@mui/icons-material/Warning';
import ErrorIcon from '@mui/icons-material/Error';
import { useTheme } from '@mui/material/styles';
import { useThemeColors } from '@/theme/useThemeColors';

export type ValidationStatus = 'pending' | 'verified' | 'warning' | 'failed' | 'skipped';

interface FileValidationBadgeProps {
	validationStatus: ValidationStatus;
	validationMessage?: string;
}

/**
 * FileValidationBadge Component
 * 
 * Renders a badge indicating file validation status:
 * - verified: No badge (green checkmark, hidden by default)
 * - warning: Yellow warning icon with tooltip
 * - failed: Red error icon with tooltip
 * - pending: Gray loading spinner
 * - skipped: No badge
 * 
 * @param validationStatus - Validation status enum
 * @param validationMessage - Optional message shown in tooltip
 */
export default function FileValidationBadge({
	validationStatus,
	validationMessage,
}: FileValidationBadgeProps) {
	const colors = useThemeColors();
	const theme = useTheme();

	// Don't render badge for verified or skipped files
	if (validationStatus === 'verified' || validationStatus === 'skipped') {
		return null;
	}

	// Pending state: loading spinner
	if (validationStatus === 'pending') {
		return (
			<Box
				data-testid="file-validation-badge"
				sx={{
					display: 'inline-flex',
					alignItems: 'center',
					ml: 0.5,
				}}
			>
				<CircularProgress
					size={16}
					thickness={4}
					sx={{
						color: colors.text.secondary.style.color,
					}}
				/>
			</Box>
		);
	}

	// Warning state: yellow warning icon
	if (validationStatus === 'warning') {
		const badge = (
			<Box
				data-testid="file-validation-badge"
				sx={{
					display: 'inline-flex',
					alignItems: 'center',
					ml: 0.5,
				}}
			>
				<WarningIcon
					sx={{
						fontSize: 18,
						color: theme.palette.warning.main,
					}}
				/>
			</Box>
		);

		if (validationMessage) {
			return (
				<Tooltip title={validationMessage} arrow>
					{badge}
				</Tooltip>
			);
		}

		return badge;
	}

	// Failed state: red error icon
	if (validationStatus === 'failed') {
		const badge = (
			<Box
				data-testid="file-validation-badge"
				sx={{
					display: 'inline-flex',
					alignItems: 'center',
					ml: 0.5,
				}}
			>
				<ErrorIcon
					sx={{
						fontSize: 18,
						color: theme.palette.error.main,
					}}
				/>
			</Box>
		);

		if (validationMessage) {
			return (
				<Tooltip title={validationMessage} arrow>
					{badge}
				</Tooltip>
			);
		}

		return badge;
	}

	// Unknown status: no badge
	return null;
}
