/**
 * Chip — selectable filter tag
 */

import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  border,
  lightPalette,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  color?: string;
}

export function Chip({
  label,
  selected = false,
  onPress,
  style,
  color = lightPalette.primary.main,
}: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected
          ? { backgroundColor: color, borderColor: color }
          : {
              backgroundColor: pressed
                ? lightPalette.background.default
                : lightPalette.background.paper,
              borderColor: lightPalette.divider,
            },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: selected ? lightPalette.primary.contrastText : lightPalette.text.secondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.xl,
    borderWidth: border.thin,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: mobileTypography.buttonSm.fontSize,
    fontWeight: mobileTypography.buttonSm.fontWeight,
    lineHeight: mobileTypography.buttonSm.lineHeight,
  },
});
