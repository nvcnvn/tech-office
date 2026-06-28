/**
 * NotificationEmpty Component
 * Empty state when no notifications match filters
 */

'use client';

import React from 'react';
import { useThemeColors } from '@/theme/useThemeColors';
import { Typography } from '@mui/material';

interface NotificationEmptyProps {
	showUnreadOnly: boolean;
}

export default function NotificationEmpty({ showUnreadOnly }: NotificationEmptyProps) {
	const colors = useThemeColors();

	return (
		<div className="flex flex-col items-center justify-center py-12 px-4">
			<div className={`w-16 h-16 ${colors.bg.hover} rounded-full flex items-center justify-center mb-4`}>
				<span className="text-4xl">🔔</span>
			</div>
			<Typography variant="h6" fontWeight="medium" className="mb-2">
				{showUnreadOnly ? 'No unread notifications' : 'No notifications yet'}
			</Typography>
			<Typography variant="body2" color="text.secondary" className="text-center max-w-sm">
				{showUnreadOnly
					? 'You\'re all caught up! Check back later for new notifications.'
					: 'You don\'t have any notifications yet. They will appear here when you receive them.'}
			</Typography>
		</div>
	);
}
