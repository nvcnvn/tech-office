/**
 * Global search — full-screen modal
 *
 * Per mobile-ui-design.md (§3):
 * - "Cancel" text button to dismiss (not icon-only)
 * - Auto-focused real input
 * - Before typing: recent items
 * - After 2+ chars: flat ranked list with domain badge on every row
 * - Tap → navigate directly (Person → DM, Channel → channel, Task → detail, Event → detail)
 * - "Clear recent" footer action
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
import { createOrGetDirectMessage, searchAll } from "apis";
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

// These four are exactly what searchAll returns. Task, Event and Document rows
// were configured here too, but nothing ever produced one, so their tap handlers
// were unreachable code pretending the screen searched more than it does.
interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  domain: "Person" | "Channel" | "Message" | "Department";
  sfIcon: string;
  tint: string;
  type: "employee" | "channel" | "message" | "department";
  /** Messages navigate to the channel they were posted in, not to their own id. */
  channelId?: string;
}

const DOMAIN_CONFIG: Record<
  SearchResult["type"],
  { domain: SearchResult["domain"]; sfIcon: string; tint: string }
> = {
  employee: { domain: "Person", sfIcon: "person.fill", tint: "#7b1fa2" },
  channel: { domain: "Channel", sfIcon: "bubble.left.fill", tint: "#2563eb" },
  message: { domain: "Message", sfIcon: "text.bubble.fill", tint: "#64748b" },
  department: { domain: "Department", sfIcon: "building.2.fill", tint: "#2563eb" },
};

function useRecentItems() {
  const [raw, setRaw] = useMMKVString(RECENTS_KEY);

  const items: SearchResult[] = useMemo(() => {
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }, [raw]);

  const addRecent = useCallback(
    (item: SearchResult) => {
      const filtered = items.filter((i) => !(i.id === item.id && i.type === item.type));
      const next = [item, ...filtered].slice(0, MAX_RECENTS);
      setRaw(JSON.stringify(next));
    },
    [items, setRaw],
  );

  const clearRecents = useCallback(() => {
    setRaw(undefined);
  }, [setRaw]);

  return { items, addRecent, clearRecents };
}

// ── Main Screen ─────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [openingDMFor, setOpeningDMFor] = useState<string | null>(null);
  const { items: recentItems, addRecent, clearRecents } = useRecentItems();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchAll(query, 12),
    enabled: query.length >= 2,
    staleTime: 10_000,
  });

  // Flatten all results into a single ranked list with domain badges
  const results: SearchResult[] = useMemo(() => {
    if (!data) return [];
    const flat: SearchResult[] = [];

    for (const e of data.employees ?? []) {
      const cfg = DOMAIN_CONFIG.employee;
      flat.push({
        id: e.id,
        title: `${e.givenName} ${e.familyName}`,
        subtitle: e.email,
        domain: cfg.domain,
        sfIcon: cfg.sfIcon,
        tint: cfg.tint,
        type: "employee",
      });
    }
    for (const c of data.channels ?? []) {
      const cfg = DOMAIN_CONFIG.channel;
      flat.push({
        id: c.id,
        title: c.displayName,
        subtitle: c.description ?? undefined,
        domain: cfg.domain,
        sfIcon: cfg.sfIcon,
        tint: cfg.tint,
        type: "channel",
      });
    }
    for (const m of data.messages ?? []) {
      const cfg = DOMAIN_CONFIG.message;
      flat.push({
        id: m.id,
        title: m.messageText,
        subtitle: m.channelName ?? undefined,
        domain: cfg.domain,
        sfIcon: cfg.sfIcon,
        tint: cfg.tint,
        type: "message",
        channelId: m.channelId,
      });
    }
    for (const d of data.departments ?? []) {
      const cfg = DOMAIN_CONFIG.department;
      flat.push({
        id: d.id,
        title: d.name,
        domain: cfg.domain,
        sfIcon: cfg.sfIcon,
        tint: cfg.tint,
        type: "department",
      });
    }

    return flat;
  }, [data]);

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

  const handleItemPress = useCallback(
    async (item: SearchResult) => {
      addRecent(item);
      switch (item.type) {
        case "employee": {
          // Tapping a person opens (or creates) the DM with them. This used to
          // be a no-op, so people rows in global search did nothing.
          if (openingDMFor) return;
          setOpeningDMFor(item.id);
          try {
            const result = await createOrGetDirectMessage(item.id);
            openChat(result.channel.id);
          } catch (err) {
            // A swallowed failure here looked like a dead row: the person tapped,
            // the spinner ran, and nothing happened.
            Alert.alert(
              "Couldn't open conversation",
              err instanceof Error && err.message
                ? err.message
                : "Try again in a moment.",
            );
          } finally {
            setOpeningDMFor(null);
          }
          break;
        }
        case "channel":
          openChat(item.id);
          break;
        case "message":
          // Tapping a message result did nothing at all. It opens the channel the
          // message is in, with the message highlighted.
          if (item.channelId) {
            openChat(item.channelId, item.id);
          }
          break;
        case "department":
          // No department screen exists on mobile yet, so these rows stay
          // informational rather than pretending to navigate.
          break;
      }
    },
    [addRecent, openChat, openingDMFor, router],
  );

  const showRecents = query.length < 2;
  const displayItems = showRecents ? recentItems : results;
  const isEmpty = query.length >= 2 && !isLoading && results.length === 0;

  return (
    <SafeAreaView style={searchLayout.screen} edges={["top"]}>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search people, tasks, chats…"
        onCancel={() => router.back()}
        inputTestID="global-search-input"
        cancelTestID="search-cancel-button"
      />

      {/* Loading */}
      {(isLoading || isFetching) && query.length >= 2 && (
        <SkeletonList count={6} variant="double" />
      )}

      {/* Empty search result */}
      {isEmpty && (
        <View style={searchLayout.emptyContainer}>
          <SFIcon name="magnifyingglass" size={40} color={lightPalette.text.disabled} />
          <Text style={searchLayout.emptyText}>No results for "{query}"</Text>
        </View>
      )}

      {/* Results / Recents list */}
      {!isLoading && !isEmpty && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {displayItems.length > 0 && (
            <>
              <SearchSectionHeader title={showRecents ? "Recent" : "Results"} />
              <SearchResultsCard>
                {displayItems.map((item, index) => (
                  <SearchResultRow
                    key={`${item.type}-${item.id}-${index}`}
                    leading={
                      item.type === "employee" ? (
                        <UserAvatar name={item.title} size={36} color={item.tint} />
                      ) : (
                        <SearchIconCircle sfSymbol={item.sfIcon} tint={item.tint} />
                      )
                    }
                    title={item.title}
                    subtitle={item.subtitle}
                    badge={{ label: item.domain, tint: item.tint }}
                    trailing={
                      openingDMFor === item.id ? (
                        <ActivityIndicator size="small" />
                      ) : undefined
                    }
                    disabled={openingDMFor !== null}
                    onPress={() => void handleItemPress(item)}
                  />
                ))}
              </SearchResultsCard>
              {showRecents && recentItems.length > 0 && (
                <Pressable onPress={clearRecents} style={styles.clearBtn}>
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
