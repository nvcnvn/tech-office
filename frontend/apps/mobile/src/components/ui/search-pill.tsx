/**
 * SearchPill — tappable non-editable pill shown at top of Chat, Tasks, Calendar
 *
 * Tapping opens the full-screen global search modal.
 * Renders at 48dp height for comfortable tap target.
 */

import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  lightPalette,
  mobileLayout,
  touch,
  radius,
  searchIcons,
} from "@tech-office/theme-tokens";

interface SearchPillProps {
  placeholder?: string;
}

export function SearchPill({
  placeholder = "Search people, tasks, chats\u2026",
}: SearchPillProps) {
  const router = useRouter();

  return (
    <Pressable
      testID="global-search-pill"
      accessibilityRole="button"
      accessibilityLabel={placeholder}
      onPress={() => router.push("/(app)/(more)/search")}
      style={({ pressed }) => [
        styles.pill,
        pressed && styles.pillPressed,
      ]}
    >
      <SFIcon
        name={searchIcons.searchPill.name}
        size={18}
        color={lightPalette.text.secondary}
      />
      <Text style={styles.placeholder} numberOfLines={1}>
        {placeholder}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: mobileLayout.screenPadding,
    marginTop: mobileLayout.itemGap,
    marginBottom: 4,
    height: touch.comfortable,
    paddingHorizontal: mobileLayout.screenPadding,
    backgroundColor: lightPalette.background.default,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: lightPalette.divider,
    gap: 10,
  },
  pillPressed: {
    backgroundColor: lightPalette.divider,
  },
  icon: {
    width: 18,
    height: 18,
  },
  placeholder: {
    flex: 1,
    fontSize: 16,
    color: lightPalette.text.secondary,
  },
});
