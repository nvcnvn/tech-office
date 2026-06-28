/**
 * Internal JWT token management
 * Uses the platform adapter's secure storage when configured (mobile/web),
 * falling back to localStorage for web environments without a platform adapter.
 */

import { getPlatform, hasPlatform } from './platform';

const TOKEN_KEY = 'tech_office_access_token';
const TOKEN_EXPIRES_KEY = 'tech_office_token_expires_at';

/**
 * Returns true when localStorage is accessible.
 * Safe to call in React Native where `window` may exist but `localStorage` does not.
 */
function isLocalStorageAvailable(): boolean {
	try {
		return typeof window !== 'undefined' && 'localStorage' in window;
	} catch {
		return false;
	}
}

/**
 * Store the access token and its expiry via the platform secure storage,
 * or localStorage when no platform adapter is configured.
 */
export async function setAuthToken(token: string, expiresAt: number): Promise<void> {
	if (hasPlatform()) {
		try {
			const platform = getPlatform();
			await platform.secureStorage.setItemAsync(TOKEN_KEY, token);
			await platform.secureStorage.setItemAsync(TOKEN_EXPIRES_KEY, String(expiresAt));
		} catch {
			// Storage error — ignore
		}
		return;
	}
	if (!isLocalStorageAvailable()) return;
	localStorage.setItem(TOKEN_KEY, token);
	localStorage.setItem(TOKEN_EXPIRES_KEY, String(expiresAt));
}

/**
 * Clear the stored access token via the platform secure storage,
 * or localStorage when no platform adapter is configured.
 */
export async function clearAuthToken(): Promise<void> {
	if (hasPlatform()) {
		try {
			const platform = getPlatform();
			await platform.secureStorage.deleteItemAsync(TOKEN_KEY);
			await platform.secureStorage.deleteItemAsync(TOKEN_EXPIRES_KEY);
		} catch {
			// Storage error — ignore
		}
		return;
	}
	if (!isLocalStorageAvailable()) return;
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(TOKEN_EXPIRES_KEY);
}

/**
 * Retrieve the current access token.
 * Uses platform secure storage when configured (covers both mobile Keychain and web localStorage).
 * Falls back to direct localStorage access for web without a platform adapter.
 * Returns null if no token exists or the token has expired.
 */
export async function getAuthToken(): Promise<string | null> {
	try {
		if (hasPlatform()) {
			const platform = getPlatform();
			const token = await platform.secureStorage.getItemAsync(TOKEN_KEY);
			if (!token) return null;

			// Check expiry with 60-second buffer
			const expiresAt = await platform.secureStorage.getItemAsync(TOKEN_EXPIRES_KEY);
			if (expiresAt) {
				const now = Math.floor(Date.now() / 1000);
				if (parseInt(expiresAt, 10) <= now + 60) {
					await clearAuthToken();
					return null;
				}
			}
			return token;
		}

		// Fallback: direct localStorage (web without platform adapter configured)
		if (!isLocalStorageAvailable()) return null;
		const token = localStorage.getItem(TOKEN_KEY);
		if (!token) return null;

		const expiresAt = localStorage.getItem(TOKEN_EXPIRES_KEY);
		if (expiresAt) {
			const now = Math.floor(Date.now() / 1000);
			if (parseInt(expiresAt, 10) <= now + 60) {
				await clearAuthToken();
				return null;
			}
		}
		return token;
	} catch {
		return null;
	}
}

/**
 * Check if a token is currently stored (synchronous, localStorage-based).
 * Only reliable on web — on mobile use `getAuthToken()` instead.
 */
export function hasAuthToken(): boolean {
	if (!isLocalStorageAvailable()) return false;
	return localStorage.getItem(TOKEN_KEY) !== null;
}