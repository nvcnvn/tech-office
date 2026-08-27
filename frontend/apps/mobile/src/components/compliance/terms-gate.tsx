/**
 * Terms gate (Feature 036, FR-012).
 *
 * An admin-provisioned worker never saw a signup screen, so nobody ever asked
 * them to accept anything. Gating first use on the server's answer is the only
 * way acceptance can hold for accounts an administrator created — and the same
 * gate re-prompts everybody when the version is bumped.
 *
 * It fails open: if the check itself errors, the app is not held hostage to a
 * network blip. The server still rejects an unaccepted state where it matters.
 */

import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { openBrowserAsync } from "expo-web-browser";
import {
  PRIVACY_POLICY_PATH,
  TERMS_PATH,
  TERMS_VERSION,
  acceptTerms,
  getTermsStatus,
} from "apis";

import { SFIcon } from "@/components/ui/sf-icon";
import { buildWebUrl } from "@/lib/constants";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

export function TermsGate({ children }: { children: React.ReactNode }) {
  const [needsAcceptance, setNeedsAcceptance] = React.useState<boolean | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await getTermsStatus();
        if (!cancelled) setNeedsAcceptance(!status.isCurrent);
      } catch {
        // Fail open — see the note above.
        if (!cancelled) setNeedsAcceptance(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = async () => {
    setSubmitting(true);
    setError("");
    try {
      await acceptTerms(TERMS_VERSION);
      setNeedsAcceptance(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't record that. Try again.",
      );
      setSubmitting(false);
    }
  };

  // While the answer is unknown the app renders normally: a blocking spinner on
  // every cold start would be a worse trade than a moment of unguarded use.
  if (needsAcceptance !== true) {
    return <>{children}</>;
  }

  return (
    <View style={styles.screen} testID="terms-gate">
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.iconWrap}>
          <SFIcon name="doc.text.fill" size={20} color={lightPalette.primary.main} />
        </View>

        <Text style={styles.title}>Before you carry on</Text>
        <Text style={styles.body}>
          Please read how Tech Office works and what we do with your information. You only
          need to do this once, and again if they change.
        </Text>

        <Pressable
          onPress={() => void openBrowserAsync(buildWebUrl(TERMS_PATH))}
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          testID="terms-gate-terms-link"
        >
          <SFIcon name="doc.text" size={16} color={lightPalette.text.secondary} />
          <Text style={styles.linkLabel}>Terms of service</Text>
          <SFIcon name="chevron.right" size={13} color={lightPalette.text.secondary} />
        </Pressable>

        <Pressable
          onPress={() => void openBrowserAsync(buildWebUrl(PRIVACY_POLICY_PATH))}
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          testID="terms-gate-privacy-link"
        >
          <SFIcon name="lock.shield" size={16} color={lightPalette.text.secondary} />
          <Text style={styles.linkLabel}>Privacy policy</Text>
          <SFIcon name="chevron.right" size={13} color={lightPalette.text.secondary} />
        </Pressable>

        {error ? (
          <Text selectable style={styles.error} testID="terms-gate-error">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={() => void accept()}
          disabled={submitting}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          testID="terms-gate-accept"
        >
          {submitting ? (
            <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
          ) : (
            <Text style={styles.primaryButtonText}>I agree</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: mobileLayout.screenPadding,
    gap: spacing[1.5],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.base,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef5fc",
  },
  title: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  body: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
    marginBottom: spacing[1],
  },
  linkRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1.5],
    paddingHorizontal: spacing[2],
    borderRadius: radius.base,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
  },
  linkLabel: {
    flex: 1,
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
  },
  error: {
    ...mobileTypography.caption,
    color: lightPalette.error.main,
  },
  primaryButton: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: lightPalette.primary.main,
    marginTop: spacing[2],
  },
  primaryButtonText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.primary.contrastText,
    fontWeight: "600",
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
