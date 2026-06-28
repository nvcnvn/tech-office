/**
 * Chat — Smart Search Modal
 *
 * Full-screen search modal:
 * 1. Instant local filter of cached channels
 * 2. Debounced server search for channels
 * 3. Employee suggestions when channel results < 3
 * 4. Tap employee → create/open DM
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  searchChannels,
  searchEmployees,
  createOrGetDirectMessage,
  type ChannelWithDetails,
  type ChannelSearchResult,
  type EmployeeSearchResult,
} from "apis";
import { AuthContext } from "@/hooks/use-auth";
import { UserAvatar } from "@/components/common/user-avatar";
import { Image } from "expo-image";

type SearchResultItem =
  | { kind: "section"; title: string }
  | { kind: "channel"; channel: ChannelSearchResult }
  | { kind: "local-channel"; channel: ChannelWithDetails }
  | { kind: "employee"; employee: EmployeeSearchResult };

export default function SearchScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = React.use(AuthContext);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [creatingDMFor, setCreatingDMFor] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce query for server search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  // Instant local channel filter
  const localResults = React.useMemo(() => {
    if (!query.trim()) return [];
    const cached =
      queryClient.getQueryData<ChannelWithDetails[]>(["recentChannels"]) ?? [];
    const q = query.trim().toLowerCase();
    return cached.filter((ch) => {
      const name =
        ch.channel.displayName?.toLowerCase() ||
        ch.channel.titleSlug?.toLowerCase() ||
        "";
      return name.includes(q);
    });
  }, [query, queryClient]);

  // Server channel search
  const { data: serverChannels } = useQuery({
    queryKey: ["search-channels", debouncedQuery],
    queryFn: () => searchChannels(debouncedQuery, 10),
    enabled: debouncedQuery.length > 0,
    staleTime: 0,
  });

  // Merge local + server channels, deduplicate by ID
  const mergedChannelIds = new Set(localResults.map((c) => c.channel.id));
  const uniqueServerChannels = (serverChannels ?? []).filter(
    (sc) => !mergedChannelIds.has(sc.id)
  );
  const totalChannelResults = localResults.length + uniqueServerChannels.length;

  // Employee search when channel results < 3
  const { data: employees } = useQuery({
    queryKey: ["search-employees", debouncedQuery],
    queryFn: () => searchEmployees(debouncedQuery, 10),
    enabled: debouncedQuery.length > 0 && totalChannelResults < 3,
    staleTime: 0,
  });

  // Filter out current user from employee results
  const filteredEmployees = (employees ?? []).filter(
    (emp) => emp.id !== auth?.employeeId
  );

  // Build flat list items with section headers
  const listItems = React.useMemo(() => {
    if (!query.trim()) return [];
    const items: SearchResultItem[] = [];

    if (localResults.length > 0 || uniqueServerChannels.length > 0) {
      items.push({ kind: "section", title: "Channels" });
      for (const ch of localResults) {
        items.push({ kind: "local-channel", channel: ch });
      }
      for (const ch of uniqueServerChannels) {
        items.push({ kind: "channel", channel: ch });
      }
    }

    if (filteredEmployees.length > 0) {
      items.push({ kind: "section", title: "People" });
      for (const emp of filteredEmployees) {
        items.push({ kind: "employee", employee: emp });
      }
    }

    return items;
  }, [query, localResults, uniqueServerChannels, filteredEmployees]);

  // Handle employee tap — create/open DM
  const handleEmployeeTap = useCallback(
    async (emp: EmployeeSearchResult) => {
      setCreatingDMFor(emp.id);
      try {
        const result = await createOrGetDirectMessage(emp.id);
        router.replace({
          pathname: "/(app)/(chat)/[channelId]",
          params: { channelId: result.channel.id },
        });
      } catch {
        // silently handle error
      } finally {
        setCreatingDMFor(null);
      }
    },
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: SearchResultItem }) => {
      if (item.kind === "section") {
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{item.title}</Text>
          </View>
        );
      }

      if (item.kind === "local-channel") {
        const ch = item.channel;
        const name =
          ch.channel.displayName || ch.channel.titleSlug || "Unnamed";
        return (
          <Pressable
            testID={`search-result-channel-${ch.channel.id}`}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
            onPress={() =>
              router.replace({
                pathname: "/(app)/(chat)/[channelId]",
                params: { channelId: ch.channel.id },
              })
            }
          >
            <View style={styles.channelIcon}>
              <Text style={styles.channelIconText}>#</Text>
            </View>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {name}
            </Text>
          </Pressable>
        );
      }

      if (item.kind === "channel") {
        const ch = item.channel;
        return (
          <Pressable
            testID={`search-result-channel-${ch.id}`}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
            onPress={() =>
              router.replace({
                pathname: "/(app)/(chat)/[channelId]",
                params: { channelId: ch.id },
              })
            }
          >
            <View style={styles.channelIcon}>
              <Text style={styles.channelIconText}>#</Text>
            </View>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {ch.displayName || ch.titleSlug}
            </Text>
          </Pressable>
        );
      }

      if (item.kind === "employee") {
        const emp = item.employee;
        const name = `${emp.givenName} ${emp.familyName}`.trim();
        const isLoading = creatingDMFor === emp.id;
        return (
          <Pressable
            testID={`search-result-employee-${emp.id}`}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
            onPress={() => handleEmployeeTap(emp)}
            disabled={isLoading}
          >
            <UserAvatar name={name} size={36} color="#7c3aed" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                {emp.email}
              </Text>
            </View>
            {isLoading && <ActivityIndicator size="small" />}
          </Pressable>
        );
      }

      return null;
    },
    [router, creatingDMFor, handleEmployeeTap]
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.searchBar}>
        <TextInput
          testID="search-input"
          style={styles.searchInput}
          placeholder="Search channels or people"
          placeholderTextColor="#8e8e93"
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable testID="search-cancel" onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      <FlatList
        data={listItems}
        keyExtractor={(item, index) => {
          if (item.kind === "section") return `section-${item.title}`;
          if (item.kind === "local-channel") return `lc-${item.channel.channel.id}`;
          if (item.kind === "channel") return `sc-${item.channel.id}`;
          if (item.kind === "employee") return `emp-${item.employee.id}`;
          return `item-${index}`;
        }}
        renderItem={renderItem}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim() ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {debouncedQuery ? "No results found" : "Searching…"}
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#f2f2f7",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: "#111",
  },
  cancelText: {
    fontSize: 16,
    color: "#2563eb",
    fontWeight: "500",
  },
  sectionHeader: {
    backgroundColor: "#f2f2f7",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#636366",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  rowPressed: {
    backgroundColor: "#f2f2f7",
  },
  channelIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#dbeafe",
    justifyContent: "center",
    alignItems: "center",
  },
  channelIconText: {
    fontSize: 18,
    color: "#2563eb",
    fontWeight: "700",
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111",
  },
  rowSubtitle: {
    fontSize: 13,
    color: "#8e8e93",
  },
  emptyState: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#8e8e93",
  },
});
