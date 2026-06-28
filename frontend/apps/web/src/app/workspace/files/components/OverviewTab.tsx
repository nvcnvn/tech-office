/**
 * OverviewTab Component
 * Displays file storage quota usage and recent uploads
 * 
 * Features:
 * - Quota usage progress bar with percentage
 * - Recent uploads list (last 10 files)
 * - Quick stats by upload context
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { useEffect, useState } from 'react';
import {
	Box,
	Typography,
	LinearProgress,
	Paper,
	List,
	ListItem,
	ListItemText,
	Chip,
	CircularProgress,
	Alert,
} from '@mui/material';
import { CloudUpload, Folder, Image as ImageIcon, Description, Work } from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';
import { getQuota, listFiles } from 'apis';
import type { QuotaInfo, FileMetadata } from 'apis';

export default function OverviewTab() {
	const colors = useThemeColors();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [quota, setQuota] = useState<QuotaInfo | null>(null);
	const [recentFiles, setRecentFiles] = useState<FileMetadata[]>([]);

	// Load quota and recent files
	useEffect(() => {
		async function loadData() {
			try {
				setLoading(true);
				setError(null);

				// Load quota info
				const quotaResponse = await getQuota();
				setQuota(quotaResponse.quota);

				// Load recent files (last 10, sorted by updated_at DESC)
				const filesResponse = await listFiles({
					uploadContext: undefined, // all contexts
					sortBy: 'updated_at',
					sortOrder: 'desc',
					limit: 10,
					offset: 0,
				});
				setRecentFiles(filesResponse.files);
			} catch (err) {
				console.error('Failed to load file overview:', err);
				setError(err instanceof Error ? err.message : 'Failed to load data');
			} finally {
				setLoading(false);
			}
		}

		loadData();
	}, []);

	// Format bytes to human-readable string
	const formatBytes = (bytes: number): string => {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
	};

	// Get icon for upload context
	const getContextIcon = (context: string) => {
		switch (context) {
			case 'chat':
				return <CloudUpload fontSize="small" />;
			case 'avatar':
				return <ImageIcon fontSize="small" />;
			case 'docs':
				return <Description fontSize="small" />;
			case 'project':
				return <Work fontSize="small" />;
			default:
				return <Folder fontSize="small" />;
		}
	};

	// Get color for upload context
	const getContextColor = (context: string): 'primary' | 'secondary' | 'success' | 'info' => {
		switch (context) {
			case 'chat':
				return 'primary';
			case 'avatar':
				return 'secondary';
			case 'docs':
				return 'info';
			case 'project':
				return 'success';
			default:
				return 'primary';
		}
	};

	if (loading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '400px',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	if (error) {
		return (
			<Alert severity="error" sx={{ mb: 2 }}>
				{error}
			</Alert>
		);
	}

	if (!quota) {
		return (
			<Alert severity="info">
				No quota information available.
			</Alert>
		);
	}

	const usagePercentage = quota.usagePercentage === -1 ? 0 : quota.usagePercentage;
	const isQuotaExceeded = quota.isQuotaExceeded;

	return (
		<Box>
			{/* Quota Usage Section */}
			<Paper
				sx={{
					padding: 3,
					marginBottom: 3,
					...colors.bg.paper.style,
					borderRadius: 2,
				}}
				data-testid="quota-usage"
			>
				<Typography variant="h6" gutterBottom sx={colors.text.primary.style}>
					Storage Quota
				</Typography>

				<Box sx={{ marginBottom: 2 }}>
					<Box sx={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
						<Typography variant="body2" sx={colors.text.secondary.style}>
							{formatBytes(quota.currentUsageBytes)} used
							{quota.quotaBytes ? ` of ${formatBytes(quota.quotaBytes)}` : ' (unlimited)'}
						</Typography>
						<Typography
							variant="body2"
							sx={{
								...colors.text.secondary.style,
								fontWeight: 'bold',
							}}
						>
							{quota.quotaBytes ? `${usagePercentage.toFixed(1)}%` : 'Unlimited'}
						</Typography>
					</Box>
					<LinearProgress
						variant="determinate"
						value={quota.quotaBytes ? Math.min(usagePercentage, 100) : 0}
						sx={{
							height: 8,
							borderRadius: 4,
							backgroundColor: colors.bg.active.style.backgroundColor,
							'& .MuiLinearProgress-bar': {
								backgroundColor: isQuotaExceeded
									? 'error.main'
									: usagePercentage > 80
										? 'warning.main'
										: 'primary.main',
							},
						}}
					/>
				</Box>

				{isQuotaExceeded && (
					<Alert severity="error" sx={{ marginTop: 2 }}>
						Quota exceeded! Please delete some files or contact your administrator to increase the quota.
					</Alert>
				)}

				<Box sx={{ display: 'flex', gap: 3, marginTop: 2 }}>
					<Box sx={{ flex: 1 }}>
						<Typography variant="caption" sx={colors.text.secondary.style}>
							Max File Size
						</Typography>
						<Typography variant="body1" sx={colors.text.primary.style}>
							{formatBytes(quota.maxFileSizeBytes)}
						</Typography>
					</Box>
					<Box sx={{ flex: 1 }}>
						<Typography variant="caption" sx={colors.text.secondary.style}>
							Total Files
						</Typography>
						<Typography variant="body1" sx={colors.text.primary.style}>
							{recentFiles.length > 0 ? `${recentFiles.length}+ files` : '0 files'}
						</Typography>
					</Box>
				</Box>
			</Paper>

			{/* Recent Files Section */}
			<Paper
				sx={{
					padding: 3,
					...colors.bg.paper.style,
					borderRadius: 2,
				}}
				data-testid="recent-files-list"
			>
				<Typography variant="h6" gutterBottom sx={colors.text.primary.style}>
					Recent Uploads
				</Typography>

				{recentFiles.length === 0 ? (
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, padding: 2 }}>
						No files uploaded yet. Upload your first file to get started!
					</Typography>
				) : (
					<List>
						{recentFiles.map((file) => (
							<ListItem
								key={file.id}
								sx={{
									borderRadius: 1,
									marginBottom: 1,
									'&:hover': {
										backgroundColor: colors.bg.hover,
									},
								}}
							>
								<Box sx={{ marginRight: 2, display: 'flex', alignItems: 'center' }}>
									{getContextIcon(file.uploadContext)}
								</Box>
								<ListItemText
									primary={
										<Typography variant="body2" sx={colors.text.primary.style}>
											{file.originalFilename}
										</Typography>
									}
									secondary={
										<Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
											<Typography variant="caption" sx={colors.text.secondary.style}>
												{formatBytes(file.sizeBytes)}
											</Typography>
											<Typography variant="caption" sx={colors.text.secondary.style}>
												•
											</Typography>
											<Typography variant="caption" sx={colors.text.secondary.style}>
												{file.updatedAt.toLocaleDateString()}
											</Typography>
										</Box>
									}
								/>
								<Chip
									label={file.uploadContext}
									size="small"
									color={getContextColor(file.uploadContext)}
									variant="outlined"
								/>
							</ListItem>
						))}
					</List>
				)}
			</Paper>
		</Box>
	);
}
