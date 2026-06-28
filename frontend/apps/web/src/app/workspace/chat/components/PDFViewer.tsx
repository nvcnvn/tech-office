/**
 * PDFViewer Component
 * Displays PDF files with zoom, pagination, and navigation controls
 * 
 * Features:
 * - Page-by-page navigation
 * - Zoom in/out controls
 * - Page number display
 * - Responsive sizing
 * - Theme system colors
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Box, IconButton, Typography, CircularProgress } from '@mui/material';
import {
	ZoomIn,
	ZoomOut,
	NavigateBefore,
	NavigateNext,
} from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker using CDN (only on client-side)
if (typeof window !== 'undefined') {
	pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

export interface PDFViewerProps {
	fileUrl: string;
	onError?: (error: Error) => void;
}

export default function PDFViewer({ fileUrl, onError }: PDFViewerProps) {
	const colors = useThemeColors();
	const [numPages, setNumPages] = useState<number>(0);
	const [pageNumber, setPageNumber] = useState<number>(1);
	const [scale, setScale] = useState<number>(1.0);
	const [loading, setLoading] = useState<boolean>(true);

	useEffect(() => {
		// Reset state when file changes
		setPageNumber(1);
		setScale(1.0);
		setLoading(true);
	}, [fileUrl]);

	const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
		setNumPages(numPages);
		setLoading(false);
	};

	const onDocumentLoadError = (error: Error) => {
		console.error('[PDFViewer] Failed to load PDF:', error);
		setLoading(false);
		onError?.(error);
	};

	const handleZoomIn = () => {
		setScale((prev) => Math.min(prev + 0.2, 3.0));
	};

	const handleZoomOut = () => {
		setScale((prev) => Math.max(prev - 0.2, 0.5));
	};

	const handlePreviousPage = () => {
		setPageNumber((prev) => Math.max(prev - 1, 1));
	};

	const handleNextPage = () => {
		setPageNumber((prev) => Math.min(prev + 1, numPages));
	};

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				width: '100%',
				overflow: 'hidden',
			}}
			data-testid="pdf-viewer"
		>
			{/* Controls */}
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					padding: 2,
					...colors.bg.elevated.style,
					borderBottom: 1,
					borderColor: 'divider',
				}}
				className={colors.border.default.className}
			>
				{/* Pagination Controls */}
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<IconButton
						onClick={handlePreviousPage}
						disabled={pageNumber <= 1}
						size="small"
						data-testid="pdf-previous-page"
						sx={{ ...colors.text.primary.style }}
					>
						<NavigateBefore />
					</IconButton>
					<Typography variant="body2" sx={{ ...colors.text.primary.style }}>
						Page {pageNumber} of {numPages}
					</Typography>
					<IconButton
						onClick={handleNextPage}
						disabled={pageNumber >= numPages}
						size="small"
						data-testid="pdf-next-page"
						sx={{ ...colors.text.primary.style }}
					>
						<NavigateNext />
					</IconButton>
				</Box>

				{/* Zoom Controls */}
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
					<IconButton
						onClick={handleZoomOut}
						disabled={scale <= 0.5}
						size="small"
						data-testid="pdf-zoom-out"
						sx={{ ...colors.text.primary.style }}
					>
						<ZoomOut />
					</IconButton>
					<Typography variant="body2" sx={{ ...colors.text.primary.style }}>
						{Math.round(scale * 100)}%
					</Typography>
					<IconButton
						onClick={handleZoomIn}
						disabled={scale >= 3.0}
						size="small"
						data-testid="pdf-zoom-in"
						sx={{ ...colors.text.primary.style }}
					>
						<ZoomIn />
					</IconButton>
				</Box>
			</Box>

			{/* PDF Document */}
			<Box
				sx={{
					flex: 1,
					overflow: 'auto',
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'flex-start',
					padding: 2,
					...colors.bg.default.style,
				}}
			>
				{loading && (
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
				)}
				<Document
					file={fileUrl}
					onLoadSuccess={onDocumentLoadSuccess}
					onLoadError={onDocumentLoadError}
					loading={
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
					}
					error={
						<Box
							sx={{
								display: 'flex',
								flexDirection: 'column',
								alignItems: 'center',
								gap: 2,
								padding: 4,
							}}
						>
							<Typography variant="h6" color="error">
								Failed to load PDF
							</Typography>
							<Typography variant="body2" sx={{ ...colors.text.secondary.style }}>
								The PDF file could not be loaded. Please try again.
							</Typography>
						</Box>
					}
				>
					<Page
						pageNumber={pageNumber}
						scale={scale}
						renderAnnotationLayer={true}
						renderTextLayer={true}
					/>
				</Document>
			</Box>
		</Box>
	);
}
