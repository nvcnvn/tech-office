/**
 * Notification utility functions
 * Helper functions for formatting and displaying notifications
 */

import { formatDistanceToNow } from 'date-fns';
import type { SourceDomain } from './types';
import type { NotificationType } from 'apis';

/**
 * Format a date as relative time (e.g., "2 minutes ago", "3 hours ago")
 */
export function formatRelativeTime(date: Date): string {
	return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Get emoji icon for source domain
 */
export function getDomainIcon(domain: SourceDomain): string {
	const icons: Record<SourceDomain, string> = {
		chat: '💬',
		crm: '🤝',
		projects: '📋',
		hr: '👥',
		support: '🎧',
		finance: '💰',
		system: '⚙️',
	};
	return icons[domain] || '📢';
}

/**
 * Get display label for source domain
 */
export function getDomainLabel(domain: SourceDomain): string {
	const labels: Record<SourceDomain, string> = {
		chat: 'Chat',
		crm: 'CRM',
		projects: 'Projects',
		hr: 'HR',
		support: 'Support',
		finance: 'Finance',
		system: 'System',
	};
	return labels[domain] || domain;
}

/**
 * Get Tailwind color class for source domain
 */
export function getDomainColor(domain: SourceDomain): string {
	const colors: Record<SourceDomain, string> = {
		chat: 'bg-blue-100 text-blue-700 border-blue-200',
		crm: 'bg-green-100 text-green-700 border-green-200',
		projects: 'bg-purple-100 text-purple-700 border-purple-200',
		hr: 'bg-orange-100 text-orange-700 border-orange-200',
		support: 'bg-pink-100 text-pink-700 border-pink-200',
		finance: 'bg-yellow-100 text-yellow-700 border-yellow-200',
		system: 'bg-gray-100 text-gray-700 border-gray-200',
	};
	return colors[domain] || 'bg-gray-100 text-gray-700 border-gray-200';
}

/**
 * Strip HTML tags from a string, returning plain text.
 * Safe for use in both browser and server contexts.
 */
export function stripHtml(html: string): string {
	if (!html) return '';

	// Create a temporary div element to leverage browser's HTML parsing
	if (typeof document !== 'undefined') {
		const tmp = document.createElement('div');
		tmp.innerHTML = html;
		return tmp.textContent || tmp.innerText || '';
	}

	// Fallback for server-side: use regex (less reliable but works)
	return html.replace(/<[^>]*>/g, '');
}

/**
 * Truncate content with ellipsis, also strips HTML tags
 */
export function truncateContent(content: string, maxLength: number): string {
	// Strip HTML tags first
	const plainText = stripHtml(content);

	if (plainText.length <= maxLength) {
		return plainText;
	}
	return plainText.substring(0, maxLength) + '...';
}

/**
 * Map backend NotificationSummary protobuf to frontend Notification
 */
export function mapNotificationFromProto(proto: any): any {
	return {
		notificationId: proto.notificationId,
		notificationRecipientId: proto.notificationRecipientId,
		sourceDomain: proto.sourceDomain,
		notificationType: proto.notificationType,
		title: proto.title,
		message: proto.message,
		actionData: proto.actionData ? JSON.parse(proto.actionData) : null,
		readStatus: proto.readStatus,
		readAt: proto.readAt ? new Date(proto.readAt) : null,
		deliveryStatus: proto.deliveryStatus,
		deliveredAt: proto.deliveredAt ? new Date(proto.deliveredAt) : null,
		createdAt: new Date(proto.createdAt),
	};
}

/**
 * Get emoji icon for V2 notification event type
 */
export function getNotificationTypeIcon(notificationType: string): string {
	const icons: Record<NotificationType, string> = {
		message: '💬',
		mention: '@',
		reply: '↩️',
		typing: '⌨️',
		reaction: '👍',
		voice_call_incoming: '📞',
		voice_call_started: '📞',
		voice_call_updated: '📞',
		voice_call_ended: '📞',
		task_assigned: '👤',
		task_status_changed: '🔄',
		task_commented: '💬',
		task_mentioned: '@',
		task_description_modified: '📝',
		task_updated: '✏️',
		doc_updated: '📄',
		doc_commented: '💬',
		doc_mentioned: '@',
	};
	return icons[notificationType as NotificationType] || '📢';
}

/**
 * Get display label for V2 notification event type
 */
export function getNotificationTypeLabel(notificationType: string): string {
	const labels: Record<NotificationType, string> = {
		message: 'Message',
		mention: 'Mention',
		reply: 'Reply',
		typing: 'Typing',
		reaction: 'Reaction',
		voice_call_incoming: 'Incoming Call',
		voice_call_started: 'Call Started',
		voice_call_updated: 'Call Updated',
		voice_call_ended: 'Call Ended',
		task_assigned: 'Assigned',
		task_status_changed: 'Status changed',
		task_commented: 'Comment',
		task_mentioned: 'Mentioned',
		task_description_modified: 'Description edited',
		task_updated: 'Updated',
		doc_updated: 'Updated',
		doc_commented: 'Comment',
		doc_mentioned: 'Mentioned',
	};
	return labels[notificationType as NotificationType] || notificationType;
}
