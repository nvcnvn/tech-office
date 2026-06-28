/**
 * Files Management Page
 * Workspace page for file storage overview and management
 * 
 * Features:
 * - Auth guard via useRequireAuth hook
 * - Sub-navigation: Overview, Management
 * - Query param routing (?tab=overview or ?tab=management)
 * - Theme system colors (no hardcoded colors)
 */

'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, CircularProgress } from '@mui/material';
import { useRequireAuth } from '@/lib/auth/hooks';
import TabLink from '@/components/TabLink';
import { useThemeColors } from '@/theme/useThemeColors';
import OverviewTab from './components/OverviewTab';
import ManagementTab from './components/ManagementTab';

type FileTab = 'overview' | 'management';

function FilesPageContent() {
	const { isLoading, user } = useRequireAuth();
	const searchParams = useSearchParams();
	const colors = useThemeColors();

	// Get active tab from query params (default: overview)
	const activeTab = (searchParams.get('tab') || 'overview') as FileTab;

	// Show loading state while checking authentication
	if (isLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '400px',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	// If not authenticated, useRequireAuth will handle redirect
	if (!user) {
		return null;
	}

	return (
		<Box
			sx={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				overflow: 'hidden',
			}}
			data-testid="workspace-files-page"
		>
			{/* Tab navigation */}
			<Box
				sx={{
					display: 'flex',
					gap: 1,
					padding: 2,
					borderBottom: 1,
					...colors.border.default.style,
				}}
			>
				<TabLink
					id="overview"
					label="Overview"
					href="/workspace/files?tab=overview"
					isActive={activeTab === 'overview'}
				/>
				<TabLink
					id="management"
					label="Management"
					href="/workspace/files?tab=management"
					isActive={activeTab === 'management'}
				/>
			</Box>

			{/* Tab content */}
			<Box
				sx={{
					flex: 1,
					overflow: 'auto',
					padding: 3,
					...colors.bg.default.style,
				}}
			>
				{activeTab === 'overview' && <OverviewTab />}
				{activeTab === 'management' && <ManagementTab />}
			</Box>
		</Box>
	);
}

export default function FilesPage() {
	return (
		<Suspense
			fallback={
				<Box
					sx={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						minHeight: '400px',
					}}
				>
					<CircularProgress />
				</Box>
			}
		>
			<FilesPageContent />
		</Suspense>
	);
}
