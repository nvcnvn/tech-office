/**
 * TextInput — styled text input with label and error state
 */

import React, { forwardRef } from "react";
import {
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  type TextInputProps,
  View,
} from "react-native";
import {
  border,
  lightPalette,
  mobileTypography,
  radius,
  touch,
} from "@tech-office/theme-tokens";

interface StyledTextInputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export const TextInput = forwardRef<RNTextInput, StyledTextInputProps>(
  function StyledTextInput({ label, error, style, ...rest }, ref) {
    return (
      <View style={styles.wrapper}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <RNTextInput
          ref={ref}
          style={[styles.input, error ? styles.inputError : null, style]}
          placeholderTextColor={lightPalette.text.disabled}
          {...rest}
        />
        {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  wrapper: {
    gap: 4,
  },
  label: {
    fontSize: mobileTypography.caption.fontSize,
    fontWeight: mobileTypography.buttonSm.fontWeight,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.text.secondary,
  },
  input: {
    minHeight: touch.comfortable,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    borderRadius: radius.md,
    // @ts-ignore
    borderCurve: "continuous",
    paddingHorizontal: 14,
    fontSize: mobileTypography.listPrimary.fontSize,
    lineHeight: mobileTypography.listPrimary.lineHeight,
    backgroundColor: lightPalette.background.paper,
    color: lightPalette.text.primary,
  },
  inputError: {
    borderColor: lightPalette.error.main,
  },
  errorText: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.error.main,
  },
});
