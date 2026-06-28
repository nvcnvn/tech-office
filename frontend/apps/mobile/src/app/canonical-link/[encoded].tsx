import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { parseCanonicalResourceLink } from "@tech-office/links";
import { getAuthToken } from "apis";

import { setPendingPostSignInRedirect } from "@/lib/auth-redirect-handoff";
import { getCanonicalInAppRoute } from "@/lib/canonical-links";

function decodeCanonicalHandoff(encoded: string): string | null {
  if (!encoded || encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
    return null;
  }

  let decoded = "";
  for (let index = 0; index < encoded.length; index += 2) {
    decoded += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16));
  }
  return decoded;
}

export default function CanonicalLinkHandoffScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ encoded?: string }>();
  const encoded = typeof params.encoded === "string" ? params.encoded : "";

  useEffect(() => {
    let cancelled = false;

    async function routeCanonicalLink() {
      const raw = decodeCanonicalHandoff(encoded);
      const target = raw ? parseCanonicalResourceLink(raw) : null;
      if (!raw || !target) {
        router.replace("/(auth)");
        return;
      }

      const token = await getAuthToken();
      if (!token) {
        setPendingPostSignInRedirect(raw, target.tenantKey);
        if (!cancelled) {
          router.replace("/canonical-signin");
        }
        return;
      }

      const resolved = (await getCanonicalInAppRoute(raw)) ?? "/(app)/(chat)";
      if (!cancelled) {
        router.replace(resolved);
      }
    }

    void routeCanonicalLink();

    return () => {
      cancelled = true;
    };
  }, [encoded, router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
