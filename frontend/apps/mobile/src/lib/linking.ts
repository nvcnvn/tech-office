/**
 * Deep linking configuration — T2.8
 *
 * Maps incoming URLs to Expo Router routes.
 * The app uses the `techoffice://` scheme for custom links and
 * universal links for shared URLs.
 *
 * Configure `intentFilters` (Android) and `associatedDomains` (iOS)
 * in app.json to enable universal links for the domains listed here.
 *
 * Expo Router handles most deep linking automatically based on the
 * file-based route structure, but notification payloads and external
 * links use this mapping when they arrive as raw URLs.
 */

import * as Linking from "expo-linking";

import {
  canonicalTargetToMobileFallbackPath,
  canonicalTargetToMobilePath,
  isCanonicalResourceLink,
  parseCanonicalResourceLink,
} from "@tech-office/links";

import { WEB_BASE_URL } from "@/lib/constants";

export type RitualFocusIntent = "view_instance" | "submit_requirement" | "review_pending";
export type RitualEntryContext = "skipped" | "detached";
export const RITUAL_FOCUS_INTENT_VIEW_INSTANCE: RitualFocusIntent = "view_instance";
export const RITUAL_FOCUS_INTENT_SUBMIT_REQUIREMENT: RitualFocusIntent = "submit_requirement";
export const RITUAL_FOCUS_INTENT_REVIEW_PENDING: RitualFocusIntent = "review_pending";
export const RITUAL_FOCUS_INTENTS: readonly RitualFocusIntent[] = [
  RITUAL_FOCUS_INTENT_VIEW_INSTANCE,
  RITUAL_FOCUS_INTENT_SUBMIT_REQUIREMENT,
  RITUAL_FOCUS_INTENT_REVIEW_PENDING,
];
export const NOTIFICATIONS_HOME_HREF = "/(app)/(notifications)";

interface RitualTaskFocusParams {
  focusIntent?: RitualFocusIntent;
  requirementId?: string;
  entryContext?: RitualEntryContext;
}

export interface NotificationTaskNavigation {
  href: string;
  projectId: string;
  taskId: string;
  focusIntent?: RitualFocusIntent;
  requirementId?: string;
  entryContext?: RitualEntryContext;
}

function searchParamsToRecord(queryParams: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  queryParams.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

interface NotificationNavigationTarget {
  action?: string;
  deepLink?: string;
  domain?: string;
  resourceType?: string;
  resourceId?: string;
  secondaryId?: string;
}

interface NotificationNavigationPayload {
  sourceDomain?: string;
  notificationType?: string;
  actionData?: Record<string, string>;
  navigationTarget?: NotificationNavigationTarget;
}

const ritualFocusIntents = new Set<RitualFocusIntent>(RITUAL_FOCUS_INTENTS);
const ritualEntryContexts = new Set<RitualEntryContext>(["skipped", "detached"]);
const taskViewNotificationTypes = new Set<string>([
  "task_commented",
  "task_mentioned",
  "task_assigned",
  "task_status_changed",
  "task_updated",
  "task_description_modified",
]);

/** The URL prefix used for deep links from notifications and share sheets */
export const DEEP_LINK_PREFIX = Linking.createURL("/");

function normalizeFocusIntent(value: string | undefined): RitualFocusIntent | undefined {
  if (!value || !ritualFocusIntents.has(value as RitualFocusIntent)) {
    return undefined;
  }

  return value as RitualFocusIntent;
}

function normalizeEntryContext(value: string | undefined): RitualEntryContext | undefined {
  if (!value || !ritualEntryContexts.has(value as RitualEntryContext)) {
    return undefined;
  }

  return value as RitualEntryContext;
}

function asTruthyFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return value === "true" || value === "1" || value === "yes";
}

function focusIntentFromNotificationType(
  notificationType: string | undefined,
): RitualFocusIntent | undefined {
  switch (notificationType) {
    case "evidence_submitted":
      return RITUAL_FOCUS_INTENT_REVIEW_PENDING;
    case "evidence_rejected":
      return RITUAL_FOCUS_INTENT_SUBMIT_REQUIREMENT;
    case "evidence_approved":
    case "ritual_instance_assigned":
    case "ritual_instances_scheduled":
      return RITUAL_FOCUS_INTENT_VIEW_INSTANCE;
    default:
      return undefined;
  }
}

function parseDeepLinkParts(deepLink: string): {
  parts: string[];
  queryParams: URLSearchParams;
} {
  const normalized = deepLink.replace(/^\/+/, "");
  const [pathPart, queryString = ""] = normalized.split("?");

  return {
    parts: pathPart.split("/").filter(Boolean),
    queryParams: new URLSearchParams(queryString),
  };
}

function appendQueryParams(baseHref: string, params: Record<string, string | undefined>): string {
  const queryParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      queryParams.set(key, value);
    }
  }

  const queryString = queryParams.toString();
  return queryString ? `${baseHref}?${queryString}` : baseHref;
}

function resolveTaskFocusParams(
  notificationType: string | undefined,
  target: NotificationNavigationTarget | undefined,
  actionData: Record<string, string> | undefined,
  queryParams?: URLSearchParams,
): RitualTaskFocusParams {
  const focusIntent = normalizeFocusIntent(
    queryParams?.get("focusIntent") ??
      queryParams?.get("intent") ??
      actionData?.focusIntent ??
      actionData?.ritualFocusIntent ??
      target?.action,
  ) ?? focusIntentFromNotificationType(notificationType);
  const requirementId =
    queryParams?.get("requirementId") ??
    queryParams?.get("evidenceRequirementId") ??
    queryParams?.get("pendingRequirementId") ??
    queryParams?.get("focusRequirementId") ??
    actionData?.requirementId ??
    actionData?.evidenceRequirementId ??
    actionData?.pendingRequirementId ??
    actionData?.focusRequirementId ??
    actionData?.latestPendingRequirementId;
  const entryContext =
    normalizeEntryContext(
      queryParams?.get("entryContext") ??
        queryParams?.get("taskContext") ??
        actionData?.entryContext ??
        actionData?.taskContext ??
        actionData?.ritualContext,
    ) ??
    (asTruthyFlag(actionData?.detachedFromRitual) ? "detached" : undefined) ??
    (actionData?.skipReason ? "skipped" : undefined);

  return {
    focusIntent,
    requirementId: requirementId || undefined,
    entryContext,
  };
}

/**
 * Map a notification deep-link target to an Expo Router href.
 *
 * Notification payloads carry a `deepLink` field with a path like:
 *   - `chat/CHANNEL_ID`
 *   - `tasks/PROJECT_ID/TASK_ID`
 *   - `calendar/EVENT_ID`
 *   - `docs/SLUG`
 *
 * @returns A href string compatible with `router.push()` / `router.navigate()`
 */
export function resolveNotificationHref(
  deepLink: string | undefined
): string | null {
  if (!deepLink) return null;

  if (isCanonicalResourceLink(deepLink)) {
    const target = parseCanonicalResourceLink(deepLink);
    if (target) {
      return canonicalTargetToMobilePath(target) ?? canonicalTargetToMobileFallbackPath(target);
    }
  }

  const { parts, queryParams } = parseDeepLinkParts(deepLink);

  switch (parts[0]) {
    case "chat":
      return parts[1]
        ? appendQueryParams(`/(app)/(chat)/${parts[1]}`, searchParamsToRecord(queryParams))
        : "/(app)/(chat)";

    case "tasks":
      if (parts[1] && parts[2]) {
        const focus = resolveTaskFocusParams(undefined, undefined, undefined, queryParams);
        return buildTaskHref(parts[1], parts[2], focus);
      }
      if (parts[1]) {
        return `/(app)/(tasks)/${parts[1]}`;
      }
      return "/(app)/(tasks)";

    case "calendar":
      return parts[1]
        ? appendQueryParams(`/(app)/(calendar)/${parts[1]}`, searchParamsToRecord(queryParams))
        : "/(app)/(calendar)";

    case "docs":
      return parts[1]
        ? appendQueryParams(`/(app)/(more)/docs/${parts[1]}`, searchParamsToRecord(queryParams))
        : "/(app)/(more)/docs";

    case "notifications":
      return NOTIFICATIONS_HOME_HREF;

    case "search":
      return "/(app)/(more)/search";

    case "booking":
      return parts[1] ? `/booking/${parts[1]}` : null;

    default:
      return null;
  }
}

function buildChatHref(channelId: string): string {
  return `/(app)/(chat)/${channelId}`;
}

function notificationTargetIsChatChannel(target: NotificationNavigationTarget | undefined): boolean {
  return target?.resourceType === "channel" || target?.resourceType === "chat_channel";
}

function notificationChannelId(
  target: NotificationNavigationTarget | undefined,
  actionData: Record<string, string> | undefined,
): string | undefined {
  return notificationTargetIsChatChannel(target)
    ? target?.resourceId ?? actionData?.channelId
    : actionData?.channelId;
}

function notificationTargetsTaskView(notificationType: string | undefined): boolean {
  return !!notificationType && taskViewNotificationTypes.has(notificationType);
}

function notificationHasExplicitChatContext(
  sourceDomain: string | undefined,
  target: NotificationNavigationTarget | undefined,
  actionData: Record<string, string> | undefined,
): boolean {
  if (!notificationChannelId(target, actionData) && !target?.resourceId) {
    return false;
  }

  return (
    sourceDomain === "chat" ||
    notificationTargetIsChatChannel(target) ||
    target?.resourceType === "chat_channel" ||
    actionData?.channelType === "direct_message"
  );
}

function resolveIncomingVoiceCallHref(
  target: NotificationNavigationTarget | undefined,
  actionData: Record<string, string> | undefined,
): string {
  const channelId = notificationChannelId(target, actionData);
  if (channelId) {
    return buildChatHref(channelId);
  }

  const deepLinkHref = resolveNotificationHref(target?.deepLink ?? actionData?.deepLink);
  return deepLinkHref?.startsWith("/(app)/(chat)") ? deepLinkHref : NOTIFICATIONS_HOME_HREF;
}

function buildTaskHref(
  projectId: string,
  taskId: string,
  focus?: RitualTaskFocusParams,
): string {
  return appendQueryParams(`/(app)/(tasks)/${projectId}/${taskId}`, {
    focusIntent: focus?.focusIntent,
    requirementId: focus?.requirementId,
    entryContext: focus?.entryContext,
  });
}

export function resolveNotificationTaskNavigation(
  notification: NotificationNavigationPayload | null | undefined,
): NotificationTaskNavigation | null {
  const target = notification?.navigationTarget;
  const actionData = notification?.actionData;
  const sourceDomain = notification?.sourceDomain ?? target?.domain;

  if (
    notificationHasExplicitChatContext(sourceDomain, target, actionData) &&
    !notificationTargetsTaskView(notification?.notificationType)
  ) {
    return null;
  }

  const deepLink = target?.deepLink ?? actionData?.deepLink;
  if (deepLink) {
    const { parts, queryParams } = parseDeepLinkParts(deepLink);
    if (parts[0] === "tasks" && parts[1] && parts[2]) {
      const focus = resolveTaskFocusParams(notification?.notificationType, target, actionData, queryParams);
      return {
        href: buildTaskHref(parts[1], parts[2], focus),
        projectId: parts[1],
        taskId: parts[2],
        focusIntent: focus.focusIntent,
        requirementId: focus.requirementId,
        entryContext: focus.entryContext,
      };
    }
  }

  const projectId = actionData?.projectId;
  const taskId = actionData?.taskId ?? target?.resourceId;
  if (target?.resourceType === "task" && projectId && taskId) {
    const focus = resolveTaskFocusParams(notification?.notificationType, target, actionData);
    return {
      href: buildTaskHref(projectId, taskId, focus),
      projectId,
      taskId,
      focusIntent: focus.focusIntent,
      requirementId: focus.requirementId,
      entryContext: focus.entryContext,
    };
  }

  return null;
}

/**
 * Resolve an in-app route from a notification payload.
 *
 * The backend currently emits a mix of deep links, typed navigation targets,
 * and actionData-only payloads. Prefer the most specific target first and only
 * fall back when the payload is incomplete.
 */
export function resolveNotificationPayloadHref(
  notification: NotificationNavigationPayload | null | undefined,
): string {
  const target = notification?.navigationTarget;
  const actionData = notification?.actionData;
  const notificationType = notification?.notificationType;
  const sourceDomain = notification?.sourceDomain ?? target?.domain;

  if (notificationType === "voice_call_incoming") {
    return resolveIncomingVoiceCallHref(target, actionData);
  }

  const channelId = notificationChannelId(target, actionData);
  const parentMessageId = actionData?.parentMessageId;
  const taskId = actionData?.taskId ?? target?.resourceId;
  const projectId = actionData?.projectId;
  const eventId = actionData?.eventId ?? target?.resourceId;
  const documentSlug = actionData?.slug ?? actionData?.documentSlug ?? target?.resourceId;
  const isTaskViewNotification = notificationTargetsTaskView(notificationType);

  // Task-commented/mentioned notifications bridged from a task discussion chat
  // channel should open the chat conversation, not the task detail page. These
  // notifications carry a channelId in actionData and a deepLink pointing to
  // chat/CHANNEL_ID. Route to the chat channel so the user sees the conversation
  // context that triggered the notification.
  if (
    (notificationType === "task_commented" || notificationType === "task_mentioned") &&
    channelId
  ) {
    if (
      parentMessageId &&
      (target?.action ?? actionData?.action) === "view_thread"
    ) {
      return `/(app)/(chat)/thread/${parentMessageId}`;
    }
    return buildChatHref(channelId);
  }

  if (notificationHasExplicitChatContext(sourceDomain, target, actionData) && !isTaskViewNotification) {
    if (
      parentMessageId &&
      (
        (target?.action ?? actionData?.action) === "view_thread" ||
        notificationType === "reply" ||
        notificationType === "thread_reply" ||
        notificationType === "message_reply" ||
        notificationType === "mention_reply" ||
        notificationType === "thread_mention"
      )
    ) {
      return `/(app)/(chat)/thread/${parentMessageId}`;
    }

    return buildChatHref(target?.resourceId ?? channelId!);
  }

  const taskNavigation = resolveNotificationTaskNavigation(notification);

  if (taskNavigation) {
    return taskNavigation.href;
  }

  // Task notifications (task_commented, task_mentioned, task_assigned, etc.) always
  // navigate to the task view even when they originate from a task discussion channel.
  // The notification title/message refers to the task context, not the raw chat thread.
  if (
    target?.resourceType === "task" &&
    projectId &&
    taskId &&
    isTaskViewNotification
  ) {
    return buildTaskHref(projectId, taskId, resolveTaskFocusParams(notificationType, target, actionData));
  }

  const deepLinkHref = resolveNotificationHref(target?.deepLink ?? actionData?.deepLink);
  if (deepLinkHref) {
    return deepLinkHref;
  }

  if (
    (target?.resourceType === "channel" ||
      target?.resourceType === "chat_channel" ||
      sourceDomain === "chat") &&
    (target?.resourceId || channelId)
  ) {
    if (
      parentMessageId &&
      (
        (target?.action ?? actionData?.action) === "view_thread" ||
        notificationType === "reply" ||
        notificationType === "thread_reply" ||
        notificationType === "message_reply" ||
        notificationType === "mention_reply" ||
        notificationType === "thread_mention"
      )
    ) {
      return `/(app)/(chat)/thread/${parentMessageId}`;
    }

    return buildChatHref(target?.resourceId ?? channelId!);
  }

  if (target?.resourceType === "task") {
    if (projectId && taskId) {
      return buildTaskHref(projectId, taskId, resolveTaskFocusParams(notificationType, target, actionData));
    }
    return NOTIFICATIONS_HOME_HREF;
  }

  if (target?.resourceType === "document" && documentSlug) {
    return `/(app)/(more)/docs/${documentSlug}`;
  }

  if (target?.resourceType === "calendar_event" && eventId) {
    return `/(app)/(calendar)/${eventId}`;
  }

  // Only use channelId for chat-domain notifications; task comments are handled above.
  if (channelId && (sourceDomain === "chat" || (notificationType?.includes("comment") && sourceDomain !== "projects"))) {
    return buildChatHref(channelId);
  }

  if (projectId && taskId) {
    return buildTaskHref(projectId, taskId, resolveTaskFocusParams(notificationType, target, actionData));
  }

  if (documentSlug && sourceDomain === "docs") {
    return `/(app)/(more)/docs/${documentSlug}`;
  }

  if (actionData?.eventId || sourceDomain === "calendar") {
    return actionData?.eventId
      ? `/(app)/(calendar)/${actionData.eventId}`
      : "/(app)/(calendar)";
  }

  return NOTIFICATIONS_HOME_HREF;
}

/**
 * Expo Router's `linking` config object.
 *
 * Pass this to `<Slot>` or use the `expo-router` built-in linking.
 * Most routes are resolved automatically — this only registers the
 * custom scheme and any non-standard path overrides.
 */
export const linkingConfig = {
  prefixes: [
    DEEP_LINK_PREFIX,
    "techoffice://",
    WEB_BASE_URL,
  ],
};
