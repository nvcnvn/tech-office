'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * QueryClient Provider for React Query
 * Provides caching, refetching, and state management for server data
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
	// Create QueryClient instance in useState to ensure it's only created once per component tree
	// This prevents creating a new client on every render
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						// Stale time: How long data is considered fresh (5 minutes)
						staleTime: 5 * 60 * 1000,
						// Cache time: How long inactive data stays in cache (10 minutes)
						gcTime: 10 * 60 * 1000,
						// Retry failed requests 3 times with exponential backoff
						retry: 3,
						// Refetch on window focus for fresh data
						refetchOnWindowFocus: true,
					},
					mutations: {
						// Retry failed mutations once
						retry: 1,
					},
				},
			})
	);

	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
