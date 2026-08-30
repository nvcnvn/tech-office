/**
 * Doc viewer — read-only rendering of a TipTap document.
 *
 * Still read-only; editing lives on the web. What changed is that the failure
 * modes are now visible: a document that will not load says so and offers a
 * retry, instead of rendering as "Empty document" and looking like the document
 * itself was blank.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getDocument } from "apis";
import { formatDistanceToNow } from "date-fns";
import { useCurrentMembership } from "@/hooks/use-current-membership";
import { EmptyState } from "@/components/ui/empty-state";
import {
  extractCanonicalResourceLinks,
  getCanonicalLinkPreviewDisplay,
  removeCanonicalResourceLinksFromContent,
  type CanonicalLinkPreviewDisplay,
} from "@tech-office/links";
import {
  fetchCanonicalPreview,
  generateCanonicalUrl,
  getCanonicalInAppRoute,
} from "@/lib/canonical-links";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

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
    fetchCanonicalPreview(url)
      .then((result) => {
        if (cancelled) return;
        setDisplay(getCanonicalLinkPreviewDisplay(result?.preview ?? null, url));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDisplay(getCanonicalLinkPreviewDisplay(null, url));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handlePress = async () => {
    const route = await getCanonicalInAppRoute(url, { preferRecoverableFallback: true });
    if (route) router.push(route as any);
  };

  if (loading) {
    return (
      <View style={styles.linkCard}>
        <ActivityIndicator size="small" color={lightPalette.text.secondary} />
      </View>
    );
  }
  if (!display) return null;

  return (
    <Pressable
      onPress={() => void handlePress()}
      style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
    >
      <Text style={styles.linkBadge}>{display.badge}</Text>
      {display.title ? (
        <Text style={styles.linkTitle} numberOfLines={2}>
          {display.title}
        </Text>
      ) : null}
      {display.subtitle ? (
        <Text style={styles.linkSubtitle} numberOfLines={1}>
          {display.subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function DocViewerScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { membership } = useCurrentMembership();

  const { data: doc, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["doc", slug],
    queryFn: async () => {
      const result = await getDocument({ slug: slug!, includeContent: true });
      return result.document;
    },
    enabled: !!slug,
  });

  const handleShare = async () => {
    if (!doc) return;
    const d = doc as any;
    const title = d.title || "Document";

    // generateCanonicalUrl sends the auth token; this screen used to hand-roll
    // the same POST without one, so sharing quietly fell back to a title-only
    // message with no link in it.
    const canonicalUrl =
      membership?.organizationSubdomain && d.id
        ? await generateCanonicalUrl(membership.organizationSubdomain, "document", d.id)
        : null;

    await Share.share(
      canonicalUrl
        ? { title, message: canonicalUrl, url: canonicalUrl }
        : { title, message: `Check out this document: ${title}` },
    );
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: "Document" }} />
        <ActivityIndicator size="large" color={lightPalette.primary.main} />
      </View>
    );
  }

  if (isError || !doc) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: "Document" }} />
        <EmptyState
          sfSymbol="exclamationmark.triangle"
          title="We couldn't open this document"
          subtitle={
            error instanceof Error && error.message
              ? error.message
              : "It may have been deleted, or you may not have access to it."
          }
          action={{ label: "Try again", onPress: () => void refetch() }}
        />
      </View>
    );
  }

  const d = doc as any;
  let bodyText = "";
  try {
    const content = typeof d?.content === "string" ? JSON.parse(d.content) : d?.content;
    bodyText = extractText(content);
  } catch {
    bodyText = typeof d?.content === "string" ? d.content : "";
  }

  const canonicalLinks = extractCanonicalResourceLinks(bodyText);
  const displayBodyText = (
    canonicalLinks.length > 0
      ? removeCanonicalResourceLinksFromContent(bodyText)
      : bodyText
  ).trim();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen
        options={{
          title: d?.title || "Document",
          headerRight: () => (
            <Pressable
              testID="doc-share-button"
              accessibilityRole="button"
              accessibilityLabel="Share document"
              hitSlop={12}
              onPress={() => void handleShare()}
            >
              <Text style={styles.shareLabel}>Share</Text>
            </Pressable>
          ),
        }}
      />

      {d?.updatedAt ? (
        <Text style={styles.meta}>
          Last updated {formatDistanceToNow(new Date(d.updatedAt), { addSuffix: true })}
          {d?.updatedByName ? ` by ${d.updatedByName}` : ""}
        </Text>
      ) : null}

      {displayBodyText ? (
        <Text selectable style={styles.body}>
          {displayBodyText}
        </Text>
      ) : canonicalLinks.length === 0 ? (
        <EmptyState
          sfSymbol="doc.text"
          title="This document is empty"
          subtitle="Nothing has been written in it yet. You can add to it on the web."
        />
      ) : null}

      {canonicalLinks.length > 0 ? (
        <View style={styles.linksSection}>
          <Text style={styles.linksHeader}>Linked Resources</Text>
          {canonicalLinks.map((url) => (
            <CanonicalLinkPreviewCard key={url} url={url} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  content: {
    padding: mobileLayout.screenPadding,
    gap: spacing[1.5],
    paddingBottom: spacing[6],
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: mobileLayout.screenPadding,
    backgroundColor: lightPalette.background.default,
  },
  shareLabel: {
    fontSize: mobileTypography.buttonSm.fontSize as number,
    fontWeight: "600",
    color: lightPalette.primary.main,
  },
  meta: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  body: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    lineHeight: 24,
    color: lightPalette.text.primary,
  },
  linksSection: {
    gap: spacing[1],
    marginTop: spacing[1],
  },
  linksHeader: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: lightPalette.text.secondary,
  },
  linkCard: {
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    borderRadius: radius.md,
    borderCurve: "continuous",
    padding: mobileLayout.cardPadding,
    backgroundColor: lightPalette.background.paper,
    gap: 4,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  linkBadge: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  linkTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "600",
    color: lightPalette.text.primary,
  },
  linkSubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
});
