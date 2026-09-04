/**
 * The ritual's written procedure, shown over whatever surface opened it (Feature 043).
 *
 * A `Modal` and deliberately not a navigation. The surfaces that open it — the instance
 * screen, the evidence capture flow, the review queue card — all hold state the reader
 * would lose on a push: a photo already attached, a typed note, a typed rejection reason,
 * a position in the queue. Because the modal draws over the screen instead of replacing
 * it, nothing underneath is unmounted. Turning this into a route later reintroduces
 * exactly the loss this design removes (D5, FR-013, FR-014).
 *
 * Content comes from CollaborationService.GetRitualProcedure, never DocumentService: the
 * reader may have no access to the document at all, and that is the point of the feature.
 * Nothing here can edit, comment on or follow the document.
 */

import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { getRitualProcedure } from "apis";

import { DocumentContent, documentContentToText } from "@/components/docs/document-content";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";

export function ProcedureSheet({
  ritualDefinitionId,
  title,
  visible,
  onClose,
}: {
  ritualDefinitionId: string;
  /**
   * The title already known from the ritual definition, so the header is never blank while
   * the content loads. Surfaces that do not hold the definition omit it.
   */
  title?: string;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  // Fetched only while the sheet is open. An instance screen nobody opens the procedure on
  // pays nothing beyond the label it already has.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ritual-procedure", ritualDefinitionId],
    queryFn: () => getRitualProcedure(ritualDefinitionId),
    enabled: visible && !!ritualDefinitionId,
  });

  // Attached-but-unresolvable is not the same state as never-attached, and they read
  // differently to a worker. Never tell them apart by testing the content for emptiness.
  const unavailable = !isLoading && (isError || (!!data?.procedure && !data.procedure.isAvailable));
  const absent = !isLoading && !isError && !data?.procedure;
  const bodyText = documentContentToText(data?.contentJson ?? "").trim();

  return (
    <Modal
      transparent
      statusBarTranslucent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[styles.sheet, { paddingBottom: spacing[2] + insets.bottom }]}
          testID="ritual-procedure-sheet"
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2} testID="ritual-procedure-sheet-title">
              {data?.procedure?.title || title || "Procedure"}
            </Text>
            {data?.procedure?.status === "archived" ? (
              <Text style={styles.badge} testID="ritual-procedure-sheet-archived">
                Archived
              </Text>
            ) : null}
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {isLoading ? (
              <ActivityIndicator size="small" color={lightPalette.primary.main} />
            ) : unavailable ? (
              <Text style={styles.notice} testID="ritual-procedure-sheet-unavailable">
                This ritual has a procedure attached, but the document is no longer available.
                Carry on — you can still submit and review evidence.
              </Text>
            ) : absent ? (
              <Text style={styles.notice}>This ritual has no procedure attached.</Text>
            ) : bodyText ? (
              <DocumentContent text={bodyText} testID="ritual-procedure-sheet-content" />
            ) : (
              <Text style={styles.notice}>Nothing has been written in this procedure yet.</Text>
            )}
          </ScrollView>

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            testID="ritual-procedure-sheet-close"
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  sheet: {
    backgroundColor: lightPalette.background.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderCurve: "continuous",
    paddingHorizontal: mobileLayout.cardPadding,
    paddingTop: spacing[1.5],
    maxHeight: "85%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: radius.sm,
    backgroundColor: lightPalette.divider,
    marginBottom: spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    flexWrap: "wrap",
    marginBottom: spacing[1],
  },
  title: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
    flexShrink: 1,
  },
  badge: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  body: {
    gap: spacing[1.5],
    paddingBottom: spacing[2],
  },
  notice: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  closeButton: {
    minHeight: touch.comfortable,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.base,
    borderCurve: "continuous",
  },
  closeButtonText: {
    ...mobileTypography.button,
    color: lightPalette.primary.main,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
