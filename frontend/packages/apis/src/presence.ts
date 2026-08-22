/**
 * Presence API functions
 * ConnectRPC-based API calls for employee presence tracking
 */

import { notificationClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { notification } from "rpc";
import { protoTimestampToDate, dateToProtoTimestamp } from "./proto-utils";

// Type aliases for RPC response types
type PresencePongResponse = notification.PresencePongResponse;
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
export type PresenceStatus = 'online' | 'online_hidden' | 'idle' | 'offline' | 'in_meeting' | 'unspecified';

/**
 * Presence ping-pong timing.
 *
 * MUST align with backend/internal/notification/constants.go, which is the source of
 * truth (Constitution VIII). Changing a value here without changing it there breaks
 * the protocol silently.
 */
/** How often the server challenges each open stream with a `ping` event. */
export const PING_INTERVAL_SECONDS = 20;
/** Maximum silence a connection may have and still count as present. */
export const RESPONSIVE_WINDOW_SECONDS = 45;

/**
 * Directive returned by a pong.
 * - `ack`: recorded, carry on.
 * - `reconnect`: this connection no longer exists server-side. Close the stream and
 *   re-establish; do not retry the pong against the dead connection id.
 */
export type PongDirective = 'ack' | 'reconnect' | 'unspecified';

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
		case notification.PresenceStatus.IN_MEETING:
			return 'in_meeting';
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
		case 'in_meeting':
			return notification.PresenceStatus.IN_MEETING;
		case 'unspecified':
		default:
			return notification.PresenceStatus.UNSPECIFIED;
	}
}

/**
 * Parameters for answering a presence ping.
 */
export interface PresencePongParams {
	/** Connection being answered for, from the connection_established event. Required. */
	connectionId: string;
	/**
	 * Echo of the answered ping's eventId. Omit for an unsolicited pong (state change
	 * or departure) — liveness comes from the server-observed arrival time, never this.
	 */
	pingId?: string;
	/** The employee's current state on THIS connection. */
	status: PresenceStatus;
	/** Channel currently being viewed on this connection; null when none. */
	activeChannelId: string | null;
	/** Last user interaction. Advisory: clamped server-side to [now - 1h, now]. */
	lastInteractionAt: Date;
	/** Clean departure: remove the connection now rather than waiting out the window. */
	departing?: boolean;
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
 * Answer a presence ping, or report a state change unsolicited.
 *
 * This is the ONLY way presence is reported: the server never advances a connection's
 * liveness on its own. A connection silent for RESPONSIVE_WINDOW_SECONDS stops counting
 * as present and its notifications take the push path instead.
 *
 * @param params - Pong parameters
 * @returns The server's directive — 'ack' to carry on, 'reconnect' to re-establish
 */
export async function presencePong(
	params: PresencePongParams
): Promise<PongDirective> {
	return await rpcCall(async () => {
		const resp = await notificationClient.presencePong({
			connectionId: params.connectionId,
			pingId: params.pingId || undefined,
			status: mapToProtoPresenceStatus(params.status),
			activeChannelId: params.activeChannelId || undefined,
			lastInteractionAt: dateToProtoTimestamp(params.lastInteractionAt),
			departing: params.departing ?? false,
		});

		const typed = resp as PresencePongResponse;
		switch (typed.directive) {
			case notification.PongDirective.ACK:
				return 'ack';
			case notification.PongDirective.RECONNECT:
				return 'reconnect';
			default:
				return 'unspecified';
		}
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
