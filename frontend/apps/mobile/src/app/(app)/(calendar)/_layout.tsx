import { Stack } from "expo-router/stack";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";

export default function CalendarLayout() {
  return (
    <ErrorBoundary>
    <Stack
      screenOptions={tabRootStackScreenOptions}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Schedule" }}
      />
      <Stack.Screen
        name="create"
        options={{ title: "New Event", presentation: "modal" }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
