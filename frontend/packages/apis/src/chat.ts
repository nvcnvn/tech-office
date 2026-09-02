/**
 * Chat API functions
 * ConnectRPC-based API calls for chat channel management, messaging, and reactions
 */

import { chatClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { APIError, ValidationError } from "./errors";
import { chat } from "rpc";
import { RetryInfoSchema } from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";

// Type aliases for RPC responses
type CreateChannelResponse = chat.CreateChannelResponse;
export type GetChannelResponse = chat.GetChannelResponse;
type ListChannelsResponse = chat.ListChannelsResponse;
type UpdateChannelResponse = chat.UpdateChannelResponse;
type ArchiveChannelResponse = chat.ArchiveChannelResponse;
type UnarchiveChannelResponse = chat.UnarchiveChannelResponse;
type JoinChannelResponse = chat.JoinChannelResponse;
type LeaveChannelResponse = chat.LeaveChannelResponse;
type InviteMemberResponse = chat.InviteMemberResponse;
type RemoveMemberResponse = chat.RemoveMemberResponse;
type ListChannelMembersResponse = chat.ListChannelMembersResponse;
type UpdateMemberRoleResponse = chat.UpdateMemberRoleResponse;
type UpdateNotificationPreferenceResponse = chat.UpdateNotificationPreferenceResponse;
type SendMessageResponse = chat.SendMessageResponse;
type ReplyToMessageResponse = chat.ReplyToMessageResponse;
type EditMessageResponse = chat.EditMessageResponse;
type DeleteMessageResponse = chat.DeleteMessageResponse;
type ListMessagesResponse = chat.ListMessagesResponse;
type GetMessageResponse = chat.GetMessageResponse;
type ListRepliesResponse = chat.ListRepliesResponse;
type GetMessageByIdResponse = chat.GetMessageByIdResponse;
type MarkChannelAsReadResponse = chat.MarkChannelAsReadResponse;
type AddReactionResponse = chat.AddReactionResponse;
type RemoveReactionResponse = chat.RemoveReactionResponse;
type ListReactionsResponse = chat.ListReactionsResponse;
type StartTypingResponse = chat.StartTypingResponse;
type StopTypingResponse = chat.StopTypingResponse;
export type GetChannelContextSummaryResponse = chat.GetChannelContextSummaryResponse;

// ============================================================================
// Constants and Type Definitions
// ============================================================================

/**
 * Numeric values for rpc.v1.ListMessagesDirection.
 * MUST stay aligned with backend/rpc/v1/chat.proto enum definitions.
 */
const LIST_MESSAGES_DIRECTION = {
	UNSPECIFIED: 0,
	OLDER: 1,
	NEWER: 2,
} as const;

/**
 * Channel type constants.
 * 
 * MUST align with:
 * - Database CHECK constraint: chat.channel.channel_type
 * - Backend Go constants: internal/chat/constants.go
 * - Proto enum: rpc.v1.ChannelType
 * 
 * When adding/removing values:
 * 1. Update database CHECK constraint in backend/database/scripts/schema.sql
 * 2. Update backend Go constants
 * 3. Update proto enum in backend/rpc/v1/chat.proto
 * 4. Update this TypeScript type
 * 5. Submit all changes in single PR with alignment verification
 */
export type ChannelType =
	| 'chat'
	| 'direct_message'
	| 'project_ticket_thread'
	| 'crm_deal_notes'
	| 'support_ticket';


/**
 * Notification preference constants.
 * 
 * MUST align with:
 * - Database CHECK constraint: chat.channel_membership.notification_preference
 * - Backend Go constants: internal/chat/constants.go
 * - Proto enum: rpc.v1.NotificationPreference
 * 
 * When adding/removing values:
 * 1. Update database CHECK constraint in backend/database/scripts/schema.sql
 * 2. Update backend Go constants
 * 3. Update proto enum in backend/rpc/v1/chat.proto
 * 4. Update this TypeScript type
 * 5. Submit all changes in single PR with alignment verification
 */
export type NotificationPreference = 'all' | 'mentions' | 'muted';

export type MessageKind = 'text' | 'voice' | 'system';

export type SystemEventType =
	| 'voice_call_started'
	| 'voice_call_ended'
	| 'voice_call_missed'
	| 'voice_call_cancelled'
	| 'task_created_from_message';

/**
 * The system event a conversion leaves on the message it came from.
 *
 * Exported as a named constant so no client spells the string inline: it must match the
 * database CHECK on chat.message and SystemEventTypeTaskCreatedFromMessage in the Go
 * chat package exactly (constitution principle VIII), and the match is asserted in
 * backend/integration/collaboration_constants_test.go.
 */
export const SYSTEM_EVENT_TASK_CREATED_FROM_MESSAGE: SystemEventType = 'task_created_from_message';


// ============================================================================
// Custom Output Types
// ============================================================================

/**
 * Channel details with JavaScript-friendly types
 */
export interface Channel {
	id: string;
	titleSlug: string;
	displayName: string;
	description: string;
	channelType: ChannelType;
	isPrivate: boolean;
	isArchived: boolean;
	createdByEmployeeId: string;
	updatedAt: Date;
}

// ============================================================================
// Custom Input Parameter Types
// ============================================================================

/**
 * Parameters for creating a channel
 */
export interface CreateChannelParams {
	/** Channel slug (lowercase, alphanumeric, hyphens) */
	slug: string;
	/** Channel display name */
	name: string;
	/** Channel description */
	description?: string;
	/** Whether channel is private (default: false) */
	isPrivate?: boolean;
}

/**
 * Parameters for listing channels
 */
export interface ListChannelsParams {
	/** Filter by channel type (empty = all) */
	channelType?: "PUBLIC" | "PRIVATE" | "ARCHIVED";
	/** Number of channels per page (default: 50, max: 100) */
	pageSize?: number;
	/** Pagination cursor token */
	pageToken?: string;
}

/**
 * Parameters for updating a channel
 */
export interface UpdateChannelParams {
	/** Channel UUID */
	channelId: string;
	/** New channel name (optional) */
	name?: string;
	/** New description (optional) */
	description?: string;
	/** New privacy setting (optional) */
	isPrivate?: boolean;
}

/**
 * Parameters for inviting a member
 */
export interface InviteMemberParams {
	/** Channel UUID */
	channelId: string;
	/** Employee UUID to invite */
	employeeId: string;
	/** Initial role (default: MEMBER) */
	role?: "ADMIN" | "MEMBER";
}

/**
 * Parameters for removing a member
 */
export interface RemoveMemberParams {
	/** Channel UUID */
	channelId: string;
	/** Employee UUID to remove */
	employeeId: string;
}

/**
 * Parameters for listing channel members
 */
export interface ListChannelMembersParams {
	/** Channel UUID */
	channelId: string;
	/** Number of members per page (default: 50, max: 100) */
	pageSize?: number;
	/** Pagination cursor token */
	pageToken?: string;
}

/**
 * Parameters for updating a member's role
 */
export interface UpdateMemberRoleParams {
	/** Channel UUID */
	channelId: string;
	/** Employee UUID */
	employeeId: string;
	/** New role */
	role: "ADMIN" | "MEMBER";
}

/**
 * Parameters for updating notification preference
 */
export interface UpdateNotificationPreferenceParams {
	/** Channel UUID */
	channelId: string;
	/** Notification preference */
	notificationPreference: "ALL" | "MENTIONS" | "NONE";
}

/**
 * Parameters for sending a message
 */
export interface SendMessageParams {
	/** Channel UUID */
	channelId: string;
	/** Message text content */
	messageText: string;
	/** Optional file attachment IDs from FileService */
	fileIds?: string[];
}

/**
 * Parameters for replying to a message
 */
export interface ReplyToMessageParams {
	/** Parent message UUID */
	parentMessageId: string;
	/** Reply text content */
	messageText: string;
	/** Optional file attachment IDs from FileService */
	fileIds?: string[];
}

/**
 * Parameters for editing a message
 */
export interface EditMessageParams {
	/** Message UUID */
	messageId: string;
	/** New message text */
	newMessageText: string;
}

/**
 * Parameters for listing messages
 */
export interface ListMessagesParams {
	/** Channel UUID */
	channelId: string;
	/** Number of messages per page (default: 50, max: 100) */
	pageSize?: number;
	/** Pagination cursor token - UUID of oldest message from previous page (empty for first page) */
	pageToken?: string;
	/** Pagination direction. `OLDER` loads history, `NEWER` walks forward from the cursor. */
	direction?: 'OLDER' | 'NEWER';
	/** Optional anchor message ID to seed the initial page around a specific message. */
	anchorMessageId?: string;
}

/**
 * Parameters for listing replies
 */
export interface ListRepliesParams {
	/** Parent message UUID */
	parentMessageId: string;
	/** Number of replies per page (default: 50, max: 100) */
	pageSize?: number;
	/** Pagination cursor token */
	pageToken?: string;
}

/**
 * Parameters for marking channel as read
 */
export interface MarkChannelAsReadParams {
	/** Channel UUID */
	channelId: string;
	/** Last read message ID (optional) */
	lastReadMessageId?: string;
}

/**
 * Parameters for adding a reaction
 */
export interface AddReactionParams {
	/** Message UUID */
	messageId: string;
	/** Emoji code (e.g., "thumbs_up", "heart") */
	emojiCode: string;
}

/**
 * Parameters for removing a reaction
 */
export interface RemoveReactionParams {
	/** Message UUID */
	messageId: string;
	/** Emoji code */
	emojiCode: string;
}

// ============================================================================
// Channel Management
// ============================================================================

/**
 * Create a new channel
 * @param params - Channel creation parameters
 * @returns Created channel details
 * @throws ValidationError if slug format is invalid or duplicate
 */
export async function createChannel(
	params: CreateChannelParams
): Promise<CreateChannelResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.createChannel({
			titleSlug: params.slug,
			displayName: params.name,
			description: params.description || '',
			channelType: chat.ChannelType.CHAT,
			isPrivate: params.isPrivate || false,
		});
		return resp as CreateChannelResponse;
	});
}

/**
 * Get channel details by ID
 * @param channelId - Channel UUID
 * @returns Channel details
 * @throws APIError if channel not found or user lacks access
 */
export async function getChannel(channelId: string): Promise<GetChannelResponse> {
	return await rpcCall(async () => {
		return await chatClient.getChannel({ channelId }) as GetChannelResponse;
	});
}

/**
 * List channels visible to the current user
 * @param params - Filter and pagination parameters
 * @returns List of channels with pagination token
 */
export async function listChannels(
	params: ListChannelsParams = {}
): Promise<ListChannelsResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.listChannels({
			channelType: params.channelType ? chat.ChannelType.CHAT : chat.ChannelType.UNSPECIFIED,
			includeArchived: params.channelType === 'ARCHIVED',
			pageSize: params.pageSize || 50,
			pageToken: params.pageToken || '',
		});
		return resp as ListChannelsResponse;
	});
}

/**
 * Update channel metadata (admin only)
 * @param params - Channel update parameters
 * @returns Updated channel details
 * @throws APIError if user is not admin
 */
export async function updateChannel(
	params: UpdateChannelParams
): Promise<UpdateChannelResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.updateChannel({
			channelId: params.channelId,
			displayName: params.name,
			description: params.description,
			isPrivate: params.isPrivate,
		});
		return resp as UpdateChannelResponse;
	});
}

/**
 * Archive a channel (admin only)
 * @param channelId - Channel UUID
 * @returns Archived channel details
 * @throws APIError if user is not admin
 */
export async function archiveChannel(channelId: string): Promise<ArchiveChannelResponse> {
	return await rpcCall(async () => {
		return await chatClient.archiveChannel({ channelId }) as ArchiveChannelResponse;
	});
}

/**
 * Unarchive a channel (admin only)
 * @param channelId - Channel UUID
 * @returns Unarchived channel details
 * @throws APIError if user is not admin
 */
export async function unarchiveChannel(channelId: string): Promise<UnarchiveChannelResponse> {
	return await rpcCall(async () => {
		return await chatClient.unarchiveChannel({ channelId }) as UnarchiveChannelResponse;
	});
}

/**
 * Get channel context summary including members and pinned messages
 * @param channelId - Channel UUID
 * @returns Channel context summary
 */
export async function getChannelContextSummary(channelId: string): Promise<GetChannelContextSummaryResponse> {
	return await rpcCall(async () => {
		return await chatClient.getChannelContextSummary({ channelId }) as GetChannelContextSummaryResponse;
	});
}

// ============================================================================
// Channel Membership
// ============================================================================

/**
 * Join a public channel
 * @param channelId - Channel UUID
 * @returns Membership details
 * @throws APIError if channel is private or archived
 */
export async function joinChannel(channelId: string): Promise<JoinChannelResponse> {
	return await rpcCall(async () => {
		return await chatClient.joinChannel({ channelId }) as JoinChannelResponse;
	});
}

/**
 * Leave a channel
 * @param channelId - Channel UUID
 * @returns Empty response on success
 * @throws APIError if user is last admin (must promote another first)
 */
export async function leaveChannel(channelId: string): Promise<LeaveChannelResponse> {
	return await rpcCall(async () => {
		return await chatClient.leaveChannel({ channelId }) as LeaveChannelResponse;
	});
}

/**
 * Invite a member to a channel (admin only)
 * @param params - Invite parameters
 * @returns Membership details
 * @throws APIError if user is not admin or invitee is already a member
 */
export async function inviteMember(
	params: InviteMemberParams
): Promise<InviteMemberResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.inviteMember({
			channelId: params.channelId,
			employeeId: params.employeeId,
		});
		return resp as InviteMemberResponse;
	});
}

/**
 * Remove a member from a channel (admin only)
 * @param params - Remove parameters
 * @returns Empty response on success
 * @throws APIError if user is not admin or trying to remove last admin
 */
export async function removeMember(
	params: RemoveMemberParams
): Promise<RemoveMemberResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.removeMember({
			channelId: params.channelId,
			employeeId: params.employeeId,
		});
		return resp as RemoveMemberResponse;
	});
}

/**
 * List all members of a channel
 * @param params - Channel ID and pagination parameters
 * @returns List of members with employee details
 */
export async function listChannelMembers(
	params: ListChannelMembersParams
): Promise<ListChannelMembersResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.listChannelMembers({
			channelId: params.channelId,
			pageSize: params.pageSize || 50,
			pageToken: params.pageToken || '',
		});
		return resp as ListChannelMembersResponse;
	});
}

/**
 * Update a member's role (admin only)
 * @param params - Role update parameters
 * @returns Updated membership details
 * @throws APIError if user is not admin or trying to demote last admin
 */
export async function updateMemberRole(
	params: UpdateMemberRoleParams
): Promise<UpdateMemberRoleResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.updateMemberRole({
			channelId: params.channelId,
			employeeId: params.employeeId,
			isAdmin: params.role === 'ADMIN',
		});
		return resp as UpdateMemberRoleResponse;
	});
}

/**
 * Update notification preference for a channel
 * @param params - Notification preference parameters
 * @returns Updated membership details
 */
export async function updateNotificationPreference(
	params: UpdateNotificationPreferenceParams
): Promise<UpdateNotificationPreferenceResponse> {
	return await rpcCall(async () => {
		let preference: chat.NotificationPreference;
		switch (params.notificationPreference) {
			case 'ALL':
				preference = chat.NotificationPreference.ALL;
				break;
			case 'MENTIONS':
				preference = chat.NotificationPreference.MENTIONS;
				break;
			case 'NONE':
				preference = chat.NotificationPreference.MUTED;
				break;
			default:
				preference = chat.NotificationPreference.ALL;
		}

		const resp = await chatClient.updateNotificationPreference({
			channelId: params.channelId,
			preference: preference,
		});
		return resp as UpdateNotificationPreferenceResponse;
	});
}

// ============================================================================
// Messaging
// ============================================================================

/**
 * Send a message to a channel
 * @param params - Message parameters
 * @returns Created message details
 * @throws ValidationError if message text is too long (~10k chars)
 * @throws APIError if channel is archived or user lacks access
 */
export async function sendMessage(
	params: SendMessageParams
): Promise<SendMessageResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.sendMessage({
			channelId: params.channelId,
			messageText: params.messageText,
			fileIds: params.fileIds || [],
		});
		return resp as SendMessageResponse;
	});
}

/**
 * Reply to a message (1-level threading only)
 * @param params - Reply parameters
 * @returns Created reply details
 * @throws ValidationError if parent is already a reply (no nested replies)
 */
export async function replyToMessage(
	params: ReplyToMessageParams
): Promise<ReplyToMessageResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.replyToMessage({
			parentMessageId: params.parentMessageId,
			messageText: params.messageText,
			fileIds: params.fileIds || [],
		});
		return resp as ReplyToMessageResponse;
	});
}

/**
 * Edit a message (author or admin only)
 * @param params - Edit parameters
 * @returns Updated message details with edit_history
 * @throws APIError if user is not author or admin
 */
export async function editMessage(
	params: EditMessageParams
): Promise<EditMessageResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.editMessage({
			messageId: params.messageId,
			newText: params.newMessageText,
		});
		return resp as EditMessageResponse;
	});
}

/**
 * Soft delete a message (author or admin only)
 * @param messageId - Message UUID
 * @returns Empty response on success
 * @throws APIError if user is not author or admin
 */
export async function deleteMessage(messageId: string): Promise<DeleteMessageResponse> {
	return await rpcCall(async () => {
		return await chatClient.deleteMessage({ messageId }) as DeleteMessageResponse;
	});
}

/**
 * List messages in a channel with pagination
 * Uses UUID v7 cursor-based pagination (time-sortable, stable ordering)
 * @param params - Message list parameters
 * @returns List of messages (excludes soft-deleted)
 */
export async function listMessages(
	params: ListMessagesParams
): Promise<ListMessagesResponse> {
	return await rpcCall(async () => {
		const directionValue = params.direction === 'NEWER'
			? LIST_MESSAGES_DIRECTION.NEWER
			: params.direction === 'OLDER'
				? LIST_MESSAGES_DIRECTION.OLDER
				: LIST_MESSAGES_DIRECTION.UNSPECIFIED;

		const resp = await chatClient.listMessages({
			channelId: params.channelId,
			pageSize: params.pageSize || 50,
			pageToken: params.pageToken || '', // UUID v7 of oldest/newest message depending on direction
			direction: directionValue,
			anchorMessageId: params.anchorMessageId || '',
		});
		return resp as ListMessagesResponse;
	});
}

/**
 * Get a single message by ID
 * @param messageId - Message UUID
 * @returns Message details
 * @throws APIError if message not found or user lacks access
 */
export async function getMessage(messageId: string): Promise<GetMessageResponse> {
	return await rpcCall(async () => {
		return await chatClient.getMessage({ messageId }) as GetMessageResponse;
	});
}

/**
 * List all replies to a message
 * @param params - Parent message ID and pagination parameters
 * @returns List of replies ordered by timestamp
 */
export async function listReplies(
	params: ListRepliesParams
): Promise<ListRepliesResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.listReplies({
			parentMessageId: params.parentMessageId,
			pageSize: params.pageSize || 50,
			pageToken: params.pageToken || '',
		});
		return resp as ListRepliesResponse;
	});
}

// ============================================================================
// Message Navigation & Unread Tracking
// ============================================================================

/**
 * Get message by ID with channel context (for notification deep linking)
 * @param messageId - Message UUID
 * @returns Message details with channel context and membership status
 * @throws APIError if message not found or user is not a channel member
 */
export async function getMessageById(messageId: string): Promise<GetMessageByIdResponse> {
	return await rpcCall(async () => {
		return await chatClient.getMessageById({ messageId }) as GetMessageByIdResponse;
	});
}

/**
 * Mark channel as read up to a specific message
 * @param params - Channel ID and optional last read message ID
 * @returns Updated unread count and last viewed timestamp
 */
export async function markChannelAsRead(
	params: MarkChannelAsReadParams
): Promise<MarkChannelAsReadResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.markChannelAsRead({
			channelId: params.channelId,
			lastReadMessageId: params.lastReadMessageId || '',
		});
		return resp as MarkChannelAsReadResponse;
	});
}

// ============================================================================
// Reactions
// ============================================================================

/**
 * Add an emoji reaction to a message
 * @param params - Reaction parameters
 * @returns Created reaction details (idempotent)
 * @throws ValidationError if emoji code format is invalid
 */
export async function addReaction(
	params: AddReactionParams
): Promise<AddReactionResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.addReaction({
			messageId: params.messageId,
			emojiCode: params.emojiCode,
		});
		return resp as AddReactionResponse;
	});
}

/**
 * Remove an emoji reaction from a message
 * @param params - Reaction parameters
 * @returns Empty response on success
 */
export async function removeReaction(
	params: RemoveReactionParams
): Promise<RemoveReactionResponse> {
	return await rpcCall(async () => {
		const resp = await chatClient.removeReaction({
			messageId: params.messageId,
			emojiCode: params.emojiCode,
		});
		return resp as RemoveReactionResponse;
	});
}

/**
 * List all reactions for a message grouped by emoji
 * @param messageId - Message UUID
 * @returns Reactions grouped by emoji with employee IDs
 */
export async function listReactions(messageId: string): Promise<ListReactionsResponse> {
	return await rpcCall(async () => {
		return await chatClient.listReactions({ messageId }) as ListReactionsResponse;
	});
}

// ============================================================================
// Typing Indicators (ephemeral)
// ============================================================================

/**
 * Signal that user started typing in a channel or thread
 * @param channelId - Channel UUID
 * @param parentMessageId - Optional parent message ID for thread typing
 * @returns Empty response on success
 */
export async function startTyping(channelId: string, parentMessageId?: string): Promise<StartTypingResponse> {
	return await rpcCall(async () => {
		return await chatClient.startTyping({
			channelId,
			parentMessageId: parentMessageId || ''
		}) as StartTypingResponse;
	});
}

/**
 * Signal that user stopped typing in a channel or thread
 * @param channelId - Channel UUID
 * @param parentMessageId - Optional parent message ID for thread typing
 * @returns Empty response on success
 */
export async function stopTyping(channelId: string, parentMessageId?: string): Promise<StopTypingResponse> {
	return await rpcCall(async () => {
		return await chatClient.stopTyping({
			channelId,
			parentMessageId: parentMessageId || ''
		}) as StopTypingResponse;
	});
}

// ============================================================================
// Search API Functions
// ============================================================================

import type {
	ChannelSearchResult,
	ChannelSuggestion,
	MessageSearchResult,
	ChannelType as SearchChannelType,
} from "./types/search";
import { protoTimestampToDate } from "./proto-utils";

/**
 * Convert proto ChannelType enum to search type string
 */
function convertChannelType(protoType: chat.ChannelType): SearchChannelType {
	switch (protoType) {
		case chat.ChannelType.CHAT:
			return 'chat';
		case chat.ChannelType.DIRECT_MESSAGE:
			return 'direct_message';
		case chat.ChannelType.PROJECT_TICKET_THREAD:
			return 'project_ticket_thread';
		case chat.ChannelType.CRM_DEAL_NOTES:
			return 'crm_deal_notes';
		case chat.ChannelType.SUPPORT_TICKET:
			return 'support_ticket';
		default:
			return 'chat'; // Default to chat type for unspecified
	}
}

/**
 * Search channels by name or description using fuzzy matching
 * Returns only channels the user can access (public or member of private)
 * 
 * @param queryText - Search query (channel name or description)
 * @param limit - Maximum number of results (default 50, max 100)
 * @param cursor - Pagination cursor (UUID of last result)
 * @returns Array of channel search results with relevance scores
 * @throws ValidationError if queryText is empty
 * 
 * @example
 * ```ts
 * const results = await searchChannels('project updates');
 * console.log(results[0].isPrivate); // false
 * ```
 */
export async function searchChannels(
	queryText: string,
	limit: number = 50,
	cursor?: string
): Promise<ChannelSearchResult[]> {
	return await rpcCall(async () => {
		const resp = await chatClient.searchChannels({
			queryText,
			limit,
			cursor: cursor || '',
		}) as chat.SearchChannelsResponse;

		return (resp.results || []).map(r => ({
			id: r.id,
			displayName: r.displayName,
			description: r.description,
			channelType: convertChannelType(r.channelType),
			titleSlug: r.titleSlug,
			isPrivate: r.isPrivate,
			relevanceScore: r.relevanceScore,
			updatedAt: protoTimestampToDate(r.updatedAt) || new Date(),
		}));
	});
}

/**
 * Autocomplete channel names for quick selection (prefix-based)
 * Returns only channels the user can access
 * 
 * @param prefix - Channel name prefix to match
 * @param limit - Maximum number of suggestions (default 10, max 20)
 * @returns Array of channel suggestions
 * 
 * @example
 * ```ts
 * const suggestions = await autocompleteChannels('proj');
 * // Returns: project-alpha, project-beta, etc.
 * ```
 */
export async function autocompleteChannels(
	prefix: string,
	limit: number = 10
): Promise<ChannelSuggestion[]> {
	return await rpcCall(async () => {
		const resp = await chatClient.autocompleteChannels({
			prefix,
			limit,
		}) as chat.AutocompleteChannelsResponse;

		return (resp.suggestions || []).map(s => ({
			id: s.id,
			displayName: s.displayName,
			channelType: convertChannelType(s.channelType),
			isPrivate: s.isPrivate,
		}));
	});
}

/**
 * Search messages by content using fuzzy matching
 * Returns messages only from channels the user can access
 * 
 * @param queryText - Search query (message content)
 * @param limit - Maximum number of results (default 50, max 100)
 * @param cursor - Pagination cursor (UUID of last result)
 * @returns Array of message search results with contextual metadata
 * @throws ValidationError if queryText is empty
 * 
 * @example
 * ```ts
 * const results = await searchMessages('meeting notes');
 * console.log(results[0].channelName); // 'project-alpha'
 * ```
 */
export async function searchMessages(
	queryText: string,
	limit: number = 50,
	cursor?: string
): Promise<MessageSearchResult[]> {
	return await rpcCall(async () => {
		const resp = await chatClient.searchMessages({
			queryText,
			limit,
			cursor: cursor || '',
		}) as chat.SearchMessagesResponse;

		return (resp.results || []).map(r => ({
			id: r.id,
			messageText: r.messageText,
			authorEmployeeId: r.authorEmployeeId,
			channelId: r.channelId,
			parentMessageId: r.parentMessageId || undefined,
			isEdited: r.isEdited,
			relevanceScore: r.relevanceScore,
			updatedAt: protoTimestampToDate(r.updatedAt) || new Date(),
			channelName: r.channelName,
			channelIsPrivate: r.channelIsPrivate,
		}));
	});
}

// ============================================================================
// Direct Message (DM) API Functions
// ============================================================================

/**
 * Create a new direct message channel or get existing one
 * Returns the DM channel between current user and specified employee
 * 
 * @param otherEmployeeId - ID of employee to start DM with
 * @returns DM channel details and participant info
 * @throws ValidationError if trying to DM yourself
 * 
 * @example
 * ```ts
 * const result = await createOrGetDirectMessage('employee-uuid');
 * if (result.wasCreated) {
 *   console.log('New DM created:', result.channel.id);
 * } else {
 *   console.log('Existing DM found:', result.channel.id);
 * }
 * ```
 */
export async function createOrGetDirectMessage(
	otherEmployeeId: string
): Promise<{
	channel: Channel;
	wasCreated: boolean;
	participants: DirectMessageParticipant[];
}> {
	return await rpcCall(async () => {
		const resp = await chatClient.createOrGetDirectMessage({
			otherEmployeeId,
		}) as chat.CreateOrGetDirectMessageResponse;

		return {
			channel: {
				id: resp.channel!.id,
				titleSlug: resp.channel!.titleSlug,
				displayName: resp.channel!.displayName,
				description: resp.channel!.description,
				channelType: convertChannelType(resp.channel!.channelType),
				isPrivate: resp.channel!.isPrivate,
				isArchived: resp.channel!.isArchived,
				createdByEmployeeId: resp.channel!.createdByEmployeeId,
				updatedAt: protoTimestampToDate(resp.channel!.updatedAt) || new Date(),
			},
			wasCreated: resp.wasCreated,
			participants: (resp.participants || []).map(p => ({
				id: p.id,
				givenName: p.givenName,
				familyName: p.familyName,
				email: p.email,
			})),
		};
	});
}

/**
 * Direct message participant details
 */
export interface DirectMessageParticipant {
	id: string;
	givenName: string;
	familyName: string;
	email: string;
}

/**
 * Channel with additional details (member count, DM participants)
 */
export interface ChannelWithDetails {
	channel: Channel;
	memberCount: number;
	dmParticipants?: DirectMessageParticipant[];
	linkedResource?: LinkedResource;
}

/**
 * Linked resource metadata for channels that are discussion surfaces for other domain objects.
 * Populated for task channels, CRM deal channels, support ticket channels, etc.
 */
export interface LinkedResource {
	resourceType: string;        // "task", "crm_deal", "support_ticket"
	resourceId: string;          // Primary resource ID (e.g., task UUID)
	parentId: string;            // Parent resource ID (e.g., project UUID for tasks)
	displayIdentifier: string;   // Human-readable identifier (e.g., "PROJ-123")
	displayTitle: string;        // Resource title
}

// ============================================================================
// User Chat Config API Functions
// ============================================================================

/**
 * User chat configuration (channel visibility via categories, pinned channels, display preferences)
 */
export interface UserChatConfig {
	channelCategories: Record<string, string>; // {channel_id: "channels" | "direct_messages" | "archived"}
	categoryLimits: Record<string, number>; // {"channels": 30, "direct_messages": 20, "archived": 10}
	pinnedChannelIds: string[];
	sidebarCategoryCollapsed: SidebarCategoryCollapsedState;
}

/**
 * Sidebar category collapsed state
 */
export interface SidebarCategoryCollapsedState {
	channels: boolean;
	directMessages: boolean;
	taskDiscussions?: boolean;
	archived?: boolean;
}

/**
 * Get user's chat configuration (visible channels via categories, pinned channels, limits, sidebar state)
 * Returns default config if user hasn't configured yet
 * 
 * @returns User chat preferences
 * 
 * @example
 * ```ts
 * const config = await getUserChatConfig();
 * console.log('Channel categories:', config.channelCategories);
 * console.log('Category limits:', config.categoryLimits);
 * ```
 */
export async function getUserChatConfig(): Promise<UserChatConfig> {
	return await rpcCall(async () => {
		const resp = await chatClient.getUserChatConfig({}) as chat.GetUserChatConfigResponse;

		// Parse channel categories from JSON string
		let channelCategories: Record<string, string> = {};
		if (resp.config?.channelCategories) {
			try {
				channelCategories = JSON.parse(resp.config.channelCategories);
			} catch (e) {
				console.warn('Failed to parse channel categories:', e);
			}
		}

		// Parse category limits from JSON string
		let categoryLimits: Record<string, number> = {
			channels: 30,
			direct_messages: 20,
			archived: 10,
		};
		if (resp.config?.categoryLimits) {
			try {
				categoryLimits = JSON.parse(resp.config.categoryLimits);
			} catch (e) {
				console.warn('Failed to parse category limits:', e);
			}
		}

		// Parse collapsed state from JSON string
		let collapsedState: SidebarCategoryCollapsedState = {
			channels: false,
			directMessages: false,
		};
		if (resp.config?.sidebarCategoryCollapsed) {
			try {
				collapsedState = JSON.parse(resp.config.sidebarCategoryCollapsed);
			} catch (e) {
				console.warn('Failed to parse sidebar collapsed state:', e);
			}
		}

		return {
			channelCategories,
			categoryLimits,
			pinnedChannelIds: resp.config?.pinnedChannelIds || [],
			sidebarCategoryCollapsed: collapsedState,
		};
	});
}

/**
 * Add a channel to a specific category in user's chat config
 * Makes the channel visible in the sidebar under the specified category
 * 
 * @param channelId - UUID of the channel to add
 * @param category - Category to add channel to ('channels', 'direct_messages', or 'archived')
 * @throws ValidationError if category is invalid
 * 
 * @example
 * ```ts
 * await addChannelToCategory('123e4567-e89b-12d3-a456-426614174000', 'channels');
 * ```
 */
export async function addChannelToCategory(channelId: string, category: string): Promise<void> {
	const validCategories = ['channels', 'direct_messages', 'archived'];
	if (!validCategories.includes(category)) {
		throw new ValidationError(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
	}

	return await rpcCall(async () => {
		await chatClient.addChannelToCategory({
			channelId,
			category,
		});
	});
}

/**
 * Update user's channel categories (bulk operation)
 * Replaces entire channel-to-category mapping
 * 
 * @param categories - Map of channel IDs to category names
 * 
 * @example
 * ```ts
 * await updateChannelCategories({
 *   'channel-1': 'channels',
 *   'channel-2': 'direct_messages',
 *   'channel-3': 'archived',
 * });
 * ```
 */
export async function updateChannelCategories(categories: Record<string, string>): Promise<void> {
	return await rpcCall(async () => {
		await chatClient.updateChannelCategories({
			channelCategories: JSON.stringify(categories),
		});
	});
}

/**
 * Update category limits (max number of channels per category)
 * Controls how many channels are visible in each sidebar section
 * 
 * @param limits - Map of category names to max channel counts (0-100)
 * @throws ValidationError if any limit is out of range
 * 
 * @example
 * ```ts
 * await updateCategoryLimits({
 *   channels: 30,
 *   direct_messages: 20,
 *   archived: 10,
 * });
 * ```
 */
export async function updateCategoryLimits(limits: Record<string, number>): Promise<void> {
	// Validate limits range
	for (const [category, limit] of Object.entries(limits)) {
		if (limit < 0 || limit > 100) {
			throw new ValidationError(`Limit for ${category} must be between 0 and 100`);
		}
	}

	return await rpcCall(async () => {
		await chatClient.updateCategoryLimits({
			categoryLimits: JSON.stringify(limits),
		});
	});
}

/**
 * @deprecated Use addChannelToCategory() instead
 * Update user's recent channels list
 * Maintains ordered list of recently accessed channels (max 50)
 * 
 * @param channelIds - Ordered array of channel IDs (most recent first)
 * @throws ValidationError if more than 50 channels provided
 * 
 * @example
 * ```ts
 * await updateRecentChannels(['channel-1', 'channel-2', 'channel-3']);
 * ```
 */
export async function updateRecentChannels(channelIds: string[]): Promise<void> {
	console.warn('[updateRecentChannels] This function is deprecated. Use addChannelToCategory() instead.');
	if (channelIds.length > 50) {
		throw new ValidationError('Maximum 50 recent channels allowed');
	}

	return await rpcCall(async () => {
		await chatClient.updateRecentChannels({
			channelIds,
		});
	});
}

/**
 * Update user's pinned channels list
 * Pinned channels appear at top of sidebar
 * 
 * @param channelIds - Ordered array of pinned channel IDs
 * 
 * @example
 * ```ts
 * await updatePinnedChannels(['channel-1', 'channel-2']);
 * ```
 */
export async function updatePinnedChannels(channelIds: string[]): Promise<void> {
	return await rpcCall(async () => {
		await chatClient.updatePinnedChannels({
			channelIds,
		});
	});
}

/**
 * Update sidebar category collapsed state
 * Controls which sidebar sections are expanded/collapsed
 * 
 * @param collapsedState - Collapsed state for each category
 * 
 * @example
 * ```ts
 * await updateSidebarCategoryCollapsed({
 *   channels: false,
 *   directMessages: true
 * });
 * ```
 */
export async function updateSidebarCategoryCollapsed(
	collapsedState: SidebarCategoryCollapsedState
): Promise<void> {
	return await rpcCall(async () => {
		await chatClient.updateSidebarCategoryCollapsed({
			collapsedState: JSON.stringify(collapsedState),
		});
	});
}

/**
 * List user's recent channels with full details
 * Returns channels in order specified by user's recent_channel_ids
 * Includes DM participant info for direct message channels
 * 
 * @returns Array of channels with member counts and DM participants
 * 
 * @example
 * ```ts
 * const channels = await listRecentChannels();
 * channels.forEach(c => {
 *   if (c.channel.channelType === 'direct_message') {
 *     console.log('DM with:', c.dmParticipants?.[0]?.givenName);
 *   }
 * });
 * ```
 */
export async function listRecentChannels(): Promise<ChannelWithDetails[]> {
	return await rpcCall(async () => {
		const resp = await chatClient.listRecentChannels({}) as chat.ListRecentChannelsResponse;

		return (resp.channels || []).map(ch => ({
			channel: {
				id: ch.channel!.id,
				titleSlug: ch.channel!.titleSlug,
				displayName: ch.channel!.displayName,
				description: ch.channel!.description,
				channelType: convertChannelType(ch.channel!.channelType),
				isPrivate: ch.channel!.isPrivate,
				isArchived: ch.channel!.isArchived,
				createdByEmployeeId: ch.channel!.createdByEmployeeId,
				updatedAt: protoTimestampToDate(ch.channel!.updatedAt) || new Date(),
			},
			memberCount: ch.memberCount,
			dmParticipants: (ch.dmParticipants || []).map(p => ({
				id: p.id,
				givenName: p.givenName,
				familyName: p.familyName,
				email: p.email,
			})),
			linkedResource: ch.linkedResource ? {
				resourceType: ch.linkedResource.resourceType,
				resourceId: ch.linkedResource.resourceId,
				parentId: ch.linkedResource.parentId,
				displayIdentifier: ch.linkedResource.displayIdentifier,
				displayTitle: ch.linkedResource.displayTitle,
			} : undefined,
		}));
	});
}
