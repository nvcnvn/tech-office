/**
 * Visibility API functions
 * ConnectRPC-based API calls for presence visibility settings
 */

import { notificationClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { notification } from "rpc";
import { protoTimestampToDate } from "./proto-utils";

// Type aliases for RPC response types
type SetPresenceVisibilityResponse = notification.SetPresenceVisibilityResponse;
type GetPresenceSettingsResponse = notification.GetPresenceSettingsResponse;

/**
 * Visibility mode constants.
 * 
 * MUST align with:
 * - Proto enum: VisibilityMode
 * - Backend Go constants: internal/notification/constants.go
 */
export type VisibilityMode = 'everyone' | 'departments' | 'offline' | 'unspecified';

/**
 * Map protobuf enum to custom type
 */
function mapProtoVisibilityMode(protoMode: notification.VisibilityMode): VisibilityMode {
	switch (protoMode) {
		case notification.VisibilityMode.EVERYONE:
			return 'everyone';
		case notification.VisibilityMode.DEPARTMENTS:
			return 'departments';
		case notification.VisibilityMode.OFFLINE:
			return 'offline';
		case notification.VisibilityMode.UNSPECIFIED:
		default:
			return 'unspecified';
	}
}

/**
 * Map custom type to protobuf enum
 */
function mapToProtoVisibilityMode(mode: VisibilityMode): notification.VisibilityMode {
	switch (mode) {
		case 'everyone':
			return notification.VisibilityMode.EVERYONE;
		case 'departments':
			return notification.VisibilityMode.DEPARTMENTS;
		case 'offline':
			return notification.VisibilityMode.OFFLINE;
		case 'unspecified':
		default:
			return notification.VisibilityMode.UNSPECIFIED;
	}
}

/**
 * Parameters for setting presence visibility
 */
export interface SetVisibilityParams {
	/** Visibility mode */
	visibilityMode: VisibilityMode;
	/** Custom status text (e.g., "In meeting") */
	customStatusText?: string;
	/** Custom status emoji */
	customStatusEmoji?: string;
}

/**
 * Presence visibility settings
 */
export interface PresenceVisibility {
	/** Visibility mode */
	visibilityMode: VisibilityMode;
	/** Custom status text */
	customStatusText?: string;
	/** Custom status emoji */
	customStatusEmoji?: string;
	/** Last update timestamp */
	updatedAt: Date;
}

/**
 * Set presence visibility settings for the authenticated employee
 * 
 * @param params - Visibility settings
 * @returns Updated visibility settings
 */
export async function setPresenceVisibility(
	params: SetVisibilityParams
): Promise<PresenceVisibility> {
	return await rpcCall(async () => {
		const resp = await notificationClient.setPresenceVisibility({
			visibilityMode: mapToProtoVisibilityMode(params.visibilityMode),
			customStatusText: params.customStatusText || '',
			customStatusEmoji: params.customStatusEmoji || '',
		});

		const typed = resp as SetPresenceVisibilityResponse;
		return {
			visibilityMode: mapProtoVisibilityMode(typed.visibility!.visibilityMode),
			customStatusText: typed.visibility!.customStatusText || undefined,
			customStatusEmoji: typed.visibility!.customStatusEmoji || undefined,
			updatedAt: protoTimestampToDate(typed.visibility!.updatedAt) || new Date(),
		};
	});
}

/**
 * Get current presence settings for the authenticated employee
 * 
 * @returns Current visibility settings
 */
export async function getPresenceSettings(): Promise<PresenceVisibility> {
	return await rpcCall(async () => {
		const resp = await notificationClient.getPresenceSettings({});

		const typed = resp as GetPresenceSettingsResponse;

		// Default to 'everyone' if not set
		if (!typed.visibility) {
			return {
				visibilityMode: 'everyone',
				updatedAt: new Date(),
			};
		}

		return {
			visibilityMode: mapProtoVisibilityMode(typed.visibility.visibilityMode),
			customStatusText: typed.visibility.customStatusText || undefined,
			customStatusEmoji: typed.visibility.customStatusEmoji || undefined,
			updatedAt: protoTimestampToDate(typed.visibility.updatedAt) || new Date(),
		};
	});
}
