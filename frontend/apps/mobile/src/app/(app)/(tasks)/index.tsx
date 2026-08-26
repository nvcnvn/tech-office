/**
 * Tasks tab
 *
 * Focus mode surfaces assigned work across projects.
 * Projects mode keeps the existing project-first drilldown.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Link, Stack, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project, ProjectState, RitualDefinition, Task, TaskAssignee } from "apis";
import { listProjects, listProjectStates, listRitualDefinitions, listTasks } from "apis";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { createTopLevelTabHeader } from "@/components/ui/header-title-with-stream-status";
import { SearchPill } from "@/components/ui/search-pill";
import { SFIcon } from "@/components/ui/sf-icon";
import { SkeletonList, SkeletonProjectList } from "@/components/ui/skeleton";
import { AuthContext } from "@/hooks/use-auth";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import { useStreamRecoveryRefresh } from "@/hooks/use-stream-recovery-refresh";
import { withNavigationContext } from "@/lib/mobile-navigation";
import { notificationStreamBehavior } from "@/lib/notification-stream-behavior";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
  statusColors,
  tabIcons,
} from "@tech-office/theme-tokens";

type TaskMode = "focus" | "projects";
type FocusFilter = "all" | "standard" | "ritual";

type FocusTaskItem = {
  project: Project;
  task: Task;
  state?: ProjectState;
  currentAssignee?: TaskAssignee;
};

type ProjectOverviewItem = {
  project: Project;
  openCount: number;
  overdueCount: number;
  todayCount: number;
};

type RitualDefinitionItem = {
  project: Project;
  definition: RitualDefinition;
};

type FocusQueryData = {
  standardItems: FocusTaskItem[];
  ritualItems: FocusTaskItem[];
  ritualDefinitions: RitualDefinitionItem[];
};

type RitualFocusItem = {
  key: string;
  project: Project;
  definition?: RitualDefinition;
  title: string;
  recurrenceLabel: string;
  statusLabel: string;
  statusTone: CardTone;
  bucket: FocusSectionKey;
  timingLabel: string;
  sortDate: Date | null;
  nextLabel: string;
  evidenceLabel?: string;
  activeTask?: FocusTaskItem;
  overdueCount: number;
};

type CardTone = "neutral" | "info" | "success" | "warning" | "danger";

type FocusSectionKey = "overdue" | "today" | "upcoming" | "no-date";

type FocusSection = {
  key: FocusSectionKey;
  title: string;
  subtitle: string;
  data: FocusListItem[];
};

type ProjectSection = {
  key: "active" | "quiet";
  title: string;
  subtitle: string;
  data: ProjectOverviewItem[];
};

type FocusListItem =
  | { kind: "standard"; key: string; sortDate: Date | null; item: FocusTaskItem }
  | { kind: "ritual"; key: string; sortDate: Date | null; item: RitualFocusItem };

type RitualFocusIntent = "view_instance" | "submit_requirement" | "review_pending";

const sectionOrder: Array<{ key: FocusSectionKey; title: string; subtitle: string }> = [
  { key: "overdue", title: "Overdue", subtitle: "Needs attention first" },
  { key: "today", title: "Today", subtitle: "Open the tasks that still need action today" },
  { key: "upcoming", title: "Upcoming", subtitle: "Next tasks and ritual runs coming up" },
  { key: "no-date", title: "No Date", subtitle: "Open tasks without a schedule yet" },
];

const taskScreenLayout = {
  /** Gap between top-level section blocks. */
  sectionGap: spacing[2], // 16
  /** Gap between section header and its card group. */
  sectionHeaderGap: mobileLayout.itemGap, // 8
  /** Outer card group radius. */
  cardRadius: radius.md, // 12
  /** Pill / chip radius. */
  controlRadius: radius.xl, // 24
  /** Vertical padding inside a task row. */
  rowVerticalPadding: spacing[1.5], // 12
  /** Vertical gap between content lines inside a card. */
  contentGap: spacing[0.5], // 4
  /** Gap between meta items on the same line. */
  metaGap: mobileLayout.itemGap, // 8
  /** Summary card vertical padding. */
  summaryVerticalPadding: spacing[1.5], // 12
  /** Gap inside summary card. */
  summaryInnerGap: spacing[0.5], // 4
} as const;

const focusRefreshMaxAgeMs = 60 * 1000;

function shouldRefreshOnFocus(
  queryState:
    | {
      data: unknown;
      dataUpdatedAt: number;
      fetchStatus: string;
      isInvalidated: boolean;
    }
    | undefined,
) {
  if (!queryState) {
    return true;
  }

  if (queryState.fetchStatus === "fetching") {
    return false;
  }

  if (queryState.data === undefined || queryState.isInvalidated) {
    return true;
  }

  return Date.now() - queryState.dataUpdatedAt > focusRefreshMaxAgeMs;
}

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

function formatShortDate(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function compareNullableDates(left: Date | null, right: Date | null): number {
  const leftTime = left?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const rightTime = right?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
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

  const todayMs = today.getTime();
  const valueMs = startOfDay(value).getTime();
  const dayDiff = Math.round((valueMs - todayMs) / 86400000);

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

function getTaskDeadlineDate(task: Task): Date | null {
  if (task.taskKind === "ritual_instance") {
    return parseDateTime(task.scheduledDate) ?? parseDateTime(task.updatedAt);
  }

  return parseDateOnly(task.dueDate);
}

function getFocusBucket(item: FocusTaskItem, today: Date, nextWeek: Date): FocusSectionKey {
  const taskDate = getTaskScheduleDate(item.task);
  const assignmentDate = parseDateTime(item.currentAssignee?.assignedAt);
  const taskDay = taskDate ? startOfDay(taskDate) : null;

  if (taskDay && taskDay.getTime() < today.getTime()) {
    return "overdue";
  }

  if ((taskDay && taskDay.getTime() === today.getTime()) || (assignmentDate && isSameDay(assignmentDate, today))) {
    return "today";
  }

  if (taskDay && taskDay.getTime() <= nextWeek.getTime()) {
    return "upcoming";
  }

  return "no-date";
}

function getTaskTone(item: FocusTaskItem, today: Date, nextWeek: Date): CardTone {
  switch (getFocusBucket(item, today, nextWeek)) {
    case "overdue":
      return "danger";
    case "today":
      return "warning";
    case "upcoming":
      return "info";
    default:
      return "neutral";
  }
}

function getStandardTaskTimingLabel(item: FocusTaskItem, today: Date, nextWeek: Date): string {
  const scheduleDate = getTaskScheduleDate(item.task);

  switch (getFocusBucket(item, today, nextWeek)) {
    case "overdue":
      return scheduleDate ? `Late ${formatShortDate(scheduleDate)}` : "Overdue";
    case "today":
      return item.task.taskKind === "ritual_instance" ? "Today" : "Due today";
    case "upcoming":
      return scheduleDate ? formatRelativeDateLabel(scheduleDate, today) : "Upcoming";
    default:
      return "No date";
  }
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

function getRitualStatusTone(
  overdueCount: number,
  openTodayItem: FocusTaskItem | undefined,
  closedTodayItem: FocusTaskItem | undefined,
): CardTone {
  if (overdueCount > 0) {
    return "danger";
  }

  if (openTodayItem) {
    return "warning";
  }

  if (closedTodayItem) {
    return "success";
  }

  return "info";
}

function buildRitualStatusLabel(
  overdueCount: number,
  openTodayItem: FocusTaskItem | undefined,
  closedTodayItem: FocusTaskItem | undefined,
  nextFutureItem: FocusTaskItem | undefined,
  today: Date,
): string {
  if (overdueCount > 0) {
    if (openTodayItem) {
      return overdueCount === 1 ? "Today + 1 late" : `Today + ${overdueCount} late`;
    }

    return overdueCount === 1 ? "1 run late" : `${overdueCount} runs late`;
  }

  if (openTodayItem) {
    return "Today";
  }

  if (closedTodayItem) {
    return "Done";
  }

  if (nextFutureItem) {
    return `Next ${formatRelativeDateLabel(getTaskScheduleDate(nextFutureItem.task), today)}`;
  }

  return "Waiting";
}

function buildRitualNextLabel(
  overdueItem: FocusTaskItem | undefined,
  openTodayItem: FocusTaskItem | undefined,
  nextFutureItem: FocusTaskItem | undefined,
  closedTodayItem: FocusTaskItem | undefined,
  today: Date,
): string {
  if (overdueItem) {
    if (openTodayItem) {
      return `Missed ${formatCalendarDate(getTaskScheduleDate(overdueItem.task))}. Today's run is also due`;
    }

    return `Missed ${formatCalendarDate(getTaskScheduleDate(overdueItem.task))}. Do it now`;
  }

  if (openTodayItem) {
    return "Due today";
  }

  if (closedTodayItem && nextFutureItem) {
    return `Done today. Next ${formatRelativeDateLabel(getTaskScheduleDate(nextFutureItem.task), today)}`;
  }

  if (nextFutureItem) {
    return `Due ${formatRelativeDateLabel(getTaskScheduleDate(nextFutureItem.task), today)}`;
  }

  if (closedTodayItem) {
    return "Completed today";
  }

  return "Awaiting next run";
}

function getRitualEvidenceLabel(definition?: RitualDefinition): string | undefined {
  const requiredCount = definition?.evidenceRequirements.filter((requirement) => requirement.isRequired).length ?? 0;
  if (requiredCount === 0) {
    return undefined;
  }

  return requiredCount === 1 ? "1 proof" : `${requiredCount} proofs`;
}

function getRitualBucket(
  overdueItem: FocusTaskItem | undefined,
  openTodayItem: FocusTaskItem | undefined,
  nextFutureItem: FocusTaskItem | undefined,
  nextWeek: Date,
): FocusSectionKey {
  if (overdueItem) {
    return "overdue";
  }

  if (openTodayItem) {
    return "today";
  }

  const nextDate = nextFutureItem ? getTaskScheduleDate(nextFutureItem.task) : null;
  if (nextDate && startOfDay(nextDate).getTime() <= nextWeek.getTime()) {
    return "upcoming";
  }

  return "no-date";
}

function getRitualTimingLabel(
  overdueCount: number,
  openTodayItem: FocusTaskItem | undefined,
  nextFutureItem: FocusTaskItem | undefined,
  today: Date,
): string {
  if (overdueCount > 0) {
    if (openTodayItem) {
      return overdueCount === 1 ? "Today + 1 late" : `Today + ${overdueCount} late`;
    }

    return overdueCount === 1 ? "1 late" : `${overdueCount} late`;
  }

  if (openTodayItem) {
    return "Today";
  }

  if (nextFutureItem) {
    return formatRelativeDateLabel(getTaskScheduleDate(nextFutureItem.task), today);
  }

  return "Waiting";
}

function getFocusListItemTime(item: FocusListItem): number {
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

function buildRitualTaskHref(projectId: string, task: Task): string {
  return `/(app)/(tasks)/${projectId}/task/${task.id}?focusIntent=${getRitualTaskFocusIntent(task)}`;
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

function getCardColors(tone: CardTone): {
  backgroundColor: string;
  borderColor: string;
  iconBackgroundColor: string;
  iconColor: string;
  pillBackgroundColor: string;
  pillTextColor: string;
  accentColor: string;
} {
  switch (tone) {
    case "danger":
      return {
        backgroundColor: statusColors.error.light.bg,
        borderColor: statusColors.error.light.border,
        iconBackgroundColor: `${lightPalette.error.main}18`,
        iconColor: lightPalette.error.main,
        pillBackgroundColor: `${lightPalette.error.main}18`,
        pillTextColor: statusColors.error.light.text,
        accentColor: lightPalette.error.main,
      };
    case "warning":
      return {
        backgroundColor: statusColors.warning.light.bg,
        borderColor: statusColors.warning.light.border,
        iconBackgroundColor: `${lightPalette.warning.main}18`,
        iconColor: lightPalette.warning.dark,
        pillBackgroundColor: `${lightPalette.warning.main}18`,
        pillTextColor: statusColors.warning.light.text,
        accentColor: lightPalette.warning.main,
      };
    case "success":
      return {
        backgroundColor: statusColors.success.light.bg,
        borderColor: statusColors.success.light.border,
        iconBackgroundColor: `${lightPalette.success.main}18`,
        iconColor: lightPalette.success.dark,
        pillBackgroundColor: `${lightPalette.success.main}18`,
        pillTextColor: statusColors.success.light.text,
        accentColor: lightPalette.success.main,
      };
    case "info":
      return {
        backgroundColor: `${lightPalette.info.main}0d`,
        borderColor: `${lightPalette.info.main}24`,
        iconBackgroundColor: `${lightPalette.info.main}16`,
        iconColor: lightPalette.info.dark,
        pillBackgroundColor: `${lightPalette.info.main}16`,
        pillTextColor: lightPalette.info.dark,
        accentColor: lightPalette.info.main,
      };
    default:
      return {
        backgroundColor: lightPalette.background.paper,
        borderColor: lightPalette.divider,
        iconBackgroundColor: "#eef2f6",
        iconColor: lightPalette.text.secondary,
        pillBackgroundColor: "#eef2f6",
        pillTextColor: lightPalette.text.secondary,
        accentColor: lightPalette.text.secondary,
      };
  }
}

/**
 * Mode switch lives in the header, not the body.
 *
 * "Projects" is project-management vocabulary that the people this app is for
 * do not use; leading the screen with it made the first thing they read a word
 * they had to decode. The tab now opens straight into their own work, and the
 * project-first drilldown stays one tap away for whoever runs the projects.
 */
function taskModeHeaderAction(mode: TaskMode, onChange: (value: TaskMode) => void) {
  const goingToProjects = mode === "focus";
  return {
    key: "task-mode",
    testID: "task-mode-toggle",
    accessibilityLabel: goingToProjects ? "Show projects" : "Show my work",
    onPress: () => onChange(goingToProjects ? "projects" : "focus"),
    icon: (
      <SFIcon
        name={goingToProjects ? "folder" : "checkmark.square.fill"}
        size={22}
        color={lightPalette.primary.main}
      />
    ),
  };
}

function FocusFilterRow({
  value,
  onChange,
}: {
  value: FocusFilter;
  onChange: (filter: FocusFilter) => void;
}) {
  return (
    <View style={styles.focusFilterRow}>
      {([
        ["all", "All tasks"],
        ["standard", "Standard tasks"],
        ["ritual", "Ritual runs"],
      ] as const).map(([filterValue, label]) => (
        <Pressable
          key={filterValue}
          onPress={() => onChange(filterValue)}
          style={[
            styles.filterChip,
            value === filterValue && styles.filterChipActive,
          ]}
        >
          <Text
            style={[
              styles.filterChipText,
              value === filterValue && styles.filterChipTextActive,
            ]}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function TasksOverviewCard({
  mode,
  totalItems,
  primaryCount,
  primaryLabel,
  secondaryCount,
  secondaryLabel,
}: {
  mode: TaskMode;
  totalItems: number;
  primaryCount: number;
  primaryLabel: string;
  secondaryCount: number;
  secondaryLabel: string;
}) {
  return (
    <Card style={styles.summaryCard}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryIconWrap}>
          <SFIcon
            name={mode === "focus" ? "checkmark.square.fill" : "folder.fill"}
            size={18}
            color={lightPalette.primary.main}
          />
        </View>
        <View style={styles.summaryCopy}>
          <Text selectable style={styles.summaryTitle}>
            {mode === "focus" ? "Task-First Queue" : "Project Overview"}
          </Text>
          <Text selectable style={styles.summarySubtitle}>
            {mode === "focus"
              ? "Start with the live task that needs action now, then move through the rest of your queue."
              : "Track which projects need follow-up before drilling into details."}
          </Text>
        </View>
      </View>

      <View style={styles.summaryStatsRow}>
        <View style={styles.summaryStatBlock}>
          <Text style={styles.summaryStatValue}>{totalItems}</Text>
          <Text style={styles.summaryStatLabel}>{mode === "focus" ? "Visible tasks" : "Visible projects"}</Text>
        </View>
        <View style={styles.summaryStatDivider} />
        <View style={styles.summaryStatBlock}>
          <Text style={styles.summaryStatValue}>{primaryCount}</Text>
          <Text style={styles.summaryStatLabel}>{primaryLabel}</Text>
        </View>
        <View style={styles.summaryStatDivider} />
        <View style={styles.summaryStatBlock}>
          <Text style={styles.summaryStatValue}>{secondaryCount}</Text>
          <Text style={styles.summaryStatLabel}>{secondaryLabel}</Text>
        </View>
      </View>
    </Card>
  );
}

function ProjectRow({ item }: { item: ProjectOverviewItem }) {
  const memberLabel = item.project.memberCount === 1 ? "1 member" : `${item.project.memberCount} members`;
  const openTaskLabel = item.openCount === 1 ? "1 open task" : `${item.openCount} open tasks`;
  const todayLabel = item.todayCount === 1 ? "1 due today" : `${item.todayCount} due today`;
  const overdueLabel = item.overdueCount === 1 ? "1 overdue" : `${item.overdueCount} overdue`;
  const attentionLabel = item.overdueCount > 0
    ? overdueLabel
    : item.todayCount > 0
      ? todayLabel
      : item.openCount > 0
        ? openTaskLabel
        : "Quiet";

  return (
    <Link
      href={withNavigationContext(`/(app)/(tasks)/${item.project.id}`, {
        fallbackHref: "/(app)/(tasks)",
        ownerTab: "tasks",
        backLabel: "Tasks",
      })}
      asChild
    >
      <Pressable
        onPressIn={triggerSelectionHaptic}
        style={({ pressed }) => [styles.projectRow, pressed && styles.projectRowPressed]}
      >
        <View style={styles.projectRowBody}>
          <View style={styles.projectRowHeader}>
            <Text style={styles.projectName} numberOfLines={1}>
              {item.project.name}
            </Text>
            <Text
              style={[
                styles.projectMetric,
                item.overdueCount > 0
                  ? styles.projectMetricDanger
                  : item.todayCount > 0 || item.openCount > 0
                    ? styles.projectMetricActive
                    : null,
              ]}
            >
              {attentionLabel}
            </Text>
          </View>
          <View style={styles.projectMetaRow}>
            {item.project.key ? <Text style={[styles.taskMetaText, styles.taskMetaStrong]}>{item.project.key}</Text> : null}
            {item.project.key ? <View style={styles.metaDot} /> : null}
            <Text style={styles.taskMetaText}>{memberLabel}</Text>
            {item.openCount > 0 ? (
              <>
                <View style={styles.metaDot} />
                <Text style={styles.taskMetaText}>{openTaskLabel}</Text>
              </>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

function FocusTaskRow({ item, today }: { item: FocusTaskItem; today: Date }) {
  const stateLabel = item.state?.name ?? "Open";
  const cardTone = getTaskTone(item, today, addDays(today, 7));
  const colors = getCardColors(cardTone);
  const iconName = item.task.taskKind === "ritual_instance" ? "repeat.circle.fill" : "checklist";
  const timingLabel = getStandardTaskTimingLabel(item, today, addDays(today, 7));
  const actionLabel = item.task.taskKind === "ritual_instance"
    ? getRitualOpenActionLabel(item.task)
    : "Open task";

  return (
    <Link
      href={withNavigationContext(`/(app)/(tasks)/${item.project.id}/task/${item.task.id}`, {
        fallbackHref: "/(app)/(tasks)",
        ownerTab: "tasks",
        backLabel: "Tasks",
      })}
      asChild
    >
      <Pressable
        testID={`focus-task-row-${item.task.id}`}
        onPressIn={triggerSelectionHaptic}
        style={({ pressed }) => [
          styles.taskRow,
          pressed && styles.taskRowPressed,
        ]}
      >
        <View style={styles.taskContentWrap}>
          <View style={styles.taskHeaderRow}>
            <View style={styles.titleRow}>
              <SFIcon name={iconName} size={14} color={colors.accentColor} />
              <Text style={styles.taskTitle} numberOfLines={1}>
                {item.task.title}
              </Text>
            </View>
            <Text style={[styles.timingText, { color: colors.accentColor }]}>
              {timingLabel}
            </Text>
          </View>
          <View style={styles.taskMetaRow}>
              <Text style={[styles.taskMetaText, styles.taskMetaStrong]}>{stateLabel}</Text>
            <View style={styles.metaDot} />
            <Text style={styles.taskMetaText} numberOfLines={1}>{item.project.name}</Text>
            <View style={styles.metaDot} />
            <Text style={styles.taskMetaText}>{item.task.identifier}</Text>
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

function RitualFocusRow({ item }: { item: RitualFocusItem }) {
  const href = item.activeTask
    ? buildRitualTaskHref(item.project.id, item.activeTask.task)
    : `/(app)/(tasks)/${item.project.id}`;
  const colors = getCardColors(item.statusTone);
  const actionLabel = item.activeTask ? getRitualOpenActionLabel(item.activeTask.task) : "Open run";

  return (
    <Link href={href} asChild>
      <Pressable
        testID={item.activeTask ? `ritual-focus-row-${item.activeTask.task.id}` : `ritual-focus-row-${item.key}`}
        onPressIn={triggerSelectionHaptic}
        style={({ pressed }) => [
          styles.taskRow,
          pressed && styles.taskRowPressed,
        ]}
      >
        <View style={styles.taskContentWrap}>
          <View style={styles.taskHeaderRow}>
            <View style={styles.titleRow}>
              <SFIcon name="repeat.circle.fill" size={14} color={colors.accentColor} />
              <Text style={styles.taskTitle} numberOfLines={1}>
                {item.title}
              </Text>
            </View>
            <Text style={[styles.timingText, { color: colors.accentColor }]}>
                {item.timingLabel}
            </Text>
          </View>
          <View style={styles.taskMetaRow}>
            <Text style={styles.taskMetaText}>{item.project.name}</Text>
            <View style={styles.metaDot} />
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
            <Text style={[styles.ritualStatusText, { color: colors.accentColor }]}>
              {item.nextLabel}
            </Text>
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

export default function TasksScreen() {
  const auth = React.use(AuthContext);
  const hasLoadedRef = useRef(false);
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<TaskMode>("focus");
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");
  const employeeId = auth?.employeeId ?? undefined;

  const {
    data: projects,
    isLoading: isProjectsLoading,
    error: projectsError,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const result = await listProjects();
      return result.projects ?? [];
    },
  });

  const projectIdSignature = useMemo(
    () => (projects ?? []).map((project) => project.id).join(","),
    [projects],
  );
  const {
    data: projectOverviewItems,
    isLoading: isProjectOverviewLoading,
    error: projectOverviewError,
    refetch: refetchProjectOverview,
  } = useQuery({
    queryKey: ["tasks-project-overview", projectIdSignature],
    enabled: mode === "projects" && (projects?.length ?? 0) > 0,
    queryFn: async () => {
      const snapshotToday = startOfDay(new Date());
      const snapshots = await Promise.all(
        (projects ?? []).map(async (project) => {
          const [statesResult, tasksResult] = await Promise.all([
            listProjectStates(project.id),
            listTasks({ projectId: project.id, limit: 100 }),
          ]);

          const stateMap = new Map(statesResult.states.map((state) => [state.id, state]));
          const openTasks = (tasksResult.tasks ?? []).filter((task) => !stateMap.get(task.stateId)?.isClosed);
          const overdueCount = openTasks.filter((task) => {
            const date = getTaskScheduleDate(task);
            return !!date && startOfDay(date).getTime() < snapshotToday.getTime();
          }).length;
          const todayCount = openTasks.filter((task) => {
            const date = getTaskScheduleDate(task);
            return !!date && isSameDay(date, snapshotToday);
          }).length;

          return {
            project,
            openCount: openTasks.length,
            overdueCount,
            todayCount,
          } satisfies ProjectOverviewItem;
        }),
      );

      return snapshots.sort((left, right) => {
        if (left.overdueCount !== right.overdueCount) {
          return right.overdueCount - left.overdueCount;
        }

        if (left.todayCount !== right.todayCount) {
          return right.todayCount - left.todayCount;
        }

        if (left.openCount !== right.openCount) {
          return right.openCount - left.openCount;
        }

        return left.project.name.localeCompare(right.project.name);
      });
    },
  });

  const {
    data: focusData,
    isLoading: isFocusLoading,
    error: focusError,
    refetch: refetchFocus,
  } = useQuery({
    queryKey: ["tasks-focus", employeeId, projectIdSignature],
    enabled: mode === "focus" && !!employeeId && (projects?.length ?? 0) > 0,
    queryFn: async () => {
      const snapshots = await Promise.all(
        (projects ?? []).map(async (project) => {
          // One ListTasks per project, partitioned client-side by task_kind.
          // Two filtered calls returned the same rows split in two and doubled
          // the request count on a screen that already fans out per project.
          const [statesResult, assignedResult, ritualDefinitions] = await Promise.all([
            listProjectStates(project.id),
            listTasks({
              projectId: project.id,
              assigneeEmployeeId: employeeId,
              limit: 200,
            }),
            listRitualDefinitions(project.id),
          ]);

          const assignedTasks = assignedResult.tasks ?? [];
          const standardResult = {
            tasks: assignedTasks.filter((task) => task.taskKind === "standard"),
          };
          const ritualResult = {
            tasks: assignedTasks.filter((task) => task.taskKind === "ritual_instance"),
          };

          const stateMap = new Map(statesResult.states.map((state) => [state.id, state]));

          const toFocusTaskItem = (task: Task): FocusTaskItem => ({
            project,
            task,
            state: stateMap.get(task.stateId),
            currentAssignee: task.assignees.find((assignee) => assignee.employeeId === employeeId),
          });

          const standardItems = standardResult.tasks
            .map((task) => {
              if (task.taskKind !== "standard") {
                return null;
              }

              const item = toFocusTaskItem(task);
              if (item.state?.isClosed) {
                return null;
              }

              return item;
            })
            .filter((item): item is FocusTaskItem => item !== null);

          const ritualItems = ritualResult.tasks.map(toFocusTaskItem);

          return {
            standardItems,
            ritualItems,
            ritualDefinitions: ritualDefinitions.map((definition) => ({ project, definition })),
          } satisfies FocusQueryData;
        }),
      );

      const standardItems = snapshots
        .flatMap((snapshot) => snapshot.standardItems)
        .sort((left, right) => {
        const leftDate = getTaskDeadlineDate(left.task)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const rightDate = getTaskDeadlineDate(right.task)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (leftDate !== rightDate) {
          return leftDate - rightDate;
        }

        return right.task.updatedAt.getTime() - left.task.updatedAt.getTime();
      });

      return {
        standardItems,
        ritualItems: snapshots.flatMap((snapshot) => snapshot.ritualItems),
        ritualDefinitions: snapshots.flatMap((snapshot) => snapshot.ritualDefinitions),
      } satisfies FocusQueryData;
    },
  });

  const refreshCurrentMode = useCallback(async () => {
    if (mode === "focus" && employeeId) {
      await Promise.allSettled([refetchProjects(), refetchFocus()]);
      return;
    }

    if (mode === "projects") {
      await Promise.allSettled([refetchProjects(), refetchProjectOverview()]);
      return;
    }

    await refetchProjects();
  }, [employeeId, mode, refetchFocus, refetchProjectOverview, refetchProjects]);

  const { isRefreshing, onRefresh } = useManualRefresh(refreshCurrentMode);

  useStreamRecoveryRefresh(refreshCurrentMode, {
    intervalMs: notificationStreamBehavior.fallbackPollMs.tasks,
  });

  useEffect(() => {
    const focusReady = mode !== "focus" || !employeeId || !isFocusLoading;
    if (!isProjectsLoading && focusReady) {
      hasLoadedRef.current = true;
    }
  }, [employeeId, isFocusLoading, isProjectsLoading, mode]);

  useFocusEffect(
    useCallback(() => {
      if (!hasLoadedRef.current) {
        return;
      }

      const projectsNeedRefresh = shouldRefreshOnFocus(
        queryClient.getQueryState(["projects"]),
      );
      const modeNeedsRefresh = mode === "focus"
        ? !!employeeId && shouldRefreshOnFocus(
          queryClient.getQueryState(["tasks-focus", employeeId, projectIdSignature]),
        )
        : shouldRefreshOnFocus(
          queryClient.getQueryState(["tasks-project-overview", projectIdSignature]),
        );

      if (projectsNeedRefresh || modeNeedsRefresh) {
        void refreshCurrentMode();
      }
    }, [employeeId, mode, projectIdSignature, queryClient, refreshCurrentMode]),
  );

  const today = useMemo(() => startOfDay(new Date()), []);
  const nextWeek = useMemo(() => startOfDay(addDays(new Date(), 7)), []);

  const standardFocusItems = useMemo(() => focusData?.standardItems ?? [], [focusData]);
  const projectSections = useMemo<ProjectSection[]>(() => {
    const activeProjects = (projectOverviewItems ?? []).filter((project) => project.openCount > 0);
    const quietProjects = (projectOverviewItems ?? []).filter((project) => project.openCount === 0);

    const sections: ProjectSection[] = [
      {
        key: "active",
        title: "Needs attention",
        subtitle: "Projects with overdue, due today, or open work.",
        data: activeProjects,
      },
      {
        key: "quiet",
        title: "No open work",
        subtitle: "Projects without current open tasks.",
        data: quietProjects,
      },
    ];

    return sections.filter((section) => section.data.length > 0);
  }, [projectOverviewItems]);

  const ritualFocusItems = useMemo<RitualFocusItem[]>(() => {
    const ritualItems = focusData?.ritualItems ?? [];
    const definitionMap = new Map(
      (focusData?.ritualDefinitions ?? []).map((item) => [item.definition.id, item]),
    );
    const grouped = new Map<string, FocusTaskItem[]>();

    for (const item of ritualItems) {
      const definitionId = item.task.ritualDefinitionId;
      if (!definitionId) {
        continue;
      }

      const group = grouped.get(definitionId) ?? [];
      group.push(item);
      grouped.set(definitionId, group);
    }

    return Array.from(grouped.entries())
      .map(([definitionId, items]) => {
        const sortedItems = [...items].sort((left, right) => compareNullableDates(getTaskScheduleDate(left.task), getTaskScheduleDate(right.task)));
        const overdueItems = sortedItems.filter((item) => {
          const date = getTaskScheduleDate(item.task);
          return !!date && startOfDay(date).getTime() < today.getTime() && !item.state?.isClosed;
        });
        const todayItems = sortedItems.filter((item) => {
          const date = getTaskScheduleDate(item.task);
          return !!date && isSameDay(date, today);
        });
        const overdueItem = overdueItems[0];
        const openTodayItem = todayItems.find((item) => !item.state?.isClosed);
        const closedTodayItem = todayItems.find((item) => item.state?.isClosed);
        const nextFutureItem = sortedItems.find((item) => {
          const date = getTaskScheduleDate(item.task);
          return !!date && startOfDay(date).getTime() > today.getTime();
        });
        const activeTask = overdueItem ?? openTodayItem ?? nextFutureItem ?? todayItems[0] ?? sortedItems[0];
        const definitionItem = definitionMap.get(definitionId);
        const bucket = getRitualBucket(overdueItem, openTodayItem, nextFutureItem, nextWeek);
        const sortDate = overdueItem
          ? getTaskScheduleDate(overdueItem.task)
          : openTodayItem
            ? getTaskScheduleDate(openTodayItem.task)
            : nextFutureItem
              ? getTaskScheduleDate(nextFutureItem.task)
              : getTaskScheduleDate(activeTask.task);

        return {
          key: definitionId,
          project: definitionItem?.project ?? activeTask?.project ?? items[0].project,
          definition: definitionItem?.definition,
          title: definitionItem?.definition.name ?? activeTask?.task.title ?? "Ritual",
          recurrenceLabel: formatRecurrenceLabel(definitionItem?.definition),
          statusLabel: buildRitualStatusLabel(overdueItems.length, openTodayItem, closedTodayItem, nextFutureItem, today),
          statusTone: getRitualStatusTone(overdueItems.length, openTodayItem, closedTodayItem),
          bucket,
          timingLabel: getRitualTimingLabel(overdueItems.length, openTodayItem, nextFutureItem, today),
          sortDate,
          nextLabel: buildRitualNextLabel(overdueItem, openTodayItem, nextFutureItem, closedTodayItem, today),
          evidenceLabel: getRitualEvidenceLabel(definitionItem?.definition),
          activeTask,
          overdueCount: overdueItems.length,
        } satisfies RitualFocusItem;
      })
      .sort((left, right) => {
        if (left.overdueCount !== right.overdueCount) {
          return right.overdueCount - left.overdueCount;
        }

        return left.title.localeCompare(right.title);
      });
  }, [focusData, nextWeek, today]);

  const visibleTaskSections = useMemo<FocusSection[]>(() => {
    const buckets = new Map<FocusSectionKey, FocusListItem[]>();
    for (const section of sectionOrder) {
      buckets.set(section.key, []);
    }

    if (focusFilter !== "ritual") {
      for (const item of standardFocusItems) {
        const key = getFocusBucket(item, today, nextWeek);
        buckets.get(key)?.push({
          kind: "standard",
          key: item.task.id,
          sortDate: getTaskScheduleDate(item.task),
          item,
        });
      }
    }

    if (focusFilter !== "standard") {
      for (const item of ritualFocusItems) {
        buckets.get(item.bucket)?.push({
          kind: "ritual",
          key: item.key,
          sortDate: item.sortDate,
          item,
        });
      }
    }

    return sectionOrder
      .map((section) => ({
        ...section,
        data: (buckets.get(section.key) ?? []).sort((left, right) => getFocusListItemTime(left) - getFocusListItemTime(right)),
      }))
      .filter((section) => section.data.length > 0);
  }, [focusFilter, nextWeek, ritualFocusItems, standardFocusItems, today]);

  const isLoading = isProjectsLoading || (mode === "focus" && employeeId != null && isFocusLoading) || (mode === "projects" && isProjectOverviewLoading);
  const activeError = mode === "focus" ? projectsError ?? focusError : projectsError ?? projectOverviewError;
  const overdueVisibleCount = visibleTaskSections.find((section) => section.key === "overdue")?.data.length ?? 0;
  const todayVisibleCount = visibleTaskSections.find((section) => section.key === "today")?.data.length ?? 0;
  const projectAttentionCount = (projectOverviewItems ?? []).filter(
    (item) => item.overdueCount > 0 || item.todayCount > 0,
  ).length;
  const quietProjectCount = (projectOverviewItems ?? []).filter(
    (item) => item.overdueCount === 0 && item.todayCount === 0,
  ).length;

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={createTopLevelTabHeader(
          mode === "focus" ? tabIcons.tasks.label : "Projects",
          [taskModeHeaderAction(mode, setMode)],
        )} />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.container}
          contentContainerStyle={styles.loadingScrollContent}
        >
          <SearchPill placeholder="Search tasks, projects…" />
          {mode === "projects" ? (
            <SkeletonProjectList count={6} showSearchPlaceholder={false} />
          ) : (
            <View style={styles.focusLoadingWrap}>
              <FocusFilterRow value={focusFilter} onChange={setFocusFilter} />
              <SkeletonList count={7} />
            </View>
          )}
        </ScrollView>
      </>
    );
  }

  if (activeError) {
    return (
      <View style={styles.center}>
        <Text selectable style={styles.errorText}>Failed to load tasks</Text>
        <Button label="Retry" onPress={() => void refreshCurrentMode()} />
      </View>
    );
  }

  if (mode === "projects") {
    return (
      <>
        <Stack.Screen options={createTopLevelTabHeader(
          "Projects",
          [taskModeHeaderAction(mode, setMode)],
        )} />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.container}
          contentContainerStyle={styles.focusScrollContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        >
          <SearchPill placeholder="Search tasks, projects…" />
          <TasksOverviewCard
            mode={mode}
            totalItems={projectOverviewItems?.length ?? 0}
            primaryCount={projectAttentionCount}
            primaryLabel="Need attention"
            secondaryCount={quietProjectCount}
            secondaryLabel="Quiet"
          />

          {(projectOverviewItems?.length ?? 0) === 0 ? (
            <EmptyState
              sfSymbol="square.stack.3d.up"
              title="No projects"
              subtitle="You do not have assigned work in any project yet."
            />
          ) : (
            projectSections.map((section) => (
              <View key={section.key} style={styles.sectionBlock}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
                  </View>
                  <Text style={styles.sectionCount}>{section.data.length}</Text>
                </View>
                <View style={styles.sectionCard}>
                  {section.data.map((item, index) => (
                    <React.Fragment key={item.project.id}>
                      {index > 0 && <View style={styles.cardSeparator} />}
                      <ProjectRow item={item} />
                    </React.Fragment>
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={createTopLevelTabHeader(
        tabIcons.tasks.label,
        [taskModeHeaderAction(mode, setMode)],
      )} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
        contentContainerStyle={styles.focusScrollContent}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
      >
        <SearchPill placeholder="Search tasks, projects…" />
        <TasksOverviewCard
          mode={mode}
          totalItems={visibleTaskSections.reduce((sum, section) => sum + section.data.length, 0)}
          primaryCount={overdueVisibleCount}
          primaryLabel="Overdue"
          secondaryCount={todayVisibleCount}
          secondaryLabel="Today"
        />
        <FocusFilterRow value={focusFilter} onChange={setFocusFilter} />

        {visibleTaskSections.length === 0 ? (
          <EmptyState
            sfSymbol="checkmark.circle"
            title="Nothing to work right now"
            subtitle="Assigned tasks and live ritual runs will show here once they need your attention."
          />
        ) : (
          <>
            {visibleTaskSections.map((section) => (
              <View key={section.key} style={styles.sectionBlock}>
                <View style={styles.sectionHeader} testID={`focus-section-${section.key}`}>
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
                        <FocusTaskRow item={entry.item} today={today} />
                      ) : (
                        <RitualFocusRow item={entry.item} />
                      )}
                    </React.Fragment>
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  loadingScrollContent: {
    flexGrow: 1,
    paddingBottom: mobileLayout.itemGap,
  },
  focusScrollContent: {
    paddingBottom: mobileLayout.cardPadding * 2,
  },
  summaryCard: {
    marginHorizontal: mobileLayout.screenPadding,
    marginTop: spacing[1],
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: mobileLayout.iconTextGap,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef5fc",
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
  summaryTitle: {
    fontSize: mobileTypography.sectionHeader.fontSize as number,
    lineHeight: mobileTypography.sectionHeader.lineHeight as number,
    fontWeight: mobileTypography.sectionHeader.fontWeight as "700",
    color: lightPalette.text.primary,
  },
  summarySubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: mobileTypography.listSecondary.lineHeight as number,
    color: lightPalette.text.secondary,
  },
  summaryStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1.5],
    marginTop: spacing[1.5],
    paddingTop: spacing[1.5],
    borderTopWidth: border.hairline,
    borderTopColor: lightPalette.divider,
  },
  summaryStatBlock: {
    flex: 1,
    gap: 2,
  },
  summaryStatValue: {
    fontSize: 20,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
    fontVariant: ["tabular-nums"],
  },
  summaryStatLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  summaryStatDivider: {
    width: border.hairline,
    alignSelf: "stretch",
    backgroundColor: lightPalette.divider,
  },
  focusFilterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: mobileLayout.screenPadding,
    paddingTop: spacing[2],
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: taskScreenLayout.controlRadius,
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  filterChipActive: {
    backgroundColor: lightPalette.primary.main,
    borderColor: lightPalette.primary.main,
  },
  filterChipText: {
    fontSize: mobileTypography.buttonSm.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
  },
  filterChipTextActive: {
    color: lightPalette.primary.contrastText,
  },
  sectionBlock: {
    paddingTop: taskScreenLayout.sectionGap,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: mobileLayout.screenPadding,
    paddingBottom: taskScreenLayout.sectionHeaderGap,
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
    borderRadius: taskScreenLayout.cardRadius,
    overflow: "hidden",
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
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
    opacity: 1,
    backgroundColor: "#f7fafc",
  },
  taskContentWrap: {
    flex: 1,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: taskScreenLayout.rowVerticalPadding,
    gap: taskScreenLayout.contentGap,
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
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
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
  focusLoadingWrap: {
    paddingTop: mobileLayout.itemGap,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: lightPalette.background.paper,
  },
  projectRowPressed: {
    backgroundColor: "#f7fafc",
  },
  projectRowBody: {
    flex: 1,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: taskScreenLayout.rowVerticalPadding,
    gap: spacing[0.5],
  },
  projectRowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: taskScreenLayout.metaGap,
  },
  projectName: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.primary,
    flex: 1,
  },
  projectKey: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
    fontVariant: ["tabular-nums"],
  },
  projectMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[0.5],
  },
  projectMetric: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
    fontWeight: "600" as const,
  },
  projectMetricActive: {
    color: lightPalette.primary.main,
  },
  projectMetricDanger: {
    color: lightPalette.error.main,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: mobileLayout.cardPadding * 2,
    gap: mobileLayout.cardGap,
  },
  errorText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.error.main,
    textAlign: "center",
  },
  retryBtn: {
  },
});
