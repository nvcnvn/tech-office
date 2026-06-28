/**
 * StateChip — colored badge for task/event states
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  border,
  lightPalette,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";

interface StateChipProps {
  label: string;
  color?: string;
  textColor?: string;
}

export function StateChip({
  label,
  color = lightPalette.background.default,
  textColor = lightPalette.text.primary,
}: StateChipProps) {
  return (
    <View
      style={[styles.container, { backgroundColor: color }]}
    >
      <Text style={[styles.label, { color: textColor }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
