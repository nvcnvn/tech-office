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
 */

import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SFIcon } from "@/components/ui/sf-icon";
import { withNavigationContext } from "@/lib/mobile-navigation";
import { searchAll } from "apis";
import { useMMKVString } from "react-native-mmkv";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

// ── Recent items storage ────────────────────────────────────────────────────

const RECENTS_KEY = "global-search-recents";
const MAX_RECENTS = 10;

interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  domain: "Person" | "Channel" | "Message" | "Task" | "Event" | "Department" | "Document";
  sfIcon: string;
  tint: string;
  type: "employee" | "channel" | "message" | "task" | "event" | "department" | "document";
}

const DOMAIN_CONFIG: Record<string, { domain: SearchResult["domain"]; sfIcon: string; tint: string }> = {
  employee: { domain: "Person", sfIcon: "person.fill", tint: "#7b1fa2" },
  channel: { domain: "Channel", sfIcon: "bubble.left.fill", tint: "#2563eb" },
  message: { domain: "Message", sfIcon: "text.bubble.fill", tint: "#64748b" },
  task: { domain: "Task", sfIcon: "checkmark.square.fill", tint: "#16a34a" },
  event: { domain: "Event", sfIcon: "calendar", tint: "#e65100" },
  department: { domain: "Department", sfIcon: "building.2.fill", tint: "#2563eb" },
  document: { domain: "Document", sfIcon: "doc.text.fill", tint: "#7b1fa2" },
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

  const handleItemPress = useCallback(
    (item: SearchResult) => {
      addRecent(item);
      switch (item.type) {
        case "employee":
          // Navigate to DM with person
          break;
        case "channel":
          router.push(
            withNavigationContext(`/(app)/(chat)/${item.id}`, {
              fallbackHref: "/(app)/(more)",
              ownerTab: "more",
              backLabel: "Search",
            }) as never,
          );
          break;
        case "task":
          router.push(
            withNavigationContext(`/(app)/(tasks)/${item.id}` as any, {
              fallbackHref: "/(app)/(more)",
              ownerTab: "more",
              backLabel: "Search",
            }) as never,
          );
          break;
        case "event":
          router.push(
            withNavigationContext(`/(app)/(calendar)/${item.id}`, {
              fallbackHref: "/(app)/(more)",
              ownerTab: "more",
              backLabel: "Search",
            }) as never,
          );
          break;
        default:
          break;
      }
    },
    [addRecent, router],
  );

  const showRecents = query.length < 2;
  const displayItems = showRecents ? recentItems : results;
  const isEmpty = query.length >= 2 && !isLoading && results.length === 0;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <View style={styles.inputRow}>
          <SFIcon name="magnifyingglass" size={18} color={lightPalette.text.secondary} />
          <TextInput
            testID="global-search-input"
            style={styles.input}
            placeholder="Search people, tasks, chats\u2026"
            placeholderTextColor={lightPalette.text.secondary}
            autoCapitalize="none"
            autoFocus
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        <Pressable
          testID="search-cancel-button"
          onPress={() => router.back()}
          hitSlop={12}
          style={styles.cancelBtn}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      {/* Loading */}
      {(isLoading || isFetching) && query.length >= 2 && (
        <SkeletonList count={6} variant="double" />
      )}

      {/* Empty search result */}
      {isEmpty && (
        <View style={styles.emptyContainer}>
          <SFIcon name="magnifyingglass" size={40} color={lightPalette.text.disabled} />
          <Text style={styles.emptyText}>No results for "{query}"</Text>
        </View>
      )}

      {/* Results / Recents list */}
      {!isLoading && !isEmpty && (
        <ScrollView keyboardShouldPersistTaps="handled">
          {displayItems.length > 0 && (
            <>
              <View style={styles.listHeader}>
                <Text style={styles.listHeaderText}>
                  {showRecents ? "Recent" : "Results"}
                </Text>
              </View>
              <View style={styles.resultsCard}>
                {displayItems.map((item, index) => (
                  <React.Fragment key={`${item.type}-${item.id}-${index}`}>
                    {index > 0 && <View style={styles.cardSeparator} />}
                    <Pressable
                      onPress={() => handleItemPress(item)}
                      style={({ pressed }) => [
                        styles.resultRow,
                        pressed && styles.resultRowPressed,
                      ]}
                    >
                      <View style={[styles.iconCircle, { backgroundColor: `${item.tint}15` }]}>
                        <SFIcon name={item.sfIcon} size={20} color={item.tint} />
                      </View>
                      <View style={styles.resultContent}>
                        <Text style={styles.resultTitle} numberOfLines={1}>
                          {item.title}
                        </Text>
                        {item.subtitle && (
                          <Text style={styles.resultSubtitle} numberOfLines={1}>
                            {item.subtitle}
                          </Text>
                        )}
                      </View>
                      <View style={[styles.domainBadge, { backgroundColor: `${item.tint}15` }]}>
                        <Text style={[styles.domainBadgeText, { color: item.tint }]}>
                          {item.domain}
                        </Text>
                      </View>
                    </Pressable>
                  </React.Fragment>
                ))}
              </View>
              {showRecents && recentItems.length > 0 && (
                <Pressable onPress={clearRecents} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>Clear recent</Text>
                </Pressable>
              )}
            </>
          )}
          {displayItems.length === 0 && showRecents && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyHint}>Type 2+ letters to search</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: mobileLayout.screenPadding,
    paddingVertical: 8,
    gap: mobileLayout.iconTextGap,
    borderBottomWidth: border.hairline,
    borderBottomColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
  },
  inputRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: lightPalette.background.default,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    gap: 8,
    height: 40,
  },
  input: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.primary,
    padding: 0,
  },
  cancelBtn: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.primary.main,
    fontWeight: "500" as const,
  },
  listHeader: {
    paddingHorizontal: mobileLayout.screenPadding,
    paddingTop: spacing[1.5],
    paddingBottom: mobileLayout.itemGap,
  },
  listHeaderText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: mobileLayout.cardPadding,
    paddingVertical: 12,
    minHeight: mobileLayout.compactRowHeight,
    gap: mobileLayout.iconTextGap,
    backgroundColor: lightPalette.background.paper,
  },
  resultRowPressed: {
    opacity: opacity.pressed,
  },
  resultsCard: {
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
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  resultContent: {
    flex: 1,
    gap: 1,
  },
  resultTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: mobileTypography.listPrimary.fontWeight as "500",
    color: lightPalette.text.primary,
  },
  resultSubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  domainBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  domainBadgeText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "600" as const,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: mobileLayout.cardPadding * 2,
    gap: spacing[1.5],
  },
  emptyText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    color: lightPalette.text.secondary,
  },
  emptyHint: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
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
