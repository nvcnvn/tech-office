/**
 * SearchPill — tappable non-editable pill shown at top of Chat, Tasks, Calendar
 *
 * Tapping opens the full-screen global search modal.
 * Renders at 48dp height for comfortable tap target.
 */

import React from "react";
import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  mobileLayout,
  touch,
  radius,
  searchIcons,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

interface SearchPillProps {
  placeholder?: string;
}

export function SearchPill({
  placeholder = "Search people, tasks, chats\u2026",
}: SearchPillProps) {
  const { palette } = useTheme();
  const styles = useStyles();

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
        color={palette.text.secondary}
      />
      <Text style={styles.placeholder} numberOfLines={1}>
        {placeholder}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: mobileLayout.screenPadding,
    marginTop: mobileLayout.itemGap,
    marginBottom: 4,
    height: touch.comfortable,
    paddingHorizontal: mobileLayout.screenPadding,
    backgroundColor: t.background.default,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: t.divider,
    gap: 10,
  },
  pillPressed: {
    backgroundColor: t.divider,
  },
  icon: {
    width: 18,
    height: 18,
  },
  placeholder: {
    flex: 1,
    fontSize: 16,
    color: t.text.secondary,
  },
}));
