/**
 * useSSEConnection Hook
 * Manages Server-Sent Events (SSE) connection for real-time notifications
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Proactive 5-minute disconnect/reconnect
 * - Connection state tracking
 * - Error handling and recovery
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { confirmNotificationReceipt, streamNotifications } from 'apis';
import type { SSEConnectionState, ConnectionStatus, DeliveryStatus, Notification, SourceDomain } from './types';
import { SSE_CONFIG } from './types';

type TimestampLike = {
	seconds?: bigint | number | string;
	nanos?: number;
};

interface UseSSEConnectionOptions {
	organizationId: string;
	onNotification: (notification: Notification) => void;
	onError?: (error: Error) => void;
	enabled?: boolean; // Allow disabling the connection
}

interface UseSSEConnectionReturn {
	status: ConnectionStatus;
	error: Error | null;
	reconnect: () => void;
	disconnect: () => void;
}

/**
 * Hook for managing SSE connection to notification stream
 */
export function useSSEConnection({
	organizationId,
	onNotification,
	onError,
	enabled = true,
}: UseSSEConnectionOptions): UseSSEConnectionReturn {
	const [connectionState, setConnectionState] = useState<SSEConnectionState>({
		status: 'disconnected',
		lastEventId: null,
		connectionId: null,
		connectedAt: null,
		lastHeartbeat: null,
		lastEventAt: null,
		eventCount: 0,
		reconnectAttempt: 0,
		nextReconnectDelay: SSE_CONFIG.RECONNECT_DELAYS[0],
		nextProactiveDisconnect: null,
	});

	const [error, setError] = useState<Error | null>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const proactiveDisconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const receiptFlushTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const pendingReceiptIdsRef = useRef(new Set<string>());
	const connectionIdRef = useRef<string | null>(null);
	const mountedRef = useRef(false);
	const isConnectingRef = useRef(false); // Prevent race conditions during React remounts

	// Use refs for callbacks to avoid recreating connect function on every render
	const onNotificationRef = useRef(onNotification);
	const onErrorRef = useRef(onError);

	// Use ref to store the latest connect function
	const connectRef = useRef<(() => Promise<void>) | undefined>(undefined);
	const disconnectRef = useRef<(() => void) | undefined>(undefined);

	// Update refs when callbacks change (without triggering reconnection)
	useEffect(() => {
		onNotificationRef.current = onNotification;
	}, [onNotification]);

	useEffect(() => {
		onErrorRef.current = onError;
	}, [onError]);

	// Load saved identifiers from localStorage (eventId) and sessionStorage (connectionId) on mount
	useEffect(() => {
		const savedEventId = localStorage.getItem(SSE_CONFIG.LAST_EVENT_ID_KEY);
		// Use sessionStorage for connection_id - clears on page reload/tab close
		const savedConnectionId = sessionStorage.getItem(SSE_CONFIG.CONNECTION_ID_KEY);
		if (savedConnectionId) {
			connectionIdRef.current = savedConnectionId;
		}
		if (savedEventId || savedConnectionId) {
			setConnectionState((prev) => ({
				...prev,
				lastEventId: savedEventId ?? prev.lastEventId,
				connectionId: savedConnectionId ?? prev.connectionId,
			}));
		}
	}, []);

	const applyConnectionId = useCallback((connectionId: string | null) => {
		if (!connectionId) {
			return;
		}

		connectionIdRef.current = connectionId;
		// Use sessionStorage for connection_id - clears on page reload/tab close
		sessionStorage.setItem(SSE_CONFIG.CONNECTION_ID_KEY, connectionId);
		setConnectionState((prev) => {
			if (prev.connectionId === connectionId) {
				return prev;
			}
			return {
				...prev,
				connectionId,
			};
		});
	}, []);

	const flushReceiptBatch = useCallback(() => {
		if (receiptFlushTimeoutRef.current) {
			clearTimeout(receiptFlushTimeoutRef.current);
			receiptFlushTimeoutRef.current = null;
		}

		const connectionId = connectionIdRef.current;
		const ids = Array.from(pendingReceiptIdsRef.current);
		pendingReceiptIdsRef.current.clear();
		if (!connectionId || ids.length === 0) {
			return;
		}
		if (typeof document !== 'undefined' && document.hidden) {
			return;
		}

		void confirmNotificationReceipt({
			notificationRecipientIds: ids,
			connectionId,
			platform: 'web',
			appState: 'foreground',
			visibilityState: 'visible',
		}).catch((error) => {
			console.warn('[SSE] Failed to confirm notification receipt', error);
		});
	}, []);

	const enqueueNotificationReceipt = useCallback((notification: Notification) => {
		if (!notification.notificationRecipientId || !connectionIdRef.current) {
			return;
		}
		if (typeof document !== 'undefined' && document.hidden) {
			return;
		}

		pendingReceiptIdsRef.current.add(notification.notificationRecipientId);
		if (receiptFlushTimeoutRef.current) {
			return;
		}
		receiptFlushTimeoutRef.current = setTimeout(flushReceiptBatch, 250);
	}, [flushReceiptBatch]);

	// Disconnect - defined first so it can be used by other functions
	const disconnect = useCallback(() => {
		console.log('[SSE] Disconnecting');

		// Clear connecting flag
		isConnectingRef.current = false;

		// Clear abort controller
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}

		// Clear timers
		if (reconnectTimeoutRef.current) {
			clearTimeout(reconnectTimeoutRef.current);
			reconnectTimeoutRef.current = null;
		}

		if (proactiveDisconnectTimeoutRef.current) {
			clearTimeout(proactiveDisconnectTimeoutRef.current);
			proactiveDisconnectTimeoutRef.current = null;
		}

		flushReceiptBatch();

		setConnectionState((prev) => ({
			...prev,
			status: 'disconnected',
			connectedAt: null,
			nextProactiveDisconnect: null,
		}));
	}, []);

	// Schedule reconnection with exponential backoff - defined early to avoid circular dependency
	const scheduleReconnect = useCallback(() => {
		setConnectionState((prev) => {
			const attempt = prev.reconnectAttempt;
			const delayIndex = Math.min(attempt, SSE_CONFIG.RECONNECT_DELAYS.length - 1);
			const delay = SSE_CONFIG.RECONNECT_DELAYS[delayIndex];

			console.log(`[SSE] Scheduling reconnect attempt ${attempt + 1} in ${delay}ms`);

			reconnectTimeoutRef.current = setTimeout(() => {
				connectRef.current?.();
			}, delay);

			return {
				...prev,
				reconnectAttempt: attempt + 1,
				nextReconnectDelay: delay,
			};
		});
	}, []); // No dependencies - uses connectRef

	// Connect to SSE stream
	const connect = useCallback(async () => {
		if (!enabled) {
			console.log('[SSE] Connect skipped - not enabled');
			return;
		}

		// Prevent duplicate connections - check both abort controller and connecting state
		if (abortControllerRef.current || isConnectingRef.current) {
			console.log('[SSE] Connection already active or in progress, skipping duplicate connect', {
				hasAbortController: !!abortControllerRef.current,
				isConnecting: isConnectingRef.current,
			});
			return;
		}

		console.log('[SSE] Starting new connection', {
			enabled,
			hasAbortController: false,
			isConnecting: false,
		});

		// Set connecting flag to prevent race conditions
		isConnectingRef.current = true;

		// Create new abort controller for this connection
		abortControllerRef.current = new AbortController();

		setConnectionState((prev) => ({
			...prev,
			status: 'connecting',
		}));
		setError(null);

		try {
			// Read lastEventId from localStorage directly to avoid state dependency
			const lastEventId = localStorage.getItem(SSE_CONFIG.LAST_EVENT_ID_KEY);
			const stream = streamNotifications(lastEventId || undefined, {
				signal: abortControllerRef.current?.signal,
			});

			setConnectionState((prev) => ({
				...prev,
				status: 'connected',
				connectedAt: new Date(),
				reconnectAttempt: 0,
				nextReconnectDelay: SSE_CONFIG.RECONNECT_DELAYS[0],
				nextProactiveDisconnect: new Date(Date.now() + SSE_CONFIG.PROACTIVE_DISCONNECT_INTERVAL),
			}));

			// Clear connecting flag after successful connection
			isConnectingRef.current = false;

			// Schedule proactive disconnect after 5 minutes
			proactiveDisconnectTimeoutRef.current = setTimeout(() => {
				console.log('[SSE] Proactive disconnect after 5 minutes');
				disconnectRef.current?.();
				setTimeout(() => connectRef.current?.(), 1000); // Reconnect after 1 second
			}, SSE_CONFIG.PROACTIVE_DISCONNECT_INTERVAL);

			// Process stream events
			for await (const event of stream) {
				if (abortControllerRef.current?.signal.aborted) {
					break;
				}

				// Handle different event types
				if (event.eventType === 'heartbeat') {
					setConnectionState((prev) => ({
						...prev,
						lastHeartbeat: new Date(),
					}));
				} else if (event.eventType === 'connection_established') {
					if (event.connectionId) {
						applyConnectionId(event.connectionId);
					}

					if (event.eventId) {
						setConnectionState((prev) => ({
							...prev,
							lastEventId: event.eventId,
							lastEventAt: new Date(),
						}));
						localStorage.setItem(SSE_CONFIG.LAST_EVENT_ID_KEY, event.eventId);
					}
				} else if (event.eventType === 'notification' && event.notification) {
					const timestampToDate = (ts?: TimestampLike | null): Date | null => {
						if (!ts) return null;
						const seconds = typeof ts.seconds === 'bigint' ? Number(ts.seconds) : Number(ts.seconds ?? 0);
						const nanos = ts.nanos || 0;
						return new Date(seconds * 1000 + nanos / 1000000);
					};

					// Map proto to frontend notification type
					const notification: Notification = {
						notificationId: event.notification.notificationId,
						notificationRecipientId: event.notification.notificationRecipientId,
						sourceDomain: event.notification.sourceDomain as SourceDomain,
						notificationType: event.notification.notificationType,
						title: event.notification.title,
						message: event.notification.message,
						actionData: typeof event.notification.actionData === 'string'
							? JSON.parse(event.notification.actionData) as Record<string, unknown>
							: event.notification.actionData || null,
						readStatus: event.notification.readStatus,
						readAt: timestampToDate(event.notification.readAt),
						deliveryStatus: event.notification.deliveryStatus as DeliveryStatus,
						deliveredAt: timestampToDate(event.notification.deliveredAt),
						acknowledgementStatus: (event.notification.acknowledgementStatus || 'pending') as 'pending' | 'acknowledged',
						acknowledgedAt: timestampToDate(event.notification.acknowledgedAt),
						acknowledgementAction: event.notification.acknowledgementAction || '',
						policyKey: event.notification.policyKey || '',
						sourceCategory: event.notification.sourceCategory || '',
						navigationTarget: event.notification.navigationTarget ? {
							domain: event.notification.navigationTarget.domain || '',
							resourceType: event.notification.navigationTarget.resourceType || '',
							resourceId: event.notification.navigationTarget.resourceId || '',
							secondaryId: event.notification.navigationTarget.secondaryId || '',
							action: event.notification.navigationTarget.action || '',
						} : null,
						createdAt: timestampToDate(event.notification.createdAt) || new Date(),
					};

					// Update last event ID and save to localStorage
					if (event.eventId) {
						localStorage.setItem(SSE_CONFIG.LAST_EVENT_ID_KEY, event.eventId);
						setConnectionState((prev) => ({
							...prev,
							lastEventId: event.eventId,
							lastEventAt: new Date(),
							eventCount: prev.eventCount + 1,
						}));
					}

					// Invoke callback
					enqueueNotificationReceipt(notification);
					onNotificationRef.current(notification);
				}
			}
		} catch (err) {
			const errorLike = err as (Error & { code?: unknown; rawMessage?: unknown }) | undefined;
			const errorCode = errorLike?.code;
			const lowerMessage = typeof errorLike?.message === 'string' ? errorLike.message.toLowerCase() : undefined;
			const errorDetails = {
				err: errorLike,
				name: errorLike?.name,
				message: errorLike?.message,
				code: errorCode,
				rawMessage: errorLike?.rawMessage,
			};
			const isAbortError =
				errorLike instanceof DOMException && errorLike.name === 'AbortError' ||
				errorLike?.name === 'AbortError' ||
				errorCode === 'CANCELED' ||
				errorCode === 'Canceled' ||
				lowerMessage === 'canceled' ||
				lowerMessage === 'cancelled' ||
				(typeof errorCode === 'number' && errorCode === 1);

			if (isAbortError) {
				console.log('[SSE] Connection aborted', errorDetails);
				isConnectingRef.current = false;
				return;
			}

			console.error('[SSE] Connection caught error', errorDetails);

			const error = err instanceof Error ? err : new Error('SSE connection failed');
			console.error('[SSE] Connection error:', error);
			setError(error);
			if (onErrorRef.current) {
				onErrorRef.current(error);
			}

			// Clear connecting flag on error
			isConnectingRef.current = false;

			setConnectionState((prev) => ({
				...prev,
				status: 'error',
			}));

			// Schedule reconnection with exponential backoff
			scheduleReconnect();
		}
	}, [applyConnectionId, enabled, enqueueNotificationReceipt, scheduleReconnect]); // Depend on enabled, scheduleReconnect, and connection handler

	// Update connect ref whenever connect changes
	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	// Update disconnect ref whenever disconnect changes
	useEffect(() => {
		disconnectRef.current = disconnect;
	}, [disconnect]);

	// Manual reconnect
	const reconnect = useCallback(() => {
		console.log('[SSE] Manual reconnect triggered');
		disconnect();
		setConnectionState((prev) => ({ ...prev, reconnectAttempt: 0 }));
		connectRef.current?.();
	}, [disconnect]);

	// Auto-connect on mount and when organizationId changes
	useEffect(() => {
		console.log('[SSE] useEffect triggered', {
			enabled,
			organizationId,
			mounted: mountedRef.current,
			hasAbortController: !!abortControllerRef.current,
			isConnecting: isConnectingRef.current,
		});

		// If already mounted with active connection, skip (prevents React strict mode double-mount)
		if (mountedRef.current && (abortControllerRef.current || isConnectingRef.current)) {
			console.log('[SSE] Skipping connect - already have active connection from previous mount');
			return;
		}

		// Mark as mounted
		mountedRef.current = true;

		// Ensure any previous connection is cleaned up before starting new one
		if (abortControllerRef.current || isConnectingRef.current) {
			console.log('[SSE] Cleaning up previous connection before starting new one');
			disconnect();
		}

		if (enabled) {
			connect();
		}

		return () => {
			console.log('[SSE] useEffect cleanup called', {
				willDisconnect: mountedRef.current,
			});

			// Only truly disconnect if this is a real unmount (organizationId change or component unmount)
			// Don't disconnect on React strict mode remounts
			if (mountedRef.current) {
				disconnect();
				mountedRef.current = false;
			}
		};
	}, [organizationId, enabled]); // Only reconnect when org or enabled changes, not when connect/disconnect change

	return {
		status: connectionState.status,
		error,
		reconnect,
		disconnect,
	};
}
