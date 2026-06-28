/**
 * Badge — numeric or dot indicator
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  lightPalette,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";

interface BadgeProps {
  count?: number;
  dot?: boolean;
  color?: string;
}

export function Badge({
  count,
  dot = false,
  color = lightPalette.error.main,
}: BadgeProps) {
  if (dot) {
    return <View style={[styles.dot, { backgroundColor: color }]} />;
  }

  if (!count || count <= 0) return null;

  const label = count > 99 ? "99+" : String(count);

  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: radius.full,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: lightPalette.primary.contrastText,
    fontSize: mobileTypography.badge.fontSize,
    fontWeight: mobileTypography.badge.fontWeight,
    lineHeight: mobileTypography.badge.lineHeight,
  },
});
