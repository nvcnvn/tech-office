'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
	TextField,
	InputAdornment,
	IconButton,
	Box,
	CircularProgress,
	Paper,
	Typography,
	List,
	ListItemButton,
	ListItemText,
	ListItemAvatar,
	Avatar,
	ClickAwayListener,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import PersonIcon from '@mui/icons-material/Person';
import BusinessIcon from '@mui/icons-material/Business';
import TagIcon from '@mui/icons-material/Tag';
import MessageIcon from '@mui/icons-material/Message';
import DescriptionIcon from '@mui/icons-material/Description';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import AssignmentIcon from '@mui/icons-material/Assignment';
import EventIcon from '@mui/icons-material/Event';
import { createOrGetDirectMessage, search } from 'apis';
import type { SearchHit, SearchKind } from 'apis';

interface GlobalSearchBarProps {
	/**
	 * Placeholder text for the search input
	 */
	placeholder?: string;
	/**
	 * Initial query value (e.g., from URL params)
	 */
	initialQuery?: string;
}

/** The icon each kind wears in the preview list. */
const ICON_BY_KIND: Record<SearchKind, React.ReactNode> = {
	person: <PersonIcon fontSize="small" />,
	department: <BusinessIcon fontSize="small" />,
	channel: <TagIcon fontSize="small" />,
	message: <MessageIcon fontSize="small" />,
	document: <DescriptionIcon fontSize="small" />,
	file: <InsertDriveFileIcon fontSize="small" />,
	work_item: <AssignmentIcon fontSize="small" />,
	event: <EventIcon fontSize="small" />,
};

/** A stable key per row: the target identifier its own kind is opened by. */
function hitKey(hit: SearchHit): string {
	const t = hit.target;
	const id =
		t.messageId || t.taskId || t.documentSlug || t.fileId || t.eventId ||
		t.channelId || t.employeeId || t.departmentId;
	return `${hit.kind}:${id}`;
}

/**
 * Global search bar component for workspace layout
 *
 * The preview is the same ranked list the results page shows, just shorter: one request
 * to SearchService.Search over all eight sources, rendered in the order the server
 * returned. There is no client-side fan-out and nothing here to re-rank.
 *
 * Features:
 * - Debounced input (300ms)
 * - Dropdown preview of the ranked results
 * - Click on a result to open it
 * - Press Enter or click search icon to navigate to full search page
 * - Keyboard shortcuts (Cmd+K / Ctrl+K to focus)
 * - Clear button
 * - Loading indicator
 */
export default function GlobalSearchBar({
	placeholder = 'Search people, documents, work items, events, files and messages...',
	initialQuery = '',
}: GlobalSearchBarProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [query, setQuery] = useState(initialQuery);
	const [isLoading, setIsLoading] = useState(false);
	const [isOpeningDM, setIsOpeningDM] = useState(false);
	const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
	const [showDropdown, setShowDropdown] = useState(false);
	const [hits, setHits] = useState<SearchHit[]>([]);
	const searchInputRef = useRef<HTMLInputElement>(null);

	// Debounce query input (300ms)
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);

		return () => clearTimeout(timer);
	}, [query]);

	// Execute search when debounced query changes. Two characters is the server's
	// minimum, so a single character never fans out.
	useEffect(() => {
		const trimmed = debouncedQuery.trim();
		if (trimmed.length < 2) {
			setHits([]);
			setShowDropdown(false);
			return;
		}

		setIsLoading(true);
		search({ query: trimmed, limit: 16 })
			.then((results) => {
				setHits(results.hits);
				setShowDropdown(true);
			})
			.catch((err) => {
				console.error('Search preview error:', err);
				setHits([]);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [debouncedQuery]);

	// Keyboard shortcut: Cmd+K / Ctrl+K to focus search
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				searchInputRef.current?.focus();
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);

	const handleClear = useCallback(() => {
		setQuery('');
		setDebouncedQuery('');
		setHits([]);
		setShowDropdown(false);
		searchInputRef.current?.focus();
	}, []);

	const goToResultsPage = useCallback(() => {
		if (query.trim()) {
			setShowDropdown(false);
			router.push(`/workspace/search?q=${encodeURIComponent(query)}`);
		}
	}, [query, router]);

	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			goToResultsPage();
		},
		[goToResultsPage]
	);

	const handleClickAway = useCallback(() => {
		setShowDropdown(false);
	}, []);

	const openPerson = async (employeeId: string) => {
		setIsOpeningDM(true);
		try {
			const result = await createOrGetDirectMessage(employeeId);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['recentChannels'] }),
				queryClient.invalidateQueries({ queryKey: ['allChannels'] }),
				queryClient.invalidateQueries({ queryKey: ['userChatConfig'] }),
			]);
			router.push(`/workspace/chat?channel=${result.channel.id}`);
		} catch (error) {
			console.error('Failed to open the conversation from global search:', error);
		} finally {
			setIsOpeningDM(false);
		}
	};

	// Every kind has somewhere to go. The hit already carries the identifiers, so opening
	// one costs no second lookup.
	const handleHitClick = (hit: SearchHit) => {
		setShowDropdown(false);
		const t = hit.target;
		switch (hit.kind) {
			case 'person':
				void openPerson(t.employeeId);
				return;
			case 'department':
				router.push('/workspace/organization');
				return;
			case 'channel':
				router.push(`/workspace/chat?channel=${t.channelId}`);
				return;
			case 'message':
				router.push(`/workspace/chat?channel=${t.channelId}&message=${t.messageId}`);
				return;
			case 'document':
				router.push(`/workspace/docs/${t.documentSlug}`);
				return;
			case 'file':
				router.push('/workspace/files');
				return;
			case 'work_item':
				router.push(`/workspace/projects/${t.projectId}/tasks/${t.taskId}`);
				return;
			case 'event':
				// The web calendar has no per-event route, so an event row opens the
				// calendar itself rather than a URL that would 404.
				router.push('/workspace/calendar');
				return;
		}
	};

	return (
		<ClickAwayListener onClickAway={handleClickAway}>
			<Box
				sx={{
					flex: 1,
					maxWidth: 600,
					mx: 2,
					position: 'relative',
				}}
			>
				<Box component="form" onSubmit={handleSubmit}>
					<TextField
						id="global-search-input"
						inputRef={searchInputRef}
						fullWidth
						size="small"
						placeholder={placeholder}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onFocus={() => {
							if (hits.length > 0 && query.trim()) {
								setShowDropdown(true);
							}
						}}
						slotProps={{
							input: {
								startAdornment: (
									<InputAdornment position="start">
										{isLoading ? (
											<CircularProgress size={20} />
										) : (
											<IconButton
												size="small"
												onClick={goToResultsPage}
												edge="start"
												aria-label="search"
											>
												<SearchIcon />
											</IconButton>
										)}
									</InputAdornment>
								),
								endAdornment: query && (
									<InputAdornment position="end">
										<IconButton
											size="small"
											onClick={handleClear}
											edge="end"
											aria-label="clear search"
										>
											<ClearIcon />
										</IconButton>
									</InputAdornment>
								),
							},
						}}
						sx={{
							'& .MuiOutlinedInput-root': {
								backgroundColor: 'background.paper',
								'&:hover': {
									backgroundColor: 'action.hover',
								},
								'&.Mui-focused': {
									backgroundColor: 'background.paper',
								},
							},
						}}
					/>
				</Box>

				{/* Ranked preview, in the server's order */}
				{showDropdown && hits.length > 0 && (
					<Paper
						elevation={0}
						sx={{
							position: 'absolute',
							top: '100%',
							left: 0,
							right: 0,
							mt: 0.5,
							maxHeight: '60vh',
							overflow: 'auto',
							zIndex: 1300,
						}}
						data-testid="global-search-preview"
					>
						<List disablePadding dense>
							{hits.map((hit) => (
								<ListItemButton
									key={hitKey(hit)}
									onClick={() => handleHitClick(hit)}
									disabled={isOpeningDM && hit.kind === 'person'}
									sx={{ py: 0.5 }}
									data-testid={`global-search-hit-${hit.kind}`}
								>
									<ListItemAvatar sx={{ minWidth: 40 }}>
										<Avatar sx={{ bgcolor: 'action.selected', color: 'text.secondary', width: 32, height: 32 }}>
											{ICON_BY_KIND[hit.kind]}
										</Avatar>
									</ListItemAvatar>
									<ListItemText
										primary={hit.title}
										secondary={hit.contextLine}
										primaryTypographyProps={{ variant: 'body2', noWrap: true, fontWeight: 500 }}
										secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
									/>
								</ListItemButton>
							))}

							<ListItemButton
								onClick={goToResultsPage}
								sx={{ justifyContent: 'center', py: 1, bgcolor: 'action.hover' }}
							>
								<Typography variant="caption" fontWeight="bold" color="primary">
									View all results
								</Typography>
							</ListItemButton>
						</List>
					</Paper>
				)}

				{/* Empty State in Dropdown */}
				{showDropdown && hits.length === 0 && !isLoading && query.trim() && (
					<Paper
						elevation={0}
						sx={{
							position: 'absolute',
							top: '100%',
							left: 0,
							right: 0,
							mt: 0.5,
							p: 2,
							zIndex: 1300,
							textAlign: 'center',
						}}
					>
						<Typography variant="caption" color="text.secondary">
							No results found for &quot;{query}&quot;
						</Typography>
					</Paper>
				)}
			</Box>
		</ClickAwayListener>
	);
}
