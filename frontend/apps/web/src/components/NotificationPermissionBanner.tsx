/**
 * Notification Permission Banner Component
 * Subtle warning bar to request push notification permissions
 * Constitution v5.4.0 compliant - includes data-testid for accessibility testing
 * 
 * Features:
 * - Multi-state notification detection (granted/denied/default/no-service-worker/no-subscription)
 * - Browser AND OS-level permission troubleshooting
 * - Test notification button for OS verification
 * - Detailed setup guide with platform-specific instructions
 * - Smart dismissal (24 hour localStorage tracking)
 * - Auto-refresh on tab visibility change
 */

'use client';

import { useState, useEffect } from 'react';
import { Alert, Button, Collapse, Typography, Box, Link } from '@mui/material';
import {
	checkNotificationStatus,
	showTestNotification,
	getNotificationStatusMessage,
	type NotificationStatus,
} from 'apis';
import { NotificationSetupGuide } from './NotificationSetupGuide';

interface NotificationPermissionBannerProps {
	onEnable?: () => Promise<void>;
	isRequesting?: boolean;
	needsSoundActivation?: boolean;
}

export function NotificationPermissionBanner({
	onEnable,
	isRequesting = false,
	needsSoundActivation = false,
}: NotificationPermissionBannerProps) {
	const [status, setStatus] = useState<NotificationStatus | null>(null);
	const [dismissed, setDismissed] = useState(false);
	const [showGuide, setShowGuide] = useState(false);
	const [showOsHint, setShowOsHint] = useState(false);
	const dismissalStorageKey = needsSoundActivation
		? 'notification-sound-banner-dismissed'
		: 'notification-banner-dismissed';

	useEffect(() => {
		// Check if user has already dismissed
		const dismissedUntil = localStorage.getItem(dismissalStorageKey);
		if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
			setDismissed(true);
		} else {
			setDismissed(false);
		}

		// Initial check after 2 seconds
		const timer = setTimeout(async () => {
			const currentStatus = await checkNotificationStatus();
			setStatus(currentStatus);
		}, 2000);

		// Re-check when tab becomes visible (user may have changed settings)
		const handleVisibilityChange = () => {
			if (!document.hidden) {
				checkNotificationStatus().then(setStatus);
			}
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			clearTimeout(timer);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, [dismissalStorageKey]);

	const showSoundActivationBanner = needsSoundActivation && status === 'granted';

	const handleEnable = async () => {
		if (status === 'denied' && !showSoundActivationBanner) {
			// Show setup guide for denied permissions
			setShowGuide(true);
			return;
		}

		if (status === 'no-service-worker') {
			// Refresh page to re-register service worker
			window.location.reload();
			return;
		}

		try {
			if (onEnable) {
				await onEnable();
			} else {
				await Notification.requestPermission();
			}

			const permission = typeof Notification === 'undefined'
				? 'default'
				: Notification.permission;
			if (permission === 'granted') {
				// Permission granted - registration will be handled by usePushPermission hook
				// which monitors permission changes and automatically registers tokens
				setStatus('granted');
			} else if (permission === 'denied') {
				setStatus('denied');
				setShowGuide(true);
			}
		} catch (error) {
			console.error('Failed to enable notifications:', error);
			setShowOsHint(true);
		}
	};

	const handleTestNotification = async () => {
		const shown = await showTestNotification();
		if (shown) {
			// Ask user if they saw it after 5 seconds
			setTimeout(() => {
				const userSawIt = confirm('Did you see the test notification?\n\nClick OK if you saw it, Cancel if not.');
				if (!userSawIt) {
					setShowGuide(true);
				}
			}, 5000);
		} else {
			setShowGuide(true);
		}
	};

	const handleDismiss = () => {
		// Dismiss for 24 hours
		const dismissUntil = Date.now() + 24 * 60 * 60 * 1000;
		localStorage.setItem(dismissalStorageKey, dismissUntil.toString());
		setDismissed(true);
	};

	// Don't show banner if granted, unsupported, or dismissed
	if (!status || status === 'unsupported' || dismissed || (status === 'granted' && !showSoundActivationBanner)) {
		return null;
	}

	const getSeverity = () => {
		if (status === 'denied' || showOsHint || showSoundActivationBanner) return 'warning';
		return 'info';
	};

	const getActions = () => {
		if (showSoundActivationBanner) {
			return (
				<Box>
					<Button size="small" color="inherit" onClick={handleEnable} disabled={isRequesting}>
						{isRequesting ? 'Enabling...' : 'Enable sound'}
					</Button>
					<Button size="small" color="inherit" onClick={handleDismiss}>
						Not Now
					</Button>
				</Box>
			);
		}

		if (status === 'denied' || showOsHint) {
			return (
				<Box>
					<Button size="small" color="inherit" onClick={handleTestNotification}>
						Test
					</Button>
					<Button size="small" color="inherit" onClick={() => setShowGuide(true)}>
						Help
					</Button>
					<Button size="small" color="inherit" onClick={handleDismiss}>
						Dismiss
					</Button>
				</Box>
			);
		}

		return (
			<Box>
				<Button size="small" color="inherit" onClick={handleEnable} disabled={isRequesting}>
					{isRequesting ? 'Enabling...' : 'Enable'}
				</Button>
				<Button size="small" color="inherit" onClick={handleDismiss}>
					Not Now
				</Button>
			</Box>
		);
	};

	return (
		<>
			<Collapse in={!dismissed}>
				<Alert severity={getSeverity()} action={getActions()} sx={{ mb: 2 }}>
					<Typography variant="body2">
						{showSoundActivationBanner
							? 'Enable notification sounds for this tab. Some browsers require one click before alerts can play audio.'
							: getNotificationStatusMessage(status)}
					</Typography>

					{showOsHint && (
						<Typography variant="caption" sx={{ mt: 1, display: 'block', opacity: 0.9 }}>
							<strong>Troubleshooting:</strong>
							<br />
							1. Check this site&apos;s browser permissions, including notifications and autoplay/sound settings
							<br />
							2. Check System Settings → Notifications for your browser
							<br />
							3.{' '}
							<Link
								component="button"
								variant="caption"
								onClick={() => setShowGuide(true)}
								sx={{ color: 'inherit', textDecoration: 'underline' }}
							>
								Click here for detailed instructions
							</Link>
						</Typography>
					)}
				</Alert>
			</Collapse>

			<NotificationSetupGuide open={showGuide} onClose={() => setShowGuide(false)} />
		</>
	);
}