/**
 * DocumentTree Component
 * Hierarchical tree view of documents with expand/collapse
 * 
 * Features:
 * - Lazy loading of children on expand
 * - Create new document (root or child)
 * - Search documents
 * - Drag-and-drop reordering (future)
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
	Box,
	Typography,
	IconButton,
	TextField,
	InputAdornment,
	List,
	ListItemButton,
	ListItemText,
	ListItemIcon,
	Collapse,
	Tooltip,
	CircularProgress,
} from '@mui/material';
import {
	Add as AddIcon,
	Search as SearchIcon,
	ExpandMore as ExpandIcon,
	ChevronRight as ChevronIcon,
	Description as DocIcon,
	FolderOpen as FolderOpenIcon,
	Folder as FolderIcon,
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listDocuments, searchDocuments, type DocumentSummary } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';
import NewDocumentDialog from './NewDocumentDialog';

interface DocumentTreeProps {
	activeDocumentId?: string;
}

export default function DocumentTree({ activeDocumentId }: DocumentTreeProps) {
	const colors = useThemeColors();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [searchQuery, setSearchQuery] = useState('');
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [newDocDialogOpen, setNewDocDialogOpen] = useState(false);
	const [newDocParentId, setNewDocParentId] = useState<string | undefined>();

	// Fetch root documents
	const { data: rootDocs, isLoading: rootLoading, refetch: refetchRoot } = useQuery({
		queryKey: ['docs', 'list', 'root'],
		queryFn: () => listDocuments({ parentDocumentId: undefined, limit: 50 }),
		staleTime: 30000,
	});

	// Search documents
	const { data: searchResults, isLoading: searchLoading } = useQuery({
		queryKey: ['docs', 'search', searchQuery],
		queryFn: () => searchDocuments({ query: searchQuery, limit: 20 }),
		enabled: searchQuery.length >= 2,
		staleTime: 10000,
	});

	const handleDocClick = useCallback((doc: DocumentSummary) => {
		// Use slug for permanent URLs
		router.push(`/workspace/docs?slug=${doc.slug}`);
	}, [router]);

	const handleToggleExpand = useCallback((docId: string, e: React.MouseEvent) => {
		e.stopPropagation();
		setExpandedIds(prev => {
			const next = new Set(prev);
			if (next.has(docId)) {
				next.delete(docId);
			} else {
				next.add(docId);
			}
			return next;
		});
	}, []);

	const handleNewDoc = useCallback((parentId?: string) => {
		setNewDocParentId(parentId);
		setNewDocDialogOpen(true);
	}, []);

	const handleDocCreated = useCallback((createdDocumentId: string) => {
		refetchRoot();
		setNewDocDialogOpen(false);
		// Get the created document to access its slug
		const createdDoc = queryClient.getQueryData<{ document: DocumentSummary }>(['docs', 'get', createdDocumentId]);
		if (createdDoc?.document?.slug) {
			router.push(`/workspace/docs?slug=${createdDoc.document.slug}&edit=1`);
		} else {
			// Fallback to ID if slug not yet available
			router.push(`/workspace/docs?doc=${createdDocumentId}&edit=1`);
		}
	}, [refetchRoot, router, queryClient]);

	// Display search results or tree
	const displayDocs = searchQuery.length >= 2
		? (searchResults?.results || []).map(r => r.document)
		: rootDocs?.documents || [];
	const isLoading = searchQuery.length >= 2 ? searchLoading : rootLoading;

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				...colors.bg.paper.style,
			}}
		>
			{/* Header */}
			<Box
				sx={{
					p: 2,
					borderBottom: 1,
					...colors.border.default.style,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
				}}
			>
				<Typography variant="subtitle1" fontWeight={600}>
					Documents
				</Typography>
				<Tooltip title="New document">
					<IconButton
						size="small"
						onClick={() => handleNewDoc()}
						data-testid="new-document-btn"
					>
						<AddIcon fontSize="small" />
					</IconButton>
				</Tooltip>
			</Box>

			{/* Search */}
			<Box sx={{ p: 1.5 }}>
				<TextField
					size="small"
					fullWidth
					placeholder="Search documents..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					InputProps={{
						startAdornment: (
							<InputAdornment position="start">
								<SearchIcon fontSize="small" sx={colors.text.secondary.style} />
							</InputAdornment>
						),
					}}
					data-testid="docs-search-input"
				/>
			</Box>

			{/* Document list */}
			<Box
				sx={{
					flex: 1,
					overflow: 'auto',
					px: 1,
				}}
			>
				{isLoading ? (
					<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
						<CircularProgress size={24} />
					</Box>
				) : displayDocs.length === 0 ? (
					<Box sx={{ py: 4, textAlign: 'center' }}>
						<Typography variant="body2" sx={colors.text.secondary.style}>
							{searchQuery.length >= 2
								? 'No documents found'
								: 'No documents yet. Create your first!'}
						</Typography>
					</Box>
				) : (
					<List dense disablePadding>
						{displayDocs.map((doc) => (
							<DocumentTreeItem
								key={doc.id}
								document={doc}
								isActive={doc.id === activeDocumentId}
								isExpanded={expandedIds.has(doc.id)}
								depth={0}
								onToggleExpand={handleToggleExpand}
								onClick={handleDocClick}
								onNewChild={handleNewDoc}
								expandedIds={expandedIds}
								activeDocumentId={activeDocumentId}
							/>
						))}
					</List>
				)}
			</Box>

			{/* New document dialog */}
			<NewDocumentDialog
				open={newDocDialogOpen}
				parentDocumentId={newDocParentId}
				onClose={() => setNewDocDialogOpen(false)}
				onCreated={handleDocCreated}
			/>
		</Box>
	);
}

interface DocumentTreeItemProps {
	document: DocumentSummary;
	isActive: boolean;
	isExpanded: boolean;
	depth: number;
	onToggleExpand: (docId: string, e: React.MouseEvent) => void;
	onClick: (doc: DocumentSummary) => void;
	onNewChild: (parentId: string) => void;
	expandedIds: Set<string>;
	activeDocumentId?: string;
}

function DocumentTreeItem({
	document,
	isActive,
	isExpanded,
	depth,
	onToggleExpand,
	onClick,
	onNewChild,
	expandedIds,
	activeDocumentId,
}: DocumentTreeItemProps) {
	const colors = useThemeColors();
	const hasChildren = document.childCount > 0;

	// Fetch children when expanded
	const { data: childDocs, isLoading: childLoading } = useQuery({
		queryKey: ['docs', 'list', 'children', document.id],
		queryFn: () => listDocuments({ parentDocumentId: document.id, limit: 50 }),
		enabled: isExpanded && hasChildren,
		staleTime: 30000,
	});

	return (
		<>
			<ListItemButton
				selected={isActive}
				onClick={() => onClick(document)}
				sx={{
					pl: 1 + depth * 2,
					borderRadius: 1,
					mb: 0.5,
					'&:hover .add-child-btn': { opacity: 1 },
				}}
				data-testid={`doc-tree-item-${document.id}`}
			>
				{/* Expand/collapse toggle */}
				<ListItemIcon sx={{ minWidth: 28 }}>
					{hasChildren ? (
						<IconButton
							size="small"
							onClick={(e) => onToggleExpand(document.id, e)}
							sx={{ p: 0.25 }}
						>
							{isExpanded ? (
								<ExpandIcon fontSize="small" />
							) : (
								<ChevronIcon fontSize="small" />
							)}
						</IconButton>
					) : (
						<Box sx={{ width: 24 }} />
					)}
				</ListItemIcon>

				{/* Document icon */}
				<ListItemIcon sx={{ minWidth: 28 }}>
					{hasChildren ? (
						isExpanded ? (
							<FolderOpenIcon fontSize="small" sx={colors.text.secondary.style} />
						) : (
							<FolderIcon fontSize="small" sx={colors.text.secondary.style} />
						)
					) : (
						<DocIcon fontSize="small" sx={colors.text.secondary.style} />
					)}
				</ListItemIcon>

				{/* Title */}
				<ListItemText
					primary={document.title}
					primaryTypographyProps={{
						noWrap: true,
						variant: 'body2',
						fontWeight: isActive ? 600 : 400,
					}}
				/>

				{/* Add child button */}
				{depth < 9 && (
					<IconButton
						size="small"
						className="add-child-btn"
						onClick={(e) => {
							e.stopPropagation();
							onNewChild(document.id);
						}}
						sx={{ opacity: 0, transition: 'opacity 0.15s' }}
					>
						<AddIcon fontSize="small" />
					</IconButton>
				)}
			</ListItemButton>

			{/* Children */}
			{hasChildren && (
				<Collapse in={isExpanded} timeout="auto" unmountOnExit>
					{childLoading ? (
						<Box sx={{ display: 'flex', justifyContent: 'center', py: 1, pl: 2 + depth * 2 }}>
							<CircularProgress size={16} />
						</Box>
					) : (
						<List dense disablePadding>
							{(childDocs?.documents || []).map((child) => (
								<DocumentTreeItem
									key={child.id}
									document={child}
									isActive={child.id === activeDocumentId}
									isExpanded={expandedIds.has(child.id)}
									depth={depth + 1}
									onToggleExpand={onToggleExpand}
									onClick={onClick}
									onNewChild={onNewChild}
									expandedIds={expandedIds}
									activeDocumentId={activeDocumentId}
								/>
							))}
						</List>
					)}
				</Collapse>
			)}
		</>
	);
}
