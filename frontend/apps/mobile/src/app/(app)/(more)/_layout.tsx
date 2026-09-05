import { Stack } from "expo-router/stack";
import { useRouter } from "expo-router";
import { Pressable } from "react-native";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { tabRootStackScreenOptions } from "@/lib/stack-screen-options";
import { useTheme } from "@/lib/theme";
import { SFIcon } from "@/components/ui/sf-icon";

export const unstable_settings = {
  initialRouteName: "index",
};

function MoreBackButton() {
  const router = useRouter();
  const { palette } = useTheme();

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
      <SFIcon name="chevron.left" size={22} color={palette.primary.main} />
    </Pressable>
  );
}

const childBackOptions = {
  headerBackVisible: false,
  headerLeft: () => <MoreBackButton />,
};

export default function MoreLayout() {
  const { palette } = useTheme();

  return (
    <ErrorBoundary>
      <Stack
        screenOptions={tabRootStackScreenOptions(palette)}
      >
        <Stack.Screen
          name="index"
          options={{ title: "More" }}
        />
        <Stack.Screen name="search" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: "Profile", ...childBackOptions }} />
        <Stack.Screen name="settings" options={{ title: "Settings", ...childBackOptions }} />
        <Stack.Screen name="people/index" options={{ title: "People", ...childBackOptions }} />
        {/* Not childBackOptions: a person is opened from the directory, a department
            member list or a search result, so the back button belongs to whichever
            brought you here. */}
        <Stack.Screen name="people/[employeeId]" options={{ title: "Person" }} />
        {/* Not childBackOptions, same reasoning: a department is opened from a search
            result or from a person's entry, so back belongs to whichever brought you
            here. */}
        <Stack.Screen name="people/department/[departmentId]" options={{ title: "Department" }} />
        <Stack.Screen name="docs/index" options={{ title: "Documents", ...childBackOptions }} />
        {/* Not childBackOptions: a doc is opened from the Docs list, so its back
            button belongs to that list. Sending it to More instead skipped the
            list you were reading. */}
        <Stack.Screen name="docs/[slug]" options={{ title: "Document" }} />
        <Stack.Screen name="files/index" options={{ title: "Files", ...childBackOptions }} />
        {/* Not childBackOptions: a file is opened from the Files list or from a search
            result, so its back button belongs to whichever brought you here. */}
        <Stack.Screen name="files/[fileId]" options={{ title: "File" }} />
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
