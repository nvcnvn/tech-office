/**
 * Ritual Task API functions
 * ConnectRPC-based API calls for the recurring ritual tasks system.
 * Feature: 022-recurring-ritual-tasks-system-for
 */

import { collaborationClient } from './rpc';
import rpcCall from './rpcWrapper';
import { protoTimestampToDate, dateToProtoTimestamp } from './proto-utils';
import { collaboration } from 'rpc';
import type { CollaborationMode, RitualInstanceTask, Task } from './collaboration';
import { getTask, isRitualInstanceTask, listTasks } from './collaboration';

// =============================================================================
// Type Definitions — Enums
// =============================================================================

export type TaskKind = 'standard' | 'ritual_instance';
export type RecurrenceType = 'daily' | 'weekly' | 'monthly' | 'custom_interval';
export type EvidenceType =
	| 'photo'
	| 'voice_memo'
	| 'pdf'
	| 'file'
	| 'link'
	| 'text_note'
	| 'gps_checkin';
export type ApprovalMode = 'manual' | 'auto_approve';
export type ApprovalStatus = 'pending_review' | 'approved' | 'rejected';

// =============================================================================
// Type Definitions — Interfaces
// =============================================================================

export interface GpsTarget {
	latitude: number;
	longitude: number;
}

export interface GpsCoordinates {
	latitude: number;
	longitude: number;
	accuracyMeters: number;
}

export interface AutoApproveConfig {
	gpsTarget?: GpsTarget;
	gpsRadiusMeters: number;
	deadlineTime: string; // "HH:MM"
}

export interface NthWeekday {
	/** 1-5 (which week of the month) */
	week: number;
	/** 1=Mon..7=Sun */
	day: number;
}

export interface RecurrenceRule {
	type: RecurrenceType;
	interval: number;
	daysOfWeek: number[];
	dayOfMonth: number;
	nthWeekday?: NthWeekday;
}

export interface EvidenceRequirementDetail {
	id: string;
	ritualDefinitionId: string;
	name: string;
	description: string;
	evidenceTypes: EvidenceType[];
	isRequired: boolean;
	approvalMode: ApprovalMode;
	autoApproveConfig?: AutoApproveConfig;
	position: number;
	deadlineOffsetHours: number;
}

export interface RitualDefinition {
	id: string;
	projectId: string;
	name: string;
	description: string;
	recurrenceRule?: RecurrenceRule;
	completionWindowHours: number;
	timezone: string;
	isArchived: boolean;
	createdByEmployeeId: string;
	defaultAssigneeIds: string[];
	evidenceRequirements: EvidenceRequirementDetail[];
	defaultDepartmentPools: RitualDepartmentPool[];
	updatedAt?: Date;
	scheduleVersion: number;
}

export type AssignmentStrategy = 'round_robin' | 'least_assigned';

export interface RitualDepartmentPool {
	/** UUID of the pool config row */
	id: string;
	departmentId: string;
	departmentName: string;
	assignmentStrategy: AssignmentStrategy;
	/** Waterline: last employee assigned from this pool (read-only) */
	lastAssignedEmployeeId?: string;
}

export interface RitualDepartmentPoolInput {
	departmentId: string;
	assignmentStrategy: AssignmentStrategy;
}

export interface EvidenceSubmission {
	id: string;
	taskId: string;
	evidenceRequirementId: string;
	submittedByEmployeeId: string;
	evidenceType: EvidenceType;
	fileId?: string;
	textContent?: string;
	linkUrl?: string;
	deviceTimestamp?: Date;
	serverTimestamp?: Date;
	gpsCoordinates?: GpsCoordinates;
	approvalStatus: ApprovalStatus;
	reviewedByEmployeeId?: string;
	reviewedAt?: Date;
	reviewerComment?: string;
}

export interface TaskEvidenceRequirementStatus {
	requirementId: string;
	requirementName: string;
	isRequired: boolean;
	latestSubmission?: EvidenceSubmission;
	approvalStatus: ApprovalStatus;
}

export interface TaskEvidenceProgress {
	totalRequirements: number;
	approvedCount: number;
	pendingCount: number;
	rejectedCount: number;
	missingCount: number;
	requirementStatuses: TaskEvidenceRequirementStatus[];
}

export interface RitualTaskHydrationOptions {
	includeCustomFields?: boolean;
	includeEvidenceSubmissions?: boolean;
}

export interface RitualTaskHydrationResult {
	task: RitualInstanceTask;
	ritualDefinition: RitualDefinition;
	evidenceSubmissions: EvidenceSubmission[];
	latestSubmissionByRequirementId: Record<string, EvidenceSubmission>;
}

export interface RitualReviewBacklogItem {
	taskId: string;
	projectId: string;
	taskIdentifier: string;
	taskTitle: string;
	ritualDefinitionId: string;
	ritualName: string;
	completionDeadline?: Date;
	pendingReviewCount: number;
	pendingRequirementNames: string[];
	focusRequirementId?: string;
	latestPendingSubmission?: EvidenceSubmission;
	assigneeEmployeeIds: string[];
}

export interface OperationalHealthSummary {
	projectId: string;
	totalInstances: number;
	onTimeCount: number;
	overdueCount: number;
	missedCount: number;
	pendingReviewCount: number;
	completionRate: number;
	onTimeRate: number;
}

export interface RitualHealthDetail {
	ritualDefinitionId: string;
	ritualName: string;
	totalInstances: number;
	verifiedCount: number;
	overdueCount: number;
	missedCount: number;
	healthScore: number;
}

export interface EmployeeComplianceSummary {
	employeeId: string;
	employeeName: string;
	totalAssigned: number;
	completedOnTime: number;
	completedLate: number;
	missedCount: number;
	complianceRate: number;
}

export interface RitualWorklistBuckets {
	overdue: RitualInstanceTask[];
	today: RitualInstanceTask[];
	upcoming: RitualInstanceTask[];
	needsResubmission: RitualInstanceTask[];
	pendingReview: RitualInstanceTask[];
}

export interface MixedOverviewSummary {
	projectId: string;
	standardTaskCount: number;
	ritualTaskCount: number;
	overdueRitualCount: number;
	todayRitualCount: number;
	pendingReviewCount: number;
	needsAttentionNow: Array<{
		kind: 'standard' | 'ritual_instance';
		taskId: string;
		title: string;
		identifier: string;
	}>;
}

// =============================================================================
// Protocol Enum Converters
// =============================================================================

export function protoTaskKindToString(k: collaboration.TaskKind): TaskKind {
	if (k === collaboration.TaskKind.RITUAL_INSTANCE) return 'ritual_instance';
	return 'standard';
}

export function stringToProtoTaskKind(k: TaskKind): collaboration.TaskKind {
	if (k === 'ritual_instance') return collaboration.TaskKind.RITUAL_INSTANCE;
	return collaboration.TaskKind.STANDARD;
}

function protoEvidenceTypeToString(
	t: collaboration.EvidenceType
): EvidenceType {
	switch (t) {
		case collaboration.EvidenceType.PHOTO:
			return 'photo';
		case collaboration.EvidenceType.VOICE_MEMO:
			return 'voice_memo';
		case collaboration.EvidenceType.PDF:
			return 'pdf';
		case collaboration.EvidenceType.FILE:
			return 'file';
		case collaboration.EvidenceType.LINK:
			return 'link';
		case collaboration.EvidenceType.TEXT_NOTE:
			return 'text_note';
		case collaboration.EvidenceType.GPS_CHECKIN:
			return 'gps_checkin';
		default:
			return 'file';
	}
}

export function stringToProtoEvidenceType(
	t: EvidenceType
): collaboration.EvidenceType {
	switch (t) {
		case 'photo':
			return collaboration.EvidenceType.PHOTO;
		case 'voice_memo':
			return collaboration.EvidenceType.VOICE_MEMO;
		case 'pdf':
			return collaboration.EvidenceType.PDF;
		case 'file':
			return collaboration.EvidenceType.FILE;
		case 'link':
			return collaboration.EvidenceType.LINK;
		case 'text_note':
			return collaboration.EvidenceType.TEXT_NOTE;
		case 'gps_checkin':
			return collaboration.EvidenceType.GPS_CHECKIN;
	}
}

function protoApprovalModeToString(
	m: collaboration.ApprovalMode
): ApprovalMode {
	if (m === collaboration.ApprovalMode.AUTO_APPROVE) return 'auto_approve';
	return 'manual';
}

export function stringToProtoApprovalMode(
	m: ApprovalMode
): collaboration.ApprovalMode {
	if (m === 'auto_approve') return collaboration.ApprovalMode.AUTO_APPROVE;
	return collaboration.ApprovalMode.MANUAL;
}

function protoApprovalStatusToString(
	s: collaboration.ApprovalStatus
): ApprovalStatus {
	switch (s) {
		case collaboration.ApprovalStatus.APPROVED:
			return 'approved';
		case collaboration.ApprovalStatus.REJECTED:
			return 'rejected';
		default:
			return 'pending_review';
	}
}

function protoRecurrenceTypeToString(
	t: collaboration.RecurrenceType
): RecurrenceType {
	switch (t) {
		case collaboration.RecurrenceType.WEEKLY:
			return 'weekly';
		case collaboration.RecurrenceType.MONTHLY:
			return 'monthly';
		case collaboration.RecurrenceType.CUSTOM_INTERVAL:
			return 'custom_interval';
		default:
			return 'daily';
	}
}

export function stringToProtoRecurrenceType(
	t: RecurrenceType
): collaboration.RecurrenceType {
	switch (t) {
		case 'weekly':
			return collaboration.RecurrenceType.WEEKLY;
		case 'monthly':
			return collaboration.RecurrenceType.MONTHLY;
		case 'custom_interval':
			return collaboration.RecurrenceType.CUSTOM_INTERVAL;
		default:
			return collaboration.RecurrenceType.DAILY;
	}
}

// =============================================================================
// Proto → Domain Object Converters
// =============================================================================

function protoToEvidenceRequirement(
	r: collaboration.EvidenceRequirementDetail
): EvidenceRequirementDetail {
	return {
		id: r.id,
		ritualDefinitionId: r.ritualDefinitionId,
		name: r.name,
		description: r.description,
		evidenceTypes: r.evidenceTypes.map(protoEvidenceTypeToString),
		isRequired: r.isRequired,
		approvalMode: protoApprovalModeToString(r.approvalMode),
		autoApproveConfig: r.autoApproveConfig
			? {
					gpsTarget: r.autoApproveConfig.gpsTarget
						? {
								latitude: r.autoApproveConfig.gpsTarget.latitude,
								longitude: r.autoApproveConfig.gpsTarget.longitude,
						  }
						: undefined,
					gpsRadiusMeters: r.autoApproveConfig.gpsRadiusMeters,
					deadlineTime: r.autoApproveConfig.deadlineTime,
			  }
			: undefined,
		position: r.position,
		deadlineOffsetHours: r.deadlineOffsetHours,
	};
}

function protoToRecurrenceRule(
	r: collaboration.RecurrenceRule
): RecurrenceRule {
	return {
		type: protoRecurrenceTypeToString(r.type),
		interval: r.interval,
		daysOfWeek: r.daysOfWeek.map(Number),
		dayOfMonth: r.dayOfMonth,
		nthWeekday: r.nthWeekday
			? { week: r.nthWeekday.week, day: r.nthWeekday.day }
			: undefined,
	};
}

function protoToRitualDefinition(
	d: collaboration.RitualDefinition
): RitualDefinition {
	return {
		id: d.id,
		projectId: d.projectId,
		name: d.name,
		description: d.description,
		recurrenceRule: d.recurrenceRule
			? protoToRecurrenceRule(d.recurrenceRule)
			: undefined,
		completionWindowHours: d.completionWindowHours,
		timezone: d.timezone,
		isArchived: d.isArchived,
		createdByEmployeeId: d.createdByEmployeeId,
		defaultAssigneeIds: d.defaultAssigneeIds,
		evidenceRequirements: d.evidenceRequirements.map(
			protoToEvidenceRequirement
		),
		defaultDepartmentPools: d.defaultDepartmentPools.map((p) => ({
			id: p.id,
			departmentId: p.departmentId,
			departmentName: p.departmentName,
			assignmentStrategy: (p.assignmentStrategy || 'round_robin') as AssignmentStrategy,
			lastAssignedEmployeeId: p.lastAssignedEmployeeId || undefined,
		})),
		updatedAt: d.updatedAt ? protoTimestampToDate(d.updatedAt) : undefined,
		scheduleVersion: d.scheduleVersion,
	};
}

function protoToEvidenceSubmission(
	s: collaboration.EvidenceSubmission
): EvidenceSubmission {
	const gpsCoordinates = normalizeGpsCoordinates(s.gpsCoordinates);

	return {
		id: s.id,
		taskId: s.taskId,
		evidenceRequirementId: s.evidenceRequirementId,
		submittedByEmployeeId: s.submittedByEmployeeId,
		evidenceType: protoEvidenceTypeToString(s.evidenceType),
		fileId: s.fileId || undefined,
		textContent: s.textContent || undefined,
		linkUrl: s.linkUrl || undefined,
		deviceTimestamp: s.deviceTimestamp
			? protoTimestampToDate(s.deviceTimestamp)
			: undefined,
		serverTimestamp: s.serverTimestamp
			? protoTimestampToDate(s.serverTimestamp)
			: undefined,
		gpsCoordinates,
		approvalStatus: protoApprovalStatusToString(s.approvalStatus),
		reviewedByEmployeeId: s.reviewedByEmployeeId || undefined,
		reviewedAt: s.reviewedAt ? protoTimestampToDate(s.reviewedAt) : undefined,
		reviewerComment: s.reviewerComment || undefined,
	};
}

function normalizeGpsCoordinates(
	coordinates: collaboration.GpsCoordinates | undefined,
): GpsCoordinates | undefined {
	if (!coordinates) {
		return undefined;
	}

	const latitude = coordinates.latitude;
	const longitude = coordinates.longitude;
	const accuracyMeters = coordinates.accuracyMeters;
	const isFiniteCoordinate = Number.isFinite(latitude) && Number.isFinite(longitude);
	const isInRange = latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
	const looksLikeDefaultZero = latitude === 0 && longitude === 0 && (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0);

	if (!isFiniteCoordinate || !isInRange || looksLikeDefaultZero) {
		return undefined;
	}

	return {
		latitude,
		longitude,
		accuracyMeters,
	};
}

function buildLatestSubmissionByRequirementId(
	submissions: EvidenceSubmission[]
): Record<string, EvidenceSubmission> {
	const latestByRequirementId: Record<string, EvidenceSubmission> = {};

	for (const submission of submissions) {
		const existing = latestByRequirementId[submission.evidenceRequirementId];
		const existingTimestamp = existing?.serverTimestamp?.getTime() ?? 0;
		const submissionTimestamp = submission.serverTimestamp?.getTime() ?? 0;

		if (!existing || submissionTimestamp >= existingTimestamp) {
			latestByRequirementId[submission.evidenceRequirementId] = submission;
		}
	}

	return latestByRequirementId;
}

// =============================================================================
// Ritual Definition API
// =============================================================================

export interface CreateRitualDefinitionParams {
	projectId: string;
	name: string;
	description?: string;
	recurrenceRule: RecurrenceRule;
	completionWindowHours: number;
	timezone: string;
	defaultAssigneeIds?: string[];
	defaultDepartmentPools?: RitualDepartmentPoolInput[];
}

export async function createRitualDefinition(
	params: CreateRitualDefinitionParams
): Promise<RitualDefinition> {
	return rpcCall(async () => {
		const res = await collaborationClient.createRitualDefinition({
			projectId: params.projectId,
			name: params.name,
			description: params.description ?? '',
			recurrenceRule: {
				type: stringToProtoRecurrenceType(params.recurrenceRule.type),
				interval: params.recurrenceRule.interval,
				daysOfWeek: params.recurrenceRule.daysOfWeek,
				dayOfMonth: params.recurrenceRule.dayOfMonth,
				nthWeekday: params.recurrenceRule.nthWeekday
					? { week: params.recurrenceRule.nthWeekday.week, day: params.recurrenceRule.nthWeekday.day }
					: undefined,
			},
			completionWindowHours: params.completionWindowHours,
			timezone: params.timezone,
			defaultAssigneeIds: params.defaultAssigneeIds ?? [],
			defaultDepartmentPools: (params.defaultDepartmentPools ?? []).map((p) => ({
				departmentId: p.departmentId,
				assignmentStrategy: p.assignmentStrategy,
			})),
		});
		if (!res.ritualDefinition) throw new Error('No ritual definition returned');
		return protoToRitualDefinition(res.ritualDefinition);
	});
}

export async function getRitualDefinition(
	ritualDefinitionId: string
): Promise<RitualDefinition> {
	return rpcCall(async () => {
		const res = await collaborationClient.getRitualDefinition({
			ritualDefinitionId,
		});
		if (!res.ritualDefinition) throw new Error('No ritual definition returned');
		return protoToRitualDefinition(res.ritualDefinition);
	});
}

export async function hydrateRitualTask(
	taskOrTaskId: RitualInstanceTask | Task | string,
	options: RitualTaskHydrationOptions = {}
): Promise<RitualTaskHydrationResult | null> {
	const task =
		typeof taskOrTaskId === 'string'
			? (await getTask(taskOrTaskId, options.includeCustomFields)).task
			: taskOrTaskId;

	if (!isRitualInstanceTask(task)) {
		return null;
	}

	const [ritualDefinition, evidenceSubmissions] = await Promise.all([
		getRitualDefinition(task.ritualDefinitionId),
		options.includeEvidenceSubmissions === false
			? Promise.resolve([])
			: listEvidenceSubmissions(task.id),
	]);

	return {
		task,
		ritualDefinition,
		evidenceSubmissions,
		latestSubmissionByRequirementId: buildLatestSubmissionByRequirementId(evidenceSubmissions),
	};
}

export async function listRitualReviewBacklog(
	projectId: string
): Promise<RitualReviewBacklogItem[]> {
	const { tasks } = await listTasks({
		projectId,
		taskKind: 'ritual_instance',
		rootOnly: false,
	});

	const ritualTasks = tasks.filter(isRitualInstanceTask);

	if (ritualTasks.length === 0) {
		return [];
	}

	const uniqueDefinitionIds = Array.from(
		new Set(ritualTasks.map((task) => task.ritualDefinitionId))
	);
	const definitions = await Promise.all(
		uniqueDefinitionIds.map(async (definitionId) => [
			definitionId,
			await getRitualDefinition(definitionId),
		] as const)
	);
	const definitionMap = new Map(definitions);

	const backlogItems = await Promise.all(
		ritualTasks.map(async (task) => {
			const ritualDefinition = definitionMap.get(task.ritualDefinitionId);
			if (!ritualDefinition) {
				return null;
			}

			const pendingSubmissions = (await listEvidenceSubmissions(task.id)).filter(
				(submission) => submission.approvalStatus === 'pending_review'
			);

			if (pendingSubmissions.length === 0) {
				return null;
			}

			const requirementNameById = new Map(
				ritualDefinition.evidenceRequirements.map((requirement) => [
					requirement.id,
					requirement.name,
				] as const)
			);
			const sortedPendingSubmissions = pendingSubmissions
				.slice()
				.sort(
					(left, right) =>
						(right.serverTimestamp?.getTime() ?? 0) - (left.serverTimestamp?.getTime() ?? 0)
				);
			const latestPendingSubmission = sortedPendingSubmissions[0];
			const focusRequirementId = latestPendingSubmission?.evidenceRequirementId;
			const backlogItem: RitualReviewBacklogItem = {
				taskId: task.id,
				projectId: task.projectId,
				taskIdentifier: task.identifier,
				taskTitle: task.title,
				ritualDefinitionId: ritualDefinition.id,
				ritualName: ritualDefinition.name,
				completionDeadline: task.completionDeadline,
				pendingReviewCount: sortedPendingSubmissions.length,
				pendingRequirementNames: Array.from(
					new Set(
						sortedPendingSubmissions.map(
							(submission) =>
								requirementNameById.get(submission.evidenceRequirementId) ??
								'Pending evidence'
						)
					)
				),
				assigneeEmployeeIds: task.assignees.map((assignee) => assignee.employeeId),
			};

			if (focusRequirementId) {
				backlogItem.focusRequirementId = focusRequirementId;
			}

			if (latestPendingSubmission) {
				backlogItem.latestPendingSubmission = latestPendingSubmission;
			}

			return backlogItem;
		})
	);

	return backlogItems
		.filter((item): item is RitualReviewBacklogItem => item !== null)
		.sort((left, right) => {
			const leftDeadline = left.completionDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;
			const rightDeadline = right.completionDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER;

			if (leftDeadline !== rightDeadline) {
				return leftDeadline - rightDeadline;
			}

			if (left.pendingReviewCount !== right.pendingReviewCount) {
				return right.pendingReviewCount - left.pendingReviewCount;
			}

			return left.taskIdentifier.localeCompare(right.taskIdentifier);
		});
}

function startOfDay(date: Date): Date {
	const normalized = new Date(date);
	normalized.setHours(0, 0, 0, 0);
	return normalized;
}

function classifyRitualTaskBucket(task: RitualInstanceTask, now: Date): keyof RitualWorklistBuckets {
	if ((task.evidenceProgress?.rejectedCount ?? 0) > 0) {
		return 'needsResubmission';
	}

	if ((task.evidenceProgress?.pendingReviewCount ?? 0) > 0) {
		return 'pendingReview';
	}

	const today = startOfDay(now).getTime();
	const scheduled = task.scheduledDate ? startOfDay(new Date(task.scheduledDate)).getTime() : undefined;
	const deadline = task.completionDeadline?.getTime();

	if ((deadline !== undefined && deadline < now.getTime()) || (scheduled !== undefined && scheduled < today)) {
		return 'overdue';
	}

	if (scheduled !== undefined && scheduled === today) {
		return 'today';
	}

	return 'upcoming';
}

export function groupRitualWorklistBuckets(
	tasks: Array<Task | RitualInstanceTask>,
	now: Date = new Date()
): RitualWorklistBuckets {
	const buckets: RitualWorklistBuckets = {
		overdue: [],
		today: [],
		upcoming: [],
		needsResubmission: [],
		pendingReview: [],
	};

	for (const task of tasks) {
		if (!isRitualInstanceTask(task)) {
			continue;
		}

		const bucket = classifyRitualTaskBucket(task, now);
		buckets[bucket].push(task);
	}

	return buckets;
}

export function buildMixedOverviewSummary(
	projectId: string,
	tasks: Array<Task | RitualInstanceTask>,
	now: Date = new Date()
): MixedOverviewSummary {
	const ritualBuckets = groupRitualWorklistBuckets(tasks, now);
	const standardTasks = tasks.filter((task) => task.taskKind === 'standard');
	const ritualTasks = tasks.filter(isRitualInstanceTask);
	const today = startOfDay(now).getTime();
	const needsAttentionNow = [
		...ritualBuckets.overdue,
		...ritualBuckets.needsResubmission,
		...standardTasks.filter((task) => !!task.dueDate && startOfDay(new Date(task.dueDate)).getTime() <= today),
	]
		.sort((left, right) => left.identifier.localeCompare(right.identifier))
		.map((task) => ({
			kind: task.taskKind,
			taskId: task.id,
			title: task.title,
			identifier: task.identifier,
		}));

	return {
		projectId,
		standardTaskCount: standardTasks.length,
		ritualTaskCount: ritualTasks.length,
		overdueRitualCount: ritualBuckets.overdue.length,
		todayRitualCount: ritualBuckets.today.length,
		pendingReviewCount: ritualBuckets.pendingReview.length,
		needsAttentionNow,
	};
}

export interface UpdateRitualDefinitionParams {
	ritualDefinitionId: string;
	name?: string;
	description?: string;
	recurrenceRule?: RecurrenceRule;
	completionWindowHours?: number;
	timezone?: string;
	defaultAssigneeIds?: string[];
	defaultDepartmentPools?: RitualDepartmentPoolInput[];
}

export async function updateRitualDefinition(
	params: UpdateRitualDefinitionParams
): Promise<RitualDefinition> {
	return rpcCall(async () => {
		const res = await collaborationClient.updateRitualDefinition({
			ritualDefinitionId: params.ritualDefinitionId,
			name: params.name,
			description: params.description,
			recurrenceRule: params.recurrenceRule
				? {
						type: stringToProtoRecurrenceType(params.recurrenceRule.type),
						interval: params.recurrenceRule.interval,
						daysOfWeek: params.recurrenceRule.daysOfWeek,
						dayOfMonth: params.recurrenceRule.dayOfMonth,
						nthWeekday: params.recurrenceRule.nthWeekday
							? { week: params.recurrenceRule.nthWeekday.week, day: params.recurrenceRule.nthWeekday.day }
							: undefined,
				  }
				: undefined,
			completionWindowHours: params.completionWindowHours,
			timezone: params.timezone,
			defaultAssigneeIds: params.defaultAssigneeIds,
			defaultDepartmentPools: params.defaultDepartmentPools?.map((p) => ({
				departmentId: p.departmentId,
				assignmentStrategy: p.assignmentStrategy,
			})),
		});
		if (!res.ritualDefinition) throw new Error('No ritual definition returned');
		return protoToRitualDefinition(res.ritualDefinition);
	});
}

export async function archiveRitualDefinition(
	ritualDefinitionId: string,
	archive: boolean
): Promise<RitualDefinition> {
	return rpcCall(async () => {
		const res = await collaborationClient.archiveRitualDefinition({
			ritualDefinitionId,
			archive,
		});
		if (!res.ritualDefinition) throw new Error('No ritual definition returned');
		return protoToRitualDefinition(res.ritualDefinition);
	});
}

export async function listRitualDefinitions(
	projectId: string,
	includeArchived = false
): Promise<RitualDefinition[]> {
	return rpcCall(async () => {
		const res = await collaborationClient.listRitualDefinitions({
			projectId,
			includeArchived,
		});
		return res.ritualDefinitions.map(protoToRitualDefinition);
	});
}

// =============================================================================
// Evidence Requirement API
// =============================================================================

export interface CreateEvidenceRequirementParams {
	ritualDefinitionId: string;
	name: string;
	description?: string;
	evidenceTypes: EvidenceType[];
	isRequired: boolean;
	approvalMode: ApprovalMode;
	autoApproveConfig?: AutoApproveConfig;
	deadlineOffsetHours?: number;
}

export async function createEvidenceRequirement(
	params: CreateEvidenceRequirementParams
): Promise<EvidenceRequirementDetail> {
	return rpcCall(async () => {
		const res = await collaborationClient.createEvidenceRequirement({
			ritualDefinitionId: params.ritualDefinitionId,
			name: params.name,
			description: params.description ?? '',
			evidenceTypes: params.evidenceTypes.map(stringToProtoEvidenceType),
			isRequired: params.isRequired,
			approvalMode: stringToProtoApprovalMode(params.approvalMode),
			autoApproveConfig: params.autoApproveConfig,
			deadlineOffsetHours: params.deadlineOffsetHours ?? 0,
		});
		if (!res.evidenceRequirement)
			throw new Error('No evidence requirement returned');
		return protoToEvidenceRequirement(res.evidenceRequirement);
	});
}

export interface UpdateEvidenceRequirementParams {
	evidenceRequirementId: string;
	name?: string;
	description?: string;
	evidenceTypes?: EvidenceType[];
	isRequired?: boolean;
	approvalMode?: ApprovalMode;
	autoApproveConfig?: AutoApproveConfig;
	deadlineOffsetHours?: number;
}

export async function updateEvidenceRequirement(
	params: UpdateEvidenceRequirementParams
): Promise<EvidenceRequirementDetail> {
	return rpcCall(async () => {
		const res = await collaborationClient.updateEvidenceRequirement({
			evidenceRequirementId: params.evidenceRequirementId,
			name: params.name,
			description: params.description,
			evidenceTypes: params.evidenceTypes?.map(stringToProtoEvidenceType),
			isRequired: params.isRequired,
			approvalMode:
				params.approvalMode !== undefined
					? stringToProtoApprovalMode(params.approvalMode)
					: undefined,
			autoApproveConfig: params.autoApproveConfig,
			deadlineOffsetHours: params.deadlineOffsetHours,
		});
		if (!res.evidenceRequirement)
			throw new Error('No evidence requirement returned');
		return protoToEvidenceRequirement(res.evidenceRequirement);
	});
}

export async function deleteEvidenceRequirement(
	evidenceRequirementId: string
): Promise<void> {
	return rpcCall(async () => {
		await collaborationClient.deleteEvidenceRequirement({
			evidenceRequirementId,
		});
	});
}

export async function listEvidenceRequirements(
	ritualDefinitionId: string
): Promise<EvidenceRequirementDetail[]> {
	return rpcCall(async () => {
		const res = await collaborationClient.listEvidenceRequirements({
			ritualDefinitionId,
		});
		return res.evidenceRequirements.map(protoToEvidenceRequirement);
	});
}

// =============================================================================
// Evidence Submission API
// =============================================================================

export interface SubmitEvidenceParams {
	taskId: string;
	evidenceRequirementId: string;
	evidenceType: EvidenceType;
	fileId?: string;
	textContent?: string;
	linkUrl?: string;
	deviceTimestamp?: Date;
	gpsCoordinates?: GpsCoordinates;
}

export async function submitEvidence(
	params: SubmitEvidenceParams
): Promise<EvidenceSubmission> {
	return rpcCall(async () => {
		const res = await collaborationClient.submitEvidence({
			taskId: params.taskId,
			evidenceRequirementId: params.evidenceRequirementId,
			evidenceType: stringToProtoEvidenceType(params.evidenceType),
			fileId: params.fileId,
			textContent: params.textContent,
			linkUrl: params.linkUrl,
			deviceTimestamp: params.deviceTimestamp ? dateToProtoTimestamp(params.deviceTimestamp) : undefined,
			gpsCoordinates: params.gpsCoordinates,
		});
		if (!res.evidenceSubmission) throw new Error('No evidence submission returned');
		return protoToEvidenceSubmission(res.evidenceSubmission);
	});
}

export async function approveEvidence(
	evidenceSubmissionId: string,
	comment?: string
): Promise<EvidenceSubmission> {
	return rpcCall(async () => {
		const res = await collaborationClient.approveEvidence({
			evidenceSubmissionId,
			comment: comment ?? '',
		});
		if (!res.evidenceSubmission) throw new Error('No evidence submission returned');
		return protoToEvidenceSubmission(res.evidenceSubmission);
	});
}

export async function rejectEvidence(
	evidenceSubmissionId: string,
	comment: string
): Promise<EvidenceSubmission> {
	return rpcCall(async () => {
		const res = await collaborationClient.rejectEvidence({
			evidenceSubmissionId,
			comment,
		});
		if (!res.evidenceSubmission) throw new Error('No evidence submission returned');
		return protoToEvidenceSubmission(res.evidenceSubmission);
	});
}

export async function listEvidenceSubmissions(
	taskId: string
): Promise<EvidenceSubmission[]> {
	return rpcCall(async () => {
		const res = await collaborationClient.listEvidenceSubmissions({ taskId });
		return res.evidenceSubmissions.map(protoToEvidenceSubmission);
	});
}

export interface RequestEvidenceFileUploadResult {
	uploadUrl: string;
	fileId: string;
}

export async function requestEvidenceFileUpload(
	taskId: string,
	evidenceRequirementId: string,
	fileName: string,
	contentType: string,
	fileSizeBytes: number
): Promise<RequestEvidenceFileUploadResult> {
	return rpcCall(async () => {
		const res = await collaborationClient.requestEvidenceFileUpload({
			taskId,
			evidenceRequirementId,
			fileName,
			contentType,
			fileSizeBytes: BigInt(fileSizeBytes),
		});
		return {
			uploadUrl: res.uploadUrl,
			fileId: res.fileId,
		};
	});
}

export async function confirmEvidenceFileUpload(
	fileId: string,
	taskId: string
): Promise<string> {
	return rpcCall(async () => {
		const res = await collaborationClient.confirmEvidenceFileUpload({
			fileId,
			taskId,
		});
		return res.fileId;
	});
}

// =============================================================================
// Ritual Instance API
// =============================================================================

export async function skipRitualInstance(
	taskId: string,
	reason: string
): Promise<void> {
	return rpcCall(async () => {
		await collaborationClient.skipRitualInstance({ taskId, reason });
	});
}

// =============================================================================
// Operational Health API
// =============================================================================

export interface OperationalHealthResult {
	summary: OperationalHealthSummary;
	ritualDetails: RitualHealthDetail[];
}

export async function getOperationalHealth(
	projectId: string,
	startDate: Date,
	endDate: Date
): Promise<OperationalHealthResult> {
	return rpcCall(async () => {
		const res = await collaborationClient.getOperationalHealth({
			projectId,
			startDate: dateToProtoTimestamp(startDate),
			endDate: dateToProtoTimestamp(endDate),
		});
		const summary = res.summary;
		if (!summary) throw new Error('No health summary returned');
		return {
			summary: {
				projectId: summary.projectId,
				totalInstances: summary.totalInstances,
				onTimeCount: summary.onTimeCount,
				overdueCount: summary.overdueCount,
				missedCount: summary.missedCount,
				pendingReviewCount: summary.pendingReviewCount,
				completionRate: summary.completionRate,
				onTimeRate: summary.onTimeRate,
			},
			ritualDetails: res.ritualDetails.map((d) => ({
				ritualDefinitionId: d.ritualDefinitionId,
				ritualName: d.ritualName,
				totalInstances: d.totalInstances,
				verifiedCount: d.verifiedCount,
				overdueCount: d.overdueCount,
				missedCount: d.missedCount,
				healthScore: d.healthScore,
			})),
		};
	});
}

export async function getRitualComplianceSummary(
	projectId: string,
	startDate: Date,
	endDate: Date,
	ritualDefinitionId = ''
): Promise<EmployeeComplianceSummary[]> {
	return rpcCall(async () => {
		const res = await collaborationClient.getRitualComplianceSummary({
			projectId,
			startDate: dateToProtoTimestamp(startDate),
			endDate: dateToProtoTimestamp(endDate),
			ritualDefinitionId,
		});
		return res.employeeSummaries.map((e) => ({
			employeeId: e.employeeId,
			employeeName: e.employeeName,
			totalAssigned: e.totalAssigned,
			completedOnTime: e.completedOnTime,
			completedLate: e.completedLate,
			missedCount: e.missed,
			complianceRate: e.complianceRate,
		}));
	});
}

export async function exportRitualComplianceCSV(
	projectId: string,
	startDate: Date,
	endDate: Date
): Promise<Blob> {
	return rpcCall(async () => {
		const res = await collaborationClient.exportRitualComplianceCSV({
			projectId,
			startDate: dateToProtoTimestamp(startDate),
			endDate: dateToProtoTimestamp(endDate),
		});
		// Copy to a plain ArrayBuffer to avoid SharedArrayBuffer Blob incompatibility
		const copy = new Uint8Array(res.csvData).buffer as ArrayBuffer;
		return new Blob([copy], { type: 'text/csv' });
	});
}

// =============================================================================
// Re-export CollaborationMode type for downstream use
// =============================================================================

export type { CollaborationMode };

// =============================================================================
// Schedule Change API
// =============================================================================

function recurrenceRuleToProto(rule: RecurrenceRule) {
	return {
		type: stringToProtoRecurrenceType(rule.type),
		interval: rule.interval,
		daysOfWeek: rule.daysOfWeek,
		dayOfMonth: rule.dayOfMonth,
		nthWeekday: rule.nthWeekday
			? { week: rule.nthWeekday.week, day: rule.nthWeekday.day }
			: undefined,
	};
}

export interface ScheduleChangeImpact {
	instancesToRemove: number;
	instancesToDetach: number;
	instancesToCreate: number;
}

export async function getScheduleChangeImpact(
	ritualDefinitionId: string,
	newRecurrenceRule: RecurrenceRule
): Promise<ScheduleChangeImpact> {
	return rpcCall(async () => {
		const res = await collaborationClient.getScheduleChangeImpact({
			ritualDefinitionId,
			newRecurrenceRule: recurrenceRuleToProto(newRecurrenceRule),
		});
		return {
			instancesToRemove: res.instancesToRemove,
			instancesToDetach: res.instancesToDetach,
			instancesToCreate: res.instancesToCreate,
		};
	});
}

export interface ScheduleChangeResult {
	ritualDefinition: RitualDefinition;
	instancesRemoved: number;
	instancesDetached: number;
	instancesCreated: number;
}

export async function changeRitualDefinitionSchedule(
	ritualDefinitionId: string,
	newRecurrenceRule: RecurrenceRule,
	confirmed: boolean
): Promise<ScheduleChangeResult> {
	return rpcCall(async () => {
		const res = await collaborationClient.changeRitualDefinitionSchedule({
			ritualDefinitionId,
			newRecurrenceRule: recurrenceRuleToProto(newRecurrenceRule),
			confirmed,
		});
		if (!res.ritualDefinition)
			throw new Error('No ritual definition returned');
		return {
			ritualDefinition: protoToRitualDefinition(res.ritualDefinition),
			instancesRemoved: res.instancesRemoved,
			instancesDetached: res.instancesDetached,
			instancesCreated: res.instancesCreated,
		};
	});
}
