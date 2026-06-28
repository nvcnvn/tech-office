/**
 * Sign Up screen — organization registration
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
import { Stack, useRouter } from "expo-router";
import { useForm, Controller } from "react-hook-form";

interface SignUpForm {
  organizationName: string;
  subdomain: string;
  adminEmail: string;
  adminName: string;
  password: string;
}

export default function SignUpScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const { control, handleSubmit, formState } = useForm<SignUpForm>({
    defaultValues: {
      organizationName: "",
      subdomain: "",
      adminEmail: "",
      adminName: "",
      password: "",
    },
  });

  const onSubmit = async (_data: SignUpForm) => {
    setLoading(true);
    try {
      // TODO: Wire up organization signup RPC
      Alert.alert("Success", "Organization created! Please sign in.", [
        { text: "OK", onPress: () => router.replace("/(auth)/signin") },
      ]);
    } catch (err) {
      Alert.alert(
        "Sign Up Failed",
        err instanceof Error ? err.message : "An error occurred"
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
        <Stack.Screen options={{ title: "Create Organization" }} />

        <Text style={{ fontSize: 24, fontWeight: "700", textAlign: "center" }}>
          Create Workspace
        </Text>

        {(
          [
            ["organizationName", "Organization Name", "Acme Corp"],
            ["subdomain", "Subdomain", "acme"],
            ["adminName", "Your Name", "John Doe"],
            ["adminEmail", "Admin Email", "admin@acme.com"],
          ] as const
        ).map(([name, label, placeholder]) => (
          <Controller
            key={name}
            control={control}
            name={name}
            rules={{ required: `${label} is required` }}
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={{ gap: 4 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
                  {label}
                </Text>
                <TextInput
                  style={inputStyle}
                  placeholder={placeholder}
                  autoCapitalize={name === "adminEmail" || name === "subdomain" ? "none" : "words"}
                  keyboardType={name === "adminEmail" ? "email-address" : "default"}
                  autoCorrect={false}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                />
                {formState.errors[name] && (
                  <Text style={{ color: "#dc2626", fontSize: 12 }}>
                    {formState.errors[name]?.message}
                  </Text>
                )}
              </View>
            )}
          />
        ))}

        <Controller
          control={control}
          name="password"
          rules={{ required: "Password is required", minLength: { value: 8, message: "At least 8 characters" } }}
          render={({ field: { onChange, onBlur, value } }) => (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
                Password
              </Text>
              <TextInput
                style={inputStyle}
                placeholder="••••••••"
                secureTextEntry
                textContentType="newPassword"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
              />
              {formState.errors.password && (
                <Text style={{ color: "#dc2626", fontSize: 12 }}>
                  {formState.errors.password.message}
                </Text>
              )}
            </View>
          )}
        />

        <Pressable
          onPress={handleSubmit(onSubmit)}
          disabled={loading}
          style={({ pressed }) => ({
            backgroundColor: pressed ? "#020617" : "#0f172a",
            borderRadius: 12,
            borderCurve: "continuous",
            padding: 16,
            alignItems: "center",
            opacity: loading ? 0.7 : 1,
            marginTop: 8,
          })}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>
              Create Organization
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => router.back()}
          style={{ alignItems: "center", padding: 12 }}
        >
          <Text style={{ color: "#2563eb", fontSize: 14 }}>
            Already have an account? Sign in
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: "#ddd",
  borderRadius: 10,
  borderCurve: "continuous" as const,
  padding: 14,
  fontSize: 16,
  backgroundColor: "#fafafa",
};
