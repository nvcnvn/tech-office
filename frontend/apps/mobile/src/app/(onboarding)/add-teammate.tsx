/**
 * Add your first teammate — the step that turns a one-person workspace into a real one.
 *
 * The server returns the teammate's one-time code exactly once and it is never retrievable;
 * recovery means resetting the credential. A screen that displays an unrecoverable secret,
 * labels it "shown once", and leaves the owner to copy it by hand is a screen that loses
 * credentials — so handing it off through the OS share sheet is the primary action, not an
 * afterthought.
 */

import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import {
  createOrgAccount,
  fieldViolation,
  TEMPORARY_PIN_EXPIRY_DAYS,
} from "apis";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import { SFIcon } from "@/components/ui/sf-icon";
import { getOnboardingSubdomain, setOnboardingStep } from "@/lib/onboarding-progress";

interface IssuedAccount {
  name: string;
  identifier: string;
  temporaryPin: string;
}

/** Split a person's full name the way the API wants it. */
function splitName(fullName: string): { givenName: string; familyName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "", familyName: "" };
  if (parts.length === 1) return { givenName: parts[0], familyName: parts[0] };
  return { givenName: parts[0], familyName: parts.slice(1).join(" ") };
}

/**
 * What the teammate actually needs, written the way one person texts another. No jargon:
 * the recipient has never seen this product.
 */
function handoffMessage(workspace: string, account: IssuedAccount): string {
  return [
    `Hi ${account.name}, here's how to sign in to our team app.`,
    ``,
    `Workspace: ${workspace}`,
    `Your ID: ${account.identifier}`,
    `Your code: ${account.temporaryPin}`,
    ``,
    `The code works once and stops working after ${TEMPORARY_PIN_EXPIRY_DAYS} days. You'll pick your own PIN when you sign in.`,
  ].join("\n");
}

export default function AddTeammateScreen() {
  const router = useRouter();
  const workspace = getOnboardingSubdomain();

  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<IssuedAccount | null>(null);
  const [copied, setCopied] = useState(false);

  const finish = () => {
    setOnboardingStep("done");
    router.replace("/(app)/(chat)");
  };

  const create = async () => {
    const trimmedName = name.trim();
    const trimmedIdentifier = identifier.trim();

    if (!trimmedName) {
      setError("Tell us their name.");
      return;
    }
    if (!trimmedIdentifier) {
      setError("Give them an ID — a badge number or a short username.");
      return;
    }
    if (trimmedIdentifier.includes("@")) {
      setError("Use a badge number or short username, not an email address.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const { givenName, familyName } = splitName(trimmedName);
      const result = await createOrgAccount({
        loginIdentifier: trimmedIdentifier,
        displayName: trimmedName,
        givenName,
        familyName,
      });

      if (process.env.EXPO_OS === "ios") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setIssued({
        name: trimmedName,
        identifier: result.loginIdentifier,
        temporaryPin: result.temporaryPin,
      });
    } catch (err) {
      const identifierProblem = fieldViolation(err, "login_identifier");
      setError(
        identifierProblem
          ? "That ID can't be used. Try a different badge number or username."
          : err instanceof Error && err.message
            ? err.message
            : "We couldn't add them. Try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const share = async () => {
    if (!issued) return;
    try {
      await Share.share({ message: handoffMessage(workspace, issued) });
    } catch {
      // The user dismissed the sheet, or the OS refused it. Nothing to report: the code
      // is still on screen and the copy action is right below.
    }
  };

  const copy = async () => {
    if (!issued) return;
    await Clipboard.setStringAsync(handoffMessage(workspace, issued));
    setCopied(true);
    if (process.env.EXPO_OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Stack.Screen
          options={{
            title: issued ? "Send them the code" : "Add your first teammate",
            headerBackVisible: false,
            gestureEnabled: false,
          }}
        />

        {issued ? (
          <>
            <View style={styles.card}>
              <Text style={styles.lede} selectable>
                {issued.name} is ready. Send them this code — it is shown only once.
              </Text>

              <View style={styles.codeCard} testID="teammate-code-card">
                <View style={styles.codeWarning}>
                  <SFIcon
                    name="exclamationmark.triangle.fill"
                    size={16}
                    color={lightPalette.warning.dark}
                  />
                  <Text style={styles.codeWarningText} selectable>
                    Shown once. Expires in {TEMPORARY_PIN_EXPIRY_DAYS} days.
                  </Text>
                </View>

                <Text style={styles.codeValue} selectable testID="teammate-code">
                  {issued.temporaryPin}
                </Text>

                <Text style={styles.codeMeta} selectable testID="teammate-identifier">
                  {issued.name} · {issued.identifier}
                </Text>
              </View>

              <Pressable
                onPress={share}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                ]}
                testID="teammate-share"
              >
                <SFIcon
                  name="square.and.arrow.up"
                  size={16}
                  color={lightPalette.primary.contrastText}
                />
                <Text style={styles.primaryButtonText}>Send to {issued.name}</Text>
              </Pressable>

              <Pressable
                onPress={copy}
                style={({ pressed }) => [styles.quietAction, pressed && styles.pressed]}
                testID="teammate-copy"
              >
                <Text style={styles.linkText}>{copied ? "Copied" : "Copy instead"}</Text>
              </Pressable>
            </View>

            <View style={styles.footerActions}>
              <Pressable
                onPress={finish}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                ]}
                testID="teammate-done"
              >
                <Text style={styles.secondaryButtonText}>Done</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.lede} selectable>
                They'll sign in with an ID and a six-digit code — no email needed.
              </Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Their name</Text>
                <View style={styles.inputShell}>
                  <TextInput
                    style={styles.input}
                    placeholder="Ana Pham"
                    placeholderTextColor={lightPalette.text.disabled}
                    autoCapitalize="words"
                    autoCorrect={false}
                    value={name}
                    onChangeText={setName}
                    editable={!loading}
                    testID="teammate-name-input"
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Their ID</Text>
                <View style={styles.inputShell}>
                  <TextInput
                    style={styles.input}
                    placeholder="A badge number or short username"
                    placeholderTextColor={lightPalette.text.disabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={identifier}
                    onChangeText={setIdentifier}
                    onSubmitEditing={create}
                    editable={!loading}
                    testID="teammate-identifier-input"
                  />
                </View>
                <Text style={styles.fieldHint}>This is what they'll type to sign in.</Text>
              </View>

              {error ? (
                <View style={styles.errorBanner} testID="teammate-error">
                  <SFIcon
                    name="exclamationmark.circle.fill"
                    size={16}
                    color={lightPalette.error.main}
                  />
                  <Text style={styles.errorText} selectable>
                    {error}
                  </Text>
                </View>
              ) : null}

              <Pressable
                onPress={create}
                disabled={loading}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryButtonPressed,
                  loading && styles.primaryButtonDisabled,
                ]}
                testID="teammate-create"
              >
                {loading ? (
                  <ActivityIndicator
                    size="small"
                    color={lightPalette.primary.contrastText}
                  />
                ) : (
                  <Text style={styles.primaryButtonText}>Add teammate</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.footerActions}>
              <Pressable
                onPress={finish}
                style={({ pressed }) => [styles.quietAction, pressed && styles.pressed]}
                testID="teammate-skip"
              >
                <Text style={styles.linkText}>Skip for now</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  scrollContent: {
    flexGrow: 1,
    paddingVertical: 24,
    gap: mobileLayout.cardGap,
  },
  card: {
    marginHorizontal: mobileLayout.screenPadding,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    padding: mobileLayout.cardPadding,
    gap: 20,
  },
  lede: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
    fontWeight: "600",
  },
  fieldHint: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
  },
  inputShell: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.default,
    overflow: "hidden",
  },
  input: {
    flex: 1,
    minHeight: 48,
    fontSize: 16,
    color: lightPalette.text.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  codeCard: {
    gap: 10,
    padding: mobileLayout.cardPadding,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: lightPalette.background.default,
    borderWidth: border.medium,
    borderColor: lightPalette.warning.main,
    alignItems: "center",
  },
  codeWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.itemGap,
  },
  codeWarningText: {
    ...mobileTypography.caption,
    color: lightPalette.warning.dark,
    fontWeight: "600",
  },
  codeValue: {
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: 6,
    fontVariant: ["tabular-nums"],
    color: lightPalette.text.primary,
  },
  codeMeta: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
    textAlign: "center",
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: mobileLayout.itemGap,
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: lightPalette.background.default,
    borderWidth: border.thin,
    borderColor: lightPalette.error.light,
    padding: 12,
  },
  errorText: {
    ...mobileTypography.listSecondary,
    color: lightPalette.error.dark,
    flex: 1,
  },
  primaryButton: {
    minHeight: 48,
    flexDirection: "row",
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: lightPalette.primary.main,
    alignItems: "center",
    justifyContent: "center",
    gap: mobileLayout.itemGap,
    paddingHorizontal: 16,
  },
  primaryButtonPressed: {
    backgroundColor: lightPalette.primary.dark,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    ...mobileTypography.button,
    color: lightPalette.primary.contrastText,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    ...mobileTypography.button,
    color: lightPalette.text.primary,
  },
  footerActions: {
    paddingHorizontal: mobileLayout.screenPadding,
  },
  quietAction: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  linkText: {
    ...mobileTypography.listSecondary,
    color: lightPalette.info.main,
    fontWeight: "600",
  },
});
