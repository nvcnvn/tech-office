/**
 * Button — reusable primary/secondary/ghost button
 */

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  border,
  mobileTypography,
  opacity,
  radius,
  touch,
  type MobilePalette,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends Omit<PressableProps, "style"> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The four colours a variant carries, as a function of the palette rather than
 * four module-level records: a record built at import time can only hold one
 * theme's values, which is the shape this whole sweep exists to remove.
 */
function variantColors(t: MobilePalette, variant: ButtonVariant) {
  const byVariant: Record<
    ButtonVariant,
    { bg: string; bgPressed: string; text: string; border: string }
  > = {
    primary: {
      bg: t.primary.main,
      bgPressed: t.primary.dark,
      text: t.primary.contrastText,
      border: t.primary.main,
    },
    secondary: {
      bg: t.background.paper,
      bgPressed: t.background.default,
      text: t.text.primary,
      border: t.divider,
    },
    ghost: {
      bg: "transparent",
      bgPressed: t.background.default,
      text: t.primary.main,
      border: "transparent",
    },
    destructive: {
      bg: t.error.main,
      bgPressed: t.error.dark,
      text: t.error.contrastText,
      border: t.error.main,
    },
  };
  return byVariant[variant];
}

const HEIGHT: Record<ButtonSize, number> = { sm: 40, md: touch.comfortable, lg: touch.large };
const FONT_SIZE: Record<ButtonSize, number> = {
  sm: mobileTypography.buttonSm.fontSize,
  md: mobileTypography.button.fontSize,
  lg: mobileTypography.button.fontSize,
};
const PADDING_H: Record<ButtonSize, number> = { sm: 14, md: 18, lg: 22 };
export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const { palette } = useTheme();
  const styles = useStyles();

  const colors = variantColors(palette, variant);
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
          backgroundColor: pressed ? colors.bgPressed : colors.bg,
          opacity: isDisabled ? opacity.disabled : 1,
          borderWidth: variant === "ghost" ? 0 : border.thin,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={colors.text}
        />
      ) : (
        <Text
          style={[
            styles.label,
            { fontSize: FONT_SIZE[size], color: colors.text },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
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
}));
