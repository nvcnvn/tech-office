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
