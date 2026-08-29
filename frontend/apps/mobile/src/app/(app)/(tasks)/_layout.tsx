import { Stack } from "expo-router/stack";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";

export default function TasksLayout() {
  return (
    <ErrorBoundary>
    <Stack
      screenOptions={tabRootStackScreenOptions}
    >
      <Stack.Screen
        name="index"
        options={{ title: "My Tasks", headerLargeTitle: true, headerLargeStyle: { backgroundColor: "transparent" } }}
      />
      <Stack.Screen
        name="[projectId]/index"
        options={{ headerLargeTitle: false, title: "Tasks" }}
      />
      <Stack.Screen
        name="[projectId]/task/[taskId]"
        options={{ headerLargeTitle: false, title: "Live Task" }}
      />
      <Stack.Screen
        name="[projectId]/settings"
        options={{ headerLargeTitle: false, title: "Project Settings" }}
      />
      <Stack.Screen
        name="rituals/[definitionId]"
        options={{ headerLargeTitle: false, title: "Ritual Template" }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
