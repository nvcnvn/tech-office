/**
 * Schedule — action-first agenda + month browser
 *
 * The mobile tab now leads with the next event and upcoming work before
 * exposing the month grid as a secondary browse-by-date control.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Text,
  ScrollView,
  View,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listEvents, type CalendarEvent } from "apis";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isToday as isDateToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { SearchPill } from "@/components/ui/search-pill";
import { SkeletonCalendar } from "@/components/ui/skeleton";
import { createTopLevelTabHeader } from "@/components/ui/header-title-with-stream-status";
import { SFIcon } from "@/components/ui/sf-icon";
import { ghostLoadingTimings, useGhostLoading } from "@/hooks/use-ghost-loading";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import { withNavigationContext } from "@/lib/mobile-navigation";
import { useStreamRecoveryRefresh } from "@/hooks/use-stream-recovery-refresh";
import { notificationStreamBehavior } from "@/lib/notification-stream-behavior";
import {
  calendarIcons,
  eventCategory,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  shadows,
} from "@tech-office/theme-tokens";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function getEventStart(event: CalendarEvent): Date | null {
  return event.startTime ? new Date(event.startTime) : null;
}

function getEventEnd(event: CalendarEvent): Date | null {
  return event.endTime ? new Date(event.endTime) : null;
}

function getEventColor(event: CalendarEvent): string {
  switch (event.eventType) {
    case "deadline":
      return eventCategory.deadline;
    case "reminder":
      return eventCategory.reminder;
    case "out_of_office":
      return eventCategory.holiday;
    case "shift":
    case "company_event":
      return eventCategory.personal;
    case "training":
    case "maintenance_window":
      return eventCategory.other;
    case "meeting":
    default:
      return eventCategory.meeting;
  }
}

function getDurationLabel(event: CalendarEvent): string {
  const startTime = getEventStart(event);
  const endTime = getEventEnd(event);

  if (!startTime || !endTime) {
    return "";
  }

  const minutes = Math.max(Math.round((endTime.getTime() - startTime.getTime()) / 60000), 0);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours} hr ${remainder} min` : `${hours} hr`;
  }

  return `${minutes} min`;
}

function getEventTimeLabel(event: CalendarEvent): string {
  const startTime = getEventStart(event);
  const endTime = getEventEnd(event);

  if (event.allDay) {
    return "All day";
  }

  if (!startTime) {
    return "Time TBD";
  }

  if (!endTime) {
    return format(startTime, "h:mm a");
  }

  return `${format(startTime, "h:mm a")} - ${format(endTime, "h:mm a")}`;
}

function getRelativeEventLabel(event: CalendarEvent, now: Date): string {
  const startTime = getEventStart(event);
  if (!startTime) {
    return "Time TBD";
  }

  if (isSameDay(startTime, now)) {
    if (event.requiresCheckIn) {
      return "Check in today";
    }

    const diffMinutes = Math.round((startTime.getTime() - now.getTime()) / 60000);
    if (diffMinutes > 0 && diffMinutes < 60) {
      return `Starts in ${diffMinutes} min`;
    }

    if (diffMinutes >= 60) {
      return `Today at ${format(startTime, "h:mm a")}`;
    }

    return "In progress";
  }

  const tomorrow = addDays(startOfDay(now), 1);
  if (isSameDay(startTime, tomorrow)) {
    return `Tomorrow at ${format(startTime, "h:mm a")}`;
  }

  return format(startTime, "EEE, MMM d • h:mm a");
}

function getSectionLabel(event: CalendarEvent, now: Date): string {
  const startTime = getEventStart(event);
  if (!startTime) {
    return "Time TBD";
  }

  if (isSameDay(startTime, now)) {
    return event.requiresCheckIn ? "Needs check-in" : "Today";
  }

  return format(startTime, "EEE, MMM d");
}

function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((left, right) => {
    const leftTime = getEventStart(left)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightTime = getEventStart(right)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  });
}

function MonthGrid({
  currentMonth,
  selectedDate,
  eventDates,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: {
  currentMonth: Date;
  selectedDate: Date;
  eventDates: Set<string>;
  onSelectDate: (date: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [currentMonth]);

  const monthNumber = currentMonth.getMonth();

  return (
    <View style={gridStyles.container}>
      <View style={gridStyles.header}>
        <Pressable onPress={onPrevMonth} hitSlop={12} style={gridStyles.navBtn}>
          <SFIcon name="chevron.left" size={16} color={lightPalette.primary.main} />
        </Pressable>
        <Text style={gridStyles.monthTitle}>{format(currentMonth, "MMMM yyyy")}</Text>
        <Pressable onPress={onNextMonth} hitSlop={12} style={gridStyles.navBtn}>
          <SFIcon name="chevron.right" size={16} color={lightPalette.primary.main} />
        </Pressable>
      </View>

      <View style={gridStyles.weekRow}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={gridStyles.weekLabel}>
            {day}
          </Text>
        ))}
      </View>

      <View style={gridStyles.daysGrid}>
        {days.map((day, index) => {
          const isCurrentMonth = day.getMonth() === monthNumber;
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isDateToday(day);
          const dateKey = format(day, "yyyy-MM-dd");
          const hasEvent = eventDates.has(dateKey);

          return (
            <Pressable
              key={index}
              onPress={() => onSelectDate(day)}
              style={[
                gridStyles.dayCell,
                isSelected && gridStyles.dayCellSelected,
                isToday && !isSelected && gridStyles.dayCellToday,
              ]}
            >
              <Text
                style={[
                  gridStyles.dayText,
                  !isCurrentMonth && gridStyles.dayTextMuted,
                  isSelected && gridStyles.dayTextSelected,
                  isToday && !isSelected && gridStyles.dayTextToday,
                ]}
              >
                {day.getDate()}
              </Text>
              {hasEvent ? (
                <View
                  style={[
                    gridStyles.eventDot,
                    isSelected && gridStyles.eventDotSelected,
                  ]}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={sectionStyles.header}>
      <Text style={sectionStyles.title}>{title}</Text>
      <Text style={sectionStyles.subtitle}>{subtitle}</Text>
    </View>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <View style={summaryStyles.card}>
      <Text style={summaryStyles.title}>{title}</Text>
      <Text style={summaryStyles.value}>{value}</Text>
    </View>
  );
}

function ScheduleEmpty({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <View style={sectionStyles.emptyCard}>
      <Text style={sectionStyles.emptyTitle}>{title}</Text>
      <Text style={sectionStyles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

function EventCard({
  event,
  label,
}: {
  event: CalendarEvent;
  label?: string;
}) {
  const router = useRouter();
  const color = getEventColor(event);
  const startTime = getEventStart(event);
  const durationText = getDurationLabel(event);
  const showCheckIn = Boolean(startTime && isDateToday(startTime) && event.requiresCheckIn);

  return (
    <Pressable
      onPress={() =>
        router.push(
          withNavigationContext(`/(app)/(calendar)/${event.id}`, {
            fallbackHref: "/(app)/(calendar)",
            ownerTab: "calendar",
            backLabel: "Schedule",
          }) as never,
        )
      }
      style={({ pressed }) => [cardStyles.card, pressed && cardStyles.cardPressed]}
    >
      <View style={[cardStyles.colorBar, { backgroundColor: color }]} />
      <View style={cardStyles.content}>
        {label ? (
          <View style={[cardStyles.labelPill, { backgroundColor: `${color}18` }]}>
            <Text style={[cardStyles.labelText, { color }]}>{label}</Text>
          </View>
        ) : null}
        <Text style={[cardStyles.time, { color }]}>{getEventTimeLabel(event)}</Text>
        <Text style={cardStyles.title} numberOfLines={1}>
          {event.title}
        </Text>
        <View style={cardStyles.metaStack}>
          {event.locationText ? (
            <View style={cardStyles.metaRow}>
              <SFIcon name="mappin.and.ellipse" size={14} color={lightPalette.text.secondary} />
              <Text style={cardStyles.metaText}>{event.locationText}</Text>
            </View>
          ) : null}
          {durationText ? (
            <View style={cardStyles.metaRow}>
              <SFIcon name="clock" size={14} color={lightPalette.text.secondary} />
              <Text style={cardStyles.metaText}>{durationText}</Text>
            </View>
          ) : null}
        </View>
        {showCheckIn ? (
          <Pressable
            testID="event-checkin"
            onPress={() =>
              router.push(
                withNavigationContext(`/(app)/(calendar)/${event.id}`, {
                  fallbackHref: "/(app)/(calendar)",
                  ownerTab: "calendar",
                  backLabel: "Schedule",
                }) as never,
              )
            }
            style={({ pressed }) => [
              cardStyles.actionBtn,
              pressed && cardStyles.actionBtnPressed,
            ]}
          >
            <SFIcon
              name="checkmark.circle.fill"
              size={18}
              color={lightPalette.success.contrastText}
            />
            <Text style={cardStyles.actionText}>Check In</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function NextUpCard({ event }: { event: CalendarEvent }) {
  const router = useRouter();
  const now = new Date();
  const color = getEventColor(event);
  const startTime = getEventStart(event);
  const actionLabel = startTime && isDateToday(startTime) && event.requiresCheckIn ? "Check In" : "Open Event";

  return (
    <Pressable
      onPress={() =>
        router.push(
          withNavigationContext(`/(app)/(calendar)/${event.id}`, {
            fallbackHref: "/(app)/(calendar)",
            ownerTab: "calendar",
            backLabel: "Schedule",
          }) as never,
        )
      }
      style={({ pressed }) => [nextUpStyles.card, pressed && nextUpStyles.cardPressed]}
    >
      <View style={nextUpStyles.headerRow}>
        <View style={[nextUpStyles.badge, { backgroundColor: `${color}18` }]}>
          <Text style={[nextUpStyles.badgeText, { color }]}>
            {getRelativeEventLabel(event, now)}
          </Text>
        </View>
        <SFIcon name="calendar.badge.clock" size={18} color={color} />
      </View>
      <Text style={nextUpStyles.title}>{event.title}</Text>
      <Text style={nextUpStyles.time}>{getEventTimeLabel(event)}</Text>
      {event.locationText ? (
        <View style={nextUpStyles.metaRow}>
          <SFIcon name="mappin.and.ellipse" size={14} color={lightPalette.text.secondary} />
          <Text style={nextUpStyles.metaText}>{event.locationText}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={() =>
          router.push(
            withNavigationContext(`/(app)/(calendar)/${event.id}`, {
              fallbackHref: "/(app)/(calendar)",
              ownerTab: "calendar",
              backLabel: "Schedule",
            }) as never,
          )
        }
        style={({ pressed }) => [nextUpStyles.actionBtn, pressed && nextUpStyles.actionBtnPressed]}
      >
        <Text style={nextUpStyles.actionText}>{actionLabel}</Text>
      </Pressable>
    </Pressable>
  );
}

export default function CalendarScreen() {
  const now = new Date();
  const today = startOfDay(now);
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(now);
  const [selectedDate, setSelectedDate] = useState(now);
  const hasMountedMonthRef = useRef(false);
  const hasLoadedRef = useRef(false);

  const monthRangeStart = startOfMonth(currentMonth);
  const monthRangeEnd = endOfMonth(currentMonth);
  const agendaRangeStart = today;
  const agendaRangeEnd = endOfDay(addDays(today, 14));

  const {
    data: monthEvents,
    isLoading: isMonthLoading,
    refetch: refetchMonth,
  } = useQuery({
    queryKey: ["calendar-events", format(currentMonth, "yyyy-MM")],
    queryFn: () => listEvents(monthRangeStart, monthRangeEnd),
  });

  const {
    data: agendaEventsRaw,
    isLoading: isAgendaLoading,
    refetch: refetchAgenda,
  } = useQuery({
    queryKey: ["schedule-events", format(today, "yyyy-MM-dd")],
    queryFn: () => listEvents(agendaRangeStart, agendaRangeEnd),
  });

  const refetchAll = useCallback(
    () => Promise.all([refetchMonth(), refetchAgenda()]),
    [refetchAgenda, refetchMonth],
  );

  const { isRefreshing, onRefresh } = useManualRefresh(refetchAll);
  const { isGhostLoading, runGhostLoad } = useGhostLoading(
    refetchAll,
    ghostLoadingTimings.tabMinimumMs,
  );

  useStreamRecoveryRefresh(refetchAll, {
    intervalMs: notificationStreamBehavior.fallbackPollMs.calendar,
  });

  useEffect(() => {
    if (!isMonthLoading && !isAgendaLoading) {
      hasLoadedRef.current = true;
    }
  }, [isAgendaLoading, isMonthLoading]);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedRef.current) {
        return;
      }

      void runGhostLoad();
    }, [runGhostLoad]),
  );

  useEffect(() => {
    if (!hasMountedMonthRef.current) {
      hasMountedMonthRef.current = true;
      return;
    }

    void runGhostLoad();
  }, [currentMonth, runGhostLoad]);

  const eventDates = useMemo(() => {
    const set = new Set<string>();
    for (const event of monthEvents ?? []) {
      const date = getEventStart(event);
      if (date) {
        set.add(format(date, "yyyy-MM-dd"));
      }
    }
    return set;
  }, [monthEvents]);

  const selectedDayEvents = useMemo(() => {
    return sortEvents(
      (monthEvents ?? []).filter((event) => {
        const date = getEventStart(event);
        return Boolean(date && isSameDay(date, selectedDate));
      }),
    );
  }, [monthEvents, selectedDate]);

  const agendaEvents = useMemo(() => {
    return sortEvents((agendaEventsRaw ?? []).filter((event) => !event.cancelledAt));
  }, [agendaEventsRaw]);

  const nextUpEvent = useMemo(() => {
    return (
      agendaEvents.find((event) => {
        const startTime = getEventStart(event);
        const endTime = getEventEnd(event) ?? startTime;
        if (!startTime || !endTime) {
          return false;
        }

        if (event.allDay && isSameDay(startTime, now)) {
          return true;
        }

        return endTime.getTime() >= now.getTime();
      }) ?? null
    );
  }, [agendaEvents, now]);

  const todayEvents = useMemo(() => {
    return agendaEvents.filter((event) => {
      const startTime = getEventStart(event);
      return Boolean(startTime && isSameDay(startTime, now));
    });
  }, [agendaEvents, now]);

  const comingSoonEvents = useMemo(() => {
    return agendaEvents.filter((event) => {
      const startTime = getEventStart(event);
      return Boolean(startTime && !isSameDay(startTime, now));
    }).slice(0, 5);
  }, [agendaEvents, now]);

  const isBusyLoading = (isMonthLoading || isAgendaLoading) && !hasLoadedRef.current;
  const todayCount = String(todayEvents.length);
  const nextWeekCount = String(agendaEvents.length);

  return (
    <>
      <Stack.Screen
        options={createTopLevelTabHeader("Schedule", [
          {
            key: "new-event",
            testID: "add-event-button",
            accessibilityLabel: "New Event",
            onPress: () => router.push("/(app)/(calendar)/create"),
            icon: (
              <SFIcon
                name={calendarIcons.addEvent.name}
                size={22}
                color={lightPalette.primary.main}
              />
            ),
          },
        ],
        // Schedule is not a tab any more; it is opened from the Today header.
        { label: "Today", href: "/(app)/(today)" },
        )}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
        style={screenStyles.container}
        contentContainerStyle={screenStyles.contentContainer}
      >
        <SearchPill placeholder="Search people, tasks, events…" />

        <Pressable
          testID="add-event-content-button"
          accessibilityRole="button"
          accessibilityLabel="New Event"
          onPress={() => router.push("/(app)/(calendar)/create")}
          style={({ pressed }) => [
            screenStyles.primaryAction,
            pressed && screenStyles.primaryActionPressed,
          ]}
        >
          <View style={screenStyles.primaryActionIcon}>
            <SFIcon name={calendarIcons.addEvent.name} size={18} color={lightPalette.primary.contrastText} />
          </View>
          <Text style={screenStyles.primaryActionText}>New Event</Text>
        </Pressable>

        <View style={summaryStyles.row}>
          <SummaryCard title="Today" value={todayCount} />
          <SummaryCard title="Next 14 days" value={nextWeekCount} />
        </View>

        <View style={sectionStyles.block}>
          <SectionHeader
            title="Next Up"
            subtitle="Open the next event that needs attention."
          />
          {isBusyLoading || isGhostLoading ? (
            <SkeletonCalendar />
          ) : nextUpEvent ? (
            <NextUpCard event={nextUpEvent} />
          ) : (
            <ScheduleEmpty
              title="Nothing is queued right now"
              subtitle="New events for today and the next two weeks will show here."
            />
          )}
        </View>

        <View style={sectionStyles.block}>
          <SectionHeader
            title="Today"
            subtitle="Everything scheduled for today, in time order."
          />
          {isBusyLoading || isGhostLoading ? (
            <SkeletonCalendar />
          ) : todayEvents.length > 0 ? (
            todayEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                label={getSectionLabel(event, now)}
              />
            ))
          ) : (
            <ScheduleEmpty
              title="No events today"
              subtitle="This stays clear until something is scheduled for today."
            />
          )}
        </View>

        <View style={sectionStyles.block}>
          <SectionHeader
            title="Coming Soon"
            subtitle="The next events after today."
          />
          {isBusyLoading || isGhostLoading ? (
            <SkeletonCalendar />
          ) : comingSoonEvents.length > 0 ? (
            comingSoonEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                label={getSectionLabel(event, now)}
              />
            ))
          ) : (
            <ScheduleEmpty
              title="Nothing else scheduled"
              subtitle="When future events exist, they will appear here automatically."
            />
          )}
        </View>

        <View style={sectionStyles.block}>
          <SectionHeader
            title="Browse by Date"
            subtitle="Use the calendar to review or jump to a specific day."
          />
          <MonthGrid
            currentMonth={currentMonth}
            selectedDate={selectedDate}
            eventDates={eventDates}
            onSelectDate={setSelectedDate}
            onPrevMonth={() => {
              setCurrentMonth((month) => {
                const nextMonth = subMonths(month, 1);
                setSelectedDate(startOfMonth(nextMonth));
                return nextMonth;
              });
            }}
            onNextMonth={() => {
              setCurrentMonth((month) => {
                const nextMonth = addMonths(month, 1);
                setSelectedDate(startOfMonth(nextMonth));
                return nextMonth;
              });
            }}
          />

          <View style={screenStyles.dayHeader}>
            <Text style={screenStyles.dayHeaderText}>
              {isDateToday(selectedDate) ? "Today, " : ""}
              {format(selectedDate, "MMMM d")}
            </Text>
          </View>

          {isBusyLoading || isGhostLoading ? (
            <SkeletonCalendar />
          ) : selectedDayEvents.length > 0 ? (
            selectedDayEvents.map((event) => <EventCard key={event.id} event={event} />)
          ) : (
            <ScheduleEmpty
              title="No events on this day"
              subtitle="Pick another date or create a new event."
            />
          )}
        </View>
      </ScrollView>
    </>
  );
}

const gridStyles = StyleSheet.create({
  container: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: 18,
    overflow: "hidden",
    ...shadows.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: mobileLayout.screenPadding,
    paddingVertical: 10,
  },
  navBtn: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: lightPalette.text.primary,
  },
  weekRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  dayCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 6,
    gap: 2,
  },
  dayCellSelected: {
    backgroundColor: lightPalette.primary.main,
    borderRadius: 20,
  },
  dayCellToday: {
    borderWidth: 1.5,
    borderColor: lightPalette.primary.main,
    borderRadius: 20,
  },
  dayText: {
    fontSize: 15,
    fontWeight: "400",
    color: lightPalette.text.primary,
  },
  dayTextMuted: {
    color: lightPalette.text.disabled,
  },
  dayTextSelected: {
    color: lightPalette.primary.contrastText,
    fontWeight: "600",
  },
  dayTextToday: {
    color: lightPalette.primary.main,
    fontWeight: "600",
  },
  eventDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: lightPalette.primary.main,
  },
  eventDotSelected: {
    backgroundColor: lightPalette.primary.contrastText,
  },
});

const sectionStyles = StyleSheet.create({
  block: {
    paddingHorizontal: mobileLayout.screenPadding,
    paddingTop: mobileLayout.itemGap,
    gap: 10,
  },
  header: {
    gap: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: lightPalette.text.primary,
  },
  subtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  emptyCard: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: 16,
    padding: mobileLayout.cardPadding,
    gap: 6,
    ...shadows.sm,
  },
  emptyTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "600",
    color: lightPalette.text.primary,
  },
  emptySubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
});

const summaryStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: mobileLayout.screenPadding,
    paddingTop: mobileLayout.itemGap,
  },
  card: {
    flex: 1,
    backgroundColor: lightPalette.background.paper,
    borderRadius: 16,
    padding: mobileLayout.cardPadding,
    gap: 4,
    ...shadows.sm,
  },
  title: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600",
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
  },
  value: {
    fontSize: 28,
    fontWeight: "700",
    color: lightPalette.text.primary,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: lightPalette.background.paper,
    borderRadius: 16,
    overflow: "hidden",
    ...shadows.sm,
  },
  cardPressed: {
    opacity: opacity.pressed,
  },
  colorBar: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: mobileLayout.cardGap,
    gap: 4,
  },
  labelPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  labelText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600",
  },
  time: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  title: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: lightPalette.text.primary,
  },
  metaStack: {
    gap: 4,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    gap: 6,
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: mobileLayout.screenPadding,
    backgroundColor: lightPalette.success.main,
    borderRadius: 8,
  },
  actionBtnPressed: {
    backgroundColor: lightPalette.success.dark,
  },
  actionText: {
    color: lightPalette.success.contrastText,
    fontSize: mobileTypography.buttonSm.fontSize as number,
    fontWeight: mobileTypography.buttonSm.fontWeight as "600",
  },
});

const nextUpStyles = StyleSheet.create({
  card: {
    backgroundColor: lightPalette.background.paper,
    borderRadius: 20,
    padding: mobileLayout.cardPadding,
    gap: 10,
    ...shadows.sm,
  },
  cardPressed: {
    opacity: opacity.pressed,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: lightPalette.text.primary,
  },
  time: {
    fontSize: 16,
    fontWeight: "600",
    color: lightPalette.text.secondary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  actionBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: lightPalette.primary.main,
  },
  actionBtnPressed: {
    backgroundColor: lightPalette.primary.dark,
  },
  actionText: {
    fontSize: mobileTypography.buttonSm.fontSize as number,
    fontWeight: "700",
    color: lightPalette.primary.contrastText,
  },
});

const screenStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  contentContainer: {
    flexGrow: 1,
    paddingBottom: mobileLayout.itemGap * 2,
  },
  primaryAction: {
    marginHorizontal: mobileLayout.screenPadding,
    marginTop: mobileLayout.itemGap,
    minHeight: 48,
    borderRadius: 14,
    borderCurve: "continuous",
    backgroundColor: lightPalette.primary.main,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryActionPressed: {
    opacity: opacity.pressed,
  },
  primaryActionIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryActionText: {
    fontSize: mobileTypography.button.fontSize as number,
    lineHeight: mobileTypography.button.lineHeight as number,
    fontWeight: "700",
    color: lightPalette.primary.contrastText,
  },
  dayHeader: {
    paddingTop: 2,
  },
  dayHeaderText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "600",
    color: lightPalette.text.primary,
  },
});
