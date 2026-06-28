'use client';

import React from 'react';
import { Box, Paper, Typography, CircularProgress } from '@mui/material';
import type { SearchCategory } from './CategoryTabs';
import type { FederatedSearchResults } from 'apis';
import EmployeeSearchResult from './EmployeeSearchResult';
import DepartmentSearchResult from './DepartmentSearchResult';
import ChannelSearchResult from './ChannelSearchResult';
import MessageSearchResult from './MessageSearchResult';
import FilesTab from './FilesTab';

interface SearchResultsProps {
	/**
	 * Active category filter
	 */
	category: SearchCategory;
	/**
	 * Search results from all domains
	 */
	results: FederatedSearchResults | null;
	/**
	 * Loading state
	 */
	loading: boolean;
	/**
	 * Search query text
	 */
	query: string;
}

/**
 * Search results container component
 * 
 * Displays filtered results based on active category
 */
export default function SearchResults({
	category,
	results,
	loading,
	query,
}: SearchResultsProps) {
	// Loading state
	if (loading && !results) {
		return (
			<Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
				<CircularProgress size={24} />
				<Typography variant="h6">Searching for &quot;{query}&quot;...</Typography>
			</Box>
		);
	}

	// No results yet
	if (!results) {
		return null;
	}

	// Files category uses separate search API
	if (category === 'files') {
		return <FilesTab query={query} />;
	}

	// Calculate total results
	const totalResults =
		results.employees.length +
		results.departments.length +
		results.channels.length +
		results.messages.length;

	// Empty state
	if (totalResults === 0) {
		return (
			<Paper sx={{ p: 4, textAlign: 'center' }}>
				<Typography variant="h6" gutterBottom>
					No results found
				</Typography>
				<Typography variant="body2" color="text.secondary">
					Try different keywords or check your spelling.
				</Typography>
			</Paper>
		);
	}

	// Render results based on active category
	const shouldShowEmployees = category === 'all' || category === 'employees';
	const shouldShowDepartments = category === 'all' || category === 'departments';
	const shouldShowChannels = category === 'all' || category === 'channels';
	const shouldShowMessages = category === 'all' || category === 'messages';

	return (
		<Box>
			{/* Employees */}
			{shouldShowEmployees && results.employees.length > 0 && (
				<Box sx={{ mb: 4 }}>
					<Typography variant="h6" gutterBottom>
						Employees ({results.employees.length})
					</Typography>
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
						{results.employees.map((employee) => (
							<EmployeeSearchResult key={employee.id} employee={employee} />
						))}
					</Box>
				</Box>
			)}

			{/* Departments */}
			{shouldShowDepartments && results.departments.length > 0 && (
				<Box sx={{ mb: 4 }}>
					<Typography variant="h6" gutterBottom>
						Departments ({results.departments.length})
					</Typography>
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
						{results.departments.map((department) => (
							<DepartmentSearchResult key={department.id} department={department} />
						))}
					</Box>
				</Box>
			)}

			{/* Channels */}
			{shouldShowChannels && results.channels.length > 0 && (
				<Box sx={{ mb: 4 }}>
					<Typography variant="h6" gutterBottom>
						Channels ({results.channels.length})
					</Typography>
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
						{results.channels.map((channel) => (
							<ChannelSearchResult key={channel.id} channel={channel} />
						))}
					</Box>
				</Box>
			)}

			{/* Messages */}
			{shouldShowMessages && results.messages.length > 0 && (
				<Box sx={{ mb: 4 }}>
					<Typography variant="h6" gutterBottom>
						Messages ({results.messages.length})
					</Typography>
					<Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
						{results.messages.map((message) => (
							<MessageSearchResult key={message.id} message={message} />
						))}
					</Box>
				</Box>
			)}

			{/* Category-specific empty state */}
			{category !== 'all' && (
				<>
					{category === 'employees' && results.employees.length === 0 && (
						<Paper sx={{ p: 3, textAlign: 'center' }}>
							<Typography variant="body1" color="text.secondary">
								No employees found for &quot;{query}&quot;
							</Typography>
						</Paper>
					)}
					{category === 'departments' && results.departments.length === 0 && (
						<Paper sx={{ p: 3, textAlign: 'center' }}>
							<Typography variant="body1" color="text.secondary">
								No departments found for &quot;{query}&quot;
							</Typography>
						</Paper>
					)}
					{category === 'channels' && results.channels.length === 0 && (
						<Paper sx={{ p: 3, textAlign: 'center' }}>
							<Typography variant="body1" color="text.secondary">
								No channels found for &quot;{query}&quot;
							</Typography>
						</Paper>
					)}
					{category === 'messages' && results.messages.length === 0 && (
						<Paper sx={{ p: 3, textAlign: 'center' }}>
							<Typography variant="body1" color="text.secondary">
								No messages found for &quot;{query}&quot;
							</Typography>
						</Paper>
					)}
				</>
			)}
		</Box>
	);
}
