/**
 * Choose your PIN — the first step after a workspace is created.
 *
 * Mandatory and not dismissible. An owner who skips this ends up on a sign-in path their
 * staff do not share, which is exactly the person least able to help a stuck employee.
 * Email and password stay as the way back in, and the screen says so, because a PIN is the
 * one credential this product can lock you out of.
 */

import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { PIN_LENGTH, PINValidationError, setPIN } from "apis";
import {
  border,
  mobileLayout,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";
import { SFIcon } from "@/components/ui/sf-icon";
import { setOnboardingStep } from "@/lib/onboarding-progress";
import { makeStyles, useTheme } from "@/lib/theme";

/**
 * Turn a server PIN complaint into something a person can act on.
 *
 * The backend rejects a PIN that matches the holder's date of birth or phone number. Its
 * own wording names the rule; this names the fix.
 */
function pinRejectionMessage(err: unknown): string {
  if (err instanceof PINValidationError) {
    const reasons = err.violations.map((v) => v.description.toLowerCase()).join(" ");
    if (reasons.includes("date of birth") || reasons.includes("phone")) {
      return "Pick something that isn't your birthday or phone number — those are easy to guess.";
    }
    return err.violations[0]?.description ?? "That PIN can't be used. Try another.";
  }
  return err instanceof Error && err.message
    ? err.message
    : "We couldn't save that PIN. Try again.";
}

export default function OnboardingSetPinScreen() {
  const { palette } = useTheme();
  const styles = useStyles();

  const router = useRouter();

  const firstRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [firstPin, setFirstPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The confirmation only appears once there is something to confirm.
  const confirming = firstPin.length === PIN_LENGTH;

  const fail = (message: string) => {
    setError(message);
    if (process.env.EXPO_OS === "ios") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleFirstChange = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setFirstPin(cleaned);
    setError("");

    if (cleaned.length === PIN_LENGTH) {
      if (process.env.EXPO_OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setTimeout(() => confirmRef.current?.focus(), 100);
    }
  };

  const handleConfirmChange = async (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setConfirmPin(cleaned);
    setError("");

    if (cleaned.length !== PIN_LENGTH) return;

    if (cleaned !== firstPin) {
      // A mismatch costs the confirmation, not the whole screen.
      setConfirmPin("");
      fail("Those didn't match. Enter the same six digits again.");
      confirmRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      // First PIN for this owner: there is no credential to prove knowledge of, so no
      // current PIN is required or sent.
      await setPIN(cleaned);

      if (process.env.EXPO_OS === "ios") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setOnboardingStep("teammate");
      router.replace("/(onboarding)/add-teammate");
    } catch (err) {
      setConfirmPin("");
      setFirstPin("");
      fail(pinRejectionMessage(err));
      setTimeout(() => firstRef.current?.focus(), 100);
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
        <Stack.Screen
          options={{ title: "Choose your PIN", headerBackVisible: false, gestureEnabled: false }}
        />

        <View style={styles.card}>
          <Text style={styles.lede} selectable>
            Six digits to sign in from now on. Your staff will use one too.
          </Text>

          <PinBoxes
            label="Your PIN"
            pin={firstPin}
            inputRef={firstRef}
            onChange={handleFirstChange}
            disabled={loading}
            autoFocus
            testID="onboarding-pin"
          />

          {confirming ? (
            <PinBoxes
              label="Enter it again"
              pin={confirmPin}
              inputRef={confirmRef}
              onChange={handleConfirmChange}
              disabled={loading}
              testID="onboarding-pin-confirm"
            />
          ) : null}

          {loading ? (
            <ActivityIndicator size="small" color={palette.primary.main} />
          ) : null}

          {error ? (
            <View style={styles.errorBanner} testID="onboarding-pin-error">
              <SFIcon
                name="exclamationmark.circle.fill"
                size={16}
                color={palette.error.main}
              />
              <Text style={styles.errorText} selectable>
                {error}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.infoCard} testID="onboarding-pin-recovery">
          <SFIcon name="lifepreserver" size={18} color={palette.info.main} />
          <Text style={styles.infoText} selectable>
            Forget your PIN? Sign in with your email and password instead — that always
            works, even if your PIN is locked.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PinBoxes({
  label,
  pin,
  inputRef,
  onChange,
  disabled,
  autoFocus,
  testID,
}: {
  label: string;
  pin: string;
  inputRef: React.RefObject<TextInput | null>;
  onChange: (value: string) => void;
  disabled: boolean;
  autoFocus?: boolean;
  testID: string;
}) {
  const styles = useStyles();

  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        style={styles.pinField}
        testID={`${testID}-boxes`}
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
          autoFocus={autoFocus}
          editable={!disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          textContentType="newPassword"
          autoComplete="new-password"
          importantForAutofill="yes"
          passwordRules={`allowed: digit; minlength: ${PIN_LENGTH}; maxlength: ${PIN_LENGTH};`}
          selectionColor="transparent"
          cursorColor="transparent"
          accessibilityLabel={label}
          testID={`${testID}-input`}
        />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: t.background.default,
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
    backgroundColor: t.background.paper,
    borderWidth: border.thin,
    borderColor: t.divider,
    padding: mobileLayout.cardPadding,
    gap: 20,
  },
  lede: {
    ...mobileTypography.listSecondary,
    color: t.text.secondary,
  },
  fieldGroup: {
    gap: 10,
  },
  fieldLabel: {
    ...mobileTypography.sectionHeader,
    color: t.text.primary,
  },
  pinField: {
    gap: 10,
  },
  pinRow: {
    flexDirection: "row",
    gap: 10,
  },
  pinBox: {
    flex: 1,
    minHeight: 56,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: t.divider,
    backgroundColor: t.background.default,
    alignItems: "center",
    justifyContent: "center",
  },
  pinBoxActive: {
    borderColor: t.primary.main,
    borderWidth: border.medium,
  },
  pinBoxFilled: {
    borderColor: t.primary.main,
    backgroundColor: t.background.paper,
  },
  pinDigit: {
    fontSize: 26,
    fontWeight: "700",
    color: t.text.primary,
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
    backgroundColor: t.background.default,
    borderWidth: border.thin,
    borderColor: t.error.light,
    padding: 12,
  },
  errorText: {
    ...mobileTypography.listSecondary,
    color: t.error.dark,
    flex: 1,
  },
  infoCard: {
    marginHorizontal: mobileLayout.screenPadding,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: mobileLayout.iconTextGap,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: t.background.paper,
    borderWidth: border.thin,
    borderColor: t.info.light,
    padding: mobileLayout.cardPadding,
  },
  infoText: {
    ...mobileTypography.listSecondary,
    color: t.text.secondary,
    flex: 1,
  },
}));
