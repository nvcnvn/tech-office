/**
 * Docs — document list
 */

import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listDocuments, searchDocuments } from "apis";
import { formatDistanceToNow } from "date-fns";
import { SFIcon } from "@/components/ui/sf-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { withNavigationContext } from "@/lib/mobile-navigation";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  opacity,
  spacing,
} from "@tech-office/theme-tokens";

export default function DocsListScreen() {
  const [query, setQuery] = useState("");
  const router = useRouter();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["docs", query],
    queryFn: async () => {
      if (query.trim()) {
        const result = await searchDocuments({ query: query.trim(), limit: 30 });
        return result.results ?? [];
      }
      const result = await listDocuments({ limit: 50 });
      return result.documents ?? [];
    },
    placeholderData: (prev: any) => prev,
  });

  const filtered = query
    ? (data ?? []).filter((d: any) =>
        d.title?.toLowerCase().includes(query.toLowerCase())
      )
    : (data ?? []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={docStyles.container}
      contentContainerStyle={docStyles.scrollContent}
    >
      <View style={docStyles.searchWrap}>
        <View style={docStyles.searchRow}>
          <SFIcon name="magnifyingglass" size={16} color={lightPalette.text.secondary} />
          <TextInput
            style={docStyles.searchInput}
            placeholder="Search documents…"
            placeholderTextColor={lightPalette.text.disabled}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
        </View>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          sfSymbol="doc.text"
          title="No documents"
          subtitle={query ? "Try a different search term." : "Documents will appear here."}
        />
      ) : (
        <View style={docStyles.card}>
          {filtered.map((item: any, index: number) => (
            <React.Fragment key={item.id ?? item.slug}>
              {index > 0 && <View style={docStyles.cardSeparator} />}
              <Pressable
                  onPress={() =>
                    router.push(
                      withNavigationContext(`/(app)/(more)/docs/${item.slug ?? item.id}`, {
                        parentHref: "/(app)/(more)/docs",
                        fallbackHref: "/(app)/(more)",
                        ownerTab: "more",
                        backLabel: "Docs",
                      }) as never,
                    )
                  }
                  style={({ pressed }) => [
                    docStyles.row,
                    pressed && docStyles.rowPressed,
                  ]}
                >
                  <View style={docStyles.iconWrap}>
                    <SFIcon name="doc.text.fill" size={18} color={lightPalette.primary.main} />
                  </View>
                  <View style={docStyles.rowContent}>
                    <Text style={docStyles.title} numberOfLines={1}>
                      {item.title ?? "Untitled"}
                    </Text>
                    {item.updatedAt && (
                      <Text style={docStyles.subtitle}>
                        Updated{" "}
                        {formatDistanceToNow(new Date(item.updatedAt), {
                          addSuffix: true,
                        })}
                      </Text>
                    )}
                  </View>
                </Pressable>
            </React.Fragment>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const docStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  scrollContent: {
    paddingBottom: spacing[4],
  },
  searchWrap: {
    padding: mobileLayout.screenPadding,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: lightPalette.background.paper,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    paddingHorizontal: 12,
    gap: 8,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.primary,
    padding: 0,
  },
  card: {
    marginHorizontal: mobileLayout.screenPadding,
    borderRadius: radius.md,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: lightPalette.background.paper,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
  },
  cardSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: lightPalette.divider,
    marginHorizontal: mobileLayout.cardPadding,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 14,
    backgroundColor: lightPalette.background.paper,
    gap: mobileLayout.iconTextGap,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  rowContent: {
    flex: 1,
    gap: 2,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderCurve: "continuous",
    backgroundColor: lightPalette.primary.main + "12",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: lightPalette.text.primary,
  },
  subtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
});
