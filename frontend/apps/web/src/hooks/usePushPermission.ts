/**
 * Push Notification Permission Hook
 * Manages push notification permissions and FCM token registration
 * Constitution v5.4.0 compliant
 */

import { useState, useEffect, useCallback } from 'react';
import { registerPushToken, type PermissionState } from 'apis';
import {
	NOTIFICATION_SOUND_STATE_CHANGE_EVENT,
	browserNeedsExplicitSoundActivation,
	getNotificationSoundState,
	warmupNotificationSounds,
} from '../lib/notificationSound';

interface UsePushPermissionOptions {
	/** Enable automatic permission request on mount */
	autoRequest?: boolean;
	/** FCM token from service worker */
	fcmToken?: string;
}

interface UsePushPermissionReturn {
	/** Current permission state */
	permissionState: PermissionState;
	/** Whether permission request is in progress */
	isRequesting: boolean;
	/** Whether browser audio still needs a user gesture */
	needsSoundActivation: boolean;
	/** Error message if permission request failed */
	error: string | null;
	/** Request notification permission */
	requestPermission: () => Promise<void>;
	/** Whether permission is granted */
	isGranted: boolean;
	/** Whether permission is denied */
	isDenied: boolean;
}

const PUSH_INSTALLATION_ID_KEY = 'techoffice.push.installationId';

/**
 * Stable per-browser device identifier. The backend upserts push tokens on
 * (organization, employee, device_identifier), so this must survive reloads --
 * a fresh value each registration inserts a new row instead, and every one of
 * them is then fanned out to on each notification.
 */
function getStablePushDeviceIdentifier(): string {
	const existing = localStorage.getItem(PUSH_INSTALLATION_ID_KEY);
	if (existing) {
		return existing;
	}

	const deviceId = `web-${crypto.randomUUID()}`;
	localStorage.setItem(PUSH_INSTALLATION_ID_KEY, deviceId);
	return deviceId;
}

function shouldRequireSoundActivation(permissionState: PermissionState): boolean {
	if (permissionState !== 'granted') {
		return false;
	}

	const soundState = getNotificationSoundState();
	return soundState === 'blocked' || (browserNeedsExplicitSoundActivation() && soundState !== 'ready');
}

/**
 * Hook to manage push notification permissions and token registration
 * 
 * Features:
 * - Check current notification permission state
 * - Request permissions with error handling
 * - Automatically register FCM token when granted
 * - Handle permission denied/blocked states
 * 
 * @param options - Configuration options
 */
export function usePushPermission(options: UsePushPermissionOptions = {}): UsePushPermissionReturn {
	const { autoRequest = false, fcmToken } = options;

	const [permissionState, setPermissionState] = useState<PermissionState>(() => {
		if (typeof window === 'undefined' || !('Notification' in window)) {
			return 'unspecified';
		}
		const state = Notification.permission;
		return state === 'default' ? 'prompt' : (state as PermissionState);
	});

	const [isRequesting, setIsRequesting] = useState(false);
	const [needsSoundActivation, setNeedsSoundActivation] = useState(() => {
		if (typeof window === 'undefined' || !('Notification' in window)) {
			return false;
		}

		const state = Notification.permission;
		const currentState = state === 'default' ? 'prompt' : (state as PermissionState);
		return shouldRequireSoundActivation(currentState);
	});
	const [error, setError] = useState<string | null>(null);

	/**
	 * Register FCM token with backend
	 */
	const registerToken = useCallback(async (token: string) => {
		try {
			const userAgent = navigator.userAgent;
			const deviceId = getStablePushDeviceIdentifier();

			await registerPushToken({
				fcmToken: token,
				deviceIdentifier: deviceId,
				permissionState: 'granted',
				endpoint: '', // Web Push endpoint (not used for FCM)
				keysJson: '{}', // Web Push keys (not used for FCM)
				userAgent,
				tokenMetadata: {
					platform: 'web',
					browser: navigator.userAgent.includes('Chrome') ? 'chrome' :
						navigator.userAgent.includes('Firefox') ? 'firefox' :
							navigator.userAgent.includes('Safari') ? 'safari' : 'other',
				},
				// Required since the native call feature: the server picks a call
				// transport from the token type. A browser has no native call surface,
				// so it never carries the native tier.
				tokenType: 'web_push',
				nativeCallCapable: false,
			});

			console.log('[usePushPermission] FCM token registered successfully');
		} catch (err) {
			console.error('[usePushPermission] Failed to register FCM token:', err);
			throw err;
		}
	}, []);

	/**
	 * Request notification permission from browser
	 */
	const requestPermission = useCallback(async () => {
		const soundWarmupPromise = warmupNotificationSounds();

		// Check if Notification API is supported
		if (typeof window === 'undefined' || !('Notification' in window)) {
			await soundWarmupPromise;
			setError('Push notifications are not supported in this browser');
			return;
		}

		// Already granted
		if (Notification.permission === 'granted') {
			await soundWarmupPromise;
			setPermissionState('granted');
			if (fcmToken) {
				await registerToken(fcmToken);
			}
			return;
		}

		// Already denied
		if (Notification.permission === 'denied') {
			await soundWarmupPromise;
			setPermissionState('denied');
			setError('Notification permission was denied. Please enable it in your browser settings.');
			return;
		}

		setIsRequesting(true);
		setError(null);

		try {
			// Request permission
			const result = await Notification.requestPermission();
			await soundWarmupPromise;

			if (result === 'granted') {
				setPermissionState('granted');
				console.log('[usePushPermission] Notification permission granted');

				// Register FCM token if available
				if (fcmToken) {
					await registerToken(fcmToken);
				}
			} else if (result === 'denied') {
				setPermissionState('denied');
				setError('Notification permission was denied');
			} else {
				setPermissionState('prompt');
			}
		} catch (err) {
			await soundWarmupPromise;
			console.error('[usePushPermission] Error requesting permission:', err);
			setError(err instanceof Error ? err.message : 'Failed to request permission');
			setPermissionState('denied');
		} finally {
			setIsRequesting(false);
		}
	}, [fcmToken, registerToken]);

	/**
	 * Update permission state when it changes externally
	 */
	useEffect(() => {
		if (typeof window === 'undefined' || !('Notification' in window)) {
			return;
		}

		const checkPermission = () => {
			const state = Notification.permission;
			const newState = state === 'default' ? 'prompt' : (state as PermissionState);
			setPermissionState(newState);
		};

		// Check permission periodically (in case changed in another tab)
		const interval = setInterval(checkPermission, 5000);

		return () => clearInterval(interval);
	}, []);

	useEffect(() => {
		setNeedsSoundActivation(shouldRequireSoundActivation(permissionState));
	}, [permissionState]);

	useEffect(() => {
		if (typeof window === 'undefined') {
			return;
		}

		const handleSoundStateChange = () => {
			setNeedsSoundActivation(shouldRequireSoundActivation(permissionState));
		};

		window.addEventListener(
			NOTIFICATION_SOUND_STATE_CHANGE_EVENT,
			handleSoundStateChange as EventListener,
		);

		return () => {
			window.removeEventListener(
				NOTIFICATION_SOUND_STATE_CHANGE_EVENT,
				handleSoundStateChange as EventListener,
			);
		};
	}, [permissionState]);

	/**
	 * Auto-request permission on mount if enabled
	 */
	useEffect(() => {
		if (autoRequest && permissionState === 'prompt') {
			requestPermission();
		}
	}, [autoRequest, permissionState, requestPermission]);

	/**
	 * Register token when it becomes available
	 */
	useEffect(() => {
		if (fcmToken && permissionState === 'granted') {
			registerToken(fcmToken).catch(err => {
				console.error('[usePushPermission] Failed to register token:', err);
			});
		}
	}, [fcmToken, permissionState, registerToken]);

	return {
		permissionState,
		isRequesting,
		needsSoundActivation,
		error,
		requestPermission,
		isGranted: permissionState === 'granted',
		isDenied: permissionState === 'denied',
	};
}
