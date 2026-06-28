/**
 * Forgot Password screen
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { Stack } from "expo-router";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim()) {
      Alert.alert("Error", "Please enter your email");
      return;
    }
    setLoading(true);
    try {
      // TODO: Wire up password reset RPC
      setSent(true);
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "An error occurred");
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
        <Stack.Screen options={{ title: "Reset Password" }} />

        {sent ? (
          <View style={{ alignItems: "center", gap: 12 }}>
            <Text style={{ fontSize: 20, fontWeight: "600" }}>Check your email</Text>
            <Text style={{ fontSize: 15, color: "#666", textAlign: "center" }}>
              We've sent a password reset link to {email}
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 20, fontWeight: "600", textAlign: "center" }}>
              Forgot your password?
            </Text>
            <Text style={{ fontSize: 15, color: "#666", textAlign: "center" }}>
              Enter your email and we'll send you a reset link
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 10,
                borderCurve: "continuous",
                padding: 14,
                fontSize: 16,
                backgroundColor: "#fafafa",
              }}
              placeholder="you@company.com"
              keyboardType="email-address"
              autoCapitalize="none"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
            />
            <Pressable
              onPress={handleSubmit}
              disabled={loading}
              style={({ pressed }) => ({
                backgroundColor: pressed ? "#020617" : "#0f172a",
                borderRadius: 12,
                borderCurve: "continuous",
                padding: 16,
                alignItems: "center",
                opacity: loading ? 0.7 : 1,
              })}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>
                  Send Reset Link
                </Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
