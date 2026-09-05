/**
 * StateChip — colored badge for task/event states
 */

import React from "react";
import { Text, View } from "react-native";
import {
  border,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

interface StateChipProps {
  label: string;
  color?: string;
  textColor?: string;
}

export function StateChip({ label, color, textColor }: StateChipProps) {
  const { palette } = useTheme();
  const styles = useStyles();

  // Resolved here rather than as default parameters: a default is evaluated
  // where the function is declared, which has no theme.
  const fill = color ?? palette.background.default;
  const labelColor = textColor ?? palette.text.primary;

  return (
    <View
      style={[styles.container, { backgroundColor: fill }]}
    >
      <Text style={[styles.label, { color: labelColor }]}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  container: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.base,
    borderWidth: border.thin,
    borderColor: "transparent",
    alignSelf: "flex-start",
    // @ts-ignore
    borderCurve: "continuous",
  },
  label: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    fontWeight: mobileTypography.buttonSm.fontWeight,
  },
}));
