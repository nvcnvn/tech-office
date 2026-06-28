/**
 * Presence Tracking Hook
 * Tracks user activity, page visibility, and idle state for presence status
 * Constitution v5.4.0 compliant
 */

import { useEffect, useRef, useCallback } from 'react';
import { updatePresenceStatus } from 'apis';
import { SSE_CONFIG } from '@tech-office/notifications';

/**
 * Presence status matching backend constants
 * MUST align with:
 * - Backend Go constants: internal/notification/constants.go
 * - Database CHECK constraint: notification.active_connection.status
 */
export type PresenceStatus = 'online' | 'online_hidden' | 'idle' | 'offline';

interface UsePresenceTrackingOptions {
	/** Active channel ID for context-aware notifications */
	activeChannelId?: string;
	/** Idle timeout in milliseconds (default: 5 minutes) */
	idleTimeout?: number;
	/** Heartbeat interval in milliseconds (default: 30 seconds) */
	heartbeatInterval?: number;
	/** Enable/disable tracking */
	enabled?: boolean;
}

/**
 * Hook to track user presence and send updates to backend
 * 
 * Features:
 * - Page Visibility API tracking (tab focus/blur)
 * - User interaction detection (mouse, keyboard, scroll)
 * - Idle timeout detection (default 5 minutes)
 * - Periodic heartbeat (default 30 seconds)
 * - Active channel context tracking
 * 
 * @param options - Configuration options
 */
export function usePresenceTracking(options: UsePresenceTrackingOptions = {}) {
	const {
		activeChannelId,
		idleTimeout = 5 * 60 * 1000, // 5 minutes
		heartbeatInterval = 30 * 1000, // 30 seconds
		enabled = true,
	} = options;

	const currentStatus = useRef<PresenceStatus>('online');
	const lastInteractionTime = useRef<Date>(new Date());
	const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	const activeChannelRef = useRef<string | null>(activeChannelId ?? null);
	const lastSentRef = useRef<{ status: PresenceStatus; channelId: string | null; connectionId: string | null } | null>(null);

	/**
	 * Send presence update to backend
	 * ONLY sends updates when a valid SSE connection_id exists
	 */
	const sendPresenceUpdate = useCallback(async (
		status: PresenceStatus,
		channelId?: string | null,
		force = false,
	) => {
		if (!enabled) return;

		// Read connection_id from sessionStorage (set by SSE connection)
		const connectionId = typeof window === 'undefined'
			? null
			: sessionStorage.getItem(SSE_CONFIG.CONNECTION_ID_KEY);

		// CRITICAL: Do NOT send presence updates without a valid connection_id
		// Wait for SSE stream to establish connection first
		if (!connectionId) {
			console.debug('[usePresenceTracking] Skipping presence update - no SSE connection_id yet');
			return;
		}

		const normalizedChannel = channelId ?? null;
		const lastPayload = lastSentRef.current;

		// Skip redundant updates (same payload)
		if (!force && lastPayload &&
			lastPayload.status === status &&
			lastPayload.channelId === normalizedChannel &&
			lastPayload.connectionId === connectionId) {
			return;
		}

		try {
			await updatePresenceStatus({
				status,
				activeChannelId: normalizedChannel,
				lastInteractionAt: lastInteractionTime.current,
				connectionId,
			});
			currentStatus.current = status;
			lastSentRef.current = { status, channelId: normalizedChannel, connectionId };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const isOwnershipError = message.toLowerCase().includes('connection_id does not belong to employee');

			if (isOwnershipError && typeof window !== 'undefined') {
				// Connection ID is stale (likely from previous session) - clear it
				console.warn('[usePresenceTracking] Connection ownership error - clearing stale connection_id');
				sessionStorage.removeItem(SSE_CONFIG.CONNECTION_ID_KEY);
				lastSentRef.current = null;
				// Don't retry - wait for SSE to establish new connection
				return;
			}

			console.error('[usePresenceTracking] Failed to update presence:', error);
		}
	}, [enabled]);

	/**
	 * Handle user interaction - reset idle timer
	 */
	const scheduleIdleTimer = useCallback(() => {
		if (idleTimerRef.current) {
			clearTimeout(idleTimerRef.current);
		}

		idleTimerRef.current = setTimeout(() => {
			if (!enabled) {
				return;
			}
			sendPresenceUpdate('idle', activeChannelRef.current, true);
		}, idleTimeout);
	}, [enabled, idleTimeout, sendPresenceUpdate]);

	const handleUserInteraction = useCallback(() => {
		lastInteractionTime.current = new Date();

		// If currently idle, transition to online
		if (currentStatus.current === 'idle') {
			sendPresenceUpdate('online', activeChannelRef.current, true);
		}

		scheduleIdleTimer();
	}, [scheduleIdleTimer, sendPresenceUpdate]);

	/**
	 * Handle page visibility change
	 */
	const handleVisibilityChange = useCallback(() => {
		if (document.hidden) {
			// Tab hidden - treat as online_hidden but keep heartbeat active
			sendPresenceUpdate('online_hidden', activeChannelRef.current, true);
			if (idleTimerRef.current) {
				clearTimeout(idleTimerRef.current);
			}
		} else {
			// Tab visible - set to online
			sendPresenceUpdate('online', activeChannelRef.current, true);
			handleUserInteraction(); // Restart idle timer
		}
	}, [handleUserInteraction, sendPresenceUpdate]);

	/**
	 * Handle window focus/blur
	 */
	const handleFocus = useCallback(() => {
		sendPresenceUpdate('online', activeChannelRef.current, true);
		handleUserInteraction();
	}, [handleUserInteraction, sendPresenceUpdate]);

	const handleBlur = useCallback(() => {
		sendPresenceUpdate('online_hidden', activeChannelRef.current, true);
		if (idleTimerRef.current) {
			clearTimeout(idleTimerRef.current);
		}
	}, [sendPresenceUpdate]);

	/**
	 * Periodic heartbeat to maintain presence
	 */
	useEffect(() => {
		if (!enabled) return;

		heartbeatTimerRef.current = setInterval(() => {
			sendPresenceUpdate(currentStatus.current, activeChannelRef.current, false);
		}, heartbeatInterval);

		return () => {
			if (heartbeatTimerRef.current) {
				clearInterval(heartbeatTimerRef.current);
			}
		};
	}, [enabled, heartbeatInterval, sendPresenceUpdate]);

	// Keep ref in sync with latest active channel and notify backend of changes
	useEffect(() => {
		if (!enabled) return;

		const normalized = activeChannelId ?? null;
		if (activeChannelRef.current !== normalized) {
			activeChannelRef.current = normalized;
			sendPresenceUpdate(currentStatus.current, activeChannelRef.current, true);
		}
	}, [activeChannelId, enabled, sendPresenceUpdate]);

	/**
	 * Monitor SSE connection status and handle connection changes
	 * Sends initial presence when connection is established or reconnected
	 */
	useEffect(() => {
		if (!enabled) return;

		// Poll for connection_id changes (SSE connection established/reconnected)
		const checkConnection = () => {
			const connectionId = typeof window === 'undefined'
				? null
				: sessionStorage.getItem(SSE_CONFIG.CONNECTION_ID_KEY);

			const lastConnectionId = lastSentRef.current?.connectionId;

			// Case 1: New connection established (no previous connection)
			if (connectionId && !lastSentRef.current) {
				console.log('[usePresenceTracking] SSE connection established, sending initial presence');
				lastInteractionTime.current = new Date();
				sendPresenceUpdate('online', activeChannelRef.current, true);
				handleUserInteraction();
			}
			// Case 2: Connection ID changed (SSE reconnected with new connection)
			else if (connectionId && lastConnectionId && connectionId !== lastConnectionId) {
				console.log('[usePresenceTracking] SSE connection_id changed (reconnected), updating presence', {
					oldConnectionId: lastConnectionId,
					newConnectionId: connectionId,
				});
				// Reset last sent ref to force update with new connection_id
				lastSentRef.current = null;
				lastInteractionTime.current = new Date();
				sendPresenceUpdate(currentStatus.current, activeChannelRef.current, true);
			}
			// Case 3: Connection lost (connection_id removed from storage)
			else if (!connectionId && lastSentRef.current) {
				console.log('[usePresenceTracking] SSE connection lost, waiting for reconnection');
				// Clear last sent ref so next connection triggers update
				lastSentRef.current = null;
			}
		};

		// Check immediately
		checkConnection();

		// Check periodically to detect connection changes
		const checkInterval = setInterval(checkConnection, 1000); // Check every second

		return () => {
			clearInterval(checkInterval);
		};
	}, [enabled, sendPresenceUpdate, handleUserInteraction]);

	/** Setup global listeners and handle cleanup */
	useEffect(() => {
		if (!enabled) return;

		// Page Visibility API
		document.addEventListener('visibilitychange', handleVisibilityChange);

		// Window focus/blur
		window.addEventListener('focus', handleFocus);
		window.addEventListener('blur', handleBlur);

		// User interaction events
		window.addEventListener('mousemove', handleUserInteraction);
		window.addEventListener('keydown', handleUserInteraction);
		window.addEventListener('scroll', handleUserInteraction, true); // Capture for nested scroll containers

		return () => {
			if (idleTimerRef.current) {
				clearTimeout(idleTimerRef.current);
			}
			if (heartbeatTimerRef.current) {
				clearInterval(heartbeatTimerRef.current);
			}

			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('focus', handleFocus);
			window.removeEventListener('blur', handleBlur);
			window.removeEventListener('mousemove', handleUserInteraction);
			window.removeEventListener('keydown', handleUserInteraction);
			window.removeEventListener('scroll', handleUserInteraction, true);

			// Send offline status on cleanup
			sendPresenceUpdate('offline', activeChannelRef.current, true);
		};
	}, [
		enabled,
		handleUserInteraction,
		handleVisibilityChange,
		handleFocus,
		handleBlur,
		sendPresenceUpdate,
	]);

	return {
		currentStatus: currentStatus.current,
	};
}
