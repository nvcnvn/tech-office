import React from "react";
import { Pressable, Text } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Stack } from "expo-router/stack";

import { SFIcon } from "@/components/ui/sf-icon";
import {
  parseNavigationContext,
  resolveNavigationBackHref,
} from "@/lib/mobile-navigation";
import { mobileTypography, spacing } from "@tech-office/theme-tokens";
import { useTheme } from "@/lib/theme";

export default function SharedResourceLayout() {
  const { palette } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    navParent?: string | string[];
    navFallback?: string | string[];
    navTab?: string | string[];
    navLabel?: string | string[];
  }>();
  const navigationContext = parseNavigationContext(params);
  const backHref = resolveNavigationBackHref(navigationContext, "/(app)");
  const backLabel = navigationContext.backLabel ?? "Back";

  return (
    <Stack
      screenOptions={{
        headerBackVisible: false,
        headerStyle: { backgroundColor: palette.background.paper },
        headerTitleStyle: { color: palette.text.primary },
        headerTintColor: palette.text.primary,
        contentStyle: { backgroundColor: palette.background.default },
        headerLeft: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Back to ${backLabel}`}
            hitSlop={8}
            onPress={() => {
              if (navigation.canGoBack()) {
                router.back();
                return;
              }

              router.replace(backHref as never);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing[0.5],
            }}
          >
            <SFIcon name="chevron.left" size={16} color={palette.info.main} />
            <Text
              style={{
                color: palette.info.main,
                fontSize: mobileTypography.listPrimary.fontSize,
                fontWeight: "600",
              }}
            >
              {backLabel}
            </Text>
          </Pressable>
        ),
      }}
    >
      <Stack.Screen name="resource/chat" options={{ headerShown: false }} />
      <Stack.Screen name="resource/tasks" options={{ headerShown: false }} />
      <Stack.Screen name="resource/calendar" options={{ headerShown: false }} />
    </Stack>
  );
}