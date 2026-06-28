/**
 * Push Token API functions
 * ConnectRPC-based API calls for push notification token management
 */

import { notificationClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { notification } from "rpc";
import { protoTimestampToDate } from "./proto-utils";

// Type aliases for RPC response types
type RegisterPushTokenResponse = notification.RegisterPushTokenResponse;
type RevokePushTokenResponse = notification.RevokePushTokenResponse;
type ListPushTokensResponse = notification.ListPushTokensResponse;

/**
 * Permission state constants.
 * 
 * MUST align with:
 * - Proto enum: PermissionState
 * - Notification.permission values from browser API
 */
export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unspecified';

/**
 * Map protobuf enum to custom type
 */
function mapProtoPermissionState(protoState: notification.PermissionState): PermissionState {
	switch (protoState) {
		case notification.PermissionState.PROMPT:
			return 'prompt';
		case notification.PermissionState.GRANTED:
			return 'granted';
		case notification.PermissionState.DENIED:
			return 'denied';
		case notification.PermissionState.UNSPECIFIED:
		default:
			return 'unspecified';
	}
}

/**
 * Map custom type to protobuf enum
 */
function mapToProtoPermissionState(state: PermissionState): notification.PermissionState {
	switch (state) {
		case 'prompt':
			return notification.PermissionState.PROMPT;
		case 'granted':
			return notification.PermissionState.GRANTED;
		case 'denied':
			return notification.PermissionState.DENIED;
		case 'unspecified':
		default:
			return notification.PermissionState.UNSPECIFIED;
	}
}

/**
 * Parameters for registering a push token
 */
export interface RegisterPushTokenParams {
	/** FCM token from Firebase Cloud Messaging */
	fcmToken: string;
	/** Unique device identifier (e.g., user agent + timestamp hash) */
	deviceIdentifier: string;
	/** Browser permission state */
	permissionState: PermissionState;
	/** Push notification endpoint URL */
	endpoint: string;
	/** JSON-encoded Web Push subscription keys (p256dh, auth) */
	keysJson: string;
	/** User agent string */
	userAgent: string;
	/** Additional metadata */
	tokenMetadata?: Record<string, string>;
}

/**
 * Push token information
 */
export interface PushToken {
	/** Token ID (UUID) */
	tokenId: string;
	/** Device identifier */
	deviceIdentifier: string;
	/** Permission state */
	permissionState: PermissionState;
	/** Whether token is valid */
	isValid: boolean;
	/** Registration timestamp */
	registeredAt: Date;
	/** Last used timestamp */
	lastUsedAt?: Date;
	/** User agent */
	userAgent?: string;
	/** Additional metadata */
	tokenMetadata?: Record<string, string>;
}

/**
 * Register or refresh a push notification token
 * 
 * @param params - Token registration parameters
 * @returns Registered token information
 */
export async function registerPushToken(
	params: RegisterPushTokenParams
): Promise<PushToken> {
	return await rpcCall(async () => {
		const resp = await notificationClient.registerPushToken({
			fcmToken: params.fcmToken,
			deviceIdentifier: params.deviceIdentifier,
			permissionState: mapToProtoPermissionState(params.permissionState),
			endpoint: params.endpoint,
			keysJson: params.keysJson,
			userAgent: params.userAgent,
			tokenMetadata: params.tokenMetadata || {},
		});

		const typed = resp as RegisterPushTokenResponse;
		return {
			tokenId: typed.tokenId,
			deviceIdentifier: params.deviceIdentifier,
			permissionState: params.permissionState,
			isValid: typed.isValid,
			registeredAt: protoTimestampToDate(typed.registeredAt) || new Date(),
			userAgent: params.userAgent,
		};
	});
}

/**
 * Revoke a push token by ID or device identifier
 * 
 * @param tokenIdOrDevice - Token ID or device identifier to revoke
 * @returns Number of tokens revoked
 */
export async function revokePushToken(
	tokenIdOrDevice: string
): Promise<{ revokedCount: number }> {
	return await rpcCall(async () => {
		const resp = await notificationClient.revokePushToken({
			target: {
				case: 'tokenId',
				value: tokenIdOrDevice,
			},
		});

		const typed = resp as RevokePushTokenResponse;
		return {
			revokedCount: typed.revokedCount,
		};
	});
}

/**
 * List all push tokens for the authenticated employee
 * 
 * @returns Array of push tokens
 */
export async function listPushTokens(): Promise<PushToken[]> {
	return await rpcCall(async () => {
		const resp = await notificationClient.listPushTokens({});

		const typed = resp as ListPushTokensResponse;

		return typed.tokens.map(token => ({
			tokenId: token.tokenId,
			deviceIdentifier: token.deviceIdentifier,
			permissionState: mapProtoPermissionState(token.permissionState),
			isValid: token.isValid,
			registeredAt: protoTimestampToDate(token.registeredAt) || new Date(),
			lastUsedAt: protoTimestampToDate(token.lastUsedAt),
			userAgent: token.userAgent,
			tokenMetadata: token.tokenMetadata,
		}));
	});
}
