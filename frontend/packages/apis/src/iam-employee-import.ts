/**
 * IAM Employee Import API functions
 * ConnectRPC-based API calls for bulk employee import operations
 */

import { create } from '@bufbuild/protobuf';
import { ImportEmployeeDataSchema } from 'rpc/rpc/v1/iam_pb';
import { iamClient } from './rpc';
import rpcCall from './rpcWrapper';

// Local types (matching what the import UI components expect)
export interface EmployeeData {
	email: string;
	givenName: string;
	familyName: string;
	hireDate?: string;
	dateOfBirth?: string;
	phoneNumber?: string;
	homeAddress?: string;
}

export interface ImportStats {
	totalCount: number;
	validCount: number;
	invalidCount: number;
	duplicateCount: number;
}

export interface EmployeePreviewItem {
	employee: EmployeeData;
	willBeImported: boolean;
	isDuplicate: boolean;
	duplicateReason: string;
	validationErrors: string[];
}

export interface PreviewEmployeeImportResponse {
	items: EmployeePreviewItem[];
	stats: ImportStats;
}

export interface EmployeeImportResult {
	email: string;
	success: boolean;
	identityId: string;
	errorMessage: string;
}

export interface ExecuteEmployeeImportResponse {
	results: EmployeeImportResult[];
	totalAttempted: number;
	successCount: number;
	failedCount: number;
}

function toProtoEmployee(e: EmployeeData) {
	return create(ImportEmployeeDataSchema, {
		email: e.email,
		givenName: e.givenName,
		familyName: e.familyName,
		hireDate: e.hireDate,
		dateOfBirth: e.dateOfBirth,
		phoneNumber: e.phoneNumber,
		homeAddress: e.homeAddress,
	});
}

export async function previewEmployeeImport(
	_organizationId: string,
	employees: EmployeeData[]
): Promise<PreviewEmployeeImportResponse> {
	const resp = await rpcCall(() =>
		iamClient.previewEmployeeImport({ employees: employees.map(toProtoEmployee) })
	);

	const items: EmployeePreviewItem[] = resp.items.map(item => {
		const emp = item.employee;
		return {
			employee: {
				email: emp?.email ?? '',
				givenName: emp?.givenName ?? '',
				familyName: emp?.familyName ?? '',
				hireDate: emp?.hireDate,
				dateOfBirth: emp?.dateOfBirth,
				phoneNumber: emp?.phoneNumber,
				homeAddress: emp?.homeAddress,
			},
			willBeImported: item.willBeImported,
			isDuplicate: item.isDuplicate,
			duplicateReason: item.isDuplicate ? 'Email already exists in organization' : '',
			validationErrors: item.errors,
		};
	});

	const totalCount = employees.length;
	const validCount = resp.importCount;
	const duplicateCount = resp.duplicateCount;
	const invalidCount = totalCount - validCount - duplicateCount;

	return {
		items,
		stats: { totalCount, validCount, duplicateCount, invalidCount: Math.max(0, invalidCount) },
	};
}

export async function executeEmployeeImport(
	_organizationId: string,
	employees: EmployeeData[]
): Promise<ExecuteEmployeeImportResponse> {
	const resp = await rpcCall(() =>
		iamClient.executeEmployeeImport({ employees: employees.map(toProtoEmployee) })
	);

	const results: EmployeeImportResult[] = resp.results.map(r => ({
		email: r.email,
		success: r.success,
		identityId: '',
		errorMessage: r.error,
	}));

	return {
		results,
		totalAttempted: resp.results.length,
		successCount: resp.successCount,
		failedCount: resp.failureCount,
	};
}

