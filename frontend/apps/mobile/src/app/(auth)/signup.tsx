/**
 * Create a workspace — owner signup.
 *
 * Four questions, all of which an SMB owner can answer about their own business. The
 * workspace address is derived from the company name and shown as an explanation of where
 * the team will sign in, never as an empty field the owner has to invent a value for. The
 * word "subdomain" does not appear.
 *
 * Registration returns no session, so this screen chains register -> sign in behind one
 * spinner and reports the two halves differently: a failed sign-in after a created
 * workspace must not read as a failed signup, because retrying signup would then collide
 * on the address the owner just claimed.
 */

import React, { useEffect, useState } from "react";
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
import { Stack, useRouter } from "expo-router";
import {
  checkSubdomainAvailable,
  deriveSubdomain,
  fieldViolation,
  getOrganizationBySubdomain,
  getProfile,
  isValidSubdomain,
  login,
  normalizeSubdomain,
  registerOrganization,
  TERMS_VERSION,
} from "apis";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import { AuthContext } from "@/hooks/use-auth";
import { SFIcon } from "@/components/ui/sf-icon";
import { TermsAcceptance } from "@/components/compliance/terms-acceptance";
import {
  rememberAuthDisplayName,
  rememberAuthEmail,
  rememberAuthLoginIdentifier,
  rememberAuthSubdomain,
} from "@/lib/auth-subdomain-storage";
import { beginOnboarding } from "@/lib/onboarding-progress";

/** Matches the backend bcrypt minimum. Stated before submit, not discovered on rejection. */
const PASSWORD_MIN_LENGTH = 8;

/** Split a person's full name the way the API wants it. */
function splitName(fullName: string): { givenName: string; familyName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "", familyName: "" };
  if (parts.length === 1) return { givenName: parts[0], familyName: parts[0] };
  return { givenName: parts[0], familyName: parts.slice(1).join(" ") };
}

export default function SignUpScreen() {
  const router = useRouter();
  const auth = React.use(AuthContext);

  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [address, setAddress] = useState("");
  const [addressEdited, setAddressEdited] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressNote, setAddressNote] = useState("");
  const [suggestion, setSuggestion] = useState("");
  const [checkingAddress, setCheckingAddress] = useState(false);

  const [loading, setLoading] = useState(false);
  // Feature 036 (FR-010): an account cannot be created without an explicit
  // acknowledgement, so this gates validate() as well as the request payload.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  // The address follows the company name until the owner takes it over.
  useEffect(() => {
    if (addressEdited) return;
    setAddress(deriveSubdomain(companyName));
    setAddressNote("");
    setSuggestion("");
  }, [companyName, addressEdited]);

  // Availability is checked when the owner leaves the field, and never blocks the form:
  // a taken address produces an offer, not a wall.
  const checkAddress = async () => {
    const candidate = normalizeSubdomain(address);
    if (!candidate) return;

    if (!isValidSubdomain(candidate)) {
      setAddressNote(
        "Use 3 or more letters, numbers or hyphens, starting and ending with a letter or number.",
      );
      setSuggestion("");
      return;
    }

    setCheckingAddress(true);
    try {
      const result = await checkSubdomainAvailable(candidate);
      if (result.available) {
        setAddressNote("");
        setSuggestion("");
      } else {
        setSuggestion(result.suggested);
        setAddressNote(
          result.suggested
            ? "That address is taken."
            : "That address is taken. Try a different one.",
        );
      }
    } catch {
      // A failed check must not stop the owner. The server validates again on submit.
      setAddressNote("");
      setSuggestion("");
    } finally {
      setCheckingAddress(false);
    }
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!companyName.trim()) errors.companyName = "Tell us your business name.";
    if (!ownerName.trim()) errors.ownerName = "Tell us your name.";
    if (!email.trim()) errors.email = "We need an email address to reach you.";
    else if (!email.includes("@")) errors.email = "That doesn't look like an email address.";
    if (password.length < PASSWORD_MIN_LENGTH) {
      errors.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (!isValidSubdomain(address)) {
      errors.address =
        "Pick a workspace address of 3 or more letters, numbers or hyphens.";
    }
    if (!acceptedTerms) {
      errors.acceptedTerms = "Please read and agree to the terms and privacy policy.";
    }

    setFieldError(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async () => {
    setError("");
    if (!validate()) return;

    const subdomain = normalizeSubdomain(address);
    const normalizedEmail = email.trim().toLowerCase();
    const { givenName, familyName } = splitName(ownerName);

    setLoading(true);

    // Half one: create the workspace.
    try {
      await registerOrganization({
        companyName: companyName.trim(),
        subdomain,
        adminEmail: normalizedEmail,
        adminPassword: password,
        adminGivenName: givenName,
        adminFamilyName: familyName,
        // validate() blocks submission unless the box is ticked, so reaching here
        // means this person acknowledged the current terms on this screen.
        acceptedTermsVersion: TERMS_VERSION,
      });
    } catch (err) {
      const taken = fieldViolation(err, "subdomain");
      if (taken) {
        setFieldError({ address: `That address is ${taken}. Pick another one.` });
        void checkAddress();
      } else {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "We couldn't create your workspace. Try again.",
        );
      }
      setLoading(false);
      return;
    }

    // The workspace now exists. From here a failure is a sign-in failure, and the owner
    // must be told so — retrying signup would collide on the address they just claimed.
    beginOnboarding(subdomain);

    try {
      const result = await login(normalizedEmail, password);
      const org = await getOrganizationBySubdomain(subdomain);
      const profile = await getProfile();
      const membership = profile.organizations.find(
        (item) => item.organizationId === org.id,
      );

      await auth?.signIn({
        token: result.accessToken,
        expiresAt: result.expiresAt,
        organizationId: org.id,
        employeeId: membership?.id ?? profile.user.id,
      });

      rememberAuthSubdomain(subdomain);
      rememberAuthEmail(normalizedEmail);
      rememberAuthLoginIdentifier(normalizedEmail);
      rememberAuthDisplayName(profile.user.displayName || ownerName.trim());

      router.replace("/(onboarding)/set-pin");
    } catch {
      setError(
        "Your workspace is ready, but we couldn't sign you in. Try signing in with your email.",
      );
    } finally {
      setLoading(false);
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
        <Stack.Screen options={{ title: "Create a workspace" }} />

        <View style={styles.card}>
          <Field
            label="What's your business called?"
            placeholder="Anna's Café"
            value={companyName}
            onChangeText={setCompanyName}
            autoCapitalize="words"
            error={fieldError.companyName}
            editable={!loading}
            testID="signup-company-name"
          />

          {address || editingAddress ? (
            <View style={styles.addressBlock} testID="signup-address-block">
              {editingAddress ? (
                <>
                  <Text style={styles.addressLabel}>Your team will sign in at</Text>
                  <View style={styles.inputShell}>
                    <TextInput
                      style={styles.input}
                      value={address}
                      onChangeText={(value) => {
                        setAddressEdited(true);
                        setAddress(value.toLowerCase());
                      }}
                      onBlur={checkAddress}
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                      editable={!loading}
                      testID="signup-address-input"
                    />
                  </View>
                </>
              ) : (
                <View style={styles.addressRow}>
                  <SFIcon
                    name="building.2"
                    size={16}
                    color={lightPalette.text.secondary}
                  />
                  <View style={styles.addressText}>
                    <Text style={styles.addressLabel}>Your team will sign in at</Text>
                    <Text style={styles.addressValue} selectable testID="signup-address-value">
                      {address}
                    </Text>
                  </View>
                  {checkingAddress ? (
                    <ActivityIndicator size="small" color={lightPalette.text.secondary} />
                  ) : (
                    <Pressable
                      onPress={() => {
                        setAddressEdited(true);
                        setEditingAddress(true);
                      }}
                      hitSlop={12}
                      testID="signup-address-change"
                    >
                      <Text style={styles.linkText}>Change</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {addressNote ? (
                <Text style={styles.addressNote} selectable testID="signup-address-note">
                  {addressNote}
                </Text>
              ) : null}

              {suggestion ? (
                <Pressable
                  onPress={() => {
                    setAddressEdited(true);
                    setAddress(suggestion);
                    setSuggestion("");
                    setAddressNote("");
                    setEditingAddress(false);
                  }}
                  style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
                  testID="signup-address-suggestion"
                >
                  <Text style={styles.suggestionText}>Use {suggestion} instead</Text>
                </Pressable>
              ) : null}

              {fieldError.address ? (
                <Text style={styles.fieldError} selectable>
                  {fieldError.address}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Field
            label="What's your name?"
            placeholder="Anna Nguyen"
            value={ownerName}
            onChangeText={setOwnerName}
            autoCapitalize="words"
            error={fieldError.ownerName}
            editable={!loading}
            testID="signup-owner-name"
          />

          <Field
            label="Your email"
            placeholder="anna@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            textContentType="emailAddress"
            error={fieldError.email}
            editable={!loading}
            testID="signup-email"
          />

          <Field
            label="Choose a password"
            placeholder="At least 8 characters"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. You'll use this and your email if you ever forget your PIN.`}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            secureTextEntry
            // Deliberately `password`, not `newPassword`. This password is the owner's
            // only way back in when their PIN is locked (spec FR-010), so they have to be
            // able to reproduce it — a value that lives only in one device's keychain is
            // the wrong default here.
            //
            // Note this does NOT stop iOS offering a generated password: on iOS 18 the
            // automatic-strong-password cover view is chosen heuristically from the
            // surrounding signup form, and neither `password` nor an explicit
            // `autoComplete`/`passwordRules` suppresses it. Only a full AutoFill opt-out
            // (`textContentType="none"`) does, at the cost of password-manager fill.
            // That overlay is why `.maestro/onboarding/owner-signup.yaml` cannot drive
            // this field on a simulator.
            textContentType="password"
            error={fieldError.password}
            editable={!loading}
            testID="signup-password"
          />

          <TermsAcceptance
            accepted={acceptedTerms}
            onChange={(next) => {
              setAcceptedTerms(next);
              if (next) {
                setFieldError((prev) => {
                  const { acceptedTerms: _removed, ...rest } = prev;
                  return rest;
                });
              }
            }}
            disabled={loading}
            error={fieldError.acceptedTerms}
          />

          {error ? (
            <View style={styles.errorBanner} testID="signup-error">
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
            onPress={submit}
            disabled={loading}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.primaryButtonPressed,
              loading && styles.primaryButtonDisabled,
            ]}
            testID="signup-submit"
          >
            {loading ? (
              <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
            ) : (
              <Text style={styles.primaryButtonText}>Create workspace</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footerActions}>
          <Pressable
            onPress={() => router.replace("/(auth)")}
            style={({ pressed }) => [styles.quietAction, pressed && styles.pressed]}
            testID="signup-back-to-signin"
          >
            <Text style={styles.linkText}>Already have a workspace? Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  hint,
  error,
  testID,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  hint?: string;
  error?: string;
  testID: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputShell}>
        <TextInput
          style={styles.input}
          placeholderTextColor={lightPalette.text.disabled}
          autoCorrect={false}
          testID={testID}
          {...inputProps}
        />
      </View>
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? (
        <Text style={styles.fieldError} selectable testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
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
  fieldError: {
    ...mobileTypography.caption,
    color: lightPalette.error.main,
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
  addressBlock: {
    gap: 8,
    padding: 12,
    marginTop: -8,
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: lightPalette.background.default,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.iconTextGap,
    minHeight: 44,
  },
  addressText: {
    flex: 1,
    gap: 2,
  },
  addressLabel: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
  },
  addressValue: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
    fontWeight: "600",
  },
  addressNote: {
    ...mobileTypography.caption,
    color: lightPalette.warning.dark,
  },
  suggestion: {
    minHeight: 44,
    justifyContent: "center",
  },
  suggestionText: {
    ...mobileTypography.listSecondary,
    color: lightPalette.info.main,
    fontWeight: "600",
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
