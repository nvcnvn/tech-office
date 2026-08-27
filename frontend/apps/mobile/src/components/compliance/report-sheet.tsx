/**
 * Report sheet — file a report about a piece of content (Feature 036).
 *
 * Reachable in three taps or fewer from seeing the content (SC-003): long-press
 * the message, tap Report, tap a reason. The reason list is the whole form; the
 * note is optional and the sheet submits from the reason row itself when the
 * person does not want to add one.
 *
 * The client sends only what was reported and why. Who authored it, and what it
 * said, are resolved server-side, so a report cannot be pinned on the wrong
 * person (FR-016).
 */

import React from "react";
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
import {
  REPORT_REASON_LABELS,
  reportContent,
  type ReportReason,
  type ReportTargetKind,
} from "apis";

import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  lightPalette,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

export function ReportSheet({
  visible,
  targetKind,
  targetId,
  subjectLabel,
  onClose,
}: {
  visible: boolean;
  targetKind: ReportTargetKind;
  targetId: string;
  /** What is being reported, in the person's words: "this message", "this file". */
  subjectLabel: string;
  onClose: () => void;
}) {
  const [reason, setReason] = React.useState<ReportReason | null>(null);
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);

  // Reset whenever the sheet opens, so a previous report's reason is never
  // pre-selected on the next one.
  React.useEffect(() => {
    if (visible) {
      setReason(null);
      setNote("");
      setError("");
      setConfirmed(false);
      setSubmitting(false);
    }
  }, [visible]);

  const submit = async (chosen: ReportReason) => {
    setSubmitting(true);
    setError("");
    try {
      await reportContent({ targetKind, targetId, reason: chosen, note: note.trim() || undefined });
      setConfirmed(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't send that report. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet} testID="report-sheet">
          <View style={styles.handle} />

          {confirmed ? (
            <View style={styles.confirmation} testID="report-sheet-confirmation">
              <View style={styles.confirmIconWrap}>
                <SFIcon name="checkmark" size={20} color={lightPalette.primary.contrastText} />
              </View>
              <Text style={styles.title}>Thanks — that's been reported</Text>
              <Text style={styles.subtitle}>
                The people who run this workspace can see it now, along with a copy of the
                content as it is right now. You don't need to do anything else.
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
                testID="report-sheet-done"
              >
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
              <Text style={styles.title}>Report {subjectLabel}</Text>
              <Text style={styles.subtitle}>
                Tell us what's wrong with it. This goes to the people who run this
                workspace. The person who posted it is not told who reported it.
              </Text>

              {REPORT_REASON_LABELS.map((option) => {
                const selected = reason === option.value;
                return (
                  <Pressable
                    key={option.value}
                    disabled={submitting}
                    onPress={() => {
                      setReason(option.value);
                      // A reason alone is a complete report. Tapping one submits, so
                      // the whole flow is long-press, Report, reason — three taps.
                      // Adding a note is optional and happens before choosing.
                      void submit(option.value);
                    }}
                    style={({ pressed }) => [
                      styles.reasonRow,
                      selected && styles.reasonRowSelected,
                      pressed && styles.pressed,
                    ]}
                    testID={`report-reason-${option.value}`}
                  >
                    <Text style={styles.reasonLabel}>{option.label}</Text>
                    {submitting && selected ? (
                      <ActivityIndicator size="small" color={lightPalette.text.secondary} />
                    ) : (
                      <SFIcon name="chevron.right" size={14} color={lightPalette.text.secondary} />
                    )}
                  </Pressable>
                );
              })}

              <Text style={styles.noteLabel}>Anything to add? (optional)</Text>
              <TextInput
                style={styles.noteInput}
                placeholder="What happened, in your own words"
                placeholderTextColor={lightPalette.text.disabled}
                value={note}
                onChangeText={setNote}
                multiline
                editable={!submitting}
                testID="report-sheet-note"
              />

              {error ? (
                <Text style={styles.error} selectable testID="report-sheet-error">
                  {error}
                </Text>
              ) : null}

              <Pressable
                onPress={onClose}
                disabled={submitting}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
                testID="report-sheet-cancel"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          )}
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
    paddingBottom: spacing[4],
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
  body: {
    gap: spacing[1.5],
    paddingBottom: spacing[2],
  },
  title: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  subtitle: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
    marginBottom: spacing[1],
  },
  reasonRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1.5],
    paddingHorizontal: spacing[2],
    borderRadius: radius.base,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.default,
  },
  reasonRowSelected: {
    borderColor: lightPalette.primary.main,
  },
  reasonLabel: {
    flex: 1,
    ...mobileTypography.listPrimary,
    color: lightPalette.text.primary,
  },
  noteLabel: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
    marginTop: spacing[1],
  },
  noteInput: {
    minHeight: 72,
    borderRadius: radius.base,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.default,
    padding: spacing[1.5],
    textAlignVertical: "top",
    ...mobileTypography.listSecondary,
    color: lightPalette.text.primary,
  },
  error: {
    ...mobileTypography.caption,
    color: lightPalette.error.main,
  },
  cancelButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing[1],
  },
  cancelButtonText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.text.secondary,
  },
  confirmation: {
    alignItems: "center",
    gap: spacing[1.5],
    paddingVertical: spacing[3],
  },
  confirmIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.main,
  },
  doneButton: {
    minHeight: 48,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: lightPalette.primary.main,
    marginTop: spacing[1],
  },
  doneButtonText: {
    ...mobileTypography.listPrimary,
    color: lightPalette.primary.contrastText,
    fontWeight: "600",
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
