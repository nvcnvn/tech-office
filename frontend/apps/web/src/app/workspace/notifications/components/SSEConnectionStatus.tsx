/**
 * SSEConnectionStatus Component
 * Real-time connection status indicator
 */

'use client';

import React from 'react';
import type { ConnectionStatus } from '@tech-office/notifications';
import { useThemeColors } from '@/theme/useThemeColors';

interface SSEConnectionStatusProps {
	status: ConnectionStatus;
	error?: Error | null;
	onReconnect?: () => void;
}

export default function SSEConnectionStatus({
	status,
	error,
	onReconnect,
}: SSEConnectionStatusProps) {
	const colors = useThemeColors();

	const getStatusDisplay = () => {
		switch (status) {
			case 'connected':
				return {
					color: 'text-green-600',
					bgColor: 'bg-green-100',
					dot: '●',
					text: 'Live',
				};
			case 'connecting':
				return {
					color: 'text-yellow-600',
					bgColor: 'bg-yellow-100',
					dot: '●',
					text: 'Connecting...',
				};
			case 'disconnected':
				return {
					color: colors.text.secondary.className,
					bgColor: colors.bg.hover,
					dot: '○',
					text: 'Disconnected',
				};
			case 'error':
				return {
					color: 'text-red-600',
					bgColor: 'bg-red-100',
					dot: '●',
					text: 'Error',
				};
			default:
				return {
					color: colors.text.secondary.className,
					bgColor: colors.bg.hover,
					dot: '○',
					text: 'Unknown',
				};
		}
	};

	const statusDisplay = getStatusDisplay();

	return (
		<div className="flex items-center gap-2">
			<div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${statusDisplay.bgColor}`}>
				<span className={statusDisplay.color}>{statusDisplay.dot}</span>
				<span className={statusDisplay.color}>{statusDisplay.text}</span>
			</div>

			{/* Show reconnect button for disconnected or error state */}
			{(status === 'disconnected' || status === 'error') && onReconnect && (
				<button
					onClick={onReconnect}
					className={`px-2 py-1 text-xs font-medium ${colors.primary.text.className} ${colors.primary.hover} rounded`}
				>
					Reconnect
				</button>
			)}

			{/* Show error message if present */}
			{error && status === 'error' && (
				<span className="text-xs text-red-600" title={error.message}>
					{error.message.substring(0, 50)}
				</span>
			)}
		</div>
	);
}
