/**
 * TextInput — styled text input with label and error state
 */

import React, { forwardRef } from "react";
import {
  Text,
  TextInput as RNTextInput,
  type TextInputProps,
  View,
} from "react-native";
import {
  border,
  mobileTypography,
  radius,
  touch,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

interface StyledTextInputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export const TextInput = forwardRef<RNTextInput, StyledTextInputProps>(
  function StyledTextInput({ label, error, style, ...rest }, ref) {
    const { palette } = useTheme();
    const styles = useStyles();

    return (
      <View style={styles.wrapper}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <RNTextInput
          ref={ref}
          style={[styles.input, error ? styles.inputError : null, style]}
          placeholderTextColor={palette.text.disabled}
          {...rest}
        />
        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }
);

const useStyles = makeStyles((t) => ({
  wrapper: {
    gap: 4,
  },
  label: {
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: mobileTypography.buttonSm.fontWeight,
    lineHeight: mobileTypography.caption.lineHeight,
    color: t.text.secondary,
  },
  input: {
    minHeight: touch.comfortable,
    borderWidth: border.thin,
    borderColor: t.divider,
    borderRadius: radius.md,
    // @ts-ignore
    borderCurve: "continuous",
    paddingHorizontal: 14,
    fontSize: mobileTypography.listPrimary.fontSize,
    lineHeight: mobileTypography.listPrimary.lineHeight,
    backgroundColor: t.background.paper,
    color: t.text.primary,
  },
  inputError: {
    borderColor: t.error.main,
  },
  errorText: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: t.error.main,
  },
}));
