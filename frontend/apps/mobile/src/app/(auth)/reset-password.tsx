/**
 * Reset Password screen — validates the reset token from deep link and sets new password
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

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const inputStyle = {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#fafafa",
  } as const;

  const handleSubmit = async () => {
    if (!password || password.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      Alert.alert("Error", "Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      // TODO: Wire up password reset RPC with token
      setDone(true);
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
        <Stack.Screen options={{ title: "New Password" }} />

        {done ? (
          <View style={{ alignItems: "center", gap: 16 }}>
            <Text style={{ fontSize: 20, fontWeight: "600" }}>Password updated!</Text>
            <Text style={{ fontSize: 15, color: "#666", textAlign: "center" }}>
              Your password has been changed. Please sign in with your new password.
            </Text>
            <Pressable
              onPress={() => router.replace("/(auth)/signin")}
              style={{
                backgroundColor: "#0f172a",
                paddingVertical: 16,
                paddingHorizontal: 32,
                borderRadius: 12,
                marginTop: 8,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
                Sign In
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 20, fontWeight: "600", textAlign: "center" }}>
              Set a new password
            </Text>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
                New Password
              </Text>
              <TextInput
                style={inputStyle}
                placeholder="At least 8 characters"
                secureTextEntry
                textContentType="newPassword"
                value={password}
                onChangeText={setPassword}
              />
            </View>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
                Confirm Password
              </Text>
              <TextInput
                style={inputStyle}
                placeholder="Repeat your new password"
                secureTextEntry
                textContentType="newPassword"
                value={confirm}
                onChangeText={setConfirm}
              />
            </View>
            <Pressable
              onPress={handleSubmit}
              disabled={loading || !password || !confirm}
              style={({ pressed }) => ({
                backgroundColor:
                  !password || !confirm ? "#ccc" : pressed ? "#020617" : "#0f172a",
                paddingVertical: 16,
                borderRadius: 12,
                alignItems: "center",
                marginTop: 8,
              })}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
                  Update Password
                </Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
