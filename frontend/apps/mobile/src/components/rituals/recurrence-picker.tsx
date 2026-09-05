/**
 * How often a ritual runs — daily, weekly or monthly.
 *
 * Three large segments, and the weekly and monthly sub-controls are laid out rather than
 * hidden behind a picker. A wheel is an iOS-flavoured control that renders very differently
 * on Android, and a dropdown with 31 entries is exactly what Constitution XIII forbids for
 * the people this app is for.
 *
 * The weekday row carries two-letter labels because seven segments inside 328dp of usable
 * width at 360dp leaves roughly 46dp each, and three-letter labels do not fit on Android at
 * the default font scale. Days are numbered 1=Mon … 7=Sun, matching the proto, so no
 * translation happens between this control and the request.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import {
  mobileTypography,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";
import { makeStyles } from "@/lib/theme";

export type RecurrenceKind = "daily" | "weekly" | "monthly";

export type RecurrenceDraft = {
  type: RecurrenceKind;
  /** Weekly only. 1=Mon … 7=Sun. */
  daysOfWeek: number[];
  /** Monthly only. 0 means nothing chosen yet. */
  dayOfMonth: number;
};

// One word each. "Every day" / "Every week" / "Every month" reads slightly plainer, but a
// third of 360dp does not hold two words at the default font scale on Android — the middle
// segment rendered as "Every" with the rest clipped.
const KINDS: Array<{ value: RecurrenceKind; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// 1=Mon … 7=Sun, matching RecurrenceRule.days_of_week.
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Tu" },
  { value: 3, label: "We" },
  { value: 4, label: "Th" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 7, label: "Su" },
];

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, index) => index + 1);

export function RecurrencePicker({
  value,
  onChange,
  error,
}: {
  value: RecurrenceDraft;
  onChange: (next: RecurrenceDraft) => void;
  error?: string;
}) {
  const styles = useStyles();

  const toggleWeekday = (day: number) => {
    const next = value.daysOfWeek.includes(day)
      ? value.daysOfWeek.filter((existing) => existing !== day)
      : [...value.daysOfWeek, day].sort((left, right) => left - right);
    onChange({ ...value, daysOfWeek: next });
  };

  return (
    <View style={styles.block}>
      <Text style={styles.label}>How often</Text>

      <View style={styles.kindRow}>
        {KINDS.map((kind) => {
          const selected = value.type === kind.value;
          return (
            <Pressable
              key={kind.value}
              testID={`ritual-recurrence-${kind.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange({ ...value, type: kind.value })}
              style={[styles.kindSegment, selected && styles.segmentSelected]}
            >
              <Text style={[styles.kindLabel, selected && styles.segmentLabelSelected]}>
                {kind.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {value.type === "weekly" ? (
        <View style={styles.weekdayRow}>
          {WEEKDAYS.map((day) => {
            const selected = value.daysOfWeek.includes(day.value);
            return (
              <Pressable
                key={day.value}
                testID={`ritual-weekday-${day.value}`}
                accessibilityRole="button"
                accessibilityLabel={`Day ${day.value} of the week`}
                accessibilityState={{ selected }}
                onPress={() => toggleWeekday(day.value)}
                style={[styles.weekdaySegment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.weekdayLabel, selected && styles.segmentLabelSelected]}>
                  {day.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {value.type === "monthly" ? (
        <View style={styles.dayGrid}>
          {DAYS_OF_MONTH.map((day) => {
            const selected = value.dayOfMonth === day;
            return (
              <Pressable
                key={day}
                testID={`ritual-day-of-month-${day}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => onChange({ ...value, dayOfMonth: day })}
                style={[styles.dayChip, selected && styles.segmentSelected]}
              >
                <Text style={[styles.dayLabel, selected && styles.segmentLabelSelected]}>
                  {day}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {error ? (
        <Text testID="ritual-recurrence-error" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: spacing[1],
  },
  label: {
    ...mobileTypography.sectionHeader,
    color: t.text.primary,
  },
  kindRow: {
    flexDirection: "row",
    gap: spacing[1],
  },
  kindSegment: {
    flex: 1,
    flexShrink: 1,
    minHeight: touch.comfortable,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[0.5],
    // Two-line room: "Every week" does not fit one line in a third of 360dp, and without
    // this the second line is clipped and the segment reads "Every".
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.divider,
    backgroundColor: t.background.paper,
  },
  kindLabel: {
    ...mobileTypography.buttonSm,
    color: t.text.primary,
    textAlign: "center",
    // Stretch, so the label is measured against the segment's width and wraps inside it
    // rather than overflowing and being clipped mid-word.
    alignSelf: "stretch",
  },
  weekdayRow: {
    flexDirection: "row",
    gap: spacing[0.5],
  },
  weekdaySegment: {
    flex: 1,
    // Seven segments have to survive 360dp: each one gives way rather than pushing the row
    // wider than the screen.
    flexShrink: 1,
    minWidth: 0,
    minHeight: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: t.divider,
    backgroundColor: t.background.paper,
  },
  weekdayLabel: {
    ...mobileTypography.buttonSm,
    color: t.text.primary,
  },
  dayGrid: {
    flexDirection: "row",
    // Wraps rather than scrolling horizontally, so no day is hidden off the edge.
    flexWrap: "wrap",
    gap: spacing[0.5],
  },
  dayChip: {
    minWidth: touch.minTarget,
    minHeight: touch.minTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[0.5],
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: t.divider,
    backgroundColor: t.background.paper,
  },
  dayLabel: {
    ...mobileTypography.buttonSm,
    color: t.text.primary,
  },
  segmentSelected: {
    backgroundColor: t.primary.main,
    borderColor: t.primary.main,
  },
  segmentLabelSelected: {
    color: t.primary.contrastText,
  },
  error: {
    ...mobileTypography.listSecondary,
    color: t.error.main,
  },
}));
