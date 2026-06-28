/**
 * NotificationList Component
 * Scrollable list of notifications with infinite scroll
 */

'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { CircularProgress } from '@mui/material';
import type { Notification } from '@tech-office/notifications';
import NotificationItem from './NotificationItem';
import NotificationEmpty from './NotificationEmpty';

interface NotificationListProps {
	notifications: Notification[];
	loading: boolean;
	hasMore: boolean;
	onLoadMore: () => void;
	onMarkAsRead: (notificationRecipientId: string) => void;
	onDelete: (notificationRecipientId: string) => void;
	onAcknowledge?: (notificationRecipientId: string, action: 'destination_open' | 'explicit_ack') => Promise<void> | void;
	onOpen?: (notification: Notification) => void;
}

export default function NotificationList({
	notifications,
	loading,
	hasMore,
	onLoadMore,
	onMarkAsRead,
	onDelete,
	onAcknowledge,
	onOpen,
}: NotificationListProps) {
	const observerTarget = useRef<HTMLDivElement>(null);

	// Intersection observer for infinite scroll
	const handleObserver = useCallback(
		(entries: IntersectionObserverEntry[]) => {
			const [target] = entries;
			if (target.isIntersecting && hasMore && !loading) {
				onLoadMore();
			}
		},
		[hasMore, loading, onLoadMore]
	);

	useEffect(() => {
		const element = observerTarget.current;
		if (!element) return;

		const observer = new IntersectionObserver(handleObserver, {
			threshold: 0.1,
		});

		observer.observe(element);

		return () => {
			if (element) {
				observer.unobserve(element);
			}
		};
	}, [handleObserver]);

	if (notifications.length === 0 && !loading) {
		return <NotificationEmpty showUnreadOnly={false} />;
	}

	return (
		<div className="space-y-2 p-6">
			{notifications.map((notification) => (
				<NotificationItem
					key={notification.notificationRecipientId}
					notification={notification}
					onMarkAsRead={onMarkAsRead}
					onAcknowledge={onAcknowledge}
					onOpen={onOpen}
					onDelete={onDelete}
				/>
			))}

			{/* Infinite scroll trigger */}
			<div ref={observerTarget} className="h-4" />

			{/* Loading indicator */}
			{loading && (
				<div className="flex justify-center py-4">
					<CircularProgress size={24} />
				</div>
			)}

			{/* No more items indicator */}
			{!hasMore && notifications.length > 0 && (
				<div className="text-center py-4">
					<p className="text-sm text-gray-500">No more notifications</p>
				</div>
			)}
		</div>
	);
}
