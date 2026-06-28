'use client';

import NextLink from 'next/link';
import { Avatar, Box, Chip, Link, Typography } from '@mui/material';
import type { UserProfile } from '@/lib/auth/types';

import { ContextRailEmptyState } from './ContextRailEmptyState';
import { ContextRailSection } from './ContextRailSection';
import { useGlobalContextRailData } from './useGlobalContextRailData';

export interface GlobalContextBlocksProps {
  user: UserProfile;
}

export function GlobalContextBlocks({ user }: GlobalContextBlocksProps) {
  const { identity, nextUp, unreadCount, workSummary, queries } = useGlobalContextRailData(user);

  return (
    <>
      <ContextRailSection title="You" testId="workspace-context-rail-identity">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar alt={identity.displayName} src={identity.avatarUrl} sx={{ width: 40, height: 40 }}>
            {initialsFor(identity.displayName)}
          </Avatar>
          <Box sx={{ minWidth: 0, display: 'grid', gap: 0.5 }}>
            <Typography variant="body2" fontWeight={700} color="text.primary" noWrap>
              {identity.displayName}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {identity.email}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip label={presenceLabel(identity.presence?.status)} size="small" variant="outlined" />
          {queries.presence.isLoading ? (
            <Typography variant="caption" color="text.secondary">
              Checking presence...
            </Typography>
          ) : null}
        </Box>
        {queries.presence.isError ? (
          <Typography variant="caption" color="error.main">
            Presence is unavailable right now.
          </Typography>
        ) : null}
      </ContextRailSection>

      <ContextRailSection title="Next Up" testId="workspace-context-rail-next-up">
        {queries.events.isLoading ? (
          <Typography variant="body2" color="text.secondary">
            Loading schedule...
          </Typography>
        ) : queries.events.isError ? (
          <Typography variant="body2" color="error.main">
            Unable to load upcoming events right now.
          </Typography>
        ) : nextUp.event?.startTime ? (
          <>
            <Typography variant="body2" fontWeight={700} color="text.primary">
              {nextUp.event.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatDateTime(nextUp.event.startTime)}
            </Typography>
            {nextUp.remainingTodayCount > 0 ? (
              <Typography variant="caption" color="text.secondary">
                + {nextUp.remainingTodayCount} more today
              </Typography>
            ) : null}
          </>
        ) : (
          <ContextRailEmptyState message="Nothing scheduled - enjoy the quiet" />
        )}
      </ContextRailSection>

      <ContextRailSection title="My Work Today" testId="workspace-context-rail-work-today">
        {queries.workSummary.isLoading ? (
          <Typography variant="body2" color="text.secondary">
            Loading assigned work...
          </Typography>
        ) : queries.workSummary.isError ? (
          <Typography variant="body2" color="error.main">
            Unable to load assigned work right now.
          </Typography>
        ) : workSummary.items.length > 0 ? (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              <Chip label={`${workSummary.dueTodayCount} due today`} size="small" />
              <Chip
                color={workSummary.overdueCount > 0 ? 'error' : 'default'}
                label={`${workSummary.overdueCount} overdue`}
                size="small"
                variant="outlined"
              />
            </Box>
            <Box sx={{ display: 'grid', gap: 1 }}>
              {workSummary.items.map((item) => (
                <Box key={item.taskId} sx={{ display: 'grid', gap: 0.35 }}>
                  <Link
                    component={NextLink}
                    href={`/workspace/tasks/${item.projectId}/tasks/${item.taskId}`}
                    underline="hover"
                    variant="body2"
                    sx={{ fontWeight: 600 }}
                  >
                    {item.title}
                  </Link>
                  <Typography variant="caption" color="text.secondary">
                    {item.projectKey} · {item.urgencyBucket === 'overdue' ? 'Overdue' : 'Due today'}
                    {item.dueDate ? ` · ${item.dueDate}` : ''}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        ) : (
          <ContextRailEmptyState message="All caught up for today" />
        )}
      </ContextRailSection>

      <ContextRailSection title="Unread Messages" testId="workspace-context-rail-unread-messages">
        {queries.unreadCount.isLoading ? (
          <Typography variant="body2" color="text.secondary">
            Checking unread messages...
          </Typography>
        ) : queries.unreadCount.isError ? (
          <Typography variant="body2" color="error.main">
            Unable to load unread messages right now.
          </Typography>
        ) : unreadCount > 0 ? (
          <>
            <Typography variant="body2" fontWeight={700} color="text.primary">
              {unreadCount} unread {unreadCount === 1 ? 'message' : 'messages'}
            </Typography>
            <Link component={NextLink} href="/workspace/notifications" underline="hover" variant="caption">
              Open notifications
            </Link>
          </>
        ) : (
          <ContextRailEmptyState message="No unread messages" />
        )}
      </ContextRailSection>
    </>
  );
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(value);
}

function initialsFor(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function presenceLabel(status?: string): string {
  switch (status) {
    case 'online':
      return 'Online';
    case 'idle':
      return 'Idle';
    case 'offline':
      return 'Offline';
    case 'online_hidden':
      return 'Hidden';
    default:
      return 'Unknown';
  }
}

export default GlobalContextBlocks;