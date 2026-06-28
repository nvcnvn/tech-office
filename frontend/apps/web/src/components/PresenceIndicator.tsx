/**
 * Presence Indicator Component
 * Shows employee online/idle/offline status with real-time updates
 * Constitution v5.4.0 compliant - includes data-testid for accessibility testing
 */

'use client';

import React, { useEffect, useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { getEmployeePresence, type PresenceStatus } from 'apis';

interface PresenceIndicatorProps {
	/** Employee ID to show presence for */
	employeeId: string;
	/** Size variant */
	size?: 'small' | 'medium' | 'large';
	/** Whether to show tooltip with details */
	showTooltip?: boolean;
	/** Custom className */
	className?: string;
}

/**
 * Get status badge color
 */
function getStatusColor(status: PresenceStatus): string {
	switch (status) {
		case 'online':
			return '#10b981'; // green-500
		case 'idle':
			return '#f59e0b'; // amber-500
		case 'offline':
		case 'unspecified':
			return '#9ca3af'; // gray-400
		case 'online_hidden':
			return 'transparent'; // Hidden - no badge
		default:
			return '#9ca3af';
	}
}

/**
 * Get status label for tooltip
 */
function getStatusLabel(status: PresenceStatus): string {
	switch (status) {
		case 'online':
			return 'Online';
		case 'idle':
			return 'Idle';
		case 'offline':
			return 'Offline';
		case 'online_hidden':
			return 'Offline'; // Show as offline when hidden
		case 'unspecified':
		default:
			return 'Unknown';
	}
}

/**
 * Get size in pixels
 */
function getSize(size: 'small' | 'medium' | 'large'): number {
	switch (size) {
		case 'small':
			return 8;
		case 'medium':
			return 10;
		case 'large':
			return 12;
	}
}

/**
 * Presence indicator badge for employee avatars
 * 
 * Features:
 * - Color-coded status (green=online, yellow=idle, gray=offline)
 * - Real-time updates via SSE
 * - Respects visibility settings (hidden users show no badge)
 * - Tooltip with status details
 * - Multiple size variants
 */
export default function PresenceIndicator({
	employeeId,
	size = 'medium',
	showTooltip = true,
	className = '',
}: PresenceIndicatorProps) {
	const [status, setStatus] = useState<PresenceStatus>('unspecified');
	const [lastSeen, setLastSeen] = useState<Date | null>(null);
	const [customStatus, setCustomStatus] = useState<string | undefined>();

	// Fetch initial presence
	useEffect(() => {
		let mounted = true;

		getEmployeePresence(employeeId)
			.then(presence => {
				if (!mounted) return;
				if (presence) {
					setStatus(presence.status);
					setLastSeen(presence.lastInteractionAt);
					setCustomStatus(presence.visibility?.customStatus);
				}
			})
			.catch(err => {
				console.error('[PresenceIndicator] Failed to fetch presence:', err);
			});

		return () => {
			mounted = false;
		};
	}, [employeeId]);

	// Listen for real-time presence updates via SSE
	useEffect(() => {
		const handlePresenceUpdate = (event: CustomEvent) => {
			const { employeeId: updatedId, status: newStatus, lastInteractionAt, visibility } = event.detail;

			if (updatedId === employeeId) {
				setStatus(newStatus);
				setLastSeen(new Date(lastInteractionAt));
				setCustomStatus(visibility?.customStatus);
			}
		};

		window.addEventListener('presence-update', handlePresenceUpdate as EventListener);

		return () => {
			window.removeEventListener('presence-update', handlePresenceUpdate as EventListener);
		};
	}, [employeeId]);

	// Don't show badge for hidden users
	if (status === 'online_hidden') {
		return null;
	}

	const badgeSize = getSize(size);
	const statusColor = getStatusColor(status);
	const statusLabel = getStatusLabel(status);

	const badge = (
		<Box
			className={className}
			data-testid={`presence-indicator-${employeeId}`}
			sx={{
				width: badgeSize,
				height: badgeSize,
				borderRadius: '50%',
				backgroundColor: statusColor,
				border: '2px solid white',
				boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.1)',
				transition: 'background-color 0.3s ease',
			}}
		/>
	);

	if (!showTooltip) {
		return badge;
	}

	// Build tooltip content
	let tooltipContent = statusLabel;
	if (customStatus) {
		tooltipContent = `${customStatus} (${statusLabel})`;
	} else if (status === 'offline' && lastSeen) {
		const now = new Date();
		const diffMinutes = Math.floor((now.getTime() - lastSeen.getTime()) / (1000 * 60));

		if (diffMinutes < 1) {
			tooltipContent = 'Active just now';
		} else if (diffMinutes < 60) {
			tooltipContent = `Active ${diffMinutes}m ago`;
		} else if (diffMinutes < 1440) {
			const hours = Math.floor(diffMinutes / 60);
			tooltipContent = `Active ${hours}h ago`;
		} else {
			const days = Math.floor(diffMinutes / 1440);
			tooltipContent = `Active ${days}d ago`;
		}
	}

	return (
		<Tooltip title={tooltipContent} arrow placement="top">
			{badge}
		</Tooltip>
	);
}
