/**
 * One entry in the mobile evidence review queue (Feature 041).
 *
 * Purpose-built for a phone held one-handed on a shop floor, not a narrowed copy of the
 * web row: one full-width card per submission, the evidence itself large enough to judge
 * at 360 dp, and the two decisions as the only primary actions on the card. Everything
 * else on the card is context and is deliberately secondary.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { getDownloadUrl, type ReviewQueueEntry } from "apis";

import { SFIcon } from "@/components/ui/sf-icon";
import { ProcedureSheet } from "@/components/rituals/procedure-sheet";
import {
  border,
  mobileLayout,
  mobileTypography,
  opacity,
  radius,
  spacing,
  statusColors,
  touch,
} from "@tech-office/theme-tokens";
import { makeStyles, useTheme } from "@/lib/theme";

const FILE_BACKED_TYPES = new Set(["photo", "voice_memo", "pdf", "file"]);

/** Relative age from the server's clock. The device clock never orders or ages an entry. */
function formatAge(at: Date | undefined): string {
  if (!at) {
    return "Unknown age";
  }

  const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000));
  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} h ago`;
  }

  return `${Math.round(hours / 24)} d ago`;
}

function formatDeadline(at: Date | undefined): string | undefined {
  if (!at) {
    return undefined;
  }

  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fileKindLabel(evidenceType: ReviewQueueEntry["evidenceType"]): string {
  switch (evidenceType) {
    case "voice_memo":
      return "voice memo";
    case "pdf":
      return "PDF";
    default:
      return "file";
  }
}

type EvidenceState = "idle" | "loading" | "ready" | "unavailable";

/**
 * The evidence itself.
 *
 * Download URLs are short-lived, so each card resolves its own lazily rather than the
 * screen minting a page of URLs that expire before the reviewer scrolls to them. When a
 * file cannot be resolved the card says so and stays decidable — hiding it would let a
 * broken upload silently clear the queue, which is what FR-009 exists to prevent.
 */
function ReviewEvidence({ entry }: { entry: ReviewQueueEntry }) {
  const { palette } = useTheme();
  const styles = useStyles();

  const { width } = useWindowDimensions();
  const [url, setUrl] = useState<string | undefined>();
  const [state, setState] = useState<EvidenceState>("idle");
  const [fullscreen, setFullscreen] = useState(false);

  const isFileBacked = FILE_BACKED_TYPES.has(entry.evidenceType);

  useEffect(() => {
    if (!isFileBacked) {
      return;
    }

    if (!entry.fileId) {
      setState("unavailable");
      return;
    }

    let cancelled = false;
    setState("loading");
    getDownloadUrl(entry.fileId)
      .then((info) => {
        if (cancelled) {
          return;
        }
        if (!info.downloadUrl || info.isDeleted) {
          setState("unavailable");
          return;
        }
        setUrl(info.downloadUrl);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setState("unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [entry.fileId, entry.evidenceType, isFileBacked]);

  if (entry.evidenceType === "text_note") {
    return (
      <Text selectable style={styles.evidenceText} testID="review-evidence-text">
        {entry.textContent}
      </Text>
    );
  }

  if (entry.evidenceType === "link") {
    return (
      <Pressable
        onPress={() => entry.linkUrl && void Linking.openURL(entry.linkUrl)}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        testID="review-evidence-link"
      >
        <SFIcon name="link" size={14} color={palette.primary.main} />
        <Text numberOfLines={1} style={styles.secondaryButtonText}>
          {entry.linkUrl}
        </Text>
      </Pressable>
    );
  }

  if (entry.evidenceType === "gps_checkin") {
    const gps = entry.gpsCoordinates;
    return (
      <Text selectable style={styles.evidenceText} testID="review-evidence-gps">
        {gps
          ? `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)} (±${Math.round(gps.accuracyMeters)} m)`
          : "No coordinates recorded"}
      </Text>
    );
  }

  if (state === "loading") {
    return (
      <View style={styles.evidenceLoading} testID="review-evidence-loading">
        <ActivityIndicator size="small" color={palette.text.secondary} />
      </View>
    );
  }

  if (state === "unavailable") {
    return (
      <View style={styles.evidenceUnavailable} testID="review-evidence-unavailable">
        <SFIcon name="exclamationmark.triangle.fill" size={14} color={statusColors.warning[palette.mode].text} />
        <Text style={styles.evidenceUnavailableText}>
          Evidence unavailable — the uploaded file could not be opened. You can still decide.
        </Text>
      </View>
    );
  }

  if (entry.evidenceType === "photo" && url) {
    // 4:3 at the card's own width, so the photo is judged at device width rather than as
    // a thumbnail. Full-screen is one tap away for the detail a 360 dp card cannot show.
    const photoWidth = Math.max(240, width - mobileLayout.screenPadding * 2 - mobileLayout.cardPadding * 2);

    return (
      <>
        <Pressable
          onPress={() => setFullscreen(true)}
          style={({ pressed }) => [styles.photoWrap, pressed && styles.pressed]}
          accessibilityLabel="View the submitted photo full screen"
          testID="review-photo-fullscreen-button"
        >
          <Image
            source={{ uri: url }}
            contentFit="cover"
            style={{ width: photoWidth, height: Math.round((photoWidth * 3) / 4), borderRadius: radius.base }}
          />
        </Pressable>

        <Modal
          animationType="fade"
          transparent
          statusBarTranslucent
          visible={fullscreen}
          onRequestClose={() => setFullscreen(false)}
        >
          <View style={styles.fullscreenBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setFullscreen(false)} />
            <Image
              source={{ uri: url }}
              contentFit="contain"
              style={styles.fullscreenImage}
              testID="review-photo-fullscreen"
            />
            <Pressable
              onPress={() => setFullscreen(false)}
              style={({ pressed }) => [styles.fullscreenClose, pressed && styles.pressed]}
              testID="review-photo-fullscreen-close"
            >
              <SFIcon name="xmark" size={16} color={palette.overlay.mediaText} />
            </Pressable>
          </View>
        </Modal>
      </>
    );
  }

  if (url) {
    return (
      <Pressable
        onPress={() => void Linking.openURL(url)}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
        testID="review-evidence-file"
      >
        <SFIcon name="doc.text.fill" size={14} color={palette.primary.main} />
        <Text style={styles.secondaryButtonText}>Open {fileKindLabel(entry.evidenceType)}</Text>
      </Pressable>
    );
  }

  return null;
}

export function ReviewQueueCard({
  entry,
  busy,
  onApprove,
  onReject,
}: {
  entry: ReviewQueueEntry;
  /** True while this entry's decision is in flight, so neither action double-fires. */
  busy?: boolean;
  onApprove: (entry: ReviewQueueEntry) => void;
  onReject: (entry: ReviewQueueEntry) => void;
}) {
  const { palette } = useTheme();
  const styles = useStyles();

  // Feature 043. The sheet draws over this card rather than navigating, so the reviewer's
  // place in the queue and any rejection reason already typed into RejectReasonSheet are
  // untouched by reading the procedure (D5, FR-014).
  const [showProcedure, setShowProcedure] = useState(false);
  const isLate = entry.urgency === "late";
  const deadline = formatDeadline(entry.instanceCompletionDeadline);

  return (
    <View style={styles.card} testID={`review-queue-item-${entry.evidenceSubmissionId}`}>
      <View style={styles.chipRow}>
        {isLate ? (
          <View style={styles.lateChip} testID={`review-queue-late-badge-${entry.evidenceSubmissionId}`}>
            <SFIcon name="exclamationmark.circle.fill" size={12} color={statusColors.error[palette.mode].text} />
            <Text style={styles.lateChipText}>
              {entry.instanceStateCategory === "missed" ? "Missed" : "Overdue"}
            </Text>
          </View>
        ) : null}
        <View style={styles.chip}>
          <Text numberOfLines={1} style={styles.chipText}>
            {entry.ritualName || "Ritual"}
          </Text>
        </View>
      </View>

      <Text style={styles.title}>{entry.taskTitle}</Text>
      <Text style={styles.subtitle}>
        {entry.taskIdentifier} · {entry.projectName}
      </Text>

      <Text style={styles.meta}>
        {entry.requirementUnresolved
          ? "This requirement is no longer defined"
          : `#${entry.evidenceRequirementPosition + 1} ${entry.evidenceRequirementName} · ${
              entry.evidenceRequirementIsRequired ? "required" : "optional"
            }`}
      </Text>
      <Text style={styles.meta}>
        {entry.submittedByDisplayName} · {formatAge(entry.serverTimestamp)}
        {deadline ? ` · due ${deadline}` : ""}
      </Text>

      <View style={styles.evidenceBlock}>
        <ReviewEvidence entry={entry} />
      </View>

      {/* Nothing at all when the ritual has no procedure (FR-017). The title and content
          are fetched only when it is opened, so a page of entries costs no extra reads. */}
      {entry.procedureDocumentId ? (
        <Pressable
          onPress={() => setShowProcedure(true)}
          style={({ pressed }) => [styles.procedureButton, pressed && styles.pressed]}
          testID="review-procedure-button"
        >
          <SFIcon name="book" size={14} color={palette.info.main} />
          <Text style={styles.procedureButtonText}>Procedure</Text>
        </Pressable>
      ) : null}

      {entry.procedureDocumentId ? (
        <ProcedureSheet
          ritualDefinitionId={entry.ritualDefinitionId}
          visible={showProcedure}
          onClose={() => setShowProcedure(false)}
        />
      ) : null}

      <View style={styles.actions}>
        <Pressable
          disabled={busy}
          onPress={() => onApprove(entry)}
          style={({ pressed }) => [
            styles.approveButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          testID="review-approve-button"
        >
          <SFIcon name="checkmark" size={16} color={palette.success.contrastText} />
          <Text style={styles.approveButtonText}>Approve</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => onReject(entry)}
          style={({ pressed }) => [
            styles.rejectButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
          testID="review-reject-button"
        >
          <SFIcon name="xmark" size={16} color={palette.error.main} />
          <Text style={styles.rejectButtonText}>Reject</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.background.paper,
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: t.divider,
    padding: mobileLayout.cardPadding,
    gap: spacing[0.5],
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.itemGap,
    flexWrap: "wrap",
    marginBottom: spacing[0.5],
  },
  chip: {
    flexShrink: 1,
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: t.background.default,
    borderWidth: border.thin,
    borderColor: t.divider,
  },
  chipText: {
    ...mobileTypography.caption,
    color: t.text.secondary,
  },
  lateChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: statusColors.error[t.mode].bg,
    borderWidth: border.thin,
    borderColor: statusColors.error[t.mode].border,
  },
  lateChipText: {
    ...mobileTypography.caption,
    fontWeight: "600",
    color: statusColors.error[t.mode].text,
  },
  title: {
    ...mobileTypography.listPrimary,
    fontWeight: "600",
    color: t.text.primary,
  },
  subtitle: {
    ...mobileTypography.listSecondary,
    color: t.text.secondary,
  },
  meta: {
    ...mobileTypography.caption,
    color: t.text.secondary,
  },
  evidenceBlock: {
    marginTop: spacing[1],
  },
  evidenceText: {
    ...mobileTypography.listSecondary,
    color: t.text.primary,
  },
  evidenceLoading: {
    height: touch.comfortable,
    justifyContent: "center",
  },
  evidenceUnavailable: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.itemGap,
    padding: spacing[1],
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: statusColors.warning[t.mode].bg,
    borderWidth: border.thin,
    borderColor: statusColors.warning[t.mode].border,
  },
  evidenceUnavailableText: {
    flex: 1,
    ...mobileTypography.caption,
    color: statusColors.warning[t.mode].text,
  },
  photoWrap: {
    alignSelf: "flex-start",
    borderRadius: radius.base,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  fullscreenBackdrop: {
    flex: 1,
    backgroundColor: t.overlay.mediaSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  fullscreenImage: {
    width: "100%",
    height: "80%",
  },
  fullscreenClose: {
    position: "absolute",
    top: spacing[6],
    right: mobileLayout.screenPadding,
    width: mobileLayout.headerActionSize,
    height: mobileLayout.headerActionSize,
    borderRadius: mobileLayout.headerActionSize / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.overlay.mediaControl,
  },
  secondaryButton: {
    minHeight: touch.comfortable,
    flexDirection: "row",
    alignItems: "center",
    gap: mobileLayout.itemGap,
    paddingHorizontal: spacing[1.5],
    borderRadius: radius.base,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: t.divider,
    backgroundColor: t.background.default,
  },
  secondaryButtonText: {
    flexShrink: 1,
    ...mobileTypography.buttonSm,
    color: t.primary.main,
  },
  procedureButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
    minHeight: touch.comfortable,
    paddingHorizontal: spacing[1],
    marginTop: spacing[1],
    borderRadius: radius.base,
    borderCurve: "continuous",
  },
  procedureButtonText: {
    ...mobileTypography.buttonSm,
    color: t.info.main,
  },
  actions: {
    flexDirection: "row",
    gap: mobileLayout.itemGap,
    marginTop: spacing[1.5],
  },
  approveButton: {
    flex: 1,
    minHeight: touch.large,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: mobileLayout.itemGap,
    borderRadius: radius.base,
    borderCurve: "continuous",
    backgroundColor: t.success.main,
  },
  approveButtonText: {
    ...mobileTypography.button,
    color: t.success.contrastText,
  },
  rejectButton: {
    flex: 1,
    minHeight: touch.large,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: mobileLayout.itemGap,
    borderRadius: radius.base,
    borderCurve: "continuous",
    borderWidth: border.thin,
    borderColor: t.error.main,
    backgroundColor: t.background.paper,
  },
  rejectButtonText: {
    ...mobileTypography.button,
    color: t.error.main,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
}));
