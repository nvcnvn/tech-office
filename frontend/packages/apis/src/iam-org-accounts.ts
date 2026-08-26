import { ConnectError, Code } from "@connectrpc/connect";
import { iamClient } from "./rpc";
import { rpcCall } from "./rpcWrapper";
import {
	extractPinAuthErrorDetail,
	extractFieldViolations,
	fieldViolation,
	lockoutRetrySeconds,
} from "./errorDetails";
import type { PinAuthErrorDetail, FieldViolation } from "./errorDetails";

/**
 * PIN length, in digits.
 *
 * MUST align with:
 * - Backend Go constant: internal/iam/constants.go
 * - Backend validation: iam.ValidatePINFormat
 *
 * Clients mask input and size their entry boxes from this value rather than restating 6.
 */
export const PIN_LENGTH = 6;

/**
 * Days a temporary PIN issued by CreateOrgAccount remains usable.
 *
 * MUST align with the backend expiry written to iam.credential.expires_at.
 * Copy that tells a worker how long their code lasts reads this rather than restating 3.
 */
export const TEMPORARY_PIN_EXPIRY_DAYS = 3;

// Custom error classes for PIN-based auth
export class AccountLockedError extends Error {
	public detail: PinAuthErrorDetail;

	/**
	 * Seconds remaining on the lockout, from the server's google.rpc.RetryInfo. Undefined
	 * at the full-lock tier, and whenever no retry time was transmitted — a caller with no
	 * value shows its generic message rather than an invented countdown.
	 */
	public retrySeconds?: number;

	constructor(detail: PinAuthErrorDetail, retrySeconds?: number) {
		const msg = detail.adminResetRequired
			? "Account is locked. Contact your administrator to unlock."
			: `Account is locked until ${new Date(Number(detail.lockoutUntilUnix) * 1000).toISOString()}`;
		super(msg);
		this.name = "AccountLockedError";
		this.detail = detail;
		this.retrySeconds = retrySeconds;
	}
}

/**
 * Thrown when a voluntary PIN change is attempted without the current PIN, or with a wrong
 * one. First-time set — no credential, a temporary credential, or a PIN change token — is
 * exempt and never raises this.
 */
export class CurrentPINError extends Error {
	/** True when the current PIN was supplied but did not match. */
	public incorrect: boolean;

	constructor(incorrect: boolean) {
		super(
			incorrect
				? "That current PIN is not right."
				: "Enter your current PIN to change it.",
		);
		this.name = "CurrentPINError";
		this.incorrect = incorrect;
	}
}

export class PINValidationError extends Error {
	public violations: FieldViolation[];

	constructor(violations: FieldViolation[]) {
		super(violations.map((v) => v.description).join("; "));
		this.name = "PINValidationError";
		this.violations = violations;
	}
}

export interface LoginWithPINResult {
	accessToken: string;
	expiresAt: bigint;
	pinChangeRequired: boolean;
	pinChangeToken: string;
}

export interface SetPINResult {
	accessToken: string;
	expiresAt: bigint;
}

/**
 * Authenticate a worker using org subdomain + login identifier + PIN.
 * Handles ConnectError directly (does NOT use rpcCall) for lockout detail extraction.
 */
export async function loginWithPIN(
	subdomain: string,
	loginIdentifier: string,
	pin: string,
): Promise<LoginWithPINResult> {
	try {
		const resp = await iamClient.loginWithPIN({
			organizationSubdomain: subdomain,
			loginIdentifier,
			pin,
		});
		return {
			accessToken: resp.accessToken,
			expiresAt: resp.expiresAt,
			pinChangeRequired: resp.pinChangeRequired,
			pinChangeToken: resp.pinChangeToken,
		};
	} catch (err) {
		const cErr = ConnectError.from(err);

		if (cErr.code === Code.ResourceExhausted) {
			const detail = extractPinAuthErrorDetail(cErr);
			if (detail) {
				throw new AccountLockedError(detail, lockoutRetrySeconds(cErr));
			}
		}

		if (cErr.code === Code.Unauthenticated) {
			throw new Error("Invalid login identifier or PIN");
		}

		if (cErr.code === Code.NotFound) {
			throw new Error("Organization not found");
		}

		throw cErr;
	}
}

/**
 * Set or change a member's PIN.
 *
 * `currentPin` is REQUIRED for a voluntary change of an established PIN and is verified by
 * the server. First-time set is exempt: a `pinChangeToken` was supplied, the member holds
 * no PIN credential, or the existing one is still temporary. Omitting it on a voluntary
 * change throws CurrentPINError; supplying a wrong one throws CurrentPINError with
 * `incorrect: true`.
 */
export async function setPIN(
	newPin: string,
	opts?: { pinChangeToken?: string; currentPin?: string },
): Promise<SetPINResult> {
	try {
		const resp = await rpcCall(() =>
			iamClient.setPIN({
				newPin,
				pinChangeToken: opts?.pinChangeToken,
				currentPin: opts?.currentPin,
			}),
		);
		return {
			accessToken: resp.accessToken,
			expiresAt: resp.expiresAt,
		};
	} catch (err) {
		const cErr = ConnectError.from(err);
		if (cErr.code === Code.InvalidArgument) {
			if (fieldViolation(cErr, "current_pin")) {
				throw new CurrentPINError(false);
			}
			const violations = extractFieldViolations(cErr);
			if (violations) {
				throw new PINValidationError(violations);
			}
		}
		if (cErr.code === Code.PermissionDenied) {
			throw new CurrentPINError(true);
		}
		throw err;
	}
}

export interface CreateOrgAccountRequest {
	loginIdentifier: string;
	displayName: string;
	givenName: string;
	familyName: string;
	departmentId?: string;
	dateOfBirth?: string;
	phoneNumber?: string;
}

export interface CreateOrgAccountResult {
	id: string;
	loginIdentifier: string;
	temporaryPin: string;
}

export async function createOrgAccount(
	req: CreateOrgAccountRequest,
): Promise<CreateOrgAccountResult> {
	const resp = await rpcCall(() => iamClient.createOrgAccount(req));
	return {
		id: resp.id,
		loginIdentifier: resp.loginIdentifier,
		temporaryPin: resp.temporaryPin,
	};
}

export interface BatchCreateResult {
	results: Array<{
		loginIdentifier: string;
		success: boolean;
		error: string;
		temporaryPin: string;
		id: string;
	}>;
	successCount: number;
	failureCount: number;
}

export async function batchCreateOrgAccounts(
	accounts: CreateOrgAccountRequest[],
): Promise<BatchCreateResult> {
	const resp = await rpcCall(() =>
		iamClient.batchCreateOrgAccounts({ accounts }),
	);
	return {
		results: resp.results.map((r) => ({
			loginIdentifier: r.loginIdentifier,
			success: r.success,
			error: r.error,
			temporaryPin: r.temporaryPin,
			id: r.id,
		})),
		successCount: resp.successCount,
		failureCount: resp.failureCount,
	};
}

export async function deactivateOrgAccount(id: string): Promise<void> {
	await rpcCall(() => iamClient.deactivateOrgAccount({ id }));
}

export interface UnlockResult {
	temporaryPin?: string;
}

export async function unlockOrgAccount(
	id: string,
	resetPin: boolean,
): Promise<UnlockResult> {
	const resp = await rpcCall(() =>
		iamClient.unlockOrgAccount({ id, resetPin }),
	);
	return { temporaryPin: resp.temporaryPin ?? undefined };
}

export interface ResetCredentialResult {
	temporaryPin: string;
}

export async function resetOrgAccountCredential(
	id: string,
): Promise<ResetCredentialResult> {
	const resp = await rpcCall(() =>
		iamClient.resetOrgAccountCredential({ id }),
	);
	return { temporaryPin: resp.temporaryPin };
}

export interface OrgAccountListItem {
	id: string;
	loginIdentifier: string;
	displayName: string;
	givenName: string;
	familyName: string;
	status: string;
	pinConfigured: boolean;
	createdAt: string;
	lastLoginAt: string;
}

export interface ListOrgAccountsResult {
	accounts: OrgAccountListItem[];
	nextCursor?: string;
	totalCount: number;
}

export async function listOrgAccounts(opts?: {
	cursor?: string;
	limit?: number;
	statusFilter?: string;
}): Promise<ListOrgAccountsResult> {
	const resp = await rpcCall(() =>
		iamClient.listOrgAccounts({
			cursor: opts?.cursor,
			limit: opts?.limit ?? 50,
			statusFilter: opts?.statusFilter,
		}),
	);
	return {
		accounts: resp.accounts.map((a) => ({
			id: a.id,
			loginIdentifier: a.loginIdentifier,
			displayName: a.displayName,
			givenName: a.givenName,
			familyName: a.familyName,
			status: a.status,
			pinConfigured: a.pinConfigured,
			createdAt: a.createdAt,
			lastLoginAt: a.lastLoginAt,
		})),
		nextCursor: resp.nextCursor ?? undefined,
		totalCount: resp.totalCount,
	};
}
