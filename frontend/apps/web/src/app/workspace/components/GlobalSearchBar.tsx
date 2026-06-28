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
	ListItem,
	ListItemButton,
	ListItemText,
	ListItemAvatar,
	Avatar,
	Divider,
	ClickAwayListener,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import PersonIcon from '@mui/icons-material/Person';
import BusinessIcon from '@mui/icons-material/Business';
import TagIcon from '@mui/icons-material/Tag';
import MessageIcon from '@mui/icons-material/Message';
import { createOrGetDirectMessage, searchAll } from 'apis';
import type { FederatedSearchResults } from 'apis';

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

/**
 * Global search bar component for workspace layout
 * 
 * Features:
 * - Debounced input (300ms)
 * - Dropdown preview of search results
 * - Click on result to navigate to item
 * - Press Enter or click search icon to navigate to full search page
 * - Keyboard shortcuts (Cmd+K / Ctrl+K to focus)
 * - Clear button
 * - Loading indicator
 */
export default function GlobalSearchBar({
	placeholder = 'Search employees, departments, channels, messages...',
	initialQuery = '',
}: GlobalSearchBarProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [query, setQuery] = useState(initialQuery);
	const [isLoading, setIsLoading] = useState(false);
	const [isOpeningDM, setIsOpeningDM] = useState(false);
	const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
	const [showDropdown, setShowDropdown] = useState(false);
	const [results, setResults] = useState<FederatedSearchResults | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	// Debounce query input (300ms)
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);

		return () => clearTimeout(timer);
	}, [query]);

	// Execute search when debounced query changes
	useEffect(() => {
		if (debouncedQuery.trim()) {
			setIsLoading(true);
			searchAll(debouncedQuery.trim(), 5) // Limit to 5 results per category for preview
				.then((searchResults) => {
					setResults(searchResults);
					setShowDropdown(true);
				})
				.catch((err) => {
					console.error('Search preview error:', err);
					setResults(null);
				})
				.finally(() => {
					setIsLoading(false);
				});
		} else {
			setResults(null);
			setShowDropdown(false);
		}
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
		setResults(null);
		setShowDropdown(false);
		searchInputRef.current?.focus();
	}, []);

	const handleSubmit = useCallback(
		(e: React.FormEvent) => {
			e.preventDefault();
			if (query.trim()) {
				setShowDropdown(false);
				router.push(`/workspace/search?q=${encodeURIComponent(query)}`);
			}
		},
		[query, router]
	);

	const handleSearchIconClick = useCallback(() => {
		if (query.trim()) {
			setShowDropdown(false);
			router.push(`/workspace/search?q=${encodeURIComponent(query)}`);
		}
	}, [query, router]);

	const handleClickAway = useCallback(() => {
		setShowDropdown(false);
	}, []);

	const handleEmployeeClick = async (employeeId: string) => {
		setShowDropdown(false);
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
			console.error('Failed to create/get DM from global search:', error);
		} finally {
			setIsOpeningDM(false);
		}
	};

	const handleDepartmentClick = (departmentId: string) => {
		setShowDropdown(false);
		// TODO: Navigate to department page when route exists
		console.log('Navigate to department:', departmentId);
	};

	const handleChannelClick = (channelId: string) => {
		setShowDropdown(false);
		router.push(`/workspace/chat?channel=${channelId}`);
	};

	const handleMessageClick = (channelId: string, messageId: string) => {
		setShowDropdown(false);
		// Navigate to message in channel context using query parameters
		router.push(`/workspace/chat?channel=${channelId}&message=${messageId}`);
	};

	const handleViewAllResults = useCallback(() => {
		if (query.trim()) {
			setShowDropdown(false);
			router.push(`/workspace/search?q=${encodeURIComponent(query)}`);
		}
	}, [query, router]);

	const hasResults = results && (
		results.employees.length > 0 ||
		results.departments.length > 0 ||
		results.channels.length > 0 ||
		results.messages.length > 0
	);

	const totalResults = results
		? results.employees.length + results.departments.length + results.channels.length + results.messages.length
		: 0;

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
				<Box
					component="form"
					onSubmit={handleSubmit}
				>
					<TextField
						id="global-search-input"
						inputRef={searchInputRef}
						fullWidth
						size="small"
						placeholder={placeholder}
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onFocus={() => {
							if (results && query.trim()) {
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
												onClick={handleSearchIconClick}
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

				{/* Search Results Dropdown */}
				{showDropdown && hasResults && (
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
					>
						<List disablePadding dense>
							{/* Employees */}
							{results.employees.length > 0 && (
								<>
									<ListItem sx={{ py: 0.5, minHeight: 'auto' }}>
										<Typography variant="caption" color="text.secondary" fontWeight="bold">
											EMPLOYEES
										</Typography>
									</ListItem>
									{results.employees.map((employee) => (
										<ListItemButton
											key={employee.id}
											onClick={() => handleEmployeeClick(employee.id)}
											disabled={isOpeningDM}
											sx={{ py: 0.5 }}
										>
											<ListItemAvatar sx={{ minWidth: 40 }}>
												<Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
													<PersonIcon fontSize="small" />
												</Avatar>
											</ListItemAvatar>
											<ListItemText
												primary={`${employee.givenName} ${employee.familyName}`}
												secondary={employee.email}
												primaryTypographyProps={{
													variant: 'body2',
													noWrap: true,
													fontWeight: 500,
												}}
												secondaryTypographyProps={{
													variant: 'caption',
													noWrap: true,
												}}
											/>
										</ListItemButton>
									))}
									<Divider />
								</>
							)}

							{/* Departments */}
							{results.departments.length > 0 && (
								<>
									<ListItem sx={{ py: 0.5, minHeight: 'auto' }}>
										<Typography variant="caption" color="text.secondary" fontWeight="bold">
											DEPARTMENTS
										</Typography>
									</ListItem>
									{results.departments.map((department) => (
										<ListItemButton
											key={department.id}
											onClick={() => handleDepartmentClick(department.id)}
											sx={{ py: 0.5 }}
										>
											<ListItemAvatar sx={{ minWidth: 40 }}>
												<Avatar sx={{ bgcolor: 'secondary.main', width: 32, height: 32 }}>
													<BusinessIcon fontSize="small" />
												</Avatar>
											</ListItemAvatar>
											<ListItemText
												primary={department.name}
												secondary={department.description}
												primaryTypographyProps={{
													variant: 'body2',
													noWrap: true,
													fontWeight: 500,
												}}
												secondaryTypographyProps={{
													variant: 'caption',
													noWrap: true,
												}}
											/>
										</ListItemButton>
									))}
									<Divider />
								</>
							)}

							{/* Channels */}
							{results.channels.length > 0 && (
								<>
									<ListItem sx={{ py: 0.5, minHeight: 'auto' }}>
										<Typography variant="caption" color="text.secondary" fontWeight="bold">
											CHANNELS
										</Typography>
									</ListItem>
									{results.channels.map((channel) => (
										<ListItemButton
											key={channel.id}
													onClick={() => handleChannelClick(channel.id)}
											sx={{ py: 0.5 }}
										>
											<ListItemAvatar sx={{ minWidth: 40 }}>
												<Avatar sx={{ bgcolor: 'success.main', width: 32, height: 32 }}>
													<TagIcon fontSize="small" />
												</Avatar>
											</ListItemAvatar>
											<ListItemText
												primary={channel.displayName}
												secondary={channel.description || (channel.isPrivate ? 'Private channel' : 'Public channel')}
												primaryTypographyProps={{
													variant: 'body2',
													noWrap: true,
													fontWeight: 500,
												}}
												secondaryTypographyProps={{
													variant: 'caption',
													noWrap: true,
												}}
											/>
										</ListItemButton>
									))}
									<Divider />
								</>
							)}

							{/* Messages */}
							{results.messages.length > 0 && (
								<>
									<ListItem sx={{ py: 0.5, minHeight: 'auto' }}>
										<Typography variant="caption" color="text.secondary" fontWeight="bold">
											MESSAGES
										</Typography>
									</ListItem>
									{results.messages.map((message) => (
										<ListItemButton
											key={message.id}
													onClick={() => handleMessageClick(message.channelId, message.id)}
											sx={{ py: 0.5 }}
										>
											<ListItemAvatar sx={{ minWidth: 40 }}>
												<Avatar sx={{ bgcolor: 'info.main', width: 32, height: 32 }}>
													<MessageIcon fontSize="small" />
												</Avatar>
											</ListItemAvatar>
											<ListItemText
												primary={message.messageText}
												secondary={`in ${message.channelName}`}
												primaryTypographyProps={{
													variant: 'body2',
													noWrap: true,
													fontWeight: 500,
												}}
												secondaryTypographyProps={{
													variant: 'caption',
													noWrap: true,
												}}
											/>
										</ListItemButton>
									))}
									<Divider />
								</>
							)}

							{/* View All Results Footer */}
							<ListItemButton
								onClick={handleViewAllResults}
								sx={{
									justifyContent: 'center',
									py: 1,
									bgcolor: 'action.hover',
								}}
							>
								<Typography variant="caption" fontWeight="bold" color="primary">
									View all {totalResults} results
								</Typography>
							</ListItemButton>
						</List>
					</Paper>
				)}

				{/* Empty State in Dropdown */}
				{showDropdown && !hasResults && !isLoading && query.trim() && (
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
