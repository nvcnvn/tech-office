/**
 * Reject-reason sheet for the mobile review queue (Feature 041).
 *
 * A rejection without a reason is a dead end for the person who submitted the evidence, so
 * the reason is mandatory and confirm stays disabled until it is non-empty once trimmed —
 * the same rule the server enforces (FR-014), applied here so the reviewer is not told off
 * by a round trip.
 *
 * The sheet lifts itself by the measured keyboard height rather than relying on
 * `KeyboardAvoidingView`: Android draws edge to edge in this app, so the window is never
 * resized and a bottom-pinned confirm button would sit behind the keyboard — exactly the
 * failure US3-3 calls out.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReviewQueueEntry } from "apis";

import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import {
  border,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  touch,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

export function RejectReasonSheet({
  entry,
  submitting,
  onCancel,
  onConfirm,
}: {
  /** The entry being rejected, or undefined when the sheet is closed. */
  entry?: ReviewQueueEntry;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { palette } = useTheme();
  const styles = useStyles();

  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const [reason, setReason] = useState("");

  // A reason belongs to one submission. Clearing on open stops a reason typed for one
  // entry being submitted against the next.
  useEffect(() => {
    if (entry) {
      setReason("");
    }
  }, [entry]);

  const trimmed = reason.trim();
  const canConfirm = trimmed.length > 0 && !submitting;

  return (
    <Modal
      transparent
      statusBarTranslucent
      animationType="slide"
      visible={!!entry}
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Close" />
        <View
          style={[
            styles.sheet,
            { paddingBottom: spacing[2] + (keyboardHeight > 0 ? keyboardHeight + insets.bottom : insets.bottom) },
          ]}
          testID="review-reject-sheet"
        >
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <Text style={styles.title}>Why is this being rejected?</Text>
            <Text style={styles.subtitle}>
              {entry
                ? `${entry.submittedByDisplayName} is told what you write here, so they know what to redo.`
                : ""}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="What was wrong with this evidence"
              placeholderTextColor={palette.text.disabled}
              value={reason}
              onChangeText={setReason}
              multiline
              autoFocus
              editable={!submitting}
              testID="review-reject-reason-input"
            />

            <Pressable
              disabled={!canConfirm}
              onPress={() => onConfirm(trimmed)}
              style={({ pressed }) => [
                styles.confirmButton,
                pressed && styles.pressed,
                !canConfirm && styles.disabled,
              ]}
              testID="review-reject-confirm-button"
            >
              {submitting ? (
                <ActivityIndicator size="small" color={palette.error.contrastText} />
              ) : (
                <Text style={styles.confirmButtonText}>Reject submission</Text>
              )}
            </Pressable>

            <Pressable
              onPress={onCancel}
              disabled={submitting}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              testID="review-reject-cancel-button"
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: t.overlay.scrim,
  },
  sheet: {
    backgroundColor: t.background.paper,
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
    backgroundColor: t.divider,
    marginBottom: spacing[2],
  },
  body: {
    gap: spacing[1.5],
  },
  title: {
    ...mobileTypography.sectionHeader,
    color: t.text.primary,
  },
  subtitle: {
    ...mobileTypography.listSecondary,
    color: t.text.secondary,
  },
  input: {
    minHeight: 96,
    borderRadius: radius.base,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: t.divider,
    backgroundColor: t.background.default,
    padding: spacing[1.5],
    textAlignVertical: "top",
    ...mobileTypography.listSecondary,
    color: t.text.primary,
  },
  confirmButton: {
    minHeight: touch.large,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: t.error.main,
  },
  confirmButtonText: {
    ...mobileTypography.button,
    color: t.error.contrastText,
  },
  cancelButton: {
    minHeight: touch.comfortable,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    ...mobileTypography.listPrimary,
    color: t.text.secondary,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
}));
