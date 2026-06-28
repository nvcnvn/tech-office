/**
 * Sign In screen
 *
 * Email + password login with form validation using shared validations package.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import {
  login,
  exchangeTokenForOrganization,
  getOrganizationBySubdomain,
  getProfile,
} from "apis";
import { AuthContext } from "@/hooks/use-auth";
import { SessionErrorBanner } from "@/components/auth/session-error-banner";
import { SFIcon } from "@/components/ui/sf-icon";
import { Image } from "expo-image";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import {
  getRememberedAuthEmail,
  getRememberedAuthSubdomain,
  rememberAuthEmail,
  rememberAuthSubdomain,
} from "../../lib/auth-subdomain-storage";
import { getCanonicalInAppRoute } from "../../lib/canonical-links";
import { consumePendingAuthSubdomain, consumePendingPostSignInRedirect } from "../../lib/auth-redirect-handoff";

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_IOS_CLIENT_ID =
  "751712281610-7o8j91k1b6kqpnp6a6mt1g95sfk6h9fv.apps.googleusercontent.com";
const GOOGLE_ANDROID_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

interface SignInForm {
  email: string;
  password: string;
  subdomain: string;
}

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ postSignIn?: string; redirect?: string; subdomain?: string }>();
  const auth = React.use(AuthContext);
  const [loading, setLoading] = useState(false);
  const [ssoLoadingProvider, setSsoLoadingProvider] = useState<
    "google" | "apple" | null
  >(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const emailInputRef = React.useRef<TextInput>(null);
  const passwordInputRef = React.useRef<TextInput>(null);

  const { control, handleSubmit, formState, setValue, getValues } = useForm<SignInForm>({
    defaultValues: { email: "", password: "", subdomain: "" },
  });

  const [googleRequest, googleResponse, promptGoogleSignIn] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    selectAccount: true,
  });

  const [pendingPostSignInRedirect] = useState(() => consumePendingPostSignInRedirect());
  const [pendingAuthSubdomain] = useState(() => consumePendingAuthSubdomain());
  const postSignInTarget = pendingPostSignInRedirect || (typeof params.postSignIn === "string" && params.postSignIn ? params.postSignIn : params.redirect);
  const redirectTarget = typeof postSignInTarget === "string" && postSignInTarget ? postSignInTarget : "/(app)/(chat)";
  const requestedSubdomain = typeof params.subdomain === "string" ? params.subdomain.trim().toLowerCase() : pendingAuthSubdomain ?? "";

  async function resolvePostSignInRedirect(authToken?: string | null): Promise<string> {
    return (await getCanonicalInAppRoute(redirectTarget, { authToken })) ?? redirectTarget;
  }

  useEffect(() => {
    const rememberedEmail = getRememberedAuthEmail();
    const rememberedSubdomain = getRememberedAuthSubdomain();
    const initialSubdomain = requestedSubdomain || rememberedSubdomain;

    if (rememberedEmail) {
      setValue("email", rememberedEmail);
    }

    if (initialSubdomain) {
      setValue("subdomain", initialSubdomain);
    }
  }, [requestedSubdomain, setValue]);

  useEffect(() => {
    if (googleResponse?.type !== "success") {
      if (googleResponse?.type === "error") {
        setSsoLoadingProvider(null);
        Alert.alert("Google Sign In Failed", "Google sign-in did not complete.");
      }
      return;
    }

    const idToken = googleResponse.authentication?.idToken;
    if (!idToken) {
      setSsoLoadingProvider(null);
      Alert.alert(
        "Google Sign In Failed",
        "Google did not return an ID token for this app."
      );
      return;
    }

    void completeSSOSignIn("google", idToken);
  }, [googleResponse]);

  const onSubmit = async (data: SignInForm) => {
    if (!auth) return;
    auth.clearAuthError();
    setLoading(true);
    try {
      const normalizedSubdomain = data.subdomain.trim().toLowerCase();

      // Resolve subdomain → org UUID (mirrors web OrgSelector flow)
      const org = await getOrganizationBySubdomain(normalizedSubdomain);

      const result = await login(
        data.email,
        data.password,
        org.id,
      );

      // Fetch full profile to get the membership ID (employee ID within org)
      const profile = await getProfile();
      const membership = profile.organizations.find(
        (m) => m.organizationId === org.id
      );

      await auth.signIn({
        token: result.accessToken,
        expiresAt: result.expiresAt,
        organizationId: org.id,
        employeeId: membership?.id ?? result.user?.id ?? "",
      });
      rememberAuthEmail(data.email);
      rememberAuthSubdomain(normalizedSubdomain);

      router.replace(await resolvePostSignInRedirect(result.accessToken));
    } catch (err) {
      Alert.alert(
        "Sign In Failed",
        err instanceof Error ? err.message : "An error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  const completeSSOSignIn = async (
    provider: "google" | "apple",
    idToken: string
  ) => {
    if (!auth) return;

    auth.clearAuthError();

    try {
      const normalizedSubdomain = getValues("subdomain").trim().toLowerCase();
      if (!normalizedSubdomain) {
        throw new Error("Workspace subdomain is required before using SSO.");
      }

      const org = await getOrganizationBySubdomain(normalizedSubdomain);
      const result = await exchangeTokenForOrganization(
        provider,
        idToken,
        org.id
      );

      const profile = await getProfile();
      const membership = profile.organizations.find(
        (item) => item.organizationId === org.id
      );

      await auth.signIn({
        token: result.accessToken,
        expiresAt: result.expiresAt,
        organizationId: org.id,
        employeeId: membership?.id ?? result.user.id,
      });
      rememberAuthSubdomain(normalizedSubdomain);
      router.replace(await resolvePostSignInRedirect(result.accessToken));
    } catch (err) {
      Alert.alert(
        provider === "apple" ? "Apple Sign In Failed" : "Google Sign In Failed",
        err instanceof Error ? err.message : "An error occurred"
      );
    } finally {
      setSsoLoadingProvider(null);
    }
  };

  const onAppleSignIn = async () => {
    if (!auth) return;

    if (Platform.OS !== "ios") {
      Alert.alert(
        "Apple Sign In Unavailable",
        "Apple sign-in is only available on iOS devices."
      );
      return;
    }

    const isAvailable = await AppleAuthentication.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert(
        "Apple Sign In Unavailable",
        "This iOS build does not have Sign in with Apple enabled yet. Rebuild the app after syncing native changes."
      );
      return;
    }

    setSsoLoadingProvider("apple");

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error("Apple did not return an identity token.");
      }

      await completeSSOSignIn("apple", credential.identityToken);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === "The authorization attempt was canceled."
      ) {
        setSsoLoadingProvider(null);
        return;
      }

      setSsoLoadingProvider(null);
      Alert.alert(
        "Apple Sign In Failed",
        err instanceof Error ? err.message : "An error occurred"
      );
    }
  };

  const onGoogleSignIn = async () => {
    if (!auth) return;

    if (Platform.OS === "android" && !GOOGLE_ANDROID_CLIENT_ID) {
      Alert.alert(
        "Google Sign In Unavailable",
        "Google sign-in for Android still needs EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in the app environment."
      );
      return;
    }

    if (!googleRequest) {
      Alert.alert(
        "Google Sign In Unavailable",
        "Google sign-in is still initializing. Try again in a moment."
      );
      return;
    }

    const normalizedSubdomain = getValues("subdomain").trim().toLowerCase();
    if (!normalizedSubdomain) {
      Alert.alert(
        "Workspace Required",
        "Enter your workspace subdomain before continuing with Google sign-in."
      );
      return;
    }

    setSsoLoadingProvider("google");

    const result = await promptGoogleSignIn();
    if (result.type !== "success") {
      setSsoLoadingProvider(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ title: "Sign In" }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        {auth?.authErrorMessage ? (
          <SessionErrorBanner
            message={auth.authErrorMessage}
            onDismiss={auth.clearAuthError}
          />
        ) : null}

        <View style={styles.header}>
          <Text style={styles.title}>Sign in to your workspace</Text>
          <Text style={styles.subtitle}>
            Access chat, tasks, calendar, and notifications from one secure mobile hub.
          </Text>
        </View>

        {/* Workspace subdomain + Email + Password */}
        <View style={styles.card}>
          <Controller
            control={control}
            name="subdomain"
            rules={{ required: "Subdomain is required" }}
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={styles.fieldGroup}>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.fieldLabel}>Workspace subdomain</Text>
                  <Text style={styles.fieldHint}>Required</Text>
                </View>
                <View style={styles.inputShell}>
                  <View style={styles.inputPrefix}>
                    <SFIcon name="building.2" size={15} color={lightPalette.text.secondary} />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="your-company"
                    placeholderTextColor={lightPalette.text.disabled}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    returnKeyType="next"
                    submitBehavior="submit"
                    testID="subdomain-input"
                    value={value}
                    onChangeText={(nextValue) => onChange(nextValue.toLowerCase())}
                    onBlur={onBlur}
                    onSubmitEditing={() => {
                      emailInputRef.current?.focus();
                    }}
                  />
                  <View style={styles.domainSuffix}>
                    <Text style={styles.domainSuffixText}>.transformar.work</Text>
                  </View>
                </View>
                {formState.errors.subdomain ? (
                  <Text style={styles.errorText}>{formState.errors.subdomain.message}</Text>
                ) : (
                  <Text style={styles.supportText}>
                    This keeps mobile pinned to the correct organization context.
                  </Text>
                )}
              </View>
            )}
          />

          <View style={styles.cardSeparator} />
          <Controller
            control={control}
            name="email"
            rules={{ required: "Email is required" }}
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Work email</Text>
                <View style={styles.inputShell}>
                  <View style={styles.inputPrefix}>
                    <SFIcon name="envelope" size={15} color={lightPalette.text.secondary} />
                  </View>
                  <TextInput
                    ref={emailInputRef}
                    style={styles.input}
                    placeholder="you@company.com"
                    placeholderTextColor={lightPalette.text.disabled}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType="next"
                    submitBehavior="submit"
                    testID="email-input"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    onSubmitEditing={() => {
                      passwordInputRef.current?.focus();
                    }}
                  />
                </View>
                {formState.errors.email ? (
                  <Text style={styles.errorText}>{formState.errors.email.message}</Text>
                ) : null}
              </View>
            )}
          />

          <View style={styles.cardSeparator} />

          <Controller
            control={control}
            name="password"
            rules={{ required: "Password is required" }}
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={styles.fieldGroup}>
                <View style={styles.fieldLabelRow}>
                  <Text style={styles.fieldLabel}>Password</Text>
                  <Pressable onPress={() => router.push("/(auth)/forgot-password")}>
                    <Text style={styles.inlineLink}>Forgot password?</Text>
                  </Pressable>
                </View>
                <View style={styles.inputShell}>
                  <View style={styles.inputPrefix}>
                    <SFIcon name="lock.fill" size={15} color={lightPalette.text.secondary} />
                  </View>
                  <TextInput
                    ref={passwordInputRef}
                    style={styles.input}
                    placeholder="••••••••"
                    placeholderTextColor={lightPalette.text.disabled}
                    secureTextEntry={!passwordVisible}
                    textContentType="password"
                    autoComplete="current-password"
                    importantForAutofill="yes"
                    returnKeyType="go"
                    testID="password-input"
                    value={value}
                    onChangeText={onChange}
                    onBlur={onBlur}
                    onSubmitEditing={() => {
                      void handleSubmit(onSubmit)();
                    }}
                  />
                  <Pressable
                    onPress={() => setPasswordVisible((current) => !current)}
                    style={styles.trailingAction}
                  >
                    <SFIcon
                      name={passwordVisible ? "eye.slash" : "eye"}
                      size={16}
                      color={lightPalette.text.secondary}
                    />
                  </Pressable>
                </View>
                {formState.errors.password ? (
                  <Text style={styles.errorText}>{formState.errors.password.message}</Text>
                ) : null}
              </View>
            )}
          />

          <Pressable
            testID="signin-button"
            onPress={handleSubmit(onSubmit)}
            disabled={loading}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              loading && styles.disabledButton,
            ]}
          >
            {loading ? (
              <ActivityIndicator color={lightPalette.primary.contrastText} />
            ) : (
              <>
                <Text style={styles.primaryButtonText}>Sign in</Text>
                <SFIcon name="arrow.right.circle" size={18} color={lightPalette.primary.contrastText} />
              </>
            )}
          </Pressable>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* SSO sign-in */}
        <View style={styles.card}>
          <View style={styles.ssoButtonsRow}>
            <Pressable
              testID="google-sso-button"
              onPress={() => void onGoogleSignIn()}
              disabled={loading || ssoLoadingProvider !== null}
              style={({ pressed }) => [
                styles.ssoButton,
                pressed && styles.ssoButtonPressed,
                (loading || ssoLoadingProvider !== null) && styles.disabledButton,
              ]}
            >
              {ssoLoadingProvider === "google" ? (
                <ActivityIndicator color={lightPalette.primary.main} />
              ) : (
                <>
                  <Image
                    source={require("@/../assets/google-g-logo.png")}
                    style={styles.googleLogo}
                  />
                  <Text style={styles.ssoButtonText}>Continue with Google</Text>
                </>
              )}
            </Pressable>

            {Platform.OS === "ios" ? (
              ssoLoadingProvider === "apple" ? (
                <View style={[styles.ssoButton, styles.ssoButtonDark, { justifyContent: "center" }]}>
                  <ActivityIndicator color="#ffffff" />
                </View>
              ) : (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={radius.lg}
                  style={styles.appleButton}
                  onPress={() => void onAppleSignIn()}
                />
              )
            ) : null}
          </View>

          <Text style={styles.supportText}>
            SSO uses the workspace above. Use the same invited email so the provider identity attaches to the same account.
          </Text>
        </View>

        <View style={styles.footerActions}>
          <Pressable
            onPress={() => router.replace("/(auth)/pin")}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
          >
            <Text style={styles.secondaryButtonText}>Use account ID and PIN instead</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/(auth)/signup")}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
          >
            <Text style={styles.secondaryButtonText}>Create workspace</Text>
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
  sectionLabel: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
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
  trailingAction: {
    width: 44,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  ssoHeader: {
    gap: 4,
  },
  ssoButtonsRow: {
    gap: 10,
  },
  ssoButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderCurve: "continuous",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 14,
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  ssoButtonPressed: {
    backgroundColor: lightPalette.background.default,
  },
  ssoButtonDark: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  ssoButtonDarkPressed: {
    backgroundColor: "#030712",
  },
  appleButton: {
    height: 48,
    width: "100%",
  },
  ssoButtonText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
    fontWeight: "600",
  },
  ssoButtonTextLight: {
    ...mobileTypography.listPrimary,
    color: "#ffffff",
    fontWeight: "600",
  },
  googleLogo: {
    width: 20,
    height: 20,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: mobileLayout.screenPadding,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
  },
  dividerText: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: lightPalette.primary.main,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  primaryButtonPressed: {
    backgroundColor: lightPalette.primary.dark,
  },
  primaryButtonText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.primary.contrastText,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.5,
  },
  inlineLink: {
    ...mobileTypography.caption,
    color: lightPalette.info.main,
    fontWeight: "600",
  },
  supportText: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
    lineHeight: 18,
  },
  errorText: {
    ...mobileTypography.caption,
    color: lightPalette.error.main,
    lineHeight: 18,
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
    color: lightPalette.text.primary,
    fontWeight: "600",
  },
});
