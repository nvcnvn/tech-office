import { Stack } from "expo-router/stack";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";

export default function AlertsLayout() {
  return (
    <ErrorBoundary>
    <Stack
      screenOptions={tabRootStackScreenOptions}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Alerts", headerLargeTitle: true, headerLargeStyle: { backgroundColor: "transparent" } }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
