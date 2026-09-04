'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import type { SearchHit } from 'apis';
import SearchResultCard from './SearchResultCard';

export default function FileSearchResult({ hit }: { hit: SearchHit }) {
	const router = useRouter();

	return (
		<SearchResultCard
			badge="File"
			icon={<InsertDriveFileIcon />}
			title={hit.title}
			contextLine={hit.contextLine}
			snippet={hit.snippet}
			testId="search-result-file"
			onClick={() => router.push('/workspace/files')}
		/>
	);
}
