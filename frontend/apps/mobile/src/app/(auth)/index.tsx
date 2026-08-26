/**
 * Sign in — PIN first.
 *
 * There is no method picker. The screen decides its own shape from what the device
 * remembers, because asking a worker to classify themselves is a question the app can
 * answer for them:
 *
 * - Known device: the remembered person and workspace as text, six boxes, keypad already
 *   up. Six taps and no typing.
 * - Fresh device: workspace, then who you are, then the PIN — revealed one at a time and
 *   each validated at its own step, so a mistyped workspace fails at the workspace, not
 *   after six digits.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { parseCanonicalResourceLink } from "@tech-office/links";
import {
  AccountLockedError,
  getOrganizationBySubdomain,
  getProfile,
  loginWithPIN,
  PIN_LENGTH,
  setAuthToken,
} from "apis";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import { AuthContext } from "@/hooks/use-auth";
import { SessionErrorBanner } from "@/components/auth/session-error-banner";
import { SFIcon } from "@/components/ui/sf-icon";
import { buildWebUrl, WEB_BASE_URL, WEB_HOSTNAME } from "@/lib/constants";
import {
  peekPendingAuthSubdomain,
  peekPendingPostSignInRedirect,
  setPendingPostSignInRedirect,
} from "@/lib/auth-redirect-handoff";
import {
  clearRememberedAuth,
  getRememberedAuthDisplayName,
  getRememberedAuthLoginIdentifier,
  getRememberedAuthSubdomain,
  rememberAuthDisplayName,
  rememberAuthLoginIdentifier,
  rememberAuthSubdomain,
} from "@/lib/auth-subdomain-storage";

/** The fresh-device sequence, in the order it is revealed. */
type Step = "workspace" | "identifier" | "pin";

interface RememberedDevice {
  subdomain: string;
  identifier: string;
  displayName: string;
}

/** Everything the known-device screen needs, or null if any part is missing. */
function readRememberedDevice(): RememberedDevice | null {
  const subdomain = getRememberedAuthSubdomain();
  const identifier = getRememberedAuthLoginIdentifier();
  const displayName = getRememberedAuthDisplayName();

  if (!subdomain || !identifier || !displayName) {
    return null;
  }
  return { subdomain, identifier, displayName };
}

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** "4:32" — a countdown a person can read at a glance. */
function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function SignInScreen() {
  const router = useRouter();
  const auth = React.use(AuthContext);
  const params = useLocalSearchParams<{
    canonicalSignIn?: string;
    postSignIn?: string;
    redirect?: string;
    subdomain?: string;
  }>();

  const pinInputRef = useRef<TextInput>(null);

  // Read once on mount: the device's memory does not change while this screen is up,
  // except through "Not you?", which sets this to null explicitly.
  const [remembered, setRemembered] = useState<RememberedDevice | null>(readRememberedDevice);

  const deepLinkSubdomain =
    typeof params.subdomain === "string" && params.subdomain
      ? params.subdomain
      : (peekPendingAuthSubdomain() ?? "");

  const [workspace, setWorkspace] = useState(deepLinkSubdomain);
  const [workspaceName, setWorkspaceName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<Step>(deepLinkSubdomain ? "identifier" : "workspace");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lockedUntilSeconds, setLockedUntilSeconds] = useState<number | null>(null);

  const isKnownDevice = remembered !== null;

  // A deep link that arrives while the sign-in screen is already open still has to be
  // honoured after the user authenticates, so it is parked rather than followed.
  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const normalized = normalizeCanonicalOpenUrl(url);
      const target = parseCanonicalResourceLink(normalized);
      if (!target) {
        return;
      }
      setPendingPostSignInRedirect(normalized, target.tenantKey);
    });

    return () => subscription.remove();
  }, []);

  // Park a redirect handed over by the router before the user got here.
  useEffect(() => {
    const postSignIn =
      typeof params.postSignIn === "string" && params.postSignIn
        ? params.postSignIn
        : params.redirect;
    if (postSignIn || peekPendingPostSignInRedirect()) {
      setPendingPostSignInRedirect(
        postSignIn || peekPendingPostSignInRedirect(),
        deepLinkSubdomain || undefined,
      );
    }
    // Only on mount: params do not change while this screen is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The keypad is up before the user touches anything — SC-001 counts six taps, and a tap
  // to raise the keyboard would be a seventh.
  useEffect(() => {
    if (isKnownDevice || step === "pin") {
      const focus = setTimeout(() => pinInputRef.current?.focus(), 100);
      return () => clearTimeout(focus);
    }
  }, [isKnownDevice, step]);

  // Tick the lockout countdown down to zero, then clear it so the user can try again.
  useEffect(() => {
    if (lockedUntilSeconds === null) return;
    if (lockedUntilSeconds <= 0) {
      setLockedUntilSeconds(null);
      setError("");
      return;
    }
    const tick = setTimeout(() => setLockedUntilSeconds((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(tick);
  }, [lockedUntilSeconds]);

  const failed = useCallback((message: string) => {
    setError(message);
    setPin("");
    if (process.env.EXPO_OS === "ios") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, []);

  const activeSubdomain = isKnownDevice ? remembered.subdomain : workspace.trim().toLowerCase();
  const activeIdentifier = isKnownDevice ? remembered.identifier : identifier.trim();

  const submit = useCallback(
    async (enteredPin: string) => {
      auth?.clearAuthError();
      setError("");
      setLoading(true);

      try {
        const result = await loginWithPIN(activeSubdomain, activeIdentifier, enteredPin);

        if (result.pinChangeRequired) {
          rememberAuthSubdomain(activeSubdomain);
          rememberAuthLoginIdentifier(activeIdentifier);
          router.replace({
            pathname: "/(auth)/set-pin",
            params: { subdomain: activeSubdomain, pinChangeToken: result.pinChangeToken },
          });
          return;
        }

        await setAuthToken(result.accessToken, Number(result.expiresAt));

        const org = await getOrganizationBySubdomain(activeSubdomain);
        const profile = await getProfile();
        const membership = profile.organizations.find(
          (item) => item.organizationId === org.id,
        );

        await auth?.signIn({
          token: result.accessToken,
          expiresAt: Number(result.expiresAt),
          organizationId: org.id,
          employeeId: membership?.id ?? profile.user.id,
        });

        // Remember who this device belongs to so the next sign-in is six taps. The display
        // name is what turns recall into recognition; it never identifies anyone to the
        // server.
        rememberAuthSubdomain(activeSubdomain);
        rememberAuthLoginIdentifier(activeIdentifier);
        rememberAuthDisplayName(profile.user.displayName || org.companyName);

        router.replace("/(app)/(chat)");
      } catch (err) {
        if (err instanceof AccountLockedError) {
          if (err.retrySeconds !== undefined) {
            setLockedUntilSeconds(err.retrySeconds);
            failed("");
          } else {
            setLockedUntilSeconds(null);
            failed(
              "Your account is locked. Ask your manager to unlock it, or sign in with your email and password.",
            );
          }
          return;
        }
        failed(
          err instanceof Error && err.message
            ? err.message
            : "That PIN didn't work. Try again.",
        );
      } finally {
        setLoading(false);
      }
    },
    [activeIdentifier, activeSubdomain, auth, failed, router],
  );

  const handlePinChange = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(cleaned);
    if (error) setError("");

    if (cleaned.length === PIN_LENGTH && !loading && lockedUntilSeconds === null) {
      if (process.env.EXPO_OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      void submit(cleaned);
    }
  };

  // The workspace is checked at its own step, so a spelling mistake is reported where it
  // was made rather than as a generic failure six digits later.
  const confirmWorkspace = async () => {
    const candidate = workspace.trim().toLowerCase();
    if (!candidate) {
      setError("Enter the workspace your manager gave you.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const org = await getOrganizationBySubdomain(candidate);
      setWorkspaceName(org.companyName);
      setWorkspace(candidate);
      setStep("identifier");
    } catch {
      setError("We couldn't find that workspace. Check the spelling with your manager.");
    } finally {
      setLoading(false);
    }
  };

  const confirmIdentifier = () => {
    if (!identifier.trim()) {
      setError("Enter your ID or the email address you use for work.");
      return;
    }
    setError("");
    setStep("pin");
  };

  const notYou = () => {
    clearRememberedAuth();
    setRemembered(null);
    setPin("");
    setError("");
    setLockedUntilSeconds(null);
    setStep("workspace");
  };

  const lockoutMessage = useMemo(() => {
    if (lockedUntilSeconds === null) return "";
    return `Too many tries. Wait ${formatCountdown(lockedUntilSeconds)}, then try again.`;
  }, [lockedUntilSeconds]);

  const bannerMessage = lockoutMessage || error;
  const pinDisabled = loading || lockedUntilSeconds !== null;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.screen}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Stack.Screen options={{ title: "Sign in" }} />

        {auth?.authErrorMessage ? (
          <SessionErrorBanner
            message={auth.authErrorMessage}
            onDismiss={auth.clearAuthError}
          />
        ) : null}

        {isKnownDevice ? (
          <View style={styles.card}>
            <View style={styles.person}>
              <View style={styles.avatar} testID="signin-avatar">
                <Text style={styles.avatarText}>{initials(remembered.displayName)}</Text>
              </View>
              <Text style={styles.personName} selectable testID="signin-display-name">
                {remembered.displayName}
              </Text>
              <Text style={styles.personWorkspace} selectable testID="signin-workspace-name">
                {remembered.subdomain}
              </Text>
            </View>

            <PinBoxes
              pin={pin}
              disabled={pinDisabled}
              inputRef={pinInputRef}
              onChange={handlePinChange}
              label="Enter your PIN"
            />

            {loading ? (
              <ActivityIndicator size="small" color={lightPalette.primary.main} />
            ) : null}

            {bannerMessage ? <InlineError message={bannerMessage} /> : null}

            <Pressable
              onPress={notYou}
              style={({ pressed }) => [styles.quietAction, pressed && styles.quietActionPressed]}
              testID="signin-not-you"
            >
              <Text style={styles.quietActionText}>Not you?</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            {/* Workspace */}
            {step === "workspace" ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.stepTitle}>Where do you work?</Text>
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
                    autoFocus
                    returnKeyType="next"
                    value={workspace}
                    onChangeText={(value) => setWorkspace(value.toLowerCase())}
                    onSubmitEditing={confirmWorkspace}
                    editable={!loading}
                    testID="signin-workspace-input"
                  />
                </View>
                <PrimaryButton
                  label="Continue"
                  loading={loading}
                  onPress={confirmWorkspace}
                  testID="signin-workspace-continue"
                />
              </View>
            ) : (
              <AnsweredStep
                value={workspaceName || workspace}
                onEdit={() => {
                  setStep("workspace");
                  setError("");
                }}
                testID="signin-workspace-answered"
              />
            )}

            {/* Identifier */}
            {step === "identifier" ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.stepTitle}>Who are you?</Text>
                <View style={styles.inputShell}>
                  <View style={styles.inputPrefix}>
                    <SFIcon
                      name="person.crop.rectangle"
                      size={16}
                      color={lightPalette.text.secondary}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Your ID or work email"
                    placeholderTextColor={lightPalette.text.disabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    returnKeyType="next"
                    textContentType="username"
                    autoComplete="username"
                    value={identifier}
                    onChangeText={setIdentifier}
                    onSubmitEditing={confirmIdentifier}
                    editable={!loading}
                    testID="signin-identifier-input"
                  />
                </View>
                <PrimaryButton
                  label="Continue"
                  loading={false}
                  onPress={confirmIdentifier}
                  testID="signin-identifier-continue"
                />
              </View>
            ) : step === "pin" ? (
              <AnsweredStep
                value={identifier}
                onEdit={() => {
                  setStep("identifier");
                  setPin("");
                  setError("");
                }}
                testID="signin-identifier-answered"
              />
            ) : null}

            {/* PIN */}
            {step === "pin" ? (
              <View style={styles.fieldGroup}>
                <PinBoxes
                  pin={pin}
                  disabled={pinDisabled}
                  inputRef={pinInputRef}
                  onChange={handlePinChange}
                  label="Enter your PIN"
                />
                {loading ? (
                  <ActivityIndicator size="small" color={lightPalette.primary.main} />
                ) : null}
              </View>
            ) : null}

            {bannerMessage ? <InlineError message={bannerMessage} /> : null}
          </View>
        )}

        <View style={styles.footerActions}>
          <Pressable
            onPress={() => router.push("/(auth)/signin")}
            style={({ pressed }) => [styles.quietAction, pressed && styles.quietActionPressed]}
            testID="signin-with-email"
          >
            <Text style={styles.quietActionText}>Sign in with email</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/(auth)/signup")}
            style={({ pressed }) => [styles.quietAction, pressed && styles.quietActionPressed]}
            testID="signin-create-workspace"
          >
            <Text style={styles.quietActionText}>Create a workspace</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Six boxes over an invisible numeric field. The boxes are the affordance; the field is
 * what the keyboard talks to.
 */
function PinBoxes({
  pin,
  disabled,
  inputRef,
  onChange,
  label,
}: {
  pin: string;
  disabled: boolean;
  inputRef: React.RefObject<TextInput | null>;
  onChange: (value: string) => void;
  label: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.stepTitle}>{label}</Text>
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        style={styles.pinField}
        testID="pin-boxes"
      >
        <View style={styles.pinRow}>
          {Array.from({ length: PIN_LENGTH }).map((_, index) => {
            const filled = index < pin.length;
            const active = focused && index === Math.min(pin.length, PIN_LENGTH - 1);
            return (
              <View
                key={index}
                style={[
                  styles.pinBox,
                  active && styles.pinBoxActive,
                  filled && styles.pinBoxFilled,
                ]}
              >
                <Text style={styles.pinDigit}>{filled ? "•" : ""}</Text>
              </View>
            );
          })}
        </View>

        <TextInput
          ref={inputRef}
          style={styles.pinHiddenInput}
          value={pin}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={PIN_LENGTH}
          secureTextEntry
          caretHidden
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          textContentType="password"
          autoComplete="current-password"
          importantForAutofill="yes"
          passwordRules={`allowed: digit; minlength: ${PIN_LENGTH}; maxlength: ${PIN_LENGTH};`}
          selectionColor="transparent"
          cursorColor="transparent"
          accessibilityLabel={label}
          testID="pin-input"
        />
      </Pressable>
    </View>
  );
}

/** A finished step, collapsed to one line with a way back to it. */
function AnsweredStep({
  value,
  onEdit,
  testID,
}: {
  value: string;
  onEdit: () => void;
  testID: string;
}) {
  return (
    <View style={styles.answeredRow} testID={testID}>
      <SFIcon name="checkmark.circle.fill" size={16} color={lightPalette.success.main} />
      <Text style={styles.answeredValue} numberOfLines={1} selectable>
        {value}
      </Text>
      <Pressable
        onPress={onEdit}
        hitSlop={12}
        style={({ pressed }) => [pressed && styles.quietActionPressed]}
        testID={`${testID}-edit`}
      >
        <Text style={styles.answeredEdit}>Edit</Text>
      </Pressable>
    </View>
  );
}

/**
 * Failures are shown in place. A modal alert would dismiss the keyboard and cost the user
 * an extra tap to get back to the state they were already in.
 */
function InlineError({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner} testID="signin-error">
      <SFIcon name="exclamationmark.circle.fill" size={16} color={lightPalette.error.main} />
      <Text style={styles.errorText} selectable>
        {message}
      </Text>
    </View>
  );
}

function PrimaryButton({
  label,
  loading,
  onPress,
  testID,
}: {
  label: string;
  loading: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.primaryButtonPressed,
        loading && styles.primaryButtonDisabled,
      ]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

function normalizeCanonicalOpenUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "techoffice:") {
      return raw;
    }
    if (url.hostname === WEB_HOSTNAME) {
      return buildWebUrl(`${url.pathname}${url.search}`);
    }
    const path = url.pathname && url.pathname !== "/" ? url.pathname : `/${url.hostname}`;
    return buildWebUrl(`${path}${url.search}`);
  } catch {
    return raw.replace(/^techoffice:\/\//, WEB_BASE_URL);
  }
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
  person: {
    alignItems: "center",
    gap: 6,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.main,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "700",
    color: lightPalette.primary.contrastText,
  },
  personName: {
    ...mobileTypography.screenTitle,
    color: lightPalette.text.primary,
    textAlign: "center",
  },
  personWorkspace: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
    textAlign: "center",
  },
  fieldGroup: {
    gap: 10,
  },
  stepTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
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
  answeredRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.iconTextGap,
    minHeight: 44,
  },
  answeredValue: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
    flex: 1,
  },
  answeredEdit: {
    ...mobileTypography.listSecondary,
    color: lightPalette.info.main,
    fontWeight: "600",
  },
  pinRow: {
    flexDirection: "row",
    gap: 10,
  },
  pinField: {
    gap: 10,
  },
  pinBox: {
    flex: 1,
    minHeight: 56,
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
    borderWidth: border.medium,
  },
  pinBoxFilled: {
    borderColor: lightPalette.primary.main,
    backgroundColor: lightPalette.background.paper,
  },
  pinDigit: {
    fontSize: 26,
    fontWeight: "700",
    color: lightPalette.text.primary,
  },
  pinHiddenInput: {
    position: "absolute",
    inset: 0,
    color: "transparent",
    backgroundColor: "transparent",
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
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: lightPalette.primary.main,
    alignItems: "center",
    justifyContent: "center",
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
  footerActions: {
    paddingHorizontal: mobileLayout.screenPadding,
    gap: mobileLayout.itemGap,
  },
  quietAction: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  quietActionPressed: {
    opacity: 0.6,
  },
  quietActionText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.info.main,
    fontWeight: "600",
  },
});
