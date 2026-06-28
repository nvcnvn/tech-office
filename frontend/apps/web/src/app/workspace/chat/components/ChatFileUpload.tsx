/**
 * Chat File Upload Component
 * 
 * Feature: 015-file-storage-security-and-access
 * Architecture: Domain-owned upload flow
 * 
 * Simple file upload component for chat attachments using:
 * - requestChannelFileUpload (verifies channel membership, derives access scope)
 * - Direct R2 upload
 * - confirmChannelFileUpload (triggers validation/PDF/indexing workflows)
 */

'use client';

import React, { useState, useRef } from 'react';
import { Box, Button, Typography, LinearProgress, IconButton, Alert } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CloseIcon from '@mui/icons-material/Close';
import { requestChannelFileUpload, confirmChannelFileUpload, ChatFileMetadata } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

interface ChatFileUploadProps {
	channelId: string;
	onUploadComplete: (file: ChatFileMetadata) => void;
	onUploadError?: (error: Error) => void;
	maxSizeBytes?: number;
	multiple?: boolean;
}

interface UploadingFile {
	file: File;
	progress: number;
	error?: string;
	fileId?: string;
}

export default function ChatFileUpload({
	channelId,
	onUploadComplete,
	onUploadError,
	maxSizeBytes = 100 * 1024 * 1024, // 100MB default
	multiple = false,
}: ChatFileUploadProps) {
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
				console.error('[ChatFileUpload] Upload failed:', error);
				const err = error as Error;

				// Update file with error
				setUploadingFiles(prev => prev.map(uf =>
					uf.file === uploadingFile.file
						? { ...uf, error: err.message }
						: uf
				));

				// Call error callback
				if (onUploadError) {
					onUploadError(err);
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
			const uploadReq = await requestChannelFileUpload({
				channelId,
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

			// Step 3: Confirm upload (triggers validation/PDF/indexing)
			const confirmedFile = await confirmChannelFileUpload({
				channelId,
				fileId: uploadReq.fileId,
			});

			// Update progress to 100% (complete)
			setUploadingFiles(prev => prev.map(uf =>
				uf.file === file ? { ...uf, progress: 100 } : uf
			));

			// Call success callback
			onUploadComplete(confirmedFile);

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
		<Box sx={{ p: 2 }}>
			{/* Hidden file input */}
			<input
				ref={fileInputRef}
				type="file"
				multiple={multiple}
				onChange={handleFileSelect}
				style={{ display: 'none' }}
				data-testid="chat-file-input"
			/>

			{/* Upload button */}
			<Button
				variant="outlined"
				startIcon={<CloudUploadIcon />}
				onClick={handleButtonClick}
				fullWidth
				data-testid="chat-upload-button"
				sx={{
					borderColor: colors.border.default.style.borderColor,
					color: colors.text.primary.style.color,
					'&:hover': {
						borderColor: colors.primary.main.style.backgroundColor,
						backgroundColor: colors.bg.hover,
					},
				}}
			>
				Choose {multiple ? 'Files' : 'File'}
			</Button>

			{/* General error */}
			{generalError && (
				<Alert severity="error" sx={{ mt: 2 }} onClose={() => setGeneralError(null)}>
					{generalError}
				</Alert>
			)}

			{/* Uploading files list */}
			{uploadingFiles.length > 0 && (
				<Box sx={{ mt: 2 }}>
					{uploadingFiles.map((uf, index) => (
						<Box
							key={index}
							sx={{
								mb: 2,
								p: 1.5,
								border: `1px solid ${colors.border.default.style.borderColor}`,
								borderRadius: 1,
								backgroundColor: colors.bg.paper.style.backgroundColor,
							}}
						>
							<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
								<Typography
									variant="body2"
									sx={{
										color: colors.text.primary.style.color,
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
										flex: 1,
										mr: 1,
									}}
								>
									{uf.file.name}
								</Typography>
								{uf.error && (
									<IconButton
										size="small"
										onClick={() => handleRemoveUploadingFile(uf)}
										data-testid={`remove-failed-${index}`}
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
											height: 4,
											borderRadius: 2,
											backgroundColor: colors.bg.hover,
											'& .MuiLinearProgress-bar': {
												backgroundColor: colors.primary.main.style.backgroundColor,
											},
										}}
									/>
									<Typography variant="caption" sx={{ color: colors.text.secondary.style.color, mt: 0.5 }}>
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
