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
import {
	confirmNotificationReceipt,
	streamNotifications,
	presencePong,
	PING_INTERVAL_SECONDS,
} from 'apis';
import type { SSEConnectionState, ConnectionStatus, DeliveryStatus, Notification, SourceDomain } from './types';
import { SSE_CONFIG, SSE_EVENT_TYPE } from './types';
import { getPresenceState, setPresenceState, subscribeToPresenceState } from './presenceState';

/**
 * A stream that has delivered no ping for two intervals is dead — most likely
 * half-open, where a proxy or radio dropped it while this tab kept believing it was
 * connected. Noticing that is the client-side half of what ping-pong buys.
 */
const DEAD_STREAM_TIMEOUT_MS = 2 * PING_INTERVAL_SECONDS * 1000;

/** At most one unsolicited pong per this window, per the protocol's client obligations. */
const UNSOLICITED_PONG_DEBOUNCE_MS = 500;

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
	const deadStreamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const unsolicitedPongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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

	// Only the last event ID is persisted. The connection id is never stored: it is
	// announced by connection_established on every stream, and a stored one could
	// outlive the connection it describes — the bug the old sessionStorage handshake
	// needed an explicit recovery path for.
	useEffect(() => {
		const savedEventId = localStorage.getItem(SSE_CONFIG.LAST_EVENT_ID_KEY);
		if (savedEventId) {
			setConnectionState((prev) => ({
				...prev,
				lastEventId: savedEventId,
			}));
		}
	}, []);

	const applyConnectionId = useCallback((connectionId: string | null) => {
		if (!connectionId) {
			return;
		}

		connectionIdRef.current = connectionId;
		// Publish it so the presence tracker can send a departing pong on teardown.
		setPresenceState({ connectionId });
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

	/**
	 * Answer a ping, or report a state change unsolicited.
	 *
	 * A RECONNECT directive means this connection no longer exists server-side; the
	 * only correct response is to drop the stream and re-establish, never to retry the
	 * pong against a dead connection id.
	 */
	const sendPong = useCallback(async (pingId?: string) => {
		const connectionId = connectionIdRef.current;
		if (!connectionId) {
			return;
		}

		const presence = getPresenceState();
		try {
			const directive = await presencePong({
				connectionId,
				pingId,
				status: presence.status,
				activeChannelId: presence.activeChannelId,
				lastInteractionAt: presence.lastInteractionAt,
			});

			if (directive === 'reconnect') {
				console.warn('[SSE] Server no longer knows this connection, re-establishing');
				connectionIdRef.current = null;
				setPresenceState({ connectionId: null });
				disconnectRef.current?.();
				connectRef.current?.();
			}
		} catch (err) {
			// A dropped pong is covered by the responsive window; the next ping retries.
			console.warn('[SSE] Failed to answer presence ping', err);
		}
	}, []);

	/**
	 * Restart the dead-stream watchdog. Called on every ping: if two intervals pass with
	 * no challenge, the stream is half-open and must be replaced.
	 */
	const armDeadStreamWatchdog = useCallback(() => {
		if (deadStreamTimeoutRef.current) {
			clearTimeout(deadStreamTimeoutRef.current);
		}
		deadStreamTimeoutRef.current = setTimeout(() => {
			console.warn('[SSE] No ping received for two intervals, treating stream as dead');
			disconnectRef.current?.();
			connectRef.current?.();
		}, DEAD_STREAM_TIMEOUT_MS);
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

		if (deadStreamTimeoutRef.current) {
			clearTimeout(deadStreamTimeoutRef.current);
			deadStreamTimeoutRef.current = null;
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
				if (event.eventType === SSE_EVENT_TYPE.PING) {
					// A liveness challenge: answer it, echoing the ping id. Nothing
					// server-side refreshes this connection's liveness, so failing to
					// answer is exactly how a client that has gone away is detected.
					setConnectionState((prev) => ({
						...prev,
						lastHeartbeat: new Date(),
					}));
					armDeadStreamWatchdog();
					void sendPong(event.eventId);
				} else if (event.eventType === SSE_EVENT_TYPE.CONNECTION_ESTABLISHED) {
					if (event.connectionId) {
						applyConnectionId(event.connectionId);
						armDeadStreamWatchdog();
					}

					if (event.eventId) {
						setConnectionState((prev) => ({
							...prev,
							lastEventId: event.eventId,
							lastEventAt: new Date(),
						}));
						localStorage.setItem(SSE_CONFIG.LAST_EVENT_ID_KEY, event.eventId);
					}
				} else if (event.eventType === SSE_EVENT_TYPE.NOTIFICATION && event.notification) {
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
	}, [applyConnectionId, armDeadStreamWatchdog, enabled, enqueueNotificationReceipt, scheduleReconnect, sendPong]);

	// Update connect ref whenever connect changes
	useEffect(() => {
		connectRef.current = connect;
	}, [connect]);

	// Update disconnect ref whenever disconnect changes
	useEffect(() => {
		disconnectRef.current = disconnect;
	}, [disconnect]);

	/**
	 * Report material presence changes — idle, return from idle, hidden, in a meeting,
	 * a channel switch — without waiting for the next ping. Debounced so a burst of
	 * changes costs one pong.
	 */
	useEffect(() => {
		if (!enabled) {
			return;
		}

		const unsubscribe = subscribeToPresenceState(() => {
			if (unsolicitedPongTimeoutRef.current) {
				clearTimeout(unsolicitedPongTimeoutRef.current);
			}
			unsolicitedPongTimeoutRef.current = setTimeout(() => {
				unsolicitedPongTimeoutRef.current = null;
				void sendPong();
			}, UNSOLICITED_PONG_DEBOUNCE_MS);
		});

		return () => {
			unsubscribe();
			if (unsolicitedPongTimeoutRef.current) {
				clearTimeout(unsolicitedPongTimeoutRef.current);
				unsolicitedPongTimeoutRef.current = null;
			}
		};
	}, [enabled, sendPong]);

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
