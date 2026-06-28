/**
 * Files Tab Component
 * 
 * Feature: 015-file-storage-security-and-access
 * 
 * Displays file search results with:
 * - File icon, name, and size
 * - Validation status badge
 * - Context breadcrumb (e.g., "Engineering > #general")
 * - Uploaded by and date
 * - Text excerpt (if content match)
 * - Pagination
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
	Box,
	Typography,
	Card,
	CardContent,
	CardActionArea,
	Chip,
	CircularProgress,
	Button,
	Alert,
} from '@mui/material';
import {
	InsertDriveFile,
	PictureAsPdf,
	Image as ImageIcon,
	Description,
	TableChart,
	Slideshow,
	Code,
	Archive,
	VideoFile,
	AudioFile,
	FolderOpen,
} from '@mui/icons-material';
import { searchFiles, type FileSearchResult } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import FileValidationBadge, { type ValidationStatus } from '@/components/files/FileValidationBadge';

interface FilesTabProps {
	query: string;
}

// Helper function to get file icon based on MIME type
const getFileIconByMimeType = (mimeType: string) => {
	// Images
	if (mimeType.startsWith('image/')) {
		return <ImageIcon sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// PDF
	if (mimeType === 'application/pdf') {
		return <PictureAsPdf sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// Word documents
	if (
		mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
		mimeType === 'application/msword'
	) {
		return <Description sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// Spreadsheets
	if (
		mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
		mimeType === 'application/vnd.ms-excel' ||
		mimeType === 'text/csv'
	) {
		return <TableChart sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// Presentations
	if (
		mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
		mimeType === 'application/vnd.ms-powerpoint'
	) {
		return <Slideshow sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// Code files
	if (
		mimeType === 'text/plain' ||
		mimeType === 'application/json' ||
		mimeType === 'application/xml' ||
		mimeType.includes('javascript') ||
		mimeType.includes('typescript')
	) {
		return <Code sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// Archives
	if (
		mimeType === 'application/zip' ||
		mimeType === 'application/x-rar-compressed' ||
		mimeType === 'application/x-7z-compressed'
	) {
		return <Archive sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// Video
	if (mimeType.startsWith('video/')) {
		return <VideoFile sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// Audio
	if (mimeType.startsWith('audio/')) {
		return <AudioFile sx={{ color: 'text.secondary', fontSize: 32 }} />;
	}

	// Default
	return <InsertDriveFile sx={{ color: 'text.secondary', fontSize: 32 }} />;
};

// Helper function to format file size
function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Helper function to format context type for display
function formatContextType(contextType: string): string {
	return contextType.split('_').map(word =>
		word.charAt(0).toUpperCase() + word.slice(1)
	).join(' ');
}

export default function FilesTab({ query }: FilesTabProps) {
	const colors = useThemeColors();
	const [results, setResults] = useState<FileSearchResult[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [totalCount, setTotalCount] = useState(0);
	const [hasMore, setHasMore] = useState(false);
	const [offset, setOffset] = useState(0);
	const limit = 20;

	// Load search results
	useEffect(() => {
		if (!query.trim()) {
			setResults([]);
			setLoading(false);
			return;
		}

		const performSearch = async () => {
			setLoading(true);
			setError(null);

			try {
				const searchResult = await searchFiles({
					query: query.trim(),
					limit,
					offset,
				});
				setResults(prev => offset === 0 ? searchResult.results : [...prev, ...searchResult.results]);
				setTotalCount(searchResult.totalCount);
				setHasMore(searchResult.hasMore);
			} catch (err) {
				console.error('[FilesTab] Search failed:', err);
				setError(err instanceof Error ? err.message : 'Failed to search files');
			} finally {
				setLoading(false);
			}
		};

		performSearch();
	}, [query, offset]);

	// Reset offset when query changes
	useEffect(() => {
		setOffset(0);
	}, [query]);

	const handleLoadMore = () => {
		setOffset(prev => prev + limit);
	};

	// Loading state (initial)
	if (loading && results.length === 0) {
		return (
			<Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
				<CircularProgress />
			</Box>
		);
	}

	// Error state
	if (error && results.length === 0) {
		return (
			<Alert severity="error" sx={{ mt: 2 }}>
				{error}
			</Alert>
		);
	}

	// Empty state
	if (results.length === 0) {
		return (
			<Box sx={{ textAlign: 'center', py: 8 }}>
				<FolderOpen sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
				<Typography variant="h6" gutterBottom>
					No files found
				</Typography>
				<Typography variant="body2" color="text.secondary">
					Try different search terms or check if you have access to the files you&apos;re looking for.
				</Typography>
			</Box>
		);
	}

	// Results
	return (
		<Box>
			{/* Results summary */}
			<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
				{totalCount} file{totalCount === 1 ? '' : 's'} found
			</Typography>

			{/* Results list */}
			<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
				{results.map((result) => (
					<Card
						key={result.fileId}
						variant="outlined"
						sx={{
							transition: 'border-color 0.2s',
							'&:hover': {
								borderColor: 'text.disabled',
							},
						}}
					>
						<CardActionArea
							sx={{ p: 2 }}
							data-testid={`file-result-${result.fileId}`}
						>
							<CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
								<Box sx={{ display: 'flex', gap: 2 }}>
									{/* File icon */}
									<Box sx={{ flexShrink: 0 }}>
										{getFileIconByMimeType(result.mimeType)}
									</Box>

									{/* File details */}
									<Box sx={{ flex: 1, minWidth: 0 }}>
										{/* Filename with validation badge */}
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
											<Typography
												variant="body1"
												sx={{
													fontWeight: 500,
													overflow: 'hidden',
													textOverflow: 'ellipsis',
													whiteSpace: 'nowrap',
													...colors.text.primary.style,
												}}
											>
												{result.filename}
											</Typography>
											<FileValidationBadge
												validationStatus={result.validationStatus as ValidationStatus}
											/>
										</Box>

										{/* File size and context */}
										<Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
											<Typography variant="caption" sx={colors.text.secondary.style}>
												{formatBytes(result.sizeBytes)}
											</Typography>
											<Typography variant="caption" sx={colors.text.secondary.style}>
												•
											</Typography>
											<Chip
												label={formatContextType(result.contextType)}
												size="small"
												variant="outlined"
												sx={{ height: 20, fontSize: '0.7rem' }}
											/>
											{result.contextDisplayName && (
												<>
													<Typography variant="caption" sx={colors.text.secondary.style}>
														•
													</Typography>
													<Typography variant="caption" sx={colors.text.secondary.style}>
														{result.contextDisplayName}
													</Typography>
												</>
											)}
										</Box>

										{/* Excerpt (if available) */}
										{result.excerpt && (
											<Typography
												variant="body2"
												sx={{
													...colors.text.secondary.style,
													mb: 1,
													fontStyle: 'italic',
												}}
											>
												...{result.excerpt}...
											</Typography>
										)}

										{/* Uploaded by and date */}
										<Typography variant="caption" sx={colors.text.secondary.style}>
											Uploaded by {result.uploadedBy} on{' '}
											{result.uploadedAt.toLocaleDateString()}
										</Typography>
									</Box>
								</Box>
							</CardContent>
						</CardActionArea>
					</Card>
				))}
			</Box>

			{/* Load more button */}
			{hasMore && (
				<Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
					<Button
						variant="outlined"
						onClick={handleLoadMore}
						disabled={loading}
						data-testid="files-load-more"
					>
						{loading ? 'Loading...' : 'Load More'}
					</Button>
				</Box>
			)}

			{/* Error state (during load more) */}
			{error && results.length > 0 && (
				<Alert severity="error" sx={{ mt: 2 }}>
					{error}
				</Alert>
			)}
		</Box>
	);
}
