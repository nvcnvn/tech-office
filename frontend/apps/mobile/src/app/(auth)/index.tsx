import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import * as Linking from "expo-linking";
import { parseCanonicalResourceLink } from "@tech-office/links";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { peekPendingAuthSubdomain, peekPendingPostSignInRedirect, setPendingPostSignInRedirect } from "@/lib/auth-redirect-handoff";
import { buildWebUrl, WEB_BASE_URL, WEB_HOSTNAME } from "@/lib/constants";
import { SessionErrorBanner } from "@/components/auth/session-error-banner";
import { useAuth } from "@/hooks/use-auth";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
} from "@tech-office/theme-tokens";

export default function AuthEntryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ canonicalSignIn?: string; postSignIn?: string; redirect?: string; subdomain?: string }>();
  const auth = useAuth();
  const postSignIn = typeof params.postSignIn === "string" && params.postSignIn ? params.postSignIn : params.redirect;
  const subdomain = typeof params.subdomain === "string" && params.subdomain ? params.subdomain : peekPendingAuthSubdomain() ?? undefined;

  React.useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const normalized = normalizeCanonicalOpenUrl(url);
      const target = parseCanonicalResourceLink(normalized);
      if (!target) {
        return;
      }
      setPendingPostSignInRedirect(normalized, target.tenantKey);
      router.replace("/(auth)");
    });

    return () => subscription.remove();
  }, [router]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.scrollContent}
    >
      <Stack.Screen options={{ title: "Sign In" }} />

      {auth.authErrorMessage ? (
        <SessionErrorBanner
          message={auth.authErrorMessage}
          onDismiss={auth.clearAuthError}
        />
      ) : null}

      <View style={styles.header}>
        <Text style={styles.title}>How do you sign in?</Text>
        <Text style={styles.subtitle}>
          Choose the sign-in method your company gave you.
        </Text>
      </View>

      <View style={styles.card}>
        <Pressable
          onPress={() => {
            setPendingPostSignInRedirect(postSignIn || peekPendingPostSignInRedirect(), subdomain);
            router.push({
              pathname: "/(auth)/signin",
              params: {
                ...(subdomain ? { subdomain } : {}),
              },
            });
          }}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          testID="signin-method-email"
        >
          <View style={styles.iconWrap}>
            <SFIcon name="envelope.fill" size={16} color={lightPalette.primary.contrastText} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Work email</Text>
            <Text style={styles.rowSubtitle}>Email and password.</Text>
          </View>
          <SFIcon name="chevron.right" size={14} color={lightPalette.text.disabled} />
        </Pressable>

        <View style={styles.separator} />

        <Pressable
          onPress={() => router.push("/(auth)/pin")}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          testID="signin-method-pin"
        >
          <View style={[styles.iconWrap, styles.iconWrapSecondary]}>
            <SFIcon name="keypad.fill" size={16} color={lightPalette.primary.contrastText} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Account ID and PIN</Text>
            <Text style={styles.rowSubtitle}>Workspace subdomain, account ID, and PIN.</Text>
          </View>
          <SFIcon name="chevron.right" size={14} color={lightPalette.text.disabled} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

function normalizeCanonicalOpenUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol !== "techoffice:") {
      return raw;
    }
    if (url.hostname === WEB_HOSTNAME) {
      return buildWebUrl(`${url.pathname}${url.search}`);
    }
    const path = url.pathname && url.pathname !== "/" ? url.pathname : `/${url.hostname}`;
    return buildWebUrl(`${path}${url.search}`);
  } catch {
    return raw.replace(/^techoffice:\/\//, WEB_BASE_URL);
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  scrollContent: {
    flexGrow: 1,
    paddingVertical: 24,
    gap: 20,
  },
  header: {
    paddingHorizontal: mobileLayout.screenPadding,
    gap: 6,
  },
  title: {
    ...mobileTypography.screenTitle,
    color: lightPalette.text.primary,
  },
  subtitle: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  card: {
    marginHorizontal: mobileLayout.screenPadding,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 16,
    minHeight: 72,
  },
  rowPressed: {
    backgroundColor: lightPalette.background.default,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.main,
  },
  iconWrapSecondary: {
    backgroundColor: lightPalette.info.light,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
    fontWeight: "600",
  },
  rowSubtitle: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginHorizontal: mobileLayout.cardPadding,
  },
});