/**
 * Compliance API functions — content reporting, blocking, and account removal
 * requests (Feature 036).
 *
 * Constitution Principle VIII: the string unions below are mirrored by a SQL
 * CHECK in `backend/database/scripts/schema.sql`, Go constants in
 * `backend/internal/compliance/constants.go`, and proto enums in
 * `backend/rpc/v1/compliance.proto`. Changing one means changing all four.
 */

import { compliance } from "rpc";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { complianceClient, iamClient } from "./rpc";
import rpcCall from "./rpcWrapper";

export type ContentReport = compliance.ContentReport;
export type BlockedPerson = compliance.BlockedPerson;
export type RemovalRequest = compliance.RemovalRequest;
export type ListReportsResponse = compliance.ListReportsResponse;
export type ListBlockedPeopleResponse = compliance.ListBlockedPeopleResponse;
export type ListRemovalRequestsResponse = compliance.ListRemovalRequestsResponse;
export type GetAccountRemovalPathResponse = compliance.GetAccountRemovalPathResponse;

// === Enumerations (Principle VIII: four-way synchronised) ===

/** MUST align with the `target_kind` CHECK on `compliance.content_report`. */
export type ReportTargetKind =
	| 'chat_message'
	| 'direct_message'
	| 'file'
	| 'document_comment'
	| 'call_record';

/** MUST align with the `reason` CHECK on `compliance.content_report`. */
export type ReportReason =
	| 'harassment'
	| 'hate_speech'
	| 'sexual_content'
	| 'violence'
	| 'spam'
	| 'other';

/** MUST align with the `status` CHECK on `compliance.content_report`. */
export type ReportStatus = 'outstanding' | 'actioned' | 'dismissed';

/** The two statuses a reviewer may resolve to. `outstanding` is not an outcome. */
export type ReportOutcome = Exclude<ReportStatus, 'outstanding'>;

/** MUST align with the `status` CHECK on `compliance.removal_request`. */
export type RemovalRequestStatus = 'outstanding' | 'granted' | 'declined';

/** The two statuses an owner may decide to. */
export type RemovalDecision = Exclude<RemovalRequestStatus, 'outstanding'>;

/** MUST align with the `state` CHECK on `compliance.account_deletion`. */
export type AccountDeletionState =
	| 'pending'
	| 'anonymising'
	| 'purging'
	| 'done'
	| 'failed';

/** Which of the two deletion paths a person gets. */
export type AccountRemovalPath = 'self_delete' | 'request_removal';

/** Human-readable labels for the report reasons, in the order the picker shows them. */
export const REPORT_REASON_LABELS: ReadonlyArray<{ value: ReportReason; label: string }> = [
	{ value: 'harassment', label: 'Harassment or bullying' },
	{ value: 'hate_speech', label: 'Hate speech' },
	{ value: 'sexual_content', label: 'Sexual content' },
	{ value: 'violence', label: 'Violence or threats' },
	{ value: 'spam', label: 'Spam' },
	{ value: 'other', label: 'Something else' },
];

// === Proto <-> string conversion ===

const TARGET_KIND_TO_PROTO: Record<ReportTargetKind, compliance.ReportTargetKind> = {
	chat_message: compliance.ReportTargetKind.CHAT_MESSAGE,
	direct_message: compliance.ReportTargetKind.DIRECT_MESSAGE,
	file: compliance.ReportTargetKind.FILE,
	document_comment: compliance.ReportTargetKind.DOCUMENT_COMMENT,
	call_record: compliance.ReportTargetKind.CALL_RECORD,
};

const REASON_TO_PROTO: Record<ReportReason, compliance.ReportReason> = {
	harassment: compliance.ReportReason.HARASSMENT,
	hate_speech: compliance.ReportReason.HATE_SPEECH,
	sexual_content: compliance.ReportReason.SEXUAL_CONTENT,
	violence: compliance.ReportReason.VIOLENCE,
	spam: compliance.ReportReason.SPAM,
	other: compliance.ReportReason.OTHER,
};

const REPORT_STATUS_TO_PROTO: Record<ReportStatus, compliance.ReportStatus> = {
	outstanding: compliance.ReportStatus.OUTSTANDING,
	actioned: compliance.ReportStatus.ACTIONED,
	dismissed: compliance.ReportStatus.DISMISSED,
};

const REMOVAL_STATUS_TO_PROTO: Record<RemovalRequestStatus, compliance.RemovalRequestStatus> = {
	outstanding: compliance.RemovalRequestStatus.OUTSTANDING,
	granted: compliance.RemovalRequestStatus.GRANTED,
	declined: compliance.RemovalRequestStatus.DECLINED,
};

function invert<K extends string, V extends number>(map: Record<K, V>): Map<V, K> {
	return new Map((Object.entries(map) as [K, V][]).map(([k, v]) => [v, k]));
}

const PROTO_TO_TARGET_KIND = invert(TARGET_KIND_TO_PROTO);
const PROTO_TO_REASON = invert(REASON_TO_PROTO);
const PROTO_TO_REPORT_STATUS = invert(REPORT_STATUS_TO_PROTO);
const PROTO_TO_REMOVAL_STATUS = invert(REMOVAL_STATUS_TO_PROTO);

export function reportTargetKindFromProto(v: compliance.ReportTargetKind): ReportTargetKind | undefined {
	return PROTO_TO_TARGET_KIND.get(v);
}

export function reportReasonFromProto(v: compliance.ReportReason): ReportReason | undefined {
	return PROTO_TO_REASON.get(v);
}

export function reportStatusFromProto(v: compliance.ReportStatus): ReportStatus | undefined {
	return PROTO_TO_REPORT_STATUS.get(v);
}

export function removalRequestStatusFromProto(
	v: compliance.RemovalRequestStatus,
): RemovalRequestStatus | undefined {
	return PROTO_TO_REMOVAL_STATUS.get(v);
}

export function accountRemovalPathFromProto(
	v: compliance.AccountRemovalPath,
): AccountRemovalPath | undefined {
	switch (v) {
		case compliance.AccountRemovalPath.SELF_DELETE:
			return 'self_delete';
		case compliance.AccountRemovalPath.REQUEST_REMOVAL:
			return 'request_removal';
		default:
			return undefined;
	}
}

// === Reporting ===

export interface ReportContentParams {
	targetKind: ReportTargetKind;
	targetId: string;
	reason: ReportReason;
	note?: string;
}

/**
 * Files a report. The reported author and the content snapshot are resolved
 * server-side; the client supplies neither, so authorship cannot be forged.
 */
export async function reportContent(
	params: ReportContentParams,
): Promise<compliance.ReportContentResponse> {
	return await rpcCall(async () =>
		complianceClient.reportContent({
			targetKind: TARGET_KIND_TO_PROTO[params.targetKind],
			targetId: params.targetId,
			reason: REASON_TO_PROTO[params.reason],
			note: params.note ?? '',
		}),
	);
}

export interface ListReportsParams {
	statusFilter?: ReportStatus;
	/** UUID v7 cursor; omit to start at the newest report. */
	cursor?: string;
	limit?: number;
}

export async function listReports(params: ListReportsParams = {}): Promise<ListReportsResponse> {
	return await rpcCall(async () =>
		complianceClient.listReports({
			statusFilter: params.statusFilter
				? REPORT_STATUS_TO_PROTO[params.statusFilter]
				: compliance.ReportStatus.UNSPECIFIED,
			cursor: params.cursor ?? '',
			limit: params.limit ?? 25,
		}),
	);
}

export async function getReport(reportId: string): Promise<compliance.GetReportResponse> {
	return await rpcCall(async () => complianceClient.getReport({ reportId }));
}

export async function resolveReport(
	reportId: string,
	outcome: ReportOutcome,
	outcomeNote: string,
): Promise<compliance.ResolveReportResponse> {
	return await rpcCall(async () =>
		complianceClient.resolveReport({
			reportId,
			outcome: REPORT_STATUS_TO_PROTO[outcome],
			outcomeNote,
		}),
	);
}

// === Blocking ===

/** Emits no notification: the blocked person is never told (FR-022). */
export async function blockPerson(employeeId: string): Promise<compliance.BlockPersonResponse> {
	return await rpcCall(async () => complianceClient.blockPerson({ employeeId }));
}

/** Idempotent: unblocking someone who is not blocked succeeds. */
export async function unblockPerson(employeeId: string): Promise<compliance.UnblockPersonResponse> {
	return await rpcCall(async () => complianceClient.unblockPerson({ employeeId }));
}

/**
 * The caller's own block list. There is deliberately no call that answers "who
 * has blocked me".
 */
export async function listBlockedPeople(): Promise<ListBlockedPeopleResponse> {
	return await rpcCall(async () => complianceClient.listBlockedPeople({}));
}

// === Removal requests ===

export interface RemovalRequestSummary {
	id: string;
	status: RemovalRequestStatus;
	note: string;
	createdAt?: Date;
	decidedAt?: Date;
}

export interface AccountRemovalPathSummary {
	path: AccountRemovalPath;
	/** Populated only for `request_removal`. */
	managingOrganizationName: string;
	/** The person's most recent request, if they have made one. */
	latestRequest?: RemovalRequestSummary;
}

function removalRequestSummary(request: RemovalRequest | undefined): RemovalRequestSummary | undefined {
	if (!request) return undefined;
	return {
		id: request.id,
		status: removalRequestStatusFromProto(request.status) ?? 'outstanding',
		note: request.note,
		createdAt: request.createdAt ? timestampDate(request.createdAt) : undefined,
		decidedAt: request.decidedAt ? timestampDate(request.decidedAt) : undefined,
	};
}

/**
 * Which deletion path this person gets, so the client renders the right screen
 * rather than inferring it from other fields.
 *
 * The proto enums are mapped to string unions here so no screen ever compares a
 * raw enum number — that is exactly the cross-stack drift Principle VIII exists to
 * prevent.
 */
export async function getAccountRemovalPath(): Promise<AccountRemovalPathSummary> {
	return await rpcCall(async () => {
		const resp = await complianceClient.getAccountRemovalPath({});
		return {
			path: accountRemovalPathFromProto(resp.path) ?? 'self_delete',
			managingOrganizationName: resp.managingOrganizationName,
			latestRequest: removalRequestSummary(resp.latestRequest),
		};
	});
}

/** Returns the existing request if one is already outstanding, rather than erroring. */
export async function requestAccountRemoval(
	note?: string,
): Promise<{ request?: RemovalRequestSummary; alreadyOutstanding: boolean }> {
	return await rpcCall(async () => {
		const resp = await complianceClient.requestAccountRemoval({ note: note ?? '' });
		return {
			request: removalRequestSummary(resp.request),
			alreadyOutstanding: resp.alreadyOutstanding,
		};
	});
}

export interface ListRemovalRequestsParams {
	statusFilter?: RemovalRequestStatus;
	cursor?: string;
	limit?: number;
}

export async function listRemovalRequests(
	params: ListRemovalRequestsParams = {},
): Promise<ListRemovalRequestsResponse> {
	return await rpcCall(async () =>
		complianceClient.listRemovalRequests({
			statusFilter: params.statusFilter
				? REMOVAL_STATUS_TO_PROTO[params.statusFilter]
				: compliance.RemovalRequestStatus.UNSPECIFIED,
			cursor: params.cursor ?? '',
			limit: params.limit ?? 25,
		}),
	);
}

export async function decideRemovalRequest(
	requestId: string,
	decision: RemovalDecision,
): Promise<compliance.DecideRemovalRequestResponse> {
	return await rpcCall(async () =>
		complianceClient.decideRemovalRequest({
			requestId,
			decision: REMOVAL_STATUS_TO_PROTO[decision],
		}),
	);
}

// === Account deletion and terms (IAMService) ===
//
// These RPCs live on IAMService because they act on the global iam.user record,
// but they belong to this feature, so their wrappers live here with the rest of
// it rather than being scattered through iam.ts.

export interface DeletionCategory {
	label: string;
	/** Why it is retained. Empty for erased categories. */
	reason: string;
}

export interface AffectedOrganizationSummary {
	organizationId: string;
	organizationName: string;
	memberCount: number;
	/** True when this workspace blocks deletion until ownership moves or it closes. */
	blocksDeletion: boolean;
}

export interface AccountDeletionPreview {
	erased: DeletionCategory[];
	retained: DeletionCategory[];
	organizations: AffectedOrganizationSummary[];
	blocked: boolean;
	/** The exact phrase the person must type, assembled server-side. */
	confirmationPhrase: string;
}

/**
 * What the confirmation screen must state before anyone deletes anything.
 *
 * The copy is assembled server-side so mobile and web cannot drift into describing
 * different behaviour (FR-002).
 */
export async function getAccountDeletionPreview(): Promise<AccountDeletionPreview> {
	return await rpcCall(async () => {
		const resp = await iamClient.getAccountDeletionPreview({});
		return {
			erased: resp.erased.map((c) => ({ label: c.label, reason: c.reason })),
			retained: resp.retained.map((c) => ({ label: c.label, reason: c.reason })),
			organizations: resp.organizations.map((o) => ({
				organizationId: o.organizationId,
				organizationName: o.organizationName,
				memberCount: o.memberCount,
				blocksDeletion: o.blocksDeletion,
			})),
			blocked: resp.blocked,
			confirmationPhrase: resp.confirmationPhrase,
		};
	});
}

/**
 * Deletes the caller's account. Irreversible.
 *
 * Refusals worth handling: a sole-owner block carries the structured detail read by
 * `extractSoleOwnerBlocksDeletion`, and an admin-provisioned worker is refused
 * outright because their path is `requestAccountRemoval`.
 */
export async function deleteMyAccount(confirmationPhrase: string): Promise<{ deletionId: string }> {
	return await rpcCall(async () => {
		const resp = await iamClient.deleteMyAccount({ confirmationPhrase });
		return { deletionId: resp.deletionId };
	});
}

export interface TermsStatus {
	currentVersion: string;
	acceptedVersion: string;
	/** False when the person has not accepted the version currently being served. */
	isCurrent: boolean;
}

/**
 * Whether this person has accepted the terms currently in force.
 *
 * Admin-provisioned workers never saw a signup screen, so gating their first use on
 * this is the only way acceptance can hold for accounts an administrator created
 * (FR-012).
 */
export async function getTermsStatus(): Promise<TermsStatus> {
	return await rpcCall(async () => {
		const resp = await iamClient.getTermsStatus({});
		return {
			currentVersion: resp.currentVersion,
			acceptedVersion: resp.acceptedVersion,
			isCurrent: resp.isCurrent,
		};
	});
}

/** Records acceptance of the current terms. A stale version is rejected. */
export async function acceptTerms(termsVersion: string): Promise<void> {
	await rpcCall(async () => iamClient.acceptTerms({ termsVersion }));
}
