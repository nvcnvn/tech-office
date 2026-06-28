/**
 * Task File Upload Component
 * 
 * Feature: 017-realtime-task-collaboration-system
 * Architecture: Domain-owned upload flow (same pattern as ChatFileUpload)
 * 
 * Simple file upload component for task attachments using:
 * - requestTaskFileUpload (verifies project membership, derives access scope)
 * - Direct R2 upload
 * - confirmTaskFileUpload (triggers validation/PDF/indexing workflows)
 */

'use client';

import React, { useState, useRef } from 'react';
import { Box, Button, Typography, LinearProgress, IconButton, Alert } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import { requestTaskFileUpload, confirmTaskFileUpload, type FileMetadata } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

interface TaskFileUploadProps {
	taskId: string;
	onUploadComplete: (file: FileMetadata) => void;
	onUploadError?: (errorMessage: string) => void;
	maxSizeBytes?: number;
	multiple?: boolean;
}

interface UploadingFile {
	file: File;
	progress: number;
	error?: string;
	fileId?: string;
}

export default function TaskFileUpload({
	taskId,
	onUploadComplete,
	onUploadError,
	maxSizeBytes = 100 * 1024 * 1024, // 100MB default
	multiple = true,
}: TaskFileUploadProps) {
	const colors = useThemeColors();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
	const [generalError, setGeneralError] = useState<string | null>(null);

	const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0) return;

		// Reset general error
		setGeneralError(null);

		// Validate file sizes
		const validFiles: File[] = [];
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (file.size > maxSizeBytes) {
				setGeneralError(`File "${file.name}" exceeds maximum size of ${Math.round(maxSizeBytes / 1024 / 1024)}MB`);
				continue;
			}
			validFiles.push(file);
		}

		if (validFiles.length === 0) return;

		// Add files to uploading state
		const newUploadingFiles = validFiles.map(file => ({
			file,
			progress: 0,
		}));
		setUploadingFiles(prev => [...prev, ...newUploadingFiles]);

		// Upload each file
		for (const uploadingFile of newUploadingFiles) {
			try {
				await uploadFile(uploadingFile.file, uploadingFile);
			} catch (error) {
				console.error('[TaskFileUpload] Upload failed:', error);
				const err = error as Error;
				const errorMessage = err.message || 'Unknown upload error';

				// Update file with error
				setUploadingFiles(prev => prev.map(uf =>
					uf.file === uploadingFile.file
						? { ...uf, error: errorMessage }
						: uf
				));

				// Call error callback with error message string
				if (onUploadError) {
					onUploadError(errorMessage);
				}
			}
		}

		// Reset file input
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
	};

	const uploadFile = async (file: File, uploadingFile: UploadingFile) => {
		try {
			// Step 1: Request upload URL (domain-owned API)
			const uploadReq = await requestTaskFileUpload({
				taskId,
				filename: file.name,
				mimeType: file.type || 'application/octet-stream',
				sizeBytes: file.size,
			});

			// Update progress to 10% (URL obtained)
			setUploadingFiles(prev => prev.map(uf =>
				uf.file === file ? { ...uf, progress: 10, fileId: uploadReq.fileId } : uf
			));

			// Step 2: Upload to R2 using presigned URL
			const xhr = new XMLHttpRequest();

			// Set timeout for R2 upload (5 minutes should handle large files)
			const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
			xhr.timeout = UPLOAD_TIMEOUT_MS;

			await new Promise<void>((resolve, reject) => {
				xhr.upload.addEventListener('progress', (event) => {
					const totalBytes = event.total || file.size;
					const percentComplete = 10 + (event.loaded / Math.max(totalBytes, 1)) * 80; // 10-90%
					setUploadingFiles(prev => prev.map(uf =>
						uf.file === file ? { ...uf, progress: percentComplete } : uf
					));
				});

				xhr.addEventListener('load', () => {
					if (xhr.status >= 200 && xhr.status < 300) {
						resolve();
					} else {
						reject(new Error(`Upload failed (${xhr.status}): ${xhr.statusText || 'Unknown error'}`));
					}
				});

				xhr.addEventListener('error', () => {
					reject(new Error('Network error during upload. Please check your connection and try again.'));
				});

				xhr.addEventListener('abort', () => {
					reject(new Error('Upload cancelled'));
				});

				xhr.addEventListener('timeout', () => {
					reject(new Error('Upload timed out. Please try again with a smaller file or check your connection.'));
				});

				xhr.open('PUT', uploadReq.uploadUrl);
				xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
				xhr.send(file);
			});

			// Update progress to 90% (R2 upload complete)
			setUploadingFiles(prev => prev.map(uf =>
				uf.file === file ? { ...uf, progress: 90 } : uf
			));

			// Step 3: Confirm upload (triggers validation/PDF/indexing, appends to task.file_ids)
			const confirmed = await confirmTaskFileUpload({
				taskId,
				fileId: uploadReq.fileId,
			});

			// Update progress to 100% (complete)
			setUploadingFiles(prev => prev.map(uf =>
				uf.file === file ? { ...uf, progress: 100 } : uf
			));

			// Convert TaskFileMetadata to FileMetadata format (add organizationId)
			// organizationId is derived from auth context server-side, hardcode empty for display purposes
			const fileMetadata: FileMetadata = {
				id: confirmed.file.id,
				organizationId: '', // Not needed for display, derived from context
				originalFilename: confirmed.file.originalFilename,
				storageKey: confirmed.file.storageKey,
				sizeBytes: confirmed.file.sizeBytes,
				mimeType: confirmed.file.mimeType,
				uploadContext: confirmed.file.uploadContext as 'chat' | 'avatar' | 'docs' | 'project',
				uploadedByEmployeeId: confirmed.file.uploadedByEmployeeId,
				updatedAt: confirmed.file.updatedAt,
				isDeleted: confirmed.file.isDeleted,
				validationStatus: confirmed.file.validationStatus,
				validationMessage: confirmed.file.validationMessage,
				detectedMimeType: confirmed.file.detectedMimeType,
			};

			// Call success callback with file metadata
			onUploadComplete(fileMetadata);

			// Remove from uploading list after 1 second
			setTimeout(() => {
				setUploadingFiles(prev => prev.filter(uf => uf.file !== uploadingFile.file));
			}, 1000);

		} catch (error) {
			throw error;
		}
	};

	const handleRemoveUploadingFile = (uploadingFile: UploadingFile) => {
		setUploadingFiles(prev => prev.filter(uf => uf.file !== uploadingFile.file));
	};

	const handleButtonClick = () => {
		fileInputRef.current?.click();
	};

	return (
		<Box sx={{ mt: 2 }}>
			{/* Hidden file input */}
			<input
				ref={fileInputRef}
				type="file"
				multiple={multiple}
				onChange={handleFileSelect}
				style={{ display: 'none' }}
				data-testid="task-file-input"
			/>

			{/* Upload button */}
			<Button
				variant="outlined"
				startIcon={<AttachFileIcon />}
				onClick={handleButtonClick}
				size="small"
				data-testid="task-upload-button"
				sx={{
					borderColor: colors.border.default.style.borderColor,
					color: colors.text.primary.style.color,
					'&:hover': {
						borderColor: colors.primary.main.style.backgroundColor,
						backgroundColor: colors.bg.hover,
					},
				}}
			>
				Attach {multiple ? 'Files' : 'File'}
			</Button>

			{/* General error */}
			{generalError && (
				<Alert severity="error" sx={{ mt: 1 }} onClose={() => setGeneralError(null)}>
					{generalError}
				</Alert>
			)}

			{/* Uploading files list */}
			{uploadingFiles.length > 0 && (
				<Box sx={{ mt: 1 }}>
					{uploadingFiles.map((uf, index) => (
						<Box
							key={index}
							sx={{
								mb: 1,
								p: 1,
								border: `1px solid ${colors.border.default.style.borderColor}`,
								borderRadius: 1,
								backgroundColor: colors.bg.paper.style.backgroundColor,
							}}
						>
							<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
								<Typography
									variant="body2"
									sx={{
										color: colors.text.primary.style.color,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
										flex: 1,
										mr: 1,
										fontSize: '0.8rem',
									}}
								>
									{uf.file.name}
								</Typography>
								{uf.error && (
									<IconButton
										size="small"
										onClick={() => handleRemoveUploadingFile(uf)}
										data-testid={`remove-failed-task-file-${index}`}
									>
										<CloseIcon fontSize="small" />
									</IconButton>
								)}
							</Box>

							{uf.error ? (
								<Typography variant="caption" color='error'>
									{uf.error}
								</Typography>
							) : (
								<>
									<LinearProgress
										variant="determinate"
										value={uf.progress}
										sx={{
											height: 3,
											borderRadius: 2,
											backgroundColor: colors.bg.hover,
											'& .MuiLinearProgress-bar': {
												backgroundColor: colors.primary.main.style.backgroundColor,
											},
										}}
									/>
									<Typography variant="caption" sx={{ color: colors.text.secondary.style.color, fontSize: '0.7rem' }}>
										{Math.round(uf.progress)}%
									</Typography>
								</>
							)}
						</Box>
					))}
				</Box>
			)}
		</Box>
	);
}
