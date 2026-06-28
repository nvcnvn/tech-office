/**
 * Set PIN screen — shown after first login or when user wants to enable PIN
 */

import React, { useState, useRef } from "react";
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
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  getOrganizationBySubdomain,
  getProfile,
  setAuthToken,
  setPIN,
} from "apis";
import { AuthContext } from "@/hooks/use-auth";

const PIN_LENGTH = 6;

export default function SetPinScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    pinChangeToken?: string;
    subdomain?: string;
  }>();
  const auth = React.use(AuthContext);
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [firstPin, setFirstPin] = useState("");
  const [pin, setPin] = useState("");
  const [isPinFocused, setIsPinFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const handlePinChange = async (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(cleaned);

    if (cleaned.length === PIN_LENGTH) {
      if (Platform.OS === "ios") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      if (step === "enter") {
        setFirstPin(cleaned);
        setPin("");
        setStep("confirm");
      } else {
        // Confirm step
        if (cleaned !== firstPin) {
          Alert.alert("Mismatch", "PINs don't match. Please try again.");
          setPin("");
          setFirstPin("");
          setStep("enter");
          return;
        }

        setLoading(true);
        try {
          const result = await setPIN(cleaned, {
            pinChangeToken: params.pinChangeToken,
          });

          if (params.pinChangeToken) {
            const subdomain = params.subdomain?.trim().toLowerCase();

            if (!subdomain) {
              throw new Error("Missing workspace code for PIN setup.");
            }

            await setAuthToken(result.accessToken, Number(result.expiresAt));

            const org = await getOrganizationBySubdomain(subdomain);
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
          }

          if (Platform.OS === "ios") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          Alert.alert("PIN Set", "Your PIN has been saved.", [
            {
              text: "OK",
              onPress: () =>
                params.pinChangeToken
                  ? router.replace("/(app)/(chat)")
                  : router.back(),
            },
          ]);
        } catch (err) {
          Alert.alert(
            "Error",
            err instanceof Error ? err.message : "Failed to save PIN. Please try again."
          );
          setPin("");
        } finally {
          setLoading(false);
        }
      }
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 24,
          backgroundColor: "#f4efe6",
        }}
      >
        <Stack.Screen options={{ title: "Set PIN" }} />

        <View
          style={{
            backgroundColor: "#fffaf2",
            borderRadius: 28,
            borderCurve: "continuous",
            padding: 24,
            gap: 16,
            borderWidth: 1,
            borderColor: "#eadfcf",
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: "800", color: "#312519" }}>
            {step === "enter" ? "Create your PIN" : "Confirm your PIN"}
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: "#6a5542",
              textAlign: "center",
              lineHeight: 22,
            }}
          >
            {step === "enter"
              ? "Choose a 6-digit PIN for future sign-ins."
              : "Re-enter the same PIN to finish setup."}
          </Text>

          <TextInput
            ref={inputRef}
            value={pin}
            onChangeText={handlePinChange}
            keyboardType="number-pad"
            maxLength={PIN_LENGTH}
            style={{ position: "absolute", inset: 0, color: "transparent" }}
            autoFocus
            secureTextEntry
            caretHidden
            onFocus={() => setIsPinFocused(true)}
            onBlur={() => setIsPinFocused(false)}
            textContentType="newPassword"
            autoComplete="new-password"
            importantForAutofill="yes"
            passwordRules="allowed: digit; minlength: 6; maxlength: 6;"
            selectionColor="transparent"
            cursorColor="transparent"
            accessibilityLabel={step === "enter" ? "Create PIN" : "Confirm PIN"}
          />

          <Pressable
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="button"
            accessibilityState={{ disabled: loading }}
            style={({ pressed }) => ({
              flexDirection: "column",
              gap: 10,
              marginTop: 8,
              marginBottom: 12,
              padding: 12,
              borderRadius: 24,
              borderCurve: "continuous",
              borderWidth: isPinFocused ? 1 : 0,
              borderColor: isPinFocused ? "#8a5a2b" : "transparent",
              backgroundColor: isPinFocused || pressed ? "#fff7ec" : "transparent",
            })}
          >
            <View style={{ flexDirection: "row", gap: 16 }}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => {
                const isFilled = i < pin.length;
                const activeIndex = Math.min(pin.length, PIN_LENGTH - 1);
                const isActive = isPinFocused && i === activeIndex;

                return (
                  <View
                    key={i}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      borderWidth: isActive ? 2 : 0,
                      borderColor: isActive ? "#8a5a2b" : "transparent",
                      backgroundColor: isFilled ? "#8a5a2b" : "#e6d9c5",
                    }}
                  />
                );
              })}
            </View>
            <Text
              selectable
              style={{
                fontSize: 13,
                lineHeight: 18,
                textAlign: "center",
                color: isPinFocused ? "#8a5a2b" : "#6a5542",
              }}
            >
              {isPinFocused
                ? step === "enter"
                  ? "PIN field active. Save this PIN in your password manager if you want autofill next time."
                  : "PIN field active. Re-enter the same 6 digits to confirm."
                : step === "enter"
                  ? "Tap the dots to create your 6-digit PIN."
                  : "Tap the dots to confirm the same 6-digit PIN."}
            </Text>
          </Pressable>

          {loading ? <ActivityIndicator color="#8a5a2b" /> : null}

          <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: "#6a5542", fontSize: 15 }}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
