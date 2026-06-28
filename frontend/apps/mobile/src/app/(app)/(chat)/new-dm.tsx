/**
 * New DM screen
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { searchEmployees, createOrGetDirectMessage } from "apis";

export default function NewDmScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["employee-search", query],
    queryFn: async () => {
      if (query.length < 2) return [];
      return searchEmployees(query);
    },
    enabled: query.length >= 2,
  });

  const createDmMutation = useMutation({
    mutationFn: async (employeeId: string) => {
      const result = await createOrGetDirectMessage(employeeId);
      return result;
    },
    onSuccess: (result: any) => {
      const channelId = result?.channel?.id;
      if (channelId) {
        router.replace(`/(app)/(chat)/${channelId}`);
      }
    },
    onError: () => {
      Alert.alert("Error", "Could not open direct message. Please try again.");
    },
  });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: "New Message",
          headerLargeTitle: false,
          headerLeft: () => (
            <Pressable
              testID="new-dm-cancel-button"
              accessibilityRole="button"
              accessibilityLabel="Cancel new message"
              hitSlop={12}
              onPress={() => router.back()}
            >
              <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <View style={{ padding: 12 }}>
        <TextInput
          style={{
            borderWidth: 1,
            borderColor: "#ddd",
            borderRadius: 10,
            borderCurve: "continuous",
            padding: 14,
            fontSize: 16,
            backgroundColor: "#fafafa",
          }}
          placeholder="Search people..."
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textContentType="none"
          autoFocus
          value={query}
          onChangeText={setQuery}
        />
      </View>
      {isLoading && <ActivityIndicator style={{ marginTop: 16 }} />}
      <FlatList
        data={(data as any[]) ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              if (!createDmMutation.isPending) {
                createDmMutation.mutate(item.id);
              }
            }}
            disabled={createDmMutation.isPending}
            style={({ pressed }) => ({
              padding: 16,
              backgroundColor: pressed ? "#f5f5f5" : "#fff",
              borderBottomWidth: 0.5,
              borderBottomColor: "#e2e8f0",
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              opacity: createDmMutation.isPending ? 0.6 : 1,
            })}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: "#e8eaf6",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 18 }}>
                {(item.givenName ?? "?")[0].toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: "#111" }}>
                {item.givenName} {item.familyName}
              </Text>
              {item.email && (
                <Text style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
                  {item.email}
                </Text>
              )}
            </View>
            {createDmMutation.isPending && (
              <ActivityIndicator size="small" color="#64748b" />
            )}
          </Pressable>
        )}
        ListEmptyComponent={
          query.length >= 2 && !isLoading ? (
            <View style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: "#666" }}>No results</Text>
            </View>
          ) : query.length < 2 ? (
            <View style={{ padding: 32, alignItems: "center" }}>
              <Text style={{ color: "#999" }}>
                Type at least 2 characters to search
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
