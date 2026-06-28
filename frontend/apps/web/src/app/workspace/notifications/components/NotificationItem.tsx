/**
 * NotificationItem Component
 * Individual notification card with actions
 */

'use client';

import React, { useState } from 'react';
import type { Notification } from '@tech-office/notifications';
import { formatRelativeTime, getDomainIcon, getDomainLabel, getDomainColor, getNotificationTypeIcon, getNotificationTypeLabel, truncateContent, stripHtml } from '@tech-office/notifications';
import { useThemeColors } from '@/theme/useThemeColors';
import { Typography } from '@mui/material';

interface NotificationItemProps {
	notification: Notification;
	/** Called when the user explicitly marks the notification as read (explicit_ack). */
	onMarkAsRead: (notificationRecipientId: string) => void;
	/** Called when the user clicks the notification body to navigate to the destination (destination_open). */
	onAcknowledge?: (notificationRecipientId: string, action: 'destination_open' | 'explicit_ack') => Promise<void> | void;
	onOpen?: (notification: Notification) => void;
	onDelete: (notificationRecipientId: string) => void;
	compact?: boolean;
}

export default function NotificationItem({
	notification,
	onMarkAsRead,
	onAcknowledge,
	onOpen,
	onDelete,
	compact = false,
}: NotificationItemProps) {
	const colors = useThemeColors();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	// Unread = acknowledgementStatus is 'pending' (not yet acknowledged)
	const isPending = notification.acknowledgementStatus === 'pending';

	const handleBodyClick = () => {
		// Clicking the notification body = destination open (not just popup display)
		if (onAcknowledge) {
			void onAcknowledge(notification.notificationRecipientId, 'destination_open');
		} else if (isPending) {
			onMarkAsRead(notification.notificationRecipientId);
		}

		onOpen?.(notification);
	};

	const handleMarkAsReadToggle = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isPending) {
			if (onAcknowledge) {
				onAcknowledge(notification.notificationRecipientId, 'explicit_ack');
			} else {
				onMarkAsRead(notification.notificationRecipientId);
			}
		}
	};

	const handleDelete = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (showDeleteConfirm) {
			onDelete(notification.notificationRecipientId);
			setShowDeleteConfirm(false);
		} else {
			setShowDeleteConfirm(true);
			setTimeout(() => setShowDeleteConfirm(false), 3000);
		}
	};

	const domainColor = getDomainColor(notification.sourceDomain);
	const domainIcon = getDomainIcon(notification.sourceDomain);
	const domainLabel = getDomainLabel(notification.sourceDomain);

	return (
		<div
			data-testid={`notification-item-${notification.notificationRecipientId}`}
			className={`
				relative rounded-lg border transition-colors
				${isPending ? 'border-l-4' : 'border-l-4 border-l-transparent'}
				${compact ? 'p-3 h-16' : 'p-4 h-20'}
				${colors.bg.hover} cursor-pointer
			`}
			style={{
				...colors.bg.paper.style,
				...colors.border.default.style,
				...(isPending && {
					borderLeftColor: colors.primary.main.style.backgroundColor,
					backgroundColor: colors.primary.light.style.backgroundColor,
				}),
			}}
			onClick={handleBodyClick}
		>
			<div className="flex items-start gap-3 h-full">
				{/* Icon */}
				<div className="shrink-0 mt-0.5">
					<span className="text-2xl">{domainIcon}</span>
				</div>

				{/* Content */}
				<div className="flex-1 min-w-0">
					<div className="flex items-start justify-between gap-2 mb-1">
						<Typography
							variant="body2"
							fontWeight={isPending ? 'semibold' : 'medium'}
							noWrap
						>
							{notification.title}
						</Typography>
						<Typography variant="caption" color="text.secondary" className="shrink-0">
							{formatRelativeTime(notification.createdAt)}
						</Typography>
					</div>

					<Typography variant="body2" color="text.secondary" className="line-clamp-2 mb-1">
						{compact ? truncateContent(notification.message, 80) : stripHtml(notification.message)}
					</Typography>

					<div className="flex items-center gap-2">
						<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${domainColor}`}>
							{domainIcon} {domainLabel}
						</span>
						<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-gray-50 text-gray-600 border-gray-200">
							{getNotificationTypeIcon(notification.notificationType)} {getNotificationTypeLabel(notification.notificationType)}
						</span>
					</div>
				</div>

				{/* Actions */}
				<div className="shrink-0 flex items-center gap-1">
					{/* Mark as read toggle */}
					<button
						onClick={handleMarkAsReadToggle}
						className="p-1.5 rounded"
						style={colors.bg.active.style}
						title={isPending ? 'Mark as read' : 'Already acknowledged'}
					>
						<span style={isPending ? colors.primary.text.style : colors.text.disabled.style}>
							{isPending ? '●' : '○'}
						</span>
					</button>

					{/* Delete button */}
					<button
						onClick={handleDelete}
						className={`p-1.5 rounded ${showDeleteConfirm ? colors.status.error.bg : ''}`}
						title={showDeleteConfirm ? 'Click again to confirm' : 'Delete notification'}
					>
						<span className={showDeleteConfirm ? colors.status.error.text : ''} style={!showDeleteConfirm ? colors.text.disabled.style : undefined}>
							{showDeleteConfirm ? '✓' : '✕'}
						</span>
					</button>
				</div>
			</div>
		</div>
	);
}
