'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  getAssignedWorkSummary,
  getEmployeePresence,
  getUnreadCount,
  listEvents,
  type AssignedWorkSummary,
  type CalendarEvent,
  type EmployeePresence,
} from 'apis';
import type { UserProfile } from '@/lib/auth/types';

import { useNotificationStream } from '../../providers/NotificationStreamProvider';
import { useContextRail } from '../../providers/useContextRail';

const UPCOMING_RANGE_DAYS = 30;
const GLOBAL_BLOCK_LIMIT = 5;

export interface NextUpSummary {
  event: CalendarEvent | null;
  remainingTodayCount: number;
}

export interface GlobalContextRailData {
  identity: {
    displayName: string;
    email: string;
    avatarUrl?: string;
    presence: EmployeePresence | null;
  };
  nextUp: NextUpSummary;
  workSummary: AssignedWorkSummary;
  unreadCount: number;
  queries: {
    presence: UseQueryResult<EmployeePresence | null>;
    events: UseQueryResult<CalendarEvent[]>;
    workSummary: UseQueryResult<AssignedWorkSummary>;
    unreadCount: UseQueryResult<number>;
  };
}

export function useGlobalContextRailData(user: UserProfile): GlobalContextRailData {
  const queryClient = useQueryClient();
  const { subscribe } = useNotificationStream();
  const { setHasBadgeAlert } = useContextRail();

  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + UPCOMING_RANGE_DAYS);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, []);

  const presenceQuery = useQuery({
    queryKey: ['context-rail', 'presence', user.sub],
    queryFn: () => getEmployeePresence(user.sub),
    enabled: Boolean(user.sub),
    staleTime: 30_000,
  });

  const eventsQuery = useQuery({
    queryKey: ['context-rail', 'events', range.start.toISOString(), range.end.toISOString()],
    queryFn: () => listEvents(range.start, range.end),
    staleTime: 60_000,
  });

  const workSummaryQuery = useQuery({
    queryKey: ['context-rail', 'assigned-work-summary'],
    queryFn: () => getAssignedWorkSummary({ limit: GLOBAL_BLOCK_LIMIT }),
    staleTime: 30_000,
  });

  const unreadCountQuery = useQuery({
    queryKey: ['context-rail', 'unread-count'],
    queryFn: async () => (await getUnreadCount()).unreadCount,
    staleTime: 15_000,
  });

  useEffect(() => {
    return subscribe(() => {
      void queryClient.invalidateQueries({ queryKey: ['context-rail', 'assigned-work-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['context-rail', 'unread-count'] });
    });
  }, [queryClient, subscribe]);

  const nextUp = useMemo<NextUpSummary>(() => {
    const now = new Date();
    const upcomingEvents = (eventsQuery.data ?? [])
      .filter((event) => event.startTime && event.startTime.getTime() >= now.getTime())
      .sort((left, right) => {
        const leftTime = left.startTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightTime = right.startTime?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      });

    const event = upcomingEvents[0] ?? null;
    if (!event?.startTime) {
      return { event: null, remainingTodayCount: 0 };
    }

    const eventDay = event.startTime.toDateString();
    const remainingTodayCount = upcomingEvents.filter((candidate) => {
      if (!candidate.startTime) {
        return false;
      }
      return candidate.id !== event.id && candidate.startTime.toDateString() === eventDay;
    }).length;

    return { event, remainingTodayCount };
  }, [eventsQuery.data]);

  const overdueCount = workSummaryQuery.data?.overdueCount ?? 0;
  const unreadCount = unreadCountQuery.data ?? 0;

  useEffect(() => {
    setHasBadgeAlert(overdueCount > 0 || unreadCount > 0);
  }, [overdueCount, setHasBadgeAlert, unreadCount]);

  return {
    identity: {
      displayName: user.name,
      email: user.email,
      avatarUrl: user.picture,
      presence: presenceQuery.data ?? null,
    },
    nextUp,
    workSummary: workSummaryQuery.data ?? {
      asOfDate: '',
      dueTodayCount: 0,
      overdueCount: 0,
      items: [],
    },
    unreadCount,
    queries: {
      presence: presenceQuery,
      events: eventsQuery,
      workSummary: workSummaryQuery,
      unreadCount: unreadCountQuery,
    },
  };
}