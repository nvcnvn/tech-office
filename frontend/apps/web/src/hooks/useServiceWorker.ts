/**
 * Service Worker Registration Hook
 * Manages Firebase Cloud Messaging service worker registration
 * Constitution v5.4.0 compliant
 */

import { useState, useEffect, useCallback } from 'react';

import { versionedPublicAssetPath } from '@/lib/publicAsset';

interface UseServiceWorkerOptions {
	/** Service worker script path */
	scriptPath?: string;
	/** Enable automatic registration on mount */
	autoRegister?: boolean;
}

interface UseServiceWorkerReturn {
	/** Service worker registration object */
	registration: ServiceWorkerRegistration | null;
	/** Whether registration is in progress */
	isRegistering: boolean;
	/** Whether service worker is ready */
	isReady: boolean;
	/** Error message if registration failed */
	error: string | null;
	/** Register service worker */
	register: () => Promise<ServiceWorkerRegistration | null>;
	/** Unregister service worker */
	unregister: () => Promise<void>;
}

/**
 * Hook to register and manage Firebase Messaging service worker
 * 
 * Features:
 * - Service worker registration
 * - Registration state tracking
 * - Error handling
 * - Cleanup on unmount
 * 
 * @param options - Configuration options
 */
export function useServiceWorker(options: UseServiceWorkerOptions = {}): UseServiceWorkerReturn {
	const { scriptPath = versionedPublicAssetPath('/firebase-messaging-sw.js'), autoRegister = false } = options;

	const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
	const [isRegistering, setIsRegistering] = useState(false);
	const [isReady, setIsReady] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/**
	 * Register service worker
	 */
	const register = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
		// Check if service worker is supported
		if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
			const msg = 'Service Worker is not supported in this browser';
			setError(msg);
			console.warn('[useServiceWorker]', msg);
			return null;
		}

		setIsRegistering(true);
		setError(null);

		try {
			console.log('[useServiceWorker] Registering service worker:', scriptPath);

			const reg = await navigator.serviceWorker.register(scriptPath, {
				scope: '/',
			});

			console.log('[useServiceWorker] Service worker registered successfully:', reg.scope);
			setRegistration(reg);

			// Wait for service worker to be ready
			await navigator.serviceWorker.ready;
			setIsReady(true);
			console.log('[useServiceWorker] Service worker is ready');

			return reg;
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : 'Failed to register service worker';
			console.error('[useServiceWorker] Registration failed:', err);
			setError(errorMsg);
			return null;
		} finally {
			setIsRegistering(false);
		}
	}, [scriptPath]);

	/**
	 * Unregister service worker
	 */
	const unregister = useCallback(async () => {
		if (!registration) {
			console.warn('[useServiceWorker] No registration to unregister');
			return;
		}

		try {
			const success = await registration.unregister();
			if (success) {
				console.log('[useServiceWorker] Service worker unregistered successfully');
				setRegistration(null);
				setIsReady(false);
			} else {
				console.warn('[useServiceWorker] Failed to unregister service worker');
			}
		} catch (err) {
			console.error('[useServiceWorker] Error unregistering service worker:', err);
		}
	}, [registration]);

	/**
	 * Auto-register on mount if enabled
	 */
	useEffect(() => {
		if (autoRegister) {
			register();
		}
	}, [autoRegister, register]);

	/**
	 * Check for existing registration on mount
	 */
	useEffect(() => {
		if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
			return;
		}

		navigator.serviceWorker.getRegistration(scriptPath)
			.then(reg => {
				if (reg) {
					console.log('[useServiceWorker] Found existing service worker registration');
					setRegistration(reg);
					setIsReady(true);
				}
			})
			.catch(err => {
				console.error('[useServiceWorker] Error checking for existing registration:', err);
			});
	}, [scriptPath]);

	/**
	 * Listen for service worker updates
	 */
	useEffect(() => {
		if (!registration) return;

		const handleUpdateFound = () => {
			console.log('[useServiceWorker] Service worker update found');
			const newWorker = registration.installing;

			if (newWorker) {
				newWorker.addEventListener('statechange', () => {
					if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
						// New service worker installed, reload page to activate
						console.log('[useServiceWorker] New service worker installed, reloading page');
						window.location.reload();
					}
				});
			}
		};

		registration.addEventListener('updatefound', handleUpdateFound);

		return () => {
			registration.removeEventListener('updatefound', handleUpdateFound);
		};
	}, [registration]);

	return {
		registration,
		isRegistering,
		isReady,
		error,
		register,
		unregister,
	};
}
