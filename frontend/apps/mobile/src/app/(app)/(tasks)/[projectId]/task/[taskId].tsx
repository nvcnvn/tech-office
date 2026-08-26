import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  APIError,
  getEmployeePermissions,
  getProfile,
  getRitualDefinition,
  getTask,
  getTaskByIdentifier,
  listEvidenceSubmissions,
  listProjectStates,
  moveTask,
  submitEvidence,
  type ApprovalStatus,
  type EvidenceRequirementDetail,
  type EvidenceSubmission,
  type ProjectState,
  type RitualDefinition,
  type Task,
  type TaskEvidenceProgressSummary,
  getDownloadUrl,
} from "apis";
import { EmptyState } from "@/components/ui/empty-state";
import { SFIcon } from "@/components/ui/sf-icon";
import { useAuth } from "@/hooks/use-auth";
import { useResolvedProjectId } from "@/hooks/use-resolved-project-id";
import { API_BASE_URL } from "@/lib/constants";
import { ensureEvidenceCameraPermission, pickEvidencePhoto, uploadEvidenceAsset } from "@/lib/evidence-media";
import { withNavigationContext } from "@/lib/mobile-navigation";
import { invalidateTaskQueries } from "@/lib/task-query-invalidation";
import {
  lightPalette,
  mobileLayout,
  mobileTypography,
  radius,
  shadows,
  spacing,
  statusColors,
} from "@tech-office/theme-tokens";

type CardTone = "neutral" | "info" | "success" | "warning" | "danger";
type RequirementStatus = ApprovalStatus | "missing";
type RitualFocusIntent = "view_instance" | "submit_requirement" | "review_pending";
type RitualEntryContext = "skipped" | "detached";

type RequirementRowItem = {
  requirement: EvidenceRequirementDetail;
  latestSubmission?: EvidenceSubmission;
  status: RequirementStatus;
  canSubmit: boolean;
};

type SubmissionFeedback = {
  title: string;
  message: string;
};

type TaskContextMessage = {
  title: string;
  message: string;
  tone: CardTone;
};

type DateLike = Date | string | null | undefined;

const categoryColors: Record<string, string> = {
  todo: "#7a8794",
  in_progress: lightPalette.warning.main,
  done: lightPalette.success.main,
  cancelled: "#9aa4b2",
  scheduled: lightPalette.info.main,
  submitted: "#7c5cff",
  verified: lightPalette.success.main,
  overdue: lightPalette.error.main,
  missed: "#a94442",
  skipped: "#8d99ae",
};

function parseDateOnly(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function parseDateTime(value?: DateLike): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getRouteParamValue(value?: string | string[]): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function requestCurrentLocationForEvidence(): Promise<Location.LocationObject> {
  await ensureLocationPermissionForEvidence();
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}

async function ensureLocationPermissionForEvidence(): Promise<void> {
  const currentPermission = await Location.getForegroundPermissionsAsync();
  if (!currentPermission.granted) {
    if (!currentPermission.canAskAgain) {
      throw new Error("Location access is needed to verify where the photo was captured. Please enable it in Settings.");
    }

    const requestedPermission = await Location.requestForegroundPermissionsAsync();
    if (!requestedPermission.granted) {
      if (!requestedPermission.canAskAgain) {
        throw new Error("Location access is needed to verify where the photo was captured. Please enable it in Settings.");
      }

      throw new Error("Location access is needed to verify where the photo was captured.");
    }
  }
}


function formatAbsoluteDate(value?: DateLike): string | null {
  const date = parseDateTime(value);
  if (!date) {
    return null;
  }

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatAbsoluteDateTime(value?: DateLike): string | null {
  const date = parseDateTime(value);
  if (!date) {
    return null;
  }

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getSubmissionFeedback(kind: "proof" | "check-in", approvalStatus: ApprovalStatus): SubmissionFeedback {
  if (approvalStatus === "approved") {
    return {
      title: kind === "check-in" ? "Check-in accepted" : "Proof accepted",
      message: "This proof is complete.",
    };
  }

  return {
    title: kind === "check-in" ? "Check-in sent" : "Proof sent",
    message: kind === "check-in"
      ? "Your location check-in is waiting for review."
      : "Your proof is waiting for review.",
  };
}

function formatRelativeDate(value?: DateLike): string | null {
  const date = parseDateTime(value);
  if (!date) {
    return null;
  }

  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const dayDiff = Math.round((target.getTime() - today.getTime()) / 86400000);

  if (dayDiff === 0) {
    return "Today";
  }

  if (dayDiff === 1) {
    return "Tomorrow";
  }

  if (dayDiff === -1) {
    return "Yesterday";
  }

  if (dayDiff > 1 && dayDiff < 7) {
    return `${dayDiff} days away`;
  }

  if (dayDiff < -1 && dayDiff > -7) {
    return `${Math.abs(dayDiff)} days late`;
  }

  return formatAbsoluteDate(date);
}

function normalizeTask(task?: Task): Task | undefined {
  if (!task) {
    return undefined;
  }

  return {
    ...task,
    updatedAt: parseDateTime(task.updatedAt) ?? new Date(),
    completionDeadline: parseDateTime(task.completionDeadline) ?? undefined,
    assignees: task.assignees.map((assignee) => ({
      ...assignee,
      assignedAt: parseDateTime(assignee.assignedAt) ?? new Date(),
    })),
  };
}

function normalizeEvidenceSubmission(submission: EvidenceSubmission): EvidenceSubmission {
  return {
    ...submission,
    deviceTimestamp: parseDateTime(submission.deviceTimestamp) ?? undefined,
    serverTimestamp: parseDateTime(submission.serverTimestamp) ?? undefined,
    reviewedAt: parseDateTime(submission.reviewedAt) ?? undefined,
  };
}

function isSingleEvidenceType(
  requirement: EvidenceRequirementDetail,
  type: EvidenceRequirementDetail["evidenceTypes"][number],
): boolean {
  return requirement.evidenceTypes.length === 1 && requirement.evidenceTypes[0] === type;
}

function getEvidenceTypeLabel(type: EvidenceRequirementDetail["evidenceTypes"][number]): string {
  switch (type) {
    case "photo":
      return "Photo";
    case "gps_checkin":
      return "GPS check-in";
    case "text_note":
      return "Text note";
    case "link":
      return "Link";
    case "file":
      return "File";
    case "pdf":
      return "PDF";
    case "voice_memo":
      return "Voice memo";
    default:
      return type;
  }
}

function getToneColors(tone: CardTone) {
  switch (tone) {
    case "danger":
      return {
        accent: lightPalette.error.main,
        background: statusColors.error.light.bg,
        text: statusColors.error.light.text,
      };
    case "warning":
      return {
        accent: lightPalette.warning.main,
        background: statusColors.warning.light.bg,
        text: statusColors.warning.light.text,
      };
    case "success":
      return {
        accent: lightPalette.success.main,
        background: statusColors.success.light.bg,
        text: statusColors.success.light.text,
      };
    case "info":
      return {
        accent: lightPalette.info.main,
        background: "#edf6ff",
        text: lightPalette.info.dark,
      };
    default:
      return {
        accent: lightPalette.text.secondary,
        background: "#f4f6f8",
        text: lightPalette.text.secondary,
      };
  }
}

function getStateAccentColor(state?: ProjectState): string {
  if (state?.color) {
    return state.color;
  }

  return state ? categoryColors[state.category] ?? lightPalette.text.secondary : lightPalette.text.secondary;
}

function getStateTone(state?: ProjectState): CardTone {
  switch (state?.category) {
    case "overdue":
    case "missed":
      return "danger";
    case "submitted":
    case "in_progress":
      return "warning";
    case "verified":
    case "done":
      return "success";
    case "scheduled":
      return "info";
    default:
      return "neutral";
  }
}

function getRequirementTone(status: RequirementStatus): CardTone {
  switch (status) {
    case "approved":
      return "success";
    case "pending_review":
      return "warning";
    case "rejected":
      return "danger";
    default:
      return "neutral";
  }
}

function getRequirementStatusLabel(status: RequirementStatus, isRequired: boolean): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "pending_review":
      return "Awaiting review";
    case "rejected":
      return "Needs resubmission";
    default:
      return isRequired ? "Needed" : "Optional";
  }
}

function buildRequirementHelperText(item: RequirementRowItem): string {
  if (item.status === "approved") {
    return item.latestSubmission?.reviewedAt
      ? `Reviewed ${formatAbsoluteDateTime(item.latestSubmission.reviewedAt)}.`
      : "Latest proof accepted.";
  }

  if (item.status === "pending_review") {
    return item.latestSubmission?.serverTimestamp
      ? `Sent ${formatAbsoluteDateTime(item.latestSubmission.serverTimestamp)}.`
      : "Sent for review.";
  }

  if (item.status === "rejected") {
    return item.latestSubmission?.reviewerComment || "Submit proof again with the missing details.";
  }

  if (isSingleEvidenceType(item.requirement, "photo")) {
    return item.requirement.isRequired
      ? "Take a clear photo to finish this step."
      : "Add a photo if it helps explain the work.";
  }

  if (isSingleEvidenceType(item.requirement, "gps_checkin")) {
    return "Check in when you are at the work location.";
  }

  if (isSingleEvidenceType(item.requirement, "text_note")) {
    return "Add a short note for this step.";
  }

  return item.requirement.isRequired
    ? "Add the requested proof to finish this step."
    : "Optional proof you can add if it helps explain the work.";
}

function buildTaskContextMessage({
  entryContext,
}: {
  entryContext?: RitualEntryContext;
  focusIntent?: RitualFocusIntent;
  focusedRequirementId?: string;
  isAssignedToMe: boolean;
  canReviewEvidence: boolean;
  pendingReviewCount: number;
}): TaskContextMessage | null {
  if (entryContext === "detached") {
    return {
      title: "Detached run",
      message: "This run is stored on its own. Future template changes will not rewrite this record.",
      tone: "info",
    };
  }

  if (entryContext === "skipped") {
    return {
      title: "Skipped run",
      message: "This screen keeps the skip record for this specific run.",
      tone: "info",
    };
  }

  return null;
}

function buildGpsMapUrl(submission: EvidenceSubmission): string | null {
  if (!submission.gpsCoordinates) {
    return null;
  }

  const { latitude, longitude } = submission.gpsCoordinates;
  const pinLabel = encodeURIComponent("Evidence check-in");
  if (Platform.OS === "ios") {
    return `maps://?ll=${latitude},${longitude}&q=${pinLabel}`;
  }

  return `geo:${latitude},${longitude}?q=${latitude},${longitude}(${pinLabel})`;
}

function buildGpsMapFallbackUrl(submission: EvidenceSubmission): string | null {
  if (!submission.gpsCoordinates) {
    return null;
  }

  const { latitude, longitude } = submission.gpsCoordinates;
  const pinLabel = encodeURIComponent("Evidence check-in");
  if (Platform.OS === "ios") {
    return `https://maps.apple.com/?ll=${latitude},${longitude}&q=${pinLabel}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function formatGpsAccuracy(submission: EvidenceSubmission): string | null {
  const accuracyMeters = submission.gpsCoordinates?.accuracyMeters;
  if (!Number.isFinite(accuracyMeters) || accuracyMeters == null || accuracyMeters <= 0) {
    return null;
  }

  return `Pinned location, accurate to about ${Math.round(accuracyMeters)} m.`;
}

function buildSubmissionPreviewText(submission: EvidenceSubmission): string {
  if (submission.textContent?.trim()) {
    return submission.textContent.trim();
  }

  if (submission.linkUrl?.trim()) {
    return submission.linkUrl.trim();
  }

	const gpsAccuracy = formatGpsAccuracy(submission);
	if (submission.gpsCoordinates) {
		return gpsAccuracy ?? "Pinned check-in location recorded for this step.";
  }

  if (submission.fileId) {
    return submission.evidenceType === "photo" ? "Photo attached for this step." : "File attached for this step.";
  }

  return "Submission recorded for this step.";
}

function getSubmissionAttachmentLabel(submission: EvidenceSubmission): string {
  return submission.evidenceType === "photo" ? "View photo" : "Open file";
}

function getSubmissionMapLabel(): string {
  return Platform.OS === "ios" ? "Open in Maps" : "Open map";
}

function getSubmissionLinkLabel(): string {
  return "Open link";
}

function getRequirementActionLabel(item: RequirementRowItem): string {
  if (isSingleEvidenceType(item.requirement, "photo")) {
    const baseLabel = Platform.OS === "ios" ? "Take or choose photo" : "Take photo";
    return item.status === "rejected" ? `Retake photo` : baseLabel;
  }

  if (isSingleEvidenceType(item.requirement, "gps_checkin")) {
    return "Check in now";
  }

  if (isSingleEvidenceType(item.requirement, "text_note")) {
    return item.status === "rejected" ? "Update note" : "Add note";
  }

  return item.status === "rejected" ? "Fix proof" : "Add proof";
}

function shouldUseDirectPhotoAction(item: RequirementRowItem): boolean {
  return item.canSubmit && isSingleEvidenceType(item.requirement, "photo");
}

function deriveEvidenceProgress(
  task: Task,
  requirements: EvidenceRequirementDetail[],
  rows: RequirementRowItem[],
): TaskEvidenceProgressSummary {
  if (task.evidenceProgress) {
    return task.evidenceProgress;
  }

  const requiredRows = rows.filter((row) => row.requirement.isRequired);
  return {
    totalRequirements: requirements.length,
    requiredCount: requiredRows.length,
    submittedCount: rows.filter((row) => row.latestSubmission).length,
    approvedCount: rows.filter((row) => row.status === "approved").length,
    rejectedCount: rows.filter((row) => row.status === "rejected").length,
    pendingReviewCount: rows.filter((row) => row.status === "pending_review").length,
    allRequiredApproved: requiredRows.every((row) => row.status === "approved"),
  };
}

function buildRequirementRows(
  requirements: EvidenceRequirementDetail[],
  submissions: EvidenceSubmission[],
  currentState?: ProjectState,
): RequirementRowItem[] {
  const submissionsByRequirement = new Map<string, EvidenceSubmission[]>();
  for (const submission of submissions) {
    const list = submissionsByRequirement.get(submission.evidenceRequirementId) ?? [];
    list.push(submission);
    submissionsByRequirement.set(submission.evidenceRequirementId, list);
  }

  return requirements
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((requirement) => {
      const latestSubmission = (submissionsByRequirement.get(requirement.id) ?? [])
        .slice()
        .sort(
          (left, right) =>
            (right.serverTimestamp?.getTime() ?? 0) - (left.serverTimestamp?.getTime() ?? 0),
        )[0];
      const status = latestSubmission?.approvalStatus ?? "missing";

      return {
        requirement,
        latestSubmission,
        status,
        canSubmit: !currentState?.isClosed && status !== "approved" && status !== "pending_review",
      };
    });
}

function buildHeroSummary(task: Task, currentState?: ProjectState): string {
  if (task.taskKind === "ritual_instance") {
    if (task.evidenceProgress?.allRequiredApproved) {
      return "All proof approved.";
    }

    if ((task.evidenceProgress?.pendingReviewCount ?? 0) > 0) {
      return `${task.evidenceProgress?.pendingReviewCount ?? 0} proof waiting for review.`;
    }

    if ((task.evidenceProgress?.rejectedCount ?? 0) > 0) {
      return `${task.evidenceProgress?.rejectedCount ?? 0} proof needs fixing.`;
    }

    if ((task.evidenceProgress?.requiredCount ?? 0) > 0) {
      const approved = task.evidenceProgress?.approvedCount ?? 0;
      const required = task.evidenceProgress?.requiredCount ?? 0;
      const remaining = Math.max(required - approved, 0);
      return remaining > 0 ? `${remaining} proof left.` : "Proof checklist is ready.";
    }

    return "Ready for proof.";
  }

  if (currentState?.isClosed) {
    return "This work is already finished.";
  }

  return "Check what matters, then report the real work status below.";
}

function buildHeroTimingLabel(value: string | null): string {
  if (!value) {
    return "No date";
  }

  if (value === "Today") {
    return "Due today";
  }

  if (value === "Tomorrow") {
    return "Due tomorrow";
  }

  if (value === "Yesterday") {
    return "Due yesterday";
  }

  if (value.includes("days away")) {
    return `Due in ${value.replace(" days away", " days")}`;
  }

  return value;
}

function formatAssigneeSummary(task: Task, isAssignedToMe: boolean): string {
  const count = task.assignees.length;

  if (count === 0) {
    return "No assignee yet";
  }

  if (isAssignedToMe) {
    if (count === 1) {
      return "Assigned to you";
    }

    return `Assigned to you and ${count - 1} more`;
  }

  return count === 1 ? "1 assignee" : `${count} assignees`;
}

function formatCommentSummary(count: number): string {
  if (count <= 0) {
    return "No comments yet";
  }

  return count === 1 ? "1 comment" : `${count} comments`;
}

function EvidenceRequirementCard({
  item,
  onAction,
  canReview,
  isSubmitting,
  highlighted,
  showTextComposer,
  textDraft,
  onChangeTextDraft,
  onCancelText,
  onSubmitText,
}: {
  item: RequirementRowItem;
  onAction: () => void;
  canReview: boolean;
  isSubmitting: boolean;
  highlighted: boolean;
  showTextComposer: boolean;
  textDraft: string;
  onChangeTextDraft: (value: string) => void;
  onCancelText: () => void;
  onSubmitText: () => void;
}) {
  const tone = getRequirementTone(item.status);
  const colors = getToneColors(tone);
  const actionLabel = getRequirementActionLabel(item);
  const [openingAttachment, setOpeningAttachment] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  const openMap = async () => {
    const nativeUrl = buildGpsMapUrl(item.latestSubmission!);
    const fallbackUrl = buildGpsMapFallbackUrl(item.latestSubmission!);
    const targetUrl = nativeUrl && await Linking.canOpenURL(nativeUrl)
      ? nativeUrl
      : fallbackUrl;

    if (!targetUrl) {
      return;
    }

    await Linking.openURL(targetUrl);
  };

  const handleOpenAttachment = async () => {
    if (!item.latestSubmission?.fileId || openingAttachment) {
      return;
    }

    try {
      setOpeningAttachment(true);
      const { downloadUrl } = await getDownloadUrl(item.latestSubmission.fileId);
      if (item.latestSubmission.evidenceType === "photo") {
        setPreviewImageUrl(downloadUrl);
        return;
      }
      await Linking.openURL(downloadUrl);
    } catch (error) {
      Alert.alert(
        "Could not open submission",
        error instanceof Error ? error.message : "Try again in a moment.",
      );
    } finally {
      setOpeningAttachment(false);
    }
  };
  const showDeadlineHint = item.requirement.deadlineOffsetHours > 0;

  return (

    <View style={styles.requirementCard} testID={`ritual-requirement-${item.requirement.id}`}>
      <View style={styles.requirementHeader}>
        <View style={styles.requirementTitleWrap}>
          <Text style={styles.requirementTitle}>{item.requirement.name}</Text>
          <Text style={styles.requirementCaption}>{item.requirement.isRequired ? "Required proof" : "Optional proof"}</Text>
        </View>
        <View style={[styles.statusChip, { backgroundColor: colors.background }]}> 
          <Text style={[styles.statusChipText, { color: colors.text }]}>
            {getRequirementStatusLabel(item.status, item.requirement.isRequired)}
          </Text>
        </View>
      </View>

      <View style={styles.requirementMetaRow}>
        {item.requirement.evidenceTypes.map((type) => (
          <View key={type} style={styles.metaMiniChip}>
            <Text style={styles.metaMiniChipText}>{getEvidenceTypeLabel(type)}</Text>
          </View>
        ))}
        {showDeadlineHint ? (
          <View style={styles.metaMiniChip}>
            <Text style={styles.metaMiniChipText}>{`Within ${item.requirement.deadlineOffsetHours}h`}</Text>
          </View>
        ) : null}
      </View>

      {item.requirement.description ? (
        <Text style={styles.requirementBody}>{item.requirement.description}</Text>
      ) : null}

      <View style={styles.requirementHelperRow}>
        <SFIcon
          name={
            item.status === "approved"
              ? "checkmark.circle.fill"
              : item.status === "pending_review"
                ? "clock.badge.exclamationmark.fill"
                : item.status === "rejected"
                  ? "exclamationmark.circle.fill"
                  : "circle"
          }
          size={12}
          color={colors.accent}
        />
        <Text style={[styles.requirementHelperText, { color: colors.text }]}>
          {buildRequirementHelperText(item)}
        </Text>
      </View>

      {item.latestSubmission?.reviewerComment && item.status !== "rejected" ? (
        <View style={styles.noteCard}>
          <Text style={styles.noteLabel}>Reviewer note</Text>
          <Text style={styles.noteText}>{item.latestSubmission.reviewerComment}</Text>
        </View>
      ) : null}

      {item.latestSubmission ? (
        <View style={styles.submissionCard}>
          <View style={styles.submissionHeaderRow}>
            <Text style={styles.submissionLabel}>Submitted proof</Text>
            {item.latestSubmission.serverTimestamp ? (
              <Text style={styles.submissionTimestamp}>
                {formatAbsoluteDateTime(item.latestSubmission.serverTimestamp)}
              </Text>
            ) : null}
          </View>
          <Text style={styles.submissionPreviewText}>
            {buildSubmissionPreviewText(item.latestSubmission)}
          </Text>
          <View style={styles.submissionActionsRow}>
            {item.latestSubmission.gpsCoordinates ? (
              <Pressable
                onPress={() => {
                  void openMap();
                }}
                style={({ pressed }) => [
                  styles.submissionActionChip,
                  pressed ? styles.submissionLinkButtonPressed : undefined,
                ]}
              >
                <SFIcon name="mappin.and.ellipse" size={13} color={lightPalette.info.main} />
                <Text style={styles.submissionLinkButtonText}>{getSubmissionMapLabel()}</Text>
              </Pressable>
            ) : null}
            {item.latestSubmission.fileId ? (
              <Pressable
                onPress={() => {
                  void handleOpenAttachment();
                }}
                disabled={openingAttachment}
                style={({ pressed }) => [
                  styles.submissionActionChip,
                  pressed && !openingAttachment ? styles.submissionLinkButtonPressed : undefined,
                  openingAttachment ? styles.primaryActionButtonDisabled : undefined,
                ]}
              >
                {openingAttachment ? (
                  <ActivityIndicator size="small" color={lightPalette.info.main} />
                ) : (
                  <>
                    <SFIcon
                      name={item.latestSubmission.evidenceType === "photo" ? "eye" : "doc"}
                      size={13}
                      color={lightPalette.info.main}
                    />
                    <Text style={styles.submissionLinkButtonText}>
                      {getSubmissionAttachmentLabel(item.latestSubmission)}
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
            {item.latestSubmission.linkUrl ? (
              <Pressable
                onPress={() => {
                  void Linking.openURL(item.latestSubmission?.linkUrl ?? "");
                }}
                style={({ pressed }) => [
                  styles.submissionActionChip,
                  pressed ? styles.submissionLinkButtonPressed : undefined,
                ]}
              >
                <SFIcon name="link" size={13} color={lightPalette.info.main} />
                <Text style={styles.submissionLinkButtonText}>{getSubmissionLinkLabel()}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {showTextComposer ? (
        <View style={styles.inlineComposerCard}>
          <Text style={styles.inlineComposerLabel}>Add a short note for this live task run</Text>
          <TextInput
            multiline
            value={textDraft}
            onChangeText={onChangeTextDraft}
            placeholder="Describe what happened for this step"
            textAlignVertical="top"
            style={styles.inlineComposerInput}
          />
          <View style={styles.inlineComposerActions}>
            <Pressable
              onPress={onCancelText}
              disabled={isSubmitting}
              style={({ pressed }) => [styles.secondaryInlineButton, pressed && !isSubmitting ? styles.secondaryInlineButtonPressed : undefined]}
            >
              <Text style={styles.secondaryInlineButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={onSubmitText}
              disabled={isSubmitting || !textDraft.trim()}
              style={({ pressed }) => [
                styles.primaryInlineButton,
                pressed && !isSubmitting ? styles.primaryInlineButtonPressed : undefined,
                isSubmitting || !textDraft.trim() ? styles.primaryActionButtonDisabled : undefined,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
              ) : (
                <Text style={styles.primaryActionButtonText}>Send note</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.requirementActionsRow}>
        {item.canSubmit && !showTextComposer ? (
          <Pressable
            onPress={onAction}
            disabled={isSubmitting}
            style={({ pressed }) => [
              styles.primaryActionButton,
              pressed && !isSubmitting ? styles.primaryActionButtonPressed : undefined,
              isSubmitting ? styles.primaryActionButtonDisabled : undefined,
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={lightPalette.primary.contrastText} />
            ) : (
              <Text style={styles.primaryActionButtonText}>{actionLabel}</Text>
            )}
          </Pressable>
        ) : null}
        {canReview && item.status === "pending_review" ? (
          <View style={styles.reviewerNotice}>
            <SFIcon name="person.badge.shield.checkmark" size={12} color={lightPalette.info.main} />
            <Text style={styles.reviewerNoticeText}>Open in browser for full review controls</Text>
          </View>
        ) : null}
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={previewImageUrl != null}
        onRequestClose={() => setPreviewImageUrl(null)}
      >
        <View style={styles.imagePreviewBackdrop}>
          <Pressable
            style={styles.imagePreviewDismissArea}
            onPress={() => setPreviewImageUrl(null)}
          />
          <View style={styles.imagePreviewCard}>
            <View style={styles.imagePreviewHeader}>
              <Text style={styles.imagePreviewTitle}>Submitted photo</Text>
              <Pressable
                onPress={() => setPreviewImageUrl(null)}
                style={({ pressed }) => [
                  styles.imagePreviewCloseButton,
                  pressed ? styles.imagePreviewCloseButtonPressed : undefined,
                ]}
              >
                <SFIcon name="xmark" size={14} color={lightPalette.text.secondary} />
              </Pressable>
            </View>
            {previewImageUrl ? (
              <Image
                source={{ uri: previewImageUrl }}
                contentFit="contain"
                style={styles.imagePreview}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PhotoEvidencePreflightSheet({
  visible,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <Pressable style={preflightStyles.backdrop} onPress={onCancel}>
        <Pressable style={preflightStyles.sheet} onPress={() => {}}>
          <View style={preflightStyles.grabber} />
          <Text style={preflightStyles.title}>Before you take a photo</Text>
          <View style={preflightStyles.rows}>
            <View style={preflightStyles.row}>
              <View style={[preflightStyles.iconWrap, { backgroundColor: "#eff6ff" }]}>
                <SFIcon name="location.fill" size={20} color={lightPalette.info.main} />
              </View>
              <View style={preflightStyles.rowText}>
                <Text style={preflightStyles.rowTitle}>Location</Text>
                <Text style={preflightStyles.rowSubtitle}>Stamps where the work happened so the submission can be verified.</Text>
              </View>
            </View>
            <View style={preflightStyles.row}>
              <View style={[preflightStyles.iconWrap, { backgroundColor: "#f1f5f9" }]}>
                <SFIcon name="camera.fill" size={20} color={lightPalette.primary.main} />
              </View>
              <View style={preflightStyles.rowText}>
                <Text style={preflightStyles.rowTitle}>Camera</Text>
                <Text style={preflightStyles.rowSubtitle}>Takes a fresh photo as proof — no gallery uploads allowed.</Text>
              </View>
            </View>
          </View>
          <View style={preflightStyles.actions}>
            <Pressable style={preflightStyles.cancelButton} onPress={onCancel}>
              <Text style={preflightStyles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable style={preflightStyles.continueButton} onPress={onConfirm}>
              <Text style={preflightStyles.continueText}>Continue</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const preflightStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: lightPalette.background.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing[1],
    paddingBottom: spacing[4],
    paddingHorizontal: spacing[3],
    gap: spacing[2.5],
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: lightPalette.text.disabled,
    marginBottom: spacing[0.5],
  },
  title: {
    fontSize: mobileTypography.sectionHeader.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
    textAlign: "center",
  },
  rows: {
    gap: spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowText: {
    flex: 1,
    gap: spacing[0.5],
  },
  rowTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.primary,
  },
  rowSubtitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: lightPalette.text.secondary,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[0.5],
  },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: lightPalette.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "600" as const,
    color: lightPalette.text.secondary,
  },
  continueButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: lightPalette.primary.main,
    alignItems: "center",
    justifyContent: "center",
  },
  continueText: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "700" as const,
    color: "#ffffff",
  },
});

export default function TaskDetailScreen() {
  const params = useLocalSearchParams<{
    projectId?: string | string[];
    taskId?: string | string[];
    focusIntent?: string | string[];
    requirementId?: string | string[];
    entryContext?: string | string[];
  }>();
  const rawProjectId = getRouteParamValue(params.projectId);
  const taskId = getRouteParamValue(params.taskId);
  const focusIntent = getRouteParamValue(params.focusIntent) as RitualFocusIntent | undefined;
  const focusedRequirementId = getRouteParamValue(params.requirementId);
  const entryContext = getRouteParamValue(params.entryContext) as RitualEntryContext | undefined;
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useAuth();
  const { resolvedProjectId: projectId } = useResolvedProjectId(rawProjectId);
  const [submittingRequirementId, setSubmittingRequirementId] = useState<string | null>(null);
  const [activeTextRequirementId, setActiveTextRequirementId] = useState<string | null>(null);
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const [showPhotoEvidencePreflight, setShowPhotoEvidencePreflight] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState<SubmissionFeedback | null>(null);
  const preflightResolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  useEffect(() => {
    if (!submissionFeedback) {
      return;
    }

    const timeout = setTimeout(() => {
      setSubmissionFeedback(null);
    }, 2500);

    return () => {
      clearTimeout(timeout);
    };
  }, [submissionFeedback]);

  function confirmPhotoEvidencePreflight(): Promise<boolean> {
    return new Promise((resolve) => {
      preflightResolveRef.current = resolve;
      setShowPhotoEvidencePreflight(true);
    });
  }

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => {
      try {
        return await getTask(taskId!, true);
      } catch (error) {
        if (!(error instanceof APIError) || error.code !== "NOT_FOUND" || !projectId || !taskId) {
          throw error;
        }

        const taskByIdentifier = await getTaskByIdentifier(projectId, taskId);
        queryClient.setQueryData(["task", taskByIdentifier.task.id], taskByIdentifier);
        return taskByIdentifier;
      }
    },
    enabled: !!taskId && !!projectId,
  });

  const ritualTaskId = taskQuery.data?.task?.taskKind === "ritual_instance" ? taskQuery.data.task.id : undefined;
  const ritualDefinitionId = taskQuery.data?.task?.taskKind === "ritual_instance"
    ? taskQuery.data.task.ritualDefinitionId
    : undefined;

  const statesQuery = useQuery({
    queryKey: ["projectStates", projectId],
    queryFn: () => listProjectStates(projectId!),
    enabled: !!projectId,
  });

  const ritualDefinitionQuery = useQuery({
    queryKey: ["ritual-definition", ritualDefinitionId],
    queryFn: () => getRitualDefinition(ritualDefinitionId!),
    enabled: !!ritualDefinitionId,
  });

  const evidenceSubmissionsQuery = useQuery({
    queryKey: ["evidence-submissions", ritualTaskId],
    queryFn: () => listEvidenceSubmissions(ritualTaskId!),
    enabled: !!ritualTaskId,
  });

  const permissionsQuery = useQuery({
    queryKey: ["employee-permissions", auth.employeeId],
    queryFn: () => getEmployeePermissions(auth.employeeId!),
    enabled: !!auth.employeeId,
    staleTime: 5 * 60 * 1000,
  });

  const profileQuery = useQuery({
    queryKey: ["profile", "canonical-link"],
    queryFn: () => getProfile(),
    enabled: auth.isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const stateMutation = useMutation({
    mutationFn: async (newStateId: string) => {
      await moveTask(taskId!, newStateId);
    },
    onSuccess: async () => {
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await invalidateTaskQueries(queryClient, { projectId, taskId });
    },
  });

  const inlineEvidenceMutation = useMutation({
    mutationFn: async (params: { requirementId: string; asset: Awaited<ReturnType<typeof pickEvidencePhoto>> }) => {
      if (!taskId) {
        throw new Error("Task not available.");
      }

      if (!params.asset) {
        throw new Error("No photo selected.");
      }

      const uploadedFileId = await uploadEvidenceAsset({
        taskId,
        evidenceRequirementId: params.requirementId,
        asset: params.asset,
      });

      const captureTime = new Date();
      const currentLocation = await requestCurrentLocationForEvidence();

      return submitEvidence({
        taskId,
        evidenceRequirementId: params.requirementId,
        evidenceType: "photo",
        fileId: uploadedFileId,
        deviceTimestamp: captureTime,
        gpsCoordinates: {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          accuracyMeters: currentLocation.coords.accuracy ?? 10,
        },
      });
    },
    onSuccess: async (result) => {
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["evidence-submissions", ritualTaskId] });
      if (ritualDefinitionId) {
        queryClient.invalidateQueries({ queryKey: ["ritual-definition", ritualDefinitionId] });
      }
      await invalidateTaskQueries(queryClient, { projectId, taskId });
      setSubmissionFeedback(getSubmissionFeedback("proof", result.approvalStatus));
    },
    onError: (error) => {
      Alert.alert("Could not send proof", error.message);
    },
  });

  const inlineTextEvidenceMutation = useMutation({
    mutationFn: async (params: { requirementId: string; textContent: string }) => {
      if (!taskId) {
        throw new Error("Task not available.");
      }

      return submitEvidence({
        taskId,
        evidenceRequirementId: params.requirementId,
        evidenceType: "text_note",
        textContent: params.textContent,
      });
    },
    onSuccess: async (result, variables) => {
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["evidence-submissions", ritualTaskId] });
      if (ritualDefinitionId) {
        queryClient.invalidateQueries({ queryKey: ["ritual-definition", ritualDefinitionId] });
      }
      await invalidateTaskQueries(queryClient, { projectId, taskId });

      setActiveTextRequirementId((current) => (current === variables.requirementId ? null : current));
      setSubmissionFeedback(getSubmissionFeedback("proof", result.approvalStatus));
    },
    onError: (error) => {
      Alert.alert("Could not send proof", error.message);
    },
  });

  const inlineGpsEvidenceMutation = useMutation({
    mutationFn: async (params: { requirementId: string; latitude: number; longitude: number }) => {
      if (!taskId) {
        throw new Error("Task not available.");
      }

      return submitEvidence({
        taskId,
        evidenceRequirementId: params.requirementId,
        evidenceType: "gps_checkin",
        gpsCoordinates: {
          latitude: params.latitude,
          longitude: params.longitude,
          accuracyMeters: 10,
        },
      });
    },
    onSuccess: async (result) => {
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["evidence-submissions", ritualTaskId] });
      if (ritualDefinitionId) {
        queryClient.invalidateQueries({ queryKey: ["ritual-definition", ritualDefinitionId] });
      }
      await invalidateTaskQueries(queryClient, { projectId, taskId });
      setSubmissionFeedback(getSubmissionFeedback("check-in", result.approvalStatus));
    },
    onError: (error) => {
      Alert.alert("Could not send check-in", error.message);
    },
  });

  const isLoading = taskQuery.isLoading || statesQuery.isLoading;
  const taskError = taskQuery.error;
  const isTaskNotFound = taskError instanceof APIError && taskError.code === "NOT_FOUND";

  const detail = taskQuery.data;
  const task = useMemo(() => normalizeTask(detail?.task), [detail?.task]);
  const currentState = useMemo(
    () => statesQuery.data?.states.find((state) => state.id === task?.stateId),
    [statesQuery.data?.states, task?.stateId],
  );
  const relevantStates = useMemo(() => {
    const allStates = statesQuery.data?.states ?? [];
    const desiredType = task?.taskKind === "ritual_instance" ? "ritual" : "standard";
    const sameTypeStates = allStates.filter((state) => state.stateType === desiredType);
    const pool = sameTypeStates.length > 0 ? sameTypeStates : allStates;
    return pool
      .filter((state) => state.id !== task?.stateId)
      .sort((left, right) => left.position - right.position);
  }, [statesQuery.data?.states, task?.stateId, task?.taskKind]);

  const ritualDefinition = ritualDefinitionQuery.data as RitualDefinition | undefined;
  const evidenceSubmissions = useMemo(
    () => (evidenceSubmissionsQuery.data ?? []).map(normalizeEvidenceSubmission),
    [evidenceSubmissionsQuery.data],
  );
  const evidenceRows = useMemo(() => {
    if (!task || task.taskKind !== "ritual_instance") {
      return [];
    }

    return buildRequirementRows(
      ritualDefinition?.evidenceRequirements ?? [],
      evidenceSubmissions,
      currentState,
    );
  }, [currentState, evidenceSubmissions, ritualDefinition?.evidenceRequirements, task]);

  const evidenceProgress = useMemo(
    () => (task ? deriveEvidenceProgress(task, ritualDefinition?.evidenceRequirements ?? [], evidenceRows) : undefined),
    [evidenceRows, ritualDefinition?.evidenceRequirements, task],
  );

  const canReviewEvidence = (permissionsQuery.data ?? []).includes("collab.reviewEvidence");
  const currentMembership = useMemo(
    () => profileQuery.data?.organizations.find((organization) => organization.organizationId === auth.organizationId)
      ?? profileQuery.data?.organizations[0],
    [auth.organizationId, profileQuery.data?.organizations],
  );
  const isAssignedToMe = !!task?.assignees.some((assignee) => assignee.employeeId === auth.employeeId);
  const pendingReviewCount = evidenceProgress?.pendingReviewCount ?? 0;
  const highlightedRequirementId = useMemo(() => {
    if (focusedRequirementId && evidenceRows.some((item) => item.requirement.id === focusedRequirementId)) {
      return focusedRequirementId;
    }

    if (focusIntent === "review_pending") {
      return evidenceRows.find((item) => item.status === "pending_review")?.requirement.id;
    }

    if (focusIntent === "submit_requirement") {
      return evidenceRows.find((item) => item.status === "rejected" || (item.requirement.isRequired && item.status === "missing"))?.requirement.id;
    }

    return undefined;
  }, [evidenceRows, focusIntent, focusedRequirementId]);

  const handleRefresh = async () => {
    const refreshes: Array<Promise<unknown>> = [
      taskQuery.refetch(),
      statesQuery.refetch(),
      permissionsQuery.refetch(),
    ];

    if (ritualDefinitionId) {
      refreshes.push(ritualDefinitionQuery.refetch());
    }

    if (ritualTaskId) {
      refreshes.push(evidenceSubmissionsQuery.refetch());
    }

    await Promise.allSettled(refreshes);
  };

  const showLocationPermissionRecoveryAlert = (canAskAgain: boolean) => {
    const message = "Location access is needed to verify check-in.";

    if (canAskAgain) {
      Alert.alert("Permission Required", message);
      return;
    }

    Alert.alert("Permission Required", `${message} Please enable it in Settings.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Open Settings",
        onPress: () => {
          void Linking.openSettings();
        },
      },
    ]);
  };

  const handleGpsRequirementAction = async (requirementId: string) => {
    try {
      const currentLocation = await requestCurrentLocationForEvidence();
      await inlineGpsEvidenceMutation.mutateAsync({
        requirementId,
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Location access is needed to verify check-in.";
      const canAskAgain = !message.includes("Settings");
      showLocationPermissionRecoveryAlert(canAskAgain);
    }
  };

  const handleRequirementAction = async (item: RequirementRowItem) => {
    if (shouldUseDirectPhotoAction(item)) {
      setSubmittingRequirementId(item.requirement.id);
      try {
        const confirmed = await confirmPhotoEvidencePreflight();
        if (!confirmed) {
          return;
        }

        await ensureLocationPermissionForEvidence();
        const hasCameraPermission = await ensureEvidenceCameraPermission();
        if (!hasCameraPermission) {
          return;
        }

        const photoAsset = await pickEvidencePhoto();
        if (!photoAsset) {
          return;
        }

        await inlineEvidenceMutation.mutateAsync({
          requirementId: item.requirement.id,
          asset: photoAsset,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Camera and location access are needed to send this proof.";
        Alert.alert("Could not start proof", message);
      } finally {
        setSubmittingRequirementId((current) => (current === item.requirement.id ? null : current));
      }

      return;
    }

    if (item.canSubmit && isSingleEvidenceType(item.requirement, "text_note")) {
      setActiveTextRequirementId(item.requirement.id);
      setTextDrafts((current) => ({
        ...current,
        [item.requirement.id]: current[item.requirement.id] ?? "",
      }));
      return;
    }

    if (item.canSubmit && isSingleEvidenceType(item.requirement, "gps_checkin")) {
      setSubmittingRequirementId(item.requirement.id);
      try {
        await handleGpsRequirementAction(item.requirement.id);
      } catch (error) {
        Alert.alert("Could not send check-in", error instanceof Error ? error.message : "Try again in a moment.");
      } finally {
        setSubmittingRequirementId((current) => (current === item.requirement.id ? null : current));
      }
      return;
    }

    Alert.alert("Use web for this proof type", "This proof type is not supported on mobile yet. Open the task in the web app if you need a different submission flow.");
  };

  const handleOpenDiscussion = () => {
    if (!task?.channelId || !projectId || !taskId) {
      return;
    }

    void Haptics.selectionAsync();
    router.push(
      withNavigationContext(`/(app)/(chat)/${task.channelId}`, {
        fallbackHref: "/(app)/(tasks)",
        ownerTab: "tasks",
        backLabel: "Task",
      }) as never,
    );
  };

  const handleCopyCanonicalLink = async () => {
    if (!task) {
      return;
    }

    if (!currentMembership?.organizationSubdomain) {
      Alert.alert("Link unavailable", "Your current organization subdomain is unavailable.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/linking/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: {
            tenantKey: currentMembership.organizationSubdomain,
            resourceType: "task",
            resourceId: task.id,
            focusIntent,
            requirementId: focusedRequirementId,
            entryContext,
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as { canonicalUrl?: string; error?: string } | null;
      if (!response.ok || !payload?.canonicalUrl) {
        throw new Error(payload?.error ?? "Failed to generate a canonical link.");
      }

      await Share.share({ message: payload.canonicalUrl, url: payload.canonicalUrl });
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert("Link ready", "Canonical link opened in the share sheet.");
    } catch (error) {
      Alert.alert(
        "Copy failed",
        error instanceof Error ? error.message : "Failed to copy canonical link.",
      );
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={lightPalette.primary.main} />
      </View>
    );
  }

  if (taskQuery.isError) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Task" }} />
        <EmptyState
          sfSymbol={isTaskNotFound ? "tray" : "wifi.exclamationmark"}
          title={isTaskNotFound ? "Task not found" : "Unable to load task"}
          subtitle={
            isTaskNotFound
              ? "The task may have been removed or you may no longer have access to it."
              : taskError instanceof Error
                ? taskError.message
                : "Try again in a moment."
          }
        />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: "Task" }} />
        <EmptyState
          sfSymbol="tray"
          title="Task not found"
          subtitle="The task may have been removed or you may no longer have access to it."
        />
      </View>
    );
  }

  const stateTone = getStateTone(currentState);
  const stateColors = getToneColors(stateTone);
  const scheduleDate = task.taskKind === "ritual_instance" ? parseDateOnly(task.scheduledDate) : parseDateOnly(task.dueDate);
  const dueLabel = task.taskKind === "ritual_instance"
    ? formatRelativeDate(task.completionDeadline ?? scheduleDate)
    : formatRelativeDate(scheduleDate);
  const heroTimingLabel = buildHeroTimingLabel(dueLabel);
  const assigneeSummary = formatAssigneeSummary(task, isAssignedToMe);
  const commentSummary = formatCommentSummary(task.commentCount);
  const shouldShowStandardActions = task.taskKind === "standard" && relevantStates.length > 0 && !currentState?.isClosed;
  const taskContextMessage = task.taskKind === "ritual_instance"
    ? buildTaskContextMessage({
        entryContext,
        focusIntent,
        focusedRequirementId,
        isAssignedToMe,
        canReviewEvidence,
        pendingReviewCount,
      })
    : null;
  const taskDetailsCard = (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Task details</Text>
      {task.taskKind === "ritual_instance" ? (
        <>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Scheduled for</Text>
            <Text style={styles.infoValue}>{formatAbsoluteDate(scheduleDate) ?? "No schedule"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Deadline</Text>
            <Text style={styles.infoValue}>{formatAbsoluteDateTime(task.completionDeadline) ?? "No deadline"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Team</Text>
            <Text style={styles.infoValue}>{assigneeSummary}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Discussion</Text>
            <Text style={styles.infoValue}>{commentSummary}</Text>
          </View>
          {ritualDefinitionId ? (
            <Pressable
              onPress={() => router.push(`/(app)/(tasks)/rituals/${ritualDefinitionId}`)}
              style={({ pressed }) => [styles.templateLinkButton, pressed && styles.templateLinkButtonPressed]}
            >
              <Text style={styles.templateLinkButtonText}>Open ritual template</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              void handleCopyCanonicalLink();
            }}
            style={({ pressed }) => [styles.templateLinkButton, pressed ? styles.templateLinkButtonPressed : undefined]}
            testID="task-copy-canonical-link"
          >
            <View style={styles.templateLinkButtonContent}>
              <SFIcon name="square.and.arrow.up" size={14} color={lightPalette.info.main} />
              <Text style={styles.templateLinkButtonText}>Share task link</Text>
            </View>
          </Pressable>
          {task.detachedFromRitual ? (
            <View style={styles.noteCard}>
              <Text style={styles.noteLabel}>Detached ritual</Text>
              <Text style={styles.noteText}>This run is stored separately from future template changes.</Text>
            </View>
          ) : null}
          {task.skipReason ? (
            <View style={styles.noteCard}>
              <Text style={styles.noteLabel}>Skip reason</Text>
              <Text style={styles.noteText}>{task.skipReason}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Due date</Text>
            <Text style={styles.infoValue}>{formatAbsoluteDate(scheduleDate) ?? "No date"}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Team</Text>
            <Text style={styles.infoValue}>{assigneeSummary}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Discussion</Text>
            <Text style={styles.infoValue}>{commentSummary}</Text>
          </View>
          <Pressable
            onPress={() => {
              void handleCopyCanonicalLink();
            }}
            style={({ pressed }) => [styles.templateLinkButton, pressed ? styles.templateLinkButtonPressed : undefined]}
            testID="task-copy-canonical-link"
          >
            <View style={styles.templateLinkButtonContent}>
              <SFIcon name="square.and.arrow.up" size={14} color={lightPalette.info.main} />
              <Text style={styles.templateLinkButtonText}>Share task link</Text>
            </View>
          </Pressable>
        </>
      )}
      {task.descriptionDocumentId ? (
        <View style={styles.noteCard}>
          <Text style={styles.noteLabel}>Linked note</Text>
          <Text style={styles.noteText}>A linked document exists. Open it on web.</Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: task.identifier }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={taskQuery.isRefetching} onRefresh={handleRefresh} />}
      >
        {submissionFeedback ? (
          <View style={styles.successBanner}>
            <View style={styles.successBannerIconWrap}>
              <SFIcon name="checkmark.circle.fill" size={18} color={lightPalette.success.main} />
            </View>
            <View style={styles.successBannerCopy}>
              <Text style={styles.successBannerTitle}>{submissionFeedback.title}</Text>
              <Text style={styles.successBannerText}>{submissionFeedback.message}</Text>
            </View>
          </View>
        ) : null}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={[styles.badge, { backgroundColor: stateColors.background }]}> 
              <Text style={[styles.badgeText, { color: getStateAccentColor(currentState) }]}>
                {currentState?.name ?? "Active"}
              </Text>
            </View>
            <View style={styles.kindBadge}>
              <Text style={styles.kindBadgeText}>{task.taskKind === "ritual_instance" ? "Ritual" : "Standard"}</Text>
            </View>
          </View>

          <Text style={styles.heroTitle}>
            <Text style={styles.heroIdentifierInline}>{task.identifier}</Text>
            {" "}
            {task.title}
          </Text>
          <Text style={styles.heroSummary}>{buildHeroSummary(task, currentState)}</Text>

          <View style={styles.heroMetaRow}>
            <View style={styles.heroMetaItem}>
              <SFIcon name={task.taskKind === "ritual_instance" ? "calendar.badge.clock" : "calendar"} size={14} color={lightPalette.text.secondary} />
              <Text style={styles.heroMetaText}>{heroTimingLabel}</Text>
            </View>
            {task.assignees.length > 0 ? (
              <View style={styles.heroMetaItem}>
                <SFIcon
                  name={isAssignedToMe ? "person.crop.circle.badge.checkmark" : "person.2"}
                  size={14}
                  color={isAssignedToMe ? lightPalette.success.main : lightPalette.text.secondary}
                />
                <Text style={styles.heroMetaText}>{assigneeSummary}</Text>
              </View>
            ) : null}
            {task.taskKind === "ritual_instance" && evidenceProgress ? (
              <View style={styles.heroMetaItem}>
                <SFIcon name="checklist" size={14} color={lightPalette.text.secondary} />
                <Text style={styles.heroMetaText}>
                  {evidenceProgress.allRequiredApproved
                    ? "Proof ready"
                    : `${Math.max(evidenceProgress.requiredCount - evidenceProgress.approvedCount, 0)} proof left`}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {taskContextMessage ? (
          <View
            style={[
              styles.contextCard,
              { backgroundColor: getToneColors(taskContextMessage.tone).background },
            ]}
          >
            <Text
              style={[
                styles.contextCardTitle,
                { color: getToneColors(taskContextMessage.tone).text },
              ]}
            >
              {taskContextMessage.title}
            </Text>
            <Text style={styles.contextCardText}>{taskContextMessage.message}</Text>
          </View>
        ) : null}

        {shouldShowStandardActions ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Report progress</Text>
            <Text style={styles.cardSubtitle}>Use this only when the real work status has changed.</Text>
            <View style={styles.actionWrap}>
              {relevantStates.map((state) => (
                <Pressable
                  key={state.id}
                  onPress={() => stateMutation.mutate(state.id)}
                  disabled={stateMutation.isPending}
                  style={({ pressed }) => [
                    styles.stateActionButton,
                    { borderColor: getStateAccentColor(state) },
                    pressed && styles.stateActionButtonPressed,
                    stateMutation.isPending && styles.stateActionButtonDisabled,
                  ]}
                >
                  <Text style={[styles.stateActionText, { color: getStateAccentColor(state) }]}>{state.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {task.taskKind !== "ritual_instance" ? taskDetailsCard : null}

        {task.taskKind === "ritual_instance" ? (
          <View style={styles.card} testID="ritual-evidence-section">
            <View style={styles.cardHeaderRow}>
              <View>
                <Text style={styles.cardTitle}>Proof checklist</Text>
                <Text style={styles.cardSubtitle}>
                  {canReviewEvidence && pendingReviewCount > 0
                    ? "Review each step below."
                    : "Finish each step below."}
                </Text>
              </View>
              {evidenceProgress ? (
                <View style={[styles.badge, { backgroundColor: evidenceProgress.allRequiredApproved ? statusColors.success.light.bg : "#f4f6f8" }]}> 
                  <Text style={[styles.badgeText, { color: evidenceProgress.allRequiredApproved ? statusColors.success.light.text : lightPalette.text.secondary }]}>
                    {evidenceProgress.allRequiredApproved ? "Ready" : `${evidenceProgress.requiredCount - evidenceProgress.approvedCount} left`}
                  </Text>
                </View>
              ) : null}
            </View>

            {evidenceProgress ? (
              <View style={styles.proofSummaryRow}>
                <View style={[styles.compactStatChip, styles.compactStatChipInfo]}>
                  <Text style={styles.compactStatValue}>{evidenceProgress.submittedCount}</Text>
                  <Text style={styles.compactStatLabel}>submitted</Text>
                </View>
                <View style={[styles.compactStatChip, styles.compactStatChipWarning]}>
                  <Text style={styles.compactStatValue}>{evidenceProgress.pendingReviewCount}</Text>
                  <Text style={styles.compactStatLabel}>waiting</Text>
                </View>
                <View
                  style={[
                    styles.compactStatChip,
                    evidenceProgress.rejectedCount > 0 ? styles.compactStatChipDanger : undefined,
                  ]}
                >
                  <Text style={styles.compactStatValue}>{evidenceProgress.rejectedCount}</Text>
                  <Text style={styles.compactStatLabel}>rejected</Text>
                </View>
              </View>
            ) : null}

            {evidenceRows.length === 0 ? (
              <View style={styles.emptyInlineState}>
                <Text style={styles.emptyInlineTitle}>No proof requirements</Text>
                <Text style={styles.emptyInlineText}>This ritual has no evidence requirements configured yet.</Text>
              </View>
            ) : (
              evidenceRows.map((item, index) => (
                <View key={item.requirement.id} style={index > 0 ? styles.requirementSpacing : undefined}>
                  <EvidenceRequirementCard
                    item={item}
                    onAction={() => void handleRequirementAction(item)}
                    canReview={canReviewEvidence}
                    isSubmitting={submittingRequirementId === item.requirement.id}
                    highlighted={highlightedRequirementId === item.requirement.id}
                    showTextComposer={activeTextRequirementId === item.requirement.id}
                    textDraft={textDrafts[item.requirement.id] ?? ""}
                    onChangeTextDraft={(value) => {
                      setTextDrafts((current) => ({ ...current, [item.requirement.id]: value }));
                    }}
                    onCancelText={() => setActiveTextRequirementId((current) => (current === item.requirement.id ? null : current))}
                    onSubmitText={() => {
                      const textContent = (textDrafts[item.requirement.id] ?? "").trim();
                      if (!textContent) {
                        return;
                      }

                      setSubmittingRequirementId(item.requirement.id);
                      void inlineTextEvidenceMutation
                        .mutateAsync({ requirementId: item.requirement.id, textContent })
                        .finally(() => {
                          setSubmittingRequirementId((current) => (current === item.requirement.id ? null : current));
                        });
                    }}
                  />
                </View>
              ))
            )}
          </View>
        ) : null}

        {task.taskKind === "ritual_instance" ? taskDetailsCard : null}

        {task.channelId ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Discussion</Text>
            <Text style={styles.cardSubtitle}>Open the task conversation for updates, questions, and review notes.</Text>
            <Pressable
              onPress={handleOpenDiscussion}
              style={({ pressed }) => [styles.discussionButton, pressed && styles.discussionButtonPressed]}
            >
              <View style={styles.discussionButtonContent}>
                <SFIcon name="bubble.left.and.bubble.right.fill" size={16} color={lightPalette.info.main} />
                <Text style={styles.discussionButtonText}>{`Open discussion (${task.commentCount} comments)`}</Text>
              </View>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      <PhotoEvidencePreflightSheet
        visible={showPhotoEvidencePreflight}
        onConfirm={() => {
          setShowPhotoEvidencePreflight(false);
          preflightResolveRef.current?.(true);
          preflightResolveRef.current = null;
        }}
        onCancel={() => {
          setShowPhotoEvidencePreflight(false);
          preflightResolveRef.current?.(false);
          preflightResolveRef.current = null;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: lightPalette.background.default,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.default,
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
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  badge: {
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[0.5],
    borderRadius: 999,
  },
  badgeText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
  },
  kindBadge: {
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[0.5],
    borderRadius: 999,
    backgroundColor: "#f2f5f8",
  },
  kindBadgeText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  heroIdentifierInline: {
    fontSize: 18,
    lineHeight: 32,
    fontWeight: "800" as const,
    color: lightPalette.text.secondary,
  },
  heroSummary: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 20,
    color: lightPalette.text.secondary,
  },
  secondaryActionButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[0.5],
    borderRadius: radius.md,
    backgroundColor: "#eef6ff",
  },
  heroLinkButtonPressed: {
    opacity: 0.85,
  },
  secondaryActionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
  },
  heroMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[0.5],
    paddingTop: spacing[0.5],
  },
  heroMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
    borderRadius: radius.sm,
    backgroundColor: "#f6f8fa",
  },
  heroMetaText: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  card: {
    padding: mobileLayout.cardPadding,
    borderRadius: radius.lg,
    backgroundColor: lightPalette.background.paper,
    gap: spacing[1.5],
    ...shadows.sm,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  cardTitle: {
    fontSize: mobileTypography.sectionHeader.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  cardSubtitle: {
    marginTop: 2,
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  infoLabel: {
    flex: 0.42,
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  infoValue: {
    flex: 0.58,
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 21,
    textAlign: "right",
    color: lightPalette.text.primary,
  },
  noteCard: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    gap: spacing[0.5],
  },
  noteLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  noteText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 21,
    color: lightPalette.text.primary,
  },
  templateLinkButton: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    backgroundColor: "#eef6ff",
  },
  templateLinkButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
  },
  templateLinkButtonPressed: {
    opacity: 0.85,
  },
  templateLinkButtonText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.info.main,
  },
  contextCard: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    gap: spacing[0.5],
  },
  contextCardTitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700" as const,
  },
  contextCardText: {
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: 18,
    color: lightPalette.text.secondary,
  },
  proofSummaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[0.5],
  },
  compactStatChip: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing[0.5],
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
    borderRadius: radius.md,
    backgroundColor: "#f4f6f8",
  },
  compactStatChipInfo: {
    backgroundColor: "#edf6ff",
  },
  compactStatChipWarning: {
    backgroundColor: statusColors.warning.light.bg,
  },
  compactStatChipDanger: {
    backgroundColor: statusColors.error.light.bg,
  },
  compactStatValue: {
    fontSize: 16,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
    fontVariant: ["tabular-nums"],
  },
  compactStatLabel: {
    fontSize: 12,
    color: lightPalette.text.secondary,
  },
  requirementSpacing: {
    marginTop: spacing[1],
  },
  requirementCard: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: lightPalette.divider,
    gap: spacing[1],
  },
  requirementHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  requirementTitleWrap: {
    flex: 1,
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
  requirementBody: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 21,
    color: lightPalette.text.primary,
  },
  statusChip: {
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
    borderRadius: 999,
  },
  statusChipText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
  },
  requirementMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1],
  },
  metaMiniChip: {
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
    borderRadius: 999,
    backgroundColor: "#f4f6f8",
  },
  metaMiniChipText: {
    fontSize: 12,
    color: lightPalette.text.secondary,
    fontWeight: "600" as const,
  },
  requirementHelperRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[1],
  },
  requirementHelperText: {
    flex: 1,
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: 18,
  },
  requirementActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[1],
  },
  submissionCard: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    gap: spacing[1],
  },
  submissionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  submissionLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  submissionTimestamp: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  submissionPreviewText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 21,
    color: lightPalette.text.primary,
  },
  submissionActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[0.5],
  },
  submissionLinkButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    backgroundColor: "#eef6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  submissionLinkButtonPressed: {
    opacity: 0.85,
  },
  submissionActionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
    minHeight: 34,
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
    borderRadius: 999,
    backgroundColor: "#eef6ff",
  },
  submissionLinkButtonText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.info.main,
  },
  reviewUrgentCard: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    backgroundColor: statusColors.warning.light.bg,
    gap: spacing[1],
  },
  reviewUrgentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  reviewUrgentTitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  reviewUrgentText: {
    fontSize: mobileTypography.caption.fontSize as number,
    lineHeight: 18,
    color: lightPalette.text.secondary,
  },
  primaryActionButton: {
    minHeight: 42,
    paddingHorizontal: spacing[1.5],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: lightPalette.primary.main,
  },
  primaryActionButtonPressed: {
    opacity: 0.85,
  },
  primaryActionButtonDisabled: {
    opacity: 0.7,
  },
  primaryActionButtonText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.primary.contrastText,
  },
  requirementDeadlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
  },
  requirementDeadlineText: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  inlineComposerCard: {
    padding: spacing[1.5],
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    gap: spacing[1],
  },
  inlineComposerLabel: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  inlineComposerInput: {
    minHeight: 92,
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: lightPalette.divider,
    backgroundColor: lightPalette.background.paper,
    fontSize: mobileTypography.listSecondary.fontSize as number,
    lineHeight: 21,
    color: lightPalette.text.primary,
  },
  inlineComposerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing[1],
  },
  secondaryInlineButton: {
    minHeight: 40,
    paddingHorizontal: spacing[1.5],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: lightPalette.background.paper,
  },
  secondaryInlineButtonPressed: {
    opacity: 0.85,
  },
  secondaryInlineButtonText: {
    fontSize: mobileTypography.caption.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.secondary,
  },
  primaryInlineButton: {
    minHeight: 40,
    paddingHorizontal: spacing[1.5],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: lightPalette.primary.main,
  },
  primaryInlineButtonPressed: {
    opacity: 0.85,
  },
  reviewerNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[0.5],
    flex: 1,
  },
  reviewerNoticeText: {
    fontSize: mobileTypography.caption.fontSize as number,
    color: lightPalette.text.secondary,
  },
  imagePreviewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.64)",
    justifyContent: "center",
    padding: spacing[2],
  },
  imagePreviewDismissArea: {
    ...StyleSheet.absoluteFillObject,
  },
  imagePreviewCard: {
    borderRadius: radius.lg,
    backgroundColor: lightPalette.background.paper,
    padding: spacing[1.5],
    gap: spacing[1],
  },
  imagePreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
  },
  imagePreviewTitle: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  imagePreviewCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f6f8",
  },
  imagePreviewCloseButtonPressed: {
    opacity: 0.75,
  },
  imagePreview: {
    width: "100%",
    minHeight: 280,
    maxHeight: 420,
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
  },
  actionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1],
  },
  stateActionButton: {
    minWidth: "48%",
    flexGrow: 1,
    minHeight: 42,
    paddingHorizontal: spacing[1.5],
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.background.paper,
  },
  stateActionButtonPressed: {
    backgroundColor: "#f8fafc",
  },
  stateActionButtonDisabled: {
    opacity: 0.5,
  },
  stateActionText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700" as const,
  },
  discussionButton: {
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[1.5],
    borderRadius: radius.md,
    backgroundColor: "#eef6ff",
  },
  discussionButtonPressed: {
    opacity: 0.85,
  },
  discussionButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  discussionButtonText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.info.main,
  },
  emptyInlineState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing[2],
    gap: spacing[0.5],
  },
  emptyInlineTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "700" as const,
    color: lightPalette.text.primary,
  },
  emptyInlineText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    textAlign: "center",
    color: lightPalette.text.secondary,
  },
  successBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[1.5],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    backgroundColor: "#f0fdf4",
  },
  successBannerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#dcfce7",
    flexShrink: 0,
  },
  successBannerCopy: {
    flex: 1,
    gap: spacing[0.5],
  },
  successBannerTitle: {
    fontSize: mobileTypography.listPrimary.fontSize as number,
    fontWeight: "700" as const,
    color: "#166534",
  },
  successBannerText: {
    fontSize: mobileTypography.listSecondary.fontSize as number,
    color: "#166534",
    lineHeight: 18,
  },
});
