/**
 * Button — reusable primary/secondary/ghost button
 */

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  border,
  lightPalette,
  mobileTypography,
  opacity,
  radius,
  touch,
} from "@tech-office/theme-tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<PressableProps, "style"> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const BG: Record<ButtonVariant, string> = {
  primary: lightPalette.primary.main,
  secondary: lightPalette.background.paper,
  ghost: "transparent",
  destructive: lightPalette.error.main,
};
const BG_PRESSED: Record<ButtonVariant, string> = {
  primary: lightPalette.primary.dark,
  secondary: lightPalette.background.default,
  ghost: lightPalette.background.default,
  destructive: lightPalette.error.dark,
};
const TEXT_COLOR: Record<ButtonVariant, string> = {
  primary: lightPalette.primary.contrastText,
  secondary: lightPalette.text.primary,
  ghost: lightPalette.primary.main,
  destructive: lightPalette.error.contrastText,
};
const HEIGHT: Record<ButtonSize, number> = { sm: 40, md: touch.comfortable, lg: touch.large };
const FONT_SIZE: Record<ButtonSize, number> = {
  sm: mobileTypography.buttonSm.fontSize,
  md: mobileTypography.button.fontSize,
  lg: mobileTypography.button.fontSize,
};
const PADDING_H: Record<ButtonSize, number> = { sm: 14, md: 18, lg: 22 };
const BORDER_COLOR: Record<ButtonVariant, string> = {
  primary: lightPalette.primary.main,
  secondary: lightPalette.divider,
  ghost: "transparent",
  destructive: lightPalette.error.main,
};

export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: HEIGHT[size],
          paddingHorizontal: PADDING_H[size],
          backgroundColor: pressed
            ? BG_PRESSED[variant]
            : BG[variant],
          opacity: isDisabled ? opacity.disabled : 1,
          borderWidth: variant === "ghost" ? 0 : border.thin,
          borderColor: BORDER_COLOR[variant],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={TEXT_COLOR[variant]}
        />
      ) : (
        <Text
          style={[
            styles.label,
            { fontSize: FONT_SIZE[size], color: TEXT_COLOR[variant] },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    // @ts-ignore — borderCurve is iOS 15+
    borderCurve: "continuous",
  },
  label: {
    fontWeight: mobileTypography.button.fontWeight,
    lineHeight: mobileTypography.button.lineHeight,
  },
});
