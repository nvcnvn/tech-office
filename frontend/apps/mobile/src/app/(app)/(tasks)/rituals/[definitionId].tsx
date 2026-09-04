import React from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { archiveRitualDefinition, getProject, getRitualDefinition, type RitualDefinition } from "apis";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  shadows,
  spacing,
  touch,
} from "@tech-office/theme-tokens";

function getEvidenceTypeLabel(type: RitualDefinition["evidenceRequirements"][number]["evidenceTypes"][number]): string {
  switch (type) {
    case "photo":
      return "Photo";
    case "gps_checkin":
      return "GPS check-in";
    case "text_note":
      return "Text note";
    case "link":
      return "Link";
    default:
      return type;
  }
}

export default function RitualTemplateScreen() {
  const { definitionId, taskId } = useLocalSearchParams<{
    definitionId: string;
    taskId?: string;
  }>();

  const queryClient = useQueryClient();

  const definitionQuery = useQuery({
    queryKey: ["ritual-definition", definitionId],
    queryFn: () => getRitualDefinition(definitionId),
    enabled: !!definitionId,
  });

  const projectId = definitionQuery.data?.projectId;

  // The screen does not otherwise need the project, but archiving does: only an owner or
  // admin of it may stop a ritual, which is the same rule ritual_logic.go enforces.
  const { data: projectData } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  const archiveMutation = useMutation({
    mutationFn: (archive: boolean) => archiveRitualDefinition(definitionId, archive),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ritual-definition", definitionId] }),
        queryClient.invalidateQueries({ queryKey: ["ritualDefinitions", projectId] }),
      ]);
    },
    onError: (error: Error) => {
      Alert.alert("Could not change this ritual", error.message);
    },
  });

  const canArchive =
    projectData?.currentUserRole === "owner" || projectData?.currentUserRole === "admin";

  const confirmArchive = () => {
    Alert.alert(
      "Archive this ritual?",
      "No new runs will be created. Runs that already exist are left alone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          // "Archive it", not "Archive": the button behind this alert already says
          // "Archive", and two identically labelled controls on one screen are ambiguous
          // to a screen reader and to the blackbox suite alike.
          text: "Archive it",
          style: "destructive",
          onPress: () => archiveMutation.mutate(true),
        },
      ],
    );
  };

  if (definitionQuery.isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={lightPalette.primary.main} />
      </View>
    );
  }

  if (definitionQuery.isError || !definitionQuery.data) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: "Ritual Template" }} />
        <Text style={styles.errorTitle}>Unable to load ritual template</Text>
        <Text style={styles.errorText}>
          {definitionQuery.error instanceof Error ? definitionQuery.error.message : "Try again in a moment."}
        </Text>
      </View>
    );
  }

  const definition = definitionQuery.data as RitualDefinition;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.scrollContent}>
      <Stack.Screen options={{ title: definition.name || "Ritual Template" }} />

      <View style={styles.heroCard}>
        {definition.isArchived ? (
          <View style={[styles.templateBadge, styles.archivedBadge]} testID="ritual-archived-badge">
            <Text style={[styles.templateBadgeText, styles.archivedBadgeText]}>Archived</Text>
          </View>
        ) : (
          <View style={styles.templateBadge}>
            <Text style={styles.templateBadgeText}>Reference only</Text>
          </View>
        )}
        <Text style={styles.heroTitle}>{definition.name}</Text>
        <Text style={styles.heroText}>
          {definition.isArchived
            ? "This ritual is archived. No new runs are being created; runs that already exist are unchanged."
            : "This page shows the repeating setup. Use the live task when you need to do the work or send proof."}
        </Text>

        {/* Archive and restore, and nothing else: no rename, no schedule change, no
            requirement editing. Those stay on the web (FR-018). */}
        {canArchive ? (
          definition.isArchived ? (
            <Pressable
              testID="ritual-unarchive-button"
              accessibilityRole="button"
              disabled={archiveMutation.isPending}
              onPress={() => archiveMutation.mutate(false)}
              style={styles.archiveAction}
            >
              <Text style={styles.archiveActionLabel}>Restore</Text>
            </Pressable>
          ) : (
            <Pressable
              testID="ritual-archive-button"
              accessibilityRole="button"
              disabled={archiveMutation.isPending}
              onPress={confirmArchive}
              style={styles.archiveAction}
            >
              <Text style={[styles.archiveActionLabel, styles.archiveActionDestructive]}>
                Archive
              </Text>
            </Pressable>
          )
        ) : null}
      </View>

      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>Use the live task to act</Text>
        <Text style={styles.noticeText}>
          {taskId
            ? "Go back to the live task to send proof, fix proof, or confirm what is due for this run."
            : "Open a scheduled ritual task from the task list when you need to send proof for a specific run."}
        </Text>
      </View>

      {definition.description ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>What repeats</Text>
          <Text style={styles.bodyText}>{definition.description}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Task setup</Text>
        <Text style={styles.cardSubtitle}>These are the standing rules behind each live run.</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Time to finish</Text>
          <Text style={styles.infoValue}>{`${definition.completionWindowHours}h`}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Timezone</Text>
          <Text style={styles.infoValue}>{definition.timezone}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Required proof steps</Text>
          <Text style={styles.infoValue}>{definition.evidenceRequirements.filter((requirement) => requirement.isRequired).length}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Proof on each run</Text>
        <Text style={styles.cardSubtitle}>Read this as a checklist. The live task stays the source of truth for the current run.</Text>

        {definition.evidenceRequirements.length === 0 ? (
          <Text style={styles.bodyText}>No evidence requirements are configured for this ritual yet.</Text>
        ) : (
          definition.evidenceRequirements
            .slice()
            .sort((left, right) => left.position - right.position)
            .map((requirement) => (
              <View key={requirement.id} style={styles.requirementCard}>
                <View style={styles.requirementHeader}>
                  <View style={styles.requirementTitleWrap}>
                    <Text style={styles.requirementTitle}>{requirement.name}</Text>
                    <Text style={styles.requirementCaption}>{requirement.isRequired ? "Required proof" : "Optional proof"}</Text>
                  </View>
                  <View style={styles.requirementTypeRow}>
                    {requirement.evidenceTypes.map((type) => (
                      <View key={type} style={styles.typeChip}>
                        <Text style={styles.typeChipText}>{getEvidenceTypeLabel(type)}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {requirement.description ? <Text style={styles.bodyText}>{requirement.description}</Text> : null}

                {requirement.deadlineOffsetHours > 0 ? (
                  <Text style={styles.helperText}>{`Send within ${requirement.deadlineOffsetHours}h of the scheduled task time.`}</Text>
                ) : null}
              </View>
            ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: mobileLayout.screenPadding,
    backgroundColor: lightPalette.background.default,
    gap: spacing[1],
  },
  scrollContent: {
    paddingHorizontal: mobileLayout.screenPadding,
    paddingBottom: mobileLayout.cardPadding * 2,
    gap: spacing[2],
  },
  heroCard: {
    marginTop: spacing[1],
    padding: mobileLayout.cardPadding,
    borderRadius: radius.lg,
    backgroundColor: lightPalette.background.paper,
    gap: spacing[1],
    ...shadows.sm,
  },
  templateBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[0.5],
    borderRadius: 999,
    backgroundColor: "#eef6ff",
  },
  archivedBadge: {
    backgroundColor: "#f1f5f9",
  },
  archivedBadgeText: {
    color: lightPalette.text.secondary,
  },
  archiveAction: {
    alignSelf: "flex-start",
    minHeight: touch.minTarget,
    justifyContent: "center",
    paddingHorizontal: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: lightPalette.divider,
  },
  archiveActionLabel: {
    fontSize: mobileTypography.button.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.primary.main,
  },
  archiveActionDestructive: {
    color: lightPalette.error.main,
  },
  templateBadgeText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.info.main,
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  heroText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 22,
    color: lightPalette.text.secondary,
  },
  noticeCard: {
    padding: mobileLayout.cardPadding,
    borderRadius: radius.lg,
    backgroundColor: "#f8fafc",
    gap: spacing[1],
    ...shadows.sm,
  },
  noticeTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  noticeText: {
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: 18,
    color: lightPalette.text.secondary,
  },
  card: {
    padding: mobileLayout.cardPadding,
    borderRadius: radius.lg,
    backgroundColor: lightPalette.background.paper,
    gap: spacing[1.5],
    ...shadows.sm,
  },
  cardTitle: {
    fontSize: mobileTypography.sectionHeader.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  cardSubtitle: {
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: 18,
    color: lightPalette.text.secondary,
  },
  bodyText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 21,
    color: lightPalette.text.primary,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  infoLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  infoValue: {
    flexShrink: 1,
    textAlign: "right",
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.primary,
  },
  requirementCard: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: lightPalette.divider,
    gap: spacing[1],
  },
  requirementHeader: {
    gap: spacing[1],
  },
  requirementTitleWrap: {
    gap: 2,
  },
  requirementTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  requirementCaption: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  requirementTypeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1],
  },
  typeChip: {
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
    borderRadius: 999,
    backgroundColor: "#f4f6f8",
  },
  typeChipText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  helperText: {
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: 18,
    color: lightPalette.text.secondary,
  },
  errorTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  errorText: {
    textAlign: "center",
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: 18,
    color: lightPalette.text.secondary,
  },
});
