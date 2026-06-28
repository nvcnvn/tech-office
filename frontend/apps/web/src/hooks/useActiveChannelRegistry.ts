/**
 * Active Channel Registry
 *
 * Tracks which chat channel IDs are currently visible on screen.
 * Used by useNotificationPopup to suppress popups for channels the user
 * is already viewing — regardless of whether the chat is on the main
 * /workspace/chat page or embedded in tasks, docs, CRM, etc.
 *
 * Components that render a chat view (e.g. MessageList) register their
 * channelId on mount and unregister on unmount via useRegisterActiveChannel().
 */

import { useEffect } from 'react';

// Ref-counted set so overlapping mounts (e.g. React strict mode) are safe.
const channelRefCounts = new Map<string, number>();

function register(channelId: string) {
	channelRefCounts.set(channelId, (channelRefCounts.get(channelId) ?? 0) + 1);
}

function unregister(channelId: string) {
	const count = channelRefCounts.get(channelId) ?? 0;
	if (count <= 1) {
		channelRefCounts.delete(channelId);
	} else {
		channelRefCounts.set(channelId, count - 1);
	}
}

/** Returns true if any mounted component is displaying this channel. */
export function isChannelActive(channelId: string): boolean {
	return channelRefCounts.has(channelId);
}

/**
 * Hook — registers a channelId as "active" for the lifetime of the
 * calling component. Safe to call with undefined/null (no-op).
 */
export function useRegisterActiveChannel(channelId: string | undefined | null) {
	useEffect(() => {
		if (!channelId) return;
		register(channelId);
		return () => unregister(channelId);
	}, [channelId]);
}
