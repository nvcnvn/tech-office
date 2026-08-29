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
        options={{ title: "My Tasks" }}
      />
      <Stack.Screen
        name="[projectId]/index"
        options={{ title: "Tasks" }}
      />
      <Stack.Screen
        name="[projectId]/task/[taskId]"
        options={{ title: "Live Task" }}
      />
      <Stack.Screen
        name="[projectId]/settings"
        options={{ title: "Project Settings" }}
      />
      <Stack.Screen
        name="rituals/[definitionId]"
        options={{ title: "Ritual Template" }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
