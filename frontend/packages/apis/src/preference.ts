/**
 * User Preference API functions
 * ConnectRPC-based API calls for theme and preference management
 */

import { preferenceClient } from "./rpc";
import rpcCall from "./rpcWrapper";
import { UserPreference, ThemeMode, PreferenceSource } from "./types";
import { preference } from "rpc";

// Type aliases for RPC enums and response types
type ThemeModeProto = preference.ThemeMode;
type PreferenceSourceProto = preference.PreferenceSource;
type GetUserPreferenceResponse = preference.GetUserPreferenceResponse;
type UpdateUserPreferenceResponse = preference.UpdateUserPreferenceResponse;
type ResetUserPreferenceResponse = preference.ResetUserPreferenceResponse;

/**
 * Convert proto ThemeMode enum to TypeScript string type
 */
function protoThemeModeToString(mode: ThemeModeProto): ThemeMode {
	switch (mode) {
		case preference.ThemeMode.LIGHT:
			return 'light';
		case preference.ThemeMode.DARK:
			return 'dark';
		default:
			return 'light'; // Default to light for unknown values
	}
}

/**
 * Convert TypeScript ThemeMode string to proto enum
 */
function stringToProtoThemeMode(mode: ThemeMode): ThemeModeProto {
	switch (mode) {
		case 'light':
			return preference.ThemeMode.LIGHT;
		case 'dark':
			return preference.ThemeMode.DARK;
		default:
			return preference.ThemeMode.LIGHT;
	}
}

/**
 * Convert proto PreferenceSource enum to TypeScript string type
 */
function protoPreferenceSourceToString(source: PreferenceSourceProto): PreferenceSource {
	switch (source) {
		case preference.PreferenceSource.MANUAL:
			return 'manual';
		case preference.PreferenceSource.OS_DEFAULT:
			return 'os_default';
		default:
			return 'os_default'; // Default to os_default for unknown values
	}
}

/**
 * Convert TypeScript PreferenceSource string to proto enum
 */
function stringToProtoPreferenceSource(source: PreferenceSource): PreferenceSourceProto {
	switch (source) {
		case 'manual':
			return preference.PreferenceSource.MANUAL;
		case 'os_default':
			return preference.PreferenceSource.OS_DEFAULT;
		default:
			return preference.PreferenceSource.OS_DEFAULT;
	}
}

/**
 * Get current user's theme preference
 * Returns default values (light theme, os_default source, exists=false) if preference not found
 * 
 * @returns User preference with theme mode, source, and exists flag
 * @throws NetworkError for connectivity issues (503/500)
 * 
 * @example
 * ```ts
 * const pref = await getUserPreference();
 * if (pref.exists) {
 *   console.log(`User's theme: ${pref.themeMode}`);
 * } else {
 *   console.log('No preference saved yet, using defaults');
 * }
 * ```
 */
export async function getUserPreference(): Promise<UserPreference> {
	return await rpcCall(async () => {
		const response = await preferenceClient.getUserPreference({});
		const typed = response as GetUserPreferenceResponse;

		if (!typed.preference) {
			// No preference exists, return defaults
			return {
				themeMode: 'light',
				preferenceSource: 'os_default',
				exists: false,
			} as UserPreference;
		}

		return {
			themeMode: protoThemeModeToString(typed.preference.themeMode),
			preferenceSource: protoPreferenceSourceToString(typed.preference.preferenceSource),
			exists: typed.exists,
		} as UserPreference;
	});
}

/**
 * Update user's theme preference
 * Creates or updates the preference record in database
 * 
 * @param themeMode - Theme mode to set ('light' or 'dark')
 * @param preferenceSource - Source of preference ('manual' or 'os_default')
 * @returns Updated user preference
 * @throws ValidationError if invalid theme mode or preference source (400)
 * @throws NetworkError for connectivity issues (503/500)
 * 
 * @example
 * ```ts
 * // User clicked theme toggle (manual)
 * await updateUserPreference('dark', 'manual');
 * 
 * // Detected OS preference change (automatic)
 * await updateUserPreference('dark', 'os_default');
 * ```
 */
export async function updateUserPreference(
	themeMode: ThemeMode,
	preferenceSource: PreferenceSource
): Promise<UserPreference> {
	return await rpcCall(async () => {
		const response = await preferenceClient.updateUserPreference({
			themeMode: stringToProtoThemeMode(themeMode),
			preferenceSource: stringToProtoPreferenceSource(preferenceSource),
		});
		const typed = response as UpdateUserPreferenceResponse;

		if (!typed.preference) {
			throw new Error('UpdateUserPreference response missing preference field');
		}

		return {
			themeMode: protoThemeModeToString(typed.preference.themeMode),
			preferenceSource: protoPreferenceSourceToString(typed.preference.preferenceSource),
			exists: true, // Always true after update
		} as UserPreference;
	});
}

/**
 * Reset user's theme preference to defaults
 * Deletes the preference record from database, causing future calls to return defaults
 * 
 * @returns Default preference values (light theme, os_default source, exists=false)
 * @throws NetworkError for connectivity issues (503/500)
 * 
 * @example
 * ```ts
 * // Reset to defaults (useful for "reset to system default" button)
 * const defaultPref = await resetUserPreference();
 * console.log(defaultPref.themeMode); // 'light'
 * console.log(defaultPref.exists); // false
 * ```
 */
export async function resetUserPreference(): Promise<UserPreference> {
	return await rpcCall(async () => {
		const response = await preferenceClient.resetUserPreference({});
		const typed = response as ResetUserPreferenceResponse;

		// Reset always returns defaults (light theme, os_default source, exists=false)
		return {
			themeMode: 'light',
			preferenceSource: 'os_default',
			exists: false,
		} as UserPreference;
	});
}
