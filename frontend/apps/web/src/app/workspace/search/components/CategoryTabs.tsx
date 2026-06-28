'use client';

import React from 'react';
import { Tabs, Tab, Badge, Box } from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import BusinessIcon from '@mui/icons-material/Business';
import TagIcon from '@mui/icons-material/Tag';
import ChatIcon from '@mui/icons-material/Chat';
import ViewListIcon from '@mui/icons-material/ViewList';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

export type SearchCategory = 'all' | 'employees' | 'departments' | 'channels' | 'messages' | 'files';

interface CategoryTabsProps {
	/**
	 * Currently active category
	 */
	activeCategory: SearchCategory;
	/**
	 * Callback when category changes
	 */
	onCategoryChange: (category: SearchCategory) => void;
	/**
	 * Result counts per category for badge display
	 */
	resultCounts: {
		employees: number;
		departments: number;
		channels: number;
		messages: number;
		files: number;
	};
}

/**
 * Category tabs component for search results filtering
 * 
 * Displays tabs for each search category with result count badges
 */
export default function CategoryTabs({
	activeCategory,
	onCategoryChange,
	resultCounts,
}: CategoryTabsProps) {
	const handleChange = (_event: React.SyntheticEvent, newValue: SearchCategory) => {
		onCategoryChange(newValue);
	};

	const totalResults =
		resultCounts.employees +
		resultCounts.departments +
		resultCounts.channels +
		resultCounts.messages +
		resultCounts.files;

	return (
		<Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
			<Tabs
				value={activeCategory}
				onChange={handleChange}
				aria-label="search category tabs"
				variant="scrollable"
				scrollButtons="auto"
			>
				<Tab
					icon={<ViewListIcon />}
					iconPosition="start"
					label={
						<Badge badgeContent={totalResults} color="primary" max={999}>
							<span style={{ marginRight: totalResults > 0 ? 20 : 0 }}>All</span>
						</Badge>
					}
					value="all"
				/>
				<Tab
					icon={<PeopleIcon />}
					iconPosition="start"
					label={
						<Badge badgeContent={resultCounts.employees} color="primary" max={999}>
							<span style={{ marginRight: resultCounts.employees > 0 ? 20 : 0 }}>
								Employees
							</span>
						</Badge>
					}
					value="employees"
				/>
				<Tab
					icon={<BusinessIcon />}
					iconPosition="start"
					label={
						<Badge badgeContent={resultCounts.departments} color="primary" max={999}>
							<span style={{ marginRight: resultCounts.departments > 0 ? 20 : 0 }}>
								Departments
							</span>
						</Badge>
					}
					value="departments"
				/>
				<Tab
					icon={<TagIcon />}
					iconPosition="start"
					label={
						<Badge badgeContent={resultCounts.channels} color="primary" max={999}>
							<span style={{ marginRight: resultCounts.channels > 0 ? 20 : 0 }}>
								Channels
							</span>
						</Badge>
					}
					value="channels"
				/>
				<Tab
					icon={<ChatIcon />}
					iconPosition="start"
					label={
						<Badge badgeContent={resultCounts.messages} color="primary" max={999}>
							<span style={{ marginRight: resultCounts.messages > 0 ? 20 : 0 }}>
								Messages
							</span>
						</Badge>
					}
					value="messages"
				/>
				<Tab
					icon={<InsertDriveFileIcon />}
					iconPosition="start"
					label={
						<Badge badgeContent={resultCounts.files} color="primary" max={999}>
							<span style={{ marginRight: resultCounts.files > 0 ? 20 : 0 }}>
								Files
							</span>
						</Badge>
					}
					value="files"
				/>
			</Tabs>
		</Box>
	);
}
