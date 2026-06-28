/**
 * FilePreviewModal Component
 * Modal for previewing various file types
 * 
 * Features:
 * - PDF preview with react-pdf
 * - Image preview with zoom/pan
 * - Download button for all files
 * - Unsupported file type fallback
 * - Theme system colors
 * - Handles deleted files
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
	Dialog,
	DialogContent,
	DialogTitle,
	IconButton,
	Box,
	Typography,
	Button,
	CircularProgress,
} from '@mui/material';
import {
	Close,
	Download,
	Warning,
	InsertDriveFile,
} from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';
import { getDownloadUrl, getFileMetadata, getPDFConversionStatus } from 'apis';
import type { PDFConversionInfo } from 'apis';
import dynamic from 'next/dynamic';

// Dynamically import viewers to prevent SSR issues with react-pdf
const PDFViewer = dynamic(() => import('./PDFViewer'), {
	ssr: false,
	loading: () => (
		<Box
			sx={{
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				minHeight: 400,
			}}
		>
			<CircularProgress />
		</Box>
	),
});

const ImageViewer = dynamic(() => import('./ImageViewer'), {
	ssr: false,
	loading: () => (
		<Box
			sx={{
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				minHeight: 400,
			}}
		>
			<CircularProgress />
		</Box>
	),
});

export interface FilePreviewModalProps {
	open: boolean;
	onClose: () => void;
	fileId: string;
	filename: string;
}

// Supported file types for preview
const PDF_MIME_TYPES = ['application/pdf'];
const IMAGE_MIME_TYPES = [
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/bmp',
	'image/svg+xml',
];
const OFFICE_MIME_TYPES = [
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
	'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
	'application/msword', // .doc
	'application/vnd.ms-excel', // .xls
	'application/vnd.ms-powerpoint', // .ppt
];

// Helper to determine file type from filename
const getMimeTypeFromFilename = (filename: string): string | null => {
	const ext = filename.split('.').pop()?.toLowerCase();

	const mimeMap: Record<string, string> = {
		pdf: 'application/pdf',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		bmp: 'image/bmp',
		svg: 'image/svg+xml',
	};

	return ext ? mimeMap[ext] || null : null;
};

export default function FilePreviewModal({
	open,
	onClose,
	fileId,
	filename,
}: FilePreviewModalProps) {
	const colors = useThemeColors();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
	const [isDeleted, setIsDeleted] = useState(false);
	const [deletionReason, setDeletionReason] = useState<string | null>(null);
	const [mimeType, setMimeType] = useState<string | null>(null);
	const [pdfConversion, setPdfConversion] = useState<PDFConversionInfo | null>(null);
	const [triggeringConversion, setTriggeringConversion] = useState(false);

	const loadFileData = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			setDownloadUrl(null);
			setIsDeleted(false);

			// Fetch both download URL and metadata in parallel
			const [urlResult, metadataResult] = await Promise.all([
				getDownloadUrl(fileId),
				getFileMetadata(fileId),
			]);

			if (urlResult.isDeleted) {
				setIsDeleted(true);
				setDeletionReason(urlResult.deletionInfo?.deletionReason || 'File has been deleted');
			} else if (urlResult.downloadUrl) {
				setDownloadUrl(urlResult.downloadUrl);
				// Prefer server-reported MIME type (office docs won't be detected from filename map)
				const detectedMimeType =
					metadataResult.file.detectedMimeType ||
					metadataResult.file.mimeType ||
					getMimeTypeFromFilename(filename);
				setMimeType(detectedMimeType);

				// Set PDF conversion status from initial metadata fetch (WITHOUT URL)
				// For security, PDF URL is fetched separately via getPDFConversionStatus
				if (metadataResult.file.pdfConversionStatus) {
					setPdfConversion({
						status: metadataResult.file.pdfConversionStatus,
					});

					// If conversion completed, fetch presigned PDF URL with access check
					if (metadataResult.file.pdfConversionStatus === 'completed') {
						try {
							const pdfInfo = await getPDFConversionStatus(fileId);
							setPdfConversion(pdfInfo);
						} catch (err) {
							console.error('[FilePreviewModal] Failed to get PDF URL:', err);
							// Don't set error - preview is optional
						}
					}
				}
			}
		} catch (err) {
			console.error('[FilePreviewModal] Failed to load file data:', err);
			const errorMessage = err instanceof Error ? err.message : 'Failed to load file';
			setError(errorMessage);
		} finally {
			setLoading(false);
		}
	}, [fileId, filename]);

	// Load file URL and initial metadata when modal opens
	useEffect(() => {
		if (open && fileId) {
			// Reset state on open to fetch fresh data
			setPdfConversion(null);
			loadFileData();
		}
	}, [open, fileId, loadFileData]);

	// Poll file metadata for PDF conversion status (office documents only)
	useEffect(() => {
		if (!open || !mimeType || !OFFICE_MIME_TYPES.includes(mimeType)) {
			return;
		}

		let pollInterval: NodeJS.Timeout | null = null;

		const pollConversionStatus = async () => {
			try {
				const metadata = await getFileMetadata(fileId);

				// Update conversion status (WITHOUT URL for security)
				if (metadata.file.pdfConversionStatus) {
					setPdfConversion({
						status: metadata.file.pdfConversionStatus,
					});

					// When conversion completes, fetch presigned PDF URL with access check
					if (metadata.file.pdfConversionStatus === 'completed') {
						try {
							const pdfInfo = await getPDFConversionStatus(fileId);
							setPdfConversion(pdfInfo);
						} catch (err) {
							console.error('[FilePreviewModal] Failed to get PDF URL:', err);
							// Don't set error - preview is optional
						}

						// Stop polling after completion
						if (pollInterval) {
							clearInterval(pollInterval);
							pollInterval = null;
						}
					}

					// Stop polling on failure
					if (metadata.file.pdfConversionStatus === 'failed') {
						if (pollInterval) {
							clearInterval(pollInterval);
							pollInterval = null;
						}
					}
				}
			} catch (err) {
				console.error('[FilePreviewModal] Failed to poll file metadata:', err);
				// Don't set error - conversion is optional enhancement
			}
		};

		// Initial check
		pollConversionStatus();

		// Poll every 2 seconds for pending/in_progress conversions
		pollInterval = setInterval(pollConversionStatus, 2000);

		return () => {
			if (pollInterval) {
				clearInterval(pollInterval);
			}
		};
	}, [open, fileId, mimeType]);

	const handleDownload = () => {
		if (downloadUrl) {
			window.open(downloadUrl, '_blank');
		}
	};

	const handleTriggerConversion = async () => {
		try {
			setTriggeringConversion(true);
			setError(null);
			// Trigger conversion via getFileMetadata (which will return pending status)
			const metadata = await getFileMetadata(fileId);
			if (metadata.file.pdfConversionStatus) {
				setPdfConversion({
					status: metadata.file.pdfConversionStatus,
				});
			}
		} catch (err) {
			console.error('[FilePreviewModal] Failed to trigger PDF conversion:', err);
			const errorMessage = err instanceof Error ? err.message : 'Failed to trigger conversion';
			setError(errorMessage);
		} finally {
			setTriggeringConversion(false);
		}
	};

	const handleViewerError = (err: Error) => {
		console.error('[FilePreviewModal] Viewer error:', err);
		setError(err.message);
	};

	const renderPreviewContent = () => {
		// Loading state
		if (loading) {
			return (
				<Box
					sx={{
						display: 'flex',
						justifyContent: 'center',
						alignItems: 'center',
						minHeight: 400,
						...colors.bg.default.style,
					}}
				>
					<CircularProgress />
				</Box>
			);
		}

		// Deleted file
		if (isDeleted) {
			return (
				<Box
					sx={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: 2,
						padding: 4,
						minHeight: 400,
						...colors.bg.default.style,
					}}
				>
					<Warning color="error" sx={{ fontSize: 60 }} />
					<Typography variant="h6" color="error">
						File Deleted
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						{deletionReason}
					</Typography>
				</Box>
			);
		}

		// Error state
		if (error || !downloadUrl) {
			return (
				<Box
					sx={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: 2,
						padding: 4,
						minHeight: 400,
						...colors.bg.default.style,
					}}
				>
					<Warning color="error" sx={{ fontSize: 60 }} />
					<Typography variant="h6" color="error">
						Failed to Load File
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
						{error || 'Unable to load file preview'}
					</Typography>
					<Button
						variant="contained"
						onClick={loadFileData}
						data-testid="preview-retry-button"
					>
						Retry
					</Button>
				</Box>
			);
		}

		// Office document with PDF conversion
		if (mimeType && OFFICE_MIME_TYPES.includes(mimeType)) {
			// Conversion pending or in progress
			if (pdfConversion && (pdfConversion.status === 'pending' || pdfConversion.status === 'in_progress')) {
				return (
					<Box
						sx={{
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: 2,
							padding: 4,
							minHeight: 400,
							...colors.bg.default.style,
						}}
					>
						<CircularProgress />
						<Typography variant="h6" sx={{ ...colors.text.primary.style }}>
							Converting Document to PDF
						</Typography>
						<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
							This may take a few moments...
						</Typography>
					</Box>
				);
			}

			// Conversion completed - show PDF preview
			if (pdfConversion && pdfConversion.status === 'completed' && pdfConversion.pdfUrl) {
				return (
					<PDFViewer
						fileUrl={pdfConversion.pdfUrl}
						onError={handleViewerError}
					/>
				);
			}

			// Conversion failed - show error with retry option
			if (pdfConversion && pdfConversion.status === 'failed') {
				return (
					<Box
						sx={{
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							gap: 2,
							padding: 4,
							minHeight: 400,
							...colors.bg.default.style,
						}}
					>
						<Warning color="error" sx={{ fontSize: 60 }} />
						<Typography variant="h6" color="error">
							PDF Conversion Failed
						</Typography>
						<Typography variant="body2" sx={{ ...colors.text.secondary.style, textAlign: 'center' }}>
							{pdfConversion.error || 'Unable to convert document to PDF'}
						</Typography>
						<Box sx={{ display: 'flex', gap: 2 }}>
							<Button
								variant="outlined"
								onClick={handleTriggerConversion}
								disabled={triggeringConversion}
								data-testid="trigger-conversion-button"
							>
								{triggeringConversion ? 'Converting...' : 'Retry Conversion'}
							</Button>
							<Button
								variant="contained"
								startIcon={<Download />}
								onClick={handleDownload}
								data-testid="download-original-button"
							>
								Download Original
							</Button>
						</Box>
					</Box>
				);
			}

			// No conversion available yet - show download option
			return (
				<Box
					sx={{
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: 3,
						padding: 6,
						minHeight: 400,
						...colors.bg.default.style,
					}}
				>
					<InsertDriveFile sx={{ fontSize: 80, ...colors.text.secondary.style }} />
					<Typography variant="h6" sx={{ ...colors.text.primary.style }}>
						Office Document
					</Typography>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, textAlign: 'center' }}>
						PDF conversion is being processed.
						<br />
						Download the original file to view it now.
					</Typography>
					<Button
						variant="contained"
						startIcon={<Download />}
						onClick={handleDownload}
						data-testid="preview-download-button"
					>
						Download {filename}
					</Button>
				</Box>
			);
		}

		// PDF Preview
		if (mimeType && PDF_MIME_TYPES.includes(mimeType)) {
			return (
				<PDFViewer
					fileUrl={downloadUrl}
					onError={handleViewerError}
				/>
			);
		}

		// Image Preview
		if (mimeType && IMAGE_MIME_TYPES.includes(mimeType)) {
			return (
				<ImageViewer
					fileUrl={downloadUrl}
					filename={filename}
					onError={handleViewerError}
				/>
			);
		}

		// Unsupported file type - show download option
		return (
			<Box
				sx={{
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: 3,
					padding: 6,
					minHeight: 400,
					...colors.bg.default.style,
				}}
			>
				<InsertDriveFile sx={{ fontSize: 80, ...colors.text.secondary.style }} />
				<Typography variant="h6" sx={{ ...colors.text.primary.style }}>
					Preview Not Available
				</Typography>
				<Typography variant="body2" sx={{ ...colors.text.secondary.style, textAlign: 'center' }}>
					This file type cannot be previewed in the browser.
					<br />
					Click the download button to view it on your device.
				</Typography>
				<Button
					variant="contained"
					startIcon={<Download />}
					onClick={handleDownload}
					data-testid="preview-download-button"
				>
					Download {filename}
				</Button>
			</Box>
		);
	};

	return (
		<Dialog
			open={open}
			onClose={onClose}
			maxWidth="lg"
			fullWidth
			PaperProps={{
				sx: {
					height: '90vh',
					maxHeight: 900,
					...colors.bg.paper.style,
				},
			}}
			data-testid="file-preview-modal"
		>
			<DialogTitle
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					...colors.bg.elevated.style,
					borderBottom: 1,
					borderColor: 'divider',
				}}
				className={colors.border.default.className}
			>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0 }}>
					<Typography
						variant="h6"
						sx={{
							...colors.text.primary.style,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{filename}
					</Typography>
				</Box>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					{downloadUrl && !isDeleted && (
						<IconButton
							onClick={handleDownload}
							size="small"
							data-testid="preview-header-download-button"
							sx={{ ...colors.text.primary.style }}
						>
							<Download />
						</IconButton>
					)}
					<IconButton
						onClick={onClose}
						size="small"
						data-testid="preview-close-button"
						sx={{ ...colors.text.primary.style }}
					>
						<Close />
					</IconButton>
				</Box>
			</DialogTitle>
			<DialogContent
				sx={{
					padding: 0,
					display: 'flex',
					flexDirection: 'column',
					overflow: 'hidden',
				}}
			>
				{renderPreviewContent()}
			</DialogContent>
		</Dialog>
	);
}
