/**
 * @tech-office/notifications
 * Shared notification package for real-time notification management
 */

// Re-export all public types
export * from './types';

// Re-export utility functions
export * from './utils';

// Re-export the presence state store the pong handler reads from
export {
	getPresenceState,
	setPresenceState,
	subscribeToPresenceState,
	type PresenceState,
} from './presenceState';

// Re-export hooks
export { useSSEConnection } from './useSSEConnection';
export { useNotifications } from './useNotifications';
