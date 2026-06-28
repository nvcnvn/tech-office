/**
 * Presence API functions
 * ConnectRPC-based API calls for employee presence tracking
 */

import { notificationClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { notification } from "rpc";
import { protoTimestampToDate, dateToProtoTimestamp } from "./proto-utils";

// Type aliases for RPC response types
type UpdatePresenceStatusResponse = notification.UpdatePresenceStatusResponse;
type GetEmployeePresenceResponse = notification.GetEmployeePresenceResponse;
type GetBatchEmployeePresenceResponse = notification.GetBatchEmployeePresenceResponse;

/**
 * Presence status constants.
 * 
 * MUST align with:
 * - Proto enum: PresenceStatus (PRESENCE_STATUS_ONLINE, etc.)
 * - Backend Go constants: internal/notification/constants.go
 * - Database CHECK constraint: notification.active_connection.status
 * 
 * When adding/removing values:
 * 1. Update protobuf enum in backend/rpc/v1/notification.proto
 * 2. Update database CHECK constraint in backend/database/scripts/schema.sql
 * 3. Update backend Go constants
 * 4. Update this TypeScript type
 * 5. Submit all changes in single PR with alignment verification
 */
export type PresenceStatus = 'online' | 'online_hidden' | 'idle' | 'offline' | 'unspecified';

/**
 * Map protobuf enum to custom type
 */
function mapProtoPresenceStatus(protoStatus: notification.PresenceStatus): PresenceStatus {
	switch (protoStatus) {
		case notification.PresenceStatus.ONLINE:
			return 'online';
		case notification.PresenceStatus.ONLINE_HIDDEN:
			return 'online_hidden';
		case notification.PresenceStatus.IDLE:
			return 'idle';
		case notification.PresenceStatus.OFFLINE:
			return 'offline';
		case notification.PresenceStatus.UNSPECIFIED:
		default:
			return 'unspecified';
	}
}

/**
 * Map custom type to protobuf enum
 */
function mapToProtoPresenceStatus(status: PresenceStatus): notification.PresenceStatus {
	switch (status) {
		case 'online':
			return notification.PresenceStatus.ONLINE;
		case 'online_hidden':
			return notification.PresenceStatus.ONLINE_HIDDEN;
		case 'idle':
			return notification.PresenceStatus.IDLE;
		case 'offline':
			return notification.PresenceStatus.OFFLINE;
		case 'unspecified':
		default:
			return notification.PresenceStatus.UNSPECIFIED;
	}
}

/**
 * Parameters for updating presence status
 */
export interface UpdatePresenceParams {
	/** Current presence status */
	status: PresenceStatus;
	/** Active channel ID (null if not viewing a channel) */
	activeChannelId: string | null;
	/** Last user interaction timestamp */
	lastInteractionAt: Date;
	/** Active SSE connection identifier */
	connectionId?: string | null;
}

export interface UpdatePresenceResult {
	status: PresenceStatus;
	updatedAt: Date;
	connectionId: string | null;
	activeChannelId?: string;
}

/**
 * Employee presence information with JavaScript native types
 */
export interface EmployeePresence {
	/** Employee ID */
	employeeId: string;
	/** Current presence status */
	status: PresenceStatus;
	/** Active channel ID if viewing a channel */
	activeChannelId?: string;
	/** Last interaction timestamp */
	lastInteractionAt: Date;
	/** Last heartbeat timestamp */
	lastHeartbeat: Date;
	/** Visibility settings (if available) */
	visibility?: {
		mode: string;
		customStatus?: string;
		customEmoji?: string;
	};
}

/**
 * Update the current user's presence status
 * 
 * @param params - Presence update parameters
 * @returns Updated presence status and timestamp
 */
export async function updatePresenceStatus(
	params: UpdatePresenceParams
): Promise<UpdatePresenceResult> {
	return await rpcCall(async () => {
		const resp = await notificationClient.updatePresenceStatus({
			status: mapToProtoPresenceStatus(params.status),
			activeChannelId: params.activeChannelId || undefined,
			lastInteractionAt: dateToProtoTimestamp(params.lastInteractionAt),
			connectionId: params.connectionId || undefined,
		});

		const typed = resp as UpdatePresenceStatusResponse;
		return {
			status: mapProtoPresenceStatus(typed.status),
			updatedAt: protoTimestampToDate(typed.updatedAt) || new Date(),
			connectionId: typed.connectionId || null,
			activeChannelId: typed.activeChannelId || undefined,
		};
	});
}

/**
 * Get presence information for a specific employee
 * 
 * @param employeeId - Employee ID to query
 * @returns Employee presence information (respects visibility settings)
 */
export async function getEmployeePresence(
	employeeId: string
): Promise<EmployeePresence | null> {
	return await rpcCall(async () => {
		const resp = await notificationClient.getEmployeePresence({
			employeeId,
		});

		const typed = resp as GetEmployeePresenceResponse;

		// Presence may be null if employee is hidden or doesn't exist
		if (!typed.presence) {
			return null;
		}

		const visibility = typed.presence.visibility ? {
			mode: String(typed.presence.visibility.visibilityMode),
			customStatus: typed.presence.visibility.customStatusText || undefined,
			customEmoji: typed.presence.visibility.customStatusEmoji || undefined,
		} : undefined;

		return {
			employeeId: typed.presence.employeeId,
			status: mapProtoPresenceStatus(typed.presence.status),
			activeChannelId: typed.presence.activeChannelId || undefined,
			lastInteractionAt: protoTimestampToDate(typed.presence.lastInteractionAt) || new Date(),
			lastHeartbeat: protoTimestampToDate(typed.presence.lastHeartbeat) || new Date(),
			visibility,
		};
	});
}

/**
 * Get presence information for multiple employees (batch query)
 * 
 * @param employeeIds - Array of employee IDs to query
 * @returns Map of employee ID to presence information (respects visibility settings)
 */
export async function getBatchEmployeePresence(
	employeeIds: string[]
): Promise<Map<string, EmployeePresence>> {
	return await rpcCall(async () => {
		const resp = await notificationClient.getBatchEmployeePresence({
			employeeIds,
		});

		const typed = resp as GetBatchEmployeePresenceResponse;

		const presenceMap = new Map<string, EmployeePresence>();

		for (const presence of typed.presences) {
			const visibility = presence.visibility ? {
				mode: String(presence.visibility.visibilityMode),
				customStatus: presence.visibility.customStatusText || undefined,
				customEmoji: presence.visibility.customStatusEmoji || undefined,
			} : undefined;

			presenceMap.set(presence.employeeId, {
				employeeId: presence.employeeId,
				status: mapProtoPresenceStatus(presence.status),
				activeChannelId: presence.activeChannelId || undefined,
				lastInteractionAt: protoTimestampToDate(presence.lastInteractionAt) || new Date(),
				lastHeartbeat: protoTimestampToDate(presence.lastHeartbeat) || new Date(),
				visibility,
			});
		}

		return presenceMap;
	});
}
