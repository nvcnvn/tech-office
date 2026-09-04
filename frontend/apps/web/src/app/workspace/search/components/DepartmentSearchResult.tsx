'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import BusinessIcon from '@mui/icons-material/Business';
import type { SearchHit } from 'apis';
import SearchResultCard from './SearchResultCard';

export default function DepartmentSearchResult({ hit }: { hit: SearchHit }) {
	const router = useRouter();

	return (
		<SearchResultCard
			badge="Department"
			icon={<BusinessIcon />}
			title={hit.title}
			contextLine={hit.contextLine}
			snippet={hit.snippet}
			testId="search-result-department"
			onClick={() => router.push('/workspace/organization')}
		/>
	);
}
