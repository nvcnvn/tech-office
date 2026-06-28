/**
 * Notification API functions
 * ConnectRPC-based API calls for real-time notification management
 */

import { create } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { notificationClient, getRPCBaseUrl } from "./rpc";
import rpcCall from "./rpcWrapper";
import { notification } from "rpc";
import { getAuthToken } from "./token";

// Re-export the SubscriptionPreferenceLevel enum for UI consumers
export type { notification as NotificationProto };
export const SubscriptionPreferenceLevel = notification.SubscriptionPreferenceLevel;

// Type aliases for RPC response types
type ListNotificationsResponse = notification.ListNotificationsResponse;
type MarkAsReadResponse = notification.MarkAsReadResponse;
type MarkAllBeforeTimestampAsReadResponse = notification.MarkAllBeforeTimestampAsReadResponse;
type DeleteNotificationResponse = notification.DeleteNotificationResponse;
type GetUnreadCountResponse = notification.GetUnreadCountResponse;
type NotificationEvent = notification.NotificationEvent;
type ConfirmNotificationReceiptResponse = notification.ConfirmNotificationReceiptResponse;
type AcknowledgeNotificationsResponse = notification.AcknowledgeNotificationsResponse;
type AcknowledgeAllBeforeTimestampResponse = notification.AcknowledgeAllBeforeTimestampResponse;
type GetResourceSubscriptionResponse = notification.GetResourceSubscriptionResponse;
type SetResourceSubscriptionPreferenceResponse = notification.SetResourceSubscriptionPreferenceResponse;

/**
 * Notification type constants.
 * 
 * MUST align with:
 * - Database CHECK constraint: notification.notification.notification_type
 * - Backend Go constants: internal/notification/constants.go
 * - API contract: NotificationEvent.notification_type field
 * 
 * When adding/removing values:
 * 1. Update database CHECK constraint in backend/database/scripts/schema.sql
 * 2. Update backend Go constants
 * 3. Update this TypeScript type
 * 4. Submit all changes in single PR with alignment verification
 */
export type NotificationType =
	| 'message'
	| 'mention'
	| 'reply'
	| 'typing'
	| 'reaction'
	| 'voice_call_incoming'
	| 'voice_call_started'
	| 'voice_call_updated'
	| 'voice_call_ended'
	| 'task_assigned'
	| 'task_status_changed'
	| 'task_commented'
	| 'task_mentioned'
	| 'task_description_modified'
	| 'task_updated'
	| 'doc_updated'
	| 'doc_commented'
	| 'doc_mentioned';


/**
 * Source domain constants.
 * 
 * MUST align with:
 * - Database CHECK constraint: notification.notification.source_domain
 * - Backend Go constants: internal/notification/constants.go
 * 
 * When adding/removing values:
 * 1. Update database CHECK constraint in backend/database/scripts/schema.sql
 * 2. Update backend Go constants
 * 3. Update this TypeScript type
 * 4. Submit all changes in single PR with alignment verification
 */
export type SourceDomain =
	| 'chat'
	| 'crm'
	| 'projects'
	| 'docs'
	| 'hr'
	| 'support'
	| 'finance'
	| 'system';

export type NotificationPolicyKey =
	| 'persistent_default'
	| 'chat_message'
	| 'chat_mention'
	| 'chat_reply'
	| 'chat_typing_live'
	| 'chat_reaction_live'
	| 'chat_voice_call_incoming'
	| 'chat_voice_call_live'
	| 'chat_voice_call_record'
	| 'task_assignment'
	| 'task_comment'
	| 'task_mention'
	| 'task_status'
	| 'task_description_modified'
	| 'task_update'
	| 'document_update'
	| 'document_comment'
	| 'document_mention'
	| 'calendar_event_invite'
	| 'calendar_event_cancel'
	| 'calendar_event_change'
	| 'calendar_event_reminder'
	| 'calendar_check_in_missed'
	| 'calendar_event_digest';


/**
 * Notification priority constants.
 * 
 * MUST align with:
 * - Database CHECK constraint: notification.notification.priority
 * - Backend Go constants: internal/notification/constants.go
 */
export const NotificationPriority = {
	ALWAYS: 0,  // Deliver always (even if offline)
	DEFAULT: 1, // Deliver when not offline (default)
	ONLINE: 2,  // Deliver when online only
	SILENT: 4,  // Silent (no delivery, log only)
} as const;

export type NotificationPriorityValue = typeof NotificationPriority[keyof typeof NotificationPriority];

/**
 * List notifications for the authenticated employee with pagination.
 * Supports filtering by read status and ordering.
 */
export async function listNotifications(params?: {
	unreadOnly?: boolean;
	sourceDomains?: string[];
	pageSize?: number;
	pageToken?: string;
}): Promise<ListNotificationsResponse> {
	return rpcCall(async () => {
		const resp = await notificationClient.listNotifications({
			unreadOnly: params?.unreadOnly ?? false,
			sourceDomains: params?.sourceDomains ?? [],
			pageSize: params?.pageSize ?? 20,
			pageToken: params?.pageToken ?? "",
		});
		return resp as ListNotificationsResponse;
	});
}

/**
 * Mark one or more notifications as read.
 * Accepts single notification recipient ID or array of IDs.
 */
export async function markAsRead(notificationRecipientIds: string | string[]): Promise<MarkAsReadResponse> {
	const ids = Array.isArray(notificationRecipientIds) ? notificationRecipientIds : [notificationRecipientIds];
	return rpcCall(async () => {
		const resp = await notificationClient.markAsRead({
			notificationRecipientIds: ids
		});
		return resp as MarkAsReadResponse;
	});
}

/**
 * Mark a single notification as read (convenience alias).
 * @param notificationRecipientId - The notification recipient ID to mark as read
 */
export async function markNotificationAsRead(notificationRecipientId: string): Promise<MarkAsReadResponse> {
	return markAsRead(notificationRecipientId);
}

/**
 * Mark all notifications before a certain timestamp as read.
 * If no timestamp provided, marks all current notifications as read.
 * 
 */
export async function markAllBeforeTimestampAsRead(beforeTimestamp?: Date): Promise<MarkAllBeforeTimestampAsReadResponse> {
	return rpcCall(async () => {
		const resp = await notificationClient.markAllBeforeTimestampAsRead({
			beforeTimestamp: beforeTimestamp ? {
				seconds: BigInt(Math.floor(beforeTimestamp.getTime() / 1000)),
				nanos: (beforeTimestamp.getTime() % 1000) * 1_000_000,
			} : undefined,
		});
		return resp as MarkAllBeforeTimestampAsReadResponse;
	});
}

/**
 * Delete a notification from the employee's view (soft delete).
 */
export async function deleteNotification(notificationRecipientId: string): Promise<DeleteNotificationResponse> {
	return rpcCall(async () => {
		const resp = await notificationClient.deleteNotification({
			notificationRecipientId
		});
		return resp as DeleteNotificationResponse;
	});
}

/**
 * Get unread notification count for the authenticated employee.
 * Useful for displaying notification badge.
 */
export async function getUnreadCount(): Promise<GetUnreadCountResponse> {
	return rpcCall(async () => {
		const resp = await notificationClient.getUnreadCount({});
		return resp as GetUnreadCountResponse;
	});
}

export async function confirmNotificationReceipt(params: {
	notificationRecipientIds: string[];
	connectionId: string;
	platform: 'web' | 'mobile';
	appState: 'foreground' | 'background';
	visibilityState?: 'visible' | 'hidden';
	receivedAt?: Date;
}): Promise<ConfirmNotificationReceiptResponse> {
	return rpcCall(async () => {
		const receivedAt = params.receivedAt ?? new Date();
		const resp = await notificationClient.confirmNotificationReceipt({
			notificationRecipientIds: params.notificationRecipientIds,
			connectionId: params.connectionId,
			platform: params.platform,
			appState: params.appState,
			visibilityState: params.visibilityState ?? '',
			receivedAt: {
				seconds: BigInt(Math.floor(receivedAt.getTime() / 1000)),
				nanos: (receivedAt.getTime() % 1000) * 1_000_000,
			},
		});
		return resp as ConfirmNotificationReceiptResponse;
	});
}

/**
 * Acknowledgement action constants.
 * MUST align with backend/internal/notification/constants.go AckAction* values.
 */
export const AcknowledgementAction = {
	/** User navigated to the notification destination */
	DESTINATION_OPEN: 'destination_open',
	/** User explicitly dismissed/acknowledged */
	EXPLICIT_ACK: 'explicit_ack',
} as const;

export type AcknowledgementActionValue = typeof AcknowledgementAction[keyof typeof AcknowledgementAction];

/**
 * Acknowledgement status constants.
 * MUST align with backend/internal/notification/constants.go AcknowledgementStatus* values.
 */
export const AcknowledgementStatus = {
	PENDING: 'pending',
	ACKNOWLEDGED: 'acknowledged',
} as const;

export type AcknowledgementStatusValue = typeof AcknowledgementStatus[keyof typeof AcknowledgementStatus];

/**
 * Acknowledge one or more notifications as read/dismissed.
 * Triggers on destination open or explicit user action.
 *
 * @param notificationRecipientIds - IDs of notification_recipient rows to acknowledge
 * @param action - How acknowledgement was triggered (defaults to 'explicit_ack')
 */
export async function acknowledgeNotifications(
	notificationRecipientIds: string | string[],
	action: AcknowledgementActionValue = AcknowledgementAction.EXPLICIT_ACK,
): Promise<AcknowledgeNotificationsResponse> {
	const ids = Array.isArray(notificationRecipientIds) ? notificationRecipientIds : [notificationRecipientIds];
	return rpcCall(async () => {
		const resp = await notificationClient.acknowledgeNotifications({
			notificationRecipientIds: ids,
			acknowledgementAction: action,
		});
		return resp as AcknowledgeNotificationsResponse;
	});
}

/**
 * Acknowledge all pending notifications before a given timestamp.
 * Used for "mark all as read" bulk operations.
 *
 * @param beforeTimestamp - Optional cutoff date; omit to acknowledge all
 * @param action - How acknowledgement was triggered (defaults to 'explicit_ack')
 */
export async function acknowledgeAllBeforeTimestamp(
	beforeTimestamp?: Date,
	action: AcknowledgementActionValue = AcknowledgementAction.EXPLICIT_ACK,
): Promise<AcknowledgeAllBeforeTimestampResponse> {
	return rpcCall(async () => {
		const resp = await notificationClient.acknowledgeAllBeforeTimestamp({
			beforeTimestamp: beforeTimestamp ? {
				seconds: BigInt(Math.floor(beforeTimestamp.getTime() / 1000)),
				nanos: (beforeTimestamp.getTime() % 1000) * 1_000_000,
			} : undefined,
			acknowledgementAction: action,
		});
		return resp as AcknowledgeAllBeforeTimestampResponse;
	});
}

/**
 * Stream real-time notifications via Server-Sent Events (SSE).
 * Returns an async generator for streaming events.
 * 
 * @param lastEventId - Optional last event ID for replay after reconnection
 * 
 * @example
 * ```typescript
 * const stream = streamNotifications();
 * for await (const event of stream) {
 *   if (event.eventType === 'notification') {
 *     console.log('New notification:', event.notification);
 *   }
 * }
 * ```
 */
type StreamNotificationsOptions = {
	signal?: AbortSignal;
};

type StreamNotificationsLegacyParam = {
	lastEventId?: string;
};


export function streamNotifications(
	lastEventIdOrOptions?: string | StreamNotificationsLegacyParam | StreamNotificationsOptions,
	maybeOptions?: StreamNotificationsOptions
): AsyncGenerator<NotificationEvent, void, unknown> {
	let lastEventId: string | undefined;
	let options: StreamNotificationsOptions | undefined = maybeOptions;

	if (typeof lastEventIdOrOptions === 'string') {
		lastEventId = lastEventIdOrOptions;
	} else if (lastEventIdOrOptions && 'lastEventId' in lastEventIdOrOptions) {
		lastEventId = lastEventIdOrOptions.lastEventId;
		options = maybeOptions;
	} else if (lastEventIdOrOptions && 'signal' in lastEventIdOrOptions) {
		options = lastEventIdOrOptions;
	}

	return createNotificationSseStream({
		lastEventId,
		signal: options?.signal,
	});
}

async function* createNotificationSseStream({
	lastEventId,
	signal,
}: {
	lastEventId?: string;
	signal?: AbortSignal;
}): AsyncGenerator<NotificationEvent, void, unknown> {
	const token = await getAuthToken();
	if (!token) {
		throw new Error('Authentication required for notification stream');
	}

	const baseUrl = getRPCBaseUrl();
	const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	const url = new URL('api/notifications/stream', normalizedBase);
	url.searchParams.set('token', token);
	if (lastEventId) {
		url.searchParams.set('last_event_id', lastEventId);
	}

	const eventSource = new EventSource(url.toString());

	const queue: NotificationEvent[] = [];
	let pendingResolve: (() => void) | null = null;
	let closed = false;
	let failure: Error | null = null;

	const notify = () => {
		if (pendingResolve) {
			pendingResolve();
			pendingResolve = null;
		}
	};

	const handleMessage = (evt: MessageEvent<string>) => {
		try {
			const payload = JSON.parse(evt.data);
			const message = normalizeSsePayload(payload);
			queue.push(message);
			notify();
		} catch (error) {
			console.error('[streamNotifications] Failed to parse SSE payload', error);
		}
	};

	eventSource.onmessage = handleMessage;
	['notification', 'heartbeat', 'connection_established'].forEach((eventType) => {
		eventSource.addEventListener(eventType, (evt) => handleMessage(evt as MessageEvent<string>));
	});

	eventSource.onerror = () => {
		failure = new Error('SSE connection error');
		closed = true;
		eventSource.close();
		notify();
	};

	const abortListener = () => {
		closed = true;
		eventSource.close();
		notify();
	};
	signal?.addEventListener('abort', abortListener, { once: true });

	try {
		while (true) {
			if (queue.length === 0) {
				if (closed) {
					break;
				}

				await new Promise<void>((resolve) => {
					pendingResolve = resolve;
				});

				if (closed && queue.length === 0) {
					break;
				}
			}

			const next = queue.shift();
			if (next) {
				yield next;
			}
		}

		if (failure) {
			throw failure;
		}
	} finally {
		eventSource.close();
		signal?.removeEventListener('abort', abortListener);
	}
}

function normalizeSsePayload(raw: unknown): NotificationEvent {
	if (!raw || typeof raw !== 'object') {
		return create(notification.NotificationEventSchema, {}) as NotificationEvent;
	}

	const obj = raw as Record<string, unknown>;
	const partial: Record<string, unknown> = {};

	if (typeof obj.eventId === 'string') {
		partial.eventId = obj.eventId;
	}
	if (typeof obj.eventType === 'string') {
		partial.eventType = obj.eventType;
	}
	if (typeof obj.connectionId === 'string') {
		partial.connectionId = obj.connectionId;
	}

	const timestamp = normalizeTimestamp(obj.timestamp);
	if (timestamp) {
		partial.timestamp = timestamp;
	}

	if (obj.notification && typeof obj.notification === 'object') {
		partial.notification = normalizeNotificationSummary(obj.notification as Record<string, unknown>);
	}

	return create(notification.NotificationEventSchema, partial) as NotificationEvent;
}

function normalizeNotificationSummary(raw: Record<string, unknown>): notification.NotificationSummary {
	const partial: Record<string, unknown> = {};

	if (typeof raw.notificationId === 'string') {
		partial.notificationId = raw.notificationId;
	}
	if (typeof raw.notificationRecipientId === 'string') {
		partial.notificationRecipientId = raw.notificationRecipientId;
	}
	if (typeof raw.sourceDomain === 'string') {
		partial.sourceDomain = raw.sourceDomain;
	}
	if (typeof raw.notificationType === 'string') {
		partial.notificationType = raw.notificationType;
	}
	if (typeof raw.title === 'string') {
		partial.title = raw.title;
	}
	if (typeof raw.message === 'string') {
		partial.message = raw.message;
	}

	if (raw.actionData && typeof raw.actionData === 'object') {
		const actionData: Record<string, string> = {};
		for (const [key, value] of Object.entries(raw.actionData as Record<string, unknown>)) {
			if (typeof value === 'string') {
				actionData[key] = value;
			}
		}
		partial.actionData = actionData;
	}

	if (raw.readStatus !== undefined) {
		partial.readStatus = Boolean(raw.readStatus);
	}

	const readAt = normalizeTimestamp(raw.readAt);
	if (readAt) {
		partial.readAt = readAt;
	}

	if (typeof raw.deliveryStatus === 'string') {
		partial.deliveryStatus = raw.deliveryStatus;
	}

	const deliveredAt = normalizeTimestamp(raw.deliveredAt);
	if (deliveredAt) {
		partial.deliveredAt = deliveredAt;
	}

	// New lifecycle fields (spec 021)
	if (typeof raw.acknowledgementStatus === 'string') {
		partial.acknowledgementStatus = raw.acknowledgementStatus;
	}
	const acknowledgedAt = normalizeTimestamp(raw.acknowledgedAt);
	if (acknowledgedAt) {
		partial.acknowledgedAt = acknowledgedAt;
	}
	if (typeof raw.acknowledgementAction === 'string') {
		partial.acknowledgementAction = raw.acknowledgementAction;
	}
	if (typeof raw.policyKey === 'string') {
		partial.policyKey = raw.policyKey;
	}
	if (typeof raw.sourceCategory === 'string') {
		partial.sourceCategory = raw.sourceCategory;
	}
	if (raw.navigationTarget && typeof raw.navigationTarget === 'object') {
		const nt = raw.navigationTarget as Record<string, unknown>;
		partial.navigationTarget = create(notification.NavigationTargetSchema, {
			domain: typeof nt.domain === 'string' ? nt.domain : '',
			resourceType: typeof nt.resourceType === 'string' ? nt.resourceType : '',
			resourceId: typeof nt.resourceId === 'string' ? nt.resourceId : '',
			secondaryId: typeof nt.secondaryId === 'string' ? nt.secondaryId : '',
			action: typeof nt.action === 'string' ? nt.action : '',
		});
	}

	const createdAt = normalizeTimestamp(raw.createdAt);
	if (createdAt) {
		partial.createdAt = createdAt;
	}

	return create(notification.NotificationSummarySchema, partial) as notification.NotificationSummary;
}

function normalizeTimestamp(value: unknown): Partial<Timestamp> | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const obj = value as Record<string, unknown>;
	let seconds: bigint | undefined;

	if (typeof obj.seconds === 'bigint') {
		seconds = obj.seconds;
	} else if (typeof obj.seconds === 'number') {
		seconds = BigInt(Math.trunc(obj.seconds));
	} else if (typeof obj.seconds === 'string' && obj.seconds.trim() !== '') {
		try {
			seconds = BigInt(obj.seconds);
		} catch {
			return undefined;
		}
	}

	if (seconds === undefined) {
		return undefined;
	}

	const nanos = typeof obj.nanos === 'number' ? obj.nanos : 0;
	return { seconds, nanos };
}

/**
 * Publish notification (BACKEND SERVICES ONLY).
 * Not accessible to end users - requires ROLE_SYSTEM.
 * 
 * This function is exported for reference but will fail if called from frontend.
 * Use backend service-to-service communication instead.
 */
export async function publishNotification(params: {
	organizationId: string;
	recipients: {
		employeeIds?: string[];
		departmentIds?: string[];
	};
	sourceDomain: string;
	notificationType: string;
	title: string;
	message: string;
	actionData?: Record<string, string>;
	actionCategory?: string;
	priority?: number;
	publishingServiceId?: string;
}) {
	return rpcCall(() => notificationClient.publishNotification({
		organizationId: params.organizationId,
		recipients: {
			employeeIds: params.recipients.employeeIds ?? [],
			departmentIds: params.recipients.departmentIds ?? [],
		},
		sourceDomain: params.sourceDomain,
		notificationType: params.notificationType,
		title: params.title,
		message: params.message,
		actionData: params.actionData ?? {},
		actionCategory: params.actionCategory ?? "",
		priority: params.priority ?? 1,
		publishingServiceId: params.publishingServiceId ?? "frontend",
	}));
}

/**
 * Get the current user's subscription state and preference for a resource.
 */
export async function getResourceSubscription(params: {
	resourceDomain: string;
	resourceId: string;
}): Promise<GetResourceSubscriptionResponse> {
	return rpcCall(() => notificationClient.getResourceSubscription({
		resourceDomain: params.resourceDomain,
		resourceId: params.resourceId,
	}));
}

/**
 * Update the notification preference level for a resource subscription.
 * The user must have an active subscription (be following/watching the resource).
 */
export async function setResourceSubscriptionPreference(params: {
	resourceDomain: string;
	resourceId: string;
	preferenceLevel: notification.SubscriptionPreferenceLevel;
}): Promise<SetResourceSubscriptionPreferenceResponse> {
	return rpcCall(() => notificationClient.setResourceSubscriptionPreference({
		resourceDomain: params.resourceDomain,
		resourceId: params.resourceId,
		preferenceLevel: params.preferenceLevel,
	}));
}
