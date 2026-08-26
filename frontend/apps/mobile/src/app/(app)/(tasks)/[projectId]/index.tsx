/**
 * Task list for a project — mixed urgency-first view.
 *
 * Standard tasks keep their state visible inside the row.
 * Ritual instances are grouped into one summary row per ritual so people
 * can see missed work, today's run, and upcoming runs without duplicates.
 */

import React, { useCallback, useEffect, useMemo } from "react";
import * as Haptics from "expo-haptics";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
} from "react-native";
import { Stack, Link, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listProjectStates, listRitualDefinitions, listTasks, getProfile } from "apis";
import { useAuth } from "@/hooks/use-auth";
import { useResolvedProjectId } from "@/hooks/use-resolved-project-id";
import { generateCanonicalUrl } from "@/lib/canonical-links";
import { SFIcon } from "@/components/ui/sf-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTaskList } from "@/components/ui/skeleton";
import { ghostLoadingTimings, useGhostLoading } from "@/hooks/use-ghost-loading";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import { withNavigationContext } from "@/lib/mobile-navigation";
import type { ProjectState, RitualDefinition, Task } from "apis";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  shadows,
  spacing,
  statusColors,
} from "@tech-office/theme-tokens";

type CardTone = "neutral" | "info" | "success" | "warning" | "danger";
type MixedSectionKey = "overdue" | "today" | "upcoming" | "no-date";

type StandardTaskItem = {
  task: Task;
  state?: ProjectState;
};

type RitualSummaryItem = {
  key: string;
  definition?: RitualDefinition;
  title: string;
  recurrenceLabel: string;
  statusTone: CardTone;
  bucket: MixedSectionKey;
  timingLabel: string;
  nextLabel: string;
  evidenceLabel?: string;
  activeTask: Task;
  sortDate: Date | null;
};

type MixedListItem =
  | { kind: "standard"; key: string; sortDate: Date | null; item: StandardTaskItem }
  | { kind: "ritual"; key: string; sortDate: Date | null; item: RitualSummaryItem };

type RitualFocusIntent = "view_instance" | "submit_requirement" | "review_pending";

type MixedSection = {
  key: MixedSectionKey;
  title: string;
  subtitle: string;
  data: MixedListItem[];
};

const sectionOrder: Array<{ key: MixedSectionKey; title: string; subtitle: string }> = [
  { key: "overdue", title: "Overdue", subtitle: "Needs attention first" },
  { key: "today", title: "Today", subtitle: "Open the tasks that still need action today" },
  { key: "upcoming", title: "Upcoming", subtitle: "Next tasks and ritual runs coming up" },
  { key: "no-date", title: "No Date", subtitle: "Open work without a schedule yet" },
];

const categoryColors: Record<string, string> = {
  backlog: "#94a3b8",
  unstarted: lightPalette.info.main,
  started: lightPalette.warning.main,
  completed: lightPalette.success.main,
  cancelled: "#bdbdbd",
};

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function parseDateOnly(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function parseDateTime(value?: string | Date): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(left: Date, right: Date): boolean {
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

function compareNullableDates(left: Date | null, right: Date | null): number {
  const leftTime = left?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightTime = right?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function formatShortDate(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatCalendarDate(value: Date | null): string {
  if (!value) {
    return "No date";
  }

  return value.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatRelativeDateLabel(value: Date | null, today: Date): string {
  if (!value) {
    return "No upcoming run";
  }

  const dayDiff = Math.round((startOfDay(value).getTime() - today.getTime()) / 86400000);

  if (dayDiff === 0) {
    return "Today";
  }

  if (dayDiff === 1) {
    return "Tomorrow";
  }

  if (dayDiff > 1 && dayDiff < 7) {
    return value.toLocaleDateString(undefined, { weekday: "long" });
  }

  return formatCalendarDate(value);
}

function formatRecurrenceLabel(definition?: RitualDefinition): string {
  const rule = definition?.recurrenceRule;
  if (!rule) {
    return "Repeats on a schedule";
  }

  const interval = Math.max(rule.interval || 1, 1);

  switch (rule.type) {
    case "daily":
      return interval === 1 ? "Every day" : `Every ${interval} days`;
    case "weekly":
      return interval === 1 ? "Every week" : `Every ${interval} weeks`;
    case "monthly":
      return interval === 1 ? "Every month" : `Every ${interval} months`;
    case "custom_interval":
      return interval === 1 ? "Repeats regularly" : `Every ${interval} cycles`;
    default:
      return "Repeats on a schedule";
  }
}

function getTaskScheduleDate(task: Task): Date | null {
  if (task.taskKind === "ritual_instance") {
    return parseDateOnly(task.scheduledDate) ?? parseDateTime(task.updatedAt);
  }

  return parseDateOnly(task.dueDate);
}

function getMixedBucket(task: Task, today: Date, nextWeek: Date): MixedSectionKey {
  const taskDate = getTaskScheduleDate(task);
  const taskDay = taskDate ? startOfDay(taskDate) : null;

  if (taskDay && taskDay.getTime() < today.getTime()) {
    return "overdue";
  }

  if (taskDay && taskDay.getTime() === today.getTime()) {
    return "today";
  }

  if (taskDay && taskDay.getTime() <= nextWeek.getTime()) {
    return "upcoming";
  }

  return "no-date";
}

function getStandardTimingLabel(task: Task, today: Date, nextWeek: Date): string {
  const scheduleDate = getTaskScheduleDate(task);

  switch (getMixedBucket(task, today, nextWeek)) {
    case "overdue":
      return scheduleDate ? `Late ${formatShortDate(scheduleDate)}` : "Overdue";
    case "today":
      return "Today";
    case "upcoming":
      return scheduleDate ? formatRelativeDateLabel(scheduleDate, today) : "Upcoming";
    default:
      return "No date";
  }
}

function getRitualStatusTone(
  overdueCount: number,
  openTodayTask: Task | undefined,
  closedTodayTask: Task | undefined,
): CardTone {
  if (overdueCount > 0) {
    return "danger";
  }

  if (openTodayTask) {
    return "warning";
  }

  if (closedTodayTask) {
    return "success";
  }

  return "info";
}

function getRitualBucket(
  overdueTask: Task | undefined,
  openTodayTask: Task | undefined,
  nextFutureTask: Task | undefined,
  nextWeek: Date,
): MixedSectionKey {
  if (overdueTask) {
    return "overdue";
  }

  if (openTodayTask) {
    return "today";
  }

  const nextDate = nextFutureTask ? getTaskScheduleDate(nextFutureTask) : null;
  if (nextDate && startOfDay(nextDate).getTime() <= nextWeek.getTime()) {
    return "upcoming";
  }

  return "no-date";
}

function getRitualTimingLabel(
  overdueCount: number,
  openTodayTask: Task | undefined,
  nextFutureTask: Task | undefined,
  today: Date,
): string {
  if (overdueCount > 0) {
    if (openTodayTask) {
      return overdueCount === 1 ? "Today + 1 late" : `Today + ${overdueCount} late`;
    }

    return overdueCount === 1 ? "1 late" : `${overdueCount} late`;
  }

  if (openTodayTask) {
    return "Today";
  }

  if (nextFutureTask) {
    return formatRelativeDateLabel(getTaskScheduleDate(nextFutureTask), today);
  }

  return "Waiting";
}

function getRitualEvidenceLabel(definition?: RitualDefinition): string | undefined {
  const requiredCount = definition?.evidenceRequirements.filter((item) => item.isRequired).length ?? 0;
  if (requiredCount === 0) {
    return undefined;
  }

  return requiredCount === 1 ? "1 proof" : `${requiredCount} proofs`;
}

function buildRitualNextLabel(
  overdueTask: Task | undefined,
  openTodayTask: Task | undefined,
  nextFutureTask: Task | undefined,
  closedTodayTask: Task | undefined,
  today: Date,
): string {
  if (overdueTask) {
    if (openTodayTask) {
      return `Missed ${formatCalendarDate(getTaskScheduleDate(overdueTask))}. Today's run is also due`;
    }

    return `Missed ${formatCalendarDate(getTaskScheduleDate(overdueTask))}. Do it now`;
  }

  if (openTodayTask) {
    return "Due today";
  }

  if (closedTodayTask && nextFutureTask) {
    return `Done today. Next ${formatRelativeDateLabel(getTaskScheduleDate(nextFutureTask), today)}`;
  }

  if (nextFutureTask) {
    return `Due ${formatRelativeDateLabel(getTaskScheduleDate(nextFutureTask), today)}`;
  }

  if (closedTodayTask) {
    return "Completed today";
  }

  return "Awaiting next run";
}

function getRitualStatusIconName(tone: CardTone): string {
  switch (tone) {
    case "danger":
      return "exclamationmark.circle.fill";
    case "warning":
      return "clock.badge.exclamationmark.fill";
    case "success":
      return "checkmark.circle.fill";
    case "info":
      return "calendar.badge.clock";
    default:
      return "calendar";
  }
}

function getToneColors(tone: CardTone) {
  switch (tone) {
    case "danger":
      return {
        accentColor: lightPalette.error.main,
        subtleTextColor: statusColors.error.light.text,
      };
    case "warning":
      return {
        accentColor: lightPalette.warning.main,
        subtleTextColor: statusColors.warning.light.text,
      };
    case "success":
      return {
        accentColor: lightPalette.success.main,
        subtleTextColor: statusColors.success.light.text,
      };
    case "info":
      return {
        accentColor: lightPalette.info.main,
        subtleTextColor: lightPalette.info.dark,
      };
    default:
      return {
        accentColor: lightPalette.text.secondary,
        subtleTextColor: lightPalette.text.secondary,
      };
  }
}

function getStateAccentColor(state?: ProjectState): string {
  if (state?.color) {
    return state.color;
  }

  return state ? categoryColors[state.category] ?? lightPalette.text.secondary : lightPalette.text.secondary;
}

function getMixedListItemTime(item: MixedListItem): number {
  return item.sortDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function getRitualTaskFocusIntent(task: Task): RitualFocusIntent {
  if ((task.evidenceProgress?.pendingReviewCount ?? 0) > 0) {
    return "review_pending";
  }

  if ((task.evidenceProgress?.rejectedCount ?? 0) > 0 || !(task.evidenceProgress?.allRequiredApproved ?? false)) {
    return "submit_requirement";
  }

  return "view_instance";
}

function buildRitualTaskHref(task: Task): string {
  return `/(app)/(tasks)/${task.projectId}/task/${task.id}?focusIntent=${getRitualTaskFocusIntent(task)}`;
}

function getRitualOpenActionLabel(task: Task): string {
  const focusIntent = getRitualTaskFocusIntent(task);

  if (focusIntent === "submit_requirement") {
    return "Open to send proof";
  }

  if (focusIntent === "review_pending") {
    return "Open proof";
  }

  return "Open run";
}

function triggerSelectionHaptic() {
  void Haptics.selectionAsync();
}

function StandardTaskRow({ item, today, nextWeek }: { item: StandardTaskItem; today: Date; nextWeek: Date }) {
  const timingLabel = getStandardTimingLabel(item.task, today, nextWeek);
  const tone = (() => {
    switch (getMixedBucket(item.task, today, nextWeek)) {
      case "overdue":
        return "danger" as const;
      case "today":
        return "warning" as const;
      case "upcoming":
        return "info" as const;
      default:
        return "neutral" as const;
    }
  })();
  const colors = getToneColors(tone);
  const actionLabel = "Open task";

  return (
    <Link
      href={withNavigationContext(`/(app)/(tasks)/${item.task.projectId}/task/${item.task.id}`, {
        fallbackHref: "/(app)/(tasks)",
        ownerTab: "tasks",
        backLabel: "Tasks",
      })}
      asChild
    >
      <Pressable testID={`project-task-row-${item.task.id}`} onPressIn={triggerSelectionHaptic} style={({ pressed }) => [styles.taskRow, pressed && styles.taskRowPressed]}>
        <View style={styles.taskContentWrap}>
          <View style={styles.taskHeaderRow}>
            <View style={styles.titleRow}>
              <SFIcon name="checklist" size={14} color={colors.accentColor} />
              <Text style={styles.taskTitle} numberOfLines={1}>{item.task.title}</Text>
            </View>
            <Text style={[styles.timingText, { color: colors.accentColor }]}>{timingLabel}</Text>
          </View>
          <View style={styles.taskMetaRow}>
            <Text style={[styles.taskMetaText, styles.taskMetaStrong, { color: getStateAccentColor(item.state) }]}>
              {item.state?.name ?? "Open"}
            </Text>
            <View style={styles.metaDot} />
            <Text style={styles.taskMetaText}>{item.task.identifier}</Text>
            {item.task.commentCount > 0 ? (
              <>
                <View style={styles.metaDot} />
                <SFIcon name="bubble.left" size={10} color={lightPalette.text.secondary} />
                <Text style={styles.taskMetaText}>{item.task.commentCount}</Text>
              </>
            ) : null}
          </View>
          <View style={styles.rowActionRow}>
            <SFIcon name="arrow.right.circle.fill" size={12} color={colors.accentColor} />
            <Text style={[styles.rowActionText, { color: colors.accentColor }]}>{actionLabel}</Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

function RitualTaskRow({ item }: { item: RitualSummaryItem }) {
  const colors = getToneColors(item.statusTone);
  const actionLabel = getRitualOpenActionLabel(item.activeTask);

  return (
    <Link
      href={withNavigationContext(buildRitualTaskHref(item.activeTask), {
        fallbackHref: "/(app)/(tasks)",
        ownerTab: "tasks",
        backLabel: "Tasks",
      })}
      asChild
    >
      <Pressable testID={`project-ritual-row-${item.activeTask.id}`} onPressIn={triggerSelectionHaptic} style={({ pressed }) => [styles.taskRow, pressed && styles.taskRowPressed]}>
        <View style={styles.taskContentWrap}>
          <View style={styles.taskHeaderRow}>
            <View style={styles.titleRow}>
              <SFIcon name="repeat.circle.fill" size={14} color={colors.accentColor} />
              <Text style={styles.taskTitle} numberOfLines={1}>{item.title}</Text>
            </View>
            <Text style={[styles.timingText, { color: colors.accentColor }]}>{item.timingLabel}</Text>
          </View>
          <View style={styles.taskMetaRow}>
            <Text style={styles.taskMetaText}>{item.recurrenceLabel}</Text>
            {item.evidenceLabel ? (
              <>
                <View style={styles.metaDot} />
                <SFIcon name="checklist" size={10} color={lightPalette.text.secondary} />
                <Text style={styles.taskMetaText}>{item.evidenceLabel}</Text>
              </>
            ) : null}
          </View>
          <View style={styles.ritualStatusRow}>
            <SFIcon name={getRitualStatusIconName(item.statusTone)} size={12} color={colors.accentColor} />
            <Text style={[styles.ritualStatusText, { color: colors.subtleTextColor }]}>{item.nextLabel}</Text>
          </View>
          <View style={styles.rowActionRow}>
            <SFIcon name="arrow.right.circle.fill" size={12} color={colors.accentColor} />
            <Text style={[styles.rowActionText, { color: colors.accentColor }]}>{actionLabel}</Text>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

export default function TaskListScreen() {
  const { projectId: rawProjectId } = useLocalSearchParams<{ projectId?: string | string[] }>();
  const router = useRouter();
  const auth = useAuth();
  const { resolvedProjectId, isResolvingProjectId } = useResolvedProjectId(rawProjectId);

  const { data: profileData } = useQuery({
    queryKey: ["profile", "project-share"],
    queryFn: () => getProfile(),
    enabled: auth.isAuthenticated,
    staleTime: 300_000,
  });

  const currentMembership = useMemo(
    () =>
      profileData?.organizations.find((org) => org.organizationId === auth.organizationId) ??
      profileData?.organizations[0],
    [auth.organizationId, profileData]
  );

  const handleShareProjectLink = useCallback(async () => {
    if (!currentMembership?.organizationSubdomain || !resolvedProjectId) return;
    const url = await generateCanonicalUrl(currentMembership.organizationSubdomain, "project", resolvedProjectId);
    if (url) {
      await Share.share({ message: url, url });
    }
  }, [currentMembership, resolvedProjectId]);

  const { data: statesData, refetch: refetchStates } = useQuery({
    queryKey: ["projectStates", resolvedProjectId],
    queryFn: () => listProjectStates(resolvedProjectId!),
    enabled: !!resolvedProjectId,
  });

  const { data: ritualDefinitions, refetch: refetchDefinitions } = useQuery({
    queryKey: ["ritualDefinitions", resolvedProjectId],
    queryFn: async () => {
      const result = await listRitualDefinitions(resolvedProjectId!);
      return result ?? [];
    },
    enabled: !!resolvedProjectId,
  });

  const { data: tasksData, isLoading, refetch } = useQuery({
    queryKey: ["tasks", resolvedProjectId],
    queryFn: async () => {
      const result = await listTasks({ projectId: resolvedProjectId!, rootOnly: false });
      return result.tasks ?? [];
    },
    enabled: !!resolvedProjectId,
  });

  const refreshTaskScreen = useCallback(async () => {
    await Promise.allSettled([refetch(), refetchStates(), refetchDefinitions()]);
  }, [refetch, refetchDefinitions, refetchStates]);
  const { isRefreshing, onRefresh } = useManualRefresh(refreshTaskScreen);
  const { isGhostLoading, runGhostLoad } = useGhostLoading(
    refreshTaskScreen,
    ghostLoadingTimings.screenMinimumMs,
  );

  useEffect(() => {
    if (!resolvedProjectId) {
      return;
    }

    void runGhostLoad();
  }, [resolvedProjectId, runGhostLoad]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const nextWeek = useMemo(() => startOfDay(addDays(new Date(), 7)), []);

  const sections = useMemo<MixedSection[]>(() => {
    const tasks = tasksData ?? [];
    const states = statesData?.states ?? [];
    const stateMap = new Map(states.map((state) => [state.id, state]));
    const buckets = new Map<MixedSectionKey, MixedListItem[]>();
    for (const section of sectionOrder) {
      buckets.set(section.key, []);
    }

    const standardItems = tasks
      .filter((task) => task.taskKind === "standard")
      .map((task) => ({ task, state: stateMap.get(task.stateId) }))
      .filter((item) => !item.state?.isClosed);

    for (const item of standardItems) {
      const bucket = getMixedBucket(item.task, today, nextWeek);
      buckets.get(bucket)?.push({
        kind: "standard",
        key: item.task.id,
        sortDate: getTaskScheduleDate(item.task),
        item,
      });
    }

    const definitionsMap = new Map((ritualDefinitions ?? []).map((definition) => [definition.id, definition]));
    const groupedRituals = new Map<string, Task[]>();

    for (const task of tasks.filter((task) => task.taskKind === "ritual_instance")) {
      const definitionId = task.ritualDefinitionId;
      if (!definitionId) {
        continue;
      }

      const list = groupedRituals.get(definitionId) ?? [];
      list.push(task);
      groupedRituals.set(definitionId, list);
    }

    for (const [definitionId, ritualTasks] of groupedRituals.entries()) {
      const sortedRitualTasks = [...ritualTasks].sort((left, right) => compareNullableDates(getTaskScheduleDate(left), getTaskScheduleDate(right)));
      const overdueTasks = sortedRitualTasks.filter((task) => {
        const state = stateMap.get(task.stateId);
        const date = getTaskScheduleDate(task);
        return !!date && startOfDay(date).getTime() < today.getTime() && !state?.isClosed;
      });
      const todayTasks = sortedRitualTasks.filter((task) => {
        const date = getTaskScheduleDate(task);
        return !!date && isSameDay(date, today);
      });
      const overdueTask = overdueTasks[0];
      const openTodayTask = todayTasks.find((task) => !stateMap.get(task.stateId)?.isClosed);
      const closedTodayTask = todayTasks.find((task) => stateMap.get(task.stateId)?.isClosed);
      const nextFutureTask = sortedRitualTasks.find((task) => {
        const date = getTaskScheduleDate(task);
        return !!date && startOfDay(date).getTime() > today.getTime();
      });
      const activeTask = overdueTask ?? openTodayTask ?? nextFutureTask ?? todayTasks[0] ?? sortedRitualTasks[0];
      const definition = definitionsMap.get(definitionId);
      if (!activeTask) {
        continue;
      }

      const summary: RitualSummaryItem = {
        key: definitionId,
        definition,
        title: definition?.name ?? activeTask.title,
        recurrenceLabel: formatRecurrenceLabel(definition),
        statusTone: getRitualStatusTone(overdueTasks.length, openTodayTask, closedTodayTask),
        bucket: getRitualBucket(overdueTask, openTodayTask, nextFutureTask, nextWeek),
        timingLabel: getRitualTimingLabel(overdueTasks.length, openTodayTask, nextFutureTask, today),
        nextLabel: buildRitualNextLabel(overdueTask, openTodayTask, nextFutureTask, closedTodayTask, today),
        evidenceLabel: getRitualEvidenceLabel(definition),
        activeTask,
        sortDate: overdueTask
          ? getTaskScheduleDate(overdueTask)
          : openTodayTask
            ? getTaskScheduleDate(openTodayTask)
            : nextFutureTask
              ? getTaskScheduleDate(nextFutureTask)
              : getTaskScheduleDate(activeTask),
      };

      buckets.get(summary.bucket)?.push({
        kind: "ritual",
        key: summary.key,
        sortDate: summary.sortDate,
        item: summary,
      });
    }

    return sectionOrder
      .map((section) => ({
        ...section,
        data: (buckets.get(section.key) ?? []).sort((left, right) => getMixedListItemTime(left) - getMixedListItemTime(right)),
      }))
      .filter((section) => section.data.length > 0);
  }, [nextWeek, ritualDefinitions, statesData, tasksData, today]);

  const hasAnyTasks = (tasksData?.length ?? 0) > 0;

  return (
    <>
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: "Tasks",
        }}
      />

      {isLoading || isGhostLoading || isResolvingProjectId ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.container}
          contentContainerStyle={styles.loadingScrollContent}
        >
          <SkeletonTaskList count={8} sectionCount={4} />
        </ScrollView>
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          {sections.length === 0 ? (
            hasAnyTasks ? (
              <EmptyState
                sfSymbol="checkmark.circle"
                title="No active tasks"
                subtitle="Completed and closed work is hidden in this mixed view."
              />
            ) : (
              <EmptyState
                sfSymbol="tray"
                title="No tasks in this project"
                subtitle="Create work or come back when this project has tasks."
              />
            )
          ) : (
            sections.map((section) => (
              <View key={section.key} style={styles.sectionBlock}>
                <View style={styles.sectionHeader} testID={`project-section-${section.key}`}>
                  <View>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
                  </View>
                  <Text style={styles.sectionCount}>{section.data.length}</Text>
                </View>
                <View style={styles.sectionCard}>
                  {section.data.map((entry, index) => (
                    <React.Fragment key={entry.key}>
                      {index > 0 && <View style={styles.cardSeparator} />}
                      {entry.kind === "standard" ? (
                        <StandardTaskRow item={entry.item} today={today} nextWeek={nextWeek} />
                      ) : (
                        <RitualTaskRow item={entry.item} />
                      )}
                    </React.Fragment>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon="plus"
        onPress={() => {
          if (!resolvedProjectId) {
            return;
          }

          router.push(`/(app)/(tasks)/${resolvedProjectId}/create`);
        }}
      />
      <Stack.Toolbar.Menu icon="ellipsis.circle">
        <Stack.Toolbar.MenuAction
          icon="square.and.arrow.up"
          onPress={() => { void handleShareProjectLink(); }}
        >
          Share Link
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
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
  loadingScrollContent: {
    flexGrow: 1,
    paddingBottom: mobileLayout.cardPadding,
  },
  headerBtn: {
    paddingHorizontal: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionBlock: {
    paddingTop: spacing[2],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: mobileLayout.screenPadding,
    paddingBottom: mobileLayout.itemGap,
  },
  sectionTitle: {
    fontSize: mobileTypography.sectionHeader.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  sectionSubtitle: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
    marginTop: 2,
  },
  sectionCount: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
    fontWeight: "600" as const,
  },
  sectionCard: {
    marginHorizontal: mobileLayout.screenPadding,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: lightPalette.background.paper,
    ...shadows.sm,
  },
  cardSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginHorizontal: mobileLayout.cardPadding,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: lightPalette.background.paper,
  },
  taskRowPressed: {
    backgroundColor: "#f7fafc",
  },
  taskContentWrap: {
    flex: 1,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: spacing[1.5],
    gap: spacing[0.5],
  },
  taskHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1.5],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    flex: 1,
  },
  taskTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.primary,
    flex: 1,
  },
  timingText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    flexShrink: 0,
  },
  taskMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing[0.5],
  },
  taskMetaText: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  taskMetaStrong: {
    fontWeight: "600" as const,
  },
  rowActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
    paddingTop: 2,
  },
  rowActionText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: lightPalette.text.disabled,
  },
  ritualStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
  },
  ritualStatusText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
  },
});
