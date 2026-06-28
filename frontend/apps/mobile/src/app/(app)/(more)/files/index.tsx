/**
 * Files browser — list org files and download/share them
 */

import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getDownloadUrl, listFiles, type FileMetadata } from "apis";
import { formatDistanceToNow } from "date-fns";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SFIcon } from "@/components/ui/sf-icon";
import { StateChip } from "@/components/ui/state-chip";
import { useManualRefresh } from "@/hooks/use-manual-refresh";
import {
  actionIcons,
  emptyStateIcons,
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  spacing,
  statusColors,
} from "@tech-office/theme-tokens";

function getFileIconName(file: FileMetadata) {
  const extension = file.originalFilename.split(".").pop()?.toLowerCase() ?? "";
  if (["pdf", "doc", "docx", "txt", "md"].includes(extension)) {
    return "doc.text";
  }

  return "doc";
}

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

export default function FilesScreen() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["files"],
    queryFn: async () => {
      const result = await listFiles({ limit: 50, offset: 0 });
      return result.files ?? [];
    },
  });
  const { isRefreshing, onRefresh } = useManualRefresh(refetch);

  const handleDownload = async (file: FileMetadata) => {
    setDownloading(file.id);
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
      setDownloading(null);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color={lightPalette.primary.main} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: "Files" }} />
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        data={data ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={lightPalette.primary.main}
          />
        }
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.listSeparator} />}
        ListHeaderComponent={
          <Card style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryIconWrap}>
                <SFIcon name="folder.fill" size={18} color={lightPalette.primary.main} />
              </View>
              <View style={styles.summaryCopy}>
                <Text selectable style={styles.summaryTitle}>Shared Files</Text>
                <Text selectable style={styles.summarySubtitle}>
                  Recent files available to your organization. Download a file to open or share it.
                </Text>
              </View>
            </View>
          </Card>
        }
        renderItem={({ item }) => {
          const isDownloading = downloading === item.id;

          return (
            <Card style={styles.fileCard}>
              <View style={styles.fileHeader}>
                <View style={styles.fileIconWrap}>
                  <SFIcon
                    name={getFileIconName(item)}
                    size={20}
                    color={lightPalette.primary.main}
                  />
                </View>

                <View style={styles.fileCopy}>
                  <View style={styles.fileTitleRow}>
                    <Text style={styles.fileTitle} numberOfLines={2}>
                      {item.originalFilename || "Unknown file"}
                    </Text>
                    <StateChip
                      label={formatContextLabel(item)}
                      color={statusColors.info.light.bg}
                      textColor={statusColors.info.light.text}
                    />
                  </View>

                  <Text style={styles.fileMeta}>
                    {formatBytes(item.sizeBytes)} • Updated {formatDistanceToNow(item.updatedAt, {
                      addSuffix: true,
                    })}
                  </Text>

                  <Text style={styles.fileSubtle} numberOfLines={1}>
                    {item.mimeType}
                  </Text>
                </View>
              </View>

              <View style={styles.fileActions}>
                <Button
                  label={isDownloading ? "Downloading" : "Download"}
                  size="sm"
                  variant="secondary"
                  loading={isDownloading}
                  onPress={() => handleDownload(item)}
                  style={styles.downloadButton}
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
          );
        }}
        ListEmptyComponent={
          <EmptyState
            sfSymbol={emptyStateIcons.noFiles.name}
            title="No files yet"
            subtitle="Files shared with your organization will appear here."
          />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: lightPalette.background.default,
  },
  listContent: {
    padding: mobileLayout.screenPadding,
    gap: mobileLayout.cardGap,
    paddingBottom: spacing[6],
    flexGrow: 1,
  },
  listSeparator: {
    height: mobileLayout.cardGap,
  },
  summaryCard: {
    marginBottom: spacing[0.5],
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: mobileLayout.iconTextGap,
  },
  summaryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef5fc",
  },
  summaryCopy: {
    flex: 1,
    gap: 2,
  },
  summaryTitle: {
    fontSize: mobileTypography.sectionHeader.fontSize,
    lineHeight: mobileTypography.sectionHeader.lineHeight,
    fontWeight: mobileTypography.sectionHeader.fontWeight,
    color: lightPalette.text.primary,
  },
  summarySubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: lightPalette.text.secondary,
  },
  fileCard: {
    gap: spacing[1.5],
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: mobileLayout.iconTextGap,
  },
  fileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
  },
  fileCopy: {
    flex: 1,
    gap: 4,
  },
  fileTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[1],
  },
  fileTitle: {
    flex: 1,
    fontSize: mobileTypography.listPrimary.fontSize,
    lineHeight: mobileTypography.listPrimary.lineHeight,
    fontWeight: mobileTypography.listPrimary.fontWeight,
    color: lightPalette.text.primary,
  },
  fileMeta: {
    fontSize: mobileTypography.listSecondary.fontSize,
    lineHeight: mobileTypography.listSecondary.lineHeight,
    color: lightPalette.text.secondary,
  },
  fileSubtle: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.text.disabled,
  },
  fileActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  downloadButton: {
    minWidth: 116,
  },
  actionHint: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing[0.5],
  },
  actionHintText: {
    fontSize: mobileTypography.caption.fontSize,
    lineHeight: mobileTypography.caption.lineHeight,
    color: lightPalette.text.secondary,
  },
});
