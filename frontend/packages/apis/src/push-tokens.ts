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
 * Which provider token a registration carries.
 *
 * A device that can be woken natively registers twice under one deviceIdentifier:
 * `fcm` for routine notifications and, on iOS, `apns_voip` for calls. Firebase cannot
 * carry a VoIP push, so calls reach an iPhone over a direct APNs connection instead —
 * which is why the type has to be stated rather than inferred from the platform.
 *
 * MUST align with:
 * - Proto enum: PushTokenType
 * - The push_token_token_type_valid CHECK on notification.push_token
 * - PushTokenType* in backend/internal/notification/constants.go
 */
export type PushTokenType = 'fcm' | 'apns_voip' | 'web_push';

/**
 * The kind of call event a native call wake carries.
 *
 * Every wake carries exactly one, and each has a defined client action that ends in a
 * call reported to the operating system. On iOS that is not a style preference: a VoIP
 * push that does not result in a reported call terminates the app.
 *
 * MUST align with CallWakeEvent* in backend/internal/notification/constants.go and
 * specs/037-native-call-wakeup/contracts/call-wake-payloads.md.
 */
export type CallWakeEvent =
	| 'incoming'
	| 'cancelled'
	| 'answered_elsewhere'
	| 'declined_elsewhere'
	| 'ended';

/** Terminal wakes: report the call, then end it immediately with the matching reason. */
export const TERMINAL_CALL_WAKE_EVENTS: readonly CallWakeEvent[] = [
	'cancelled',
	'answered_elsewhere',
	'declined_elsewhere',
	'ended',
];

export function isTerminalCallWakeEvent(event: string): event is CallWakeEvent {
	return (TERMINAL_CALL_WAKE_EVENTS as readonly string[]).includes(event);
}

/**
 * The wire payload both call wake transports carry.
 *
 * `callerDisplayName` and `workspaceName` are the only human-readable strings: a lock
 * screen shows who is calling and from which workspace, and nothing about the
 * conversation. Terminal events carry the identity fields only.
 */
export interface CallWakePayload {
	event: CallWakeEvent;
	callId: string;
	organizationId: string;
	/**
	 * Milliseconds since the call started. Apply the highest sequence seen for a callId
	 * and ignore the rest, so a wake that arrives out of order — or twice — cannot
	 * resurrect a call that is already over.
	 */
	sequence: number;
	channelId?: string;
	/**
	 * The pending invitation this wake rings for. A device declining from the lock
	 * screen declines the invitation rather than ending the call, so the record reads
	 * "declined" and not "cancelled" (FR-020). Incoming wakes only.
	 */
	invitationId?: string;
	callerDisplayName?: string;
	callerEmployeeId?: string;
	workspaceName?: string;
	/** RFC 3339. A device woken after this should end the call rather than ring. */
	ringExpiresAt?: string;
}

function mapToProtoPushTokenType(tokenType: PushTokenType): notification.PushTokenType {
	switch (tokenType) {
		case 'apns_voip':
			return notification.PushTokenType.APNS_VOIP;
		case 'web_push':
			return notification.PushTokenType.WEB_PUSH;
		case 'fcm':
		default:
			return notification.PushTokenType.FCM;
	}
}

function mapProtoPushTokenType(tokenType: notification.PushTokenType): PushTokenType {
	switch (tokenType) {
		case notification.PushTokenType.APNS_VOIP:
			return 'apns_voip';
		case notification.PushTokenType.WEB_PUSH:
			return 'web_push';
		case notification.PushTokenType.FCM:
		default:
			return 'fcm';
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
	/**
	 * Required. The server rejects a registration that does not say which provider
	 * token it carries, because it picks a call transport from this and a guess routes
	 * calls to the wrong one silently.
	 */
	tokenType: PushTokenType;
	/**
	 * Whether this device's build and permissions support the native call tier. Drives
	 * whether calls reach it as a system call or as the older high-priority ring.
	 */
	nativeCallCapable?: boolean;
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
	/** Which provider token this row carries */
	tokenType: PushTokenType;
	/** Whether this device supports the native call tier */
	nativeCallCapable: boolean;
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
			tokenType: mapToProtoPushTokenType(params.tokenType),
			nativeCallCapable: params.nativeCallCapable ?? false,
		});

		const typed = resp as RegisterPushTokenResponse;
		return {
			tokenId: typed.tokenId,
			deviceIdentifier: params.deviceIdentifier,
			permissionState: params.permissionState,
			isValid: typed.isValid,
			registeredAt: protoTimestampToDate(typed.registeredAt) || new Date(),
			userAgent: params.userAgent,
			tokenType: params.tokenType,
			nativeCallCapable: params.nativeCallCapable ?? false,
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
			tokenType: mapProtoPushTokenType(token.tokenType),
			nativeCallCapable: token.nativeCallCapable,
		}));
	});
}
