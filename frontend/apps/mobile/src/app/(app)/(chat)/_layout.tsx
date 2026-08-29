import { Stack } from "expo-router/stack";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";

export default function ChatLayout() {
  return (
    <ErrorBoundary>
    <Stack
      screenOptions={tabRootStackScreenOptions}
    >
      <Stack.Screen
        name="index"
        options={{ title: "Chat", headerLargeTitle: true, headerLargeStyle: { backgroundColor: "transparent" } }}
      />
      <Stack.Screen
        name="[channelId]"
        options={{ headerLargeTitle: false }}
      />
      <Stack.Screen
        name="thread/[messageId]"
        options={{ headerLargeTitle: false, title: "Thread" }}
      />
      <Stack.Screen
        name="new-channel"
        options={{ title: "New Channel", presentation: "modal" }}
      />
      <Stack.Screen
        name="new-dm"
        options={{ title: "New Message", presentation: "modal" }}
      />
      <Stack.Screen
        name="search"
        options={{ presentation: "modal", headerShown: false }}
      />
    </Stack>
    </ErrorBoundary>
  );
}
