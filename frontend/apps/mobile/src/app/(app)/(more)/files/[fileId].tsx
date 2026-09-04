/**
 * File detail — what a File search result opens.
 *
 * Mobile had only a paginated file list, so a search hit had nowhere to go: routing one
 * to the list would land the person on a page that may not even contain the file they
 * tapped. This screen is a thin read of GetFileMetadata plus the same
 * getDownloadUrl → expo-sharing flow the list already uses.
 *
 * A file that has been deleted since the search says so, rather than showing a blank
 * screen.
 */

import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getDownloadUrl, getFileMetadata, type FileMetadata } from "apis";
import { formatDistanceToNow } from "date-fns";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SFIcon } from "@/components/ui/sf-icon";
import { StateChip } from "@/components/ui/state-chip";
import {
  actionIcons,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
  statusColors,
} from "@tech-office/theme-tokens";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatContextLabel(file: FileMetadata) {
  switch (file.uploadContext) {
    case "chat":
      return "Chat";
    case "avatar":
      return "Avatar";
    case "docs":
      return "Docs";
    case "project":
      return "Project";
    default:
      return "File";
  }
}

export default function FileDetailScreen() {
  const { fileId } = useLocalSearchParams<{ fileId: string }>();
  const [downloading, setDownloading] = useState(false);

  const {
    data: file,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["file", fileId],
    queryFn: async () => (await getFileMetadata(String(fileId))).file,
    enabled: Boolean(fileId),
  });

  const handleDownload = async () => {
    if (!file) return;
    setDownloading(true);
    try {
      const { downloadUrl } = await getDownloadUrl(file.id);
      const safeFilename = file.originalFilename.replace(/[\\/]/g, "-") || "file";
      const fileUri = (FileSystem.documentDirectory ?? "") + safeFilename;
      const { uri } = await FileSystem.downloadAsync(downloadUrl, fileUri);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert("Downloaded", `File saved to ${uri}`);
      }
    } catch (err) {
      Alert.alert("Download Failed", err instanceof Error ? err.message : "An error occurred");
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: "File" }} />
        <ActivityIndicator size="large" color={lightPalette.primary.main} />
      </View>
    );
  }

  if (isError || !file || file.isDeleted) {
    return (
      <View style={styles.centered} testID="file-detail-unavailable">
        <Stack.Screen options={{ title: "File" }} />
        <EmptyState
          sfSymbol="exclamationmark.triangle"
          title="This file is no longer available"
          subtitle={
            error instanceof Error && error.message
              ? error.message
              : "It may have been deleted, or you may not have access to it."
          }
          action={{ label: "Try again", onPress: () => void refetch() }}
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      testID="file-detail-screen"
    >
      <Stack.Screen options={{ title: "File" }} />

      <Card style={styles.card}>
        <View style={styles.header}>
          <View style={styles.iconWrap}>
            <SFIcon name="doc.text" size={20} color={lightPalette.primary.main} />
          </View>
          <View style={styles.copy}>
            <View style={styles.titleRow}>
              <Text selectable style={styles.title} numberOfLines={3} testID="file-detail-name">
                {file.originalFilename || "Unknown file"}
              </Text>
              <StateChip
                label={formatContextLabel(file)}
                color={statusColors.info.light.bg}
                textColor={statusColors.info.light.text}
              />
            </View>

            <Text style={styles.meta}>
              {formatBytes(file.sizeBytes)} • Updated{" "}
              {formatDistanceToNow(file.updatedAt, { addSuffix: true })}
            </Text>
            <Text style={styles.subtle} numberOfLines={1}>
              {file.mimeType}
            </Text>
            {file.validationStatus ? (
              <Text style={styles.subtle}>Safety check: {file.validationStatus}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            label={downloading ? "Downloading" : "Download"}
            size="sm"
            variant="secondary"
            loading={downloading}
            onPress={() => void handleDownload()}
            testID="file-detail-download"
          />
          <View style={styles.actionHint}>
            <SFIcon
              name={actionIcons.download.name}
              size={14}
              color={lightPalette.text.secondary}
            />
            <Text style={styles.actionHintText}>Saves, then opens share options</Text>
          </View>
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: lightPalette.background.default,
    padding: mobileLayout.screenPadding,
  },
  content: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
  },
  card: {
    gap: spacing[2],
  },
  header: {
    flexDirection: "row",
    gap: spacing[2],
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[1.5],
    flexWrap: "wrap",
  },
  title: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize,
    lineHeight: mobileTypography.listPrimary.lineHeight,
    fontWeight: mobileTypography.listPrimary.fontWeight,
    color: lightPalette.text.primary,
  },
  meta: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: lightPalette.text.secondary,
  },
  subtle: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.text.disabled,
  },
  actions: {
    gap: spacing[1],
  },
  actionHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  actionHintText: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.text.secondary,
  },
});
