/**
 * Notification Permission Prompt Component
 * Friendly modal to request push notification permissions
 * Constitution v5.4.0 compliant - includes data-testid for accessibility testing
 */

'use client';

import React, { useState, useEffect } from 'react';
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Button,
	Typography,
	Box,
	IconButton,
} from '@mui/material';
import { Close as CloseIcon, Notifications as NotificationsIcon } from '@mui/icons-material';

interface NotificationPermissionPromptProps {
	/** Whether to show the prompt */
	open: boolean;
	/** Callback when user closes the prompt */
	onClose: () => void;
	/** Callback when user enables notifications */
	onEnable: () => void;
	/** Whether permission request is in progress */
	isRequesting?: boolean;
}

/**
 * Friendly notification permission prompt modal
 * 
 * Features:
 * - Clear explanation of notification benefits
 * - Non-intrusive design
 * - Remembers user's dismissal choice
 * - Accessible with data-testid attributes
 */
export default function NotificationPermissionPrompt({
	open,
	onClose,
	onEnable,
	isRequesting = false,
}: NotificationPermissionPromptProps) {
	const [showAgain, setShowAgain] = useState(true);

	// Check if user has dismissed this permanently
	useEffect(() => {
		const dismissed = localStorage.getItem('notification-prompt-dismissed');
		if (dismissed === 'true') {
			setShowAgain(false);
		}
	}, []);

	const handleDismiss = () => {
		// Remember dismissal for 7 days
		const dismissUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
		localStorage.setItem('notification-prompt-dismissed', 'true');
		localStorage.setItem('notification-prompt-dismiss-until', String(dismissUntil));
		onClose();
	};

	const handleEnable = async () => {
		await onEnable();
		// Clear dismissal if user enables
		localStorage.removeItem('notification-prompt-dismissed');
		localStorage.removeItem('notification-prompt-dismiss-until');
	};

	// Don't show if user has dismissed
	if (!showAgain) {
		return null;
	}

	return (
		<Dialog
			open={open}
			onClose={handleDismiss}
			maxWidth="sm"
			fullWidth
			data-testid="notification-permission-prompt"
		>
			<DialogTitle>
				<Box display="flex" alignItems="center" justifyContent="space-between">
					<Box display="flex" alignItems="center" gap={1}>
						<NotificationsIcon color="primary" />
						<Typography variant="h6">Stay Connected</Typography>
					</Box>
					<IconButton
						size="small"
						onClick={handleDismiss}
						data-testid="notification-prompt-close-btn"
					>
						<CloseIcon />
					</IconButton>
				</Box>
			</DialogTitle>

			<DialogContent>
				<Typography variant="body1" gutterBottom>
					Enable notifications to receive instant updates about:
				</Typography>

				<Box component="ul" sx={{ pl: 3, mt: 2, mb: 2 }}>
					<Typography component="li" variant="body2" gutterBottom>
						💬 New messages and mentions in chat channels
					</Typography>
					<Typography component="li" variant="body2" gutterBottom>
						📋 Project updates and task assignments
					</Typography>
					<Typography component="li" variant="body2" gutterBottom>
						👥 Team activity and collaboration requests
					</Typography>
					<Typography component="li" variant="body2" gutterBottom>
						🔔 Important system notifications
					</Typography>
				</Box>

				<Typography variant="body2" color="text.secondary">
					You can change notification preferences anytime in settings.
				</Typography>
			</DialogContent>

			<DialogActions sx={{ px: 3, pb: 2 }}>
				<Button
					onClick={handleDismiss}
					color="inherit"
					data-testid="notification-prompt-dismiss-btn"
				>
					Maybe Later
				</Button>
				<Button
					onClick={handleEnable}
					variant="contained"
					disabled={isRequesting}
					data-testid="notification-prompt-enable-btn"
				>
					{isRequesting ? 'Enabling...' : 'Enable Notifications'}
				</Button>
			</DialogActions>
		</Dialog>
	);
}

/**
 * Hook to manage notification prompt visibility
 * 
 * Features:
 * - Auto-show after delay
 * - Respects dismissal preferences
 * - Checks permission state
 */
export function useNotificationPrompt() {
	const [showPrompt, setShowPrompt] = useState(false);

	useEffect(() => {
		// Check if we should show the prompt
		const checkShouldShow = () => {
			// Don't show if notifications not supported
			if (typeof window === 'undefined' || !('Notification' in window)) {
				return false;
			}

			// Don't show if already granted or denied
			if (Notification.permission !== 'default') {
				return false;
			}

			// Check if dismissed
			const dismissed = localStorage.getItem('notification-prompt-dismissed');
			const dismissUntil = localStorage.getItem('notification-prompt-dismiss-until');

			if (dismissed === 'true' && dismissUntil) {
				const dismissTime = Number(dismissUntil);
				if (Date.now() < dismissTime) {
					return false;
				}
				// Dismissal expired, clear it
				localStorage.removeItem('notification-prompt-dismissed');
				localStorage.removeItem('notification-prompt-dismiss-until');
			}

			return true;
		};

		// Show prompt after 10 seconds if conditions met
		const timer = setTimeout(() => {
			if (checkShouldShow()) {
				setShowPrompt(true);
			}
		}, 10000);

		return () => clearTimeout(timer);
	}, []);

	return {
		showPrompt,
		setShowPrompt,
	};
}
