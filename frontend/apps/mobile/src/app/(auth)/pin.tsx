/**
 * PIN entry screen — for org-managed accounts
 */

import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  AccountLockedError,
  getOrganizationBySubdomain,
  getProfile,
  loginWithPIN,
  setAuthToken,
} from "apis";
import { AuthContext } from "@/hooks/use-auth";
import { SessionErrorBanner } from "@/components/auth/session-error-banner";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import {
  getRememberedAuthLoginIdentifier,
  getRememberedAuthSubdomain,
  rememberAuthLoginIdentifier,
  rememberAuthSubdomain,
} from "../../lib/auth-subdomain-storage";

const PIN_LENGTH = 6;

export default function PinScreen() {
  const router = useRouter();
  const auth = React.use(AuthContext);
  const pinInputRef = useRef<TextInput>(null);
  const [subdomain, setSubdomain] = useState("");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [isPinFocused, setIsPinFocused] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const rememberedLoginIdentifier = getRememberedAuthLoginIdentifier();
    const rememberedSubdomain = getRememberedAuthSubdomain();

    if (rememberedLoginIdentifier) {
      setLoginIdentifier(rememberedLoginIdentifier);
    }

    if (rememberedSubdomain) {
      setSubdomain(rememberedSubdomain);
    }
  }, []);

  const handlePinChange = async (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(cleaned);

    if (cleaned.length === PIN_LENGTH) {
      const normalizedSubdomain = subdomain.trim().toLowerCase();
      const normalizedLoginIdentifier = loginIdentifier.trim();

      if (!normalizedSubdomain || !normalizedLoginIdentifier) {
        Alert.alert(
          "Missing details",
          "Enter your workspace subdomain and account ID before your PIN."
        );
        setPin("");
        return;
      }

      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      auth?.clearAuthError();
      setLoading(true);
      try {
        const result = await loginWithPIN(
          normalizedSubdomain,
          normalizedLoginIdentifier,
          cleaned
        );

        if (result.pinChangeRequired) {
          rememberAuthLoginIdentifier(normalizedLoginIdentifier);
          rememberAuthSubdomain(normalizedSubdomain);
          router.replace({
            pathname: "/(auth)/set-pin",
            params: {
              subdomain: normalizedSubdomain,
              pinChangeToken: result.pinChangeToken,
            },
          });
          return;
        }

        await setAuthToken(result.accessToken, Number(result.expiresAt));

        const org = await getOrganizationBySubdomain(normalizedSubdomain);
        const profile = await getProfile();
        const membership = profile.organizations.find(
          (item) => item.organizationId === org.id
        );

        await auth?.signIn({
          token: result.accessToken,
          expiresAt: Number(result.expiresAt),
          organizationId: org.id,
          employeeId: membership?.id ?? profile.user.id,
        });
        rememberAuthLoginIdentifier(normalizedLoginIdentifier);
        rememberAuthSubdomain(normalizedSubdomain);

        router.replace("/(app)/(chat)");
      } catch (err) {
        Alert.alert(
          err instanceof AccountLockedError ? "Account locked" : "Sign in failed",
          err instanceof Error ? err.message : "Invalid PIN"
        );
        setPin("");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
      >
        <Stack.Screen options={{ title: "Account ID and PIN" }} />

        {auth?.authErrorMessage ? (
          <SessionErrorBanner
            message={auth.authErrorMessage}
            onDismiss={auth.clearAuthError}
          />
        ) : null}

        <View style={styles.header}>
          <Text style={styles.title}>Account ID sign in</Text>
          <Text style={styles.subtitle}>
            Use your workspace subdomain, account ID, and 6-digit PIN from your
            organization.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Workspace subdomain</Text>
            <View style={styles.inputShell}>
              <View style={styles.inputPrefix}>
                <SFIcon name="building.2" size={16} color={lightPalette.text.secondary} />
              </View>
              <TextInput
                style={styles.input}
                placeholder="your-company"
                placeholderTextColor={lightPalette.text.disabled}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="organizationName"
                autoComplete="off"
                value={subdomain}
                onChangeText={(value) => setSubdomain(value.toLowerCase())}
                editable={!loading}
              />
              <View style={styles.domainSuffix}>
                <Text style={styles.domainSuffixText}>.transformar.work</Text>
              </View>
            </View>
            <Text style={styles.fieldHint}>
              This keeps mobile pinned to the correct organization context.
            </Text>
          </View>

          <View style={styles.cardSeparator} />

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Account ID</Text>
            <View style={styles.inputShell}>
              <View style={styles.inputPrefix}>
                <SFIcon name="person.crop.rectangle" size={16} color={lightPalette.text.secondary} />
              </View>
              <TextInput
                style={styles.input}
                placeholder="badge number or username"
                placeholderTextColor={lightPalette.text.disabled}
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                autoComplete="username"
                importantForAutofill="yes"
                value={loginIdentifier}
                onChangeText={setLoginIdentifier}
                editable={!loading}
              />
            </View>
          </View>

          <View style={styles.cardSeparator} />

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>PIN</Text>
            <Pressable
              onPress={() => pinInputRef.current?.focus()}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading }}
              style={({ pressed }) => [
                styles.pinField,
                isPinFocused && styles.pinFieldFocused,
                pressed && styles.pinFieldPressed,
              ]}
            >
              <View style={styles.pinRow}>
                {Array.from({ length: PIN_LENGTH }).map((_, index) => {
                  const digit = pin[index] ?? "";
                  const isFilled = digit.length > 0;
                  const activeIndex = Math.min(pin.length, PIN_LENGTH - 1);
                  const isActive = isPinFocused && index === activeIndex;

                  return (
                    <View
                      key={index}
                      style={[
                        styles.pinBox,
                        isActive && styles.pinBoxActive,
                        isFilled && styles.pinBoxFilled,
                      ]}
                    >
                      <Text style={styles.pinDigit}>{digit ? "•" : ""}</Text>
                    </View>
                  );
                })}
              </View>

              <TextInput
                ref={pinInputRef}
                style={styles.pinHiddenInput}
                value={pin}
                onChangeText={handlePinChange}
                keyboardType="number-pad"
                maxLength={PIN_LENGTH}
                secureTextEntry
                caretHidden
                editable={!loading}
                onFocus={() => setIsPinFocused(true)}
                onBlur={() => setIsPinFocused(false)}
                textContentType="password"
                autoComplete="current-password"
                importantForAutofill="yes"
                passwordRules="allowed: digit; minlength: 6; maxlength: 6;"
                selectionColor="transparent"
                cursorColor="transparent"
                accessibilityLabel="PIN"
              />
            </Pressable>

            <Text style={[styles.fieldHint, isPinFocused && styles.fieldHintFocused]}>
              {isPinFocused
                ? "PIN field active. Use the password suggestion above the keyboard if you saved this account ID and PIN."
                : "Tap the boxes to enter your 6-digit PIN or trigger saved password autofill."}
            </Text>
          </View>

          {loading ? <ActivityIndicator size="small" color={lightPalette.primary.main} /> : null}
        </View>

        <View style={styles.footerActions}>
          <Pressable
            onPress={() => router.replace("/(auth)/signin")}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
          >
            <Text style={styles.secondaryButtonText}>Use work email instead</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  scrollContent: {
    flexGrow: 1,
    paddingVertical: 24,
    gap: 16,
  },
  header: {
    paddingHorizontal: mobileLayout.screenPadding,
    gap: 6,
  },
  title: {
    ...mobileTypography.screenTitle,
    color: lightPalette.text.primary,
  },
  subtitle: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  card: {
    marginHorizontal: mobileLayout.screenPadding,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    padding: mobileLayout.cardPadding,
    gap: 16,
  },
  cardSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginHorizontal: -mobileLayout.cardPadding,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    ...mobileTypography.listSecondary,
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
  inputPrefix: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: 48,
    fontSize: 16,
    color: lightPalette.text.primary,
    paddingVertical: 12,
    paddingRight: 12,
  },
  domainSuffix: {
    paddingRight: 14,
    paddingLeft: 8,
  },
  domainSuffixText: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
    fontWeight: "600",
  },
  pinRow: {
    flexDirection: "row",
    gap: 10,
  },
  pinField: {
    gap: 10,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    padding: 10,
    marginHorizontal: -10,
  },
  pinFieldFocused: {
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.primary.main,
  },
  pinFieldPressed: {
    backgroundColor: lightPalette.background.paper,
  },
  pinBox: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.default,
    alignItems: "center",
    justifyContent: "center",
  },
  pinBoxActive: {
    borderColor: lightPalette.primary.main,
    backgroundColor: lightPalette.background.paper,
  },
  pinBoxFilled: {
    borderColor: lightPalette.primary.main,
    backgroundColor: lightPalette.background.paper,
  },
  pinDigit: {
    fontSize: 24,
    fontWeight: "700",
    color: lightPalette.text.primary,
  },
  pinHiddenInput: {
    position: "absolute",
    inset: 0,
    color: "transparent",
    backgroundColor: "transparent",
  },
  fieldHintFocused: {
    color: lightPalette.primary.main,
  },
  footerActions: {
    paddingHorizontal: mobileLayout.screenPadding,
    gap: 10,
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
  secondaryButtonPressed: {
    backgroundColor: lightPalette.background.default,
  },
  secondaryButtonText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.info.main,
    fontWeight: "600",
  },
});
