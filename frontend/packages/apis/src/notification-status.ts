/**
 * Notification status detection utility
 * Checks browser permission, service worker, and push subscription status
 */

export type NotificationStatus =
	| 'granted' // Everything working
	| 'denied' // Browser denied
	| 'default' // Not asked yet
	| 'no-service-worker' // Service worker not registered
	| 'no-subscription' // No push subscription
	| 'unsupported'; // Browser doesn't support notifications

/**
 * Check the current notification status across browser and service worker layers
 */
export async function checkNotificationStatus(): Promise<NotificationStatus> {
	// 1. Check if browser supports notifications
	if (!('Notification' in window)) {
		return 'unsupported';
	}

	// 2. Check browser permission
	if (Notification.permission === 'denied') {
		return 'denied';
	}

	if (Notification.permission === 'default') {
		return 'default';
	}

	// 3. Check service worker support
	if (!('serviceWorker' in navigator)) {
		return 'no-service-worker';
	}

	try {
		// 4. Check if service worker is registered and ready
		const registration = await navigator.serviceWorker.ready;

		// 5. Check push subscription
		const subscription = await registration.pushManager.getSubscription();
		if (!subscription) {
			return 'no-subscription';
		}

		return 'granted';
	} catch (error) {
		console.error('Notification check failed:', error);
		return 'no-service-worker';
	}
}

/**
 * Test if notifications actually work by showing a test notification
 * Useful for detecting OS-level blocks
 */
export function showTestNotification(): Promise<boolean> {
	return new Promise((resolve) => {
		if (!('Notification' in window) || Notification.permission !== 'granted') {
			resolve(false);
			return;
		}

		try {
			const notification = new Notification('Test Notification', {
				body: 'If you see this, notifications are working! 🎉',
				icon: '/icon-192x192.png',
				tag: 'test-notification',
				requireInteraction: false,
			});

			// Auto-close after 5 seconds
			setTimeout(() => {
				notification.close();
			}, 5000);

			resolve(true);
		} catch (error) {
			console.error('Failed to show test notification:', error);
			resolve(false);
		}
	});
}

/**
 * Get user-friendly status message
 */
export function getNotificationStatusMessage(status: NotificationStatus): string {
	switch (status) {
		case 'granted':
			return 'Notifications are enabled';
		case 'default':
			return 'Enable notifications to receive messages when you\'re away';
		case 'denied':
			return 'Notifications are blocked. Please enable them in your browser settings';
		case 'no-service-worker':
			return 'Notification service is unavailable. Please refresh the page';
		case 'no-subscription':
			return 'Push notifications are not registered. Click to enable';
		case 'unsupported':
			return 'Your browser does not support notifications';
		default:
			return 'Unknown notification status';
	}
}

