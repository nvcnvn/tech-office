/**
 * Create Event modal
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createEvent } from "apis";

export default function CreateEventScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      await createEvent({
        title: title.trim(),
        description: description.trim(),
        locationText: location.trim(),
        eventType: "meeting",
        visibility: "team",
        // TODO: Add date/time picker
        startTime: new Date(),
        endTime: new Date(Date.now() + 3600000),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
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
      <Stack.Screen options={{ title: "New Event" }} />

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>Title</Text>
        <TextInput
          style={inputStyle}
          placeholder="Event title"
          value={title}
          onChangeText={setTitle}
        />
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>Location</Text>
        <TextInput
          style={inputStyle}
          placeholder="Conference room, Zoom link, etc."
          value={location}
          onChangeText={setLocation}
        />
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>Description</Text>
        <TextInput
          style={[inputStyle, { height: 100, textAlignVertical: "top" }]}
          placeholder="Details about this event"
          multiline
          value={description}
          onChangeText={setDescription}
        />
      </View>

      {/* TODO: DateTimePicker for start/end */}

      <Pressable
        onPress={() => mutation.mutate()}
        disabled={!title.trim() || mutation.isPending}
        style={({ pressed }) => ({
          backgroundColor: !title.trim() ? "#ccc" : pressed ? "#020617" : "#0f172a",
          borderRadius: 12,
          borderCurve: "continuous",
          padding: 16,
          alignItems: "center",
          marginTop: 8,
        })}
      >
        {mutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 16 }}>
            Create Event
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
