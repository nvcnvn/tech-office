import { Stack } from "expo-router/stack";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";
import { useTheme } from "@/lib/theme";

export default function ChatLayout() {
  const { palette } = useTheme();

  return (
    <ErrorBoundary>
    <Stack
      screenOptions={tabRootStackScreenOptions(palette)}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Chat" }}
      />
      <Stack.Screen
        name="thread/[messageId]"
        options={{ title: "Thread" }}
      />
      <Stack.Screen
        name="new-channel"
        options={{ title: "New Channel", presentation: "modal" }}
      />
      <Stack.Screen
        name="search"
        options={{ presentation: "modal", headerShown: false }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
