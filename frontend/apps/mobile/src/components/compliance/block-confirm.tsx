/**
 * Block confirmation (Feature 036).
 *
 * Reachable in three taps or fewer from the person's profile or a conversation
 * (SC-004): open the menu, tap Block, confirm.
 *
 * The copy states the scope honestly, because the scope surprises people: blocking
 * stops direct conversations and calls, and does nothing to shared work channels.
 * That is deliberate — hiding a colleague in a shared channel would let someone
 * silently conceal instructions addressed to them (research.md R8).
 */

import React from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { blockPerson, unblockPerson } from "apis";

import { SFIcon } from "@/components/ui/sf-icon";
import {
  border,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  statusColors,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

export function BlockConfirm({
  visible,
  employeeId,
  displayName,
  mode,
  onClose,
  onDone,
}: {
  visible: boolean;
  employeeId: string;
  displayName: string;
  mode: "block" | "unblock";
  onClose: () => void;
  onDone?: () => void;
}) {
  const { palette } = useTheme();
  const styles = useStyles();

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (visible) {
      setError("");
      setSubmitting(false);
    }
  }, [visible]);

  const confirm = async () => {
    setSubmitting(true);
    setError("");
    try {
      if (mode === "block") {
        await blockPerson(employeeId);
      } else {
        await unblockPerson(employeeId);
      }
      onDone?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "We couldn't do that. Try again.",
      );
      setSubmitting(false);
    }
  };

  const blocking = mode === "block";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.card} testID="block-confirm">
          <View style={[styles.iconWrap, blocking && styles.iconWrapDanger]}>
            <SFIcon
              name={blocking ? "hand.raised.fill" : "hand.raised.slash"}
              size={20}
              color={blocking ? palette.error.main : palette.primary.main}
            />
          </View>

          <Text style={styles.title}>
            {blocking ? `Block ${displayName}?` : `Unblock ${displayName}?`}
          </Text>

          {blocking ? (
            <>
              <Text style={styles.body}>
                They won't be able to start a direct conversation or call you, and their
                direct messages will be hidden from your view.
              </Text>
              <Text style={styles.body}>
                They will still be in the same work channels as you, and you'll still see
                what they post there — so you don't miss instructions meant for you.
              </Text>
              <Text style={styles.quiet}>They are not told that you blocked them.</Text>
            </>
          ) : (
            <Text style={styles.body}>
              They'll be able to message and call you again, and your earlier direct
              conversation will come back.
            </Text>
          )}

          {error ? (
            <Text style={styles.error} selectable testID="block-confirm-error">
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={confirm}
            disabled={submitting}
            style={({ pressed }) => [
              styles.primaryButton,
              blocking && styles.primaryButtonDanger,
              pressed && styles.pressed,
            ]}
            testID="block-confirm-submit"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={palette.primary.contrastText} />
            ) : (
              <Text style={styles.primaryButtonText}>{blocking ? "Block" : "Unblock"}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={onClose}
            disabled={submitting}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
            testID="block-confirm-cancel"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: mobileLayout.screenPadding,
    backgroundColor: t.overlay.scrim,
  },
  card: {
    alignSelf: "stretch",
    gap: spacing[1.5],
    padding: mobileLayout.cardPadding,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: t.divider,
    backgroundColor: t.background.paper,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.base,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.background.default,
  },
  iconWrapDanger: {
    backgroundColor: statusColors.error[t.mode].bg,
  },
  title: {
    ...mobileTypography.sectionHeader,
    color: t.text.primary,
  },
  body: {
    ...mobileTypography.listSecondary,
    color: t.text.secondary,
  },
  quiet: {
    ...mobileTypography.caption,
    color: t.text.secondary,
  },
  error: {
    ...mobileTypography.caption,
    color: t.error.main,
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: t.primary.main,
    marginTop: spacing[1],
  },
  primaryButtonDanger: {
    backgroundColor: t.error.main,
  },
  primaryButtonText: {
    ...mobileTypography.listPrimary,
    color: t.primary.contrastText,
    fontWeight: "600",
  },
  cancelButton: {
    minHeight: 44,
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
}));
