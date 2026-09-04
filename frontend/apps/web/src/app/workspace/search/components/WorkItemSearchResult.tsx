'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import AssignmentIcon from '@mui/icons-material/Assignment';
import type { SearchHit } from 'apis';
import SearchResultCard from './SearchResultCard';

export default function WorkItemSearchResult({ hit }: { hit: SearchHit }) {
	const router = useRouter();

	return (
		<SearchResultCard
			badge="Work item"
			icon={<AssignmentIcon />}
			title={hit.title}
			contextLine={hit.contextLine}
			snippet={hit.snippet}
			testId="search-result-work-item"
			onClick={() => router.push(`/workspace/projects/${hit.target.projectId}/tasks/${hit.target.taskId}`)}
		/>
	);
}
