/**
 * Chat Notification Action Handler
 * Handles deep linking from notifications to specific chat messages
 * 
 * Actions:
 * - view_message: Navigate to message in channel (with highlight)
 * - view_thread: Navigate to the parent message and open thread view
 * 
 * Examples:
 * - Mention notification → Navigate to /workspace/chat?channel=X&message=Y
 * - Reply notification → Navigate to /workspace/chat?channel=X&thread=PARENT&message=REPLY
 * 
 * Integration:
 * - Called from workspace layout when notification clicked
 * - Uses Next.js router for navigation
 * - Calls markAsRead API after navigation
 */

import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { markAsRead } from 'apis';

/**
 * Chat action data structure
 * Parsed from notification.actionData
 */
interface ChatActionData {
	channelId: string;
	messageId?: string;
	action?: 'view_message' | 'view_thread';
	parentMessageId?: string; // For reply events
}

/**
 * Handle chat notification action
 * 
 * @param router - Next.js router instance
 * @param notificationId - Notification ID to mark as read
 * @param notificationRecipientId - Notification recipient ID for mark as read operation
 * @param actionData - Chat action data from notification
 * 
 * Usage:
 * ```tsx
 * // In workspace layout
 * const router = useRouter();
 * 
 * const handleNotificationClick = (notification: Notification) => {
 *   if (notification.sourceDomain === 'chat') {
 *     handleChatNotificationAction(
 *       router,
 *       notification.notificationId,
 *       notification.notificationRecipientId,
 *       notification.actionData as ChatActionData
 *     );
 *   }
 * };
 * ```
 */
export async function handleChatNotificationAction(
	router: AppRouterInstance,
	notificationId: string,
	notificationRecipientId: string,
	actionData: ChatActionData | null
): Promise<void> {
	if (!actionData?.channelId) {
		console.error('[handleChatNotificationAction] Missing channelId in actionData', actionData);
		return;
	}

	const { channelId, messageId, action, parentMessageId } = actionData;

	// Build navigation URL
	const params = new URLSearchParams();
	params.set('channel', channelId);

	if (action === 'view_thread' && parentMessageId) {
		params.set('thread', parentMessageId);
		params.set('message', messageId || parentMessageId);
	} else if (messageId) {
		params.set('message', messageId);
	}

	const url = `/workspace/chat?${params.toString()}`;

	console.log('[handleChatNotificationAction] Navigating to:', url, {
		action,
		channelId,
		messageId,
		parentMessageId,
	});

	// Navigate to chat page with channel and message params
	router.push(url);

	// Mark notification as read
	try {
		await markAsRead(notificationRecipientId);
		console.log('[handleChatNotificationAction] Marked notification as read:', notificationId);
	} catch (err) {
		console.error('[handleChatNotificationAction] Failed to mark notification as read:', err);
		// Don't block navigation on mark-as-read failure
	}
}

/**
 * Check if action data is for chat domain
 * Type guard for TypeScript
 */
export function isChatActionData(actionData: unknown): actionData is ChatActionData {
	if (!actionData || typeof actionData !== 'object') {
		return false;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const data = actionData as any;
	return typeof data.channelId === 'string';
}
