/**
 * Task Collaboration API functions
 * ConnectRPC-based API calls for Trello/Jira-style task management
 * Feature: 017-realtime-task-collaboration-system
 */

import type { JsonObject } from "@bufbuild/protobuf";
import { collaborationClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { protoTimestampToDate } from "./proto-utils";
import { collaboration, chat } from "rpc";

// =============================================================================
// Type Definitions - Enums
// =============================================================================

export type ProjectVisibility = 'public' | 'private';
export type StateCategory = 'todo' | 'in_progress' | 'done' | 'cancelled' | 'scheduled' | 'submitted' | 'verified' | 'overdue' | 'missed' | 'skipped';
export type CustomFieldType = 'text' | 'number' | 'single_select' | 'multi_select' | 'date' | 'user' | 'checkbox';
export type WorkflowTriggerType = 'state_entered' | 'state_exited' | 'field_changed' | 'task_created';
export type WorkflowActionType = 'set_state' | 'set_field' | 'assign_user' | 'notify' | 'close_task';
export type ProjectMemberRole = 'owner' | 'admin' | 'member' | 'viewer';
export type TaskAssigneeRole = 'assignee' | 'reviewer' | 'approver';
export type ViewType = 'board' | 'list' | 'gantt' | 'calendar' | 'today' | 'health';
export type ProjectSurfaceId = ViewType | 'analytics' | 'settings' | 'overview' | 'worklist' | 'review';
export type CollaborationMode = 'standard' | 'ritual' | 'mixed';
export type StateType = 'standard' | 'ritual';
// Note: Uses chat.NotificationPreference enum: all, mentions, muted (no 'assigned' in proto)
export type ProjectNotificationPreference = 'all' | 'mentions' | 'muted';

export type ProjectSurfaceWorkstream = 'planning' | 'operations' | 'review' | 'health' | 'settings' | 'overview';

export interface ProjectSurfaceDefinition {
	id: ProjectSurfaceId;
	label: string;
	workstream: ProjectSurfaceWorkstream;
	supportedModes: CollaborationMode[];
	persistedViewType?: ViewType;
	requiresReviewPermission?: boolean;
}

// =============================================================================
// Type Definitions - Interfaces
// =============================================================================

export interface Project {
	id: string;
	name: string;
	key: string;
	description: string;
	visibility: ProjectVisibility;
	isArchived: boolean;
	ownerEmployeeId: string;
	memberCount: number;
	taskCount: number;
	updatedAt: Date;
	collaborationMode: CollaborationMode;
}

export interface ProjectState {
	id: string;
	projectId: string;
	name: string;
	color: string;
	category: StateCategory;
	position: number;
	isInitial: boolean;
	isClosed: boolean;
	stateType: StateType;
}

export interface TaskLevel {
	id: string;
	projectId: string;
	name: string;
	icon: string;
	color: string;
	depth: number;
}

export interface TaskAssignee {
	employeeId: string;
	role: TaskAssigneeRole;
	assignedAt: Date;
}

export interface CustomFieldValue {
	fieldId: string;
	fieldName: string;
	fieldType: CustomFieldType;
	value: unknown;
}

export interface TaskEvidenceProgressSummary {
	totalRequirements: number;
	requiredCount: number;
	submittedCount: number;
	approvedCount: number;
	rejectedCount: number;
	pendingReviewCount: number;
	allRequiredApproved: boolean;
}

export interface Task {
	id: string;
	projectId: string;
	identifier: string; // e.g., "PROJ-123"
	title: string;
	parentTaskId?: string;
	depth: number;
	levelId: string;
	childCount: number;
	stateId: string;
	startDate?: string;
	dueDate?: string;
	estimatedHours?: number;
	channelId?: string;
	descriptionDocumentId?: string;
	fileIds: string[];
	reporterEmployeeId: string;
	assignees: TaskAssignee[];
	commentCount: number;
	updatedAt: Date;
	customFieldValues: CustomFieldValue[];
	taskKind: 'standard' | 'ritual_instance';
	ritualDefinitionId?: string;
	scheduledDate?: string;
	completionDeadline?: Date;
	skipReason?: string;
	evidenceProgress?: TaskEvidenceProgressSummary;
	detachedFromRitual: boolean;
}

export interface AssignedWorkSummaryItem {
	taskId: string;
	projectId: string;
	projectKey: string;
	title: string;
	dueDate?: string;
	urgencyBucket: 'due_today' | 'overdue';
	stateName?: string;
}

export interface AssignedWorkSummary {
	asOfDate: string;
	dueTodayCount: number;
	overdueCount: number;
	items: AssignedWorkSummaryItem[];
}

export type RitualInstanceTask = Task & {
	taskKind: 'ritual_instance';
	ritualDefinitionId: string;
};

export function isRitualInstanceTask(task: Task | null | undefined): task is RitualInstanceTask {
	return task?.taskKind === 'ritual_instance' && !!task.ritualDefinitionId;
}

export interface TaskWatcher {
	employeeId: string;
	watchReason: string;
}

export interface CustomFieldDefinition {
	id: string;
	projectId: string;
	name: string;
	description: string;
	fieldType: CustomFieldType;
	options: string[];
	defaultValue: unknown;
	isRequired: boolean;
	minValue?: number;
	maxValue?: number;
	position: number;
	isArchived: boolean;
}

export interface WorkflowRule {
	id: string;
	projectId: string;
	name: string;
	description: string;
	triggerType: WorkflowTriggerType;
	triggerStateId?: string;
	triggerFieldId?: string;
	triggerCondition?: Record<string, unknown>;
	actionType: WorkflowActionType;
	actionPayload: Record<string, unknown>;
	position: number;
	isEnabled: boolean;
}

export interface WorkflowRuleExecution {
	ruleId: string;
	ruleName: string;
	status: string;
	errorMessage?: string;
}

export interface ProjectMember {
	id: string;
	projectId: string;
	employeeId: string;
	role: ProjectMemberRole;
	notificationPreference: ProjectNotificationPreference;
	joinedAt: Date;
	invitedByEmployeeId?: string;
}

export interface SavedView {
	id: string;
	projectId: string;
	employeeId?: string;
	name: string;
	viewType: ViewType;
	config: Record<string, unknown>;
	isDefault: boolean;
	position: number;
}

export interface AnalyticsRow {
	dimensions: Record<string, unknown>;
	metrics: Record<string, number>;
}

export interface AnalyticsSummary {
	totalTasks: number;
	completedTasks: number;
	openTasks: number;
	completionRate: number;
}

// =============================================================================
// Proto Enum Converters
// =============================================================================

function protoVisibilityToString(v: collaboration.ProjectVisibility): ProjectVisibility {
	switch (v) {
		case collaboration.ProjectVisibility.PUBLIC:
			return 'public';
		case collaboration.ProjectVisibility.PRIVATE:
			return 'private';
		default:
			return 'private';
	}
}

function stringToProtoVisibility(v: ProjectVisibility): collaboration.ProjectVisibility {
	switch (v) {
		case 'public':
			return collaboration.ProjectVisibility.PUBLIC;
		case 'private':
			return collaboration.ProjectVisibility.PRIVATE;
		default:
			return collaboration.ProjectVisibility.PRIVATE;
	}
}

function protoStateCategoryToString(c: collaboration.StateCategory): StateCategory {
	switch (c) {
		case collaboration.StateCategory.TODO:
			return 'todo';
		case collaboration.StateCategory.IN_PROGRESS:
			return 'in_progress';
		case collaboration.StateCategory.DONE:
			return 'done';
		case collaboration.StateCategory.CANCELLED:
			return 'cancelled';
		case collaboration.StateCategory.SCHEDULED:
			return 'scheduled';
		case collaboration.StateCategory.SUBMITTED:
			return 'submitted';
		case collaboration.StateCategory.VERIFIED:
			return 'verified';
		case collaboration.StateCategory.OVERDUE:
			return 'overdue';
		case collaboration.StateCategory.MISSED:
			return 'missed';
		case collaboration.StateCategory.SKIPPED:
			return 'skipped';
		default:
			return 'todo';
	}
}

function stringToProtoStateCategory(c: StateCategory): collaboration.StateCategory {
	switch (c) {
		case 'todo':
			return collaboration.StateCategory.TODO;
		case 'in_progress':
			return collaboration.StateCategory.IN_PROGRESS;
		case 'done':
			return collaboration.StateCategory.DONE;
		case 'cancelled':
			return collaboration.StateCategory.CANCELLED;
		case 'scheduled':
			return collaboration.StateCategory.SCHEDULED;
		case 'submitted':
			return collaboration.StateCategory.SUBMITTED;
		case 'verified':
			return collaboration.StateCategory.VERIFIED;
		case 'overdue':
			return collaboration.StateCategory.OVERDUE;
		case 'missed':
			return collaboration.StateCategory.MISSED;
		case 'skipped':
			return collaboration.StateCategory.SKIPPED;
		default:
			return collaboration.StateCategory.TODO;
	}
}

function protoStateTypeToString(t: collaboration.StateType): StateType {
	switch (t) {
		case collaboration.StateType.STANDARD:
			return 'standard';
		case collaboration.StateType.RITUAL:
			return 'ritual';
		default:
			return 'standard';
	}
}

function stringToProtoStateType(t: StateType): collaboration.StateType {
	switch (t) {
		case 'standard':
			return collaboration.StateType.STANDARD;
		case 'ritual':
			return collaboration.StateType.RITUAL;
		default:
			return collaboration.StateType.STANDARD;
	}
}

function protoFieldTypeToString(t: collaboration.CustomFieldType): CustomFieldType {
	switch (t) {
		case collaboration.CustomFieldType.TEXT:
			return 'text';
		case collaboration.CustomFieldType.NUMBER:
			return 'number';
		case collaboration.CustomFieldType.SINGLE_SELECT:
			return 'single_select';
		case collaboration.CustomFieldType.MULTI_SELECT:
			return 'multi_select';
		case collaboration.CustomFieldType.DATE:
			return 'date';
		case collaboration.CustomFieldType.USER:
			return 'user';
		case collaboration.CustomFieldType.CHECKBOX:
			return 'checkbox';
		default:
			return 'text';
	}
}

function stringToProtoFieldType(t: CustomFieldType): collaboration.CustomFieldType {
	switch (t) {
		case 'text':
			return collaboration.CustomFieldType.TEXT;
		case 'number':
			return collaboration.CustomFieldType.NUMBER;
		case 'single_select':
			return collaboration.CustomFieldType.SINGLE_SELECT;
		case 'multi_select':
			return collaboration.CustomFieldType.MULTI_SELECT;
		case 'date':
			return collaboration.CustomFieldType.DATE;
		case 'user':
			return collaboration.CustomFieldType.USER;
		case 'checkbox':
			return collaboration.CustomFieldType.CHECKBOX;
		default:
			return collaboration.CustomFieldType.TEXT;
	}
}

function protoTriggerTypeToString(t: collaboration.WorkflowTriggerType): WorkflowTriggerType {
	switch (t) {
		case collaboration.WorkflowTriggerType.STATE_ENTERED:
			return 'state_entered';
		case collaboration.WorkflowTriggerType.STATE_EXITED:
			return 'state_exited';
		case collaboration.WorkflowTriggerType.FIELD_CHANGED:
			return 'field_changed';
		case collaboration.WorkflowTriggerType.TASK_CREATED:
			return 'task_created';
		default:
			return 'state_entered';
	}
}

function stringToProtoTriggerType(t: WorkflowTriggerType): collaboration.WorkflowTriggerType {
	switch (t) {
		case 'state_entered':
			return collaboration.WorkflowTriggerType.STATE_ENTERED;
		case 'state_exited':
			return collaboration.WorkflowTriggerType.STATE_EXITED;
		case 'field_changed':
			return collaboration.WorkflowTriggerType.FIELD_CHANGED;
		case 'task_created':
			return collaboration.WorkflowTriggerType.TASK_CREATED;
		default:
			return collaboration.WorkflowTriggerType.STATE_ENTERED;
	}
}

function protoActionTypeToString(t: collaboration.WorkflowActionType): WorkflowActionType {
	switch (t) {
		case collaboration.WorkflowActionType.SET_STATE:
			return 'set_state';
		case collaboration.WorkflowActionType.SET_FIELD:
			return 'set_field';
		case collaboration.WorkflowActionType.ASSIGN_USER:
			return 'assign_user';
		case collaboration.WorkflowActionType.NOTIFY:
			return 'notify';
		case collaboration.WorkflowActionType.CLOSE_TASK:
			return 'close_task';
		default:
			return 'set_state';
	}
}

function stringToProtoActionType(t: WorkflowActionType): collaboration.WorkflowActionType {
	switch (t) {
		case 'set_state':
			return collaboration.WorkflowActionType.SET_STATE;
		case 'set_field':
			return collaboration.WorkflowActionType.SET_FIELD;
		case 'assign_user':
			return collaboration.WorkflowActionType.ASSIGN_USER;
		case 'notify':
			return collaboration.WorkflowActionType.NOTIFY;
		case 'close_task':
			return collaboration.WorkflowActionType.CLOSE_TASK;
		default:
			return collaboration.WorkflowActionType.SET_STATE;
	}
}

function protoMemberRoleToString(r: collaboration.ProjectMemberRole): ProjectMemberRole {
	switch (r) {
		case collaboration.ProjectMemberRole.OWNER:
			return 'owner';
		case collaboration.ProjectMemberRole.ADMIN:
			return 'admin';
		case collaboration.ProjectMemberRole.MEMBER:
			return 'member';
		case collaboration.ProjectMemberRole.VIEWER:
			return 'viewer';
		default:
			return 'viewer';
	}
}

function stringToProtoMemberRole(r: ProjectMemberRole): collaboration.ProjectMemberRole {
	switch (r) {
		case 'owner':
			return collaboration.ProjectMemberRole.OWNER;
		case 'admin':
			return collaboration.ProjectMemberRole.ADMIN;
		case 'member':
			return collaboration.ProjectMemberRole.MEMBER;
		case 'viewer':
			return collaboration.ProjectMemberRole.VIEWER;
		default:
			return collaboration.ProjectMemberRole.VIEWER;
	}
}

function protoAssigneeRoleToString(r: collaboration.TaskAssigneeRole): TaskAssigneeRole {
	switch (r) {
		case collaboration.TaskAssigneeRole.ASSIGNEE:
			return 'assignee';
		case collaboration.TaskAssigneeRole.REVIEWER:
			return 'reviewer';
		case collaboration.TaskAssigneeRole.APPROVER:
			return 'approver';
		default:
			return 'assignee';
	}
}

function stringToProtoAssigneeRole(r: TaskAssigneeRole): collaboration.TaskAssigneeRole {
	switch (r) {
		case 'assignee':
			return collaboration.TaskAssigneeRole.ASSIGNEE;
		case 'reviewer':
			return collaboration.TaskAssigneeRole.REVIEWER;
		case 'approver':
			return collaboration.TaskAssigneeRole.APPROVER;
		default:
			return collaboration.TaskAssigneeRole.ASSIGNEE;
	}
}

function protoViewTypeToString(v: collaboration.ViewType): ViewType {
	switch (v) {
		case collaboration.ViewType.BOARD:
			return 'board';
		case collaboration.ViewType.LIST:
			return 'list';
		case collaboration.ViewType.GANTT:
			return 'gantt';
		case collaboration.ViewType.CALENDAR:
			return 'calendar';
		case collaboration.ViewType.TODAY:
			return 'today';
		case collaboration.ViewType.HEALTH:
			return 'health';
		default:
			return 'board';
	}
}

function stringToProtoViewType(v: ViewType): collaboration.ViewType {
	switch (v) {
		case 'board':
			return collaboration.ViewType.BOARD;
		case 'list':
			return collaboration.ViewType.LIST;
		case 'gantt':
			return collaboration.ViewType.GANTT;
		case 'calendar':
			return collaboration.ViewType.CALENDAR;
		case 'today':
			return collaboration.ViewType.TODAY;
		case 'health':
			return collaboration.ViewType.HEALTH;
		default:
			return collaboration.ViewType.BOARD;
	}
}

function protoNotifPrefToString(n: chat.NotificationPreference): ProjectNotificationPreference {
	switch (n) {
		case chat.NotificationPreference.ALL:
			return 'all';
		case chat.NotificationPreference.MENTIONS:
			return 'mentions';
		case chat.NotificationPreference.MUTED:
			return 'muted';
		default:
			return 'all';
	}
}

export function protoCollaborationModeToString(
	m: collaboration.CollaborationMode
): CollaborationMode {
	switch (m) {
		case collaboration.CollaborationMode.RITUAL:
			return 'ritual';
		case collaboration.CollaborationMode.MIXED:
			return 'mixed';
		default:
			return 'standard';
	}
}

export function stringToProtoCollaborationMode(
	m: CollaborationMode
): collaboration.CollaborationMode {
	switch (m) {
		case 'ritual':
			return collaboration.CollaborationMode.RITUAL;
		case 'mixed':
			return collaboration.CollaborationMode.MIXED;
		default:
			return collaboration.CollaborationMode.STANDARD;
	}
}

// =============================================================================
// Proto to Native Type Converters
// =============================================================================

function protoProjectToNative(p: collaboration.Project): Project {
	return {
		id: p.id,
		name: p.name,
		key: p.key,
		description: p.description,
		visibility: protoVisibilityToString(p.visibility),
		isArchived: p.isArchived,
		ownerEmployeeId: p.ownerEmployeeId,
		memberCount: p.memberCount,
		taskCount: p.taskCount,
		updatedAt: protoTimestampToDate(p.updatedAt) ?? new Date(),
		collaborationMode: protoCollaborationModeToString(p.collaborationMode),
	};
}

function protoStateToNative(s: collaboration.ProjectState): ProjectState {
	return {
		id: s.id,
		projectId: s.projectId,
		name: s.name,
		color: s.color,
		category: protoStateCategoryToString(s.category),
		position: s.position,
		isInitial: s.isInitial,
		isClosed: s.isClosed,
		stateType: protoStateTypeToString(s.stateType),
	};
}

function protoLevelToNative(l: collaboration.TaskLevel): TaskLevel {
	return {
		id: l.id,
		projectId: l.projectId,
		name: l.name,
		icon: l.icon,
		color: l.color,
		depth: l.depth,
	};
}

function protoAssigneeToNative(a: collaboration.TaskAssignee): TaskAssignee {
	return {
		employeeId: a.employeeId,
		role: protoAssigneeRoleToString(a.role),
		assignedAt: protoTimestampToDate(a.assignedAt) ?? new Date(),
	};
}

function protoCustomFieldValueToNative(v: collaboration.CustomFieldValue): CustomFieldValue {
	// Extract value from FieldValue wrapper
	let value: unknown;
	if (v.value && v.value.value) {
		switch (v.value.value.case) {
			case 'stringValue':
				value = v.value.value.value;
				break;
			case 'numberValue':
				value = v.value.value.value;
				break;
			case 'boolValue':
				value = v.value.value.value;
				break;
			case 'stringArrayValue':
				value = v.value.value.value.values; // Extract array from wrapper
				break;
			default:
				value = undefined;
		}
	}
	
	return {
		fieldId: v.fieldId,
		fieldName: v.fieldName,
		fieldType: protoFieldTypeToString(v.fieldType),
		value,
	};
}

function protoTaskToNative(t: collaboration.Task): Task {
	return {
		id: t.id,
		projectId: t.projectId,
		identifier: t.identifier,
		title: t.title,
		parentTaskId: t.parentTaskId || undefined,
		depth: t.depth,
		levelId: t.levelId,
		childCount: t.childCount,
		stateId: t.stateId,
		startDate: t.startDate || undefined,
		dueDate: t.dueDate || undefined,
		estimatedHours: t.estimatedHours || undefined,
		channelId: t.channelId || undefined,
		descriptionDocumentId: t.descriptionDocumentId || undefined,
		fileIds: t.fileIds,
		reporterEmployeeId: t.reporterEmployeeId,
		assignees: t.assignees.map(protoAssigneeToNative),
		commentCount: t.commentCount,
		updatedAt: protoTimestampToDate(t.updatedAt) ?? new Date(),
		customFieldValues: t.customFieldValues.map(protoCustomFieldValueToNative),
		taskKind: t.taskKind === 2 ? 'ritual_instance' : 'standard',
		ritualDefinitionId: t.ritualDefinitionId || undefined,
		scheduledDate: t.scheduledDate || undefined,
		completionDeadline: t.completionDeadline
			? protoTimestampToDate(t.completionDeadline) ?? undefined
			: undefined,
		skipReason: t.skipReason || undefined,
		evidenceProgress: t.evidenceProgress
			? {
				totalRequirements: t.evidenceProgress.totalRequirements,
				requiredCount: t.evidenceProgress.requiredCount,
				submittedCount: t.evidenceProgress.submittedCount,
				approvedCount: t.evidenceProgress.approvedCount,
				rejectedCount: t.evidenceProgress.rejectedCount,
				pendingReviewCount: t.evidenceProgress.pendingReviewCount,
				allRequiredApproved: t.evidenceProgress.allRequiredApproved,
			}
			: undefined,
		detachedFromRitual: t.detachedFromRitual ?? false,
	};
}

function protoWatcherToNative(w: collaboration.TaskWatcher): TaskWatcher {
	return {
		employeeId: w.employeeId,
		watchReason: w.watchReason,
	};
}

function protoFieldDefToNative(f: collaboration.CustomFieldDefinition): CustomFieldDefinition {
	// Extract default_value from oneof
	let defaultValue: unknown;
	switch (f.defaultValue.case) {
		case 'defaultStringValue':
			defaultValue = f.defaultValue.value;
			break;
		case 'defaultNumberValue':
			defaultValue = f.defaultValue.value;
			break;
		case 'defaultBoolValue':
			defaultValue = f.defaultValue.value;
			break;
		case 'defaultStringArrayValue':
			defaultValue = f.defaultValue.value.values; // Extract array from wrapper
			break;
		default:
			defaultValue = undefined;
	}
	
	return {
		id: f.id,
		projectId: f.projectId,
		name: f.name,
		description: f.description,
		fieldType: protoFieldTypeToString(f.fieldType),
		options: f.options,
		defaultValue,
		isRequired: f.isRequired,
		minValue: f.minValue || undefined,
		maxValue: f.maxValue || undefined,
		position: f.position,
		isArchived: f.isArchived,
	};
}

function protoWorkflowRuleToNative(r: collaboration.WorkflowRule): WorkflowRule {
	return {
		id: r.id,
		projectId: r.projectId,
		name: r.name,
		description: r.description,
		triggerType: protoTriggerTypeToString(r.triggerType),
		triggerStateId: r.triggerStateId || undefined,
		triggerFieldId: r.triggerFieldId || undefined,
		triggerCondition: r.triggerCondition as Record<string, unknown> | undefined,
		actionType: protoActionTypeToString(r.actionType),
		actionPayload: (r.actionPayload as Record<string, unknown>) ?? {},
		position: r.position,
		isEnabled: r.isEnabled,
	};
}

function protoRuleExecutionToNative(e: collaboration.WorkflowRuleExecution): WorkflowRuleExecution {
	return {
		ruleId: e.ruleId,
		ruleName: e.ruleName,
		status: e.status,
		errorMessage: e.errorMessage || undefined,
	};
}

function protoMemberToNative(m: collaboration.ProjectMember): ProjectMember {
	return {
		id: m.id,
		projectId: m.projectId,
		employeeId: m.employeeId,
		role: protoMemberRoleToString(m.role),
		notificationPreference: protoNotifPrefToString(m.notificationPreference),
		joinedAt: protoTimestampToDate(m.joinedAt) ?? new Date(),
		invitedByEmployeeId: m.invitedByEmployeeId || undefined,
	};
}

function protoViewToNative(v: collaboration.SavedView): SavedView {
	return {
		id: v.id,
		projectId: v.projectId,
		employeeId: v.employeeId || undefined,
		name: v.name,
		viewType: protoViewTypeToString(v.viewType),
		config: (v.config as Record<string, unknown>) ?? {},
		isDefault: v.isDefault,
		position: v.position,
	};
}

// =============================================================================
// Project API Functions
// =============================================================================

export interface CreateProjectParams {
	name: string;
	key: string;
	description?: string;
	visibility?: ProjectVisibility;
	collaborationMode?: CollaborationMode;
	defaultStates?: Array<{
		name: string;
		color: string;
		category: StateCategory;
		isInitial?: boolean;
		isClosed?: boolean;
	}>;
}

export interface CreateProjectResponse {
	project: Project;
	states: ProjectState[];
	levels: TaskLevel[];
}

export async function createProject(params: CreateProjectParams): Promise<CreateProjectResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.createProject({
			name: params.name,
			key: params.key,
			description: params.description ?? '',
			visibility: params.visibility ? stringToProtoVisibility(params.visibility) : collaboration.ProjectVisibility.PRIVATE,
			collaborationMode: params.collaborationMode
				? stringToProtoCollaborationMode(params.collaborationMode)
				: collaboration.CollaborationMode.STANDARD,
			defaultStates: params.defaultStates?.map(s => ({
				name: s.name,
				color: s.color,
				category: stringToProtoStateCategory(s.category),
				isInitial: s.isInitial ?? false,
				isClosed: s.isClosed ?? false,
			})),
		});
		const typed = response as collaboration.CreateProjectResponse;
		return {
			project: protoProjectToNative(typed.project!),
			states: typed.states.map(protoStateToNative),
			levels: typed.levels.map(protoLevelToNative),
		};
	});
}

export interface GetProjectResponse {
	project: Project;
	states: ProjectState[];
	levels: TaskLevel[];
	currentUserRole: ProjectMemberRole;
}

export async function getProject(projectId: string): Promise<GetProjectResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.getProject({ projectId });
		const typed = response as collaboration.GetProjectResponse;
		return {
			project: protoProjectToNative(typed.project!),
			states: typed.states.map(protoStateToNative),
			levels: typed.levels.map(protoLevelToNative),
			currentUserRole: protoMemberRoleToString(typed.currentUserRole),
		};
	});
}

export interface UpdateProjectParams {
	projectId: string;
	name?: string;
	description?: string;
	visibility?: ProjectVisibility;
}

export interface UpdateProjectResponse {
	project: Project;
}

export async function updateProject(params: UpdateProjectParams): Promise<UpdateProjectResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.updateProject({
			projectId: params.projectId,
			name: params.name,
			description: params.description,
			visibility: params.visibility ? stringToProtoVisibility(params.visibility) : undefined,
		});
		const typed = response as collaboration.UpdateProjectResponse;
		return {
			project: protoProjectToNative(typed.project!),
		};
	});
}

export interface ListProjectsParams {
	includeArchived?: boolean;
	cursor?: string;
	limit?: number;
}

export interface ListProjectsResponse {
	projects: Project[];
	nextCursor?: string;
}

export interface GetAssignedWorkSummaryParams {
	limit?: number;
	includeRitualInstances?: boolean;
}

export async function getAssignedWorkSummary(
	params: GetAssignedWorkSummaryParams = {},
): Promise<AssignedWorkSummary> {
	return rpcCall(async () => {
		const response = await collaborationClient.getAssignedWorkSummary({
			limit: params.limit,
			includeRitualInstances: params.includeRitualInstances ?? false,
		});
		const typed = response as collaboration.GetAssignedWorkSummaryResponse;
		return {
			asOfDate: typed.asOfDate,
			dueTodayCount: typed.dueTodayCount,
			overdueCount: typed.overdueCount,
			items: typed.items.map((item) => ({
				taskId: item.taskId,
				projectId: item.projectId,
				projectKey: item.projectKey,
				title: item.title,
				dueDate: item.dueDate || undefined,
				urgencyBucket: item.urgencyBucket as AssignedWorkSummaryItem['urgencyBucket'],
				stateName: item.stateName || undefined,
			})),
		};
	});
}

export async function listProjects(params?: ListProjectsParams): Promise<ListProjectsResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.listProjects({
			includeArchived: params?.includeArchived,
			cursor: params?.cursor,
			limit: params?.limit,
		});
		const typed = response as collaboration.ListProjectsResponse;
		return {
			projects: typed.projects.map(protoProjectToNative),
			nextCursor: typed.nextCursor || undefined,
		};
	});
}

export interface ArchiveProjectResponse {
	project: Project;
}

export async function archiveProject(projectId: string, archive: boolean): Promise<ArchiveProjectResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.archiveProject({ projectId, archive });
		const typed = response as collaboration.ArchiveProjectResponse;
		return {
			project: protoProjectToNative(typed.project!),
		};
	});
}

// =============================================================================
// Project State API Functions
// =============================================================================

export interface CreateProjectStateParams {
	projectId: string;
	name: string;
	color: string;
	category: StateCategory;
	position?: number;
	isInitial?: boolean;
	isClosed?: boolean;
	stateType?: StateType;
}

export interface CreateProjectStateResponse {
	state: ProjectState;
}

export async function createProjectState(params: CreateProjectStateParams): Promise<CreateProjectStateResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.createProjectState({
			projectId: params.projectId,
			name: params.name,
			color: params.color,
			category: stringToProtoStateCategory(params.category),
			position: params.position,
			isInitial: params.isInitial,
			isClosed: params.isClosed,
			stateType: params.stateType ? stringToProtoStateType(params.stateType) : undefined,
		});
		const typed = response as collaboration.CreateProjectStateResponse;
		return {
			state: protoStateToNative(typed.state!),
		};
	});
}

export interface UpdateProjectStateParams {
	stateId: string;
	name?: string;
	color?: string;
	category?: StateCategory;
	isInitial?: boolean;
	isClosed?: boolean;
	stateType?: StateType;
}

export interface UpdateProjectStateResponse {
	state: ProjectState;
}

export async function updateProjectState(params: UpdateProjectStateParams): Promise<UpdateProjectStateResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.updateProjectState({
			stateId: params.stateId,
			name: params.name,
			color: params.color,
			category: params.category ? stringToProtoStateCategory(params.category) : undefined,
			isInitial: params.isInitial,
			isClosed: params.isClosed,
		});
		const typed = response as collaboration.UpdateProjectStateResponse;
		return {
			state: protoStateToNative(typed.state!),
		};
	});
}

export interface DeleteProjectStateResponse {
	tasksMigrated: number;
}

export async function deleteProjectState(stateId: string, migrateToStateId: string): Promise<DeleteProjectStateResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.deleteProjectState({ stateId, migrateToStateId });
		const typed = response as collaboration.DeleteProjectStateResponse;
		return {
			tasksMigrated: typed.tasksMigrated,
		};
	});
}

export interface ReorderProjectStatesResponse {
	states: ProjectState[];
}

export async function reorderProjectStates(projectId: string, stateIds: string[]): Promise<ReorderProjectStatesResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.reorderProjectStates({ projectId, stateIds });
		const typed = response as collaboration.ReorderProjectStatesResponse;
		return {
			states: typed.states.map(protoStateToNative),
		};
	});
}

export interface ListProjectStatesResponse {
	states: ProjectState[];
}

export async function listProjectStates(projectId: string): Promise<ListProjectStatesResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.listProjectStates({ projectId });
		const typed = response as collaboration.ListProjectStatesResponse;
		return {
			states: typed.states.map(protoStateToNative),
		};
	});
}

// =============================================================================
// Task Level API Functions
// =============================================================================

export interface CreateTaskLevelParams {
	projectId: string;
	name: string;
	icon?: string;
	color?: string;
	depth: number;
}

export interface CreateTaskLevelResponse {
	level: TaskLevel;
}

export async function createTaskLevel(params: CreateTaskLevelParams): Promise<CreateTaskLevelResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.createTaskLevel({
			projectId: params.projectId,
			name: params.name,
			icon: params.icon,
			color: params.color,
			depth: params.depth,
		});
		const typed = response as collaboration.CreateTaskLevelResponse;
		return {
			level: protoLevelToNative(typed.level!),
		};
	});
}

export interface UpdateTaskLevelParams {
	levelId: string;
	name?: string;
	icon?: string;
	color?: string;
}

export interface UpdateTaskLevelResponse {
	level: TaskLevel;
}

export async function updateTaskLevel(params: UpdateTaskLevelParams): Promise<UpdateTaskLevelResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.updateTaskLevel({
			levelId: params.levelId,
			name: params.name,
			icon: params.icon,
			color: params.color,
		});
		const typed = response as collaboration.UpdateTaskLevelResponse;
		return {
			level: protoLevelToNative(typed.level!),
		};
	});
}

export interface DeleteTaskLevelResponse {
	tasksMigrated: number;
}

export async function deleteTaskLevel(levelId: string, migrateToLevelId: string): Promise<DeleteTaskLevelResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.deleteTaskLevel({ levelId, migrateToLevelId });
		const typed = response as collaboration.DeleteTaskLevelResponse;
		return {
			tasksMigrated: typed.tasksMigrated,
		};
	});
}

export interface ListTaskLevelsResponse {
	levels: TaskLevel[];
}

export async function listTaskLevels(projectId: string): Promise<ListTaskLevelsResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.listTaskLevels({ projectId });
		const typed = response as collaboration.ListTaskLevelsResponse;
		return {
			levels: typed.levels.map(protoLevelToNative),
		};
	});
}

// =============================================================================
// Task API Functions
// =============================================================================

export interface CreateTaskParams {
	projectId: string;
	title: string;
	levelId: string;
	parentTaskId?: string;
	stateId?: string;
	startDate?: string;
	dueDate?: string;
	estimatedHours?: number;
	assigneeEmployeeIds?: string[];
	customFields?: Array<{ fieldId: string; value: unknown }>;
}

export interface CreateTaskResponse {
	task: Task;
}

export async function createTask(params: CreateTaskParams): Promise<CreateTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.createTask({
			projectId: params.projectId,
			title: params.title,
			levelId: params.levelId,
			parentTaskId: params.parentTaskId,
			stateId: params.stateId,
			startDate: params.startDate,
			dueDate: params.dueDate,
			estimatedHours: params.estimatedHours,
			assigneeEmployeeIds: params.assigneeEmployeeIds ?? [],
			customFields: params.customFields?.map(cf => ({
				fieldId: cf.fieldId,
				value: { case: 'stringValue' as const, value: String(cf.value) },
			})),
		});
		const typed = response as collaboration.CreateTaskResponse;
		return {
			task: protoTaskToNative(typed.task!),
		};
	});
}

export interface GetTaskResponse {
	task: Task;
	watchers: TaskWatcher[];
}

export async function getTask(taskId: string, includeCustomFields?: boolean): Promise<GetTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.getTask({
			taskId,
			includeCustomFields: includeCustomFields ?? false,
		});
		const typed = response as collaboration.GetTaskResponse;
		return {
			task: protoTaskToNative(typed.task!),
			watchers: typed.watchers.map(protoWatcherToNative),
		};
	});
}

export interface UpdateTaskParams {
	taskId: string;
	title?: string;
	stateId?: string;
	startDate?: string;
	dueDate?: string;
	estimatedHours?: number;
	levelId?: string;
	parentTaskId?: string;
}

export interface UpdateTaskResponse {
	task: Task;
	ruleExecutions: WorkflowRuleExecution[];
}

export async function updateTask(params: UpdateTaskParams): Promise<UpdateTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.updateTask({
			taskId: params.taskId,
			title: params.title,
			stateId: params.stateId,
			startDate: params.startDate,
			dueDate: params.dueDate,
			estimatedHours: params.estimatedHours,
			levelId: params.levelId,
			parentTaskId: params.parentTaskId,
		});
		const typed = response as collaboration.UpdateTaskResponse;
		return {
			task: protoTaskToNative(typed.task!),
			ruleExecutions: typed.ruleExecutions.map(protoRuleExecutionToNative),
		};
	});
}

export interface DeleteTaskResponse {
	tasksDeleted: number;
}

export async function deleteTask(taskId: string, deleteChildren?: boolean): Promise<DeleteTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.deleteTask({
			taskId,
			deleteChildren: deleteChildren ?? false,
		});
		const typed = response as collaboration.DeleteTaskResponse;
		return {
			tasksDeleted: typed.tasksDeleted,
		};
	});
}

export interface ListTasksParams {
	projectId: string;
	stateId?: string;
	assigneeEmployeeId?: string;
	reporterEmployeeId?: string;
	levelId?: string;
	parentTaskId?: string;
	taskKind?: Task['taskKind'];
	rootOnly?: boolean;
	searchQuery?: string;
	cursor?: string;
	limit?: number;
	includeCustomFields?: boolean;
}

export interface ListTasksResponse {
	tasks: Task[];
	nextCursor?: string;
}

export async function listTasks(params: ListTasksParams): Promise<ListTasksResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.listTasks({
			projectId: params.projectId,
			stateId: params.stateId,
			assigneeEmployeeId: params.assigneeEmployeeId,
			reporterEmployeeId: params.reporterEmployeeId,
			levelId: params.levelId,
			parentTaskId: params.parentTaskId,
			taskKind:
				params.taskKind === 'ritual_instance'
					? collaboration.TaskKind.RITUAL_INSTANCE
					: params.taskKind === 'standard'
						? collaboration.TaskKind.STANDARD
						: undefined,
			rootOnly: params.rootOnly,
			searchQuery: params.searchQuery,
			cursor: params.cursor,
			limit: params.limit,
			includeCustomFields: params.includeCustomFields ?? false,
		});
		const typed = response as collaboration.ListTasksResponse;
		return {
			tasks: typed.tasks.map(protoTaskToNative),
			nextCursor: typed.nextCursor || undefined,
		};
	});
}

export interface MoveTaskResponse {
	task: Task;
	ruleExecutions: WorkflowRuleExecution[];
}

export async function moveTask(taskId: string, newStateId: string, positionInState?: number): Promise<MoveTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.moveTask({
			taskId,
			newStateId,
			positionInState,
		});
		const typed = response as collaboration.MoveTaskResponse;
		return {
			task: protoTaskToNative(typed.task!),
			ruleExecutions: typed.ruleExecutions.map(protoRuleExecutionToNative),
		};
	});
}

export interface GetTaskByIdentifierResponse {
	task: Task;
}

export async function getTaskByIdentifier(projectId: string, identifier: string): Promise<GetTaskByIdentifierResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.getTaskByIdentifier({ projectId, identifier });
		const typed = response as collaboration.GetTaskByIdentifierResponse;
		return {
			task: protoTaskToNative(typed.task!),
		};
	});
}

// =============================================================================
// Task Assignment API Functions
// =============================================================================

export interface AssignTaskResponse {
	task: Task;
}

export async function assignTask(taskId: string, employeeId: string, role: TaskAssigneeRole): Promise<AssignTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.assignTask({
			taskId,
			employeeId,
			role: stringToProtoAssigneeRole(role),
		});
		const typed = response as collaboration.AssignTaskResponse;
		return {
			task: protoTaskToNative(typed.task!),
		};
	});
}

export interface UnassignTaskResponse {
	task: Task;
}

export async function unassignTask(taskId: string, employeeId: string, role?: TaskAssigneeRole): Promise<UnassignTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.unassignTask({
			taskId,
			employeeId,
			role: role ? stringToProtoAssigneeRole(role) : undefined,
		});
		const typed = response as collaboration.UnassignTaskResponse;
		return {
			task: protoTaskToNative(typed.task!),
		};
	});
}

export interface WatchTaskResponse {
	watching: boolean;
}

export async function watchTask(taskId: string): Promise<WatchTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.watchTask({ taskId });
		const typed = response as collaboration.WatchTaskResponse;
		return {
			watching: typed.watching,
		};
	});
}

export interface UnwatchTaskResponse {
	watching: boolean;
}

export async function unwatchTask(taskId: string): Promise<UnwatchTaskResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.unwatchTask({ taskId });
		const typed = response as collaboration.UnwatchTaskResponse;
		return {
			watching: typed.watching,
		};
	});
}

// =============================================================================
// Custom Field API Functions
// =============================================================================

export interface CreateCustomFieldParams {
	projectId: string;
	name: string;
	description?: string;
	fieldType: CustomFieldType;
	options?: string[];
	defaultValue?: unknown;
	isRequired?: boolean;
	minValue?: number;
	maxValue?: number;
}

export interface CreateCustomFieldResponse {
	field: CustomFieldDefinition;
}

export async function createCustomField(params: CreateCustomFieldParams): Promise<CreateCustomFieldResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.createCustomField({
			projectId: params.projectId,
			name: params.name,
			description: params.description,
			fieldType: stringToProtoFieldType(params.fieldType),
			options: params.options ?? [],
			defaultValue: params.defaultValue ? { case: 'defaultStringValue' as const, value: String(params.defaultValue) } : { case: undefined, value: undefined },
			isRequired: params.isRequired,
			minValue: params.minValue,
			maxValue: params.maxValue,
		});
		const typed = response as collaboration.CreateCustomFieldResponse;
		return {
			field: protoFieldDefToNative(typed.field!),
		};
	});
}

export interface UpdateCustomFieldParams {
	fieldId: string;
	name?: string;
	description?: string;
	options?: string[];
	defaultValue?: unknown;
	isRequired?: boolean;
	minValue?: number;
	maxValue?: number;
}

export interface UpdateCustomFieldResponse {
	field: CustomFieldDefinition;
}

export async function updateCustomField(params: UpdateCustomFieldParams): Promise<UpdateCustomFieldResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.updateCustomField({
			fieldId: params.fieldId,
			name: params.name,
			description: params.description,
			options: params.options ?? [],
			defaultValue: params.defaultValue ? { case: 'defaultStringValue' as const, value: String(params.defaultValue) } : { case: undefined, value: undefined },
			isRequired: params.isRequired,
			minValue: params.minValue,
			maxValue: params.maxValue,
		});
		const typed = response as collaboration.UpdateCustomFieldResponse;
		return {
			field: protoFieldDefToNative(typed.field!),
		};
	});
}

export interface ArchiveCustomFieldResponse {
	field: CustomFieldDefinition;
}

export async function archiveCustomField(fieldId: string, archive: boolean): Promise<ArchiveCustomFieldResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.archiveCustomField({ fieldId, archive });
		const typed = response as collaboration.ArchiveCustomFieldResponse;
		return {
			field: protoFieldDefToNative(typed.field!),
		};
	});
}

export interface ListCustomFieldsParams {
	projectId: string;
	includeArchived?: boolean;
}

export interface ListCustomFieldsResponse {
	fields: CustomFieldDefinition[];
}

export async function listCustomFields(params: ListCustomFieldsParams): Promise<ListCustomFieldsResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.listCustomFields({
			projectId: params.projectId,
			includeArchived: params.includeArchived,
		});
		const typed = response as collaboration.ListCustomFieldsResponse;
		return {
			fields: typed.fields.map(protoFieldDefToNative),
		};
	});
}

export interface SetCustomFieldValueResponse {
	task: Task;
}

export async function setCustomFieldValue(taskId: string, fieldId: string, value: unknown): Promise<SetCustomFieldValueResponse> {
	console.log('[setCustomFieldValue API] Called with:', { taskId, fieldId, value, valueType: typeof value });
	return await rpcCall(async () => {
		// Convert JavaScript value to protobuf oneof structure (SetCustomFieldValueRequest.value is a direct oneof)
		let protoValue: { case: string; value: any };
		
		if (value === null || value === undefined) {
			// No value set - empty oneof
			protoValue = { case: undefined, value: undefined } as any;
		} else if (typeof value === 'string') {
			protoValue = { case: 'stringValue', value } as any;
		} else if (typeof value === 'number') {
			protoValue = { case: 'numberValue', value } as any;
		} else if (typeof value === 'boolean') {
			protoValue = { case: 'boolValue', value } as any;
		} else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
			// String array for multi_select - wrap in StringArray message
			protoValue = { case: 'stringArrayValue', value: { values: value } } as any;
		} else {
			// Unknown type - treat as string
			console.warn('[setCustomFieldValue API] Unknown value type, converting to string:', value);
			protoValue = { case: 'stringValue', value: String(value) } as any;
		}

		console.log('[setCustomFieldValue API] Sending to backend:', { taskId, fieldId, protoValue });
		const response = await collaborationClient.setCustomFieldValue({
			taskId,
			fieldId,
			value: protoValue as collaboration.SetCustomFieldValueRequest['value'],
		});
		console.log('[setCustomFieldValue API] Backend response:', response);
		const typed = response as collaboration.SetCustomFieldValueResponse;
		return {
			task: protoTaskToNative(typed.task!),
		};
	});
}

// =============================================================================
// Workflow Rule API Functions
// =============================================================================

export interface CreateWorkflowRuleParams {
	projectId: string;
	name: string;
	description?: string;
	triggerType: WorkflowTriggerType;
	triggerStateId?: string;
	triggerFieldId?: string;
	triggerCondition?: Record<string, unknown>;
	actionType: WorkflowActionType;
	actionPayload: Record<string, unknown>;
	position?: number;
}

export interface CreateWorkflowRuleResponse {
	rule: WorkflowRule;
}

export async function createWorkflowRule(params: CreateWorkflowRuleParams): Promise<CreateWorkflowRuleResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.createWorkflowRule({
			projectId: params.projectId,
			name: params.name,
			description: params.description,
			triggerType: stringToProtoTriggerType(params.triggerType),
			triggerStateId: params.triggerStateId,
			triggerFieldId: params.triggerFieldId,
			triggerCondition: params.triggerCondition ? params.triggerCondition as unknown as JsonObject : undefined,
			actionType: stringToProtoActionType(params.actionType),
			actionPayload: params.actionPayload as unknown as JsonObject,
			position: params.position,
		});
		const typed = response as collaboration.CreateWorkflowRuleResponse;
		return {
			rule: protoWorkflowRuleToNative(typed.rule!),
		};
	});
}

export interface UpdateWorkflowRuleParams {
	ruleId: string;
	name?: string;
	description?: string;
	triggerType?: WorkflowTriggerType;
	triggerStateId?: string;
	triggerFieldId?: string;
	triggerCondition?: Record<string, unknown>;
	actionType?: WorkflowActionType;
	actionPayload?: Record<string, unknown>;
	position?: number;
	isEnabled?: boolean;
}

export interface UpdateWorkflowRuleResponse {
	rule: WorkflowRule;
}

export async function updateWorkflowRule(params: UpdateWorkflowRuleParams): Promise<UpdateWorkflowRuleResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.updateWorkflowRule({
			ruleId: params.ruleId,
			name: params.name,
			description: params.description,
			triggerType: params.triggerType ? stringToProtoTriggerType(params.triggerType) : undefined,
			triggerStateId: params.triggerStateId,
			triggerFieldId: params.triggerFieldId,
			triggerCondition: params.triggerCondition ? params.triggerCondition as unknown as JsonObject : undefined,
			actionType: params.actionType ? stringToProtoActionType(params.actionType) : undefined,
			actionPayload: params.actionPayload ? params.actionPayload as unknown as JsonObject : undefined,
			position: params.position,
			isEnabled: params.isEnabled,
		});
		const typed = response as collaboration.UpdateWorkflowRuleResponse;
		return {
			rule: protoWorkflowRuleToNative(typed.rule!),
		};
	});
}

export async function deleteWorkflowRule(ruleId: string): Promise<void> {
	return await rpcCall(async () => {
		await collaborationClient.deleteWorkflowRule({ ruleId });
	});
}

export interface ListWorkflowRulesParams {
	projectId: string;
	includeDisabled?: boolean;
}

export interface ListWorkflowRulesResponse {
	rules: WorkflowRule[];
}

export async function listWorkflowRules(params: ListWorkflowRulesParams): Promise<ListWorkflowRulesResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.listWorkflowRules({
			projectId: params.projectId,
			includeDisabled: params.includeDisabled,
		});
		const typed = response as collaboration.ListWorkflowRulesResponse;
		return {
			rules: typed.rules.map(protoWorkflowRuleToNative),
		};
	});
}

// =============================================================================
// Project Membership API Functions
// =============================================================================

export interface AddProjectMemberResponse {
	member: ProjectMember;
}

export async function addProjectMember(projectId: string, employeeId: string, role: ProjectMemberRole): Promise<AddProjectMemberResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.addProjectMember({
			projectId,
			employeeId,
			role: stringToProtoMemberRole(role),
		});
		const typed = response as collaboration.AddProjectMemberResponse;
		return {
			member: protoMemberToNative(typed.member!),
		};
	});
}

export async function removeProjectMember(projectId: string, employeeId: string): Promise<void> {
	return await rpcCall(async () => {
		await collaborationClient.removeProjectMember({ projectId, employeeId });
	});
}

export interface UpdateProjectMemberRoleResponse {
	member: ProjectMember;
}

export async function updateProjectMemberRole(projectId: string, employeeId: string, role: ProjectMemberRole): Promise<UpdateProjectMemberRoleResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.updateProjectMemberRole({
			projectId,
			employeeId,
			role: stringToProtoMemberRole(role),
		});
		const typed = response as collaboration.UpdateProjectMemberRoleResponse;
		return {
			member: protoMemberToNative(typed.member!),
		};
	});
}

export interface ListProjectMembersResponse {
	members: ProjectMember[];
}

export async function listProjectMembers(projectId: string): Promise<ListProjectMembersResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.listProjectMembers({ projectId });
		const typed = response as collaboration.ListProjectMembersResponse;
		return {
			members: typed.members.map(protoMemberToNative),
		};
	});
}

// =============================================================================
// Saved View API Functions
// =============================================================================

export interface CreateSavedViewParams {
	projectId: string;
	name: string;
	viewType: ViewType;
	config: Record<string, unknown>;
	isShared?: boolean;
	isDefault?: boolean;
}

export interface CreateSavedViewResponse {
	view: SavedView;
}

export async function createSavedView(params: CreateSavedViewParams): Promise<CreateSavedViewResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.createSavedView({
			projectId: params.projectId,
			name: params.name,
			viewType: stringToProtoViewType(params.viewType),
			config: params.config as unknown as JsonObject,
			isShared: params.isShared,
			isDefault: params.isDefault,
		});
		const typed = response as collaboration.CreateSavedViewResponse;
		return {
			view: protoViewToNative(typed.view!),
		};
	});
}

export interface UpdateSavedViewParams {
	viewId: string;
	name?: string;
	config?: Record<string, unknown>;
	isDefault?: boolean;
	position?: number;
}

export interface UpdateSavedViewResponse {
	view: SavedView;
}

export async function updateSavedView(params: UpdateSavedViewParams): Promise<UpdateSavedViewResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.updateSavedView({
			viewId: params.viewId,
			name: params.name,
			config: params.config ? params.config as unknown as JsonObject : undefined,
			isDefault: params.isDefault,
			position: params.position,
		});
		const typed = response as collaboration.UpdateSavedViewResponse;
		return {
			view: protoViewToNative(typed.view!),
		};
	});
}

export async function deleteSavedView(viewId: string): Promise<void> {
	return await rpcCall(async () => {
		await collaborationClient.deleteSavedView({ viewId });
	});
}

export interface ListSavedViewsResponse {
	views: SavedView[];
}

export async function listSavedViews(projectId: string): Promise<ListSavedViewsResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.listSavedViews({ projectId });
		const typed = response as collaboration.ListSavedViewsResponse;
		return {
			views: typed.views.map(protoViewToNative),
		};
	});
}

// =============================================================================
// Analytics API Functions
// =============================================================================

export interface GetTaskAnalyticsParams {
	projectId: string;
	groupBy?: string[];
	aggregations?: Array<{
		field: string;
		function: string;
		alias: string;
	}>;
	filters?: Array<{
		field: string;
		operator: string;
		value: unknown;
	}>;
	startDate?: string;
	endDate?: string;
}

export interface GetTaskAnalyticsResponse {
	rows: AnalyticsRow[];
	summary: AnalyticsSummary;
}

export async function getTaskAnalytics(params: GetTaskAnalyticsParams): Promise<GetTaskAnalyticsResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.getTaskAnalytics({
			projectId: params.projectId,
			groupBy: params.groupBy ?? [],
			aggregations: params.aggregations?.map(a => ({
				field: a.field,
				function: a.function,
				alias: a.alias,
			})) ?? [],
			filters: params.filters?.map(f => ({
				field: f.field,
				operator: f.operator,
				value: { value: { case: 'stringValue' as const, value: String(f.value) } },
			})) ?? [],
			startDate: params.startDate,
			endDate: params.endDate,
		});
		const typed = response as collaboration.GetTaskAnalyticsResponse;
		return {
			rows: typed.rows.map(r => ({
				dimensions: Object.fromEntries(
					Object.entries(r.dimensions).map(([k, v]) => [k, (v as any)?.kind?.value ?? v])
				),
				metrics: r.metrics,
			})),
			summary: {
				totalTasks: typed.summary?.totalTasks ?? 0,
				completedTasks: typed.summary?.completedTasks ?? 0,
				openTasks: typed.summary?.openTasks ?? 0,
				completionRate: typed.summary?.completionRate ?? 0,
			},
		};
	});
}

export interface ExportTasksCSVParams {
	projectId: string;
	columns?: string[];
	filters?: Array<{
		field: string;
		operator: string;
		value: unknown;
	}>;
}

export interface ExportTasksCSVResponse {
	csvData: Uint8Array;
	filename: string;
}

export async function exportTasksCSV(params: ExportTasksCSVParams): Promise<ExportTasksCSVResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.exportTasksCSV({
			projectId: params.projectId,
			columns: params.columns ?? [],
			filters: params.filters?.map(f => ({
				field: f.field,
				operator: f.operator,
				value: { value: { case: 'stringValue' as const, value: String(f.value) } },
			})) ?? [],
		});
		const typed = response as collaboration.ExportTasksCSVResponse;
		return {
			csvData: typed.csvData,
			filename: typed.filename,
		};
	});
}

// =============================================================================
// Task File Upload API Functions
// =============================================================================
// Architecture: Domain-owned upload flow (same pattern as ChatFileService)
// CollaborationService owns task attachment uploads to ensure:
// - Project membership verification at upload time (security)
// - Access scope derived from project visibility (server-side, not client-controlled)
// =============================================================================

/**
 * Response from requestTaskFileUpload with presigned upload URL
 */
export interface TaskUploadURLResponse {
	fileId: string;
	uploadUrl: string;
	expiresAt: Date;
}

/**
 * File metadata returned after confirming task file upload
 */
export interface TaskFileMetadata {
	id: string;
	originalFilename: string;
	storageKey: string;
	sizeBytes: number;
	mimeType: string;
	uploadContext: string;
	uploadedByEmployeeId: string;
	updatedAt: Date;
	isDeleted: boolean;
	validationStatus: string;
	validationMessage: string;
	detectedMimeType: string;
}

/**
 * Response from confirmTaskFileUpload including updated task
 */
export interface ConfirmTaskFileUploadResponse {
	file: TaskFileMetadata;
	task: {
		id: string;
		fileIds: string[];
	};
}

/**
 * Request presigned upload URL for task attachment.
 * 
 * Security:
 * - Backend verifies project membership (returns PermissionDenied if not member for private projects)
 * - Backend derives access_scope from project.visibility (server-side, not client-controlled)
 * - Only project members can upload attachments to private project tasks
 * 
 * @param params - Upload request parameters
 * @param params.taskId - Task ID where file will be attached
 * @param params.filename - Original filename (e.g., "report.docx")
 * @param params.mimeType - MIME type (e.g., "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
 * @param params.sizeBytes - File size in bytes
 * @returns Upload URL and file ID
 * @throws {APIError} Code.PermissionDenied if not a project member (for private projects)
 * @throws {APIError} Code.NotFound if task doesn't exist
 * @throws {APIError} Code.ResourceExhausted if quota exceeded
 */
export async function requestTaskFileUpload(params: {
	taskId: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
}): Promise<TaskUploadURLResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.requestTaskFileUpload({
			taskId: params.taskId,
			filename: params.filename,
			mimeType: params.mimeType,
			sizeBytes: BigInt(params.sizeBytes),
		});
		const typed = response as collaboration.RequestTaskFileUploadResponse;
		return {
			fileId: typed.fileId,
			uploadUrl: typed.uploadUrl,
			expiresAt: protoTimestampToDate(typed.expiresAt) ?? new Date(),
		};
	});
}

/**
 * Confirm file upload after client successfully uploads to R2.
 * 
 * Security:
 * - Backend verifies project membership again (prevents race condition)
 * - Backend appends file ID to task's file_ids array
 * - Backend atomically increments organization quota usage
 * 
 * Triggers async workflows:
 * - File type validation (detect MIME type mismatches)
 * - PDF conversion (if office document)
 * - Content indexing (for full-text search)
 * 
 * @param params - Confirm request parameters
 * @param params.taskId - Task ID where file was attached
 * @param params.fileId - File ID from requestTaskFileUpload
 * @returns File metadata and updated task with new file_ids array
 * @throws {APIError} Code.PermissionDenied if not a project member (for private projects)
 * @throws {APIError} Code.NotFound if task or file doesn't exist
 */
export async function confirmTaskFileUpload(params: {
	taskId: string;
	fileId: string;
}): Promise<ConfirmTaskFileUploadResponse> {
	return await rpcCall(async () => {
		const response = await collaborationClient.confirmTaskFileUpload({
			taskId: params.taskId,
			fileId: params.fileId,
		});
		const typed = response as collaboration.ConfirmTaskFileUploadResponse;
		
		if (!typed.file) {
			throw new Error("File metadata not returned from server");
		}
		
		return {
			file: {
				id: typed.file.id,
				originalFilename: typed.file.originalFilename,
				storageKey: typed.file.storageKey,
				sizeBytes: Number(typed.file.sizeBytes),
				mimeType: typed.file.mimeType,
				uploadContext: typed.file.uploadContext,
				uploadedByEmployeeId: typed.file.uploadedByEmployeeId,
				updatedAt: protoTimestampToDate(typed.file.updatedAt) ?? new Date(),
				isDeleted: typed.file.isDeleted,
				validationStatus: typed.file.validationStatus,
				validationMessage: typed.file.validationMessage,
				detectedMimeType: typed.file.detectedMimeType,
			},
			task: {
				id: typed.task?.id ?? '',
				fileIds: typed.task?.fileIds ?? [],
			},
		};
	});
}
