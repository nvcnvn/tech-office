import { Stack } from "expo-router/stack";
import { PlatformColor } from "react-native";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function TasksLayout() {
  return (
    <ErrorBoundary>
    <Stack
      screenOptions={{
        headerLargeTitle: false,
        headerTransparent: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerBlurEffect: "regular",
        headerTitleStyle: { color: PlatformColor("label") as unknown as string, fontWeight: "600" },
        headerBackButtonDisplayMode: "minimal",
      }}
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
        name="[projectId]/[taskId]"
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
