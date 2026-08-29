import { Stack } from "expo-router/stack";
import { labelColor } from "@/lib/platform-colors";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function CalendarLayout() {
  return (
    <ErrorBoundary>
    <Stack
      screenOptions={{
        headerLargeTitle: false,
        headerTransparent: true,
        headerShadowVisible: false,
        headerLargeTitleShadowVisible: false,
        headerBlurEffect: "regular",
        headerTitleStyle: { color: labelColor, fontWeight: "600" },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Schedule", headerLargeTitle: true, headerLargeStyle: { backgroundColor: "transparent" } }}
      />
      <Stack.Screen
        name="[eventId]"
        options={{ headerLargeTitle: false }}
      />
      <Stack.Screen
        name="create"
        options={{ title: "New Event", presentation: "modal" }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
