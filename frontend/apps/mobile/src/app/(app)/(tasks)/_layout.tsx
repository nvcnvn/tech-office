import { Stack } from "expo-router/stack";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";
import { useTheme } from "@/lib/theme";

export default function TasksLayout() {
  const { palette } = useTheme();

  return (
    <ErrorBoundary>
    <Stack
      screenOptions={tabRootStackScreenOptions(palette)}
    >
      <Stack.Screen
        name="index"
        options={{ title: "My Tasks" }}
      />
      <Stack.Screen
        name="review/index"
        options={{ title: "Needs your review" }}
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
      <Stack.Screen
        name="create-project"
        options={{ title: "New Project", presentation: "modal" }}
      />
      <Stack.Screen
        name="[projectId]/create-ritual"
        options={{ title: "New Ritual", presentation: "modal" }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
