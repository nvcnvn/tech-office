/**
 * New Channel creation modal
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createChannel } from "apis";

export default function NewChannelScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      await createChannel({
        slug: name.trim().toLowerCase().replace(/\s+/g, "-"),
        name: name.trim(),
        description: description.trim(),
        isPrivate,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recentChannels"] });
      router.back();
    },
    onError: (err) => {
      Alert.alert("Error", err.message);
    },
  });

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 24, gap: 16 }}
    >
      <Stack.Screen
        options={{
          title: "New Channel",
          headerLeft: () => (
            <Pressable
              testID="new-channel-cancel-button"
              accessibilityRole="button"
              accessibilityLabel="Cancel new channel"
              hitSlop={12}
              onPress={() => router.back()}
            >
              <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Cancel</Text>
            </Pressable>
          ),
        }}
      />

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
          Channel Name
        </Text>
        <TextInput
          style={inputStyle}
          placeholder="general"
          autoCapitalize="none"
          autoCorrect={false}
          value={name}
          onChangeText={setName}
        />
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
          Description (optional)
        </Text>
        <TextInput
          style={[inputStyle, { height: 80, textAlignVertical: "top" }]}
          placeholder="What's this channel about?"
          multiline
          value={description}
          onChangeText={setDescription}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 4,
        }}
      >
        <View style={{ flex: 1, paddingRight: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: "500", color: "#111" }}>
            Private Channel
          </Text>
          <Text style={{ fontSize: 13, color: "#8e8e93", marginTop: 2 }}>
            Only invited members can see and join
          </Text>
        </View>
        <Switch value={isPrivate} onValueChange={setIsPrivate} />
      </View>

      <Pressable
        onPress={() => mutation.mutate()}
        disabled={!name.trim() || mutation.isPending}
        style={({ pressed }) => ({
          backgroundColor:
            !name.trim() ? "#ccc" : pressed ? "#020617" : "#0f172a",
          borderRadius: 12,
          borderCurve: "continuous",
          padding: 16,
          alignItems: "center",
        })}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>
            Create Channel
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: "#ddd",
  borderRadius: 10,
  borderCurve: "continuous" as const,
  padding: 14,
  fontSize: 16,
  backgroundColor: "#fafafa",
};
