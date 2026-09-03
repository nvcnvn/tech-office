/**
 * Evidence Review Queue API
 *
 * One cross-project list of every pending evidence submission the caller may decide, plus
 * the badge count for the entry point. Feature: 041-evidence-review-queue.
 *
 * The decision actions are deliberately NOT redefined here — the queue calls the same
 * `approveEvidence` / `rejectEvidence` RPCs the task detail view uses, re-exported below
 * with the queue's typed refusal parsing. A parallel decision path would let a decision
 * from the queue differ from one made at the task.
 */

import { Code, ConnectError } from '@connectrpc/connect';
import { collaborationClient } from './rpc';
import rpcCall from './rpcWrapper';
import { protoTimestampToDate } from './proto-utils';
import { collaboration } from 'rpc';
import { fieldViolation, preconditionViolation } from './errorDetails';
import type { EvidenceType, GpsCoordinates } from './collaboration-ritual';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * The queue's sort bucket, derived from the ritual instance's state. `late` entries
 * (instance `overdue` or `missed`) sort ahead of everything else.
 */
export type ReviewUrgency = 'late' | 'normal';

/**
 * One pending submission joined to the context a reviewer needs to decide it without a
 * further request. A projection, not a stored row.
 */
export interface ReviewQueueEntry {
	/** The handle `approveEvidenceSubmission` / `rejectEvidenceSubmission` take. */
	evidenceSubmissionId: string;

	taskId: string;
	/** e.g. "OPS-142" */
	taskIdentifier: string;
	taskTitle: string;
	projectId: string;
	projectName: string;
	ritualDefinitionId: string;
	ritualName: string;

	evidenceRequirementId: string;
	evidenceRequirementName: string;
	evidenceRequirementPosition: number;
	evidenceRequirementIsRequired: boolean;
	/**
	 * The requirement or ritual definition could not be resolved. The entry is still
	 * decidable; the client says the requirement is no longer defined rather than hiding
	 * the row or failing the page.
	 */
	requirementUnresolved: boolean;

	submittedByEmployeeId: string;
	submittedByDisplayName: string;

	/** The server's record of arrival, and the ordering key. Never the device clock. */
	serverTimestamp?: Date;
	/** The device's own clock, for display only. May be wrong; it never sorts. */
	deviceTimestamp?: Date;

	evidenceType: EvidenceType;
	/** Set for photo, voice memo, PDF and file. Resolve a URL with `getDownloadUrl`. */
	fileId?: string;
	/** Set for `text_note`. */
	textContent?: string;
	/** Set for `link`. */
	linkUrl?: string;
	/** Set for `gps_checkin`. */
	gpsCoordinates?: GpsCoordinates;

	/** One of the project_state category strings, e.g. `overdue`, `submitted`. */
	instanceStateCategory: string;
	instanceCompletionDeadline?: Date;
	urgency: ReviewUrgency;
}

export interface ReviewQueuePage {
	entries: ReviewQueueEntry[];
	/**
	 * Absent on the last page. Empty `entries` with no `nextCursor` is the empty state,
	 * which clients must render explicitly, distinguishably from loading and from failure.
	 */
	nextCursor?: string;
}

export interface ReviewQueueCount {
	pendingCount: number;
	/** The real backlog is at least `pendingCount`; render "99+" rather than a figure. */
	isCapped: boolean;
	/**
	 * Whether the caller reviews evidence at all.
	 *
	 * A `pendingCount` of zero is ambiguous alone — "not a reviewer" and "a reviewer who is
	 * up to date" look the same. Hide the entry point when this is false; show it saying
	 * there is nothing to review when it is true.
	 */
	canReview: boolean;
}

export interface ListReviewQueueParams {
	/** Opaque cursor from the previous page. Omit for the first page. */
	cursor?: string;
	/** Defaults to 25 server-side; clamped to 100. */
	pageSize?: number;
	/** Narrows to one project. Only ever narrows reviewer scope; never widens it. */
	projectId?: string;
}

// =============================================================================
// Proto Conversion
// =============================================================================

function protoUrgencyToString(u: collaboration.ReviewUrgency): ReviewUrgency {
	return u === collaboration.ReviewUrgency.LATE ? 'late' : 'normal';
}

function protoEvidenceTypeToString(t: collaboration.EvidenceType): EvidenceType {
	switch (t) {
		case collaboration.EvidenceType.PHOTO:
			return 'photo';
		case collaboration.EvidenceType.VOICE_MEMO:
			return 'voice_memo';
		case collaboration.EvidenceType.PDF:
			return 'pdf';
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

function protoToReviewQueueEntry(e: collaboration.ReviewQueueEntry): ReviewQueueEntry {
	return {
		evidenceSubmissionId: e.evidenceSubmissionId,
		taskId: e.taskId,
		taskIdentifier: e.taskIdentifier,
		taskTitle: e.taskTitle,
		projectId: e.projectId,
		projectName: e.projectName,
		ritualDefinitionId: e.ritualDefinitionId,
		ritualName: e.ritualName,
		evidenceRequirementId: e.evidenceRequirementId,
		evidenceRequirementName: e.evidenceRequirementName,
		evidenceRequirementPosition: e.evidenceRequirementPosition,
		evidenceRequirementIsRequired: e.evidenceRequirementIsRequired,
		requirementUnresolved: e.requirementUnresolved,
		submittedByEmployeeId: e.submittedByEmployeeId,
		submittedByDisplayName: e.submittedByDisplayName,
		serverTimestamp: protoTimestampToDate(e.serverTimestamp),
		deviceTimestamp: protoTimestampToDate(e.deviceTimestamp),
		evidenceType: protoEvidenceTypeToString(e.evidenceType),
		fileId: e.fileId || undefined,
		textContent: e.textContent || undefined,
		linkUrl: e.linkUrl || undefined,
		gpsCoordinates: e.gpsCoordinates
			? {
					latitude: e.gpsCoordinates.latitude,
					longitude: e.gpsCoordinates.longitude,
					accuracyMeters: e.gpsCoordinates.accuracyMeters,
				}
			: undefined,
		instanceStateCategory: e.instanceStateCategory,
		instanceCompletionDeadline: protoTimestampToDate(e.instanceCompletionDeadline),
		urgency: protoUrgencyToString(e.urgency),
	};
}

// =============================================================================
// Queue API
// =============================================================================

/**
 * One page of the caller's review queue, late instances first then oldest-first.
 *
 * A caller without `collab.reviewEvidence` gets an empty page, not an error — having
 * nothing to review is not a failure, and the client hides the entry point on the same
 * permission rather than showing a broken surface.
 */
export async function listEvidenceReviewQueue(
	params: ListReviewQueueParams = {}
): Promise<ReviewQueuePage> {
	return rpcCall(async () => {
		const res = await collaborationClient.listEvidenceReviewQueue({
			cursor: params.cursor,
			pageSize: params.pageSize ?? 0,
			projectId: params.projectId,
		});
		return {
			entries: res.entries.map(protoToReviewQueueEntry),
			nextCursor: res.nextCursor || undefined,
		};
	});
}

/**
 * The badge count, without fetching entries. Bounded server-side, so an unbounded backlog
 * costs the same as a small one.
 */
export async function getEvidenceReviewQueueCount(
	projectId?: string
): Promise<ReviewQueueCount> {
	return rpcCall(async () => {
		const res = await collaborationClient.getEvidenceReviewQueueCount({ projectId });
		return {
			pendingCount: res.pendingCount,
			isCapped: res.isCapped,
			canReview: res.canReview,
		};
	});
}

// =============================================================================
// Decision API
// =============================================================================
//
// Same RPCs the task detail view calls (FR-016) — no parallel decision path. What is added
// here is the typed reading of the two refusals the queue has to explain rather than just
// report.

/** The reason a decision was refused, in a shape the UI can act on. */
export type ReviewDecisionRefusal =
	| {
			kind: 'already_decided';
			/** e.g. "approved by Mai Tran at 2026-09-03T09:14:22Z" */
			description: string;
			evidenceSubmissionId: string;
	  }
	| { kind: 'reason_required'; description: string }
	| { kind: 'not_permitted' }
	| { kind: 'other'; description: string };

/**
 * Classify a failed decision.
 *
 * "Already decided" and "reason required" carry structured details precisely so the
 * reviewer is told what happened instead of watching a row bounce back with no
 * explanation. Out-of-scope deliberately carries no detail — naming the project would
 * disclose its existence to someone who may not see it — so it collapses to `not_permitted`.
 */
export function classifyReviewDecisionError(error: unknown): ReviewDecisionRefusal {
	const alreadyDecided = preconditionViolation(error, 'EVIDENCE_ALREADY_DECIDED');
	if (alreadyDecided) {
		return {
			kind: 'already_decided',
			description: alreadyDecided.description,
			evidenceSubmissionId: alreadyDecided.subject,
		};
	}

	const commentViolation = fieldViolation(error, 'comment');
	if (commentViolation) {
		return { kind: 'reason_required', description: commentViolation };
	}

	const cErr = ConnectError.from(error);
	if (cErr.code === Code.PermissionDenied) {
		return { kind: 'not_permitted' };
	}

	return { kind: 'other', description: cErr.rawMessage || 'The decision could not be recorded.' };
}

/** A sentence to show the reviewer for a refused decision. */
export function reviewDecisionRefusalMessage(refusal: ReviewDecisionRefusal): string {
	switch (refusal.kind) {
		case 'already_decided':
			return `Already decided — ${refusal.description}.`;
		case 'reason_required':
			return refusal.description;
		case 'not_permitted':
			return 'You are no longer able to decide this submission.';
		default:
			return refusal.description;
	}
}

/** Approve from the queue. `comment` is optional; approval needs no justification. */
export async function approveEvidenceSubmission(
	evidenceSubmissionId: string,
	comment?: string
): Promise<void> {
	await collaborationClient.approveEvidence({
		evidenceSubmissionId,
		comment: comment ?? '',
	});
}

/** Reject from the queue. The reason is required and reaches the submitter. */
export async function rejectEvidenceSubmission(
	evidenceSubmissionId: string,
	comment: string
): Promise<void> {
	await collaborationClient.rejectEvidence({ evidenceSubmissionId, comment });
}
