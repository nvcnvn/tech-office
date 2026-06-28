/**
 * ManagementTab Component
 * File management interface with table, sorting, filtering, and batch operations
 * 
 * Features:
 * - File list table with sorting (size, date)
 * - Filtering by upload context
 * - Batch selection with checkboxes
 * - Batch delete with confirmation dialog
 * - Deletion reason input
 * - Pagination controls
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
	Box,
	Typography,
	Paper,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	Checkbox,
	Button,
	IconButton,
	Select,
	MenuItem,
	FormControl,
	InputLabel,
	TextField,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	CircularProgress,
	Alert,
	Chip,
	Pagination,
} from '@mui/material';
import { Delete } from '@mui/icons-material';
import { useThemeColors } from '@/theme/useThemeColors';
import { listFiles, batchDeleteFiles, deleteFile } from 'apis';
import type { FileMetadata, UploadContext } from 'apis';

type SortBy = 'size' | 'updated_at';
type SortOrder = 'asc' | 'desc';

export default function ManagementTab() {
	const colors = useThemeColors();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [files, setFiles] = useState<FileMetadata[]>([]);
	const [totalCount, setTotalCount] = useState(0);
	const [page, setPage] = useState(1);
	const [pageSize] = useState(25);

	// Filters and sorting
	const [filterContext, setFilterContext] = useState<UploadContext | 'all'>('all');
	const [sortBy, setSortBy] = useState<SortBy>('updated_at');
	const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

	// Selection state
	const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

	// Deletion dialog state
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [deletionReason, setDeletionReason] = useState('');
	const [deleting, setDeleting] = useState(false);

	// Load files
	const loadFiles = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);

			const context = filterContext === 'all' ? undefined : filterContext;
			const response = await listFiles({
				uploadContext: context,
				sortBy,
				sortOrder,
				limit: pageSize,
				offset: (page - 1) * pageSize,
			});

			setFiles(response.files);
			setTotalCount(response.totalCount);
		} catch (err) {
			console.error('Failed to load files:', err);
			setError(err instanceof Error ? err.message : 'Failed to load files');
		} finally {
			setLoading(false);
		}
	}, [filterContext, sortBy, sortOrder, page, pageSize]);

	// Load files on mount and when filters/sort change
	useEffect(() => {
		loadFiles();
	}, [loadFiles]);

	// Handle select all
	const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (event.target.checked) {
			setSelectedFileIds(new Set(files.map((f) => f.id)));
		} else {
			setSelectedFileIds(new Set());
		}
	};

	// Handle select single file
	const handleSelectFile = (fileId: string) => {
		const newSelection = new Set(selectedFileIds);
		if (newSelection.has(fileId)) {
			newSelection.delete(fileId);
		} else {
			newSelection.add(fileId);
		}
		setSelectedFileIds(newSelection);
	};

	// Handle batch delete
	const handleBatchDelete = async () => {
		if (selectedFileIds.size === 0) return;

		try {
			setDeleting(true);

			const fileIdsArray = Array.from(selectedFileIds);
			const response = await batchDeleteFiles(fileIdsArray, deletionReason || undefined);

			// Show success message
			alert(
				`Successfully deleted ${response.deletedCount} files. Reclaimed ${formatBytes(Number(response.reclaimedBytes))}.`
			);

			// Clear selection and close dialog
			setSelectedFileIds(new Set());
			setDeleteDialogOpen(false);
			setDeletionReason('');

			// Reload files
			await loadFiles();
		} catch (err) {
			console.error('Failed to delete files:', err);
			setError(err instanceof Error ? err.message : 'Failed to delete files');
		} finally {
			setDeleting(false);
		}
	};

	// Handle single file delete
	const handleSingleDelete = async (fileId: string) => {
		if (!confirm('Are you sure you want to delete this file?')) return;

		try {
			await deleteFile(fileId, 'Deleted from management interface');
			await loadFiles();
		} catch (err) {
			console.error('Failed to delete file:', err);
			setError(err instanceof Error ? err.message : 'Failed to delete file');
		}
	};

	// Format bytes to human-readable string
	const formatBytes = (bytes: number): string => {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
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

	const totalPages = Math.ceil(totalCount / pageSize);
	const isAllSelected = files.length > 0 && selectedFileIds.size === files.length;
	const isSomeSelected = selectedFileIds.size > 0 && selectedFileIds.size < files.length;

	return (
		<Box>
			{/* Error display */}
			{error && (
				<Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
					{error}
				</Alert>
			)}

			{/* Filters and actions */}
			<Paper
				sx={{
					padding: 2,
					marginBottom: 2,
					...colors.bg.paper.style,
					borderRadius: 2,
				}}
			>
				<Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
					{/* Filter by context */}
					<FormControl size="small" sx={{ minWidth: 150 }}>
						<InputLabel>Filter by Context</InputLabel>
						<Select
							value={filterContext}
							onChange={(e) => {
								setFilterContext(e.target.value as UploadContext | 'all');
								setPage(1);
							}}
							label="Filter by Context"
						>
							<MenuItem value="all">All</MenuItem>
							<MenuItem value="chat">Chat</MenuItem>
							<MenuItem value="avatar">Avatar</MenuItem>
							<MenuItem value="docs">Docs</MenuItem>
							<MenuItem value="project">Project</MenuItem>
						</Select>
					</FormControl>

					{/* Sort by */}
					<FormControl size="small" sx={{ minWidth: 150 }}>
						<InputLabel>Sort By</InputLabel>
						<Select
							value={sortBy}
							onChange={(e) => {
								setSortBy(e.target.value as SortBy);
								setPage(1);
							}}
							label="Sort By"
						>
							<MenuItem value="updated_at">Date</MenuItem>
							<MenuItem value="size">Size</MenuItem>
						</Select>
					</FormControl>

					{/* Sort order */}
					<FormControl size="small" sx={{ minWidth: 120 }}>
						<InputLabel>Order</InputLabel>
						<Select
							value={sortOrder}
							onChange={(e) => {
								setSortOrder(e.target.value as SortOrder);
								setPage(1);
							}}
							label="Order"
						>
							<MenuItem value="desc">Descending</MenuItem>
							<MenuItem value="asc">Ascending</MenuItem>
						</Select>
					</FormControl>

					{/* Batch delete button */}
					{selectedFileIds.size > 0 && (
						<Button
							variant="contained"
							color="error"
							startIcon={<Delete />}
							onClick={() => setDeleteDialogOpen(true)}
							data-testid="batch-delete-btn"
						>
							Delete Selected ({selectedFileIds.size})
						</Button>
					)}
				</Box>
			</Paper>

			{/* File table */}
			<TableContainer
				component={Paper}
				sx={{
					...colors.bg.paper.style,
					borderRadius: 2,
				}}
				data-testid="file-table"
			>
				<Table>
					<TableHead>
						<TableRow sx={{ ...colors.bg.elevated.style }}>
							<TableCell padding="checkbox">
								<Checkbox
									checked={isAllSelected}
									indeterminate={isSomeSelected}
									onChange={handleSelectAll}
									disabled={files.length === 0}
								/>
							</TableCell>
							<TableCell sx={colors.text.primary.style}>Filename</TableCell>
							<TableCell sx={colors.text.primary.style}>Size</TableCell>
							<TableCell sx={colors.text.primary.style}>Context</TableCell>
							<TableCell sx={colors.text.primary.style}>Uploaded</TableCell>
							<TableCell sx={colors.text.primary.style}>Actions</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{loading ? (
							<TableRow>
								<TableCell colSpan={6} sx={{ textAlign: 'center', padding: 4 }}>
									<CircularProgress size={24} />
								</TableCell>
							</TableRow>
						) : files.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} sx={{ textAlign: 'center', padding: 4 }}>
									<Typography variant="body2" sx={colors.text.secondary.style}>
										No files found
									</Typography>
								</TableCell>
							</TableRow>
						) : (
							files.map((file) => (
								<TableRow
									key={file.id}
									hover
									sx={{
										'&:hover': {
											backgroundColor: colors.bg.hover,
										},
									}}
								>
									<TableCell padding="checkbox">
										<Checkbox
											checked={selectedFileIds.has(file.id)}
											onChange={() => handleSelectFile(file.id)}
										/>
									</TableCell>
									<TableCell sx={colors.text.primary.style}>{file.originalFilename}</TableCell>
									<TableCell sx={colors.text.secondary.style}>
										{formatBytes(file.sizeBytes)}
									</TableCell>
									<TableCell>
										<Chip
											label={file.uploadContext}
											size="small"
											color={getContextColor(file.uploadContext)}
											variant="outlined"
										/>
									</TableCell>
									<TableCell sx={colors.text.secondary.style}>
										{file.updatedAt.toLocaleDateString()}
									</TableCell>
									<TableCell>
										<IconButton
											size="small"
											color="error"
											onClick={() => handleSingleDelete(file.id)}
										>
											<Delete fontSize="small" />
										</IconButton>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</TableContainer>

			{/* Pagination */}
			{totalPages > 1 && (
				<Box sx={{ display: 'flex', justifyContent: 'center', marginTop: 3 }}>
					<Pagination
						count={totalPages}
						page={page}
						onChange={(_, newPage) => setPage(newPage)}
						color="primary"
					/>
				</Box>
			)}

			{/* Batch delete confirmation dialog */}
			<Dialog
				open={deleteDialogOpen}
				onClose={() => !deleting && setDeleteDialogOpen(false)}
				maxWidth="sm"
				fullWidth
			>
				<DialogTitle sx={colors.text.primary.style}>Delete {selectedFileIds.size} Files?</DialogTitle>
				<DialogContent>
					<Typography variant="body2" sx={{ ...colors.text.secondary.style, marginBottom: 2 }}>
						This action cannot be undone. The files will be permanently deleted from storage.
					</Typography>

					<TextField
						label="Deletion Reason (optional)"
						value={deletionReason}
						onChange={(e) => setDeletionReason(e.target.value)}
						fullWidth
						multiline
						rows={3}
						placeholder="e.g., Cleanup, Policy violation, User request"
						data-testid="delete-reason-input"
					/>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
						Cancel
					</Button>
					<Button
						onClick={handleBatchDelete}
						color="error"
						variant="contained"
						disabled={deleting}
						startIcon={deleting ? <CircularProgress size={16} /> : <Delete />}
					>
						{deleting ? 'Deleting...' : 'Delete'}
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
}
