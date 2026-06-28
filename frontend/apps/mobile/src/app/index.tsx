/**
 * Root index — splash / redirect
 *
 * Redirects to (auth) or (app) based on auth state.
 */

import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { AuthContext } from "@/hooks/use-auth";
import { setPendingPostSignInRedirect } from "@/lib/auth-redirect-handoff";

export default function Index() {
  const auth = React.use(AuthContext);
  const params = useLocalSearchParams<{ canonicalSignIn?: string; postSignIn?: string; redirect?: string; subdomain?: string }>();
  if (!auth) return null;

  const postSignIn = typeof params.postSignIn === "string" && params.postSignIn ? params.postSignIn : params.redirect;
  const subdomain = typeof params.subdomain === "string" && params.subdomain ? params.subdomain : undefined;
  const shouldOpenEmailSignIn = params.canonicalSignIn === "1" || Boolean(postSignIn);

  if (postSignIn) {
    setPendingPostSignInRedirect(postSignIn);
  }

  if (auth.isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (auth.isAuthenticated) {
    return <Redirect href="/(app)/(chat)" />;
  }

  if (shouldOpenEmailSignIn) {
    return (
      <Redirect
        href={{
          pathname: "/(auth)/signin",
          params: subdomain ? { subdomain } : {},
        }}
      />
    );
  }

  return <Redirect href="/(auth)" />;
}
