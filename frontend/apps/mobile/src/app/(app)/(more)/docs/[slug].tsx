/**
 * Doc viewer — read-only rendering of a TipTap document.
 *
 * Still read-only; editing lives on the web. What changed is that the failure
 * modes are now visible: a document that will not load says so and offers a
 * retry, instead of rendering as "Empty document" and looking like the document
 * itself was blank.
 */

import React, { useMemo } from "react";
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
  DocumentContent,
  documentContentToText,
} from "@/components/docs/document-content";
import {
  buildCanonicalLinkPreviewDisplay,
  extractCanonicalResourceLinks,
  removeCanonicalResourceLinksFromContent,
  type CanonicalLinkPreview,
  type CanonicalLinkPreviewDisplay,
} from "@tech-office/links";
import {
  generateCanonicalUrl,
  getCanonicalInAppRoute,
} from "@/lib/canonical-links";
import { useCanonicalLinkPreviews } from "@/lib/canonical-link-previews";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

/** Small preview card for a canonical resource link in the document */
function CanonicalLinkPreviewCard({
  url,
  preview,
}: {
  url: string;
  preview: CanonicalLinkPreview;
}) {
  const router = useRouter();
  const display: CanonicalLinkPreviewDisplay = buildCanonicalLinkPreviewDisplay(preview);

  const handlePress = async () => {
    const route = await getCanonicalInAppRoute(url, { preferRecoverableFallback: true });
    if (route) router.push(route as any);
  };

  return (
    <Pressable
      onPress={() => void handlePress()}
      style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
    >
      <Text style={styles.linkBadge}>{display.badge}</Text>
      <Text style={styles.linkTitle} numberOfLines={2}>
        {display.title}
      </Text>
      {display.lines.map((line, index) => (
        <Text key={index} style={styles.linkSubtitle} numberOfLines={1}>
          {line}
        </Text>
      ))}
    </Pressable>
  );
}

// The route segment is a slug when the reader came from the docs list or search, and a
// document id when they came from a canonical link or a notification. GetDocument takes
// either, so the shape of the segment picks the field rather than every caller having to
// resolve an id to a slug first.
// Deliberately shape-only: the ids this receives are UUIDv7, so pinning the version and
// variant nibbles would reject every one of them. No slug has this shape.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DocViewerScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { membership } = useCurrentMembership();

  const { data: doc, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["doc", slug],
    queryFn: async () => {
      const result = await getDocument(
        UUID_PATTERN.test(slug!)
          ? { id: slug!, includeContent: true }
          : { slug: slug!, includeContent: true },
      );
      return result.document;
    },
    enabled: !!slug,
  });

  // One preview lookup for the whole document, before the early returns so the hook order
  // is stable. Nothing is fabricated from a URL: a link the reader may not open gets no
  // card and keeps its raw text.
  const documentTexts = useMemo(
    () => [documentContentToText(doc?.contentJson)],
    [doc],
  );
  const linkPreviews = useCanonicalLinkPreviews(documentTexts);

  const handleShare = async () => {
    if (!doc) return;
    const d = doc;
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

  const d = doc;
  const bodyText = documentContentToText(doc?.contentJson);

  // Only a link that produced a card is stripped from the body; anything the reader may
  // not preview keeps its raw text (FR-016).
  const canonicalLinks = extractCanonicalResourceLinks(bodyText);
  const cardedLinks = canonicalLinks.filter((url) => linkPreviews.has(url));
  const displayBodyText = removeCanonicalResourceLinksFromContent(bodyText, cardedLinks).trim();

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
        </Text>
      ) : null}

      {displayBodyText ? (
        <DocumentContent text={displayBodyText} />
      ) : canonicalLinks.length === 0 ? (
        <EmptyState
          sfSymbol="doc.text"
          title="This document is empty"
          subtitle="Nothing has been written in it yet. You can add to it on the web."
        />
      ) : null}

      {cardedLinks.length > 0 ? (
        <View style={styles.linksSection}>
          <Text style={styles.linksHeader}>Linked Resources</Text>
          {cardedLinks.map((url) => (
            <CanonicalLinkPreviewCard key={url} url={url} preview={linkPreviews.get(url)!} />
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
