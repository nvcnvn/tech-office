/**
 * Today — the one screen that answers "what do I need to do right now".
 *
 * Chat, My Work and Schedule each answer that for their own domain. This tab
 * merges the three answers into a single day view so nobody has to check three
 * places to find out they are late for something:
 *
 *   1. Running late   — overdue assigned work
 *   2. Today's schedule — today's events, in time order
 *   3. Due today      — assigned work with today's due date
 *
 * Data comes from two RPCs and no client-side fan-out:
 * `GetAssignedWorkSummary` already returns overdue + due-today across every
 * project, and `ListEvents` takes a date range. Deeper browsing lives behind
 * the header actions (Schedule) and the My Work tab.
 */

import React, { useCallback, useMemo } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  getAssignedWorkSummary,
  listEvents,
  type AssignedWorkSummaryItem,
  type CalendarEvent,
} from "apis";
import { endOfDay, format, isBefore, startOfDay } from "date-fns";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { createTopLevelTabHeader } from "@/components/ui/header-title-with-stream-status";
import { SearchPill } from "@/components/ui/search-pill";
import { SFIcon } from "@/components/ui/sf-icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import { useStreamRecoveryRefresh } from "@/hooks/use-stream-recovery-refresh";
import { notificationStreamBehavior } from "@/lib/notification-stream-behavior";
import { withNavigationContext } from "@/lib/mobile-navigation";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  tabIcons,
} from "@tech-office/theme-tokens";

const TODAY_HREF = "/(app)/(today)";

function todayNavigation(href: string): string {
  return withNavigationContext(href, {
    ownerTab: "today",
    fallbackHref: TODAY_HREF,
    backLabel: "Today",
  });
}

function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  if (!event.startTime) return "";
  const start = format(event.startTime, "HH:mm");
  return event.endTime ? `${start} – ${format(event.endTime, "HH:mm")}` : start;
}

function formatDueDate(item: AssignedWorkSummaryItem): string {
  if (!item.dueDate) return "No due date";
  const due = new Date(item.dueDate);
  return Number.isNaN(due.getTime()) ? "No due date" : format(due, "d MMM");
}

// ── Rows ────────────────────────────────────────────────────────────────────

function WorkRow({
  item,
  overdue,
  onPress,
}: {
  item: AssignedWorkSummaryItem;
  overdue: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={`today-work-${item.taskId}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View
        style={[
          styles.rowIcon,
          {
            backgroundColor: overdue
              ? `${lightPalette.error.main}14`
              : `${lightPalette.primary.main}14`,
          },
        ]}
      >
        <SFIcon
          name={overdue ? "exclamationmark.triangle.fill" : "checkmark.square"}
          size={18}
          color={overdue ? lightPalette.error.main : lightPalette.primary.main}
        />
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={2} style={styles.rowTitle}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {[item.projectKey, item.stateName, formatDueDate(item)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>
      <SFIcon name="chevron.right" size={14} color={lightPalette.text.secondary} />
    </Pressable>
  );
}

function EventRow({ event, onPress }: { event: CalendarEvent; onPress: () => void }) {
  const time = formatEventTime(event);
  return (
    <Pressable
      testID={`today-event-${event.id}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={event.title}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.eventTimeWrap}>
        <Text style={styles.eventTime}>{time || "—"}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={2} style={styles.rowTitle}>
          {event.title}
        </Text>
        {event.locationText ? (
          <Text numberOfLines={1} style={styles.rowMeta}>
            {event.locationText}
          </Text>
        ) : null}
      </View>
      <SFIcon name="chevron.right" size={14} color={lightPalette.text.secondary} />
    </Pressable>
  );
}

function Section({
  title,
  subtitle,
  count,
  testID,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  testID: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader} testID={testID}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export default function TodayScreen() {
  const router = useRouter();
  const dayKey = format(new Date(), "yyyy-MM-dd");

  const {
    data: work,
    isLoading: isWorkLoading,
    error: workError,
    refetch: refetchWork,
  } = useQuery({
    queryKey: ["today-work", dayKey],
    queryFn: () =>
      getAssignedWorkSummary({ limit: 20, includeRitualInstances: true }),
  });

  const {
    data: events,
    isLoading: isEventsLoading,
    error: eventsError,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: ["today-events", dayKey],
    queryFn: () => {
      const now = new Date();
      return listEvents(startOfDay(now), endOfDay(now));
    },
  });

  const refetchAll = useCallback(
    () => Promise.all([refetchWork(), refetchEvents()]),
    [refetchEvents, refetchWork],
  );

  const { isRefreshing, onRefresh } = useManualRefresh(refetchAll);

  useStreamRecoveryRefresh(refetchAll, {
    intervalMs: notificationStreamBehavior.fallbackPollMs.tasks,
  });

  const overdueItems = useMemo(
    () => (work?.items ?? []).filter((item) => item.urgencyBucket === "overdue"),
    [work],
  );
  const dueTodayItems = useMemo(
    () => (work?.items ?? []).filter((item) => item.urgencyBucket === "due_today"),
    [work],
  );
  const sortedEvents = useMemo(() => {
    const now = new Date();
    return [...(events ?? [])]
      .filter((event) => !event.cancelledAt)
      .sort((left, right) => {
        if (left.allDay !== right.allDay) return left.allDay ? -1 : 1;
        return (left.startTime?.getTime() ?? 0) - (right.startTime?.getTime() ?? 0);
      })
      .map((event) => ({
        event,
        isPast: !event.allDay && !!event.endTime && isBefore(event.endTime, now),
      }));
  }, [events]);

  const header = createTopLevelTabHeader("Today", [
    {
      key: "schedule",
      testID: tabIcons.calendar.testID,
      accessibilityLabel: tabIcons.calendar.label,
      onPress: () => router.push(todayNavigation("/(app)/(calendar)") as never),
      icon: (
        <SFIcon
          name={tabIcons.calendar.name}
          size={22}
          color={lightPalette.primary.main}
        />
      ),
    },
  ]);

  if (isWorkLoading || isEventsLoading) {
    return (
      <>
        <Stack.Screen options={header} />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
        >
          <SearchPill />
          <SkeletonList count={6} />
        </ScrollView>
      </>
    );
  }

  if (workError || eventsError) {
    return (
      <>
        <Stack.Screen options={header} />
        <View style={styles.center}>
          <Text selectable style={styles.errorText}>Failed to load your day</Text>
          <Button label="Retry" onPress={() => void refetchAll()} />
        </View>
      </>
    );
  }

  const isEmpty =
    overdueItems.length === 0 &&
    dueTodayItems.length === 0 &&
    sortedEvents.length === 0;

  return (
    <>
      <Stack.Screen options={header} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <SearchPill />
        <View style={styles.dateCard}>
          <Text style={styles.dateEyebrow}>{format(new Date(), "EEEE")}</Text>
          <Text style={styles.dateTitle}>{format(new Date(), "d MMMM yyyy")}</Text>
        </View>

        {isEmpty ? (
          <EmptyState
            sfSymbol="checkmark.circle"
            title="Nothing due today"
            subtitle="No overdue work, nothing due today, and no events on your calendar."
          />
        ) : null}

        {overdueItems.length > 0 ? (
          <Section
            title="Running late"
            subtitle="Past their due date"
            count={overdueItems.length}
            testID="today-section-overdue"
          >
            {overdueItems.map((item, index) => (
              <React.Fragment key={item.taskId}>
                {index > 0 && <View style={styles.cardSeparator} />}
                <WorkRow
                  item={item}
                  overdue
                  onPress={() =>
                    router.push(
                      todayNavigation(
                        `/(app)/(tasks)/${item.projectId}/task/${item.taskId}`,
                      ) as never,
                    )
                  }
                />
              </React.Fragment>
            ))}
          </Section>
        ) : null}

        {sortedEvents.length > 0 ? (
          <Section
            title="Today's schedule"
            subtitle="Events on your calendar"
            count={sortedEvents.length}
            testID="today-section-events"
          >
            {sortedEvents.map(({ event, isPast }, index) => (
              <React.Fragment key={event.id}>
                {index > 0 && <View style={styles.cardSeparator} />}
                <View style={isPast ? styles.pastEvent : undefined}>
                  <EventRow
                    event={event}
                    onPress={() =>
                      router.push(
                        todayNavigation(`/(app)/(calendar)/${event.id}`) as never,
                      )
                    }
                  />
                </View>
              </React.Fragment>
            ))}
          </Section>
        ) : null}

        {dueTodayItems.length > 0 ? (
          <Section
            title="Due today"
            subtitle="Assigned to you"
            count={dueTodayItems.length}
            testID="today-section-due"
          >
            {dueTodayItems.map((item, index) => (
              <React.Fragment key={item.taskId}>
                {index > 0 && <View style={styles.cardSeparator} />}
                <WorkRow
                  item={item}
                  overdue={false}
                  onPress={() =>
                    router.push(
                      todayNavigation(
                        `/(app)/(tasks)/${item.projectId}/task/${item.taskId}`,
                      ) as never,
                    )
                  }
                />
              </React.Fragment>
            ))}
          </Section>
        ) : null}

        <Pressable
          testID="today-open-my-work"
          onPress={() => router.push("/(app)/(tasks)" as never)}
          accessibilityRole="button"
          accessibilityLabel="See all my work"
          style={({ pressed }) => [styles.footerLink, pressed && styles.rowPressed]}
        >
          <Text style={styles.footerLinkText}>See all my work</Text>
          <SFIcon name="chevron.right" size={14} color={lightPalette.primary.main} />
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  scrollContent: {
    paddingBottom: mobileLayout.cardPadding * 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: mobileLayout.cardGap,
    padding: mobileLayout.screenPadding,
  },
  errorText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
  },
  dateCard: {
    marginHorizontal: mobileLayout.screenPadding,
    marginTop: spacing[1],
    marginBottom: spacing[0.5],
  },
  dateEyebrow: {
    ...mobileTypography.caption,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: lightPalette.text.secondary,
  },
  dateTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  sectionBlock: {
    marginTop: mobileLayout.cardGap,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: mobileLayout.screenPadding,
    paddingBottom: mobileLayout.itemGap,
  },
  sectionHeaderText: {
    flexShrink: 1,
  },
  sectionTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  sectionSubtitle: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
  },
  sectionCount: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.secondary,
  },
  sectionCard: {
    marginHorizontal: mobileLayout.screenPadding,
    backgroundColor: lightPalette.background.paper,
    borderRadius: radius.md,
    borderWidth: border.hairline,
    borderColor: lightPalette.divider,
    overflow: "hidden",
  },
  cardSeparator: {
    height: border.hairline,
    backgroundColor: lightPalette.divider,
    marginLeft: mobileLayout.cardPadding,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.iconTextGap,
    minHeight: mobileLayout.listRowHeight,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: mobileLayout.itemGap,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.base,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
  },
  rowMeta: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
  },
  eventTimeWrap: {
    width: 64,
  },
  eventTime: {
    ...mobileTypography.caption,
    fontWeight: "600",
    color: lightPalette.text.primary,
  },
  pastEvent: {
    opacity: 0.5,
  },
  footerLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: mobileLayout.cardGap,
    minHeight: mobileLayout.compactRowHeight,
  },
  footerLinkText: {
    ...mobileTypography.button,
    color: lightPalette.primary.main,
  },
});
