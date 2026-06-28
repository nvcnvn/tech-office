/**
 * Typing Indicator Component
 * Shows who is currently typing in the channel/thread
 * 
 * Features:
 * - Display "Alice and Bob are typing..."
 * - Smart throttling: "3 people are typing..." for crowded channels (3+ typers)
 * - Auto-clear after 5s of inactivity (handled by parent)
 * - Receives typing state from SSE events via parent
 * - Ephemeral state (no persistence)
 * - Supports both channel and thread typing indicators
 */

'use client';

import React from 'react';
import { Typography } from '@mui/material';
import { useThemeColors } from '@/theme/useThemeColors';

interface TypingIndicatorProps {
	channelId?: string;
	parentMessageId?: string; // For thread typing indicators
	typingUsers: Array<{ userId: string; userName: string; expiresAt: Date }>;
}

export default function TypingIndicator({ channelId, parentMessageId, typingUsers }: TypingIndicatorProps) {
	const colors = useThemeColors();

	console.log('[TypingIndicator] Rendered:', {
		channelId,
		parentMessageId,
		typingCount: typingUsers.length,
		typingUsers,
	});

	if (typingUsers.length === 0) {
		return null;
	}

	const names = typingUsers.map((u) => u.userName);

	// Smart throttling: Aggregate display for 3+ users to reduce noise
	const displayText =
		names.length === 1
			? `${names[0]} is typing...`
			: names.length === 2
				? `${names[0]} and ${names[1]} are typing...`
				: `${names.length} people are typing...`; // Throttled display for crowded channels

	return (
		<Typography variant="caption" className={`${colors.text.hint.className} italic`}>
			{displayText}
		</Typography>
	);
}
