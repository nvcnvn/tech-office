/**
 * Who a ritual's runs start assigned to. Optional — empty means each run starts unassigned,
 * which is the existing behaviour and is stated on screen rather than left to be discovered.
 *
 * The candidates are the project's own members, resolved to names with `getEmployeeCards`
 * rather than `autocompleteEmployees`: the autocomplete searches the whole organization, and
 * offering someone who is not in the project produces an assignment the server refuses.
 */

import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getEmployeeCards, listProjectMembers } from "apis";
import {
  lightPalette,
  mobileTypography,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";

export function AssigneePicker({
  projectId,
  selectedIds,
  onChange,
}: {
  projectId: string;
  selectedIds: string[];
  onChange: (next: string[]) => void;
}) {
  const [search, setSearch] = useState("");

  const membersQuery = useQuery({
    queryKey: ["projectMembers", projectId],
    queryFn: () => listProjectMembers(projectId),
    enabled: !!projectId,
  });

  const memberIds = useMemo(
    () => (membersQuery.data?.members ?? []).map((member) => member.employeeId),
    [membersQuery.data],
  );

  const cardsQuery = useQuery({
    queryKey: ["employeeCards", memberIds.join(",")],
    queryFn: () => getEmployeeCards(memberIds),
    enabled: memberIds.length > 0,
  });

  const people = useMemo(
    () =>
      (cardsQuery.data ?? []).map((card) => ({
        id: card.id,
        name: [card.givenName, card.familyName].filter(Boolean).join(" ") || card.email,
      })),
    [cardsQuery.data],
  );

  const nameById = useMemo(
    () => new Map(people.map((person) => [person.id, person.name])),
    [people],
  );

  const term = search.trim().toLowerCase();
  const results = people.filter(
    (person) =>
      !selectedIds.includes(person.id) &&
      (term === "" || person.name.toLowerCase().includes(term)),
  );

  return (
    <View style={styles.block}>
      <Text style={styles.label}>Who it is for</Text>
      <Text style={styles.helper}>Leave empty and each run starts unassigned.</Text>

      {selectedIds.length > 0 ? (
        <View style={styles.chipRow}>
          {selectedIds.map((employeeId) => (
            <Pressable
              key={employeeId}
              testID={`ritual-assignee-chip-${employeeId}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${nameById.get(employeeId) ?? "person"}`}
              onPress={() => onChange(selectedIds.filter((id) => id !== employeeId))}
              style={styles.chip}
            >
              <Text style={styles.chipLabel}>{nameById.get(employeeId) ?? employeeId} ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextInput
        testID="ritual-assignee-search"
        style={styles.input}
        placeholder="Search people in this project"
        placeholderTextColor={lightPalette.text.disabled}
        autoCapitalize="none"
        autoCorrect={false}
        value={search}
        onChangeText={setSearch}
      />

      {membersQuery.isLoading || cardsQuery.isLoading ? (
        <ActivityIndicator />
      ) : (
        results.map((person) => (
          <Pressable
            key={person.id}
            testID={`ritual-assignee-option-${person.id}`}
            accessibilityRole="button"
            onPress={() => onChange([...selectedIds, person.id])}
            style={styles.option}
          >
            <Text style={styles.optionLabel}>{person.name}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing[1],
  },
  label: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  helper: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
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
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[0.5],
  },
  chip: {
    minHeight: touch.minTarget,
    justifyContent: "center",
    paddingHorizontal: spacing[1.5],
    borderRadius: radius.xl,
    backgroundColor: lightPalette.primary.main,
  },
  chipLabel: {
    ...mobileTypography.buttonSm,
    color: lightPalette.primary.contrastText,
  },
  option: {
    minHeight: touch.comfortable,
    justifyContent: "center",
    paddingHorizontal: spacing[1.5],
    borderRadius: radius.base,
    borderWidth: 1,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
  },
  optionLabel: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
  },
});
