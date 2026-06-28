/**
 * File Security API
 * 
 * Feature: 015-file-storage-security-and-access
 * 
 * Provides API wrappers for:
 * - File type validation (detect MIME type mismatches)
 * - Access control (set and check file permissions)
 * - Full-text search (with access control filters)
 * - PDF conversion (office documents → PDF preview)
 * - Content indexing (extract text for search)
 */

import { fileClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { protoTimestampToDate } from "./proto-utils";
import { files } from "rpc";

// Type aliases for RPC response types
type ValidateFileResponse = files.ValidateFileResponse;
type SetFileAccessRuleResponse = files.SetFileAccessRuleResponse;
type CheckFileAccessResponse = files.CheckFileAccessResponse;
type SearchFilesResponse = files.SearchFilesResponse;
type GetPDFConversionStatusResponse = files.GetPDFConversionStatusResponse;
type TriggerPDFConversionResponse = files.TriggerPDFConversionResponse;
type GetContentIndexStatusResponse = files.GetContentIndexStatusResponse;

// Re-export enums for frontend use
export { ValidationStatus, FileContextType, FileAccessScope, ConversionStatus, IndexingStatus } from "rpc/rpc/v1/files_pb";

/**
 * File validation result
 */
export interface FileValidationResult {
	status: string; // "pending" | "verified" | "warning" | "failed" | "skipped"
	message: string;
	declaredMimeType: string;
	detectedMimeType: string;
}

/**
 * File access rule
 */
export interface FileAccessRule {
	id: string;
	fileId: string;
	contextType: string; // "chat_channel" | "project" | "department_docs" | etc.
	contextId: string;
	accessScope: string; // "public" | "private" | "department"
	updatedAt: Date;
}

/**
 * Access check result
 */
export interface AccessCheckResult {
	hasAccess: boolean;
	denialReason: string;
	accessRule?: FileAccessRule;
}

/**
 * File search result with metadata and relevance
 */
export interface FileSearchResult {
	fileId: string;
	filename: string;
	sizeBytes: number;
	mimeType: string;
	validationStatus: string;
	contextType: string;
	contextId: string;
	contextDisplayName: string;
	relevanceScore: number;
	excerpt: string;
	uploadedBy: string;
	uploadedAt: Date;
}

/**
 * PDF conversion information
 */
export interface PDFConversionInfo {
	status: ConversionStatusString;
	pdfUrl?: string; // Presigned download URL (only if completed)
	error?: string;
	duration?: number; // Milliseconds
}

export type ConversionStatusString = 'pending' | 'in_progress' | 'completed' | 'failed';

function normalizeConversionStatus(rawStatus: string): ConversionStatusString {
	const normalized = rawStatus.toLowerCase();
	// Newer backends/proto enums often serialize as CONVERSION_STATUS_COMPLETED, etc.
	const withoutPrefix = normalized.startsWith('conversion_status_')
		? normalized.replace('conversion_status_', '')
		: normalized;

	if (withoutPrefix === 'pending') return 'pending';
	if (withoutPrefix === 'in_progress') return 'in_progress';
	if (withoutPrefix === 'completed') return 'completed';
	if (withoutPrefix === 'failed') return 'failed';

	// Conservative fallback: treat unknown/unspecified as pending.
	return 'pending';
}

/**
 * Content index information
 */
export interface ContentIndexInfo {
	status: string; // "pending" | "in_progress" | "completed" | "failed"
	error?: string;
	duration?: number; // Milliseconds
}

/**
 * Validate file type by comparing declared MIME type with detected type.
 * 
 * Uses magic byte detection (h2non/filetype) to verify file content.
 * Returns "verified" if types match, "warning" if mismatch (not blocked).
 * 
 * @param fileId - File ID to validate
 * @returns Validation result
 * @throws {APIError} Code.NotFound if file doesn't exist
 * @throws {APIError} Code.PermissionDenied if no access to file
 */
export async function validateFile(fileId: string): Promise<FileValidationResult> {
	const resp = await rpcCall(async () => {
		return await fileClient.validateFile({
			fileId,
		});
	}) as ValidateFileResponse;

	const result = resp.validationResult;
	if (!result) {
		throw new Error("Validation result not returned from server");
	}

	return {
		status: files.ValidationStatus[result.status].toLowerCase(),
		message: result.message,
		declaredMimeType: result.declaredMimeType,
		detectedMimeType: result.detectedMimeType,
	} as FileValidationResult;
}

/**
 * Set access rule for a file.
 * 
 * Links file to a context (channel, project, department docs) and defines access scope.
 * 
 * @param params - Access rule parameters
 * @param params.fileId - File ID
 * @param params.contextType - Context type enum value (e.g., FileContextType.CHAT_CHANNEL)
 * @param params.contextId - Context ID (e.g., channel UUID)
 * @param params.accessScope - Access scope enum value (e.g., FileAccessScope.PRIVATE)
 * @returns Created/updated access rule
 * @throws {APIError} Code.NotFound if file doesn't exist
 * @throws {APIError} Code.PermissionDenied if not authorized
 */
export async function setFileAccessRule(params: {
	fileId: string;
	contextType: number; // FileContextType enum value
	contextId: string;
	accessScope: number; // FileAccessScope enum value
}): Promise<FileAccessRule> {
	const resp = await rpcCall(async () => {
		return await fileClient.setFileAccessRule({
			fileId: params.fileId,
			contextType: params.contextType,
			contextId: params.contextId,
			accessScope: params.accessScope,
		});
	}) as SetFileAccessRuleResponse;

	const rule = resp.accessRule;
	if (!rule) {
		throw new Error("Access rule not returned from server");
	}

	return {
		id: rule.id,
		fileId: rule.fileId,
		contextType: files.FileContextType[rule.contextType].toLowerCase(),
		contextId: rule.contextId,
		accessScope: files.FileAccessScope[rule.accessScope].toLowerCase(),
		updatedAt: protoTimestampToDate(rule.updatedAt) ?? new Date(),
	};
}

/**
 * Check if authenticated employee has access to a file.
 * 
 * Evaluates access based on:
 * - File uploader (always allowed)
 * - Context membership (channel member, project member, etc.)
 * - Access scope (public, private, department)
 * 
 * @param fileId - File ID to check
 * @returns Access check result
 * @throws {APIError} Code.NotFound if file doesn't exist
 */
export async function checkFileAccess(fileId: string): Promise<AccessCheckResult> {
	const resp = await rpcCall(async () => {
		return await fileClient.checkFileAccess({
			fileId,
		});
	}) as CheckFileAccessResponse;

	return {
		hasAccess: resp.hasAccess,
		denialReason: resp.denialReason,
		accessRule: resp.accessRule ? {
			id: resp.accessRule.id,
			fileId: resp.accessRule.fileId,
			contextType: files.FileContextType[resp.accessRule.contextType].toLowerCase(),
			contextId: resp.accessRule.contextId,
			accessScope: files.FileAccessScope[resp.accessRule.accessScope].toLowerCase(),
			updatedAt: protoTimestampToDate(resp.accessRule.updatedAt) ?? new Date(),
		} : undefined,
	};
}

/**
 * Search files by name and content with access control.
 * 
 * Uses PGroonga full-text search with multilingual support.
 * Results are filtered by:
 * - Accessible contexts (channels employee is member of)
 * - Department memberships
 * - File uploader
 * 
 * @param params - Search parameters
 * @param params.query - Search query (filename or content)
 * @param params.contextTypes - Filter by context types (optional)
 * @param params.limit - Max results (default 50, max 100)
 * @param params.offset - Pagination offset (default 0)
 * @returns Search results with pagination
 * @throws {APIError} Code.InvalidArgument if query invalid
 */
export async function searchFiles(params: {
	query: string;
	contextTypes?: number[]; // FileContextType enum values
	limit?: number;
	offset?: number;
}): Promise<{
	results: FileSearchResult[];
	totalCount: number;
	hasMore: boolean;
}> {
	const resp = await rpcCall(async () => {
		return await fileClient.searchFiles({
			query: params.query,
			contextTypes: params.contextTypes ?? [],
			limit: params.limit ?? 50,
			offset: params.offset ?? 0,
		});
	}) as SearchFilesResponse;

	return {
		results: (resp.results || []).map(r => ({
			fileId: r.fileId,
			filename: r.filename,
			sizeBytes: Number(r.sizeBytes),
			mimeType: r.mimeType,
			validationStatus: files.ValidationStatus[r.validationStatus].toLowerCase(),
			contextType: files.FileContextType[r.contextType].toLowerCase(),
			contextId: r.contextId,
			contextDisplayName: r.contextDisplayName,
			relevanceScore: r.relevanceScore,
			excerpt: r.excerpt,
			uploadedBy: r.uploadedByName,
			uploadedAt: protoTimestampToDate(r.uploadedAt) ?? new Date(),
		})),
		totalCount: resp.totalCount,
		hasMore: resp.hasMore,
	};
}

/**
 * Get PDF conversion status for an office document.
 * 
 * Returns conversion status and presigned download URL if completed.
 * 
 * @param fileId - File ID (must be convertible office document)
 * @returns Conversion status and PDF URL
 * @throws {APIError} Code.NotFound if file doesn't exist
 * @throws {APIError} Code.PermissionDenied if no access to file
 * @throws {APIError} Code.InvalidArgument if file not convertible
 */
export async function getPDFConversionStatus(fileId: string): Promise<PDFConversionInfo> {
	const resp = await rpcCall(async () => {
		return await fileClient.getPDFConversionStatus({
			fileId,
		});
	}) as GetPDFConversionStatusResponse;

	const info = resp.conversionInfo;
	if (!info) {
		throw new Error("Conversion info not returned from server");
	}

	return {
		status: normalizeConversionStatus(files.ConversionStatus[info.status]),
		pdfUrl: info.pdfDownloadUrl || undefined,
		error: info.errorMessage || undefined,
		duration: info.durationMs || undefined,
	};
}

/**
 * Trigger PDF conversion for an office document.
 * 
 * Initiates async conversion workflow (Gotenberg).
 * Returns immediately with "pending" status.
 * Poll getPDFConversionStatus to check completion.
 * 
 * @param fileId - File ID (must be convertible office document)
 * @returns Initial conversion status
 * @throws {APIError} Code.NotFound if file doesn't exist
 * @throws {APIError} Code.PermissionDenied if no access to file
 * @throws {APIError} Code.InvalidArgument if file not convertible
 */
export async function triggerPDFConversion(fileId: string): Promise<PDFConversionInfo> {
	const resp = await rpcCall(async () => {
		return await fileClient.triggerPDFConversion({
			fileId,
		});
	}) as TriggerPDFConversionResponse;

	const info = resp.conversionInfo;
	if (!info) {
		throw new Error("Conversion info not returned from server");
	}

	return {
		status: normalizeConversionStatus(files.ConversionStatus[info.status]),
		pdfUrl: info.pdfDownloadUrl || undefined,
		error: info.errorMessage || undefined,
		duration: info.durationMs || undefined,
	};
}

/**
 * Get content indexing status for a file.
 * 
 * Returns indexing status for full-text search.
 * 
 * @param fileId - File ID
 * @returns Indexing status
 * @throws {APIError} Code.NotFound if file doesn't exist
 * @throws {APIError} Code.PermissionDenied if no access to file
 */
export async function getContentIndexStatus(fileId: string): Promise<ContentIndexInfo> {
	const resp = await rpcCall(async () => {
		return await fileClient.getContentIndexStatus({
			fileId,
		});
	}) as GetContentIndexStatusResponse;

	const info = resp.indexInfo;
	if (!info) {
		throw new Error("Index info not returned from server");
	}

	return {
		status: files.IndexingStatus[info.status].toLowerCase(),
		error: info.errorMessage || undefined,
		duration: info.durationMs || undefined,
	};
}
