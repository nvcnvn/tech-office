/**
 * Documents — list and search.
 *
 * The two data sources have different shapes: listDocuments returns
 * DocumentSummary, searchDocuments returns SearchResult wrappers around one.
 * This screen used to read title/slug/updatedAt straight off both, so every
 * search result rendered as "Untitled" and pushed /docs/undefined. Normalising
 * to one row shape at the query boundary is what keeps that from coming back.
 */

import React from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listDocuments, searchDocuments, type DocumentSummary } from "apis";
import { formatDistanceToNow } from "date-fns";
import { SFIcon } from "@/components/ui/sf-icon";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import {
  docRouteSegment,
  searchHitsToDocRows,
  toDocRows,
  type DocRow,
} from "@/lib/doc-rows";
import { withNavigationContext } from "@/lib/mobile-navigation";
import {
  border,
  mobileLayout,
  mobileTypography,
  radius,
  opacity,
  spacing,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 250;

export default function DocsListScreen() {
  const { palette } = useTheme();
  const styles = useStyles();

  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");

  // Without this, every keystroke was its own RPC and its own cache entry.
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const isSearching = debouncedQuery.length >= MIN_QUERY_LENGTH;

  const { data, isLoading, isError, error, refetch } = useQuery<DocRow[]>({
    queryKey: ["docs", isSearching ? debouncedQuery : ""],
    queryFn: async () => {
      if (isSearching) {
        const result = await searchDocuments({ query: debouncedQuery, limit: 30 });
        return searchHitsToDocRows(result.results);
      }
      const result = await listDocuments({ limit: 50 });
      return toDocRows(result.documents);
    },
    placeholderData: keepPreviousData,
  });

  const { isRefreshing, onRefresh } = useManualRefresh(refetch);
  const rows = data ?? [];

  const openDoc = (document: DocumentSummary) => {
    router.push(
      withNavigationContext(`/(app)/(more)/docs/${docRouteSegment(document)}`, {
        parentHref: "/(app)/(more)/docs",
        fallbackHref: "/(app)/(more)",
        ownerTab: "more",
        backLabel: "Docs",
      }) as never,
    );
  };

  return (
    <View style={styles.container}>
      {/* The search field stays mounted through loading: it used to be replaced
          by a full-screen spinner, which dismissed the keyboard mid-word. */}
      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <SFIcon name="magnifyingglass" size={16} color={palette.text.secondary} />
          <TextInput
            testID="docs-search-input"
            style={styles.searchInput}
            placeholder="Search documents…"
            placeholderTextColor={palette.text.disabled}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {isLoading ? (
        <SkeletonList count={6} variant="double" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.document.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.listContent,
            rows.length > 0 ? styles.listCard : null,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={palette.primary.main}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.cardSeparator} />}
          ListEmptyComponent={
            isError ? (
              <EmptyState
                sfSymbol="exclamationmark.triangle"
                title="We couldn't load documents"
                subtitle={
                  error instanceof Error && error.message
                    ? error.message
                    : "Check your connection and try again."
                }
                action={{ label: "Try again", onPress: () => void refetch() }}
              />
            ) : (
              <EmptyState
                sfSymbol="doc.text"
                title={isSearching ? "No matching documents" : "No documents"}
                subtitle={
                  isSearching
                    ? "Try a different search term."
                    : "Documents shared with your organization will appear here."
                }
              />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`doc-row-${item.document.id}`}
              onPress={() => openDoc(item.document)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.iconWrap}>
                <SFIcon name="doc.text.fill" size={18} color={palette.primary.main} />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.document.title || "Untitled"}
                </Text>
                {item.snippet ? (
                  <Text style={styles.snippet} numberOfLines={2}>
                    {item.snippet}
                  </Text>
                ) : null}
                <Text style={styles.subtitle}>
                  {item.document.ownerName ? `${item.document.ownerName} · ` : ""}
                  Updated{" "}
                  {formatDistanceToNow(item.document.updatedAt, { addSuffix: true })}
                </Text>
              </View>
              <SFIcon name="chevron.right" size={14} color={palette.text.disabled} />
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.background.default,
  },
  searchWrap: {
    padding: mobileLayout.screenPadding,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: t.background.paper,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: t.divider,
    paddingHorizontal: 12,
    gap: 8,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: t.text.primary,
    padding: 0,
  },
  listContent: {
    marginHorizontal: mobileLayout.screenPadding,
    marginBottom: spacing[4],
    flexGrow: 1,
  },
  listCard: {
    borderRadius: radius.md,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: t.background.paper,
    borderWidth: border.thin,
    borderColor: t.divider,
    flexGrow: 0,
  },
  cardSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.divider,
    marginHorizontal: mobileLayout.cardPadding,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 14,
    backgroundColor: t.background.paper,
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
    backgroundColor: t.primary.main + "12",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: t.text.primary,
  },
  snippet: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: mobileTypography.listSecondary.lineHeight as number,
    color: t.text.secondary,
  },
  subtitle: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: t.text.disabled,
  },
}));
