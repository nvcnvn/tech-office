/**
 * FileAttachment Component
 * Displays a file attachment card with preview and download functionality
 * 
 * Features:
 * - File icon and name display
 * - Click to preview (PDF, images)
 * - Download button
 * - Handles deleted files with warning
 * - Theme system colors
 */

'use client';

import React, { useState } from 'react';
import { Box, Typography, Link, CircularProgress, Tooltip } from '@mui/material';
import {
	InsertDriveFile,
	Warning,
	PictureAsPdf,
	Image as ImageIcon,
	Description,
	TableChart,
	Slideshow,
	Code,
	Archive,
	VideoFile,
	AudioFile,
} from '@mui/icons-material';
import { getDownloadUrl } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import FilePreviewModal from './FilePreviewModal';
import FileValidationBadge, { type ValidationStatus } from '@/components/files/FileValidationBadge';

export interface FileAttachmentProps {
	fileId: string;
	filename: string;
	validationStatus?: string;
	validationMessage?: string;
	onDownloadError?: (error: Error) => void;
}

// Helper function to get file icon based on extension
const getFileIcon = (filename: string) => {
	const ext = filename.split('.').pop()?.toLowerCase() || '';

	// Images
	if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) {
		return <ImageIcon sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// PDF
	if (ext === 'pdf') {
		return <PictureAsPdf sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// Word documents
	if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
		return <Description sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// Spreadsheets
	if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) {
		return <TableChart sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// Presentations
	if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) {
		return <Slideshow sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// Code files
	if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'html', 'css', 'json', 'xml', 'yaml', 'yml', 'md', 'sql', 'sh'].includes(ext)) {
		return <Code sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// Archives
	if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) {
		return <Archive sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// Video
	if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v'].includes(ext)) {
		return <VideoFile sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// Audio
	if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'].includes(ext)) {
		return <AudioFile sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
	}

	// Default
	return <InsertDriveFile sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />;
};

export default function FileAttachment({
	fileId,
	filename,
	validationStatus,
	validationMessage,
	onDownloadError,
}: FileAttachmentProps) {
	const colors = useThemeColors();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isDeleted, setIsDeleted] = useState(false);
	const [deletionReason, setDeletionReason] = useState<string | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);

	const handleClick = async () => {
		// Check if file is deleted first
		try {
			setLoading(true);
			setError(null);

			const { downloadUrl, isDeleted: deleted, deletionInfo } = await getDownloadUrl(fileId);

			if (deleted) {
				setIsDeleted(true);
				setDeletionReason(deletionInfo?.deletionReason || 'File has been deleted');
			} else if (downloadUrl) {
				// Check if file can be previewed
				const ext = filename.split('.').pop()?.toLowerCase();
				const previewableExtensions = [
					'pdf',
					'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
					'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', // Office documents
				];

				if (ext && previewableExtensions.includes(ext)) {
					// Open preview modal
					setPreviewOpen(true);
				} else {
					// Direct download for non-previewable files
					window.open(downloadUrl, '_blank');
				}
			}
		} catch (err) {
			console.error('[FileAttachment] Failed to load file:', err);
			const errorMessage = err instanceof Error ? err.message : 'Failed to load file';
			setError(errorMessage);
			onDownloadError?.(err instanceof Error ? err : new Error(errorMessage));
		} finally {
			setLoading(false);
		}
	};

	return (
		<Box
			sx={{
				display: 'flex',
				alignItems: 'center',
				gap: 1,
				padding: 1,
				borderRadius: 1,
				border: 1,
				borderColor: isDeleted ? 'error.main' : 'divider',
				backgroundColor: isDeleted ? 'error.light' : colors.bg.elevated.style.backgroundColor,
				transition: 'border-color 0.2s',
				'&:hover': {
					borderColor: 'text.disabled',
				},
				minWidth: 0, // Allow shrinking in grid
			}}
			data-testid="message-file-attachment"
		>
			{isDeleted ? (
				<Warning color="error" fontSize="small" />
			) : (
				getFileIcon(filename)
			)}

			<Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
				{isDeleted ? (
					<Tooltip title={filename} placement="top" arrow>
						<Typography
							variant="body2"
							sx={{
								...colors.text.primary.style,
								fontWeight: 500,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
								fontSize: '0.875rem',
							}}
						>
							{filename}
						</Typography>
					</Tooltip>
				) : (
					<Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
						<Tooltip title={`Click to preview: ${filename}`} placement="top" arrow>
							<Link
								component="button"
								variant="body2"
								onClick={handleClick}
								disabled={loading}
								underline="hover"
								sx={{
									...colors.text.primary.style,
									fontWeight: 500,
									overflow: 'hidden',
									textOverflow: 'ellipsis',
									whiteSpace: 'nowrap',
									fontSize: '0.875rem',
									cursor: loading ? 'wait' : 'pointer',
									textAlign: 'left',
									color: 'primary.main',
									'&:hover': {
										color: 'primary.dark',
									},
									display: 'flex',
									alignItems: 'center',
									gap: 0.5,
									minWidth: 0,
								}}
								data-testid="file-attachment-preview-link"
							>
								{loading && <CircularProgress size={14} />}
								{filename}
							</Link>
						</Tooltip>
						{validationStatus && (
							<FileValidationBadge
								validationStatus={validationStatus as ValidationStatus}
								validationMessage={validationMessage}
							/>
						)}
					</Box>
				)}

				{isDeleted && (
					<Typography variant="caption" color="error" sx={{ fontSize: '0.7rem' }}>
						Deleted: {deletionReason}
					</Typography>
				)}
				{error && (
					<Typography variant="caption" color="error" sx={{ fontSize: '0.7rem' }}>
						{error}
					</Typography>
				)}
			</Box>

			{/* File Preview Modal */}
			<FilePreviewModal
				open={previewOpen}
				onClose={() => setPreviewOpen(false)}
				fileId={fileId}
				filename={filename}
			/>
		</Box>
	);
}
