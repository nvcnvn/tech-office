import { Stack } from "expo-router/stack";
import { labelColor } from "@/lib/platform-colors";
import { ErrorBoundary } from "@/components/ui/error-boundary";

export default function TodayLayout() {
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
        options={{ title: "Today", headerLargeTitle: true, headerLargeStyle: { backgroundColor: "transparent" } }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
