/**
 * NotificationPopup Component
 * In-app notification toast with routing awareness and sound notifications
 * Constitution v5.4.0 compliant - includes data-testid
 * 
 * Features:
 * - Plays different sounds for channel vs. direct messages
 * - Compact UI (320px width)
 * - Routing awareness (suppresses when viewing related content)
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
	Snackbar,
	Alert,
	AlertTitle,
	IconButton,
	Box,
	Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { stripAndTruncate } from 'apis';
import { type NotificationPopup as NotificationPopupData } from '../hooks/useNotificationPopup';
import { playNotificationSound as playSharedNotificationSound } from '../lib/notificationSound';

/**
 * NotificationPopup component props
 */
export interface NotificationPopupProps {
	/** Duration to show popup (ms) */
	duration?: number;
	/** Callback when popup is clicked */
	onClick?: (notification: NotificationPopupData) => void;
	/** Callback when popup is dismissed */
	onDismiss?: (notification: NotificationPopupData) => void;
	/** Enable sound playback (default: true) */
	enableSound?: boolean;
}

/**
 * Check if notification is from a direct message channel
 */
function isDirectMessage(notification: NotificationPopupData): boolean {
	// Check if title contains DM indicator patterns
	if (notification.title.includes('direct messaged you')) {
		return true;
	}

	// Fallback: Check notification type
	if (notification.type === 'direct_message') {
		return true;
	}

	return false;
}

/**
 * Play notification sound based on notification type
 */
function playNotificationSound(isDM: boolean): void {
	void playSharedNotificationSound(isDM ? 'dm' : 'message');
}

/**
 * In-app notification popup component
 * 
 * Listens for 'notification-popup-show' and 'notification-popup-dismiss' events
 * and displays notifications as Material-UI Snackbar with Alert
 * 
 * Usage:
 * ```tsx
 * <NotificationPopup
 *   duration={5000}
 *   onClick={(notif) => router.push(`/workspace/chat?channel=${notif.channelId}`)}
 *   enableSound={true}
 * />
 * ```
 */
export default function NotificationPopup({
	duration = 5000,
	onClick,
	onDismiss,
	enableSound = true,
}: NotificationPopupProps) {
	const [notification, setNotification] = useState<NotificationPopupData | null>(null);
	const [open, setOpen] = useState(false);
	const soundPlayedRef = useRef(false);

	// Listen for show events
	useEffect(() => {
		const handleShow = (event: Event) => {
			const customEvent = event as CustomEvent<NotificationPopupData>;
			const notif = customEvent.detail;

			if (!notif) {
				console.warn('[NotificationPopup] Received show event without data');
				return;
			}

			console.log('[NotificationPopup] Showing notification:', notif.notificationId);
			setNotification(notif);
			setOpen(true);
			soundPlayedRef.current = false; // Reset sound flag for new notification
		};

		window.addEventListener('notification-popup-show', handleShow);

		return () => {
			window.removeEventListener('notification-popup-show', handleShow);
		};
	}, []);

	// Play sound when notification is shown
	useEffect(() => {
		if (open && notification && enableSound && !soundPlayedRef.current) {
			const isDM = isDirectMessage(notification);
			playNotificationSound(isDM);
			soundPlayedRef.current = true;
		}
	}, [open, notification, enableSound]);

	// Listen for dismiss events
	useEffect(() => {
		const handleDismiss = (event: Event) => {
			const customEvent = event as CustomEvent<NotificationPopupData>;
			const notif = customEvent.detail;

			if (!notif || notif.notificationId !== notification?.notificationId) {
				return;
			}

			console.log('[NotificationPopup] Dismissing notification:', notif.notificationId);
			setOpen(false);
		};

		window.addEventListener('notification-popup-dismiss', handleDismiss);

		return () => {
			window.removeEventListener('notification-popup-dismiss', handleDismiss);
		};
	}, [notification]);

	// Handle close
	const handleClose = (_event?: React.SyntheticEvent | Event, reason?: string) => {
		// Don't close on clickaway
		if (reason === 'clickaway') {
			return;
		}

		setOpen(false);
		if (notification) {
			onDismiss?.(notification);
		}
	};

	// Handle click
	const handleClick = () => {
		if (notification) {
			onClick?.(notification);
			setOpen(false);
		}
	};

	// Get severity based on notification type
	const getSeverity = (type: string): 'info' | 'success' | 'warning' | 'error' => {
		switch (type) {
			case 'mention':
				return 'warning';
			case 'reply':
				return 'info';
			case 'reaction':
				return 'success';
			default:
				return 'info';
		}
	};

	if (!notification) {
		return null;
	}

	return (
		<Snackbar
			open={open}
			autoHideDuration={duration}
			onClose={handleClose}
			anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
			sx={{ mt: 8 }}
			data-testid="notification-popup"
		>
			<Alert
				severity={getSeverity(notification.type)}
				onClose={handleClose}
				sx={{
					width: '320px', // Reduced from 400px for compact display
					cursor: onClick ? 'pointer' : 'default',
					'&:hover': onClick ? {
						backgroundColor: 'action.hover',
					} : {},
				}}
				onClick={onClick ? handleClick : undefined}
				action={
					<IconButton
						size="small"
						aria-label="close"
						color="inherit"
						onClick={(e) => {
							e.stopPropagation();
							handleClose();
						}}
						data-testid="notification-popup-close-btn"
					>
						<CloseIcon fontSize="small" />
					</IconButton>
				}
			>
				<AlertTitle sx={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
					{notification.title}
				</AlertTitle>
				<Box>
					<Typography variant="body2" sx={{ mb: 0.5, fontSize: '0.8rem' }}>
						{stripAndTruncate(notification.message, 60)}
					</Typography>
					<Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
						{formatTimestamp(notification.timestamp)}
					</Typography>
				</Box>
			</Alert>
		</Snackbar>
	);
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: Date): string {
	const now = new Date();
	const diffMs = now.getTime() - timestamp.getTime();
	const diffMins = Math.floor(diffMs / (1000 * 60));

	if (diffMins < 1) {
		return 'Just now';
	}
	if (diffMins < 60) {
		return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
	}

	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) {
		return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
	}

	// Show full date/time for older notifications
	return timestamp.toLocaleString(undefined, {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
	});
}
