/**
 * Unified Channel Search Component
 * Multi-stage search with local filter, API search, and employee search for DM creation
 * 
 * Search flow:
 * 1. Local filter: Filter visible channels by name/slug (instant)
 * 2. API search: If local results < threshold, query searchChannels API
 * 3. Employee search: If no channels found, search employees for DM creation
 * 
 * Features:
 * - Debounced API calls
 * - Result grouping (Local, Channels, Employees)
 * - Keyboard navigation (arrow keys, enter, escape)
 * - Loading states and empty states
 * - Click outside to close
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
	TextField,
	InputAdornment,
	Paper,
	List,
	ListItemButton,
	ListItemText,
	Typography,
	Box,
	CircularProgress,
	Divider,
	Avatar,
} from '@mui/material';
import { searchChannels, searchEmployees, type ChannelSearchResult, type EmployeeSearchResult } from 'apis';
import type { ChannelWithDetails } from 'apis';
import { useThemeColors } from '@/theme/useThemeColors';

interface UnifiedChannelSearchProps {
	/** Local channels to filter first */
	localChannels: ChannelWithDetails[];
	/** Callback when user selects a channel */
	onChannelSelect: (channelId: string, channelType?: string) => void;
	/** Callback when user wants to create DM with employee */
	onCreateDM: (employeeId: string, employeeName: string) => void;
	/** Placeholder text */
	placeholder?: string;
}

interface SearchResults {
	local: ChannelWithDetails[];
	channels: ChannelSearchResult[];
	employees: EmployeeSearchResult[];
}

export default function UnifiedChannelSearch({
	localChannels,
	onChannelSelect,
	onCreateDM,
	placeholder = 'Search channels or start DM...',
}: UnifiedChannelSearchProps) {
	const [searchQuery, setSearchQuery] = useState('');
	const [isOpen, setIsOpen] = useState(false);
	const [isSearching, setIsSearching] = useState(false);
	const [results, setResults] = useState<SearchResults>({
		local: [],
		channels: [],
		employees: [],
	});
	const [selectedIndex, setSelectedIndex] = useState(0);
	const colors = useThemeColors();

	const inputRef = useRef<HTMLInputElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

	// Filter local channels
	const filterLocal = useCallback((query: string): ChannelWithDetails[] => {
		if (!query.trim()) return [];
		const lowerQuery = query.toLowerCase();
		return localChannels.filter(ch =>
			ch.channel.displayName?.toLowerCase().includes(lowerQuery) ||
			ch.channel.titleSlug?.toLowerCase().includes(lowerQuery)
		).slice(0, 5); // Max 5 local results
	}, [localChannels]);

	// Perform multi-stage search
	const performSearch = useCallback(async (query: string) => {
		if (!query.trim()) {
			setResults({ local: [], channels: [], employees: [] });
			setIsSearching(false);
			return;
		}

		setIsSearching(true);

		// Stage 1: Filter local channels
		const localResults = filterLocal(query);

		// Stage 2: Search channels via API (if local results are insufficient)
		let channelResults: ChannelSearchResult[] = [];
		if (localResults.length < 3) {
			try {
				channelResults = await searchChannels(query, 10);
			} catch (error) {
				console.error('Channel search failed:', error);
			}
		}

		// Stage 3: Search employees for DM (if no channels found)
		let employeeResults: EmployeeSearchResult[] = [];
		if (localResults.length === 0 && channelResults.length === 0) {
			try {
				employeeResults = await searchEmployees(query, 10);
			} catch (error) {
				console.error('Employee search failed:', error);
			}
		}

		setResults({
			local: localResults,
			channels: channelResults,
			employees: employeeResults,
		});
		setIsSearching(false);
		setSelectedIndex(0); // Reset selection
	}, [filterLocal]);

	// Debounced search
	useEffect(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		if (!searchQuery.trim()) {
			setResults({ local: [], channels: [], employees: [] });
			setIsSearching(false);
			return;
		}

		// Show local results immediately
		const localResults = filterLocal(searchQuery);
		setResults(prev => ({ ...prev, local: localResults }));

		// Debounce API calls
		debounceTimerRef.current = setTimeout(() => {
			performSearch(searchQuery);
		}, 300);

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [searchQuery, filterLocal, performSearch]);

	// Calculate total result count
	const totalResults = results.local.length + results.channels.length + results.employees.length;

	// Flatten results for keyboard navigation
	const flatResults = [
		...results.local.map(ch => ({ type: 'local' as const, data: ch })),
		...results.channels.map(ch => ({ type: 'channel' as const, data: ch })),
		...results.employees.map(emp => ({ type: 'employee' as const, data: emp })),
	];

	// Handle keyboard navigation
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!isOpen || totalResults === 0) return;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				setSelectedIndex(prev => (prev + 1) % flatResults.length);
				break;
			case 'ArrowUp':
				e.preventDefault();
				setSelectedIndex(prev => (prev - 1 + flatResults.length) % flatResults.length);
				break;
			case 'Enter':
				e.preventDefault();
				if (flatResults[selectedIndex]) {
					handleSelect(flatResults[selectedIndex]);
				}
				break;
			case 'Escape':
				e.preventDefault();
				setIsOpen(false);
				setSearchQuery('');
				inputRef.current?.blur();
				break;
		}
	};

	// Handle selection
	const handleSelect = (item: typeof flatResults[0]) => {
		if (item.type === 'local') {
			onChannelSelect(item.data.channel.id, item.data.channel.channelType);
		} else if (item.type === 'channel') {
			onChannelSelect(item.data.id, item.data.channelType);
		} else if (item.type === 'employee') {
			const emp = item.data;
			onCreateDM(emp.id, `${emp.givenName} ${emp.familyName}`);
		}
		setIsOpen(false);
		setSearchQuery('');
		inputRef.current?.blur();
	};

	// Click outside to close
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(e.target as Node) &&
				inputRef.current &&
				!inputRef.current.contains(e.target as Node)
			) {
				setIsOpen(false);
			}
		};

		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	return (
		<div className="relative">
			<TextField
				ref={inputRef}
				size="small"
				fullWidth
				placeholder={placeholder}
				value={searchQuery}
				onChange={(e) => setSearchQuery(e.target.value)}
				onFocus={() => setIsOpen(true)}
				onKeyDown={handleKeyDown}
				InputProps={{
					startAdornment: (
						<InputAdornment position="start">
							<span className="text-gray-400">🔍</span>
						</InputAdornment>
					),
					endAdornment: isSearching ? (
						<InputAdornment position="end">
							<CircularProgress size={16} />
						</InputAdornment>
					) : null,
				}}
			/>

			{/* Search Results Dropdown */}
			{isOpen && searchQuery.trim() && (
				<Paper
					ref={dropdownRef}
					className="absolute top-full mt-1 left-0 right-0 z-50 max-h-96 overflow-y-auto shadow-lg"
					elevation={0}
				>
					{totalResults === 0 && !isSearching ? (
						<Box className="p-4 text-center">
							<Typography variant="body2" color="text.secondary">
								No channels or employees found
							</Typography>
							<Typography variant="caption" color="text.secondary" className="mt-1">
								Try a different search term
							</Typography>
						</Box>
					) : (
						<List dense disablePadding>
							{/* Local Results */}
							{results.local.length > 0 && (
								<>
									<Box className={`px-3 py-1 ${colors.bg.hover}`}>
										<Typography variant="caption" className={`font-semibold ${colors.text.secondary.className}`}>
											RECENT CHANNELS
										</Typography>
									</Box>
									{results.local.map((ch, idx) => {
										const globalIndex = idx;
										const isSelected = selectedIndex === globalIndex;
										return (
											<ListItemButton
												key={ch.channel.id}
												selected={isSelected}
												onClick={() => handleSelect({ type: 'local', data: ch })}
												className="px-3 py-2"
											>
												<span className="text-base mr-2">
													{ch.channel.channelType === 'direct_message' ? '💬' : ch.channel.isPrivate ? '🔒' : '#'}
												</span>
												<ListItemText
													primary={ch.channel.displayName}
													primaryTypographyProps={{ variant: 'body2' }}
												/>
											</ListItemButton>
										);
									})}
									{(results.channels.length > 0 || results.employees.length > 0) && <Divider />}
								</>
							)}

							{/* API Channel Results */}
							{results.channels.length > 0 && (
								<>
									<Box className={`px-3 py-1 ${colors.bg.hover}`}>
										<Typography variant="caption" className={`font-semibold ${colors.text.secondary.className}`}>
											ALL CHANNELS
										</Typography>
									</Box>
									{results.channels.map((ch, idx) => {
										const globalIndex = results.local.length + idx;
										const isSelected = selectedIndex === globalIndex;
										return (
											<ListItemButton
												key={ch.id}
												selected={isSelected}
												onClick={() => handleSelect({ type: 'channel', data: ch })}
												className="px-3 py-2"
											>
												<span className="text-base mr-2">
													{ch.channelType === 'direct_message' ? '💬' : ch.isPrivate ? '🔒' : '#'}
												</span>
												<ListItemText
													primary={ch.displayName}
													secondary={ch.description}
													primaryTypographyProps={{ variant: 'body2' }}
													secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
												/>
											</ListItemButton>
										);
									})}
									{results.employees.length > 0 && <Divider />}
								</>
							)}

							{/* Employee Results (for DM creation) */}
							{results.employees.length > 0 && (
								<>
									<Box className={`px-3 py-1 ${colors.bg.hover}`}>
										<Typography variant="caption" className={`font-semibold ${colors.text.secondary.className}`}>
											START DIRECT MESSAGE
										</Typography>
									</Box>
									{results.employees.map((emp, idx) => {
										const globalIndex = results.local.length + results.channels.length + idx;
										const isSelected = selectedIndex === globalIndex;
										return (
											<ListItemButton
												key={emp.id}
												selected={isSelected}
												onClick={() => handleSelect({ type: 'employee', data: emp })}
												className="px-3 py-2"
											>
												<Avatar
													sx={{ width: 24, height: 24, fontSize: '0.75rem', mr: 1 }}
													className="bg-blue-500"
												>
													{emp.givenName[0]?.toUpperCase()}
												</Avatar>
												<ListItemText
													primary={`${emp.givenName} ${emp.familyName}`}
													secondary={emp.email}
													primaryTypographyProps={{ variant: 'body2' }}
													secondaryTypographyProps={{ variant: 'caption', noWrap: true }}
												/>
											</ListItemButton>
										);
									})}
								</>
							)}
						</List>
					)}
				</Paper>
			)}
		</div>
	);
}
