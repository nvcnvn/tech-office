/**
 * Doc viewer — read-only TipTap document rendered as plain text/markdown
 *
 * Phase 2 will add an edit mode. For now shows the document content read-only.
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Share,
  Alert,
  Platform,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getDocument, getProfile } from "apis";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { API_BASE_URL } from "@/lib/constants";
import {
  extractCanonicalResourceLinks,
  getCanonicalLinkPreviewDisplay,
  removeCanonicalResourceLinksFromContent,
  type CanonicalLinkPreviewDisplay,
} from "@tech-office/links";
import { fetchCanonicalPreview, getCanonicalInAppRoute } from "@/lib/canonical-links";

/** Extract plain text from TipTap/ProseMirror JSON document */
function extractText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) {
    const childText = node.content.map(extractText).join("");
    // Add paragraph breaks
    if (
      node.type === "paragraph" ||
      node.type === "heading" ||
      node.type === "listItem"
    ) {
      return childText + "\n";
    }
    return childText;
  }
  return "";
}

/** Small preview card for a canonical resource link in the document */
function CanonicalLinkPreviewCard({ url }: { url: string }) {
  const router = useRouter();
  const [display, setDisplay] = useState<CanonicalLinkPreviewDisplay | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCanonicalPreview(url).then((result) => {
      if (!cancelled) {
        setDisplay(getCanonicalLinkPreviewDisplay(result?.preview ?? null, url));
      }
      if (!cancelled) setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setDisplay(getCanonicalLinkPreviewDisplay(null, url));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [url]);

  const handlePress = async () => {
    const route = await getCanonicalInAppRoute(url, { preferRecoverableFallback: true });
    if (route) router.push(route as any);
  };

  if (loading) {
    return (
      <View style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, backgroundColor: "#f9fafb" }}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  if (!display) return null;

  return (
    <Pressable
      onPress={() => { void handlePress(); }}
      style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, backgroundColor: "#f9fafb", gap: 4 }}
    >
      <Text style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{display.badge}</Text>
      {display.title && (
        <Text style={{ fontSize: 14, fontWeight: "600", color: "#111827" }} numberOfLines={2}>{display.title}</Text>
      )}
      {display.subtitle && (
        <Text style={{ fontSize: 12, color: "#6b7280" }} numberOfLines={1}>{display.subtitle}</Text>
      )}
    </Pressable>
  );
}

export default function DocViewerScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const auth = useAuth();

  const { data: doc, isLoading } = useQuery({
    queryKey: ["doc", slug],
    queryFn: async () => {
      const result = await getDocument({ slug: slug!, includeContent: true });
      return result.document;
    },
    enabled: !!slug,
  });

  const { data: profileData } = useQuery({
    queryKey: ["profile", "doc-share"],
    queryFn: () => getProfile(),
    enabled: auth.isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const currentMembership = profileData?.organizations.find(
    (org) => org.organizationId === auth.organizationId
  ) ?? profileData?.organizations[0];

  const handleShare = async () => {
    if (!doc) return;
    const d = doc as any;

    if (currentMembership?.organizationSubdomain && d?.id) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/linking/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: {
              tenantKey: currentMembership.organizationSubdomain,
              resourceType: "document",
              resourceId: d.id,
            },
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          canonicalUrl?: string;
        } | null;
        if (response.ok && payload?.canonicalUrl) {
          await Share.share({
            title: d.title ?? "Document",
            message: payload.canonicalUrl,
            url: payload.canonicalUrl,
          });
          if (Platform.OS === "ios") {
            // haptic feedback handled by Share sheet
          }
          return;
        }
      } catch {
        // fall through to title-only share
      }
    }

    await Share.share({
      title: d.title ?? "Document",
      message: `Check out this document: ${d.title}`,
    });
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const d = doc as any;
  let bodyText = "";
  try {
    const content =
      typeof d?.content === "string" ? JSON.parse(d.content) : d?.content;
    bodyText = extractText(content);
  } catch {
    bodyText = d?.content ?? "";
  }

  const canonicalLinks = extractCanonicalResourceLinks(bodyText);
  const displayBodyText = canonicalLinks.length > 0
    ? removeCanonicalResourceLinksFromContent(bodyText)
    : bodyText;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 12 }}
      >
        <Stack.Screen
          options={{
            title: d?.title ?? "Document",
            headerRight: () => (
              <Pressable onPress={handleShare} style={{ paddingRight: 4 }}>
                <Text style={{ color: "#2563eb", fontSize: 15 }}>Share</Text>
              </Pressable>
            ),
          }}
        />

        {/* Meta */}
        {d?.updatedAt && (
          <Text style={{ fontSize: 12, color: "#999" }}>
            Last updated{" "}
            {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}
            {d?.updatedByName ? ` by ${d.updatedByName}` : ""}
          </Text>
        )}

        {/* Body */}
        {displayBodyText ? (
          <Text selectable style={{ fontSize: 15, lineHeight: 24, color: "#111" }}>
            {displayBodyText.trim()}
          </Text>
        ) : bodyText ? (
          null
        ) : (
          <View style={{ alignItems: "center", padding: 32 }}>
            <Text style={{ color: "#999", fontSize: 15 }}>Empty document</Text>
          </View>
        )}

        {/* Canonical resource link previews */}
        {canonicalLinks.length > 0 && (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text style={{ fontSize: 12, color: "#6b7280", fontWeight: "600", textTransform: "uppercase" }}>
              Linked Resources
            </Text>
            {canonicalLinks.map((url) => (
              <CanonicalLinkPreviewCard key={url} url={url} />
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}
