/**
 * What a ritual run has to prove.
 *
 * A ritual with no evidence requirement is a task with a schedule, so the list never drops
 * below one row and the remove action on the last row is disabled rather than hidden — a
 * control that vanishes reads as a bug, one that greys out reads as a rule.
 *
 * Rows are keyed by a client-only `localId` because a draft requirement has no server
 * identity until the definition is created. It is dropped at the request boundary.
 */

import React from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { EvidenceType } from "apis";
import {
  mobileTypography,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

export type EvidenceRequirementDraft = {
  /** Client-only, for list keys. Never sent. */
  localId: string;
  name: string;
  evidenceTypes: EvidenceType[];
  isRequired: boolean;
};

/** The full set the product supports (FR-008), in the order they are offered. */
const EVIDENCE_TYPES: Array<{ value: EvidenceType; label: string }> = [
  { value: "photo", label: "Photo" },
  { value: "voice_memo", label: "Voice note" },
  { value: "pdf", label: "PDF" },
  { value: "file", label: "File" },
  { value: "link", label: "Link" },
  { value: "text_note", label: "Written note" },
  { value: "gps_checkin", label: "Location" },
];

export function newRequirementDraft(): EvidenceRequirementDraft {
  return {
    localId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    evidenceTypes: [],
    isRequired: true,
  };
}

export function EvidenceRequirementEditor({
  requirements,
  onChange,
  errors,
  sectionError,
}: {
  requirements: EvidenceRequirementDraft[];
  onChange: (next: EvidenceRequirementDraft[]) => void;
  /** Per-row message, keyed by localId, anchored to the row that is wrong. */
  errors?: Record<string, string>;
  sectionError?: string;
}) {
  const { palette } = useTheme();
  const styles = useStyles();

  const update = (index: number, patch: Partial<EvidenceRequirementDraft>) => {
    onChange(requirements.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const toggleType = (index: number, type: EvidenceType) => {
    const row = requirements[index];
    const next = row.evidenceTypes.includes(type)
      ? row.evidenceTypes.filter((existing) => existing !== type)
      : [...row.evidenceTypes, type];
    update(index, { evidenceTypes: next });
  };

  return (
    <View style={styles.block}>
      <Text style={styles.label}>What it has to prove</Text>

      {requirements.map((row, index) => {
        const rowError = errors?.[row.localId];
        return (
          <View key={row.localId} testID={`ritual-requirement-${index}`} style={styles.row}>
            <TextInput
              testID={`ritual-requirement-name-${index}`}
              style={styles.input}
              placeholder="Shutters up"
              placeholderTextColor={palette.text.disabled}
              value={row.name}
              onChangeText={(text) => update(index, { name: text })}
            />

            <View style={styles.chipRow}>
              {EVIDENCE_TYPES.map((type) => {
                const selected = row.evidenceTypes.includes(type.value);
                return (
                  <Pressable
                    key={type.value}
                    testID={`ritual-requirement-type-${index}-${type.value}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => toggleType(index, type.value)}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                      {type.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.rowActions}>
              <Pressable
                testID={`ritual-requirement-required-${index}`}
                accessibilityRole="button"
                accessibilityState={{ selected: row.isRequired }}
                onPress={() => update(index, { isRequired: !row.isRequired })}
                style={[styles.toggle, row.isRequired && styles.chipSelected]}
              >
                <Text style={[styles.chipLabel, row.isRequired && styles.chipLabelSelected]}>
                  {row.isRequired ? "Required" : "Optional"}
                </Text>
              </Pressable>

              <Pressable
                testID={`ritual-requirement-remove-${index}`}
                accessibilityRole="button"
                accessibilityLabel="Remove this proof step"
                disabled={requirements.length <= 1}
                onPress={() => onChange(requirements.filter((_, i) => i !== index))}
                style={styles.remove}
              >
                <Text
                  style={[
                    styles.removeLabel,
                    requirements.length <= 1 && styles.removeLabelDisabled,
                  ]}
                >
                  Remove
                </Text>
              </Pressable>
            </View>

            {rowError ? <Text style={styles.error}>{rowError}</Text> : null}
          </View>
        );
      })}

      <Pressable
        testID="ritual-add-requirement"
        accessibilityRole="button"
        onPress={() => onChange([...requirements, newRequirementDraft()])}
        style={styles.addButton}
      >
        <Text style={styles.addLabel}>Add another</Text>
      </Pressable>

      {sectionError ? <Text style={styles.error}>{sectionError}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  block: {
    gap: spacing[1.5],
  },
  label: {
    ...mobileTypography.sectionHeader,
    color: t.text.primary,
  },
  row: {
    gap: spacing[1],
    padding: spacing[1.5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: t.divider,
    backgroundColor: t.background.paper,
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
  chipRow: {
    flexDirection: "row",
    // Seven labels of varying length; wrapping is what keeps them on a 360dp screen.
    flexWrap: "wrap",
    gap: spacing[0.5],
  },
  chip: {
    minHeight: touch.minTarget,
    justifyContent: "center",
    paddingHorizontal: spacing[1.5],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: t.divider,
  },
  chipSelected: {
    backgroundColor: t.primary.main,
    borderColor: t.primary.main,
  },
  chipLabel: {
    ...mobileTypography.buttonSm,
    color: t.text.primary,
  },
  chipLabelSelected: {
    color: t.primary.contrastText,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  toggle: {
    minHeight: touch.minTarget,
    justifyContent: "center",
    paddingHorizontal: spacing[2],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: t.divider,
  },
  remove: {
    minHeight: touch.minTarget,
    justifyContent: "center",
    paddingHorizontal: spacing[1],
  },
  removeLabel: {
    ...mobileTypography.buttonSm,
    color: t.error.main,
  },
  removeLabelDisabled: {
    color: t.text.disabled,
  },
  addButton: {
    minHeight: touch.comfortable,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: t.divider,
  },
  addLabel: {
    ...mobileTypography.button,
    color: t.primary.main,
  },
  error: {
    ...mobileTypography.listSecondary,
    color: t.error.main,
  },
}));
