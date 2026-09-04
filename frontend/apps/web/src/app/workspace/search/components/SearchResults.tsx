'use client';

import React from 'react';
import { Box, CircularProgress, Paper, Typography } from '@mui/material';
import type { SearchHit, SearchKind } from 'apis';
import EmployeeSearchResult from './EmployeeSearchResult';
import DepartmentSearchResult from './DepartmentSearchResult';
import ChannelSearchResult from './ChannelSearchResult';
import MessageSearchResult from './MessageSearchResult';
import DocumentSearchResult from './DocumentSearchResult';
import FileSearchResult from './FileSearchResult';
import WorkItemSearchResult from './WorkItemSearchResult';
import EventSearchResult from './EventSearchResult';

interface SearchResultsProps {
	hits: SearchHit[];
	loading: boolean;
	query: string;
}

/**
 * Every kind, mapped to the component that renders it.
 *
 * A `Record` rather than a `switch`: adding a kind to the wire contract without adding a
 * row component here fails `tsc`, so a new kind cannot reach the page as a blank row
 * (Constitution VIII).
 */
const ROW_BY_KIND: Record<SearchKind, React.ComponentType<{ hit: SearchHit }>> = {
	person: EmployeeSearchResult,
	department: DepartmentSearchResult,
	channel: ChannelSearchResult,
	message: MessageSearchResult,
	document: DocumentSearchResult,
	file: FileSearchResult,
	work_item: WorkItemSearchResult,
	event: EventSearchResult,
};

/** A stable key per row: the target identifier its own kind is opened by. */
function hitKey(hit: SearchHit): string {
	const t = hit.target;
	const id =
		t.messageId || t.taskId || t.documentSlug || t.fileId || t.eventId ||
		t.channelId || t.employeeId || t.departmentId;
	return `${hit.kind}:${id}`;
}

/**
 * The ranked list.
 *
 * One list, rendered in the order the server returned. The server merged the eight
 * sources, so web and mobile show the same order by construction — there is nothing left
 * here to sort, group or re-rank.
 */
export default function SearchResults({ hits, loading, query }: SearchResultsProps) {
	if (loading && hits.length === 0) {
		return (
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
				<CircularProgress size={24} />
				<Typography variant="h6">Searching for &quot;{query}&quot;...</Typography>
			</Box>
		);
	}

	if (hits.length === 0) {
		return (
			<Paper sx={{ p: 4, textAlign: 'center' }} data-testid="search-no-results">
				<Typography variant="h6" gutterBottom>
					No results found
				</Typography>
				<Typography variant="body2" color="text.secondary">
					Try different keywords or check your spelling.
				</Typography>
			</Paper>
		);
	}

	return (
		<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid="search-results">
			{hits.map((hit) => {
				const Row = ROW_BY_KIND[hit.kind];
				return <Row key={hitKey(hit)} hit={hit} />;
			})}
		</Box>
	);
}
