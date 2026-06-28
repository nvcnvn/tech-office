/**
 * Chat File Upload API
 * 
 * Feature: 015-file-storage-security-and-access
 * Architecture: Domain-owned upload flow
 * 
 * ChatFileService owns chat attachment uploads to ensure:
 * - Channel membership verification at upload time (security)
 * - Access scope derived from channel properties (server-side, not client-controlled)
 * - No circular dependencies between FileService and ChatService
 * 
 * Upload Flow:
 * 1. Client calls requestChannelFileUpload(channelId, filename, mimeType, sizeBytes)
 * 2. Backend verifies channel membership (returns PermissionDenied if not member)
 * 3. Backend derives access scope from channel.is_private (not client-controlled)
 * 4. Backend creates file_metadata and file_access_rule records
 * 5. Backend returns presigned R2 upload URL
 * 6. Client uploads file directly to R2
 * 7. Client calls confirmChannelFileUpload(channelId, fileId)
 * 8. Backend confirms upload, triggers async workflows (validation, PDF conversion, indexing)
 */

import { chatFileClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { protoTimestampToDate } from "./proto-utils";
import { chat_files } from "rpc";

// Type aliases for RPC response types
type RequestChannelFileUploadResponse = chat_files.RequestChannelFileUploadResponse;
type ConfirmChannelFileUploadResponse = chat_files.ConfirmChannelFileUploadResponse;

/**
 * Response from requestChannelFileUpload with presigned upload URL
 */
export interface UploadURLResponse {
	fileId: string;
	uploadUrl: string;
	expiresAt: Date; // Converted from protobuf Timestamp
}

/**
 * File metadata returned after confirming chat channel upload
 */
export interface ChatFileMetadata {
	id: string;
	originalFilename: string;
	storageKey: string;
	sizeBytes: number;
	mimeType: string;
	uploadContext: string;
	uploadedByEmployeeId: string;
	updatedAt: Date; // Converted from protobuf Timestamp
	isDeleted: boolean;
	validationStatus: string;
	validationMessage: string;
	detectedMimeType: string;
}

/**
 * Request presigned upload URL for chat channel attachment.
 * 
 * Security:
 * - Backend verifies channel membership (returns PermissionDenied if not member)
 * - Backend derives access_scope from channel.is_private (server-side, not client-controlled)
 * - Only channel members can upload attachments to private channels
 * 
 * @param params - Upload request parameters
 * @param params.channelId - Channel ID where file will be attached
 * @param params.filename - Original filename (e.g., "report.docx")
 * @param params.mimeType - MIME type (e.g., "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
 * @param params.sizeBytes - File size in bytes
 * @returns Upload URL and file ID
 * @throws {APIError} Code.PermissionDenied if not a channel member
 * @throws {APIError} Code.ResourceExhausted if quota exceeded
 */
export async function requestChannelFileUpload(params: {
	channelId: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
}): Promise<UploadURLResponse> {
	const resp = await rpcCall(async () => {
		return await chatFileClient.requestChannelFileUpload({
			channelId: params.channelId,
			filename: params.filename,
			mimeType: params.mimeType,
			sizeBytes: BigInt(params.sizeBytes),
		});
	}) as RequestChannelFileUploadResponse;

	return {
		fileId: resp.fileId,
		uploadUrl: resp.uploadUrl,
		expiresAt: protoTimestampToDate(resp.expiresAt) ?? new Date(),
	} as UploadURLResponse;
}

/**
 * Confirm file upload after client successfully uploads to R2.
 * 
 * Security:
 * - Backend verifies channel membership again (prevents race condition)
 * - Backend updates file_metadata status from 'pending' to 'active'
 * - Backend atomically increments organization quota usage
 * 
 * Triggers async workflows:
 * - File type validation (detect MIME type mismatches)
 * - PDF conversion (if office document)
 * - Content indexing (for full-text search)
 * 
 * @param params - Confirm request parameters
 * @param params.channelId - Channel ID where file was attached
 * @param params.fileId - File ID from requestChannelFileUpload
 * @returns File metadata
 * @throws {APIError} Code.PermissionDenied if not a channel member
 * @throws {APIError} Code.NotFound if file doesn't exist or already confirmed
 */
export async function confirmChannelFileUpload(params: {
	channelId: string;
	fileId: string;
}): Promise<ChatFileMetadata> {
	const resp = await rpcCall(async () => {
		return await chatFileClient.confirmChannelFileUpload({
			channelId: params.channelId,
			fileId: params.fileId,
		});
	}) as ConfirmChannelFileUploadResponse;

	const file = resp.file;
	if (!file) {
		throw new Error("File metadata not returned from server");
	}

	return {
		id: file.id,
		originalFilename: file.originalFilename,
		storageKey: file.storageKey,
		sizeBytes: Number(file.sizeBytes),
		mimeType: file.mimeType,
		uploadContext: file.uploadContext,
		uploadedByEmployeeId: file.uploadedByEmployeeId,
		updatedAt: protoTimestampToDate(file.updatedAt) ?? new Date(),
		isDeleted: file.isDeleted,
		validationStatus: file.validationStatus,
		validationMessage: file.validationMessage,
		detectedMimeType: file.detectedMimeType,
	} as ChatFileMetadata;
}
