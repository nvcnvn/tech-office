import { Stack } from "expo-router/stack";
import { useRouter } from "expo-router";
import { PlatformColor, Pressable } from "react-native";
import { ErrorBoundary } from "@/components/ui/error-boundary";
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
        screenOptions={{
          headerLargeTitle: false,
          headerTransparent: true,
          headerShadowVisible: false,
          headerLargeTitleShadowVisible: false,
          headerBlurEffect: "regular",
          headerTitleStyle: { color: PlatformColor("label") as unknown as string, fontWeight: "600" },
          headerBackButtonDisplayMode: "minimal",
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: "More", headerLargeTitle: true, headerLargeStyle: { backgroundColor: "transparent" } }}
        />
        <Stack.Screen name="search" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: "Profile", ...childBackOptions }} />
        <Stack.Screen name="settings" options={{ title: "Settings", ...childBackOptions }} />
        <Stack.Screen name="navigation-debug" options={{ title: "Navigation Debug", ...childBackOptions }} />
        <Stack.Screen name="docs/index" options={{ title: "Documents", ...childBackOptions }} />
        <Stack.Screen name="docs/[slug]" options={{ headerLargeTitle: false, ...childBackOptions }} />
        <Stack.Screen name="files/index" options={{ title: "Files", ...childBackOptions }} />
      </Stack>
    </ErrorBoundary>
  );
}
