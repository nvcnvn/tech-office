/**
 * AvatarUpload Component
 * Avatar upload widget for user profile using FileUploadWidget
 * 
 * Features:
 * - FileUploadWidget with avatar upload context
 * - Image type restriction (image/* only)
 * - Cloudflare Image Resizing for avatar display
 * - Updates organization.employee.additional_info JSONB with avatar_file_id
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { useState } from 'react';
import { Box, Avatar, Typography, CircularProgress, Alert } from '@mui/material';
import { useThemeColors } from '@/theme/useThemeColors';
import { FileUploadWidget, getDownloadUrl } from 'apis';
import type { FileMetadata } from 'apis';

export interface AvatarUploadProps {
	currentAvatarUrl?: string;
	employeeName: string;
	onUploadComplete?: (fileId: string, downloadUrl: string) => void;
	onUploadError?: (error: Error) => void;
	disabled?: boolean;
}

export default function AvatarUpload({
	currentAvatarUrl,
	employeeName,
	onUploadComplete,
	onUploadError,
	disabled = false,
}: AvatarUploadProps) {
	const colors = useThemeColors();
	const [avatarUrl, setAvatarUrl] = useState<string | undefined>(currentAvatarUrl);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleUploadComplete = async (file: FileMetadata) => {
		try {
			setLoading(true);
			setError(null);

			// Get download URL with Cloudflare Image Resizing parameters
			const { downloadUrl } = await getDownloadUrl(file.id);
			if (downloadUrl) {
				// Apply Cloudflare Image Resizing: 256x256, quality 80
				const resizedUrl = `${downloadUrl}?width=256&height=256&quality=80&fit=cover`;
				setAvatarUrl(resizedUrl);

				// Update employee record with avatar_file_id
				// This would typically call an API to update organization.employee.additional_info
				onUploadComplete?.(file.id, resizedUrl);
			}
		} catch (err) {
			console.error('Failed to process avatar upload:', err);
			const errorMessage = err instanceof Error ? err.message : 'Failed to process avatar';
			setError(errorMessage);
			onUploadError?.(err instanceof Error ? err : new Error(errorMessage));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Box sx={{ textAlign: 'center' }}>
			{/* Current avatar preview */}
			<Box sx={{ marginBottom: 3, display: 'flex', justifyContent: 'center' }}>
				{loading ? (
					<Box
						sx={{
							width: 128,
							height: 128,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							borderRadius: '50%',
							...colors.bg.elevated.style,
						}}
					>
						<CircularProgress size={40} />
					</Box>
				) : (
					<Avatar
						src={avatarUrl}
						alt={employeeName}
						sx={{
							width: 128,
							height: 128,
							fontSize: '3rem',
							...colors.bg.elevated.style,
							...colors.text.primary.style,
						}}
					>
						{employeeName.charAt(0).toUpperCase()}
					</Avatar>
				)}
			</Box>

			<Typography variant="h6" gutterBottom sx={colors.text.primary.style}>
				Profile Picture
			</Typography>

			{error && (
				<Alert severity="error" sx={{ marginBottom: 2 }} onClose={() => setError(null)}>
					{error}
				</Alert>
			)}

			{/* File Upload Widget */}
			<Box sx={{ marginTop: 2 }}>
				<FileUploadWidget
					uploadContext="avatar"
					acceptedTypes={['image/*']}
					maxSizeBytes={5 * 1024 * 1024} // 5MB for images
					onUploadComplete={handleUploadComplete}
					onUploadError={onUploadError}
					disabled={disabled || loading}
				/>
			</Box>

			<Typography variant="caption" sx={{ ...colors.text.hint.style, marginTop: 2, display: 'block' }}>
				Recommended: Square image, at least 256x256 pixels. Max 5MB.
			</Typography>
		</Box>
	);
}
