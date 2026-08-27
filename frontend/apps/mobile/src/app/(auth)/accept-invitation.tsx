/**
 * Accept Invitation screen
 *
 * Handles deep links of the form: techoffice://accept-invitation?token=<token>
 * Validates the invite, prompts for a password, and creates the account.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { acceptInvitation, AuthError, TERMS_VERSION } from "apis";

import { TermsAcceptance } from "@/components/compliance/terms-acceptance";

export default function AcceptInvitationScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [showMismatchFallback, setShowMismatchFallback] = useState(false);
  // Feature 036 (FR-010): an invited person may be creating their account here, so
  // the same acknowledgement is required as at signup.
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const inputStyle = {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#fafafa",
  } as const;

  const handleAccept = async () => {
    if (!token) {
      Alert.alert("Error", "Invalid invitation link");
      return;
    }
    if (!password || password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Error", "Passwords don't match");
      return;
    }
    if (!acceptedTerms) {
      Alert.alert("Error", "Please read and agree to the terms and privacy policy.");
      return;
    }
    setLoading(true);
    setShowMismatchFallback(false);
    try {
      await acceptInvitation(token, { password, acceptedTermsVersion: TERMS_VERSION });
      Alert.alert("Welcome!", "Your account is ready. Please sign in.", [
        { text: "Sign In", onPress: () => router.replace("/(auth)/signin") },
      ]);
    } catch (err) {
      if (err instanceof AuthError && err.code === "INVITATION_SSO_EMAIL_MISMATCH") {
        setShowMismatchFallback(true);
      }
      Alert.alert(
        "Invitation Error",
        err instanceof Error ? err.message : "Failed to accept invitation"
      );
    } finally {
      setLoading(false);
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
          gap: 16,
        }}
      >
        <Stack.Screen options={{ title: "Accept Invitation" }} />

        <View style={{ alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Text style={{ fontSize: 64 }}>🎉</Text>
          <Text style={{ fontSize: 24, fontWeight: "700" }}>You're invited!</Text>
          <Text style={{ fontSize: 15, color: "#666", textAlign: "center" }}>
            Set a password to activate your account.
          </Text>
          <Text
            style={{ fontSize: 14, color: "#6a5542", textAlign: "center", lineHeight: 20 }}
          >
            Use the same email address from your invitation. If you later use Google or Apple with that same email, it should connect to this account instead of creating another one.
          </Text>
        </View>

        {showMismatchFallback ? (
          <View
            style={{
              backgroundColor: "#fff3e0",
              padding: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#ffb74d",
            }}
          >
            <Text style={{ color: "#8a4b08", fontSize: 13, lineHeight: 18 }}>
              Your social sign-in used a different email than the invitation. Finish setup with your invited email and password here, then link Apple or Google later from Security.
            </Text>
          </View>
        ) : null}

        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
            Password
          </Text>
          <TextInput
            style={inputStyle}
            placeholder="At least 8 characters"
            secureTextEntry
            textContentType="newPassword"
            value={password}
            onChangeText={setPassword}
          
              testID="accept-invitation-password"
            />
        </View>

        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
            Confirm Password
          </Text>
          <TextInput
            style={inputStyle}
            placeholder="Repeat your password"
            secureTextEntry
            textContentType="newPassword"
            value={confirm}
            onChangeText={setConfirm}
          
              testID="accept-invitation-confirm"
            />
        </View>

        <TermsAcceptance
          accepted={acceptedTerms}
          onChange={setAcceptedTerms}
          disabled={loading}
        />

        <Pressable
          onPress={handleAccept}
          disabled={loading || !password || !confirm || !acceptedTerms}
          style={({ pressed }) => ({
            backgroundColor:
              !password || !confirm || !acceptedTerms ? "#ccc" : pressed ? "#020617" : "#0f172a",
            paddingVertical: 16,
            borderRadius: 12,
            alignItems: "center",
            marginTop: 8,
          })}
        
              testID="accept-invitation-submit"
            >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
              {showMismatchFallback ? "Continue With Invited Email" : "Activate Account"}
            </Text>
          )}
        </Pressable>

        <View
          style={{
            backgroundColor: "#fffaf2",
            padding: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "#eadfcf",
          }}
        >
          <Text style={{ color: "#6a5542", fontSize: 13, lineHeight: 18 }}>
            Finish activation with your invited email and password here. After
            that, the main sign-in screen can use Google or Apple with the
            same email to attach to this account.
          </Text>
        </View>

        {!token && (
          <View
            style={{
              backgroundColor: "#fff3e0",
              padding: 12,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#ffb74d",
            }}
          >
            <Text style={{ color: "#e65100", fontSize: 13 }}>
              No invitation token found. Please open this link from your invitation email.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
