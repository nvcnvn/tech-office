/**
 * useNotifications Hook
 * Manages notification state, filtering, and pagination
 * 
 * Features:
 * - Client-side notification list management
 * - Optimistic UI updates for mark as read
 * - Client-side filtering (read/unread, domain)
 * - Pagination state management
 * - Real-time notification prepending from SSE
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
	listNotifications,
	markAsRead as apiMarkAsRead,
	markAllBeforeTimestampAsRead as apiMarkAllBeforeTimestampAsRead,
	deleteNotification as apiDeleteNotification,
	getUnreadCount as apiGetUnreadCount,
	acknowledgeNotifications as apiAcknowledgeNotifications,
	acknowledgeAllBeforeTimestamp as apiAcknowledgeAll,
	AcknowledgementAction,
} from 'apis';
import { notification } from 'rpc';
import type {
	Notification,
	NotificationFilters,
	PaginationState,
	UnreadCount,
	SourceDomain,
} from './types';
import { DEFAULT_FILTERS, DEFAULT_PAGINATION, DEFAULT_UNREAD_COUNT } from './types';

type ListNotificationsResponse = notification.ListNotificationsResponse;
type GetUnreadCountResponse = notification.GetUnreadCountResponse;

// Helper to convert Timestamp to Date
const timestampToDate = (ts: any): Date | null => {
	if (!ts) return null;
	// Protobuf Timestamp has seconds (BigInt) and nanos (number)
	const seconds = typeof ts.seconds === 'bigint' ? Number(ts.seconds) : ts.seconds;
	const nanos = ts.nanos || 0;
	return new Date(seconds * 1000 + nanos / 1000000);
};

interface UseNotificationsOptions {
	organizationId: string;
	initialFilters?: Partial<NotificationFilters>;
}

interface UseNotificationsReturn {
	// State
	notifications: Notification[];
	filteredNotifications: Notification[];
	unreadCount: UnreadCount;
	filters: NotificationFilters;
	loading: boolean;
	hasMore: boolean;

	// Actions
	loadMore: () => Promise<void>;
	markAsRead: (notificationRecipientId: string) => Promise<void>;
	markAllAsRead: () => Promise<void>;
	deleteNotification: (notificationRecipientId: string) => Promise<void>;
	setFilters: (filters: Partial<NotificationFilters>) => void;
	refreshUnreadCount: () => Promise<void>;

	// SSE integration
	addRealtimeNotification: (notification: Notification) => void;
}

/**
 * Hook for managing notifications state
 */
export function useNotifications({
	organizationId,
	initialFilters,
}: UseNotificationsOptions): UseNotificationsReturn {
	const [notifications, setNotifications] = useState<Notification[]>([]);
	const [filters, setFiltersState] = useState<NotificationFilters>({
		...DEFAULT_FILTERS,
		...initialFilters,
	});
	const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);
	const [unreadCount, setUnreadCount] = useState<UnreadCount>(DEFAULT_UNREAD_COUNT);

	// Track if initial load has been attempted to prevent duplicate calls
	const initialLoadAttemptedRef = useRef(false);

	// Load initial notifications
	useEffect(() => {
		// Prevent duplicate initial loads (React strict mode double-mount)
		if (initialLoadAttemptedRef.current) {
			console.log('[useNotifications] Skipping duplicate initial load');
			return;
		}

		initialLoadAttemptedRef.current = true;
		loadInitialNotifications();
		refreshUnreadCount();
	}, [organizationId]);

	// Load first page of notifications
	const loadInitialNotifications = async () => {
		console.log('[useNotifications] Loading initial notifications');
		setPagination((prev) => ({ ...prev, loadingState: 'loading' }));

		try {
			const response = await listNotifications({
				unreadOnly: false,
				sourceDomains: [],
				pageSize: pagination.itemsPerPage,
				pageToken: '',
			});

			const mappedNotifications: Notification[] = response.notifications.map((proto: any) => ({
				notificationId: proto.notificationId,
				notificationRecipientId: proto.notificationRecipientId,
				sourceDomain: proto.sourceDomain as SourceDomain,
				notificationType: proto.notificationType,
				title: proto.title,
				message: proto.message,
				actionData: typeof proto.actionData === 'string'
					? JSON.parse(proto.actionData)
					: proto.actionData || null,
				readStatus: proto.readStatus,
				readAt: timestampToDate(proto.readAt),
				deliveryStatus: proto.deliveryStatus as any,
				deliveredAt: timestampToDate(proto.deliveredAt),
				acknowledgementStatus: (proto.acknowledgementStatus || 'pending') as 'pending' | 'acknowledged',
				acknowledgedAt: timestampToDate(proto.acknowledgedAt),
				acknowledgementAction: proto.acknowledgementAction || '',
				policyKey: proto.policyKey || '',
				sourceCategory: proto.sourceCategory || '',
				navigationTarget: proto.navigationTarget ? {
					domain: proto.navigationTarget.domain || '',
					resourceType: proto.navigationTarget.resourceType || '',
					resourceId: proto.navigationTarget.resourceId || '',
					secondaryId: proto.navigationTarget.secondaryId || '',
					action: proto.navigationTarget.action || '',
				} : null,
				createdAt: timestampToDate(proto.createdAt) || new Date(),
			}));

			console.log('[useNotifications] Loaded initial notifications:', mappedNotifications.length);

			// Check for duplicates in the response itself
			const recipientIds = mappedNotifications.map(n => n.notificationRecipientId);
			const uniqueIds = new Set(recipientIds);
			if (recipientIds.length !== uniqueIds.size) {
				console.error('[useNotifications] BACKEND RETURNED DUPLICATES!', {
					total: recipientIds.length,
					unique: uniqueIds.size,
					duplicates: recipientIds.filter((id, index) => recipientIds.indexOf(id) !== index)
				});
			}

			// Deduplicate with existing notifications (in case SSE added some while loading)
			setNotifications((prev) => {
				if (prev.length === 0) {
					// No existing notifications, just set the new ones
					return mappedNotifications;
				}

				// Merge and deduplicate
				const existingIds = new Set(prev.map((n) => n.notificationRecipientId));
				const newNotifications = mappedNotifications.filter(
					(n) => !existingIds.has(n.notificationRecipientId)
				);

				console.log('[useNotifications] Deduplicating initial load - existing:', prev.length, 'new:', newNotifications.length);

				// Keep SSE notifications at the top (they're newer), add initial load after
				return [...prev, ...newNotifications];
			});
			setPagination((prev) => ({
				...prev,
				loadingState: 'idle',
				nextPageToken: response.nextPageToken || null,
				hasNextPage: !!response.nextPageToken,
			}));
		} catch (err) {
			console.error('[useNotifications] Failed to load notifications:', err);
			setPagination((prev) => ({
				...prev,
				loadingState: 'error',
				error: err instanceof Error ? err : new Error('Failed to load notifications'),
			}));
		}
	};

	// Load more notifications (pagination)
	const loadMore = useCallback(async () => {
		if (!pagination.hasNextPage || pagination.loadingState === 'loading') {
			return;
		}

		setPagination((prev) => ({ ...prev, loadingState: 'loading' }));

		try {
			const response = await listNotifications({
				unreadOnly: false,
				sourceDomains: [],
				pageSize: pagination.itemsPerPage,
				pageToken: pagination.nextPageToken || '',
			});

			const mappedNotifications: Notification[] = response.notifications.map((proto: any) => ({
				notificationId: proto.notificationId,
				notificationRecipientId: proto.notificationRecipientId,
				sourceDomain: proto.sourceDomain as SourceDomain,
				notificationType: proto.notificationType,
				title: proto.title,
				message: proto.message,
				actionData: typeof proto.actionData === 'string'
					? JSON.parse(proto.actionData)
					: proto.actionData || null,
				readStatus: proto.readStatus,
				readAt: timestampToDate(proto.readAt),
				deliveryStatus: proto.deliveryStatus as any,
				deliveredAt: timestampToDate(proto.deliveredAt),
				acknowledgementStatus: (proto.acknowledgementStatus || 'pending') as 'pending' | 'acknowledged',
				acknowledgedAt: timestampToDate(proto.acknowledgedAt),
				acknowledgementAction: proto.acknowledgementAction || '',
				policyKey: proto.policyKey || '',
				sourceCategory: proto.sourceCategory || '',
				navigationTarget: proto.navigationTarget ? {
					domain: proto.navigationTarget.domain || '',
					resourceType: proto.navigationTarget.resourceType || '',
					resourceId: proto.navigationTarget.resourceId || '',
					secondaryId: proto.navigationTarget.secondaryId || '',
					action: proto.navigationTarget.action || '',
				} : null,
				createdAt: timestampToDate(proto.createdAt) || new Date(),
			}));

			// Deduplicate notifications by notificationRecipientId
			setNotifications((prev) => {
				const existingIds = new Set(prev.map((n) => n.notificationRecipientId));
				const newNotifications = mappedNotifications.filter(
					(n) => !existingIds.has(n.notificationRecipientId)
				);
				return [...prev, ...newNotifications];
			});
			setPagination((prev) => ({
				...prev,
				loadingState: 'idle',
				currentPage: prev.currentPage + 1,
				nextPageToken: response.nextPageToken || null,
				hasNextPage: !!response.nextPageToken,
			}));
		} catch (err) {
			console.error('[useNotifications] Failed to load more notifications:', err);
			setPagination((prev) => ({
				...prev,
				loadingState: 'error',
				error: err instanceof Error ? err : new Error('Failed to load more notifications'),
			}));
		}
	}, [pagination]);

	// Mark notification as read (optimistic update)
	const markAsRead = useCallback(async (notificationRecipientId: string) => {
		// Optimistic update
		setNotifications((prev) =>
			prev.map((n) =>
				n.notificationRecipientId === notificationRecipientId
					? { ...n, readStatus: true, readAt: new Date(), acknowledgementStatus: 'acknowledged' as const, acknowledgedAt: new Date(), acknowledgementAction: AcknowledgementAction.EXPLICIT_ACK }
					: n
			)
		);

		// Update unread count optimistically
		setUnreadCount((prev) => ({
			...prev,
			total: Math.max(0, prev.total - 1),
		}));

		try {
			await apiMarkAsRead(notificationRecipientId);
			// Also call acknowledge to keep lifecycle consistent
			try {
				await apiAcknowledgeNotifications(notificationRecipientId, AcknowledgementAction.EXPLICIT_ACK);
			} catch {
				// Non-fatal: acknowledge API may not exist in older deployments
			}
			// Success - optimistic update was correct
		} catch (err) {
			console.error('[useNotifications] Failed to mark as read:', err);
			// Revert optimistic update
			await loadInitialNotifications();
			await refreshUnreadCount();
		}
	}, []);

	// Mark all notifications as read
	const markAllAsRead = useCallback(async () => {
		try {
			await apiMarkAllBeforeTimestampAsRead();
			try {
				await apiAcknowledgeAll(undefined, AcknowledgementAction.EXPLICIT_ACK);
			} catch {
				// Non-fatal
			}

			// Update all notifications to acknowledged
			setNotifications((prev) =>
				prev.map((n) => ({ ...n, readStatus: true, readAt: new Date(), acknowledgementStatus: 'acknowledged' as const, acknowledgedAt: new Date() }))
			);

			// Reset unread count
			setUnreadCount((prev) => ({
				...prev,
				total: 0,
				bySourceDomain: {
					chat: 0,
					crm: 0,
					projects: 0,
					hr: 0,
					support: 0,
					finance: 0,
					system: 0,
				},
			}));
		} catch (err) {
			console.error('[useNotifications] Failed to mark all as read:', err);
			// Reload to get correct state
			await loadInitialNotifications();
			await refreshUnreadCount();
		}
	}, []);

	// Delete notification
	const deleteNotification = useCallback(async (notificationRecipientId: string) => {
		try {
			await apiDeleteNotification(notificationRecipientId);

			// Remove from local state
			setNotifications((prev) =>
				prev.filter((n) => n.notificationRecipientId !== notificationRecipientId)
			);
		} catch (err) {
			console.error('[useNotifications] Failed to delete notification:', err);
		}
	}, []);

	// Update filters
	const setFilters = useCallback((newFilters: Partial<NotificationFilters>) => {
		setFiltersState((prev) => ({
			...prev,
			...newFilters,
			appliedAt: new Date(),
		}));
	}, []);

	// Refresh unread count
	const refreshUnreadCount = useCallback(async () => {
		try {
			const response = await apiGetUnreadCount();
			setUnreadCount({
				total: response.unreadCount,
				bySourceDomain: {
					chat: response.unreadBySourceDomain['chat'] || 0,
					crm: response.unreadBySourceDomain['crm'] || 0,
					projects: response.unreadBySourceDomain['projects'] || 0,
					hr: response.unreadBySourceDomain['hr'] || 0,
					support: response.unreadBySourceDomain['support'] || 0,
					finance: response.unreadBySourceDomain['finance'] || 0,
					system: response.unreadBySourceDomain['system'] || 0,
				},
				lastUpdated: new Date(),
			});
		} catch (err) {
			console.error('[useNotifications] Failed to refresh unread count:', err);
		}
	}, []);

	// Add real-time notification from SSE
	const addRealtimeNotification = useCallback((notification: Notification) => {
		setNotifications((prev) => {
			// Deduplicate: check if notification already exists
			const exists = prev.some(
				(n) => n.notificationRecipientId === notification.notificationRecipientId
			);

			if (exists) {
				console.warn('[useNotifications] Duplicate notification received, skipping:', notification.notificationRecipientId);
				return prev;
			}

			return [notification, ...prev];
		});

		// Update unread count if notification is unread
		if (notification.acknowledgementStatus === 'pending') {
			setUnreadCount((prev) => ({
				...prev,
				total: prev.total + 1,
				bySourceDomain: {
					...prev.bySourceDomain,
					[notification.sourceDomain]: prev.bySourceDomain[notification.sourceDomain] + 1,
				},
			}));
		}
	}, []);

	// Apply client-side filters
	const filteredNotifications = useMemo(() => {
		return notifications.filter((notification) => {
			// Filter by read status (unread = acknowledgementStatus is 'pending')
			if (filters.showUnreadOnly && notification.acknowledgementStatus !== 'pending') {
				return false;
			}

			// Filter by source domain
			if (
				filters.selectedSourceDomains.length > 0 &&
				!filters.selectedSourceDomains.includes(notification.sourceDomain)
			) {
				return false;
			}

			return true;
		});
	}, [notifications, filters]);

	return {
		notifications,
		filteredNotifications,
		unreadCount,
		filters,
		loading: pagination.loadingState === 'loading',
		hasMore: pagination.hasNextPage,
		loadMore,
		markAsRead,
		markAllAsRead,
		deleteNotification,
		setFilters,
		refreshUnreadCount,
		addRealtimeNotification,
	};
}
