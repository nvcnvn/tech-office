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

import { useTheme } from "@/lib/theme";

export default function ResetPasswordScreen() {
  const { palette } = useTheme();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const inputStyle = {
    borderWidth: 1,
    borderColor: palette.divider,
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    backgroundColor: palette.background.default,
    // React Native's default text colour is black, so an input without this one
    // takes typed text to black on a dark field.
    color: palette.text.primary,
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
            <Text style={{ fontSize: 20, fontWeight: "600", color: palette.text.primary }}>
              Password updated!
            </Text>
            <Text style={{ fontSize: 15, color: palette.text.secondary, textAlign: "center" }}>
              Your password has been changed. Please sign in with your new password.
            </Text>
            <Pressable
              onPress={() => router.replace("/(auth)/signin")}
              style={{
                backgroundColor: palette.primary.main,
                paddingVertical: 16,
                paddingHorizontal: 32,
                borderRadius: 12,
                marginTop: 8,
              }}
            
              testID="reset-password-back-to-signin"
            >
              <Text style={{ color: palette.primary.contrastText, fontSize: 16, fontWeight: "600" }}>
                Sign In
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text
              style={{
                fontSize: 20,
                fontWeight: "600",
                textAlign: "center",
                color: palette.text.primary,
              }}
            >
              Set a new password
            </Text>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: palette.text.primary }}>
                New Password
              </Text>
              <TextInput
                style={inputStyle}
                placeholder="At least 8 characters"
                placeholderTextColor={palette.text.disabled}
                secureTextEntry
                textContentType="newPassword"
                value={password}
                onChangeText={setPassword}
              
              testID="reset-password-new"
            />
            </View>
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: palette.text.primary }}>
                Confirm Password
              </Text>
              <TextInput
                style={inputStyle}
                placeholder="Repeat your new password"
                placeholderTextColor={palette.text.disabled}
                secureTextEntry
                textContentType="newPassword"
                value={confirm}
                onChangeText={setConfirm}
              
              testID="reset-password-confirm"
            />
            </View>
            <Pressable
              onPress={handleSubmit}
              disabled={loading || !password || !confirm}
              style={({ pressed }) => ({
                backgroundColor:
                  !password || !confirm
                    ? palette.divider
                    : pressed
                      ? palette.primary.dark
                      : palette.primary.main,
                paddingVertical: 16,
                borderRadius: 12,
                alignItems: "center",
                marginTop: 8,
              })}
            
              testID="reset-password-submit"
            >
              {loading ? (
                <ActivityIndicator color={palette.primary.contrastText} />
              ) : (
                <Text style={{ color: palette.primary.contrastText, fontSize: 16, fontWeight: "600" }}>
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
