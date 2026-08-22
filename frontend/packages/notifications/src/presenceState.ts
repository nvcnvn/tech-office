/**
 * Presence state store
 *
 * A small module-level store holding what a pong reports: the employee's state on this
 * connection, the channel they are viewing, and when they last interacted.
 *
 * Activity listeners (visibility, focus, idle timers) write here; the pong handler that
 * answers `ping` events reads here. Both live next to the SSE connection that owns the
 * connection id, which is why the old sessionStorage handshake and the one-second
 * polling loop that coordinated two separate modules are gone.
 */

import type { PresenceStatus } from 'apis';

export interface PresenceState {
	/** The employee's current state on THIS connection. */
	status: PresenceStatus;
	/** Channel currently being viewed; null when none. */
	activeChannelId: string | null;
	/** Last user interaction. Advisory — the server clamps it. */
	lastInteractionAt: Date;
	/**
	 * The live connection id, written by the SSE hook when the server announces it.
	 * Null while no stream is established. It lives here rather than in browser storage
	 * so it can never outlive the connection it names.
	 */
	connectionId: string | null;
}

type Listener = (state: PresenceState) => void;

let state: PresenceState = {
	status: 'online',
	activeChannelId: null,
	lastInteractionAt: new Date(),
	connectionId: null,
};

const listeners = new Set<Listener>();

/** Read the current reported state. */
export function getPresenceState(): PresenceState {
	return state;
}

/**
 * Merge a change into the reported state.
 *
 * Subscribers are notified only when something a colleague could observe changed —
 * status or active channel. A bare interaction-time refresh (mouse move, keypress) is
 * recorded but must not fire a pong, or an active user would pong on every event.
 */
export function setPresenceState(patch: Partial<PresenceState>): void {
	const next = { ...state, ...patch };
	const material =
		next.status !== state.status || next.activeChannelId !== state.activeChannelId;
	// A connection id change is not a material presence change: the stream that just
	// announced it will be challenged on its own schedule.

	state = next;

	if (material) {
		for (const listener of listeners) {
			listener(state);
		}
	}
}

/** Subscribe to material presence changes. Returns an unsubscribe function. */
export function subscribeToPresenceState(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
