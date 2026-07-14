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

interface NotificationChatPayload {
	channelId?: string;
	channelType?: string;
	channelName?: string;
	messageId?: string;
	parentMessageId?: string;
	action?: string;
}

interface NotificationTaskPayload {
	projectId?: string;
	taskId?: string;
	requirementId?: string;
	focusIntent?: string;
	entryContext?: string;
	deepLink?: string;
}

interface NotificationDocumentPayload {
	slug?: string;
	deepLink?: string;
}

interface NotificationVoiceCallPayload {
	channelId?: string;
}

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

function buildChatHref(
	chatPayload: NotificationChatPayload | undefined,
	resourceId?: string,
): string | null {
	const channelId = asString(resourceId) ?? chatPayload?.channelId;
	if (!channelId) {
		return null;
	}

	const action = chatPayload?.action;
	const messageId = chatPayload?.messageId;
	const parentMessageId = chatPayload?.parentMessageId;
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
	taskPayload: NotificationTaskPayload | undefined,
	navigationAction?: string,
	queryParams?: URLSearchParams,
): { focusIntent?: RitualFocusIntent; requirementId?: string; entryContext?: RitualEntryContext } {
	const focusIntent =
		normalizeFocusIntent(queryParams?.get('focusIntent') ?? queryParams?.get('intent')) ??
		normalizeFocusIntent(taskPayload?.focusIntent) ??
		normalizeFocusIntent(navigationAction) ??
		mapNotificationTypeToFocusIntent(notificationType);
	const requirementId =
		queryParams?.get('requirementId') ??
		queryParams?.get('evidenceRequirementId') ??
		queryParams?.get('pendingRequirementId') ??
		queryParams?.get('focusRequirementId') ??
		asString(taskPayload?.requirementId) ??
		undefined;
	const entryContext =
		normalizeEntryContext(
			queryParams?.get('entryContext') ??
				queryParams?.get('taskContext') ??
				taskPayload?.entryContext,
		);

	return {
		focusIntent,
		requirementId,
		entryContext,
	};
}

export function resolveWorkspaceNotificationHref(notification: Notification): string | null {
	const target = notification.navigationTarget;
	const payload = notification.payload;
	const chatPayload = payload?.chat as NotificationChatPayload | undefined;
	const taskPayload = payload?.task as NotificationTaskPayload | undefined;
	const documentPayload = payload?.document as NotificationDocumentPayload | undefined;
	const voiceCallPayload = payload?.voiceCall as NotificationVoiceCallPayload | undefined;
	const notificationType = notification.notificationType;
	const projectId = taskPayload?.projectId;
	const taskId = taskPayload?.taskId ?? asString(target?.resourceId);

	if (notificationType === 'voice_call_incoming' && voiceCallPayload?.channelId) {
		return `/workspace/chat?channel=${voiceCallPayload.channelId}`;
	}

	const deepLink = taskPayload?.deepLink ?? documentPayload?.deepLink;
	if (deepLink) {
		const { parts, queryParams } = parseDeepLink(deepLink);
		if (parts[0] === 'tasks' && parts[1] && parts[2]) {
			const focus = resolveTaskFocus(notificationType, taskPayload, target?.action, queryParams);
			return buildTaskHref(parts[1], parts[2], focus.focusIntent, focus.requirementId, focus.entryContext);
		}

		if (parts[0] === 'chat') {
			return buildChatHref(chatPayload, parts[1]);
		}
	}

	if (target?.resourceType === 'task' && projectId && taskId) {
		const focus = resolveTaskFocus(notificationType, taskPayload, target.action);
		return buildTaskHref(projectId, taskId, focus.focusIntent, focus.requirementId, focus.entryContext);
	}

	if (
		(target?.resourceType === 'channel' || target?.resourceType === 'chat_channel' || notification.sourceDomain === 'chat')
	) {
		return buildChatHref(chatPayload, target?.resourceId);
	}

	return null;
}