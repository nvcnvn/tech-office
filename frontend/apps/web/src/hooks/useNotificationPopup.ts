/**
 * Notification Popup Hook
 * Manages in-app notification display with routing context awareness
 * Constitution v5.4.0 compliant
 */

import { useEffect, useCallback, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { markNotificationAsRead } from 'apis';
import { isChannelActive } from './useActiveChannelRegistry';

/**
 * Notification popup data
 */
export interface NotificationPopup {
	notificationId: string;
	notificationRecipientId: string; // Required for markAsRead API
	title: string;
	message: string;
	type: string;
	channelId?: string;
	messageId?: string;
	employeeId?: string;
	timestamp: Date;
}

/**
 * Options for notification popup behavior
 */
export interface NotificationPopupOptions {
	/** Duration to show popup (ms), default: 5000 */
	duration?: number;
	/** Whether to auto-mark as read when shown, default: true */
	autoMarkAsRead?: boolean;
	/** Callback when popup is clicked */
	onClick?: (notification: NotificationPopup) => void;
	/** Callback when popup is dismissed */
	onDismiss?: (notification: NotificationPopup) => void;
}

/**
 * Hook to manage notification popup display with routing logic
 * 
 * Usage:
 * ```tsx
 * const { shouldShowNotification } = useNotificationPopup({
 *   duration: 5000,
 *   autoMarkAsRead: true,
 *   onClick: (notif) => router.push(`/workspace/chat?channel=${notif.channelId}`),
 * });
 * 
 * useEffect(() => {
 *   window.addEventListener('notification-received', handleNotification);
 * }, []);
 * ```
 */
export function useNotificationPopup(options: NotificationPopupOptions = {}) {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const {
		duration = 5000,
		autoMarkAsRead = true,
		onClick,
		onDismiss,
	} = options;

	// Track shown notifications to prevent duplicates
	const shownNotifications = useRef(new Set<string>());

	const hasRecipientId = useCallback((notification: NotificationPopup) => {
		return notification.notificationRecipientId.trim().length > 0;
	}, []);

	/**
	 * Check if notification should be shown based on current route
	 */
	const shouldShowNotification = useCallback(
		(notification: NotificationPopup): boolean => {
			// Already shown this notification
			if (shownNotifications.current.has(notification.notificationId)) {
				return false;
			}

			// Check if user is viewing related content
			const isViewingChat = pathname?.includes('/workspace/chat');
			const activeChannelId = searchParams?.get('channel');
			const activeMessageId = searchParams?.get('message');

			// Don't show if viewing the channel this notification is about.
			// Covers the main /workspace/chat route (URL param check) AND any
			// embedded chat view (tasks, docs, CRM, etc.) via the registry.
			if (notification.channelId && isChannelActive(notification.channelId)) {
				console.log(
					'[NotificationPopup] Suppressed: Channel active in an embedded view',
					notification.notificationId
				);
				return false;
			}
			if (
				isViewingChat &&
				notification.channelId &&
				activeChannelId === notification.channelId
			) {
				console.log(
					'[NotificationPopup] Suppressed: User viewing related channel',
					notification.notificationId
				);
				return false;
			}

			// Don't show if viewing the specific message
			if (
				isViewingChat &&
				notification.messageId &&
				activeMessageId === notification.messageId
			) {
				console.log(
					'[NotificationPopup] Suppressed: User viewing related message',
					notification.notificationId
				);
				return false;
			}

			// Check for employee profile pages
			if (
				pathname?.includes('/workspace/organization/employees') &&
				notification.employeeId &&
				pathname.includes(notification.employeeId)
			) {
				console.log(
					'[NotificationPopup] Suppressed: User viewing related employee profile',
					notification.notificationId
				);
				return false;
			}

			// Show notification
			return true;
		},
		[pathname, searchParams]
	);

	/**
	 * Show notification popup
	 */
	const showNotification = useCallback(
		async (notification: NotificationPopup) => {
			// Check routing logic
			if (!shouldShowNotification(notification)) {
				return;
			}

			// Mark as shown
			shownNotifications.current.add(notification.notificationId);

			// Auto-mark as read if enabled
			if (autoMarkAsRead && hasRecipientId(notification)) {
				try {
					await markNotificationAsRead(notification.notificationRecipientId);
					console.log(
						'[NotificationPopup] Marked as read:',
						notification.notificationRecipientId
					);
				} catch (err) {
					console.error('[NotificationPopup] Failed to mark as read:', err);
				}
			} else if (autoMarkAsRead) {
				console.log(
					'[NotificationPopup] Skipped mark as read for ephemeral notification:',
					notification.notificationId
				);
			}

			// Dispatch custom event for UI components to listen
			window.dispatchEvent(
				new CustomEvent('notification-popup-show', {
					detail: notification,
				})
			);

			// Auto-dismiss after duration
			setTimeout(() => {
				window.dispatchEvent(
					new CustomEvent('notification-popup-dismiss', {
						detail: notification,
					})
				);
				onDismiss?.(notification);
			}, duration);
		},
		[shouldShowNotification, autoMarkAsRead, duration, hasRecipientId, onDismiss]
	);

	/**
	 * Handle notification click
	 */
	const handleNotificationClick = useCallback(
		(notification: NotificationPopup) => {
			// Mark as read if not already
			if (!autoMarkAsRead && hasRecipientId(notification)) {
				markNotificationAsRead(notification.notificationRecipientId).catch((err: unknown) => {
					console.error('[NotificationPopup] Failed to mark as read:', err);
				});
			}

			// Dispatch dismiss event
			window.dispatchEvent(
				new CustomEvent('notification-popup-dismiss', {
					detail: notification,
				})
			);

			// Call onClick handler
			onClick?.(notification);
		},
		[autoMarkAsRead, hasRecipientId, onClick]
	);

	/**
	 * Handle manual notification dismiss
	 */
	const handleNotificationDismiss = useCallback(
		(notification: NotificationPopup) => {
			// Dispatch dismiss event
			window.dispatchEvent(
				new CustomEvent('notification-popup-dismiss', {
					detail: notification,
				})
			);

			onDismiss?.(notification);
		},
		[onDismiss]
	);

	/**
	 * Clear shown notifications history
	 * Useful when user navigates away from current context
	 */
	const clearShownNotifications = useCallback(() => {
		shownNotifications.current.clear();
	}, []);

	// Listen for SSE notification events
	useEffect(() => {
		const handleNotificationReceived = (event: Event) => {
			const customEvent = event as CustomEvent<NotificationPopup>;
			const notification = customEvent.detail;

			if (!notification) {
				console.warn('[NotificationPopup] Received event without notification data');
				return;
			}

			console.log('[NotificationPopup] Received notification:', notification.notificationId);
			showNotification(notification);
		};

		window.addEventListener('notification-received', handleNotificationReceived);

		return () => {
			window.removeEventListener('notification-received', handleNotificationReceived);
		};
	}, [showNotification]);

	// Clear shown notifications when route changes
	useEffect(() => {
		// Allow notifications to be shown again when user navigates
		clearShownNotifications();
	}, [pathname, clearShownNotifications]);

	return {
		shouldShowNotification,
		showNotification,
		handleNotificationClick,
		handleNotificationDismiss,
		clearShownNotifications,
	};
}
