'use strict';

/*
 * Firebase Cloud Messaging service worker.
 * Loads Firebase libraries, initializes messaging with the runtime config,
 * and displays notifications for background messages. Deep links from the
 * notification payload are handled in the notificationclick listener.
 */

// Load Firebase (compat builds are recommended for service workers)
self.importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
self.importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

const DEFAULT_NOTIFICATION_URL = '/workspace';
const DEFAULT_NOTIFICATION_ICON = '/icon-192.png';

const messagingPromise = (async () => {
	try {
		const response = await fetch('/firebase-config.json', { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`Failed to load Firebase config: ${response.status}`);
		}
		const config = await response.json();
		if (firebase.apps.length === 0) {
			firebase.initializeApp(config);
		}
		if (!firebase.messaging.isSupported()) {
			console.warn('[firebase-messaging-sw] messaging not supported in this browser');
			return null;
		}
		return firebase.messaging();
	} catch (error) {
		console.error('[firebase-messaging-sw] initialization error', error);
		return null;
	}
})();

messagingPromise.then((messaging) => {
	if (!messaging) {
		return;
	}

	messaging.onBackgroundMessage((payload) => {
		const notification = payload.notification || {};
		const data = payload.data || {};

		const title = notification.title || data.title || 'Tech Office';
		const body = notification.body || data.body || '';
		const icon = notification.icon || data.icon || DEFAULT_NOTIFICATION_ICON;

		const clickAction = data.click_action || notification.click_action || payload.fcmOptions?.link;

		const options = {
			body,
			icon,
			tag: data.tag || payload.collapseKey || undefined,
			data: {
				...data,
				clickAction: clickAction || DEFAULT_NOTIFICATION_URL,
			},
		};

		self.registration.showNotification(title, options);
	});
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const targetUrl = event.notification.data?.clickAction || DEFAULT_NOTIFICATION_URL;

	event.waitUntil(
		(async () => {
			const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of allClients) {
				// Focus existing Tech Office tab when possible
				if ('focus' in client) {
					await client.focus();
				}
				if ('navigate' in client) {
					await client.navigate(targetUrl);
				}
				return;
			}
			if (self.clients.openWindow) {
				await self.clients.openWindow(targetUrl);
			}
		})()
	);
});
