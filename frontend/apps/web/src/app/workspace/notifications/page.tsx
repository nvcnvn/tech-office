'use client';

// Force dynamic rendering for this page
export const dynamic = 'force-dynamic';

import React, { Suspense, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/lib/auth/hooks';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useNotifications } from '@tech-office/notifications';
import { acknowledgeNotifications } from 'apis';
import NotificationList from './components/NotificationList';
import NotificationFilters from './components/NotificationFilters';
import SSEConnectionStatus from './components/SSEConnectionStatus';
import { useNotificationStream } from '../providers/NotificationStreamProvider';
import { useThemeColors } from '@/theme/useThemeColors';
import { resolveWorkspaceNotificationHref } from './utils/notificationNavigation';

export default function NotificationsPage() {
	const { isLoading, user } = useRequireAuth();

	if (isLoading) {
		return (
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '100vh',
				}}
			>
				<CircularProgress />
			</Box>
		);
	}

	if (!user) {
		return null;
	}

	const organizationId = user.organizationId || '';

	return (
		<Suspense fallback={
			<Box
				sx={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: '100vh',
				}}
			>
				<CircularProgress />
			</Box>
		}>
			<NotificationsPageContent organizationId={organizationId} />
		</Suspense>
	);
}

function NotificationsPageContent({ organizationId }: { organizationId: string }) {
	const colors = useThemeColors();
	const router = useRouter();

	// Notifications state management
	const {
		filteredNotifications,
		unreadCount,
		filters,
		loading,
		hasMore,
		loadMore,
		markAsRead,
		markAllAsRead,
		deleteNotification,
		setFilters,
		addRealtimeNotification,
	} = useNotifications({ organizationId });

	const { status, error, reconnect, subscribe } = useNotificationStream();

	// Acknowledge handler: called when user opens destination or explicitly acks
	const handleAcknowledge = useCallback(async (notificationRecipientId: string, action: 'destination_open' | 'explicit_ack') => {
		// Optimistic: also call markAsRead for legacy compatibility
		await markAsRead(notificationRecipientId);
		try {
			await acknowledgeNotifications(notificationRecipientId, action);
		} catch (err) {
			console.warn('[NotificationsPage] acknowledge failed (non-fatal):', err);
		}
	}, [markAsRead]);

	const handleOpenNotification = useCallback((notification: Parameters<typeof resolveWorkspaceNotificationHref>[0]) => {
		const href = resolveWorkspaceNotificationHref(notification);
		if (href) {
			router.push(href);
		}
	}, [router]);

	// Auto-mark all as read when the page is first viewed with content.
	const hasAutoMarkedRef = useRef(false);
	useEffect(() => {
		if (!loading && filteredNotifications.length > 0 && !hasAutoMarkedRef.current) {
			hasAutoMarkedRef.current = true;
			markAllAsRead().catch(() => {
				// Non-fatal – user can use the Read All button as a fallback.
			});
		}
	}, [loading, filteredNotifications.length, markAllAsRead]);

	useEffect(() => {
		const unsubscribe = subscribe((notification) => {
			console.log('[NotificationsPage] Realtime notification:', notification);
			addRealtimeNotification(notification);
		});

		return () => {
			unsubscribe();
		};
	}, [subscribe, addRealtimeNotification]);

	return (
		<div className="h-full flex flex-col">
			{/* Header: 56px height */}
			<div className={`h-14 shrink-0 flex items-center justify-between px-6 ${colors.border.default.className} border-b ${colors.bg.paper.className}`}>
				<Typography variant="h6" fontWeight="semibold">Notifications</Typography>
				<SSEConnectionStatus status={status} error={error} onReconnect={reconnect} />
			</div>

			{/* Filters: 48px height */}
			<div className={`h-12 shrink-0 ${colors.border.default.className} border-b ${colors.bg.paper.className} px-6 flex items-center`}>
				<NotificationFilters
					filters={filters}
					onFiltersChange={setFilters}
					onMarkAllAsRead={markAllAsRead}
					unreadCount={unreadCount.total}
				/>
			</div>

			{/* Scrollable content */}
			<div className={`flex-1 overflow-y-auto ${colors.bg.default.className}`}>
				<NotificationList
					notifications={filteredNotifications}
					loading={loading}
					hasMore={hasMore}
					onLoadMore={loadMore}
					onMarkAsRead={markAsRead}
					onAcknowledge={handleAcknowledge}
					onOpen={handleOpenNotification}
					onDelete={deleteNotification}
				/>
			</div>
		</div>
	);
}
