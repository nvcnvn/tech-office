'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import PersonIcon from '@mui/icons-material/Person';
import { createOrGetDirectMessage, type SearchHit } from 'apis';
import SearchResultCard from './SearchResultCard';

export default function EmployeeSearchResult({ hit }: { hit: SearchHit }) {
	const router = useRouter();
	const queryClient = useQueryClient();

	// Opening a person means opening the conversation with them, creating it if this is
	// the first one.
	const handleClick = async () => {
		try {
			const result = await createOrGetDirectMessage(hit.target.employeeId);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ['recentChannels'] }),
				queryClient.invalidateQueries({ queryKey: ['allChannels'] }),
				queryClient.invalidateQueries({ queryKey: ['userChatConfig'] }),
			]);
			router.push(`/workspace/chat?channel=${result.channel.id}`);
		} catch (error) {
			console.error('Failed to open the conversation from a search result:', error);
		}
	};

	return (
		<SearchResultCard
			badge="Person"
			icon={<PersonIcon />}
			title={hit.title}
			contextLine={hit.contextLine}
			testId="search-result-person"
			onClick={handleClick}
		/>
	);
}
