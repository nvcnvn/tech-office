'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import DescriptionIcon from '@mui/icons-material/Description';
import type { SearchHit } from 'apis';
import SearchResultCard from './SearchResultCard';

export default function DocumentSearchResult({ hit }: { hit: SearchHit }) {
	const router = useRouter();

	return (
		<SearchResultCard
			badge="Document"
			icon={<DescriptionIcon />}
			title={hit.title}
			contextLine={hit.contextLine}
			snippet={hit.snippet}
			testId="search-result-document"
			onClick={() => router.push(`/workspace/docs/${hit.target.documentSlug}`)}
		/>
	);
}
