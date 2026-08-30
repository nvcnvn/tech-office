import { Stack } from "expo-router/stack";
import { useRouter } from "expo-router";
import { Pressable } from "react-native";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";
import { SFIcon } from "@/components/ui/sf-icon";
import { lightPalette } from "@tech-office/theme-tokens";

export const unstable_settings = {
  initialRouteName: "index",
};

function MoreBackButton() {
  const router = useRouter();

  return (
    <Pressable
      testID="more-back-button"
      accessibilityRole="button"
      accessibilityLabel="Back to More"
      hitSlop={12}
      onPress={() => router.replace("/(app)/(more)" as never)}
      style={{
        minWidth: 44,
        minHeight: 44,
        alignItems: "flex-start",
        justifyContent: "center",
      }}
    >
      <SFIcon name="chevron.left" size={22} color={lightPalette.primary.main} />
    </Pressable>
  );
}

const childBackOptions = {
  headerBackVisible: false,
  headerLeft: () => <MoreBackButton />,
};

export default function MoreLayout() {
  return (
    <ErrorBoundary>
      <Stack
        screenOptions={tabRootStackScreenOptions}
      >
        <Stack.Screen
          name="index"
          options={{ title: "More" }}
        />
        <Stack.Screen name="search" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: "Profile", ...childBackOptions }} />
        <Stack.Screen name="settings" options={{ title: "Settings", ...childBackOptions }} />
        <Stack.Screen name="docs/index" options={{ title: "Documents", ...childBackOptions }} />
        {/* Not childBackOptions: a doc is opened from the Docs list, so its back
            button belongs to that list. Sending it to More instead skipped the
            list you were reading. */}
        <Stack.Screen name="docs/[slug]" options={{ title: "Document" }} />
        <Stack.Screen name="files/index" options={{ title: "Files", ...childBackOptions }} />
        {/* Maestro's shared-route smoke harness. The screen itself refuses to
            render outside development — see navigation-debug.tsx. */}
        <Stack.Screen
          name="navigation-debug"
          options={{ title: "Navigation Debug", ...childBackOptions }}
        />
      </Stack>
    </ErrorBoundary>
  );
}
