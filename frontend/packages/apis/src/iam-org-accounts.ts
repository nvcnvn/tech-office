import { ConnectError, Code } from "@connectrpc/connect";
import { iamClient } from "./rpc";
import { rpcCall } from "./rpcWrapper";
import { extractPinAuthErrorDetail, extractFieldViolations } from "./errorDetails";
import type { PinAuthErrorDetail, FieldViolation } from "./errorDetails";

// Custom error classes for PIN-based auth
export class AccountLockedError extends Error {
	public detail: PinAuthErrorDetail;

	constructor(detail: PinAuthErrorDetail) {
		const msg = detail.adminResetRequired
			? "Account is locked. Contact your administrator to unlock."
			: `Account is locked until ${new Date(Number(detail.lockoutUntilUnix) * 1000).toISOString()}`;
		super(msg);
		this.name = "AccountLockedError";
		this.detail = detail;
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
				throw new AccountLockedError(detail);
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
 * Set or change a worker's PIN. Handles field violations.
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
			const violations = extractFieldViolations(cErr);
			if (violations) {
				throw new PINValidationError(violations);
			}
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
