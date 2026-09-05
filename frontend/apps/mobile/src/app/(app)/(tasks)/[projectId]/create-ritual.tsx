/**
 * Define a recurring checklist from the phone.
 *
 * The subset collected here is deliberately narrower than the web editor's: no department
 * pools, no procedure document, no auto-approval, no completion or generation window, no
 * custom interval and no nth-weekday recurrence. Those stay on the web (FR-012), and because
 * mobile never issues an *update* for a definition, a web-configured ritual keeps all of them
 * when it is later viewed here.
 *
 * The requirements are sent inline on the create request rather than created in a loop
 * afterwards, so the definition and everything it has to prove commit in one transaction
 * (FR-013).
 */

import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRitualDefinition } from "apis";

import {
  EvidenceRequirementEditor,
  newRequirementDraft,
  type EvidenceRequirementDraft,
} from "@/components/rituals/evidence-requirement-editor";
import {
  RecurrencePicker,
  type RecurrenceDraft,
} from "@/components/rituals/recurrence-picker";
import { AssigneePicker } from "@/components/rituals/assignee-picker";
import { getDeviceTimezone } from "@/lib/device-timezone";
import {
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
  statusColors,
  touch,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

/** The product default, and the web editor's own initial state. Not collected on mobile. */
const COMPLETION_WINDOW_HOURS = 24;

export default function CreateRitualScreen() {
  const { palette } = useTheme();
  const styles = useStyles();

  const { projectId: rawProjectId } = useLocalSearchParams<{ projectId?: string | string[] }>();
  const projectId = Array.isArray(rawProjectId) ? rawProjectId[0] : rawProjectId;
  const router = useRouter();
  const queryClient = useQueryClient();

  const timezone = useMemo(() => getDeviceTimezone(), []);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>({
    type: "daily",
    daysOfWeek: [],
    dayOfMonth: 0,
  });
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<EvidenceRequirementDraft[]>([
    newRequirementDraft(),
  ]);

  const [nameError, setNameError] = useState<string>();
  const [recurrenceError, setRecurrenceError] = useState<string>();
  const [requirementErrors, setRequirementErrors] = useState<Record<string, string>>({});
  const [requirementsError, setRequirementsError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();

  const mutation = useMutation({
    mutationFn: () =>
      createRitualDefinition({
        projectId: projectId!,
        name: name.trim(),
        description: description.trim(),
        recurrenceRule: {
          type: recurrence.type,
          // Always 1 from mobile: custom intervals are a web control (FR-012), so the form
          // never has a second numeric field to get wrong.
          interval: 1,
          daysOfWeek: recurrence.type === "weekly" ? recurrence.daysOfWeek : [],
          dayOfMonth: recurrence.type === "monthly" ? recurrence.dayOfMonth : 0,
        },
        completionWindowHours: COMPLETION_WINDOW_HOURS,
        timezone,
        defaultAssigneeIds: assigneeIds,
        evidenceRequirements: requirements.map((requirement) => ({
          name: requirement.name.trim(),
          evidenceTypes: requirement.evidenceTypes,
          isRequired: requirement.isRequired,
        })),
        defaultDepartmentPools: [],
      }),
    onSuccess: async (definition) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ritualDefinitions", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
      ]);
      // Replace, not push: the back gesture from the new ritual should not return to a form
      // that has already been submitted.
      router.replace(`/(app)/(tasks)/rituals/${definition.id}`);
    },
    onError: (error: Error) => {
      // Everything typed stays on screen. There is no optimistic write and no local draft,
      // so retrying the same button after an ambiguous failure cannot produce two rituals.
      setSubmitError(error.message);
    },
  });

  const validate = (): boolean => {
    let ok = true;

    setNameError(undefined);
    setRecurrenceError(undefined);
    setRequirementsError(undefined);
    setSubmitError(undefined);
    const rowErrors: Record<string, string> = {};

    if (!name.trim()) {
      setNameError("Give this ritual a name.");
      ok = false;
    }

    if (recurrence.type === "weekly" && recurrence.daysOfWeek.length === 0) {
      setRecurrenceError("Pick at least one day of the week.");
      ok = false;
    }

    if (recurrence.type === "monthly" && !recurrence.dayOfMonth) {
      setRecurrenceError("Pick a day of the month.");
      ok = false;
    }

    if (requirements.length === 0) {
      setRequirementsError("Add at least one thing this ritual has to prove.");
      ok = false;
    }

    for (const requirement of requirements) {
      if (!requirement.name.trim()) {
        rowErrors[requirement.localId] = "Name this proof step.";
        ok = false;
      } else if (requirement.evidenceTypes.length === 0) {
        rowErrors[requirement.localId] = "Pick at least one kind of proof.";
        ok = false;
      }
    }

    setRequirementErrors(rowErrors);
    return ok;
  };

  const onSubmit = () => {
    if (!projectId || mutation.isPending) {
      return;
    }
    if (validate()) {
      mutation.mutate();
    }
  };

  return (
    <ScrollView
      testID="create-ritual-screen"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: "New Ritual",
          headerLeft: () => (
            <Pressable
              testID="create-ritual-cancel-button"
              accessibilityRole="button"
              accessibilityLabel="Cancel new ritual"
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
          testID="ritual-name-input"
          style={styles.input}
          autoFocus
          placeholder="Opening checklist"
          placeholderTextColor={palette.text.disabled}
          value={name}
          onChangeText={setName}
        />
        {nameError ? <Text style={styles.error}>{nameError}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          testID="ritual-description-input"
          style={[styles.input, styles.multiline]}
          placeholder="What this run is for"
          placeholderTextColor={palette.text.disabled}
          multiline
          numberOfLines={3}
          value={description}
          onChangeText={setDescription}
        />
      </View>

      <RecurrencePicker value={recurrence} onChange={setRecurrence} error={recurrenceError} />

      {/* Read-only, so a wrong zone is visible before saving rather than after the first run
          fires at the wrong hour (FR-010). Changing it is a web control. */}
      <Text testID="ritual-timezone-line" style={styles.timezone}>
        Runs on {timezone} time
      </Text>

      <EvidenceRequirementEditor
        requirements={requirements}
        onChange={setRequirements}
        errors={requirementErrors}
        sectionError={requirementsError}
      />

      {projectId ? (
        <AssigneePicker
          projectId={projectId}
          selectedIds={assigneeIds}
          onChange={setAssigneeIds}
        />
      ) : null}

      {submitError ? (
        <View testID="create-ritual-error" style={styles.banner}>
          <Text style={styles.bannerText}>{submitError}</Text>
        </View>
      ) : null}

      <Pressable
        testID="create-ritual-submit"
        accessibilityRole="button"
        onPress={onSubmit}
        disabled={!name.trim() || mutation.isPending}
        style={[styles.submit, (!name.trim() || mutation.isPending) && styles.submitDisabled]}
      >
        {mutation.isPending ? (
          <ActivityIndicator color={palette.primary.contrastText} />
        ) : (
          <Text style={styles.submitLabel}>Create ritual</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    padding: mobileLayout.screenPadding,
    gap: spacing[2.5],
    // Clears the tab bar, which draws over this screen on Android: at spacing[6] the submit
    // button sat half under it on a 360dp device.
    paddingBottom: spacing[12],
  },
  cancel: {
    ...mobileTypography.button,
    color: t.primary.main,
    // Android's native header packs headerLeft flush against the title; without this the
    // two run together as "CancelNew Project" at 360dp.
    paddingRight: spacing[1.5],
  },
  field: {
    gap: spacing[0.5],
  },
  label: {
    ...mobileTypography.sectionHeader,
    color: t.text.primary,
  },
  input: {
    minHeight: touch.comfortable,
    paddingHorizontal: spacing[1.5],
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: t.divider,
    color: t.text.primary,
    fontSize: 16,
  },
  multiline: {
    minHeight: 88,
    paddingTop: spacing[1],
    textAlignVertical: "top",
  },
  timezone: {
    ...mobileTypography.listSecondary,
    color: t.text.secondary,
  },
  banner: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.error.light,
    backgroundColor: statusColors.error[t.mode].bg,
  },
  bannerText: {
    ...mobileTypography.listSecondary,
    color: t.error.dark,
  },
  error: {
    ...mobileTypography.listSecondary,
    color: t.error.main,
  },
  submit: {
    minHeight: touch.large,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: t.primary.main,
  },
  submitDisabled: {
    backgroundColor: t.text.disabled,
  },
  submitLabel: {
    ...mobileTypography.button,
    color: t.primary.contrastText,
  },
}));
