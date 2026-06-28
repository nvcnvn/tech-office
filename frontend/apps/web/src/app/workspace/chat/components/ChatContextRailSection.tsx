'use client';

import { Box, Typography, Avatar, CircularProgress, Alert } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { getChannelContextSummary } from 'apis';
import { chat } from 'rpc';

import { ContextRailEmptyState } from '../../components/context-rail/ContextRailEmptyState';
import { ContextRailSection } from '../../components/context-rail/ContextRailSection';

export interface ChatContextRailSectionProps {
	channelId: string;
	isDirectMessage: boolean;
}

export function ChatContextRailSection({
	channelId,
	isDirectMessage,
}: ChatContextRailSectionProps) {
	const summaryQuery = useQuery({
		queryKey: ['chat', 'channelContextSummary', channelId],
		queryFn: () => getChannelContextSummary(channelId),
		enabled: !!channelId,
	});

	if (summaryQuery.isLoading) {
		return (
			<Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
				<CircularProgress size={24} />
			</Box>
		);
	}

	if (summaryQuery.isError) {
		return (
			<Box sx={{ p: 2 }}>
				<Alert severity="error">
					Unable to load channel details right now.
				</Alert>
			</Box>
		);
	}

	const data = summaryQuery.data;

	if (!data) {
		return null;
	}

	if (isDirectMessage && data.dmCounterpart) {
		return (
			<ContextRailSection
				title="Direct Message"
				description="Counterpart Profile"
				testId="workspace-context-rail-chat-dm-profile"
			>
				<Box sx={{ display: 'grid', gap: 1.5, alignItems: 'center', justifyItems: 'center', py: 2 }}>
					<Avatar src={data.dmCounterpart.avatarUrl} sx={{ width: 64, height: 64 }}>
						{data.dmCounterpart.displayName.charAt(0).toUpperCase()}
					</Avatar>
					<Box sx={{ textAlign: 'center' }}>
						<Typography variant="subtitle1" fontWeight={600}>
							{data.dmCounterpart.displayName}
						</Typography>
						<Typography variant="body2" color="text.secondary">
							{data.dmCounterpart.email}
						</Typography>
					</Box>
				</Box>
			</ContextRailSection>
		);
	}

	return (
		<>
			<ContextRailSection
				title="Members"
				description={`${data.memberCount} people`}
				testId="workspace-context-rail-chat-members"
			>
				{data.members.length > 0 ? (
					<Box sx={{ display: 'grid', gap: 1.5 }}>
						{data.members.slice(0, 10).map((member: chat.ChannelMemberSummary) => (
							<Box key={member.employeeId} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
								<Avatar src={member.avatarUrl} sx={{ width: 32, height: 32 }}>
									{member.displayName.charAt(0).toUpperCase()}
								</Avatar>
								<Box sx={{ minWidth: 0, flex: 1 }}>
									<Typography variant="body2" fontWeight={600} noWrap>
										{member.displayName}
									</Typography>
									<Typography variant="caption" color="text.secondary" noWrap>
										{member.roleLabel}
									</Typography>
								</Box>
							</Box>
						))}
						{data.memberCount > 10 && (
							<Typography variant="caption" color="text.secondary" sx={{ pt: 1 }}>
								And {data.memberCount - 10} more...
							</Typography>
						)}
					</Box>
				) : (
					<ContextRailEmptyState message="No members found." />
				)}
			</ContextRailSection>

			<ContextRailSection
				title="Pinned Messages"
				testId="workspace-context-rail-chat-pinned"
			>
				{data.pinnedMessages.length > 0 ? (
					<Box sx={{ display: 'grid', gap: 1.5 }}>
						{data.pinnedMessages.map((msg: chat.PinnedMessageSummary) => (
							<Box key={msg.messageId} sx={{ display: 'grid', gap: 0.5 }}>
								<Typography variant="caption" fontWeight={600} color="text.primary">
									{msg.authorName}
								</Typography>
								<Typography variant="body2" color="text.secondary" sx={{
									display: '-webkit-box',
									WebkitLineClamp: 2,
									WebkitBoxOrient: 'vertical',
									overflow: 'hidden'
								}}>
									{msg.excerpt}
								</Typography>
							</Box>
						))}
					</Box>
				) : (
					<ContextRailEmptyState message="No pinned messages yet." />
				)}
			</ContextRailSection>
		</>
	);
}
