/**
 * People — the workspace directory.
 *
 * The one thing mobile could not do: answer "who works here, and how do I reach them?"
 * without finding a laptop. Browsing is cursor-paginated in name order; typing narrows
 * the whole roster through the same fuzzy matcher search uses, and returns one page.
 *
 * Rows carry everything they render. Tapping one seeds both the person-entry cache and
 * the shared user-profile cache, so the entry screen paints before its own fetch resolves
 * and avatars elsewhere in the app stop re-fetching what this list just loaded.
 */

import React from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { DirectoryRow } from "@/components/common/directory-row";
import { EmptyState } from "@/components/ui/empty-state";
import { SFIcon } from "@/components/ui/sf-icon";
import { SkeletonList } from "@/components/ui/skeleton";
import { useDirectoryList, useOpenPerson } from "@/hooks/use-directory";
import {
  border,
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Defined at module scope, not inline in the list: `ListHeaderComponent` is reconciled by
 * component type, so an inline arrow would be a new type on every keystroke and remount
 * the input, dropping focus and the keyboard after the first letter.
 */
function PeopleSearchHeader({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (next: string) => void;
}) {
  const { palette } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.searchWrap}>
      <View style={styles.searchRow}>
        <SFIcon name="magnifyingglass" size={16} color={palette.text.secondary} />
        <TextInput
          testID="people-search-input"
          style={styles.searchInput}
          placeholder="Search people…"
          placeholderTextColor={palette.text.disabled}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>
    </View>
  );
}

export default function PeopleDirectoryScreen() {
  const styles = useStyles();

  const [query, setQuery] = React.useState("");
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const openPerson = useOpenPerson();

  // Without this, every keystroke is its own request and its own cache entry.
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDirectoryList(undefined, debouncedQuery);

  const entries = React.useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.entries),
    [data],
  );

  // One list, always mounted, with the search bar as its sticky header. Rendering a
  // full-screen spinner instead used to unmount the input and dismiss the keyboard
  // mid-word; and the header is inside the list so iOS pays back the transparent
  // header's inset through contentInsetAdjustmentBehavior. A plain View above the list
  // gets no inset and sits underneath the bar, invisible but still tappable.
  return (
    <FlatList
      testID="people-directory-list"
      contentInsetAdjustmentBehavior="automatic"
      data={entries}
      keyExtractor={(entry) => entry.employeeId}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      style={styles.list}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <PeopleSearchHeader value={query} onChangeText={setQuery} />
      }
      stickyHeaderIndices={[0]}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      }}
      ListFooterComponent={
        isFetchingNextPage ? <Text style={styles.footer}>Loading more…</Text> : null
      }
      ListEmptyComponent={
        isLoading ? (
          <SkeletonList count={8} variant="double" />
        ) : isError ? (
          <EmptyState
            sfSymbol="exclamationmark.triangle"
            title="We couldn't load your colleagues"
            subtitle={
              error instanceof Error && error.message
                ? error.message
                : "Check your connection and try again."
            }
            action={{ label: "Try again", onPress: () => void refetch() }}
          />
        ) : (
          <EmptyState
            sfSymbol="person.2"
            title={debouncedQuery ? "Nobody by that name" : "No colleagues yet"}
            subtitle={
              debouncedQuery
                ? "Try a different spelling, or part of a family name."
                : "People added to your workspace will appear here."
            }
          />
        )
      }
      renderItem={({ item }) => (
        <DirectoryRow
          entry={item}
          onPress={() => openPerson(item, "People", "/(app)/(more)/people")}
        />
      )}
    />
  );
}

const useStyles = makeStyles((t) => ({
  list: {
    flex: 1,
    backgroundColor: t.background.default,
  },
  searchWrap: {
    padding: mobileLayout.screenPadding,
    backgroundColor: t.background.default,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    backgroundColor: t.background.paper,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: t.divider,
    paddingHorizontal: spacing[1.5],
    // An explicit height, not minHeight: on iOS a bare TextInput contributes no
    // intrinsic height, and the whole row collapsed to nothing while still being
    // present in the accessibility tree — visible to Maestro, invisible to a person.
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: t.text.primary,
    padding: 0,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: spacing[6],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.divider,
    marginLeft: mobileLayout.cardPadding,
  },
  footer: {
    padding: mobileLayout.screenPadding,
    textAlign: "center",
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: t.text.secondary,
  },
}));
