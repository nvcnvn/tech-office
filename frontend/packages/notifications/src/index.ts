/**
 * @tech-office/notifications
 * Shared notification package for real-time notification management
 */

// Re-export all public types
export * from './types';

// Re-export utility functions
export * from './utils';

// Re-export hooks
export { useSSEConnection } from './useSSEConnection';
export { useNotifications } from './useNotifications';
