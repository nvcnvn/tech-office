/**
 * Start a project from the phone.
 *
 * The key is permanent — there is no update path for it — which is why the rule is checked
 * here before anything is sent, and why a key already taken is rendered as a refusal on the
 * key input rather than auto-corrected on the person's behalf.
 *
 * The rule and the derivation both come from `@tech-office/validations`, the same module the
 * web dialog uses, so the two clients cannot disagree about what they will submit
 * (Constitution VIII). The `valid_project_key` CHECK constraint remains the authority.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createProject, fieldViolation } from "apis";
import type { CollaborationMode, ProjectVisibility } from "apis";
import {
  deriveProjectKey,
  projectKeySchema,
  PROJECT_KEY_RULE_TEXT,
} from "@tech-office/validations";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";

const VISIBILITIES: Array<{ value: ProjectVisibility; label: string; explanation: string }> = [
  { value: "private", label: "Private", explanation: "Only people you add can see it." },
  { value: "public", label: "Public", explanation: "Everyone in the workspace can see it." },
];

const MODES: Array<{ value: CollaborationMode; label: string; explanation: string }> = [
  { value: "standard", label: "Tasks", explanation: "One-off work you track to done." },
  { value: "ritual", label: "Rituals", explanation: "Checklists that repeat on a schedule." },
  { value: "mixed", label: "Both", explanation: "One-off work and repeating checklists." },
];

export default function CreateProjectScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  // Explicit rather than testing the field for emptiness: clearing the key to retype it
  // should not restart the suggestion, which reads as the form fighting you.
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ProjectVisibility>("private");
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>("standard");

  const [keyError, setKeyError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();

  useEffect(() => {
    if (!keyTouched) {
      setKey(deriveProjectKey(name));
    }
  }, [name, keyTouched]);

  const mutation = useMutation({
    mutationFn: () =>
      createProject({
        name: name.trim(),
        key: key.trim(),
        description: description.trim() || undefined,
        visibility,
        collaborationMode,
      }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.replace(`/(app)/(tasks)/${response.project.id}`);
    },
    onError: (error: Error) => {
      // A named field marks the input it belongs to; anything else is a banner. Either way
      // every field keeps its value — the form is never reset on failure.
      const onKey = fieldViolation(error, "key");
      if (onKey) {
        setKeyError(onKey);
      } else {
        setSubmitError(error.message);
      }
    },
  });

  const onSubmit = () => {
    if (mutation.isPending) {
      return;
    }
    setKeyError(undefined);
    setSubmitError(undefined);

    if (!projectKeySchema.safeParse(key.trim()).success) {
      setKeyError(PROJECT_KEY_RULE_TEXT);
      return;
    }

    mutation.mutate();
  };

  const canSubmit = !!name.trim() && !!key.trim() && !mutation.isPending;

  return (
    <ScrollView
      testID="create-project-screen"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: "New Project",
          headerLeft: () => (
            <Pressable
              testID="create-project-cancel-button"
              accessibilityRole="button"
              accessibilityLabel="Cancel new project"
              hitSlop={12}
              onPress={() => router.back()}
            >
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.field}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          testID="project-name-input"
          style={styles.input}
          autoFocus
          placeholder="Store operations"
          placeholderTextColor={lightPalette.text.disabled}
          value={name}
          onChangeText={setName}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Short code</Text>
        <TextInput
          testID="project-key-input"
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="STORE"
          placeholderTextColor={lightPalette.text.disabled}
          value={key}
          onChangeText={(text) => {
            setKeyTouched(true);
            setKey(text.toUpperCase());
          }}
        />
        {keyError ? (
          <Text testID="project-key-error" style={styles.error}>
            {keyError}
          </Text>
        ) : (
          <Text style={styles.helper}>{PROJECT_KEY_RULE_TEXT}</Text>
        )}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          testID="project-description-input"
          style={[styles.input, styles.multiline]}
          placeholder="What this project is for"
          placeholderTextColor={lightPalette.text.disabled}
          multiline
          numberOfLines={3}
          value={description}
          onChangeText={setDescription}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Who can see it</Text>
        <View style={styles.segmentRow}>
          {VISIBILITIES.map((option) => {
            const selected = visibility === option.value;
            return (
              <Pressable
                key={option.value}
                testID={`project-visibility-${option.value}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setVisibility(option.value)}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.helper}>
          {VISIBILITIES.find((option) => option.value === visibility)?.explanation}
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>What this project is for</Text>
        <View style={styles.segmentRow}>
          {MODES.map((option) => {
            const selected = collaborationMode === option.value;
            return (
              <Pressable
                key={option.value}
                testID={`project-mode-${option.value}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setCollaborationMode(option.value)}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.helper}>
          {MODES.find((option) => option.value === collaborationMode)?.explanation}
        </Text>
      </View>

      {submitError ? (
        <View testID="create-project-error" style={styles.banner}>
          <Text style={styles.bannerText}>{submitError}</Text>
        </View>
      ) : null}

      <Pressable
        testID="create-project-submit"
        accessibilityRole="button"
        onPress={onSubmit}
        disabled={!canSubmit}
        style={[styles.submit, !canSubmit && styles.submitDisabled]}
      >
        {mutation.isPending ? (
          <ActivityIndicator color={lightPalette.primary.contrastText} />
        ) : (
          <Text style={styles.submitLabel}>Create project</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: mobileLayout.screenPadding,
    gap: spacing[2.5],
    // Clears the tab bar, which draws over this screen on Android: at spacing[6] the submit
    // button sat half under it on a 360dp device.
    paddingBottom: spacing[12],
  },
  cancel: {
    ...mobileTypography.button,
    color: lightPalette.primary.main,
    // Android's native header packs headerLeft flush against the title; without this the
    // two run together as "CancelNew Project" at 360dp.
    paddingRight: spacing[1.5],
  },
  field: {
    gap: spacing[0.5],
  },
  label: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  input: {
    minHeight: touch.comfortable,
    paddingHorizontal: spacing[1.5],
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: lightPalette.divider,
    color: lightPalette.text.primary,
    fontSize: 16,
  },
  multiline: {
    minHeight: 88,
    paddingTop: spacing[1],
    textAlignVertical: "top",
  },
  segmentRow: {
    flexDirection: "row",
    gap: spacing[1],
  },
  segment: {
    flex: 1,
    flexShrink: 1,
    minHeight: touch.comfortable,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[0.5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
  },
  segmentSelected: {
    backgroundColor: lightPalette.primary.main,
    borderColor: lightPalette.primary.main,
  },
  segmentLabel: {
    ...mobileTypography.buttonSm,
    color: lightPalette.text.primary,
    textAlign: "center",
  },
  segmentLabelSelected: {
    color: lightPalette.primary.contrastText,
  },
  helper: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  error: {
    ...mobileTypography.listSecondary,
    color: lightPalette.error.main,
  },
  banner: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: lightPalette.error.light,
    backgroundColor: "#fef2f2",
  },
  bannerText: {
    ...mobileTypography.listSecondary,
    color: lightPalette.error.dark,
  },
  submit: {
    minHeight: touch.large,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: lightPalette.primary.main,
  },
  submitDisabled: {
    backgroundColor: lightPalette.text.disabled,
  },
  submitLabel: {
    ...mobileTypography.button,
    color: lightPalette.primary.contrastText,
  },
});
