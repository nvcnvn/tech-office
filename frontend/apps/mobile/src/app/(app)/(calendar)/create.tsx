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
import { makeStyles, useTheme } from "@/lib/theme";

export default function CreateEventScreen() {
  const styles = useStyles();
  const { palette } = useTheme();
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
        <Text style={{ fontSize: 13, fontWeight: "600", color: palette.text.primary }}>Title</Text>
        <TextInput
          style={styles.input}
          placeholder="Event title"
          placeholderTextColor={palette.text.disabled}
          value={title}
          onChangeText={setTitle}
        />
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: palette.text.primary }}>Location</Text>
        <TextInput
          style={styles.input}
          placeholder="Conference room, Zoom link, etc."
          placeholderTextColor={palette.text.disabled}
          value={location}
          onChangeText={setLocation}
        />
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: palette.text.primary }}>Description</Text>
        <TextInput
          style={[styles.input, { height: 100, textAlignVertical: "top" }]}
          placeholder="Details about this event"
          placeholderTextColor={palette.text.disabled}
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
          backgroundColor: !title.trim()
            ? palette.divider
            : pressed
              ? palette.primary.dark
              : palette.primary.main,
          borderRadius: 12,
          borderCurve: "continuous",
          padding: 16,
          alignItems: "center",
          marginTop: 8,
        })}
      >
        {mutation.isPending ? (
          <ActivityIndicator color={palette.primary.contrastText} />
        ) : (
          <Text
            style={{ color: palette.primary.contrastText, fontWeight: "600", fontSize: 16 }}
          >
            Create Event
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  input: {
    borderWidth: 1,
    borderColor: t.divider,
    borderRadius: 10,
    borderCurve: "continuous" as const,
    padding: 14,
    fontSize: 16,
    backgroundColor: t.background.default,
    // React Native's default text colour is black, so an input without this one
    // takes typed text to black on a dark field.
    color: t.text.primary,
  },
}));
