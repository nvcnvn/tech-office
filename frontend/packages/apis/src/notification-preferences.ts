/**
 * Notification preference API functions
 * ConnectRPC-based API calls for the personal notification preference record
 */

import { notificationClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { notification } from "rpc";
import { protoTimestampToDate } from "./proto-utils";
import type { SourceDomain } from "./notification";

// Type aliases for RPC response types
type GetNotificationPreferencesResponse = notification.GetNotificationPreferencesResponse;
type UpdateNotificationPreferencesResponse = notification.UpdateNotificationPreferencesResponse;

/**
 * A person's notification preferences, as stored on their account.
 *
 * The record follows the person rather than the device: signing in on a second
 * handset reads the same values, and signing out leaves nothing behind for the
 * next person to inherit.
 */
export interface NotificationPreferences {
	/**
	 * Draw the in-app banner while the app is in the foreground.
	 *
	 * Client-side only. The server stores this and never reads it: with it off the
	 * notification is still recorded, still listed, still counted as unread and
	 * still pushed to the phone.
	 */
	inAppAlertsEnabled: boolean;
	/** Source domains whose push notifications are suppressed. Deduplicated and sorted by the server. */
	mutedDomains: SourceDomain[];
	dndEnabled: boolean;
	/** "HH:MM", or "" when unset. */
	dndStart: string;
	dndEnd: string;
	/** Null when no record is stored. */
	updatedAt: Date | null;
	/** False when the server returned defaults because no record is stored. */
	exists: boolean;
}

/** What a person who has never saved anything reads. Matches the server's defaults. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
	inAppAlertsEnabled: true,
	mutedDomains: [],
	dndEnabled: false,
	dndStart: '',
	dndEnd: '',
	updatedAt: null,
	exists: false,
};

function toPreferences(
	preferences: notification.NotificationPreferences | undefined,
	exists: boolean,
): NotificationPreferences {
	if (!preferences) {
		return { ...DEFAULT_NOTIFICATION_PREFERENCES, exists };
	}
	return {
		inAppAlertsEnabled: preferences.inAppAlertsEnabled,
		mutedDomains: preferences.mutedDomains as SourceDomain[],
		dndEnabled: preferences.dndEnabled,
		dndStart: preferences.dndStart,
		dndEnd: preferences.dndEnd,
		updatedAt: protoTimestampToDate(preferences.updatedAt) ?? null,
		exists,
	};
}

/**
 * Read the authenticated person's notification preferences.
 *
 * Returns the documented defaults with `exists: false` when nothing has been
 * saved, rather than failing — the great majority of people have no record.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
	return await rpcCall(async () => {
		const resp = await notificationClient.getNotificationPreferences({});
		const typed = resp as GetNotificationPreferencesResponse;
		return toPreferences(typed.preferences, typed.exists);
	});
}

/**
 * Replace the whole record.
 *
 * Callers pass the preferences they read with the one field they are changing,
 * never a partial object — the server writes every field, so an omitted one is
 * written as false/empty. The `Omit` is what makes that impossible to express by
 * accident: `updatedAt` and `exists` are server-owned.
 */
export async function updateNotificationPreferences(
	next: Omit<NotificationPreferences, 'updatedAt' | 'exists'>,
): Promise<NotificationPreferences> {
	return await rpcCall(async () => {
		const resp = await notificationClient.updateNotificationPreferences({
			inAppAlertsEnabled: next.inAppAlertsEnabled,
			mutedDomains: next.mutedDomains,
			dndEnabled: next.dndEnabled,
			dndStart: next.dndStart,
			dndEnd: next.dndEnd,
		});
		const typed = resp as UpdateNotificationPreferencesResponse;
		return toPreferences(typed.preferences, true);
	});
}
