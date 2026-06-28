// File Storage API Types
// Feature: 014-file-storage-system-an-integration
// Feature: 015-file-storage-security-and-access (Architecture Refactor In Progress)
//
// TEMPORARY NOTE: This file contains ONLY type definitions from Feature 014.
// Feature 015 introduces a domain-owned upload pattern (ARCHITECTURE-REFACTOR.md):
// - Upload RPCs moved to domain services (ChatFileService, DocsService, etc.)
// - FileService now only handles security operations (validation, access control, search)
// - All API wrapper functions are temporarily disabled pending frontend refactor completion
//
// TO DO: Implement new API wrappers for Feature 015 security operations:
// - validateFile, setFileAccessRule, checkFileAccess, searchFiles
// - getPDFConversionStatus, triggerPDFConversion
// - getContentIndexStatus

// Upload Context Constants
// MUST align with:
// - Database CHECK constraint in files.file_metadata.upload_context
// - Backend constants in internal/files/constants.go
export type UploadContext = 'chat' | 'avatar' | 'docs' | 'project';

// File metadata with native JavaScript types (converted from protobuf)
export interface FileMetadata {
	id: string;
	organizationId: string;
	originalFilename: string;
	storageKey: string;
	sizeBytes: number;
	mimeType: string;
	uploadContext: UploadContext;
	uploadedByEmployeeId: string;
	updatedAt: Date; // Converted from protobuf Timestamp
	isDeleted: boolean;
	// Feature 015: Validation fields
	validationStatus?: string;
	validationMessage?: string;
	detectedMimeType?: string;
	// Feature 015: PDF conversion status (NOT URL - use getPDFConversionStatus for security)
	pdfConversionStatus?: ConversionStatusString; // 'pending' | 'in_progress' | 'completed' | 'failed'
}

// File deletion information
export interface FileDeletionInfo {
	deletedAt: Date; // Converted from protobuf Timestamp
	deletedByEmployeeId: string;
	deletedByEmployeeName: string;
	deletionReason?: string;
}

// Storage quota information
export interface QuotaInfo {
	quotaBytes?: number; // undefined = unlimited
	maxFileSizeBytes: number;
	currentUsageBytes: number;
	usagePercentage: number; // -1 if unlimited
	isQuotaExceeded: boolean;
}

// Get download URL response (wrapper function return type)
export interface DownloadUrlInfo {
	downloadUrl: string;
	expiresAt?: Date; // Converted from protobuf Timestamp
	isDeleted: boolean;
	deletionInfo?: FileDeletionInfo;
}

// Get file metadata response
export interface GetFileMetadataResponse {
	file: FileMetadata;
	isDeleted: boolean;
	deletionInfo?: FileDeletionInfo;
}

// Get file metadata batch response
export interface GetFileMetadataBatchResponse {
	files: FileMetadata[];
}

// List files params
export interface ListFilesParams {
	uploadContext?: UploadContext;
	sortBy?: 'updated_at' | 'size';
	sortOrder?: 'asc' | 'desc';
	limit: number;
	offset: number;
}

// List files response
export interface ListFilesResponse {
	files: FileMetadata[];
	totalCount: number;
	page: number;
	pageSize: number;
}

// Delete file response
export interface DeleteFileResponse {
	success: boolean;
}

// Batch delete files response
export interface BatchDeleteFilesResponse {
	deletedCount: number;
	reclaimedBytes: bigint;
	failedFileIds: string[];
}

// Get quota response
export interface GetQuotaResponse {
	quota: QuotaInfo;
}

// Update quota params
export interface UpdateQuotaParams {
	quotaBytes?: number; // undefined = unlimited
	maxFileSizeBytes?: number;
}

// Update quota response
export interface UpdateQuotaResponse {
	quota: QuotaInfo;
}

// NOTE: All API wrapper functions have been temporarily disabled.
// They will be reimplemented as part of Feature 015 frontend refactor.

// Import required dependencies
import { fileClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { protoTimestampToDate } from "./proto-utils";
import { files } from "rpc";
import { type PDFConversionInfo, type ConversionStatusString } from "./files-security";

function normalizeConversionStatus(rawStatus: string): ConversionStatusString {
	const normalized = rawStatus.toLowerCase();
	const withoutPrefix = normalized.startsWith('conversion_status_')
		? normalized.replace('conversion_status_', '')
		: normalized;

	if (withoutPrefix === 'pending') return 'pending';
	if (withoutPrefix === 'in_progress') return 'in_progress';
	if (withoutPrefix === 'completed') return 'completed';
	if (withoutPrefix === 'failed') return 'failed';

	return 'pending';
}

// Type aliases for RPC responses
type GetDownloadUrlResponseProto = files.GetDownloadUrlResponse;
type GetFileMetadataBatchResponseProto = files.GetFileMetadataBatchResponse;
type ListFilesResponseProto = files.ListFilesResponse;
type DeleteFileResponseProto = files.DeleteFileResponse;
type BatchDeleteFilesResponseProto = files.BatchDeleteFilesResponse;
type GetQuotaResponseProto = files.GetQuotaResponse;

/**
 * Get presigned download URL for a file.
 * 
 * Returns presigned R2 URL with time-limited access.
 * If file is deleted, returns deletion information instead.
 * 
 * @param fileId - File ID to get download URL for
 * @returns Download URL and metadata
 * @throws {APIError} Code.NotFound if file doesn't exist
 * @throws {APIError} Code.PermissionDenied if no access to file
 */
export async function getDownloadUrl(fileId: string): Promise<DownloadUrlInfo> {
	const resp = await rpcCall(async () => {
		return await fileClient.getDownloadUrl({
			fileId,
		});
	}) as GetDownloadUrlResponseProto;

	return {
		downloadUrl: resp.downloadUrl,
		expiresAt: resp.expiresAt ? protoTimestampToDate(resp.expiresAt) : undefined,
		isDeleted: resp.isDeleted,
		deletionInfo: resp.deletionInfo ? {
			deletedAt: protoTimestampToDate(resp.deletionInfo.deletedAt) ?? new Date(),
			deletedByEmployeeId: resp.deletionInfo.deletedByEmployeeId,
			deletedByEmployeeName: resp.deletionInfo.deletedByEmployeeName,
			deletionReason: resp.deletionInfo.deletionReason || undefined,
		} : undefined,
	};
}

/**
 * Get file metadata including PDF conversion status.
 * 
 * Use this to poll for PDF conversion status of office documents.
 * 
 * @param fileId - File ID to get metadata for
 * @returns File metadata with PDF conversion info if available
 * @throws {APIError} Code.NotFound if file doesn't exist
 * @throws {APIError} Code.PermissionDenied if no access to file
 */
export async function getFileMetadata(fileId: string): Promise<GetFileMetadataResponse> {
	const resp = await rpcCall(async () => {
		return await fileClient.getFileMetadata({
			fileId,
		});
	}) as files.GetFileMetadataResponse;

	return {
		file: {
			id: resp.file!.id,
			organizationId: '', // Not included in proto response
			originalFilename: resp.file!.originalFilename,
			storageKey: resp.file!.storageKey,
			sizeBytes: Number(resp.file!.sizeBytes),
			mimeType: resp.file!.mimeType,
			uploadContext: resp.file!.uploadContext as UploadContext,
			uploadedByEmployeeId: resp.file!.uploadedByEmployeeId,
			updatedAt: protoTimestampToDate(resp.file!.uploadedAt) ?? new Date(),
			isDeleted: resp.file!.isDeleted,
			validationStatus: resp.file!.validationStatus || undefined,
			validationMessage: resp.file!.validationMessage || undefined,
			detectedMimeType: resp.file!.detectedMimeType || undefined,
			// Only return status, NOT URL (use getPDFConversionStatus for URL)
			pdfConversionStatus: resp.file!.pdfConversionStatus !== undefined
				? normalizeConversionStatus(files.ConversionStatus[resp.file!.pdfConversionStatus])
				: undefined,
		},
		isDeleted: resp.isDeleted,
		deletionInfo: resp.deletionInfo ? {
			deletedAt: protoTimestampToDate(resp.deletionInfo.deletedAt) ?? new Date(),
			deletedByEmployeeId: resp.deletionInfo.deletedByEmployeeId,
			deletedByEmployeeName: resp.deletionInfo.deletedByEmployeeName,
			deletionReason: resp.deletionInfo.deletionReason || undefined,
		} : undefined,
	};
}

/**
 * Get file metadata batch (multiple files at once).
 * 
 * @param fileIds - Array of file IDs
 * @returns File metadata for each file
 * @throws {APIError} Code.PermissionDenied if no access to any file
 */
export async function getFileMetadataBatch(fileIds: string[]): Promise<GetFileMetadataBatchResponse> {
	const resp = await rpcCall(async () => {
		return await fileClient.getFileMetadataBatch({
			fileIds,
		});
	}) as GetFileMetadataBatchResponseProto;

	return {
		files: (resp.files || []).map((file) => ({
			id: file.id,
			organizationId: '', // Not included in proto response
			originalFilename: file.originalFilename,
			storageKey: file.storageKey,
			sizeBytes: Number(file.sizeBytes),
			mimeType: file.mimeType,
			uploadContext: file.uploadContext as UploadContext,
			uploadedByEmployeeId: file.uploadedByEmployeeId,
			updatedAt: protoTimestampToDate(file.updatedAt) ?? new Date(),
			isDeleted: file.isDeleted,
			validationStatus: file.validationStatus,
			validationMessage: file.validationMessage,
			detectedMimeType: file.detectedMimeType,
			// Only return status, NOT URL (use getPDFConversionStatus for URL)
			pdfConversionStatus: file.pdfConversionStatus !== undefined
				? files.ConversionStatus[file.pdfConversionStatus].toLowerCase() as ConversionStatusString
				: undefined,
		})),
	};
}

/**
 * List files with pagination and filtering.
 * 
 * @param params - List parameters
 * @returns Paginated file list
 * @throws {APIError} Code.InvalidArgument if params invalid
 */
export async function listFiles(params: ListFilesParams): Promise<ListFilesResponse> {
	const resp = await rpcCall(async () => {
		return await fileClient.listFiles({
			uploadContext: params.uploadContext ?? '',
			sortBy: params.sortBy ?? '',
			sortOrder: params.sortOrder ?? '',
			pageSize: params.limit,
			page: Math.floor(params.offset / params.limit) + 1,
		});
	}) as ListFilesResponseProto;

	return {
		files: (resp.files || []).map((file) => ({
			id: file.id,
			organizationId: '', // Not included in proto response
			originalFilename: file.originalFilename,
			storageKey: file.storageKey,
			sizeBytes: Number(file.sizeBytes),
			mimeType: file.mimeType,
			uploadContext: file.uploadContext as UploadContext,
			uploadedByEmployeeId: file.uploadedByEmployeeId,
			updatedAt: protoTimestampToDate(file.updatedAt) ?? new Date(),
			isDeleted: file.isDeleted,
			validationStatus: file.validationStatus,
			validationMessage: file.validationMessage,
			detectedMimeType: file.detectedMimeType,
		})),
		totalCount: resp.totalCount,
		page: resp.page,
		pageSize: resp.pageSize,
	};
}

/**
 * Delete a single file.
 * 
 * @param fileId - File ID to delete
 * @param reason - Optional deletion reason
 * @returns Success status
 * @throws {APIError} Code.NotFound if file doesn't exist
 * @throws {APIError} Code.PermissionDenied if not authorized
 */
export async function deleteFile(fileId: string, reason?: string): Promise<DeleteFileResponse> {
	const resp = await rpcCall(async () => {
		return await fileClient.deleteFile({
			fileId,
			deletionReason: reason,
		});
	}) as DeleteFileResponseProto;

	return {
		success: resp.success,
	};
}

/**
 * Batch delete multiple files.
 * 
 * @param fileIds - Array of file IDs to delete
 * @param reason - Optional deletion reason
 * @returns Deletion results
 * @throws {APIError} Code.PermissionDenied if not authorized
 */
export async function batchDeleteFiles(fileIds: string[], reason?: string): Promise<BatchDeleteFilesResponse> {
	const resp = await rpcCall(async () => {
		return await fileClient.batchDeleteFiles({
			fileIds,
			deletionReason: reason,
		});
	}) as BatchDeleteFilesResponseProto;

	return {
		deletedCount: resp.deletedCount,
		reclaimedBytes: resp.reclaimedBytes,
		failedFileIds: resp.failedFileIds || [],
	};
}

/**
 * Get organization storage quota information.
 * 
 * @returns Quota information
 * @throws {APIError} Code.PermissionDenied if not authorized (admin only)
 */
export async function getQuota(): Promise<GetQuotaResponse> {
	const resp = await rpcCall(async () => {
		return await fileClient.getQuota({});
	}) as GetQuotaResponseProto;

	const quota = resp.quota;
	if (!quota) {
		throw new Error("Quota not returned from server");
	}

	return {
		quota: {
			quotaBytes: quota.quotaBytes ? Number(quota.quotaBytes) : undefined,
			maxFileSizeBytes: Number(quota.maxFileSizeBytes),
			currentUsageBytes: Number(quota.currentUsageBytes),
			usagePercentage: quota.usagePercentage,
			isQuotaExceeded: quota.isQuotaExceeded,
		},
	};
}

/**
 * Update organization storage quota configuration.
 * 
 * @param params - Updated quota parameters
 * @returns Updated quota information
 * @throws {APIError} Code.PermissionDenied if not authorized (owner/operator only)
 */
export async function updateQuota(params: {
	quotaBytes?: bigint;
	maxFileSizeBytes?: bigint;
}): Promise<GetQuotaResponse> {
	const resp = await rpcCall(async () => {
		return await fileClient.updateQuota({
			quotaBytes: params.quotaBytes,
			maxFileSizeBytes: params.maxFileSizeBytes,
		});
	}) as unknown as GetQuotaResponseProto;

	const quota = resp.quota;
	if (!quota) {
		throw new Error("Quota not returned from server");
	}

	return {
		quota: {
			quotaBytes: quota.quotaBytes ? Number(quota.quotaBytes) : undefined,
			maxFileSizeBytes: Number(quota.maxFileSizeBytes),
			currentUsageBytes: Number(quota.currentUsageBytes),
			usagePercentage: quota.usagePercentage,
			isQuotaExceeded: quota.isQuotaExceeded,
		},
	};
}
