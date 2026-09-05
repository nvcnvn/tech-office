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
import { makeStyles, useTheme } from "@/lib/theme";

export default function NewChannelScreen() {
  const { palette } = useTheme();
  const styles = useStyles();
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
              <Text style={{ color: palette.info.main, fontSize: 17, fontWeight: "500" }}>Cancel</Text>
            </Pressable>
          ),
        }}
      />

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: palette.text.primary }}>
          Channel Name
        </Text>
        <TextInput
          style={styles.input}
          placeholder="general"
          placeholderTextColor={palette.text.disabled}
          autoCapitalize="none"
          autoCorrect={false}
          value={name}
          onChangeText={setName}
        />
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: palette.text.primary }}>
          Description (optional)
        </Text>
        <TextInput
          style={[styles.input, { height: 80, textAlignVertical: "top" }]}
          placeholder="What's this channel about?"
          placeholderTextColor={palette.text.disabled}
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
          <Text style={{ fontSize: 15, fontWeight: "500", color: palette.text.primary }}>
            Private Channel
          </Text>
          <Text style={{ fontSize: 13, color: palette.text.secondary, marginTop: 2 }}>
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
            !name.trim()
              ? palette.divider
              : pressed
              ? palette.primary.dark
              : palette.primary.main,
          borderRadius: 12,
          borderCurve: "continuous",
          padding: 16,
          alignItems: "center",
        })}
      >
        {mutation.isPending ? (
          <ActivityIndicator color={palette.primary.contrastText} />
        ) : (
          <Text style={{ color: palette.primary.contrastText, fontWeight: "600", fontSize: 16 }}>
            Create Channel
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
