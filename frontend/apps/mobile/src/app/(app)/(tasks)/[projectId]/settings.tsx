/**
 * Project settings screen
 */

import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getProject, updateProject, archiveProject, type UpdateProjectParams } from "apis";
import { useResolvedProjectId } from "@/hooks/use-resolved-project-id";

const inputStyle = {
  borderWidth: 1,
  borderColor: "#ddd",
  borderRadius: 10,
  padding: 14,
  fontSize: 16,
  backgroundColor: "#fafafa",
} as const;

export default function ProjectSettingsScreen() {
  const { projectId: rawProjectId } = useLocalSearchParams<{ projectId?: string | string[] }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { resolvedProjectId, isResolvingProjectId } = useResolvedProjectId(rawProjectId);

  const { data, isLoading } = useQuery({
    queryKey: ["project", resolvedProjectId],
    queryFn: async () => {
      const result = await getProject(resolvedProjectId!);
      return result.project;
    },
    enabled: !!resolvedProjectId,
  });

  const [name, setName] = useState(data?.name ?? "");
  const [description, setDescription] = useState(data?.description ?? "");

  React.useEffect(() => {
    if (data) {
      setName(data.name ?? "");
      setDescription(data.description ?? "");
    }
  }, [data]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      await updateProject({
        projectId: resolvedProjectId!,
        name: name.trim(),
        description: description.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", resolvedProjectId] });
      Alert.alert("Saved", "Project settings updated.");
    },
    onError: (err) => {
      Alert.alert("Error", err.message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      await archiveProject(resolvedProjectId!, true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.replace("/(app)/(tasks)");
    },
    onError: (err) => {
      Alert.alert("Error", err.message);
    },
  });

  const handleArchive = () => {
    Alert.alert(
      "Archive Project",
      "This project will be hidden from the active list. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () => archiveMutation.mutate(),
        },
      ]
    );
  };

  if (isLoading || isResolvingProjectId) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20 }}
    >
      <Stack.Screen options={{ title: "Project Settings" }} />

      {/* General */}
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: "#666" }}>
          GENERAL
        </Text>
        <View
          style={{
            backgroundColor: "#f8f9fa",
            borderRadius: 12,
            borderCurve: "continuous",
            padding: 16,
            gap: 12,
          }}
        >
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
              Name
            </Text>
            <TextInput
              style={inputStyle}
              value={name}
              onChangeText={setName}
              placeholder="Project name"
            />
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: "#333" }}>
              Description
            </Text>
            <TextInput
              style={[inputStyle, { height: 80, textAlignVertical: "top" }]}
              value={description}
              onChangeText={setDescription}
              placeholder="What is this project about?"
              multiline
            />
          </View>
          <Pressable
            onPress={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !name.trim()}
            style={({ pressed }) => ({
              backgroundColor:
                !name.trim() ? "#ccc" : pressed ? "#020617" : "#0f172a",
              paddingVertical: 14,
              borderRadius: 10,
              alignItems: "center",
            })}
          >
            {updateMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>
                Save Changes
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Danger zone */}
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: "#dc2626" }}>
          DANGER ZONE
        </Text>
        <Pressable
          onPress={handleArchive}
          disabled={archiveMutation.isPending}
          style={({ pressed }) => ({
            backgroundColor: pressed ? "#ffebee" : "#fff",
            borderRadius: 12,
            borderCurve: "continuous",
            padding: 16,
            borderWidth: 1,
            borderColor: "#ef9a9a",
            alignItems: "center",
          })}
        >
          <Text style={{ color: "#dc2626", fontSize: 15, fontWeight: "600" }}>
            Archive Project
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
