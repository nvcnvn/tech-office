import { ConnectError } from "@connectrpc/connect";
import {
	BadRequestSchema,
	ErrorInfoSchema,
	ResourceInfoSchema,
	RetryInfoSchema,
} from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";
import { PinAuthErrorDetailSchema } from "rpc/rpc/v1/iam_error_details_pb";

// Re-export the PinAuthErrorDetail type from generated code
export type { PinAuthErrorDetail } from "rpc/rpc/v1/iam_error_details_pb";

export interface RetryDetail {
	retryDelaySeconds: number;
}

export interface FieldViolation {
	field: string;
	description: string;
}

export interface ErrorInfoDetail {
	reason: string;
	domain: string;
	metadata: Record<string, string>;
}

export interface ResourceInfoDetail {
	resourceType: string;
	resourceName: string;
	owner: string;
	description: string;
}

export type VoiceErrorReason =
	| 'VOICE_CALL_NOT_FOUND'
	| 'VOICE_CALL_ALREADY_ACTIVE'
	| 'VOICE_CALL_ENDED'
	| 'VOICE_PARTICIPANT_LIMIT_EXCEEDED'
	| 'VOICE_INVITE_NOT_FOUND'
	| 'VOICE_UPLOAD_NOT_FOUND'
	| 'VOICE_UNSUPPORTED_MIME_TYPE'
	| 'VOICE_MEDIA_PROVIDER_UNAVAILABLE';

export interface VoiceErrorInfoDetail extends ErrorInfoDetail {
	reason: VoiceErrorReason;
	domain: 'voice.tech-office';
}

/**
 * Extract RetryInfo detail from a ConnectError.
 *
 * Returns null when the detail is absent or carries no delay, so a caller can tell
 * "no retry time was transmitted" apart from "retry immediately". A PIN lockout at the
 * full-lock tier deliberately carries no delay — nothing resolves it but an admin.
 */
export function extractRetryInfo(error: unknown): RetryDetail | null {
	const cErr = ConnectError.from(error);
	const details = cErr.findDetails(RetryInfoSchema);
	if (details.length === 0) return null;
	const delay = details[0].retryDelay;
	if (!delay) return null;
	const seconds = Number(delay.seconds) + Number(delay.nanos ?? 0) / 1e9;
	if (!Number.isFinite(seconds)) return null;
	return { retryDelaySeconds: seconds };
}

/**
 * Seconds a PIN lockout still has to run, or undefined when the server sent no retry time.
 *
 * Undefined is the tier-4 (full lock) case and the fallback for a missing or malformed
 * detail: the caller shows its generic message rather than an invented countdown.
 */
export function lockoutRetrySeconds(error: unknown): number | undefined {
	const retry = extractRetryInfo(error);
	if (!retry || retry.retryDelaySeconds <= 0) return undefined;
	return retry.retryDelaySeconds;
}

/**
 * Description of the BadRequest violation on a named field, or undefined when the error
 * carries no violation for it. Lets a form with several inputs attach a server-side
 * complaint to the input that caused it instead of to the form as a whole.
 */
export function fieldViolation(error: unknown, field: string): string | undefined {
	const violations = extractFieldViolations(error);
	if (!violations) return undefined;
	return violations.find((v) => v.field === field)?.description;
}

/**
 * Extract BadRequest.FieldViolation details from a ConnectError.
 */
export function extractFieldViolations(error: unknown): FieldViolation[] | null {
	const cErr = ConnectError.from(error);
	const details = cErr.findDetails(BadRequestSchema);
	if (details.length === 0) return null;
	const violations = details[0].fieldViolations;
	if (!violations || violations.length === 0) return null;
	return violations.map((v) => ({
		field: v.field,
		description: v.description,
	}));
}

/**
 * Extract ErrorInfo detail from a ConnectError.
 */
export function extractErrorInfo(error: unknown): ErrorInfoDetail | null {
	const cErr = ConnectError.from(error);
	const details = cErr.findDetails(ErrorInfoSchema);
	if (details.length === 0) return null;
	const d = details[0];
	const metadata: Record<string, string> = {};
	for (const [k, v] of Object.entries(d.metadata)) {
		metadata[k] = v;
	}
	return { reason: d.reason, domain: d.domain, metadata };
}

export function extractVoiceErrorInfo(error: unknown): VoiceErrorInfoDetail | null {
	const info = extractErrorInfo(error);
	if (!info || info.domain !== 'voice.tech-office') return null;
	return info as VoiceErrorInfoDetail;
}

/**
 * Extract ResourceInfo detail from a ConnectError.
 */
export function extractResourceInfo(error: unknown): ResourceInfoDetail | null {
	const cErr = ConnectError.from(error);
	const details = cErr.findDetails(ResourceInfoSchema);
	if (details.length === 0) return null;
	const d = details[0];
	return {
		resourceType: d.resourceType,
		resourceName: d.resourceName,
		owner: d.owner,
		description: d.description,
	};
}

/**
 * Extract PinAuthErrorDetail from a ConnectError.
 * Used for lockout tier information on PIN authentication failures.
 */
export function extractPinAuthErrorDetail(error: unknown): import("rpc/rpc/v1/iam_error_details_pb").PinAuthErrorDetail | null {
	const cErr = ConnectError.from(error);
	const details = cErr.findDetails(PinAuthErrorDetailSchema);
	if (details.length === 0) return null;
	return details[0];
}
