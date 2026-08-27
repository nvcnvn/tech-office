/**
 * Terms acknowledgement row for the signup and invitation screens
 * (Feature 036, FR-010).
 *
 * Both documents open in the system browser rather than in a native copy: one copy
 * of the text, on the web, is what both stores need anyway, and a second native
 * copy would drift and need an app release to correct a typo (research.md R10).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { openBrowserAsync } from "expo-web-browser";
import { PRIVACY_POLICY_PATH, TERMS_PATH } from "apis";

import { SFIcon } from "@/components/ui/sf-icon";
import { buildWebUrl } from "@/lib/constants";
import {
  border,
  lightPalette,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

export function TermsAcceptance({
  accepted,
  onChange,
  disabled = false,
  error,
}: {
  accepted: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted, disabled }}
        accessibilityLabel="I agree to the terms of service and privacy policy"
        testID="terms-acceptance-checkbox"
        onPress={() => onChange(!accepted)}
        disabled={disabled}
        // The tap target covers the whole row, not just the box: a 20pt square is
        // below the 44pt minimum and this screen is used one-handed.
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={[styles.box, accepted && styles.boxChecked]}>
          {accepted ? (
            <SFIcon name="checkmark" size={13} color={lightPalette.primary.contrastText} />
          ) : null}
        </View>
        <Text style={styles.label}>
          I agree to the{" "}
          <Text
            style={styles.link}
            onPress={() => void openBrowserAsync(buildWebUrl(TERMS_PATH))}
            testID="terms-acceptance-terms-link"
          >
            terms of service
          </Text>{" "}
          and the{" "}
          <Text
            style={styles.link}
            onPress={() => void openBrowserAsync(buildWebUrl(PRIVACY_POLICY_PATH))}
            testID="terms-acceptance-privacy-link"
          >
            privacy policy
          </Text>
          .
        </Text>
      </Pressable>

      {error ? (
        <Text style={styles.error} selectable testID="terms-acceptance-error">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[1.5],
    minHeight: 44,
    paddingVertical: spacing[1],
  },
  pressed: {
    opacity: opacity.pressed,
  },
  box: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: radius.sm,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    backgroundColor: lightPalette.primary.main,
    borderColor: lightPalette.primary.main,
  },
  label: {
    flex: 1,
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  link: {
    color: lightPalette.primary.main,
    fontWeight: "600",
  },
  error: {
    ...mobileTypography.caption,
    color: lightPalette.error.main,
  },
});
