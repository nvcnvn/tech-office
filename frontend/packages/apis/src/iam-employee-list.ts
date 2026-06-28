/**
 * IAM Employee Listing API functions
 * ConnectRPC-based API calls for paginated employee listing with search and sort
 */

import { iamClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import type { PresenceStatus } from "./presence";

// Locally-defined types (matching proto EmployeeListItem / EmployeeListPagination)
export interface EmployeeListItem {
	id: string;
	email: string;
	givenName: string;
	familyName: string;
	hireDate?: string;
	dateOfBirth?: string;
	phoneNumber?: string;
	homeAddress?: string;
	role: string;
	isActive: boolean;
	roleNames: string[];
	isOrgManaged: boolean;
	loginIdentifier?: string;
	userAccountEmail?: string;
}

export interface PaginationMetadata {
	totalCount: number;
	pageNumber: number;
	pageSize: number;
	totalPages: number;
	hasPreviousPage: boolean;
	hasNextPage: boolean;
}

export interface ListEmployeesResponse {
	employees: EmployeeListItem[];
	pagination: PaginationMetadata;
}

export enum SortField {
	HIRE_DATE = 0,
	DATE_OF_BIRTH = 1,
}

export enum SortDirection {
	ASC = 0,
	DESC = 1,
}

export interface ListEmployeesOptions {
	emailFilter?: string;
	sortBy?: SortField;
	sortDirection?: SortDirection;
	pageNumber: number;
	pageSize: number;
}

export async function listEmployees(
	_organizationId: string,
	options: ListEmployeesOptions
): Promise<ListEmployeesResponse> {
	return rpcCall(async () => {
		const sortByStr = options.sortBy === SortField.DATE_OF_BIRTH ? 'date_of_birth' : 'hire_date';
		const sortDirStr = options.sortDirection === SortDirection.DESC ? 'DESC' : 'ASC';

		const resp = await iamClient.listEmployees({
			organizationId: _organizationId,
			emailFilter: options.emailFilter,
			sortBy: sortByStr,
			sortDirection: sortDirStr,
			pageNumber: options.pageNumber,
			pageSize: options.pageSize,
		});

		const employees: EmployeeListItem[] = (resp.employees ?? []).map(emp => ({
			id: emp.id,
			email: emp.email,
			givenName: emp.givenName,
			familyName: emp.familyName,
			hireDate: emp.hireDate,
			dateOfBirth: emp.dateOfBirth,
			phoneNumber: emp.phoneNumber,
			homeAddress: emp.homeAddress,
			role: '',
			isActive: emp.isActive,
			roleNames: emp.roleNames ?? [],
			isOrgManaged: emp.isOrgManaged ?? false,
			loginIdentifier: emp.loginIdentifier ?? undefined,
			userAccountEmail: emp.userAccountEmail ?? undefined,
		}));

		const pagination = resp.pagination ?? {
			totalCount: BigInt(0),
			pageNumber: options.pageNumber,
			pageSize: options.pageSize,
			totalPages: 0,
			hasPreviousPage: false,
			hasNextPage: false,
		};

		return {
			employees,
			pagination: {
				totalCount: Number(pagination.totalCount),
				pageNumber: pagination.pageNumber,
				pageSize: pagination.pageSize,
				totalPages: pagination.totalPages,
				hasPreviousPage: pagination.hasPreviousPage,
				hasNextPage: pagination.hasNextPage,
			},
		};
	});
}

// ─── Employee Cards ───────────────────────────────────────────────────────────

/**
 * Lightweight employee display data — enough to render a UserCard widget.
 * presenceStatus is normalized: online_hidden appears as 'offline'.
 */
export interface EmployeeCard {
	id: string;
	givenName: string;
	familyName: string;
	email: string;
	isActive: boolean;
	departmentName?: string;
	presenceStatus: PresenceStatus;
}

/**
 * Fetch display data (name, email, department, presence) for a batch of employees.
 * Use this when only employee IDs are known and the React Query cache is cold.
 * Maximum 100 IDs per call.
 */
export async function getEmployeeCards(employeeIds: string[]): Promise<EmployeeCard[]> {
	if (employeeIds.length === 0) return [];
	return rpcCall(async () => {
		const resp = await iamClient.getEmployeeCards({ employeeIds });
		return (resp.cards ?? []).map(c => ({
			id: c.id,
			givenName: c.givenName,
			familyName: c.familyName,
			email: c.email,
			isActive: c.isActive,
			departmentName: c.departmentName ?? undefined,
			presenceStatus: (c.presenceStatus || 'offline') as PresenceStatus,
		}));
	});
}


