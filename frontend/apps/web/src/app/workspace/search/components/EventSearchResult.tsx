'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import EventIcon from '@mui/icons-material/Event';
import type { SearchHit } from 'apis';
import SearchResultCard from './SearchResultCard';

export default function EventSearchResult({ hit }: { hit: SearchHit }) {
	const router = useRouter();

	return (
		<SearchResultCard
			badge="Event"
			icon={<EventIcon />}
			title={hit.title}
			contextLine={hit.contextLine}
			testId="search-result-event"
			// The web calendar has no per-event route — /workspace/calendar/{id} is what
			// internal/linking emits but no such page exists — so an event row opens the
			// calendar itself rather than a URL that would 404.
			onClick={() => router.push('/workspace/calendar')}
		/>
	);
}
