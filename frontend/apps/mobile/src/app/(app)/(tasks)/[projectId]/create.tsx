/**
 * Task creation screen — T6.7
 *
 * Fetches task levels (required) and project states (optional picker),
 * presents a minimal form, then calls createTask on submit.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createTask,
  listTaskLevels,
  listProjectStates,
} from "apis";
import * as Haptics from "expo-haptics";
import { useResolvedProjectId } from "@/hooks/use-resolved-project-id";
import { invalidateTaskQueries } from "@/lib/task-query-invalidation";

export default function CreateTaskScreen() {
  const { projectId: rawProjectId } = useLocalSearchParams<{ projectId?: string | string[] }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { resolvedProjectId, isResolvingProjectId } = useResolvedProjectId(rawProjectId);

  const [title, setTitle] = useState("");
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);

  const { data: levelsData, isLoading: levelsLoading } = useQuery({
    queryKey: ["task-levels", resolvedProjectId],
    queryFn: () => listTaskLevels(resolvedProjectId!),
    enabled: !!resolvedProjectId,
  });

  const { data: statesData } = useQuery({
    queryKey: ["project-states", resolvedProjectId],
    queryFn: () => listProjectStates(resolvedProjectId!),
    enabled: !!resolvedProjectId,
  });

  const levels = levelsData?.levels ?? [];
  const states = statesData?.states ?? [];

  // Auto-select first level once loaded
  React.useEffect(() => {
    if (levels.length > 0 && !selectedLevelId) {
      setSelectedLevelId(levels[0].id);
    }
  }, [levels]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedProjectId || !selectedLevelId) throw new Error("Missing required fields");
      return createTask({
        projectId: resolvedProjectId,
        title: title.trim(),
        levelId: selectedLevelId,
        stateId: selectedStateId ?? undefined,
        dueDate: dueDate.trim() || undefined,
      });
    },
    onSuccess: async () => {
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await invalidateTaskQueries(queryClient, { projectId: resolvedProjectId });
      router.back();
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      setTitleError("Title is required");
      return;
    }
    setTitleError(null);
    createMutation.mutate();
  };

  if (levelsLoading || isResolvingProjectId) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: "New Task" }} />

      {/* Title */}
      <View style={styles.field}>
        <Text style={styles.label}>Title *</Text>
        <TextInput
          style={[styles.input, titleError && styles.inputError]}
          placeholder="Task title"
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            if (t.trim()) setTitleError(null);
          }}
          autoFocus
          returnKeyType="done"
        />
        {titleError && <Text style={styles.errorText}>{titleError}</Text>}
      </View>

      {/* Level picker */}
      {levels.length > 0 && (
        <View style={styles.field}>
          <Text style={styles.label}>Level</Text>
          <View style={styles.chipRow}>
            {levels.map((level) => (
              <Pressable
                key={level.id}
                onPress={() => setSelectedLevelId(level.id)}
                style={[
                  styles.chip,
                  selectedLevelId === level.id && styles.chipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selectedLevelId === level.id && styles.chipTextSelected,
                  ]}
                >
                  {level.icon ? `${level.icon} ` : ""}{level.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* State picker (optional) */}
      {states.length > 0 && (
        <View style={styles.field}>
          <Text style={styles.label}>Initial State (optional)</Text>
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setSelectedStateId(null)}
              style={[styles.chip, selectedStateId === null && styles.chipSelected]}
            >
              <Text
                style={[
                  styles.chipText,
                  selectedStateId === null && styles.chipTextSelected,
                ]}
              >
                Default
              </Text>
            </Pressable>
            {states.map((state) => (
              <Pressable
                key={state.id}
                onPress={() => setSelectedStateId(state.id)}
                style={[
                  styles.chip,
                  selectedStateId === state.id && styles.chipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selectedStateId === state.id && styles.chipTextSelected,
                  ]}
                >
                  {state.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Due Date */}
      <View style={styles.field}>
        <Text style={styles.label}>Due Date (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          value={dueDate}
          onChangeText={setDueDate}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
        />
      </View>

      {/* Error from mutation */}
      {createMutation.isError && (
        <Text style={styles.errorText}>
          {(createMutation.error as Error)?.message ?? "Failed to create task"}
        </Text>
      )}

      {/* Submit */}
      <Pressable
        onPress={handleSubmit}
        disabled={createMutation.isPending || !title.trim()}
        style={({ pressed }) => [
          styles.submitBtn,
          (createMutation.isPending || !title.trim()) && styles.submitBtnDisabled,
          pressed && !createMutation.isPending && styles.submitBtnPressed,
        ]}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>Create Task</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { padding: 16, gap: 20 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: "#555" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    borderCurve: "continuous",
    padding: 14,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  inputError: { borderColor: "#dc2626" },
  errorText: { fontSize: 13, color: "#dc2626" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#f0f0f0",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  chipSelected: {
    backgroundColor: "#0f172a",
    borderColor: "#0f172a",
  },
  chipText: { fontSize: 14, color: "#333" },
  chipTextSelected: { color: "#fff", fontWeight: "600" },
  submitBtn: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { backgroundColor: "#94a3b8" },
  submitBtnPressed: { backgroundColor: "#020617" },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
