/**
 * Organization Management Page
 * Manage organization settings, members, and structure
 * Optimized for wide screens with limited vertical space
 */

'use client';

// Force dynamic rendering for this page
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/hooks';
import TabLink from '@/components/TabLink';
import EmployeesTab from './components/EmployeesTab';
import DepartmentsTab from './components/DepartmentsTab';
import PermissionsTab from './components/PermissionsTab';
import { useThemeColors } from '@/theme/useThemeColors';
import { Typography } from '@mui/material';

type TabType = 'employees' | 'departments' | 'permissions';

export default function OrganizationPage() {
	const colors = useThemeColors();
	const router = useRouter();
	const searchParams = useSearchParams();
	const { user } = useRequireAuth();
	const [activeTab, setActiveTab] = useState<TabType>('departments');

	// Read tab from URL query params
	useEffect(() => {
		const tabParam = searchParams.get('tab') as TabType | null;
		if (tabParam && ['employees', 'departments', 'permissions'].includes(tabParam)) {
			setActiveTab(tabParam);
		}
	}, [searchParams]);

	const handleTabChange = (tabId: string) => {
		setActiveTab(tabId as TabType);
		router.push(`/workspace/organization?tab=${tabId}`);
	};

	if (!user) {
		return null;
	}

	const tabs: { id: TabType; label: string; icon: string }[] = [
		{ id: 'departments', label: 'Departments', icon: '🏢' },
		{ id: 'employees', label: 'Employees', icon: '👥' },
		{ id: 'permissions', label: 'Permissions', icon: '🔑' },
	];

	return (
		<div className={`h-full ${colors.bg.paper.className} flex flex-col`}>
			{/* Page Header - Compact 48px height for sub-navigation */}
			<div className={`h-12 px-4 ${colors.border.default.className} border-b flex items-center justify-between shrink-0`}>
				<div className="flex items-center gap-3">
					<Typography variant="h6" fontWeight="bold">Organization</Typography>
					<span className={`text-xs ${colors.text.hint.className}`}>•</span>
					<Typography variant="body2" color="text.secondary">Manage your organization</Typography>
				</div>
				<button className={`h-9 px-4 ${colors.border.default.className} border rounded-lg text-sm ${colors.bg.hover}`}>
					Settings
				</button>
			</div>

			{/* Tab Navigation - Compact 48px height */}
			<div className={`h-12 px-4 ${colors.border.default.className} border-b flex items-center gap-1 shrink-0`}>
				{tabs.map((tab) => (
					<TabLink
						key={tab.id}
						id={tab.id}
						label={tab.label}
						icon={tab.icon}
						href={`/workspace/organization?tab=${tab.id}`}
						isActive={activeTab === tab.id}
						onClick={handleTabChange}
						className="px-3 py-1.5 text-sm"
					/>
				))}
			</div>

			{/* Tab Content - Scrollable with max-width for readability */}
			<div className="flex-1 overflow-y-auto">
				<div className="max-w-7xl mx-auto p-4">
					{activeTab === 'employees' && <EmployeesTab />}
					{activeTab === 'departments' && <DepartmentsTab />}
					{activeTab === 'permissions' && <PermissionsTab />}
				</div>
			</div>
		</div>
	);
}
