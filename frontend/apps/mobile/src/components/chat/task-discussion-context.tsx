import React from "react";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LinkedResource } from "apis";

import { SFIcon } from "@/components/ui/sf-icon";
import { withNavigationContext } from "@/lib/mobile-navigation";
import {
  border,
  lightPalette,
  mobileTypography,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

interface TaskDiscussionContextProps {
  linkedResource: LinkedResource;
}

export function TaskDiscussionContext({ linkedResource }: TaskDiscussionContextProps) {
  if (linkedResource.resourceType !== "task" || !linkedResource.resourceId || !linkedResource.parentId) {
    return null;
  }

  const taskHref = withNavigationContext(
    `/(app)/(tasks)/${linkedResource.parentId}/task/${linkedResource.resourceId}`,
    {
      fallbackHref: "/(app)/(tasks)",
      ownerTab: "tasks",
      backLabel: "Tasks",
    },
  );

  return (
    <View style={styles.container} testID="task-discussion-context">
      <View style={styles.iconWrap}>
        <SFIcon name="checkmark.square.fill" size={18} color={lightPalette.success.main} />
      </View>
      <View style={styles.body}>
        <Text selectable style={styles.eyebrow}>
          Task discussion
        </Text>
        <Text selectable style={styles.title} numberOfLines={1}>
          {linkedResource.displayIdentifier || "Task"}
          {linkedResource.displayTitle ? ` ${linkedResource.displayTitle}` : ""}
        </Text>
      </View>
      <Link href={taskHref as never} asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open task"
          style={({ pressed }) => [styles.openButton, pressed && styles.openButtonPressed]}
        >
          <SFIcon name="arrow.up.right" size={14} color={lightPalette.primary.main} />
          <Text style={styles.openText}>Open task</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[1],
    borderBottomWidth: border.hairline,
    borderBottomColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.success.light + "22",
    borderWidth: border.thin,
    borderColor: lightPalette.success.light,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  eyebrow: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.success.dark,
  },
  title: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.primary,
  },
  openButton: {
    minHeight: 36,
    paddingHorizontal: spacing[1],
    borderRadius: radius.md,
    borderCurve: "continuous",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[0.5],
    borderWidth: border.thin,
    borderColor: lightPalette.primary.light,
    backgroundColor: lightPalette.primary.light + "14",
  },
  openButtonPressed: {
    backgroundColor: lightPalette.primary.light + "28",
  },
  openText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.primary.main,
  },
});