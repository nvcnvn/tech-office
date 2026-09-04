'use client';

// Force dynamic rendering for this page since it uses searchParams
export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/hooks';
import {
	Alert,
	Box,
	CircularProgress,
	Container,
	Paper,
	Typography,
} from '@mui/material';
import { search, searchKindLabel } from 'apis';
import type { SearchHit, SearchKind, SourceOutcome } from 'apis';
import CategoryTabs, { type SearchCategory } from './components/CategoryTabs';
import SearchResults from './components/SearchResults';

const ALL_KINDS: SearchKind[] = [
	'person',
	'channel',
	'document',
	'work_item',
	'event',
	'file',
	'department',
	'message',
];

function isSearchKind(value: string): value is SearchKind {
	return (ALL_KINDS as string[]).includes(value);
}

/**
 * Search page content component
 * Separated to allow Suspense boundary for useSearchParams
 */
function SearchPageContent() {
	const { isLoading: authLoading, user } = useRequireAuth();
	const router = useRouter();
	const searchParams = useSearchParams();
	const query = searchParams.get('q') || '';

	// The narrowing lives in the URL so it survives a query change, a reload and the
	// back button.
	const kindParam = searchParams.get('kind') || '';
	const activeCategory: SearchCategory = isSearchKind(kindParam) ? kindParam : 'all';

	const [hits, setHits] = useState<SearchHit[]>([]);
	const [outcomes, setOutcomes] = useState<SourceOutcome[]>([]);
	// Tab counts describe the workspace, not the current tab, so they are kept from the
	// last mixed search rather than overwritten by a narrowed one.
	const [hitCounts, setHitCounts] = useState<Partial<Record<SearchKind, number>>>({});
	const [isSearching, setIsSearching] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!query.trim()) {
			setHits([]);
			setOutcomes([]);
			setHitCounts({});
			return;
		}

		let cancelled = false;

		const executeSearch = async () => {
			setIsSearching(true);
			setError(null);
			try {
				// Exactly one request. The server fans out over every source, applies each
				// source's own access rules, ranks and caps — so this page renders a list
				// rather than assembling one.
				const results = await search({
					query: query.trim(),
					kindFilter: activeCategory === 'all' ? undefined : activeCategory,
				});
				if (cancelled) return;

				setHits(results.hits);
				setOutcomes(results.outcomes);
				if (activeCategory === 'all') {
					const counts: Partial<Record<SearchKind, number>> = {};
					for (const outcome of results.outcomes) {
						counts[outcome.kind] = outcome.hitCount;
					}
					setHitCounts(counts);
				}
			} catch (err) {
				if (cancelled) return;
				console.error('Search error:', err);
				setError(err instanceof Error ? err.message : 'The search could not run');
				setHits([]);
				setOutcomes([]);
			} finally {
				if (!cancelled) setIsSearching(false);
			}
		};

		executeSearch();
		return () => {
			cancelled = true;
		};
	}, [query, activeCategory]);

	const handleCategoryChange = useCallback(
		(category: SearchCategory) => {
			const params = new URLSearchParams(searchParams.toString());
			if (category === 'all') {
				params.delete('kind');
			} else {
				params.set('kind', category);
			}
			router.replace(`/workspace/search?${params.toString()}`);
		},
		[router, searchParams]
	);

	if (authLoading) {
		return (
			<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
				<CircularProgress />
			</Box>
		);
	}

	if (!user) {
		return null;
	}

	if (!query.trim()) {
		return (
			<Container maxWidth="lg" sx={{ py: 4 }}>
				<Paper sx={{ p: 4, textAlign: 'center' }}>
					<Typography variant="h5" gutterBottom>
						Search Tech Office
					</Typography>
					<Typography variant="body1" color="text.secondary">
						Use the search bar above to find people, channels, documents, work items, events,
						files, departments and messages.
					</Typography>
					<Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
						Keyboard shortcut: <kbd>⌘K</kbd> or <kbd>Ctrl+K</kbd>
					</Typography>
				</Paper>
			</Container>
		);
	}

	// A failed call is not "no results": saying nothing matched when nothing was asked
	// would be a lie about the workspace.
	if (error) {
		return (
			<Container maxWidth="lg" sx={{ py: 4 }}>
				<Alert severity="error" sx={{ mb: 4 }} data-testid="search-error">
					The search could not run. {error}
				</Alert>
			</Container>
		);
	}

	// A source that could not be reached is named, not silently missing. A source the
	// caller may not search stays silent — it is not broken, it is not theirs.
	const unavailable = outcomes.filter((outcome) => outcome.status === 'unavailable');

	return (
		<Container maxWidth="lg" sx={{ py: 4 }}>
			<Box sx={{ mb: 4 }}>
				<Typography variant="h5" gutterBottom>
					Search Results for &quot;{query}&quot;
				</Typography>
				<Typography variant="body2" color="text.secondary">
					{hits.length === 0
						? 'No results found'
						: `${hits.length} result${hits.length === 1 ? '' : 's'} found`}
				</Typography>
			</Box>

			{unavailable.length > 0 && (
				<Alert severity="warning" sx={{ mb: 3 }} data-testid="search-unavailable-sources">
					{unavailable.map((outcome) => searchKindLabel(outcome.kind)).join(', ')}{' '}
					could not be searched. Everything else is below.
				</Alert>
			)}

			<CategoryTabs
				activeCategory={activeCategory}
				onCategoryChange={handleCategoryChange}
				hitCounts={hitCounts}
			/>

			<SearchResults hits={hits} loading={isSearching} query={query} />
		</Container>
	);
}

/**
 * Global search results page
 *
 * Route: /workspace/search?q=<query>&kind=<kind>
 *
 * One request to SearchService.Search returns one ranked list over eight sources plus a
 * per-source outcome report. Ranking, per-source capping and access filtering all happen
 * on the server, so this page and the mobile screen show the same results in the same
 * order by construction.
 */
export default function SearchPage() {
	return (
		<Suspense
			fallback={
				<Container maxWidth="lg" sx={{ py: 4 }}>
					<Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
						<CircularProgress />
					</Box>
				</Container>
			}
		>
			<SearchPageContent />
		</Suspense>
	);
}
