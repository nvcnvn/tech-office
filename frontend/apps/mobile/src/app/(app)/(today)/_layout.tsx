import { Stack } from "expo-router/stack";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";

export default function TodayLayout() {
  return (
    <ErrorBoundary>
    <Stack
      screenOptions={tabRootStackScreenOptions}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Today", headerLargeTitle: true, headerLargeStyle: { backgroundColor: "transparent" } }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
