import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSitemap } from "expo-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toSharedResourceHref, withNavigationContext } from "@/lib/mobile-navigation";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

function buildTaskHref(projectId: string, taskId: string): string {
  return `/(app)/(tasks)/${projectId.trim()}/task/${taskId.trim()}`;
}

function buildTaskContextHref(projectId: string, taskId: string): string {
  return toSharedResourceHref(
    withNavigationContext(buildTaskHref(projectId, taskId), {
      fallbackHref: "/(app)/(tasks)",
      ownerTab: "tasks",
      backLabel: "Tasks",
    }),
  );
}

export default function NavigationDebugScreen() {
  const router = useRouter();
  const sitemap = useSitemap();
  const [projectId, setProjectId] = React.useState("");
  const [taskId, setTaskId] = React.useState("");
  const [channelId, setChannelId] = React.useState("");

  React.useEffect(() => {
    if (!__DEV__ || !sitemap) {
      return;
    }

    const hrefs: string[] = [];
    const stack = [sitemap];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }

      if (typeof node.href === "string") {
        hrefs.push(node.href);
      }

      for (const child of node.children) {
        stack.push(child);
      }
    }

    const relevant = hrefs.filter((href) =>
      href.includes("/resource/tasks") || href.includes("/resource/chat") || href.includes("/resource/probe"),
    );

    console.log("[nav-debug] sitemap routes", JSON.stringify(relevant.sort()));
  }, [sitemap]);

  const hasTaskIds = projectId.trim().length > 0 && taskId.trim().length > 0;
  const hasChannelId = channelId.trim().length > 0;

  const openTaskFromTasks = () => {
    if (!hasTaskIds) {
      return;
    }

    router.push(buildTaskContextHref(projectId, taskId));
  };

  const openChannelFromTaskContext = () => {
    if (!hasTaskIds || !hasChannelId) {
      return;
    }

    const href = {
      pathname: "/resource/probe/item",
      params: {
        id: channelId.trim(),
        fromProjectId: projectId.trim(),
        fromTaskId: taskId.trim(),
      },
    } as const;

    if (__DEV__) {
      console.log("[nav-debug] open shared channel probe", JSON.stringify(href));
    }

    router.push(href);
  };

  const openTaskFromAlerts = () => {
    if (!hasTaskIds) {
      return;
    }

    router.push(
      toSharedResourceHref(
        withNavigationContext(buildTaskHref(projectId, taskId), {
          parentHref: "/(app)/(notifications)",
          fallbackHref: "/(app)/(notifications)",
          ownerTab: "alerts",
          backLabel: "Alerts",
        }),
      ),
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Card style={styles.headerCard}>
        <Text style={styles.title}>Shared Route Smoke</Text>
        <Text style={styles.subtitle}>
          Opens shared routes inside the running app so Maestro can verify contextual back behavior without triggering an iOS dev-client relaunch.
        </Text>
      </Card>

      <Card style={styles.formCard}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Task Project ID</Text>
          <TextInput
            testID="navigation-debug-project-id"
            value={projectId}
            onChangeText={setProjectId}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="019dbdd5-..."
            placeholderTextColor={lightPalette.text.secondary}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Task ID</Text>
          <TextInput
            testID="navigation-debug-task-id"
            value={taskId}
            onChangeText={setTaskId}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="019dbdd5-..."
            placeholderTextColor={lightPalette.text.secondary}
          />
        </View>

        <View style={styles.actionsCard}>
          <Button
            testID="navigation-debug-open-task"
            label="Open Task From Tasks"
            onPress={openTaskFromTasks}
            disabled={!hasTaskIds}
          />
          <Button
            testID="navigation-debug-open-alert-task"
            label="Open Task From Alerts"
            onPress={openTaskFromAlerts}
            disabled={!hasTaskIds}
          />
        </View>
      </Card>

      <Card style={styles.formCard}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Channel ID</Text>
          <TextInput
            testID="navigation-debug-channel-id"
            value={channelId}
            onChangeText={setChannelId}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            placeholder="019db419-..."
            placeholderTextColor={lightPalette.text.secondary}
          />
        </View>
      </Card>

      <Card style={styles.actionsCard}>
        <Button
          testID="navigation-debug-open-channel"
          label="Open Channel From Task Context"
          onPress={openChannelFromTaskContext}
          disabled={!hasTaskIds || !hasChannelId}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  content: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
    paddingBottom: spacing[6],
  },
  headerCard: {
    gap: spacing[2],
  },
  title: {
    fontSize: mobileTypography.screenTitle.fontSize as number,
    fontWeight: mobileTypography.screenTitle.fontWeight,
    color: lightPalette.text.primary,
  },
  subtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: mobileTypography.listSecondary.lineHeight as number,
    color: lightPalette.text.secondary,
  },
  formCard: {
    gap: spacing[3],
  },
  fieldGroup: {
    gap: spacing[1],
  },
  label: {
    fontSize: mobileTypography.buttonSm.fontSize as number,
    fontWeight: mobileTypography.buttonSm.fontWeight,
    color: lightPalette.text.primary,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: lightPalette.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: lightPalette.background.default,
    color: lightPalette.text.primary,
    fontSize: mobileTypography.listPrimary.fontSize as number,
  },
  actionsCard: {
    gap: spacing[2],
  },
});