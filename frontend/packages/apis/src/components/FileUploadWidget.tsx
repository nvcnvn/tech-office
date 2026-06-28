/**
 * FileUploadWidget - STUB COMPONENT
 * 
 * Feature: 014-file-storage-system-an-integration
 * Status: DEPRECATED - replaced by domain-owned upload pattern (Feature 015)
 * 
 * This is a temporary stub to prevent build errors.
 * AvatarUpload.tsx should be refactored to use the new domain-owned pattern.
 * 
 * TODO: Refactor AvatarUpload to use direct FileService RPCs or create
 * AvatarUploadWidget following the domain-owned pattern (like ChatFileUpload).
 */

'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';
import type { FileMetadata, UploadContext } from '../files';

export interface FileUploadWidgetProps {
	uploadContext: UploadContext;
	onUploadComplete?: (file: FileMetadata) => void;
	onUploadError?: (error: Error) => void;
	acceptedTypes?: string[];
	maxSizeBytes?: number;
	disabled?: boolean;
}

/**
 * STUB: FileUploadWidget component
 * This is a placeholder to prevent build errors.
 * DO NOT USE - component is deprecated.
 */
export function FileUploadWidget(props: FileUploadWidgetProps) {
	return (
		<Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
			<Typography variant="body2" color="error">
				FileUploadWidget is deprecated. Please use domain-owned upload pattern.
			</Typography>
		</Box>
	);
}
