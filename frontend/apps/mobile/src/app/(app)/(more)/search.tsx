/**
 * Global search — full-screen modal
 *
 * Per mobile-ui-design.md (§3):
 * - "Cancel" text button to dismiss (not icon-only)
 * - Auto-focused real input
 * - Before typing: recent items
 * - After 2+ chars: flat ranked list with domain badge on every row
 * - Tap → navigate directly
 * - "Clear recent" footer action
 *
 * Feature 045: one request to SearchService.Search returns the ranked list over all
 * eight sources. The ranking, the per-source capping and the access filtering all happen
 * on the server, so this screen and the web results page show the same results in the
 * same order by construction — there is nothing left here to merge or re-rank.
 *
 * The bar and rows come from components/ui/search-bar so chat search and this
 * screen stay the same product.
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  Alert,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { withNavigationContext } from "@/lib/mobile-navigation";
import {
  createOrGetDirectMessage,
  search,
  searchKindLabel,
  type SearchHit,
  type SearchKind,
} from "apis";
import { useMMKVString } from "react-native-mmkv";
import { SkeletonList } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/common/user-avatar";
import {
  SearchBar,
  SearchIconCircle,
  SearchResultRow,
  SearchResultsCard,
  SearchSectionHeader,
  searchLayout,
} from "@/components/ui/search-bar";
import { SFIcon } from "@/components/ui/sf-icon";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
} from "@tech-office/theme-tokens";

// ── Recent items storage ────────────────────────────────────────────────────

const RECENTS_KEY = "global-search-recents";
const MAX_RECENTS = 10;

/**
 * A row, flattened to what the list needs to render and reopen it. Recents are stored in
 * this shape, so it holds the whole target rather than a bare id — a recent has to be
 * openable months later without re-running the search.
 */
interface SearchRow {
  /** Stable per kind: the identifier that kind is opened by. */
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  /** Everything needed to open it, straight off the hit. */
  target: Partial<Record<string, string>>;
}

/**
 * Every kind, mapped to its badge, icon and tint.
 *
 * A `Record` rather than a `switch`: adding a kind to the wire contract without adding it
 * here fails `tsc`, so a new kind cannot reach the screen as an unlabelled row.
 */
const KIND_CONFIG: Record<SearchKind, { domain: string; sfIcon: string; tint: string }> = {
  person: { domain: "Person", sfIcon: "person.fill", tint: "#7b1fa2" },
  channel: { domain: "Channel", sfIcon: "bubble.left.fill", tint: "#2563eb" },
  document: { domain: "Document", sfIcon: "doc.text.fill", tint: "#0f766e" },
  work_item: { domain: "Work item", sfIcon: "checkmark.circle.fill", tint: "#b45309" },
  event: { domain: "Event", sfIcon: "calendar", tint: "#be123c" },
  file: { domain: "File", sfIcon: "paperclip", tint: "#475569" },
  department: { domain: "Department", sfIcon: "building.2.fill", tint: "#2563eb" },
  message: { domain: "Message", sfIcon: "text.bubble.fill", tint: "#64748b" },
};

/** The identifier a hit's own kind is opened by. */
function rowIdFor(hit: SearchHit): string {
  const t = hit.target;
  switch (hit.kind) {
    case "person":
      return t.employeeId;
    case "department":
      return t.departmentId;
    case "channel":
      return t.channelId;
    case "message":
      return t.messageId;
    case "document":
      return t.documentSlug;
    case "file":
      return t.fileId;
    case "work_item":
      return t.taskId;
    case "event":
      return t.eventId;
  }
}

function toRow(hit: SearchHit): SearchRow {
  return {
    id: rowIdFor(hit),
    kind: hit.kind,
    title: hit.title,
    subtitle: hit.contextLine || undefined,
    target: { ...hit.target },
  };
}

function useRecentItems() {
  const [raw, setRaw] = useMMKVString(RECENTS_KEY);

  const items: SearchRow[] = useMemo(() => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as SearchRow[];
      // Recents written by an older build carried a `type` field and no target; they
      // cannot be opened, so drop them rather than offering a dead row.
      return parsed.filter((item) => item && item.kind in KIND_CONFIG && item.target);
    } catch {
      return [];
    }
  }, [raw]);

  const addRecent = useCallback(
    (item: SearchRow) => {
      const filtered = items.filter((i) => !(i.id === item.id && i.kind === item.kind));
      const next = [item, ...filtered].slice(0, MAX_RECENTS);
      setRaw(JSON.stringify(next));
    },
    [items, setRaw],
  );

  const removeRecent = useCallback(
    (item: SearchRow) => {
      const next = items.filter((i) => !(i.id === item.id && i.kind === item.kind));
      setRaw(next.length > 0 ? JSON.stringify(next) : undefined);
    },
    [items, setRaw],
  );

  const clearRecents = useCallback(() => {
    setRaw(undefined);
  }, [setRaw]);

  return { items, addRecent, removeRecent, clearRecents };
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [openingDMFor, setOpeningDMFor] = useState<string | null>(null);
  const { items: recentItems, addRecent, removeRecent, clearRecents } = useRecentItems();

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ["search", query],
    queryFn: () => search({ query }),
    enabled: query.length >= 2,
    staleTime: 10_000,
  });

  // The server already ranked and capped. Rendering in order is the whole of it.
  const results: SearchRow[] = useMemo(() => (data?.hits ?? []).map(toRow), [data]);

  // A source that could not be reached is named. A source this person may not search
  // stays silent — it is not broken, it is not theirs.
  const unavailableKinds = useMemo(
    () => (data?.outcomes ?? []).filter((o) => o.status === "unavailable").map((o) => o.kind),
    [data],
  );

  const openChat = useCallback(
    (channelId: string, highlightedMessageId?: string) => {
      const path = highlightedMessageId
        ? `/(app)/(chat)/${channelId}?highlightedMessageId=${highlightedMessageId}`
        : `/(app)/(chat)/${channelId}`;
      router.push(
        withNavigationContext(path, {
          fallbackHref: "/(app)/(more)",
          ownerTab: "more",
          backLabel: "Search",
        }) as never,
      );
    },
    [router],
  );

  const pushWithBack = useCallback(
    (path: string) => {
      router.push(
        withNavigationContext(path, {
          fallbackHref: "/(app)/(more)",
          ownerTab: "more",
          backLabel: "Search",
        }) as never,
      );
    },
    [router],
  );

  /**
   * Opens a row. Returns false when the row cannot be opened at all, which is what makes
   * a stale recent evict itself instead of being offered again every visit.
   */
  const openRow = useCallback(
    async (item: SearchRow): Promise<boolean> => {
      const t = item.target;
      switch (item.kind) {
        case "person": {
          if (!t.employeeId) return false;
          if (openingDMFor) return true;
          setOpeningDMFor(item.id);
          try {
            const result = await createOrGetDirectMessage(t.employeeId);
            openChat(result.channel.id);
            return true;
          } catch (err) {
            Alert.alert(
              "Couldn't open conversation",
              err instanceof Error && err.message ? err.message : "Try again in a moment.",
            );
            return false;
          } finally {
            setOpeningDMFor(null);
          }
        }
        case "channel":
          if (!t.channelId) return false;
          openChat(t.channelId);
          return true;
        case "message":
          // A message opens the channel it was posted in, with the message highlighted.
          if (!t.channelId) return false;
          openChat(t.channelId, t.messageId);
          return true;
        case "document":
          if (!t.documentSlug) return false;
          pushWithBack(`/(app)/(more)/docs/${t.documentSlug}`);
          return true;
        case "file":
          if (!t.fileId) return false;
          pushWithBack(`/(app)/(more)/files/${t.fileId}`);
          return true;
        case "work_item":
          // Both task routes are project-scoped; the project id travelled with the hit,
          // so opening one costs no extra round-trip.
          if (!t.projectId || !t.taskId) return false;
          pushWithBack(`/(app)/(tasks)/${t.projectId}/task/${t.taskId}`);
          return true;
        case "event":
          if (!t.eventId) return false;
          pushWithBack(`/(app)/(calendar)/${t.eventId}`);
          return true;
        case "department":
          // No department screen exists on mobile yet, so these rows stay informational
          // rather than pretending to navigate.
          return true;
      }
    },
    [openChat, openingDMFor, pushWithBack],
  );

  const handleResultPress = useCallback(
    async (item: SearchRow) => {
      const opened = await openRow(item);
      if (opened) addRecent(item);
    },
    [addRecent, openRow],
  );

  const handleRecentPress = useCallback(
    async (item: SearchRow) => {
      const opened = await openRow(item);
      if (!opened) {
        // A recent that keeps offering something that is gone is the failure mode being
        // fixed: say so once, then stop offering it.
        Alert.alert("This item is no longer available", "It has been removed from your recents.");
        removeRecent(item);
      }
    },
    [openRow, removeRecent],
  );

  const showRecents = query.length < 2;
  const displayItems = showRecents ? recentItems : results;
  const isEmpty = query.length >= 2 && !isLoading && !isError && results.length === 0;

  return (
    <SafeAreaView style={searchLayout.screen} edges={["top"]}>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search people, docs, tasks, files…"
        onCancel={() => router.back()}
        inputTestID="global-search-input"
        cancelTestID="search-cancel-button"
      />

      {/* Loading */}
      {(isLoading || isFetching) && query.length >= 2 && (
        <SkeletonList count={6} variant="double" />
      )}

      {/* A failed call is not "no results": showing an empty list would say the workspace
          holds nothing, and showing the last list would say it still holds that. */}
      {isError && query.length >= 2 && !isFetching && (
        <View style={searchLayout.emptyContainer} testID="search-request-failed">
          <SFIcon name="exclamationmark.triangle" size={40} color={lightPalette.text.disabled} />
          <Text style={searchLayout.emptyText}>
            The search could not run. Check your connection and try again.
          </Text>
        </View>
      )}

      {/* Empty search result */}
      {isEmpty && (
        <View style={searchLayout.emptyContainer}>
          <SFIcon name="magnifyingglass" size={40} color={lightPalette.text.disabled} />
          <Text style={searchLayout.emptyText}>No results for "{query}"</Text>
        </View>
      )}

      {/* Results / Recents list */}
      {!isLoading && !isError && !isEmpty && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {!showRecents && unavailableKinds.length > 0 && (
            <View style={styles.unavailableNote} testID="search-unavailable-note">
              <SFIcon name="exclamationmark.triangle" size={14} color={lightPalette.warning.main} />
              <Text style={styles.unavailableText}>
                {unavailableKinds.map(searchKindLabel).join(", ")} could not be searched.
              </Text>
            </View>
          )}

          {displayItems.length > 0 && (
            <>
              <SearchSectionHeader title={showRecents ? "Recent" : "Results"} />
              <SearchResultsCard>
                {displayItems.map((item, index) => {
                  const config = KIND_CONFIG[item.kind];
                  return (
                    <SearchResultRow
                      key={`${item.kind}-${item.id}-${index}`}
                      testID={`search-result-${item.kind}`}
                      leading={
                        item.kind === "person" ? (
                          <UserAvatar name={item.title} size={36} color={config.tint} />
                        ) : (
                          <SearchIconCircle sfSymbol={config.sfIcon} tint={config.tint} />
                        )
                      }
                      title={item.title}
                      subtitle={item.subtitle}
                      badge={{ label: config.domain, tint: config.tint }}
                      trailing={
                        openingDMFor === item.id ? <ActivityIndicator size="small" /> : undefined
                      }
                      disabled={openingDMFor !== null}
                      onPress={() =>
                        void (showRecents ? handleRecentPress(item) : handleResultPress(item))
                      }
                    />
                  );
                })}
              </SearchResultsCard>
              {showRecents && recentItems.length > 0 && (
                <Pressable onPress={clearRecents} style={styles.clearBtn} testID="clear-recents">
                  <Text style={styles.clearBtnText}>Clear recent</Text>
                </Pressable>
              )}
            </>
          )}
          {displayItems.length === 0 && showRecents && (
            <View style={searchLayout.emptyContainer}>
              <Text style={searchLayout.emptyText}>Type 2+ letters to search</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    paddingBottom: mobileLayout.screenPadding,
  },
  unavailableNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: mobileLayout.screenPadding,
    paddingTop: mobileLayout.screenPadding,
  },
  unavailableText: {
    flex: 1,
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.text.secondary,
  },
  clearBtn: {
    alignItems: "center",
    padding: mobileLayout.screenPadding,
  },
  clearBtnText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.error.main,
    fontWeight: "500" as const,
  },
});
