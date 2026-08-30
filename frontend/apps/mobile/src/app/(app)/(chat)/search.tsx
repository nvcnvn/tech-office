/**
 * Chat search — the one modal behind "Start Chat", the header envelope and the
 * in-channel magnifier.
 *
 * 1. Instant local filter of cached channels
 * 2. Debounced server search for channels and people
 * 3. Tap a person → create/open the DM; tap a channel → open it
 *
 * It uses the same SearchBar/result-card primitives as global search: this
 * used to be three separate hand-rolled boxes ("New Message", chat search,
 * global search) that looked and behaved differently.
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
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
import {
  SearchBar,
  SearchIconCircle,
  SearchResultRow,
  SearchResultsCard,
  SearchSectionHeader,
  searchLayout,
} from "@/components/ui/search-bar";
import { lightPalette } from "@tech-office/theme-tokens";

const CHANNEL_TINT = "#2563eb";

export default function ChatSearchScreen() {
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

  const { data: serverChannels, isFetching: channelsFetching } = useQuery({
    queryKey: ["search-channels", debouncedQuery],
    queryFn: () => searchChannels(debouncedQuery, 10),
    enabled: debouncedQuery.length > 0,
    staleTime: 0,
  });

  // People are always searched: this screen is also the "start a new chat"
  // entry point, so hiding them behind "fewer than 3 channel results" made
  // finding a colleague feel broken.
  const { data: employees, isFetching: employeesFetching } = useQuery({
    queryKey: ["search-employees", debouncedQuery],
    queryFn: () => searchEmployees(debouncedQuery, 10),
    enabled: debouncedQuery.length > 0,
    staleTime: 0,
  });

  const mergedChannelIds = new Set(localResults.map((c) => c.channel.id));
  const uniqueServerChannels = (serverChannels ?? []).filter(
    (sc) => !mergedChannelIds.has(sc.id)
  );
  const filteredEmployees = (employees ?? []).filter(
    (emp) => emp.id !== auth?.employeeId
  );

  const handleEmployeeTap = useCallback(
    async (emp: EmployeeSearchResult) => {
      if (creatingDMFor) return;
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
    [creatingDMFor, router]
  );

  const openChannel = useCallback(
    (channelId: string) => {
      router.replace({
        pathname: "/(app)/(chat)/[channelId]",
        params: { channelId },
      });
    },
    [router]
  );

  const channelRow = (
    channel: ChannelSearchResult | ChannelWithDetails["channel"]
  ) => (
    <SearchResultRow
      key={channel.id}
      testID={`search-result-channel-${channel.id}`}
      leading={
        <SearchIconCircle sfSymbol="bubble.left.fill" tint={CHANNEL_TINT} />
      }
      title={channel.displayName || channel.titleSlug || "Unnamed"}
      badge={{ label: "Channel", tint: CHANNEL_TINT }}
      onPress={() => openChannel(channel.id)}
    />
  );

  const isSearching =
    debouncedQuery.length > 0 && (channelsFetching || employeesFetching);
  const hasResults =
    localResults.length > 0 ||
    uniqueServerChannels.length > 0 ||
    filteredEmployees.length > 0;

  return (
    <SafeAreaView style={searchLayout.screen} edges={["top"]}>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search people or channels…"
        onCancel={() => router.back()}
        inputTestID="search-input"
        cancelTestID="search-cancel"
      />

      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      >
        {/* People first: this is the screen you open to start a chat. */}
        {filteredEmployees.length > 0 && (
          <>
            <SearchSectionHeader title="People" />
            <SearchResultsCard>
              {filteredEmployees.map((emp) => {
                const name = `${emp.givenName} ${emp.familyName}`.trim();
                return (
                  <SearchResultRow
                    key={emp.id}
                    testID={`search-result-employee-${emp.id}`}
                    leading={<UserAvatar name={name} size={36} color="#7c3aed" />}
                    title={name}
                    subtitle={emp.email}
                    onPress={() => void handleEmployeeTap(emp)}
                    disabled={creatingDMFor !== null}
                    trailing={
                      creatingDMFor === emp.id ? (
                        <ActivityIndicator size="small" />
                      ) : undefined
                    }
                  />
                );
              })}
            </SearchResultsCard>
          </>
        )}

        {(localResults.length > 0 || uniqueServerChannels.length > 0) && (
          <>
            <SearchSectionHeader title="Channels" />
            <SearchResultsCard>
              {localResults.map((ch) => channelRow(ch.channel))}
              {uniqueServerChannels.map((ch) => channelRow(ch))}
            </SearchResultsCard>
          </>
        )}

        {!hasResults && (
          <View style={searchLayout.emptyContainer}>
            {isSearching ? (
              <ActivityIndicator color={lightPalette.primary.main} />
            ) : (
              <Text style={searchLayout.emptyText}>
                {debouncedQuery
                  ? `No people or channels match "${debouncedQuery}"`
                  : "Type a name to start a chat, or a channel name to jump to it."}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
