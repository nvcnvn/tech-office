/**
 * CreateTaskSheet — turn a chat message into a task from the conversation.
 *
 * Feature: 038-chat-task-quick-action
 *
 * This is a purpose-built bottom sheet, not a port of the web dialog. On a phone the
 * whole point is that capturing a piece of work costs a long-press and a couple of taps,
 * so the fields are stacked in thumb order, the project list is tappable rows rather than
 * a dropdown, and the confirm button sits at the bottom where the thumb already is.
 *
 * Four inputs and no more: title, project, assignee, due date. Anything else a task can
 * carry belongs in the full task form.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTaskFromMessage,
  listProjectMembers,
  channelDestinationUnsetExplanation,
  getChannelTaskDestination,
  listProjects,
  type Task,
} from "apis";
import * as Haptics from "expo-haptics";

import { SFIcon } from "@/components/ui/sf-icon";
import { invalidateTaskQueries } from "@/lib/task-query-invalidation";
import {
  border,
  lightPalette,
  mobileTypography,
  radius,
  spacing,
} from "@tech-office/theme-tokens";

/** Where a derived title is cut. Mirrors MaxTaskTitleLength on the server. */
const MAX_TITLE_LENGTH = 120;

/**
 * Derive the title the sheet opens with from a message body.
 *
 * The body is sanitized HTML, so formatting is stripped to plain text, runs of whitespace
 * collapse, and a long message is cut at a word boundary rather than mid-word. An
 * attachment-only or empty message yields an empty string, which is not an error: the
 * sheet simply opens with an empty title to fill in.
 */
export function titleFromMessageText(body: string): string {
  const text = body
    // Tags become spaces rather than vanishing, so <p>a</p><p>b</p> reads "a b", not "ab".
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // Spread rather than slice, so a multibyte character is never cut in half.
  const chars = [...text];
  if (chars.length <= MAX_TITLE_LENGTH) return text;

  const cut = chars.slice(0, MAX_TITLE_LENGTH).join("");
  const boundary = cut.lastIndexOf(" ");
  // A first word longer than the whole limit leaves no boundary to fall back to.
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
}

interface CreateTaskSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The channel the source message was posted in. */
  channelId: string;
  /** The message being turned into a task. */
  messageId: string;
  /** Message body, used to pre-fill the title. */
  messageText: string;
  /**
   * Employees the source message mentions. Exactly one is pre-selected as assignee; zero
   * or several leave it empty, because guessing among several would be wrong as often as
   * right.
   */
  mentionedEmployeeIds?: string[];
  onCreated?: (task: Task) => void;
}

export function CreateTaskSheet({
  visible,
  onClose,
  channelId,
  messageId,
  messageText,
  mentionedEmployeeIds = [],
  onCreated,
}: CreateTaskSheetProps) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // The channel's remembered destination. Collapsed to one line when it is usable, so a
  // second conversion in the same channel is a title and a tap. Mobile can override it
  // for one task but never sets it — configuring a channel is web-only (Principle XIII).
  const [projectListExpanded, setProjectListExpanded] = useState(true);
  const [destinationReason, setDestinationReason] = useState<string | undefined>();

  const derivedTitle = useMemo(() => titleFromMessageText(messageText), [messageText]);

  // Reset each time the sheet opens, so reopening on another message never shows a
  // leftover draft from the previous one.
  useEffect(() => {
    if (!visible) return;
    setTitle(derivedTitle);
    setProjectId(null);
    setDueDate("");
    setTitleError(null);
    setFormError(null);
    setProjectListExpanded(true);
    setDestinationReason(undefined);
    setAssigneeId(mentionedEmployeeIds.length === 1 ? mentionedEmployeeIds[0] : null);
  }, [visible, derivedTitle, mentionedEmployeeIds]);

  const { data: projectsData, isLoading: projectsLoading } = useQuery({
    queryKey: ["projects", "for-task-capture"],
    queryFn: () => listProjects({ includeArchived: false }),
    enabled: visible,
  });

  // Assignee options follow the chosen project: you can only assign work to someone who
  // is on the project it lands in.
  const { data: membersData } = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => listProjectMembers(projectId!),
    enabled: visible && !!projectId,
  });

  const projects = useMemo(
    () => (projectsData?.projects ?? []).filter((p) => !p.isArchived),
    [projectsData],
  );
  const members = membersData?.members ?? [];

  // What this channel remembers, resolved server-side against what this caller can
  // actually use — so an archived or unreachable project comes back unset with a reason
  // rather than pre-filling something the server would refuse.
  useEffect(() => {
    if (!visible || projects.length === 0) return;
    let cancelled = false;
    getChannelTaskDestination(channelId)
      .then((dest) => {
        if (cancelled) return;
        if (dest.isSet && projects.some((p) => p.id === dest.projectId)) {
          setProjectId(dest.projectId);
          setProjectListExpanded(false);
          return;
        }
        setDestinationReason(channelDestinationUnsetExplanation(dest.unsetReason));
        setProjectListExpanded(true);
      })
      .catch(() => {
        // A destination we cannot read is the same as none: the list stays open.
        if (!cancelled) setProjectListExpanded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, channelId, projects]);

  const rememberedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Choose a project for this task");
      return createTaskFromMessage({
        sourceChannelId: channelId,
        sourceMessageId: messageId,
        projectId,
        title: title.trim(),
        assigneeEmployeeId: assigneeId ?? undefined,
        dueDate: dueDate.trim() || undefined,
      });
    },
    onSuccess: async (resp) => {
      if (Platform.OS === "ios") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await invalidateTaskQueries(queryClient, { projectId: projectId ?? undefined });
      onCreated?.(resp.task);
      onClose();
    },
    onError: (err: unknown) => {
      // The sheet stays open with everything already entered. A failed conversion should
      // cost a retry, not the typing.
      setFormError(err instanceof Error ? err.message : "Could not create the task. Try again.");
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      setTitleError("Give the task a title");
      return;
    }
    if (!projectId) {
      setFormError("Choose a project for this task");
      setProjectListExpanded(true);
      return;
    }
    setTitleError(null);
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet} testID="create-task-sheet">
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Create task</Text>
          <Text style={styles.sheetSubtitle}>
            Creates an ordinary task and leaves a note on this message.
          </Text>

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {formError ? (
              <View style={styles.errorBanner} testID="create-task-sheet-error">
                <Text style={styles.errorText}>{formError}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Title</Text>
            <TextInput
              value={title}
              onChangeText={(next) => {
                setTitle(next);
                if (titleError) setTitleError(null);
              }}
              style={[styles.input, titleError ? styles.inputError : null]}
              placeholder="What needs doing?"
              placeholderTextColor={lightPalette.text.secondary}
              autoFocus
              selectTextOnFocus
              testID="create-task-sheet-title"
            />
            {titleError ? <Text style={styles.fieldError}>{titleError}</Text> : null}

            <Text style={styles.label}>Project</Text>
            {projectsLoading ? (
              <ActivityIndicator style={styles.loader} />
            ) : !projectListExpanded && rememberedProject ? (
              <Pressable
                onPress={() => setProjectListExpanded(true)}
                style={({ pressed }) => [styles.optionRow, styles.optionRowSelected, pressed && styles.optionRowPressed]}
                testID="create-task-sheet-project-collapsed"
                accessibilityRole="button"
                accessibilityLabel={`Project ${rememberedProject.key}, tap to change`}
              >
                <Text style={styles.optionKey}>{rememberedProject.key}</Text>
                <Text style={styles.optionLabel} numberOfLines={1}>
                  {rememberedProject.name}
                </Text>
                <Text style={styles.hint}>Change</Text>
              </Pressable>
            ) : (
              <View style={styles.optionList}>
                {projects.map((project) => {
                  const selected = project.id === projectId;
                  return (
                    <Pressable
                      key={project.id}
                      onPress={() => {
                        setProjectId(project.id);
                        // The previous project's members no longer apply.
                        setAssigneeId(null);
                        if (formError) setFormError(null);
                      }}
                      style={({ pressed }) => [
                        styles.optionRow,
                        selected && styles.optionRowSelected,
                        pressed && styles.optionRowPressed,
                      ]}
                      testID={`create-task-sheet-project-${project.id}`}
                    >
                      <Text style={styles.optionKey}>{project.key}</Text>
                      <Text style={styles.optionLabel} numberOfLines={1}>
                        {project.name}
                      </Text>
                      {selected ? (
                        <SFIcon name="checkmark" size={14} color={lightPalette.primary.main} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
            {projectListExpanded && destinationReason ? (
              <Text style={styles.hint} testID="create-task-sheet-destination-reason">
                {destinationReason}
              </Text>
            ) : null}

            <Text style={styles.label}>Assignee</Text>
            {!projectId ? (
              <Text style={styles.hint}>Choose a project first.</Text>
            ) : members.length === 0 ? (
              <Text style={styles.hint}>No one else is on this project yet.</Text>
            ) : (
              <View style={styles.optionList}>
                {members.map((member) => {
                  const selected = member.employeeId === assigneeId;
                  return (
                    <Pressable
                      key={member.employeeId}
                      onPress={() => setAssigneeId(selected ? null : member.employeeId)}
                      style={({ pressed }) => [
                        styles.optionRow,
                        selected && styles.optionRowSelected,
                        pressed && styles.optionRowPressed,
                      ]}
                      testID={`create-task-sheet-assignee-${member.employeeId}`}
                    >
                      <Text style={styles.optionLabel} numberOfLines={1}>
                        {member.employeeId}
                      </Text>
                      {selected ? (
                        <SFIcon name="checkmark" size={14} color={lightPalette.primary.main} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Text style={styles.label}>Due date</Text>
            <TextInput
              value={dueDate}
              onChangeText={setDueDate}
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={lightPalette.text.secondary}
              autoCapitalize="none"
              autoCorrect={false}
              testID="create-task-sheet-due-date"
            />
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              disabled={createMutation.isPending}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              testID="create-task-sheet-cancel"
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSubmit}
              disabled={createMutation.isPending}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              testID="create-task-sheet-submit"
            >
              {createMutation.isPending ? (
                <ActivityIndicator color={lightPalette.primary.contrastText} />
              ) : (
                <Text style={styles.primaryButtonText}>Create task</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    backgroundColor: lightPalette.background.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[1],
    paddingBottom: spacing[4],
    // Capped so the sheet never covers the whole screen on a small phone: the
    // conversation staying partly visible is what makes this feel in-place.
    maxHeight: "85%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: lightPalette.divider,
    marginBottom: spacing[1],
  },
  sheetTitle: {
    ...mobileTypography.sectionHeader,
    color: lightPalette.text.primary,
  },
  sheetSubtitle: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
    marginBottom: spacing[2],
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: spacing[2],
  },
  label: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
    marginTop: spacing[2],
    marginBottom: spacing[0.5],
  },
  input: {
    ...mobileTypography.messageBody,
    color: lightPalette.text.primary,
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    backgroundColor: lightPalette.background.default,
  },
  inputError: {
    borderColor: lightPalette.error.main,
  },
  fieldError: {
    ...mobileTypography.caption,
    color: lightPalette.error.main,
    marginTop: spacing[0.5],
  },
  hint: {
    ...mobileTypography.listSecondary,
    color: lightPalette.text.secondary,
  },
  loader: {
    alignSelf: "flex-start",
    marginVertical: spacing[1],
  },
  optionList: {
    borderWidth: border.thin,
    borderColor: lightPalette.divider,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    // Tall enough to be a comfortable target on a small phone.
    paddingVertical: spacing[1.5],
    borderBottomWidth: border.thin,
    borderBottomColor: lightPalette.divider,
  },
  optionRowSelected: {
    backgroundColor: lightPalette.background.default,
  },
  optionRowPressed: {
    opacity: 0.7,
  },
  optionKey: {
    ...mobileTypography.caption,
    color: lightPalette.text.secondary,
  },
  optionLabel: {
    ...mobileTypography.messageBody,
    color: lightPalette.text.primary,
    flex: 1,
  },
  errorBanner: {
    backgroundColor: lightPalette.background.default,
    borderLeftWidth: 3,
    borderLeftColor: lightPalette.error.main,
    borderRadius: radius.sm,
    padding: spacing[1],
  },
  errorText: {
    ...mobileTypography.listSecondary,
    color: lightPalette.error.main,
  },
  footer: {
    flexDirection: "row",
    gap: spacing[1],
    marginTop: spacing[2],
  },
  primaryButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: lightPalette.primary.main,
    borderRadius: radius.md,
    paddingVertical: spacing[2],
  },
  primaryButtonText: {
    ...mobileTypography.button,
    color: lightPalette.primary.contrastText,
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  secondaryButtonText: {
    ...mobileTypography.button,
    color: lightPalette.text.secondary,
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
