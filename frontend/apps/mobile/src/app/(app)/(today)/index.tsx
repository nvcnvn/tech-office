/**
 * Today — the one screen that answers "what do I need to do right now".
 *
 * Chat, My Work and Schedule each answer that for their own domain. This tab
 * merges the three answers into a single day view so nobody has to check three
 * places to find out they are late for something:
 *
 *   1. Running late   — overdue assigned work
 *   2. Team           — what the caller's team is late on or nobody is holding
 *   3. Today's schedule — today's events, in time order
 *   4. Due today      — assigned work with today's due date
 *
 * Data comes from three RPCs and no client-side fan-out:
 * `GetAssignedWorkSummary` already returns overdue + due-today across every
 * project, `ListEvents` takes a date range, and `GetTeamAttentionSummary`
 * resolves supervisory scope server-side. All three are issued in the same
 * render so the round trips are concurrent. Deeper browsing lives behind the
 * header actions (Schedule) and the My Work tab.
 *
 * The Team section only exists for callers who supervise a project, and it owns
 * its own loading and error state: a supervisory extra must never blank out the
 * day a worker depends on.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  getAssignedWorkSummary,
  getTeamAttentionSummary,
  listEvents,
  type AssignedWorkSummaryItem,
  type CalendarEvent,
  type TeamAttentionItem,
  type TeamAttentionSummary,
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
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  tabIcons,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

const TODAY_HREF = "/(app)/(today)";

// Items per category. The server clamps to its own ceiling of 20, so these are the two
// values the block asks for and not a contract the client is trusted to honour.
const TEAM_COLLAPSED_LIMIT = 5;
const TEAM_EXPANDED_LIMIT = 20;

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
  const { palette } = useTheme();
  const styles = useStyles();

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
              ? `${palette.error.main}14`
              : `${palette.primary.main}14`,
          },
        ]}
      >
        <SFIcon
          name={overdue ? "exclamationmark.triangle.fill" : "checkmark.square"}
          size={18}
          color={overdue ? palette.error.main : palette.primary.main}
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
      <SFIcon name="chevron.right" size={14} color={palette.text.secondary} />
    </Pressable>
  );
}

function EventRow({ event, onPress }: { event: CalendarEvent; onPress: () => void }) {
  const { palette } = useTheme();
  const styles = useStyles();

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
      <SFIcon name="chevron.right" size={14} color={palette.text.secondary} />
    </Pressable>
  );
}

// ── Team block ──────────────────────────────────────────────────────────────
//
// The supervisory half of "what do I need to do right now": what the team is late on and
// what nobody is holding. Read-only — tapping a row opens the ritual instance, which is
// where any action lives.
//
// It renders nothing at all when the caller supervises nothing, and it carries its own
// loading and error state so a supervisory extra can never blank out the day a worker
// depends on.

/** The responsibility line: who is on it, or plainly that nobody is. */
function teamResponsibility(item: TeamAttentionItem): string {
  if (item.category === "unassigned") return "Nobody assigned";
  // No name with somebody on it means the assignee's record could not be resolved — a
  // departed or archived person. That is the opposite fact from unassigned and must never
  // be labelled as such.
  if (!item.assigneeDisplayName) return "Assignee unavailable";
  return item.additionalAssigneeCount > 0
    ? `${item.assigneeDisplayName} +${item.additionalAssigneeCount}`
    : item.assigneeDisplayName;
}

function TeamRow({ item, onPress }: { item: TeamAttentionItem; onPress: () => void }) {
  const { palette } = useTheme();
  const styles = useStyles();

  const responsibility = teamResponsibility(item);
  const unassigned = item.category === "unassigned";
  return (
    <Pressable
      testID={`today-team-row-${item.taskId}`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.projectName}, ${responsibility}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View
        style={[
          styles.rowIcon,
          {
            backgroundColor: unassigned
              ? `${palette.warning.main}14`
              : `${palette.error.main}14`,
          },
        ]}
      >
        {/*
          Both names are already in SFIcon's map. An unmapped SF Symbol falls through to
          "help-outline", which renders as a bare "?" — the two icons here shipped that way
          until a Maestro screenshot showed it.
        */}
        <SFIcon
          name={unassigned ? "person.crop.circle.badge.minus" : "clock.badge.exclamationmark.fill"}
          size={18}
          color={unassigned ? palette.warning.main : palette.error.main}
        />
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={2} style={styles.rowTitle}>
          {item.title}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {item.projectName}
          {" · "}
          <Text style={unassigned ? styles.teamUnassigned : undefined}>{responsibility}</Text>
        </Text>
      </View>
      <SFIcon name="chevron.right" size={14} color={palette.text.secondary} />
    </Pressable>
  );
}

/**
 * The Team block, including its own loading and error states.
 *
 * Returns null for a caller who supervises nothing — no heading, no card, no placeholder.
 * `canSupervise` is a distinct server field rather than an inference from a zero count,
 * because "you supervise nothing" and "your team is fine" must not look the same.
 *
 * The error state is deliberately confined here: the screen's whole-screen failure path
 * stays wired to the work and events queries only, so a supervisory extra can never blank
 * out the day a worker depends on.
 */
/**
 * The counts beside the heading are the TRUE totals, not the length of the list — a short
 * list presented as the whole picture is how a supervisor comes to trust a block that is
 * hiding half the backlog. When the server capped a count it says so, and the figure reads
 * "99+" rather than an exact number the caller could disprove by expanding.
 */
function teamCount(count: number, capped: boolean): string {
  return capped ? `${TEAM_COUNT_CAP_DISPLAY}+` : String(count);
}

const TEAM_COUNT_CAP_DISPLAY = 99;

function TeamSection({
  summary,
  isLoading,
  error,
  expanded,
  onToggleExpanded,
  onRetry,
  onOpenItem,
}: {
  summary: TeamAttentionSummary | undefined;
  isLoading: boolean;
  error: unknown;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRetry: () => void;
  onOpenItem: (item: TeamAttentionItem) => void;
}) {
  const { palette } = useTheme();
  const styles = useStyles();

  // A previous successful response already told us the caller supervises nothing, so a
  // later failure or refetch must not suddenly show them a Team heading.
  if (summary?.canSupervise === false) return null;

  // Stacked rather than joined onto one line: "99+ late · 99+ unassigned" beside the
  // heading is wide enough to squeeze the title on a 360 dp Android device or an iPhone SE,
  // and a truncated count is worse than no count.
  const totals = summary
    ? [
        summary.overdueCount > 0
          ? `${teamCount(summary.overdueCount, summary.overdueCountCapped)} late`
          : null,
        summary.unassignedCount > 0
          ? `${teamCount(summary.unassignedCount, summary.unassignedCountCapped)} unassigned`
          : null,
      ].filter((line): line is string => line !== null)
    : [];

  const header = (
    <View style={styles.sectionHeader} testID="today-section-team">
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>Team</Text>
        <Text style={styles.sectionSubtitle}>Across the projects you run</Text>
      </View>
      {totals.length > 0 ? (
        <View style={styles.teamCounts}>
          {totals.map((line) => (
            <Text key={line} numberOfLines={1} style={styles.teamCountLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );

  if (error) {
    return (
      <View style={styles.sectionBlock}>
        {header}
        <View style={styles.sectionCard}>
          <View style={styles.teamStateRow}>
            <Text selectable style={styles.teamErrorText}>
              Couldn&apos;t load your team&apos;s work
            </Text>
            <Button
              testID="today-team-retry"
              label="Retry"
              size="sm"
              variant="secondary"
              onPress={onRetry}
              accessibilityLabel="Retry loading your team's work"
            />
          </View>
        </View>
      </View>
    );
  }

  if (isLoading || !summary) {
    return (
      <View style={styles.sectionBlock}>
        {header}
        <View style={styles.sectionCard}>
          <SkeletonList count={3} />
        </View>
      </View>
    );
  }

  // Nothing overdue and nothing unheld. The block says so explicitly and names how many
  // projects it checked, rather than vanishing — a block that disappears on a quiet morning
  // is indistinguishable from a block that never applied, and the supervisor reads silence
  // as good news without ever being told it is.
  if (summary.items.length === 0) {
    const allClear = `All clear across ${summary.supervisedProjectCount} ${
      summary.supervisedProjectCount === 1 ? "project" : "projects"
    }`;
    return (
      <View style={styles.sectionBlock}>
        {header}
        <View style={styles.sectionCard}>
          <View
            style={styles.teamStateRow}
            accessible
            accessibilityLabel={`Team: ${allClear}. Nothing overdue and nothing unassigned.`}
          >
            <SFIcon name="checkmark.circle" size={18} color={palette.success.main} />
            <Text style={styles.teamAllClear}>{allClear}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.sectionBlock}>
      {header}
      <View style={styles.sectionCard}>
        {summary.items.map((item, index) => (
          <React.Fragment key={item.taskId}>
            {index > 0 && <View style={styles.cardSeparator} />}
            <TeamRow item={item} onPress={() => onOpenItem(item)} />
          </React.Fragment>
        ))}
        {/*
          Expansion refetches the same query with a larger limit rather than paging: the
          ceiling is 20 rows per category, and a cursor for a list that short would be
          scaffolding for a "load more" this block deliberately does not have. The totals
          above stay visible either way, so expanding never changes what the block claims
          about size — only how much of it is on screen.
        */}
        {expanded || summary.overdueCount + summary.unassignedCount > summary.items.length ? (
          <>
            <View style={styles.cardSeparator} />
            <Pressable
              testID="today-team-expand"
              onPress={onToggleExpanded}
              accessibilityRole="button"
              accessibilityLabel={expanded ? "Show fewer team items" : "Show more team items"}
              style={({ pressed }) => [styles.teamExpand, pressed && styles.rowPressed]}
            >
              <Text style={styles.teamExpandText}>{expanded ? "Show less" : "Show more"}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
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
  const styles = useStyles();

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

// FR-015 — the three feeds are concurrent, and nothing below may quietly serialise them.
// All three useQuery calls are unconditional, carry no `enabled` gate, and sit above the
// screen's first early return, so React Query issues them in the same render and the added
// cost of the Team block is the difference between the slowest feed and the previous
// slowest, not a third serial hop. Chaining the team query behind the work query — or
// gating it on `work?.…` — would break this, and no test can catch it: it is a property of
// the render path, checked by reading it.
export default function TodayScreen() {
  const { palette } = useTheme();
  const styles = useStyles();

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

  // The supervisor's Team block. Declared in the same render as the two queries above so
  // all three round trips are concurrent — the added cost is the difference between the
  // slowest feed and the previous slowest, not a third serial hop. `dayKey` is the same
  // local date the other two key on, so the Team block and "Due today" can never disagree
  // about what today means.
  const [teamExpanded, setTeamExpanded] = useState(false);
  const teamLimit = teamExpanded ? TEAM_EXPANDED_LIMIT : TEAM_COLLAPSED_LIMIT;
  const {
    data: team,
    isLoading: isTeamLoading,
    error: teamError,
    refetch: refetchTeam,
  } = useQuery({
    queryKey: ["today-team", dayKey, teamLimit],
    queryFn: () => getTeamAttentionSummary({ asOfDate: dayKey, limit: teamLimit }),
  });

  const refetchAll = useCallback(
    () => Promise.all([refetchWork(), refetchEvents(), refetchTeam()]),
    [refetchEvents, refetchTeam, refetchWork],
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
          color={palette.primary.main}
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

  // The caller's OWN three feeds, deliberately not the team query. "Nothing due today" is a
  // statement about this person's day; folding the team block in would let it be read as
  // asserting the team is clear, which is a different claim and one the block makes
  // explicitly for itself. The two coexist: a supervisor with nothing of their own and a
  // team in trouble sees both.
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

        <TeamSection
          summary={team}
          isLoading={isTeamLoading}
          error={teamError}
          expanded={teamExpanded}
          onToggleExpanded={() => setTeamExpanded((current) => !current)}
          onRetry={() => void refetchTeam()}
          onOpenItem={(item) =>
            router.push(
              todayNavigation(
                `/(app)/(tasks)/${item.projectId}/task/${item.taskId}`,
              ) as never,
            )
          }
        />

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
          <SFIcon name="chevron.right" size={14} color={palette.primary.main} />
        </Pressable>
      </ScrollView>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.background.default,
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
    color: t.text.primary,
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
    color: t.text.secondary,
  },
  dateTitle: {
    ...mobileTypography.sectionHeader,
    color: t.text.primary,
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
    color: t.text.primary,
  },
  sectionSubtitle: {
    ...mobileTypography.caption,
    color: t.text.secondary,
  },
  sectionCount: {
    ...mobileTypography.listPrimary,
    color: t.text.secondary,
  },
  sectionCard: {
    marginHorizontal: mobileLayout.screenPadding,
    backgroundColor: t.background.paper,
    borderRadius: radius.md,
    borderWidth: border.hairline,
    borderColor: t.divider,
    overflow: "hidden",
  },
  cardSeparator: {
    height: border.hairline,
    backgroundColor: t.divider,
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
    color: t.text.primary,
  },
  rowMeta: {
    ...mobileTypography.caption,
    color: t.text.secondary,
  },
  teamStateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: mobileLayout.iconTextGap,
    minHeight: mobileLayout.listRowHeight,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: mobileLayout.itemGap,
  },
  teamCounts: {
    flexShrink: 0,
    alignItems: "flex-end",
    paddingLeft: mobileLayout.itemGap,
  },
  teamCountLine: {
    ...mobileTypography.caption,
    color: t.text.secondary,
  },
  teamExpand: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileLayout.compactRowHeight,
    paddingHorizontal: mobileLayout.cardPadding,
  },
  teamExpandText: {
    ...mobileTypography.button,
    color: t.primary.main,
  },
  teamErrorText: {
    ...mobileTypography.caption,
    flexShrink: 1,
    color: t.text.secondary,
  },
  teamAllClear: {
    ...mobileTypography.listPrimary,
    flex: 1,
    color: t.text.secondary,
  },
  teamUnassigned: {
    color: t.warning.dark,
    fontWeight: "600",
  },
  eventTimeWrap: {
    width: 64,
  },
  eventTime: {
    ...mobileTypography.caption,
    fontWeight: "600",
    color: t.text.primary,
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
    color: t.primary.main,
  },
}));
