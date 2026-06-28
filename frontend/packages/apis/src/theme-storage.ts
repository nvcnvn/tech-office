/**
 * Theme storage utilities for persisting user theme preference
 *
 * Uses the platform adapter's `storage` when configured (mobile: MMKV,
 * web: localStorage), falling back to a direct localStorage call so the
 * module remains usable on web without the adapter configured.
 *
 * Storage pattern: `theme_preference_{employeeId}`
 */

import { ThemeMode } from './types';
import { hasPlatform, getPlatform } from './platform';

const THEME_KEY_PREFIX = 'theme_preference_';

/** Returns the raw storage adapter (platform adapter storage or localStorage shim) */
function getStorage() {
	if (hasPlatform()) {
		return getPlatform().storage;
	}

	// Web fallback — localStorage
	if (typeof window !== 'undefined' && window.localStorage) {
		return {
			getItem: (key: string) => {
				try { return window.localStorage.getItem(key); } catch { return null; }
			},
			setItem: (key: string, value: string) => {
				try { window.localStorage.setItem(key, value); } catch {}
			},
			removeItem: (key: string) => {
				try { window.localStorage.removeItem(key); } catch {}
			},
		};
	}

	// SSR / no storage available — return no-op
	return {
		getItem: (_: string): string | null => null,
		setItem: (_: string, __: string) => {},
		removeItem: (_: string) => {},
	};
}

/**
 * Save theme preference
 * @param employeeId - Employee ID to scope preference
 * @param theme - Theme mode ('light' or 'dark')
 */
export function saveThemePreference(employeeId: string, theme: ThemeMode): void {
	try {
		getStorage().setItem(`${THEME_KEY_PREFIX}${employeeId}`, theme);
	} catch (error) {
		console.error('[theme-storage] Failed to save theme preference:', error);
	}
}

/**
 * Load theme preference
 * @param employeeId - Employee ID to scope preference
 * @returns Theme mode if found, null otherwise
 */
export function loadThemePreference(employeeId: string): ThemeMode | null {
	try {
		const stored = getStorage().getItem(`${THEME_KEY_PREFIX}${employeeId}`);
		if (stored === 'light' || stored === 'dark') {
			return stored;
		}
		return null;
	} catch (error) {
		console.error('[theme-storage] Failed to load theme preference:', error);
		return null;
	}
}

/**
 * Clear theme preference
 * @param employeeId - Employee ID to scope preference
 */
export function clearThemePreference(employeeId: string): void {
	try {
		getStorage().removeItem(`${THEME_KEY_PREFIX}${employeeId}`);
	} catch (error) {
		console.error('[theme-storage] Failed to clear theme preference:', error);
	}
}

/**
 * Detect OS-level color scheme preference
 * @returns 'light' or 'dark' based on OS preference, defaults to 'light'
 */
export function detectOSTheme(): ThemeMode {
	if (hasPlatform()) {
		return getPlatform().theme.getColorScheme();
	}

	if (typeof window === 'undefined') {
		return 'light'; // SSR fallback
	}

	try {
		const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		return isDark ? 'dark' : 'light';
	} catch {
		return 'light';
	}
}

