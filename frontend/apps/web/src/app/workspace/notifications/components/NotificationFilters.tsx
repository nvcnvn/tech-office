/**
 * NotificationFilters Component
 * Filter controls for read status and source domain
 */

'use client';

import React from 'react';
import type { NotificationFilters } from '@tech-office/notifications';
import { useThemeColors } from '@/theme/useThemeColors';

interface NotificationFiltersProps {
	filters: NotificationFilters;
	onFiltersChange: (filters: NotificationFilters) => void;
	onMarkAllAsRead: () => void;
	unreadCount: number;
}

export default function NotificationFiltersComponent({
	filters,
	onFiltersChange,
	onMarkAllAsRead,
	unreadCount,
}: NotificationFiltersProps) {
	const colors = useThemeColors();

	const handleReadStatusChange = (showUnreadOnly: boolean) => {
		onFiltersChange({
			...filters,
			showUnreadOnly,
			appliedAt: new Date(),
		});
	};

	const handleClearDomainFilters = () => {
		onFiltersChange({
			...filters,
			selectedSourceDomains: [],
			appliedAt: new Date(),
		});
	};

	return (
		<div className="flex items-center gap-4">
			{/* Read status toggle */}
			<div className="flex items-center gap-1">
				<button
					onClick={() => handleReadStatusChange(false)}
					className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${!filters.showUnreadOnly
						? `${colors.primary.main.className} ${colors.primary.text.className}`
						: `${colors.text.secondary.className} ${colors.bg.hover}`
						}`}
				>
					All
				</button>
				<button
					onClick={() => handleReadStatusChange(true)}
					className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${filters.showUnreadOnly
						? `${colors.primary.main.className} ${colors.primary.text.className}`
						: `${colors.text.secondary.className} ${colors.bg.hover}`
						}`}
				>
					Unread Only {unreadCount > 0 && `(${unreadCount})`}
				</button>
			</div>

			{/* Divider */}
			<div className={`h-6 w-px ${colors.border.light.className}`} />

			{/* Domain filter dropdown */}
			<div className="relative">
				<button className={`px-3 py-1.5 text-sm font-medium ${colors.text.primary.className} ${colors.bg.hover} rounded-lg flex items-center gap-2`}>
					<span>
						{filters.selectedSourceDomains.length === 0
							? 'All Domains'
							: `${filters.selectedSourceDomains.length} Selected`}
					</span>
					<span className="text-xs">▼</span>
				</button>
				{/* Domain dropdown would go here - simplified for now */}
			</div>

			{/* Clear filters */}
			{filters.selectedSourceDomains.length > 0 && (
				<button
					onClick={handleClearDomainFilters}
					className={`text-sm ${colors.primary.text.className} hover:opacity-80`}
				>
					Clear filters
				</button>
			)}

			{/* Divider */}
			<div className={`h-6 w-px ${colors.border.light.className}`} />

			{/* Mark all as read */}
			<button
				onClick={onMarkAllAsRead}
				disabled={unreadCount === 0}
				className={`px-3 py-1.5 text-sm font-medium ${colors.primary.text.className} ${colors.primary.hover} rounded-lg disabled:opacity-50 disabled:cursor-not-allowed`}
			>
				Mark All as Read
			</button>
		</div>
	);
}
