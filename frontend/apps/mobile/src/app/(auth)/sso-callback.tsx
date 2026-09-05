/**
 * SSO Callback screen
 *
 * Handles the redirect after Google/Apple SSO.
 * Extracts the token from the URL and signs the user in.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { AuthContext } from "@/hooks/use-auth";
import { useTheme } from "@/lib/theme";

export default function SsoCallbackScreen() {
  const { palette } = useTheme();
  const params = useLocalSearchParams<{
    access_token?: string;
    expires_at?: string;
    org_id?: string;
    employee_id?: string;
    error?: string;
  }>();
  const router = useRouter();
  const auth = React.use(AuthContext);
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    (async () => {
      if (params.error) {
        Alert.alert("SSO Error", params.error, [
          { text: "Try Again", onPress: () => router.replace("/(auth)") },
        ]);
        setProcessing(false);
        return;
      }

      if (
        !params.access_token ||
        !params.expires_at ||
        !params.org_id ||
        !params.employee_id
      ) {
        Alert.alert("Error", "Incomplete SSO response. Please try again.", [
          { text: "OK", onPress: () => router.replace("/(auth)") },
        ]);
        setProcessing(false);
        return;
      }

      try {
        await auth?.signIn({
          token: params.access_token,
          expiresAt: parseInt(params.expires_at, 10),
          organizationId: params.org_id,
          employeeId: params.employee_id,
        });
        router.replace("/(app)/(chat)");
      } catch (err) {
        Alert.alert(
          "Sign In Failed",
          err instanceof Error ? err.message : "An error occurred",
          [{ text: "OK", onPress: () => router.replace("/(auth)") }]
        );
      } finally {
        setProcessing(false);
      }
    })();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 16 }}>
      <Stack.Screen options={{ title: "Signing in…", headerShown: false }} />
      {processing ? (
        <>
          <ActivityIndicator size="large" color={palette.text.secondary} />
          <Text style={{ fontSize: 16, color: palette.text.secondary }}>Completing sign in…</Text>
        </>
      ) : null}
    </View>
  );
}
