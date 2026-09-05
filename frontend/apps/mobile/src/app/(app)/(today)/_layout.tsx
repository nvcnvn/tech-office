import { Stack } from "expo-router/stack";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";
import { useTheme } from "@/lib/theme";

export default function TodayLayout() {
  const { palette } = useTheme();

  return (
    <ErrorBoundary>
    <Stack
      screenOptions={tabRootStackScreenOptions(palette)}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Today" }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
