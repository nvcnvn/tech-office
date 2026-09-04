'use client';

import React from 'react';
import { Badge, Box, Tab, Tabs } from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import BusinessIcon from '@mui/icons-material/Business';
import TagIcon from '@mui/icons-material/Tag';
import ChatIcon from '@mui/icons-material/Chat';
import DescriptionIcon from '@mui/icons-material/Description';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import AssignmentIcon from '@mui/icons-material/Assignment';
import EventIcon from '@mui/icons-material/Event';
import ViewListIcon from '@mui/icons-material/ViewList';
import type { SearchKind } from 'apis';

/** 'all' is the mixed list; every other value narrows to one source. */
export type SearchCategory = 'all' | SearchKind;

interface CategoryTabsProps {
	activeCategory: SearchCategory;
	onCategoryChange: (category: SearchCategory) => void;
	/**
	 * How many hits each source contributed, read from the mixed search's outcome report.
	 * Narrowing does not change these — they describe the workspace, not the current tab.
	 */
	hitCounts: Partial<Record<SearchKind, number>>;
}

/** One tab per kind, in the server's source order, so the tabs match the list. */
const TABS: { kind: SearchKind; label: string; icon: React.ReactElement }[] = [
	{ kind: 'person', label: 'People', icon: <PersonIcon /> },
	{ kind: 'channel', label: 'Channels', icon: <TagIcon /> },
	{ kind: 'document', label: 'Documents', icon: <DescriptionIcon /> },
	{ kind: 'work_item', label: 'Work items', icon: <AssignmentIcon /> },
	{ kind: 'event', label: 'Events', icon: <EventIcon /> },
	{ kind: 'file', label: 'Files', icon: <InsertDriveFileIcon /> },
	{ kind: 'department', label: 'Departments', icon: <BusinessIcon /> },
	{ kind: 'message', label: 'Messages', icon: <ChatIcon /> },
];

export default function CategoryTabs({ activeCategory, onCategoryChange, hitCounts }: CategoryTabsProps) {
	const total = TABS.reduce((sum, tab) => sum + (hitCounts[tab.kind] ?? 0), 0);

	const labelWithCount = (label: string, count: number) => (
		<Badge badgeContent={count} color="primary" max={999}>
			<span style={{ marginRight: count > 0 ? 20 : 0 }}>{label}</span>
		</Badge>
	);

	return (
		<Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
			<Tabs
				value={activeCategory}
				onChange={(_event, value: SearchCategory) => onCategoryChange(value)}
				aria-label="search category tabs"
				variant="scrollable"
				scrollButtons="auto"
			>
				<Tab
					icon={<ViewListIcon />}
					iconPosition="start"
					label={labelWithCount('All', total)}
					value="all"
					data-testid="search-tab-all"
				/>
				{TABS.map((tab) => (
					<Tab
						key={tab.kind}
						icon={tab.icon}
						iconPosition="start"
						label={labelWithCount(tab.label, hitCounts[tab.kind] ?? 0)}
						value={tab.kind}
						data-testid={`search-tab-${tab.kind}`}
					/>
				))}
			</Tabs>
		</Box>
	);
}
