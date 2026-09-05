/**
 * People Directory API functions (feature 048)
 *
 * The read-only colleague lookup behind the mobile People screens. One RPC serves the
 * whole roster, one department's members, and a single person, so all three screens share
 * one wrapper and one shape.
 *
 * `email`, `phoneNumber`, `departmentId` and `departmentName` are `undefined` when the
 * workspace has not recorded them. The screens hang whole affordances off that absence —
 * a missing phone number renders no call row at all — so absent must stay absent here
 * rather than being flattened to an empty string.
 */

import { iamClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import type { PresenceStatus } from "./presence";

/** One colleague, as the directory presents them. */
export interface DirectoryEntry {
	employeeId: string;
	givenName: string;
	familyName: string;
	/** Absent for an org-managed worker with no email recorded. */
	email?: string;
	/** As recorded, with the original formatting. Absent when no number is recorded. */
	phoneNumber?: string;
	/** Both present or both absent — a person belongs to at most one department. */
	departmentId?: string;
	departmentName?: string;
	/** IAM role names, system roles first then alphabetical. */
	roleNames: string[];
	/** Never absent; online_hidden already reads as offline by the time it arrives. */
	presenceStatus: PresenceStatus;
	/** True for exactly the calling employee's own row. */
	isSelf: boolean;
}

export interface ListDirectoryResponse {
	entries: DirectoryEntry[];
	/** Empty when this is the last page, and always empty for a narrowed request. */
	nextCursor: string;
}

export interface ListDirectoryOptions {
	/** Fuzzy name filter. Empty or absent means browse. */
	query?: string;
	departmentId?: string;
	/** Max 100 per request. */
	employeeIds?: string[];
	cursor?: string;
	/** 1..100; 0 or absent means the server default of 50. */
	pageSize?: number;
}

/** Display name as the directory shows it, without truncation decisions. */
export function directoryDisplayName(entry: DirectoryEntry): string {
	return `${entry.givenName} ${entry.familyName}`.trim();
}

export async function listDirectory(
	options: ListDirectoryOptions = {},
): Promise<ListDirectoryResponse> {
	return rpcCall(async () => {
		const resp = await iamClient.listDirectory({
			query: options.query ?? "",
			departmentId: options.departmentId,
			employeeIds: options.employeeIds ?? [],
			cursor: options.cursor ?? "",
			pageSize: options.pageSize ?? 0,
		});

		return {
			entries: (resp.entries ?? []).map((e) => ({
				employeeId: e.employeeId,
				givenName: e.givenName,
				familyName: e.familyName,
				email: e.email ?? undefined,
				phoneNumber: e.phoneNumber ?? undefined,
				departmentId: e.departmentId ?? undefined,
				departmentName: e.departmentName ?? undefined,
				roleNames: e.roleNames ?? [],
				presenceStatus: (e.presenceStatus || "offline") as PresenceStatus,
				isSelf: e.isSelf,
			})),
			nextCursor: resp.nextCursor ?? "",
		};
	});
}

/**
 * One person. Returns undefined when the id names nobody the caller may see — a
 * deactivated colleague, a deletion tombstone, or somebody in another workspace.
 */
export async function getDirectoryEntry(
	employeeId: string,
): Promise<DirectoryEntry | undefined> {
	const { entries } = await listDirectory({ employeeIds: [employeeId] });
	return entries.find((e) => e.employeeId === employeeId);
}
