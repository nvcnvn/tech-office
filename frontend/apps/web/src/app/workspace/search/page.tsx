'use client';

// Force dynamic rendering for this page since it uses searchParams
export const dynamic = 'force-dynamic';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/hooks';
import {
	Box,
	Container,
	Typography,
	CircularProgress,
	Alert,
	Paper,
} from '@mui/material';
import { searchAll } from 'apis';
import type { FederatedSearchResults } from 'apis';
import CategoryTabs, { type SearchCategory } from './components/CategoryTabs';
import SearchResults from './components/SearchResults';

/**
 * Search page content component
 * Separated to allow Suspense boundary for useSearchParams
 */
function SearchPageContent() {
	const { isLoading: authLoading, user } = useRequireAuth();
	const searchParams = useSearchParams();
	const query = searchParams.get('q') || '';

	const [results, setResults] = useState<FederatedSearchResults | null>(null);
	const [isSearching, setIsSearching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [activeCategory, setActiveCategory] = useState<SearchCategory>('all');

	// Execute search when query changes
	useEffect(() => {
		if (!query.trim()) {
			setResults(null);
			return;
		}

		const executeSearch = async () => {
			setIsSearching(true);
			setError(null);

			try {
				const searchResults = await searchAll(query.trim(), 20);
				setResults(searchResults);
			} catch (err) {
				console.error('Search error:', err);
				setError(err instanceof Error ? err.message : 'Failed to execute search');
			} finally {
				setIsSearching(false);
			}
		};

		executeSearch();
	}, [query]);

	// Show loading state while checking authentication
	if (authLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '50vh',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	// If not authenticated, useRequireAuth will handle redirect
	if (!user) {
		return null;
	}

	// Empty query state
	if (!query.trim()) {
		return (
			<Container maxWidth="lg" sx={{ py: 4 }}>
				<Paper sx={{ p: 4, textAlign: 'center' }}>
					<Typography variant="h5" gutterBottom>
						Search Tech Office
					</Typography>
					<Typography variant="body1" color="text.secondary">
						Use the search bar above to find employees, departments, channels, and messages.
					</Typography>
					<Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
						Keyboard shortcut: <kbd>⌘K</kbd> or <kbd>Ctrl+K</kbd>
					</Typography>
				</Paper>
			</Container>
		);
	}

	// Searching state
	if (isSearching && !results) {
		return (
			<Container maxWidth="lg" sx={{ py: 4 }}>
				<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 4 }}>
					<CircularProgress size={24} />
					<Typography variant="h6">
						Searching for &quot;{query}&quot;...
					</Typography>
				</Box>
			</Container>
		);
	}

	// Error state
	if (error) {
		return (
			<Container maxWidth="lg" sx={{ py: 4 }}>
				<Alert severity="error" sx={{ mb: 4 }}>
					{error}
				</Alert>
			</Container>
		);
	}

	// Results state
	if (results) {
		const totalResults =
			results.employees.length +
			results.departments.length +
			results.channels.length +
			results.messages.length;

		return (
			<Container maxWidth="lg" sx={{ py: 4 }}>
				{/* Search Header */}
				<Box sx={{ mb: 4 }}>
					<Typography variant="h5" gutterBottom>
						Search Results for &quot;{query}&quot;
					</Typography>
					<Typography variant="body2" color="text.secondary">
						{totalResults === 0 ? 'No results found' : `${totalResults} result${totalResults === 1 ? '' : 's'} found`}
					</Typography>
				</Box>

				{/* Category Tabs */}
				<CategoryTabs
					activeCategory={activeCategory}
					onCategoryChange={setActiveCategory}
					resultCounts={{
						employees: results.employees.length,
						departments: results.departments.length,
						channels: results.channels.length,
						messages: results.messages.length,
						files: 0, // Files use separate search API, count loaded in FilesTab
					}}
				/>

				{/* Search Results */}
				<SearchResults
					category={activeCategory}
					results={results}
					loading={isSearching}
					query={query}
				/>
			</Container>
		);
	}

	return null;
}

/**
 * Global search results page
 * 
 * Route: /workspace/search?q=<query>
 * 
 * Features:
 * - Federated search across all domains (employees, departments, channels, messages)
 * - Category tabs with result counts
 * - Loading states per category
 * - Empty states with helpful messages
 */
export default function SearchPage() {
	return (
		<Suspense
			fallback={
				<Container maxWidth="lg" sx={{ py: 4 }}>
					<Box
						sx={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							minHeight: '50vh',
						}}
					>
						<CircularProgress />
					</Box>
				</Container>
			}
		>
			<SearchPageContent />
		</Suspense>
	);
}
