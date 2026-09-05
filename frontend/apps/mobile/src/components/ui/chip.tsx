/**
 * Chip — selectable filter tag
 */

import React from "react";
import {
  Pressable,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  border,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

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
  color,
}: ChipProps) {
  const { palette } = useTheme();
  const styles = useStyles();

  // Resolved here rather than as a default parameter: a default is evaluated
  // where the function is declared, which has no theme.
  const accent = color ?? palette.primary.main;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected
          ? { backgroundColor: accent, borderColor: accent }
          : {
              backgroundColor: pressed
                ? palette.background.default
                : palette.background.paper,
              borderColor: palette.divider,
            },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: selected ? palette.primary.contrastText : palette.text.secondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
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
}));
