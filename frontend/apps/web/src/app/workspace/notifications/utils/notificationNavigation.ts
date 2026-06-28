import type { Notification } from '@tech-office/notifications';

type RitualFocusIntent = 'view_instance' | 'submit_requirement' | 'review_pending';
type RitualEntryContext = 'skipped' | 'detached';

export const RITUAL_FOCUS_INTENT_VIEW_INSTANCE: RitualFocusIntent = 'view_instance';
export const RITUAL_FOCUS_INTENT_SUBMIT_REQUIREMENT: RitualFocusIntent = 'submit_requirement';
export const RITUAL_FOCUS_INTENT_REVIEW_PENDING: RitualFocusIntent = 'review_pending';
export const RITUAL_FOCUS_INTENTS: readonly RitualFocusIntent[] = [
	RITUAL_FOCUS_INTENT_VIEW_INSTANCE,
	RITUAL_FOCUS_INTENT_SUBMIT_REQUIREMENT,
	RITUAL_FOCUS_INTENT_REVIEW_PENDING,
];
const RITUAL_ENTRY_CONTEXTS: readonly RitualEntryContext[] = ['skipped', 'detached'];

type NotificationActionData = Record<string, unknown>;

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizeFocusIntent(value: unknown): RitualFocusIntent | undefined {
	if (typeof value === 'string' && RITUAL_FOCUS_INTENTS.includes(value as RitualFocusIntent)) {
		return value as RitualFocusIntent;
	}

	return undefined;
}

function normalizeEntryContext(value: unknown): RitualEntryContext | undefined {
	if (typeof value === 'string' && RITUAL_ENTRY_CONTEXTS.includes(value as RitualEntryContext)) {
		return value as RitualEntryContext;
	}

	return undefined;
}

function asTruthyFlag(value: unknown): boolean {
	return value === true || value === 'true' || value === 1 || value === '1';
}

function mapNotificationTypeToFocusIntent(notificationType: string | undefined): RitualFocusIntent | undefined {
	switch (notificationType) {
		case 'evidence_submitted':
			return RITUAL_FOCUS_INTENT_REVIEW_PENDING;
		case 'evidence_rejected':
			return RITUAL_FOCUS_INTENT_SUBMIT_REQUIREMENT;
		case 'evidence_approved':
		case 'ritual_instance_assigned':
		case 'ritual_instances_scheduled':
			return RITUAL_FOCUS_INTENT_VIEW_INSTANCE;
		default:
			return undefined;
	}
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

function buildTaskHref(
	projectId: string,
	taskId: string,
	focusIntent?: RitualFocusIntent,
	requirementId?: string,
	entryContext?: RitualEntryContext,
): string {
	return appendQueryParams(`/workspace/tasks/${projectId}/tasks/${taskId}`, {
		focusIntent,
		requirementId,
		entryContext,
	});
}

function buildChatHref(actionData: NotificationActionData | null, resourceId?: string): string | null {
	const channelId = asString(resourceId) ?? asString(actionData?.channelId);
	if (!channelId) {
		return null;
	}

	const action = asString(actionData?.action);
	const messageId = asString(actionData?.messageId);
	const parentMessageId = asString(actionData?.parentMessageId);
	const params = new URLSearchParams({ channel: channelId });

	if (action === 'view_thread' && parentMessageId) {
		params.set('thread', parentMessageId);
		params.set('message', messageId ?? parentMessageId);
	} else if (messageId) {
		params.set('message', messageId);
	}

	return `/workspace/chat?${params.toString()}`;
}

function parseDeepLink(deepLink: string): { parts: string[]; queryParams: URLSearchParams } {
	const normalized = deepLink.replace(/^\/+/, '');
	const [pathPart, queryString = ''] = normalized.split('?');

	return {
		parts: pathPart.split('/').filter(Boolean),
		queryParams: new URLSearchParams(queryString),
	};
}

function resolveTaskFocus(
	notificationType: string | undefined,
	actionData: NotificationActionData | null,
	navigationAction?: string,
	queryParams?: URLSearchParams,
): { focusIntent?: RitualFocusIntent; requirementId?: string; entryContext?: RitualEntryContext } {
	const focusIntent =
		normalizeFocusIntent(queryParams?.get('focusIntent') ?? queryParams?.get('intent')) ??
		normalizeFocusIntent(actionData?.focusIntent) ??
		normalizeFocusIntent(actionData?.ritualFocusIntent) ??
		normalizeFocusIntent(navigationAction) ??
		mapNotificationTypeToFocusIntent(notificationType);
	const requirementId =
		queryParams?.get('requirementId') ??
		queryParams?.get('evidenceRequirementId') ??
		queryParams?.get('pendingRequirementId') ??
		queryParams?.get('focusRequirementId') ??
		asString(actionData?.requirementId) ??
		asString(actionData?.evidenceRequirementId) ??
		asString(actionData?.pendingRequirementId) ??
		asString(actionData?.focusRequirementId) ??
		asString(actionData?.latestPendingRequirementId);
	const entryContext =
		normalizeEntryContext(
			queryParams?.get('entryContext') ??
				queryParams?.get('taskContext') ??
				actionData?.entryContext ??
				actionData?.taskContext ??
				actionData?.ritualContext,
		) ??
		(asTruthyFlag(actionData?.detachedFromRitual) ? 'detached' : undefined) ??
		(asString(actionData?.skipReason) ? 'skipped' : undefined);

	return {
		focusIntent,
		requirementId,
		entryContext,
	};
}

export function resolveWorkspaceNotificationHref(notification: Notification): string | null {
	const target = notification.navigationTarget;
	const actionData =
		notification.actionData && typeof notification.actionData === 'object'
			? (notification.actionData as NotificationActionData)
			: null;
	const notificationType = notification.notificationType;
	const projectId = asString(actionData?.projectId);
	const taskId = asString(actionData?.taskId) ?? asString(target?.resourceId);

	const deepLink = asString(actionData?.deepLink);
	if (deepLink) {
		const { parts, queryParams } = parseDeepLink(deepLink);
		if (parts[0] === 'tasks' && parts[1] && parts[2]) {
			const focus = resolveTaskFocus(notificationType, actionData, target?.action, queryParams);
			return buildTaskHref(parts[1], parts[2], focus.focusIntent, focus.requirementId, focus.entryContext);
		}

		if (parts[0] === 'chat') {
			return buildChatHref(actionData, parts[1]);
		}
	}

	if (target?.resourceType === 'task' && projectId && taskId) {
		const focus = resolveTaskFocus(notificationType, actionData, target.action);
		return buildTaskHref(projectId, taskId, focus.focusIntent, focus.requirementId, focus.entryContext);
	}

	if (
		(target?.resourceType === 'channel' || target?.resourceType === 'chat_channel' || notification.sourceDomain === 'chat')
	) {
		return buildChatHref(actionData, target?.resourceId);
	}

	return null;
}