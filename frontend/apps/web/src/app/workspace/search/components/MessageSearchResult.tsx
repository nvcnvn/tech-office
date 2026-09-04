'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import ChatIcon from '@mui/icons-material/Chat';
import type { SearchHit } from 'apis';
import SearchResultCard from './SearchResultCard';

export default function MessageSearchResult({ hit }: { hit: SearchHit }) {
	const router = useRouter();

	return (
		<SearchResultCard
			badge="Message"
			icon={<ChatIcon />}
			title={hit.title}
			contextLine={hit.contextLine}
			snippet={hit.snippet}
			testId="search-result-message"
			onClick={() => router.push(`/workspace/chat?channel=${hit.target.channelId}`)}
		/>
	);
}
