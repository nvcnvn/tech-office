/**
 * Badge — numeric or dot indicator
 */

import React from "react";
import { Text, View } from "react-native";
import {
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

interface BadgeProps {
  count?: number;
  dot?: boolean;
  color?: string;
}

export function Badge({ count, dot = false, color }: BadgeProps) {
  const { palette } = useTheme();
  const styles = useStyles();

  // Resolved here rather than as a default parameter: a default is evaluated
  // where the function is declared, which has no theme.
  const fill = color ?? palette.error.main;

  if (dot) {
    return <View style={[styles.dot, { backgroundColor: fill }]} />;
  }

  if (!count || count <= 0) return null;

  const label = count > 99 ? "99+" : String(count);

  return (
    <View style={[styles.badge, { backgroundColor: fill }]}>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
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
    color: t.primary.contrastText,
    fontSize: mobileTypography.badge.fontSize,
    fontWeight: mobileTypography.badge.fontWeight,
    lineHeight: mobileTypography.badge.lineHeight,
  },
}));
