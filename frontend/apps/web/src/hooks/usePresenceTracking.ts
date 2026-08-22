/**
 * Presence Tracking Hook
 *
 * Detects what the user is doing — tab visibility, window focus, interaction, idle —
 * and writes it into the shared presence store. It does NOT talk to the server: the
 * pong handler next to the SSE connection reads the store and answers the server's
 * pings, and fires one debounced unsolicited pong when something material changes.
 *
 * That split is why this hook no longer needs a 30-second heartbeat, a one-second
 * polling loop watching sessionStorage for a connection id, a triple-field dedup, or a
 * recovery path for a stale stored connection id. All of it existed only to coordinate
 * two modules that are now one.
 */

import { useEffect, useRef, useCallback } from 'react';
import { presencePong, type PresenceStatus } from 'apis';
import { getPresenceState, setPresenceState } from '@tech-office/notifications';

interface UsePresenceTrackingOptions {
	/** Active channel ID for context-aware notifications */
	activeChannelId?: string;
	/** Idle timeout in milliseconds (default: 5 minutes) */
	idleTimeout?: number;
	/** Enable/disable tracking */
	enabled?: boolean;
}

/**
 * Hook to track user presence.
 *
 * Features:
 * - Page Visibility API tracking (tab focus/blur)
 * - User interaction detection (mouse, keyboard, scroll)
 * - Idle timeout detection (default 5 minutes)
 * - Active channel context tracking
 * - A best-effort departing pong on teardown
 */
export function usePresenceTracking(options: UsePresenceTrackingOptions = {}) {
	const {
		activeChannelId,
		idleTimeout = 5 * 60 * 1000, // 5 minutes
		enabled = true,
	} = options;

	const idleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	/**
	 * Announce a deliberate teardown. Best-effort by design: if it does not land, the
	 * responsive window covers it, which is strictly better than the minutes-long
	 * lingering the old design produced.
	 */
	const sendDepartingPong = useCallback(() => {
		const { connectionId } = getPresenceState();
		if (!connectionId) return;

		void presencePong({
			connectionId,
			status: 'offline',
			activeChannelId: null,
			lastInteractionAt: new Date(),
			departing: true,
		}).catch(() => {
			// Ignored on purpose — see above.
		});
	}, []);

	const report = useCallback((status: PresenceStatus) => {
		if (!enabled) return;
		setPresenceState({ status, lastInteractionAt: new Date() });
	}, [enabled]);

	const scheduleIdleTimer = useCallback(() => {
		if (idleTimerRef.current) {
			clearTimeout(idleTimerRef.current);
		}

		idleTimerRef.current = setTimeout(() => {
			report('idle');
		}, idleTimeout);
	}, [idleTimeout, report]);

	const handleUserInteraction = useCallback(() => {
		if (!enabled) return;

		// Recording the interaction time alone is not a material change, so it does not
		// cost a pong — otherwise an active user would pong on every mouse move.
		setPresenceState({ lastInteractionAt: new Date() });

		if (getPresenceState().status === 'idle') {
			report('online');
		}

		scheduleIdleTimer();
	}, [enabled, report, scheduleIdleTimer]);

	const handleVisibilityChange = useCallback(() => {
		if (document.hidden) {
			// Hidden, not gone: the stream stays open and keeps answering pings.
			report('online_hidden');
			if (idleTimerRef.current) {
				clearTimeout(idleTimerRef.current);
			}
		} else {
			report('online');
			handleUserInteraction();
		}
	}, [handleUserInteraction, report]);

	const handleFocus = useCallback(() => {
		report('online');
		handleUserInteraction();
	}, [handleUserInteraction, report]);

	const handleBlur = useCallback(() => {
		report('online_hidden');
		if (idleTimerRef.current) {
			clearTimeout(idleTimerRef.current);
		}
	}, [report]);

	// Report the channel the user is looking at, so notifications about it can be
	// suppressed as already seen.
	useEffect(() => {
		if (!enabled) return;
		setPresenceState({ activeChannelId: activeChannelId ?? null });
	}, [activeChannelId, enabled]);

	/** Setup global listeners and handle cleanup */
	useEffect(() => {
		if (!enabled) return;

		report('online');
		scheduleIdleTimer();

		document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('focus', handleFocus);
		window.addEventListener('blur', handleBlur);
		window.addEventListener('mousemove', handleUserInteraction);
		window.addEventListener('keydown', handleUserInteraction);
		window.addEventListener('scroll', handleUserInteraction, true); // Capture for nested scroll containers

		// A closed or discarded tab never runs React cleanup, so the departure is also
		// announced on pagehide.
		window.addEventListener('pagehide', sendDepartingPong);

		return () => {
			if (idleTimerRef.current) {
				clearTimeout(idleTimerRef.current);
			}

			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('focus', handleFocus);
			window.removeEventListener('blur', handleBlur);
			window.removeEventListener('mousemove', handleUserInteraction);
			window.removeEventListener('keydown', handleUserInteraction);
			window.removeEventListener('scroll', handleUserInteraction, true);

			window.removeEventListener('pagehide', sendDepartingPong);

			sendDepartingPong();
		};
	}, [
		enabled,
		handleUserInteraction,
		handleVisibilityChange,
		handleFocus,
		handleBlur,
		report,
		scheduleIdleTimer,
		sendDepartingPong,
	]);

	return {
		currentStatus: getPresenceState().status,
	};
}
