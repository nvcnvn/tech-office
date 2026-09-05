/**
 * Empty state component — shown when a list has no items
 *
 * Uses SF Symbols via expo-image at 48dp for the illustration.
 */

import React from "react";
import { View, Text, Pressable } from "react-native";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

interface EmptyStateProps {
  /** SF Symbol name (without "sf:" prefix). Falls back to emoji if not provided. */
  sfSymbol?: string;
  /** Fallback emoji if no SF Symbol provided. */
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export function EmptyState({
  sfSymbol,
  emoji = "📭",
  title,
  subtitle,
  action,
}: EmptyStateProps) {
  const { palette } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.container}>
      {sfSymbol ? (
        <SFIcon name={sfSymbol} size={48} color={palette.text.disabled} />
      ) : (
        <Text style={styles.emoji}>{emoji}</Text>
      )}
      <Text selectable style={styles.title}>{title}</Text>
      {subtitle ? <Text selectable style={styles.subtitle}>{subtitle}</Text> : null}
      {action && (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed && styles.actionBtnPressed,
          ]}
        >
          <Text style={styles.actionBtnText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing[4],
    gap: spacing[1.5],
  },
  sfIcon: {
    width: 48,
    height: 48,
  },
  emoji: {
    fontSize: 48,
  },
  title: {
    fontSize: mobileTypography.sectionHeader.fontSize,
    fontWeight: mobileTypography.sectionHeader.fontWeight,
    lineHeight: mobileTypography.sectionHeader.lineHeight,
    textAlign: "center",
    color: t.text.primary,
  },
  subtitle: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: t.text.secondary,
    textAlign: "center",
  },
  actionBtn: {
    marginTop: 8,
    backgroundColor: t.primary.main,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: radius.md,
    borderWidth: border.thin,
    borderColor: t.primary.main,
  },
  actionBtnPressed: {
    opacity: opacity.pressed,
  },
  actionBtnText: {
    color: t.primary.contrastText,
    fontWeight: mobileTypography.button.fontWeight,
    fontSize: mobileTypography.button.fontSize,
    lineHeight: mobileTypography.button.lineHeight,
  },
}));
