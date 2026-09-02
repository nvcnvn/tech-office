/**
 * TaskOriginBlock — where a task came from, when it was created from a chat message.
 *
 * Feature: 038-chat-task-quick-action
 *
 * Shown only for tasks that carry an origin, and fetched separately from the task itself
 * so the ordinary task read stays a single-domain query. A soft-deleted source message
 * does not remove the block: the task still knows which conversation it came from, and
 * only the excerpt is replaced by a note that the message is gone (FR-023).
 */

'use client';

import React, { useEffect, useState } from 'react';
import NextLink from 'next/link';
import { Box, Typography } from '@mui/material';
import { getTaskOrigin, type TaskOrigin } from 'apis';

interface TaskOriginBlockProps {
	taskId: string;
	/** Present only on tasks created from a message; absent means nothing to show. */
	sourceMessageId?: string;
}

export default function TaskOriginBlock({ taskId, sourceMessageId }: TaskOriginBlockProps) {
	const [origin, setOrigin] = useState<TaskOrigin | null>(null);

	useEffect(() => {
		if (!sourceMessageId) {
			setOrigin(null);
			return;
		}
		let cancelled = false;
		getTaskOrigin(taskId)
			.then((resp) => {
				if (!cancelled) setOrigin(resp.hasOrigin ? resp : null);
			})
			.catch(() => {
				// An origin we cannot resolve is simply not shown; the task itself is fine.
				if (!cancelled) setOrigin(null);
			});
		return () => {
			cancelled = true;
		};
	}, [taskId, sourceMessageId]);

	if (!origin) return null;

	// The canonical anchored link, so opening it lands on the exact message rather than
	// the bottom of the conversation.
	const conversationHref =
		`/workspace/chat?channel=${encodeURIComponent(origin.sourceChannelId)}` +
		`&anchorType=message&anchorId=${encodeURIComponent(origin.sourceMessageId)}`;

	return (
		<Box
			sx={{ mb: 3, p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}
			data-testid="task-origin-block"
		>
			<Typography variant="overline" color="text.secondary">
				From a conversation
			</Typography>

			<Typography variant="body2" sx={{ mt: 0.5 }} data-testid="task-origin-channel">
				{origin.channelDisplayName || 'a conversation'}
				{origin.authorDisplayName ? ` · ${origin.authorDisplayName}` : null}
			</Typography>

			{origin.sourceMessageAvailable ? (
				<Typography
					variant="body2"
					component="div"
					sx={{
						mt: 1,
						pl: 1.5,
						borderLeft: 3,
						borderColor: 'divider',
						color: 'text.secondary',
						wordBreak: 'break-word',
					}}
					data-testid="task-origin-excerpt"
					// The excerpt is the message body as chat stored it — already sanitized
					// server-side, and rendered the same way the conversation renders it.
					dangerouslySetInnerHTML={{ __html: origin.excerptHtml }}
				/>
			) : (
				<Typography
					variant="body2"
					sx={{ mt: 1, fontStyle: 'italic', color: 'text.secondary' }}
					data-testid="task-origin-message-unavailable"
				>
					The original message has been deleted.
				</Typography>
			)}

			<Box
				component={NextLink}
				href={conversationHref}
				sx={{ display: 'inline-block', mt: 1.5, color: 'primary.main', textDecoration: 'underline' }}
				data-testid="task-origin-link"
			>
				Open the conversation
			</Box>
		</Box>
	);
}
