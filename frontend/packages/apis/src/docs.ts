/**
 * Document Management API functions
 * ConnectRPC-based API calls for Notion/Confluence-style document management
 * Feature: 016-docs-sys-basic-implementation
 */

import {
	documentClient,
	documentVersionClient,
	documentAccessClient,
	documentFollowerClient,
	commentClient,
	documentReactionClient,
	sectionEmbedClient,
	documentEditorClient,
} from "./rpc";
import rpcCall from "./rpcWrapper";
import { protoTimestampToDate } from "./proto-utils";
import { document } from "rpc";

// =============================================================================
// Type Definitions
// =============================================================================

// Enum string types (frontend-friendly)
export type DocumentStatus = 'active' | 'outdated' | 'archived';
export type DocumentVisibility = 'public' | 'private';
export type AccessLevel = 'read_comment' | 'write_update' | 'none';
export type GranteeType = 'employee' | 'department';

// Document with native JavaScript types
export interface Document {
	id: string;
	title: string;
	slug: string;
	parentDocumentId: string; // Empty if root document
	depth: number;
	contentJson: string; // TipTap JSON as string
	status: DocumentStatus;
	visibility: DocumentVisibility;
	ownerEmployeeId: string;
	ownerName: string;
	childCount: number;
	versionCount: number;
	followerCount: number;
	updatedAt: Date;
	path: string[]; // Ancestor IDs from root to parent
}

// Document summary (without content) for lists
export interface DocumentSummary {
	id: string;
	title: string;
	slug: string;
	parentDocumentId: string;
	depth: number;
	status: DocumentStatus;
	visibility: DocumentVisibility;
	ownerName: string;
	childCount: number;
	updatedAt: Date;
}

// Document version for history
export interface DocumentVersion {
	id: string;
	documentId: string;
	versionNumber: number;
	contentJson: string;
	authorEmployeeId: string;
	authorName: string;
	summary: string;
	createdAt: Date;
}

// Document access grant
export interface DocumentAccess {
	id: string;
	documentId: string;
	granteeType: GranteeType;
	granteeId: string;
	granteeName: string;
	accessLevel: AccessLevel;
	grantedByName: string;
	updatedAt: Date;
}

// Comment on document
export interface Comment {
	id: string;
	documentId: string;
	blockId?: string; // Optional: undefined for document-level comments
	textSelectionStart: number;
	textSelectionEnd: number;
	commentText: string;
	authorEmployeeId: string;
	authorName: string;
	isResolved: boolean;
	resolvedByName: string;
	resolvedAt?: Date;
	replyCount: number;
	updatedAt: Date;
	replies: CommentReply[];
}

// Comment reply
export interface CommentReply {
	id: string;
	commentId: string;
	replyText: string;
	authorEmployeeId: string;
	authorName: string;
	updatedAt: Date;
}

// Section embed (cross-document citation)
export interface SectionEmbed {
	id: string;
	sourceDocumentId: string;
	sourceLineStart: number;
	sourceLineEnd: number;
	targetDocumentId: string;
	targetDocumentTitle: string;
	targetLineStart: number;
	targetLineEnd: number;
	targetStatus: DocumentStatus;
	targetVersionNumber?: number; // Version when embed was created (undefined = latest)
	targetLatestVersion?: number; // Current latest version of target document
}

// Incoming citation (documents citing this document's content)
export interface IncomingCitation {
	id: string;
	sourceDocumentId: string;
	sourceDocumentTitle: string;
	sourceDocumentSlug: string;
	sourceOwnerName: string;
	sourceLineStart: number;
	sourceLineEnd: number;
	sourceUpdatedAt: Date;
	targetLineStart: number;
	targetLineEnd: number;
	citedAtVersion: number;
	currentVersion: number;
	isStale: boolean;
}

// Cited line range (aggregated view of which lines are cited)
export interface CitedLineRange {
	startLine: number;
	endLine: number;
	citationCount: number;
}

// Active editor in document
export interface ActiveEditor {
	employeeId: string;
	employeeName: string;
	cursorBlockId: string;
	cursorOffset: number;
	color: string;
	connectedAt: Date;
}

// Blame block for attribution
export interface BlameBlock {
	blockId: string;
	authorEmployeeId: string;
	authorName: string;
	versionNumber: number;
	authoredAt: Date;
}

// Diff change for version comparison
export interface DiffChange {
	changeType: string; // 'added' | 'removed' | 'unchanged' | 'modified'
	content: string;
	oldContent?: string; // For 'modified': markdown-formatted old content
	newContent?: string; // For 'modified': markdown-formatted new content
}

// Search result
export interface SearchResult {
	document: DocumentSummary;
	snippet: string;
	score: number;
	isEmbedded: boolean;
}

// Document tree node
export interface DocumentTreeNode {
	document: DocumentSummary;
	children: DocumentTreeNode[];
}

// =============================================================================
// Proto Enum Converters
// =============================================================================

function protoStatusToString(status: document.DocumentStatus): DocumentStatus {
	switch (status) {
		case document.DocumentStatus.ACTIVE:
			return 'active';
		case document.DocumentStatus.OUTDATED:
			return 'outdated';
		case document.DocumentStatus.ARCHIVED:
			return 'archived';
		default:
			return 'active';
	}
}

function stringToProtoStatus(status: DocumentStatus): document.DocumentStatus {
	switch (status) {
		case 'active':
			return document.DocumentStatus.ACTIVE;
		case 'outdated':
			return document.DocumentStatus.OUTDATED;
		case 'archived':
			return document.DocumentStatus.ARCHIVED;
		default:
			return document.DocumentStatus.ACTIVE;
	}
}

function protoVisibilityToString(visibility: document.DocumentVisibility): DocumentVisibility {
	switch (visibility) {
		case document.DocumentVisibility.PUBLIC:
			return 'public';
		case document.DocumentVisibility.PRIVATE:
			return 'private';
		default:
			return 'private';
	}
}

function stringToProtoVisibility(visibility: DocumentVisibility): document.DocumentVisibility {
	switch (visibility) {
		case 'public':
			return document.DocumentVisibility.PUBLIC;
		case 'private':
			return document.DocumentVisibility.PRIVATE;
		default:
			return document.DocumentVisibility.PRIVATE;
	}
}

function protoAccessLevelToString(level: document.AccessLevel): AccessLevel {
	switch (level) {
		case document.AccessLevel.READ_COMMENT:
			return 'read_comment';
		case document.AccessLevel.WRITE_UPDATE:
			return 'write_update';
		case document.AccessLevel.NONE:
			return 'none';
		default:
			return 'none';
	}
}

function stringToProtoAccessLevel(level: AccessLevel): document.AccessLevel {
	switch (level) {
		case 'read_comment':
			return document.AccessLevel.READ_COMMENT;
		case 'write_update':
			return document.AccessLevel.WRITE_UPDATE;
		case 'none':
			return document.AccessLevel.NONE;
		default:
			return document.AccessLevel.NONE;
	}
}

function protoGranteeTypeToString(type: document.GranteeType): GranteeType {
	switch (type) {
		case document.GranteeType.EMPLOYEE:
			return 'employee';
		case document.GranteeType.DEPARTMENT:
			return 'department';
		default:
			return 'employee';
	}
}

function stringToProtoGranteeType(type: GranteeType): document.GranteeType {
	switch (type) {
		case 'employee':
			return document.GranteeType.EMPLOYEE;
		case 'department':
			return document.GranteeType.DEPARTMENT;
		default:
			return document.GranteeType.EMPLOYEE;
	}
}

// =============================================================================
// Proto to Native Type Converters
// =============================================================================

function protoDocumentToNative(doc: document.Document): Document {
	return {
		id: doc.id,
		title: doc.title,
		slug: doc.slug,
		parentDocumentId: doc.parentDocumentId,
		depth: doc.depth,
		contentJson: doc.contentJson,
		status: protoStatusToString(doc.status),
		visibility: protoVisibilityToString(doc.visibility),
		ownerEmployeeId: doc.ownerEmployeeId,
		ownerName: doc.ownerName,
		childCount: doc.childCount,
		versionCount: doc.versionCount,
		followerCount: doc.followerCount,
		updatedAt: protoTimestampToDate(doc.updatedAt) ?? new Date(),
		path: doc.path,
	};
}

function protoDocumentSummaryToNative(doc: document.DocumentSummary): DocumentSummary {
	return {
		id: doc.id,
		title: doc.title,
		slug: doc.slug,
		parentDocumentId: doc.parentDocumentId,
		depth: doc.depth,
		status: protoStatusToString(doc.status),
		visibility: protoVisibilityToString(doc.visibility),
		ownerName: doc.ownerName,
		childCount: doc.childCount,
		updatedAt: protoTimestampToDate(doc.updatedAt) ?? new Date(),
	};
}

function protoVersionToNative(ver: document.DocumentVersion): DocumentVersion {
	return {
		id: ver.id,
		documentId: ver.documentId,
		versionNumber: ver.versionNumber,
		contentJson: ver.contentJson,
		authorEmployeeId: ver.authorEmployeeId,
		authorName: ver.authorName,
		summary: ver.summary,
		createdAt: protoTimestampToDate(ver.createdAt) ?? new Date(),
	};
}

function protoAccessToNative(access: document.DocumentAccess): DocumentAccess {
	return {
		id: access.id,
		documentId: access.documentId,
		granteeType: protoGranteeTypeToString(access.granteeType),
		granteeId: access.granteeId,
		granteeName: access.granteeName,
		accessLevel: protoAccessLevelToString(access.accessLevel),
		grantedByName: access.grantedByName,
		updatedAt: protoTimestampToDate(access.updatedAt) ?? new Date(),
	};
}

function protoCommentReplyToNative(reply: document.CommentReply): CommentReply {
	return {
		id: reply.id,
		commentId: reply.commentId,
		replyText: reply.replyText,
		authorEmployeeId: reply.authorEmployeeId,
		authorName: reply.authorName,
		updatedAt: protoTimestampToDate(reply.updatedAt) ?? new Date(),
	};
}

function protoCommentToNative(comment: document.Comment): Comment {
	return {
		id: comment.id,
		documentId: comment.documentId,
		blockId: comment.blockId ?? undefined, // Handle optional
		textSelectionStart: comment.textSelectionStart,
		textSelectionEnd: comment.textSelectionEnd,
		commentText: comment.commentText,
		authorEmployeeId: comment.authorEmployeeId,
		authorName: comment.authorName,
		isResolved: comment.isResolved,
		resolvedByName: comment.resolvedByName,
		resolvedAt: comment.resolvedAt ? protoTimestampToDate(comment.resolvedAt) : undefined,
		replyCount: comment.replyCount,
		updatedAt: protoTimestampToDate(comment.updatedAt) ?? new Date(),
		replies: comment.replies.map(protoCommentReplyToNative),
	};
}

function protoSectionEmbedToNative(embed: document.SectionEmbed): SectionEmbed {
	return {
		id: embed.id,
		sourceDocumentId: embed.sourceDocumentId,
		sourceLineStart: embed.sourceLineStart,
		sourceLineEnd: embed.sourceLineEnd,
		targetDocumentId: embed.targetDocumentId,
		targetDocumentTitle: embed.targetDocumentTitle,
		targetLineStart: embed.targetLineStart,
		targetLineEnd: embed.targetLineEnd,
		targetStatus: protoStatusToString(embed.targetStatus),
		targetVersionNumber: embed.targetVersionNumber,
		targetLatestVersion: embed.targetLatestVersion,
	};
}

function protoIncomingCitationToNative(
	citation: document.IncomingCitation
): IncomingCitation {
	return {
		id: citation.id,
		sourceDocumentId: citation.sourceDocumentId,
		sourceDocumentTitle: citation.sourceDocumentTitle,
		sourceDocumentSlug: citation.sourceDocumentSlug,
		sourceOwnerName: citation.sourceOwnerName,
		sourceLineStart: citation.sourceLineStart,
		sourceLineEnd: citation.sourceLineEnd,
		sourceUpdatedAt: protoTimestampToDate(citation.sourceUpdatedAt) ?? new Date(),
		targetLineStart: citation.targetLineStart,
		targetLineEnd: citation.targetLineEnd,
		citedAtVersion: citation.citedAtVersion,
		currentVersion: citation.currentVersion,
		isStale: citation.isStale,
	};
}

function protoActiveEditorToNative(editor: document.ActiveEditor): ActiveEditor {
	return {
		employeeId: editor.employeeId,
		employeeName: editor.employeeName,
		cursorBlockId: editor.cursorBlockId,
		cursorOffset: editor.cursorOffset,
		color: editor.color,
		connectedAt: protoTimestampToDate(editor.connectedAt) ?? new Date(),
	};
}

function protoBlameBlockToNative(block: document.BlameBlock): BlameBlock {
	return {
		blockId: block.blockId,
		authorEmployeeId: block.authorEmployeeId,
		authorName: block.authorName,
		versionNumber: block.versionNumber,
		authoredAt: protoTimestampToDate(block.authoredAt) ?? new Date(),
	};
}

function protoDiffChangeToNative(change: document.DiffChange): DiffChange {
	return {
		changeType: change.changeType,
		content: change.content,
		oldContent: change.oldContent || undefined,
		newContent: change.newContent || undefined,
	};
}

function protoSearchResultToNative(result: document.SearchResult): SearchResult {
	return {
		document: protoDocumentSummaryToNative(result.document!),
		snippet: result.snippet,
		score: result.score,
		isEmbedded: result.isEmbedded,
	};
}

function protoDocumentTreeNodeToNative(node: document.DocumentTreeNode): DocumentTreeNode {
	return {
		document: protoDocumentSummaryToNative(node.document!),
		children: node.children.map(protoDocumentTreeNodeToNative),
	};
}

// =============================================================================
// DocumentService API Functions
// =============================================================================

export interface CreateDocumentParams {
	title: string;
	parentDocumentId?: string;
	contentJson?: string;
	visibility?: DocumentVisibility;
}

export interface CreateDocumentResponse {
	document: Document;
}

/**
 * Create a new document
 */
export async function createDocument(params: CreateDocumentParams): Promise<CreateDocumentResponse> {
	return await rpcCall(async () => {
		const response = await documentClient.createDocument({
			title: params.title,
			parentDocumentId: params.parentDocumentId ?? '',
			contentJson: params.contentJson ?? '{}',
			visibility: params.visibility ? stringToProtoVisibility(params.visibility) : document.DocumentVisibility.PRIVATE,
		});
		const typed = response as document.CreateDocumentResponse;
		return {
			document: protoDocumentToNative(typed.document!),
		};
	});
}

export interface GetDocumentParams {
	id?: string;
	slug?: string;
	includeContent?: boolean;
}

export interface GetDocumentResponse {
	document: Document;
	isFollowing: boolean;
	effectiveAccess: AccessLevel;
	activeEditorCount: number;
}

/**
 * Get a document by ID or slug
 */
export async function getDocument(params: GetDocumentParams): Promise<GetDocumentResponse> {
	return await rpcCall(async () => {
		// Build request with proper oneof identifier field for protobuf
		const request: {
			includeContent: boolean;
			identifier?: { case: 'id'; value: string } | { case: 'slug'; value: string };
		} = {
			includeContent: params.includeContent ?? true,
		};

		// Set identifier oneof field
		if (params.id) {
			request.identifier = { case: 'id', value: params.id };
		} else if (params.slug) {
			request.identifier = { case: 'slug', value: params.slug };
		}

		const response = await documentClient.getDocument(request);
		const typed = response as document.GetDocumentResponse;
		return {
			document: protoDocumentToNative(typed.document!),
			isFollowing: typed.isFollowing,
			effectiveAccess: protoAccessLevelToString(typed.effectiveAccess),
			activeEditorCount: typed.activeEditorCount,
		};
	});
}

export interface UpdateDocumentParams {
	id: string;
	title?: string;
	contentJson?: string;
	versionSummary?: string;
}

export interface UpdateDocumentResponse {
	document: Document;
	newVersionNumber: number;
}

/**
 * Update a document (creates a new version)
 */
export async function updateDocument(params: UpdateDocumentParams): Promise<UpdateDocumentResponse> {
	return await rpcCall(async () => {
		const response = await documentClient.updateDocument({
			id: params.id,
			title: params.title ?? '',
			contentJson: params.contentJson ?? '',
			versionSummary: params.versionSummary ?? '',
		});
		const typed = response as document.UpdateDocumentResponse;
		return {
			document: protoDocumentToNative(typed.document!),
			newVersionNumber: typed.newVersionNumber,
		};
	});
}

export interface DeleteDocumentResponse {
	success: boolean;
	orphanedChildrenCount: number;
}

/**
 * Delete a document (soft delete)
 */
export async function deleteDocument(id: string): Promise<DeleteDocumentResponse> {
	return await rpcCall(async () => {
		const response = await documentClient.deleteDocument({ id });
		const typed = response as document.DeleteDocumentResponse;
		return {
			success: typed.success,
			orphanedChildrenCount: typed.orphanedChildrenCount,
		};
	});
}

export interface ListDocumentsParams {
	parentDocumentId?: string;
	statusFilter?: DocumentStatus;
	cursor?: string;
	limit?: number;
}

export interface ListDocumentsResponse {
	documents: DocumentSummary[];
	nextCursor: string;
}

/**
 * List documents (optionally under a parent)
 */
export async function listDocuments(params: ListDocumentsParams): Promise<ListDocumentsResponse> {
	return await rpcCall(async () => {
		const response = await documentClient.listDocuments({
			parentDocumentId: params.parentDocumentId ?? '',
			statusFilter: params.statusFilter ? stringToProtoStatus(params.statusFilter) : document.DocumentStatus.UNSPECIFIED,
			cursor: params.cursor ?? '',
			limit: params.limit ?? 20,
		});
		const typed = response as document.ListDocumentsResponse;
		return {
			documents: typed.documents.map(protoDocumentSummaryToNative),
			nextCursor: typed.nextCursor,
		};
	});
}

export interface GetDocumentTreeParams {
	rootDocumentId?: string;
	maxDepth?: number;
}

export interface GetDocumentTreeResponse {
	nodes: DocumentTreeNode[];
}

/**
 * Get document tree structure
 */
export async function getDocumentTree(params: GetDocumentTreeParams): Promise<GetDocumentTreeResponse> {
	return await rpcCall(async () => {
		const response = await documentClient.getDocumentTree({
			rootDocumentId: params.rootDocumentId ?? '',
			maxDepth: params.maxDepth ?? 10,
		});
		const typed = response as document.GetDocumentTreeResponse;
		return {
			nodes: typed.nodes.map(protoDocumentTreeNodeToNative),
		};
	});
}

export interface SearchDocumentsParams {
	query: string;
	statusFilter?: DocumentStatus;
	cursor?: string;
	limit?: number;
}

export interface SearchDocumentsResponse {
	results: SearchResult[];
	nextCursor: string;
}

/**
 * Search documents by content
 */
export async function searchDocuments(params: SearchDocumentsParams): Promise<SearchDocumentsResponse> {
	return await rpcCall(async () => {
		const response = await documentClient.searchDocuments({
			query: params.query,
			statusFilter: params.statusFilter ? stringToProtoStatus(params.statusFilter) : document.DocumentStatus.UNSPECIFIED,
			cursor: params.cursor ?? '',
			limit: params.limit ?? 20,
		});
		const typed = response as document.SearchDocumentsResponse;
		return {
			results: typed.results.map(protoSearchResultToNative),
			nextCursor: typed.nextCursor,
		};
	});
}

export interface UpdateDocumentStatusResponse {
	document: Document;
}

/**
 * Update document status (active/outdated/archived)
 */
export async function updateDocumentStatus(id: string, status: DocumentStatus): Promise<UpdateDocumentStatusResponse> {
	return await rpcCall(async () => {
		const response = await documentClient.updateDocumentStatus({
			id,
			status: stringToProtoStatus(status),
		});
		const typed = response as document.UpdateDocumentStatusResponse;
		return {
			document: protoDocumentToNative(typed.document!),
		};
	});
}

export interface ResolveSlugResponse {
	currentSlug: string;
	isRedirect: boolean;
	documentId: string;
}

/**
 * Resolve a slug to document (handles redirects)
 */
export async function resolveSlug(slug: string): Promise<ResolveSlugResponse> {
	return await rpcCall(async () => {
		const response = await documentClient.resolveSlug({ slug });
		const typed = response as document.ResolveSlugResponse;
		return {
			currentSlug: typed.currentSlug,
			isRedirect: typed.isRedirect,
			documentId: typed.documentId,
		};
	});
}

// =============================================================================
// DocumentVersionService API Functions
// =============================================================================

export interface ListVersionsParams {
	documentId: string;
	cursor?: string;
	limit?: number;
}

export interface ListVersionsResponse {
	versions: DocumentVersion[];
	nextCursor: string;
}

/**
 * List document versions (history)
 */
export async function listVersions(params: ListVersionsParams): Promise<ListVersionsResponse> {
	return await rpcCall(async () => {
		const response = await documentVersionClient.listVersions({
			documentId: params.documentId,
			cursor: params.cursor ?? '',
			limit: params.limit ?? 20,
		});
		const typed = response as document.ListVersionsResponse;
		return {
			versions: typed.versions.map(protoVersionToNative),
			nextCursor: typed.nextCursor,
		};
	});
}

export interface GetVersionParams {
	documentId: string;
	versionNumber: number;
}

export interface GetVersionResponse {
	version: DocumentVersion;
}

/**
 * Get a specific version
 */
export async function getVersion(params: GetVersionParams): Promise<GetVersionResponse> {
	return await rpcCall(async () => {
		const response = await documentVersionClient.getVersion({
			documentId: params.documentId,
			versionNumber: params.versionNumber,
		});
		const typed = response as document.GetVersionResponse;
		return {
			version: protoVersionToNative(typed.version!),
		};
	});
}

export interface GetVersionDiffParams {
	documentId: string;
	fromVersion: number;
	toVersion: number;
}

export interface GetVersionDiffResponse {
	changes: DiffChange[];
	fromVersion: DocumentVersion;
	toVersion: DocumentVersion;
}

/**
 * Get diff between two versions
 */
export async function getVersionDiff(params: GetVersionDiffParams): Promise<GetVersionDiffResponse> {
	return await rpcCall(async () => {
		const response = await documentVersionClient.getVersionDiff({
			documentId: params.documentId,
			fromVersion: params.fromVersion,
			toVersion: params.toVersion,
		});
		const typed = response as document.GetVersionDiffResponse;
		return {
			changes: typed.changes.map(protoDiffChangeToNative),
			fromVersion: protoVersionToNative(typed.fromVersion!),
			toVersion: protoVersionToNative(typed.toVersion!),
		};
	});
}

export interface GetBlameResponse {
	blocks: BlameBlock[];
}

/**
 * Get blame information (who authored each block)
 */
export async function getBlame(documentId: string): Promise<GetBlameResponse> {
	return await rpcCall(async () => {
		const response = await documentVersionClient.getBlame({ documentId });
		const typed = response as document.GetBlameResponse;
		return {
			blocks: typed.blocks.map(protoBlameBlockToNative),
		};
	});
}

// =============================================================================
// DocumentAccessService API Functions
// =============================================================================

export interface SetAccessParams {
	documentId: string;
	granteeType: GranteeType;
	granteeId: string;
	accessLevel: AccessLevel;
}

export interface SetAccessResponse {
	access: DocumentAccess;
}

/**
 * Set access grant for a document
 */
export async function setAccess(params: SetAccessParams): Promise<SetAccessResponse> {
	return await rpcCall(async () => {
		const response = await documentAccessClient.setAccess({
			documentId: params.documentId,
			granteeType: stringToProtoGranteeType(params.granteeType),
			granteeId: params.granteeId,
			accessLevel: stringToProtoAccessLevel(params.accessLevel),
		});
		const typed = response as document.SetAccessResponse;
		return {
			access: protoAccessToNative(typed.access!),
		};
	});
}

export interface RemoveAccessParams {
	documentId: string;
	granteeType: GranteeType;
	granteeId: string;
}

export interface RemoveAccessResponse {
	success: boolean;
}

/**
 * Remove access grant for a document
 */
export async function removeAccess(params: RemoveAccessParams): Promise<RemoveAccessResponse> {
	return await rpcCall(async () => {
		const response = await documentAccessClient.removeAccess({
			documentId: params.documentId,
			granteeType: stringToProtoGranteeType(params.granteeType),
			granteeId: params.granteeId,
		});
		const typed = response as document.RemoveAccessResponse;
		return {
			success: typed.success,
		};
	});
}

export interface ListAccessResponse {
	accessList: DocumentAccess[];
	inheritedVisibility: DocumentVisibility;
}

/**
 * List all access grants for a document
 */
export async function listAccess(documentId: string): Promise<ListAccessResponse> {
	return await rpcCall(async () => {
		const response = await documentAccessClient.listAccess({ documentId });
		const typed = response as document.ListAccessResponse;
		return {
			accessList: typed.accessList.map(protoAccessToNative),
			inheritedVisibility: protoVisibilityToString(typed.inheritedVisibility),
		};
	});
}

export interface CheckAccessResponse {
	accessLevel: AccessLevel;
	isOwner: boolean;
}

/**
 * Check current user's access to a document
 */
export async function checkAccess(documentId: string): Promise<CheckAccessResponse> {
	return await rpcCall(async () => {
		const response = await documentAccessClient.checkAccess({ documentId });
		const typed = response as document.CheckAccessResponse;
		return {
			accessLevel: protoAccessLevelToString(typed.accessLevel),
			isOwner: typed.isOwner,
		};
	});
}

// =============================================================================
// DocumentFollowerService API Functions
// =============================================================================

export interface FollowDocumentResponse {
	success: boolean;
}

/**
 * Follow a document for notifications
 */
export async function followDocument(documentId: string): Promise<FollowDocumentResponse> {
	return await rpcCall(async () => {
		const response = await documentFollowerClient.followDocument({ documentId });
		const typed = response as document.FollowDocumentResponse;
		return {
			success: typed.success,
		};
	});
}

export interface UnfollowDocumentResponse {
	success: boolean;
}

/**
 * Unfollow a document
 */
export async function unfollowDocument(documentId: string): Promise<UnfollowDocumentResponse> {
	return await rpcCall(async () => {
		const response = await documentFollowerClient.unfollowDocument({ documentId });
		const typed = response as document.UnfollowDocumentResponse;
		return {
			success: typed.success,
		};
	});
}

export interface ListFollowedDocumentsParams {
	cursor?: string;
	limit?: number;
}

export interface ListFollowedDocumentsResponse {
	documents: DocumentSummary[];
	nextCursor: string;
}

/**
 * List documents the current user follows
 */
export async function listFollowedDocuments(params: ListFollowedDocumentsParams): Promise<ListFollowedDocumentsResponse> {
	return await rpcCall(async () => {
		const response = await documentFollowerClient.listFollowedDocuments({
			cursor: params.cursor ?? '',
			limit: params.limit ?? 20,
		});
		const typed = response as document.ListFollowedDocumentsResponse;
		return {
			documents: typed.documents.map(protoDocumentSummaryToNative),
			nextCursor: typed.nextCursor,
		};
	});
}

// =============================================================================
// CommentService API Functions
// =============================================================================

export interface AddCommentParams {
	documentId: string;
	blockId?: string; // Optional: omit for document-level comments
	textSelectionStart?: number;
	textSelectionEnd?: number;
	commentText: string;
}

export interface AddCommentResponse {
	comment: Comment;
}

/**
 * Add a comment to a document block (or document-level if blockId omitted)
 */
export async function addComment(params: AddCommentParams): Promise<AddCommentResponse> {
	return await rpcCall(async () => {
		const response = await commentClient.addComment({
			documentId: params.documentId,
			blockId: params.blockId, // Can be undefined for document-level comments
			textSelectionStart: params.textSelectionStart ?? 0,
			textSelectionEnd: params.textSelectionEnd ?? 0,
			commentText: params.commentText,
		});
		const typed = response as document.AddCommentResponse;
		return {
			comment: protoCommentToNative(typed.comment!),
		};
	});
}

export interface AddCommentReplyParams {
	commentId: string;
	replyText: string;
}

export interface AddCommentReplyResponse {
	reply: CommentReply;
}

/**
 * Add a reply to a comment
 */
export async function addCommentReply(params: AddCommentReplyParams): Promise<AddCommentReplyResponse> {
	return await rpcCall(async () => {
		const response = await commentClient.addCommentReply({
			commentId: params.commentId,
			replyText: params.replyText,
		});
		const typed = response as document.AddCommentReplyResponse;
		return {
			reply: protoCommentReplyToNative(typed.reply!),
		};
	});
}

export interface ResolveCommentResponse {
	comment: Comment;
}

/**
 * Resolve (close) a comment
 */
export async function resolveComment(commentId: string): Promise<ResolveCommentResponse> {
	return await rpcCall(async () => {
		const response = await commentClient.resolveComment({ commentId });
		const typed = response as document.ResolveCommentResponse;
		return {
			comment: protoCommentToNative(typed.comment!),
		};
	});
}

export interface ListCommentsParams {
	documentId: string;
	includeResolved?: boolean;
}

export interface ListCommentsResponse {
	comments: Comment[];
}

/**
 * List comments on a document
 */
export async function listComments(params: ListCommentsParams): Promise<ListCommentsResponse> {
	return await rpcCall(async () => {
		const response = await commentClient.listComments({
			documentId: params.documentId,
			includeResolved: params.includeResolved ?? false,
		});
		const typed = response as document.ListCommentsResponse;
		return {
			comments: typed.comments.map(protoCommentToNative),
		};
	});
}

export interface DeleteCommentResponse {
	success: boolean;
}

/**
 * Delete a comment
 */
export async function deleteComment(commentId: string): Promise<DeleteCommentResponse> {
	return await rpcCall(async () => {
		const response = await commentClient.deleteComment({ commentId });
		const typed = response as document.DeleteCommentResponse;
		return {
			success: typed.success,
		};
	});
}

// =============================================================================
// SectionEmbedService API Functions
// =============================================================================

export interface CreateEmbedParams {
	sourceDocumentId: string;
	sourceLineStart: number;
	sourceLineEnd: number;
	targetDocumentId: string;
	targetLineStart: number;
	targetLineEnd: number;
	targetVersionNumber?: number; // Lock to specific version (undefined = always latest)
}

export interface CreateEmbedResponse {
	embed: SectionEmbed;
}

/**
 * Create a section embed (cross-document citation)
 */
export async function createEmbed(params: CreateEmbedParams): Promise<CreateEmbedResponse> {
	return await rpcCall(async () => {
		const response = await sectionEmbedClient.createEmbed({
			sourceDocumentId: params.sourceDocumentId,
			sourceLineStart: params.sourceLineStart,
			sourceLineEnd: params.sourceLineEnd,
			targetDocumentId: params.targetDocumentId,
			targetLineStart: params.targetLineStart,
			targetLineEnd: params.targetLineEnd,
			targetVersionNumber: params.targetVersionNumber,
		});
		const typed = response as document.CreateEmbedResponse;
		return {
			embed: protoSectionEmbedToNative(typed.embed!),
		};
	});
}

export interface GetEmbeddedSectionResponse {
	embed: SectionEmbed;
	contentText: string; // Plain text for line extraction
	contentJson: string; // TipTap JSON
	targetAccessible: boolean;
}

/**
 * Get embedded section content
 */
export async function getEmbeddedSection(embedId: string): Promise<GetEmbeddedSectionResponse> {
	return await rpcCall(async () => {
		const response = await sectionEmbedClient.getEmbeddedSection({ embedId });
		const typed = response as document.GetEmbeddedSectionResponse;
		return {
			embed: protoSectionEmbedToNative(typed.embed!),
			contentText: typed.contentText,
			contentJson: typed.contentJson,
			targetAccessible: typed.targetAccessible,
		};
	});
}

export interface ListEmbedsResponse {
	embeds: SectionEmbed[];
}

/**
 * List embeds in a document
 */
export async function listEmbeds(documentId: string): Promise<ListEmbedsResponse> {
	return await rpcCall(async () => {
		const response = await sectionEmbedClient.listEmbeds({ documentId });
		const typed = response as document.ListEmbedsResponse;
		return {
			embeds: typed.embeds.map(protoSectionEmbedToNative),
		};
	});
}

export interface DeleteEmbedResponse {
	success: boolean;
}

/**
 * Delete an embed
 */
export async function deleteEmbed(embedId: string): Promise<DeleteEmbedResponse> {
	return await rpcCall(async () => {
		const response = await sectionEmbedClient.deleteEmbed({ embedId });
		const typed = response as document.DeleteEmbedResponse;
		return {
			success: typed.success,
		};
	});
}

export interface ListIncomingCitationsResponse {
	citations: IncomingCitation[];
	totalCount: number;
	citedLineRanges: CitedLineRange[];
}

/**
 * List all documents that cite (embed) sections from this document.
 * Used to help document owners understand who is referencing their content
 * and which lines are being cited.
 */
export async function listIncomingCitations(
	documentId: string
): Promise<ListIncomingCitationsResponse> {
	return await rpcCall(async () => {
		const response = await sectionEmbedClient.listIncomingCitations({ documentId });
		const typed = response as document.ListIncomingCitationsResponse;
		return {
			citations: typed.citations.map(protoIncomingCitationToNative),
			totalCount: typed.totalCount,
			citedLineRanges: typed.citedLineRanges.map((r) => ({
				startLine: r.startLine,
				endLine: r.endLine,
				citationCount: r.citationCount,
			})),
		};
	});
}

// =============================================================================
// DocumentEditorService API Functions
// =============================================================================

export interface JoinDocumentResponse {
	success: boolean;
	connectionId: string;
	currentEditors: ActiveEditor[];
	editorLimitReached: boolean;
}

/**
 * Join document editing session
 */
export async function joinDocument(documentId: string): Promise<JoinDocumentResponse> {
	return await rpcCall(async () => {
		const response = await documentEditorClient.joinDocument({ documentId });
		const typed = response as document.JoinDocumentResponse;
		return {
			success: typed.success,
			connectionId: typed.connectionId,
			currentEditors: typed.currentEditors.map(protoActiveEditorToNative),
			editorLimitReached: typed.editorLimitReached,
		};
	});
}

export interface LeaveDocumentResponse {
	success: boolean;
}

/**
 * Leave document editing session
 */
export async function leaveDocument(documentId: string): Promise<LeaveDocumentResponse> {
	return await rpcCall(async () => {
		const response = await documentEditorClient.leaveDocument({ documentId });
		const typed = response as document.LeaveDocumentResponse;
		return {
			success: typed.success,
		};
	});
}

export interface UpdateCursorParams {
	documentId: string;
	blockId: string;
	offset: number;
}

export interface UpdateCursorResponse {
	success: boolean;
}

/**
 * Update cursor position in document
 */
export async function updateCursor(params: UpdateCursorParams): Promise<UpdateCursorResponse> {
	return await rpcCall(async () => {
		const response = await documentEditorClient.updateCursor({
			documentId: params.documentId,
			blockId: params.blockId,
			offset: params.offset,
		});
		const typed = response as document.UpdateCursorResponse;
		return {
			success: typed.success,
		};
	});
}

export interface ListActiveEditorsResponse {
	editors: ActiveEditor[];
	editorCount: number;
	maxEditors: number;
}

/**
 * List active editors for a document
 */
export async function listActiveEditors(documentId: string): Promise<ListActiveEditorsResponse> {
	return await rpcCall(async () => {
		const response = await documentEditorClient.listActiveEditors({ documentId });
		const typed = response as document.ListActiveEditorsResponse;
		return {
			editors: typed.editors.map(protoActiveEditorToNative),
			editorCount: typed.editorCount,
			maxEditors: typed.maxEditors,
		};
	});
}

export interface HeartbeatResponse {
	success: boolean;
}

/**
 * Send heartbeat to keep editor session alive
 */
export async function heartbeat(documentId: string): Promise<HeartbeatResponse> {
	return await rpcCall(async () => {
		const response = await documentEditorClient.heartbeat({ documentId });
		const typed = response as document.HeartbeatResponse;
		return {
			success: typed.success,
		};
	});
}

// =============================================================================
// Document Reaction API
// =============================================================================

// Reaction type enum
export type ReactionType = 'thumbs_up' | 'thumbs_down';

// Document reaction
export interface DocumentReaction {
	id: string;
	documentId: string;
	employeeId: string;
	employeeName: string;
	reactionType: ReactionType;
	updatedAt: Date;
}

// Proto reaction converters
function protoReactionTypeToString(type: document.ReactionType): ReactionType {
	switch (type) {
		case document.ReactionType.THUMBS_UP:
			return 'thumbs_up';
		case document.ReactionType.THUMBS_DOWN:
			return 'thumbs_down';
		default:
			return 'thumbs_up';
	}
}

function stringToProtoReactionType(type: ReactionType): document.ReactionType {
	switch (type) {
		case 'thumbs_up':
			return document.ReactionType.THUMBS_UP;
		case 'thumbs_down':
			return document.ReactionType.THUMBS_DOWN;
		default:
			return document.ReactionType.THUMBS_UP;
	}
}

function protoReactionToNative(proto: document.DocumentReaction): DocumentReaction {
	return {
		id: proto.id,
		documentId: proto.documentId,
		employeeId: proto.employeeId,
		employeeName: proto.employeeName,
		reactionType: protoReactionTypeToString(proto.reactionType),
		updatedAt: protoTimestampToDate(proto.updatedAt) || new Date(),
	};
}

export interface AddDocumentReactionParams {
	documentId: string;
	reactionType: ReactionType;
}

export interface AddDocumentReactionResponse {
	reaction: DocumentReaction;
}

/**
 * Add reaction to document (thumbs up/down)
 */
export async function addDocumentReaction(params: AddDocumentReactionParams): Promise<AddDocumentReactionResponse> {
	return await rpcCall(async () => {
		const response = await documentReactionClient.addReaction({
			documentId: params.documentId,
			reactionType: stringToProtoReactionType(params.reactionType),
		});
		const typed = response as document.AddDocumentReactionResponse;
		return {
			reaction: protoReactionToNative(typed.reaction!),
		};
	});
}

export interface RemoveDocumentReactionResponse {
	success: boolean;
}

/**
 * Remove reaction from document
 */
export async function removeDocumentReaction(documentId: string): Promise<RemoveDocumentReactionResponse> {
	return await rpcCall(async () => {
		const response = await documentReactionClient.removeReaction({ documentId });
		const typed = response as document.RemoveDocumentReactionResponse;
		return {
			success: typed.success,
		};
	});
}

export interface GetDocumentReactionStatsResponse {
	thumbsUpCount: number;
	thumbsDownCount: number;
	userReaction?: ReactionType;
}

/**
 * Get reaction statistics for document
 */
export async function getDocumentReactionStats(documentId: string): Promise<GetDocumentReactionStatsResponse> {
	return await rpcCall(async () => {
		const response = await documentReactionClient.getReactionStats({ documentId });
		const typed = response as document.GetDocumentReactionStatsResponse;
		return {
			thumbsUpCount: typed.thumbsUpCount,
			thumbsDownCount: typed.thumbsDownCount,
			userReaction: typed.userReaction ? protoReactionTypeToString(typed.userReaction) : undefined,
		};
	});
}

